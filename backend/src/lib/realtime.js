'use strict';
// WebSocket realtime (replaces API Gateway WebSocket).
//
//   connect      wss://<host>/ws?token=<access JWT>
//   subscribe    {"action":"subscribe","channel":"conversation:<id>"}   → {"type":"subscription.ok"|"subscription.denied", channel}
//   unsubscribe  {"action":"unsubscribe","channel":"…"}
//   ping         {"action":"ping"}                                      → {"type":"pong"}
// Server → client envelope: {"type", "channel", "data", "at"}
// Channels: activity:{activityId} · conversation:{conversationId} · user:{userId}:notifications
// (each connection is auto-subscribed to its own user channel).
//
// Handlers publish with:   await realtime.publish(channel, 'message.created', data)
// Multi-instance: publish() inserts a RealtimeEvent; every instance tails the
// collection with a change stream and delivers to its local sockets. Without a
// replica set it falls back to local delivery only.
const crypto = require('crypto');
const { URL } = require('url');
const config = require('../config');
const logger = require('../logger');
const { verifyAccessToken } = require('./tokens');

const INSTANCE_ID = process.env.INSTANCE_ID || crypto.randomUUID();
const CHANNEL_RE = /^(activity|conversation):([0-9a-f-]{36})$|^user:([0-9a-f-]{36}):notifications$/i;
const MAX_SUBSCRIPTIONS = 200;

const channels = new Map(); // channel -> Set<ws>
let wss = null;
let changeStream = null;
let fanoutMode = 'local'; // 'local' | 'change_stream'
let heartbeat = null;

function parseChannel(channel) {
  const m = String(channel || '').match(CHANNEL_RE);
  if (!m) return null;
  if (m[1]) return { type: m[1].toLowerCase(), id: m[2] };
  return { type: 'user', id: m[3] };
}

// Authorisation for subscriptions (publishers only publish to channels the data belongs to).
async function canSubscribe(userId, channel) {
  const c = parseChannel(channel);
  if (!c) return false;
  if (c.type === 'user') return c.id === userId;
  const { ConversationMember, Activity, Participant } = require('../models');
  if (c.type === 'conversation') {
    return !!(await ConversationMember.exists({ conversationId: c.id, userId, leftAt: null }));
  }
  const a = await Activity.findById(c.id).select('hostUserId').lean();
  if (!a) return false;
  if (a.hostUserId === userId) return true;
  return !!(await Participant.exists({ activityId: c.id, userId, state: { $in: ['requested', 'accepted', 'waitlisted', 'checked_in', 'completed'] } }));
}

function addSub(ws, channel) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(ws);
  ws.irl.channels.add(channel);
}

function removeSub(ws, channel) {
  const set = channels.get(channel);
  if (set) {
    set.delete(ws);
    if (!set.size) channels.delete(channel);
  }
  ws.irl.channels.delete(channel);
}

function sendTo(ws, payload) {
  if (ws.readyState === 1) ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

function deliverLocal(channel, envelope) {
  const set = channels.get(channel);
  if (!set || !set.size) return 0;
  const frame = JSON.stringify(envelope);
  let n = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(frame);
      n += 1;
    }
  }
  return n;
}

// publish(channel, type, data) — or legacy publish(channel, { type, data }).
async function publish(channel, type, data) {
  const event = typeof type === 'object' && type !== null ? type : { type, data };
  const envelope = { type: event.type, channel, data: event.data === undefined ? {} : event.data, at: new Date().toISOString() };
  const delivered = deliverLocal(channel, envelope);
  if (fanoutMode === 'change_stream') {
    try {
      const { RealtimeEvent } = require('../models');
      await RealtimeEvent.create({ channel, type: envelope.type, data: envelope.data, origin: INSTANCE_ID });
    } catch (e) {
      logger.warn({ msg: 'realtime_fanout_insert_failed', err: e.message });
    }
  }
  return { delivered };
}

async function startFanout() {
  if (!config.realtime.changeStreams) return;
  const db = require('./db');
  if (!(await db.isReplicaSet())) {
    logger.warn({ msg: 'realtime_local_only', reason: 'not a replica set (change streams unavailable)' });
    return;
  }
  const { RealtimeEvent } = require('../models');
  try {
    changeStream = RealtimeEvent.watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'default' });
    changeStream.on('change', (ch) => {
      const d = ch.fullDocument;
      if (!d || d.origin === INSTANCE_ID) return;
      deliverLocal(d.channel, { type: d.type, channel: d.channel, data: d.data || {}, at: (d.createdAt || new Date()).toISOString() });
    });
    changeStream.on('error', (e) => {
      logger.error({ msg: 'realtime_change_stream_error', err: e.message });
      fanoutMode = 'local';
      changeStream = null;
      setTimeout(() => startFanout().catch(() => {}), 30000).unref();
    });
    fanoutMode = 'change_stream';
    logger.info({ msg: 'realtime_fanout', mode: fanoutMode, instance: INSTANCE_ID });
  } catch (e) {
    logger.warn({ msg: 'realtime_local_only', reason: e.message });
  }
}

async function authenticateUpgrade(req) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || ((req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
  if (!token) return { status: 401 };
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (e) {
    return { status: 401 };
  }
  const { User } = require('../models');
  const u = await User.findById(claims.sub).select('status').lean();
  if (!u || !['active', 'limited'].includes(u.status)) return { status: 403 };
  return { userId: u._id };
}

function onConnection(ws, userId) {
  ws.irl = { userId, channels: new Set(), alive: true };
  addSub(ws, `user:${userId}:notifications`);
  ws.on('pong', () => {
    ws.irl.alive = true;
  });
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (e) {
      return sendTo(ws, { type: 'error', data: { code: 'invalid_json' } });
    }
    const action = msg && msg.action;
    try {
      if (action === 'subscribe') {
        const channel = String(msg.channel || '');
        if (ws.irl.channels.size >= MAX_SUBSCRIPTIONS) return sendTo(ws, { type: 'subscription.denied', channel, data: { code: 'too_many_subscriptions' } });
        if (!(await canSubscribe(userId, channel))) return sendTo(ws, { type: 'subscription.denied', channel, data: {} });
        addSub(ws, channel);
        return sendTo(ws, { type: 'subscription.ok', channel, data: {} });
      }
      if (action === 'unsubscribe') {
        removeSub(ws, String(msg.channel || ''));
        return undefined;
      }
      return sendTo(ws, { type: 'pong', data: {} });
    } catch (e) {
      logger.error({ msg: 'ws_message_error', err: e.message });
      return sendTo(ws, { type: 'error', data: { code: 'internal' } });
    }
  });
  ws.on('close', () => {
    for (const ch of [...ws.irl.channels]) removeSub(ws, ch);
  });
}

// Attach to an http.Server. Path: /ws
function attach(server, { path = '/ws' } = {}) {
  const { WebSocketServer } = require('ws');
  wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    authenticateUpgrade(req)
      .then((r) => {
        if (!r.userId) {
          socket.write(`HTTP/1.1 ${r.status === 403 ? '403 Forbidden' : '401 Unauthorized'}\r\n\r\n`);
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, r.userId));
      })
      .catch(() => {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
  });
  heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.irl || !ws.irl.alive) {
        ws.terminate();
        continue;
      }
      ws.irl.alive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  return wss;
}

async function close() {
  clearInterval(heartbeat);
  if (changeStream) await changeStream.close().catch(() => {});
  changeStream = null;
  fanoutMode = 'local';
  if (wss) {
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    await new Promise((r) => wss.close(() => r()));
    wss = null;
  }
  channels.clear();
}

const stats = () => ({ instance: INSTANCE_ID, mode: fanoutMode, connections: wss ? wss.clients.size : 0, channels: channels.size });

module.exports = { INSTANCE_ID, parseChannel, canSubscribe, publish, attach, startFanout, close, stats, deliverLocal };
