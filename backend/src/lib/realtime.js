'use strict';
// Realtime fan-out over API Gateway WebSocket.
// Channels: activity:{activityId} · conversation:{conversationId} · user:{userId}:notifications
const db = require('./db');
const { wsApi } = require('./aws');

const CHANNEL_RE = /^(activity|conversation):([0-9a-f-]{36})$|^user:([0-9a-f-]{36}):notifications$/i;

function parseChannel(channel) {
  const m = String(channel || '').match(CHANNEL_RE);
  if (!m) return null;
  if (m[1]) return { type: m[1].toLowerCase(), id: m[2] };
  return { type: 'user', id: m[3] };
}

// Authorisation for subscriptions (also re-checked implicitly because
// publishers only publish to channels the data belongs to).
async function canSubscribe(q, userId, channel) {
  const c = parseChannel(channel);
  if (!c) return false;
  if (c.type === 'user') return c.id === userId;
  if (c.type === 'conversation') {
    const { rowCount } = await q.query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL', [c.id, userId]);
    return rowCount > 0;
  }
  const { rowCount } = await q.query(
    `SELECT 1 FROM activities a WHERE a.id = $1 AND (a.host_user_id = $2 OR EXISTS (
       SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = $2 AND p.state IN ('requested','accepted','waitlisted','checked_in','completed')))`,
    [c.id, userId]
  );
  return rowCount > 0;
}

async function publish(channel, event) {
  if (!process.env.WS_ENDPOINT) return { delivered: 0 };
  const { rows } = await db.query('SELECT connection_id FROM ws_subscriptions WHERE channel = $1', [channel]);
  if (!rows.length) return { delivered: 0 };
  const { PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
  const data = Buffer.from(JSON.stringify({ channel, ...event, at: new Date().toISOString() }));
  let delivered = 0;
  await Promise.all(
    rows.map(async ({ connection_id: id }) => {
      try {
        await wsApi().send(new PostToConnectionCommand({ ConnectionId: id, Data: data }));
        delivered += 1;
      } catch (e) {
        if (e && (e.$metadata?.httpStatusCode === 410 || e.name === 'GoneException')) {
          await db.query('DELETE FROM ws_connections WHERE connection_id = $1', [id]).catch(() => {});
        }
      }
    })
  );
  return { delivered };
}

module.exports = { parseChannel, canSubscribe, publish };
