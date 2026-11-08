'use strict';
// API Gateway WebSocket API.
//   $connect     wss://…?token=<Cognito access token>  (verified against the user pool JWKS)
//   subscribe    {"action":"subscribe","channel":"conversation:<id>"}
//   unsubscribe  {"action":"unsubscribe","channel":"…"}
//   $default     {"action":"ping"} → {"type":"pong"}
//   $disconnect
// Server → client envelope: {"type": "message.created"|"join.updated"|"activity.updated"|"notification.created"|…, "channel", "data", "at"}
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const db = require('../lib/db');
const realtime = require('../lib/realtime');
const { wsApi } = require('../lib/aws');

let verifier;
function getVerifier() {
  if (!verifier) verifier = CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID, tokenUse: 'access', clientId: process.env.USER_POOL_CLIENT_ID });
  return verifier;
}

const reply = (statusCode, body) => ({ statusCode, body: body ? JSON.stringify(body) : '' });

async function send(connectionId, payload) {
  const { PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
  await wsApi()
    .send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(payload)) }))
    .catch(() => {});
}

async function userForConnection(connectionId) {
  const row = await db.one('SELECT user_id FROM ws_connections WHERE connection_id = $1', [connectionId]);
  return row && row.user_id;
}

exports.handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  const { routeKey, connectionId } = event.requestContext;
  try {
    if (routeKey === '$connect') {
      const token = (event.queryStringParameters || {}).token;
      if (!token) return reply(401);
      let claims;
      try {
        claims = await getVerifier().verify(token);
      } catch (e) {
        return reply(401);
      }
      const u = await db.one("SELECT id FROM app_users WHERE cognito_sub = $1 AND status IN ('active','limited')", [claims.sub]);
      if (!u) return reply(403);
      await db.query('INSERT INTO ws_connections (connection_id, user_id) VALUES ($1, $2) ON CONFLICT (connection_id) DO UPDATE SET user_id = EXCLUDED.user_id, last_seen_at = now()', [connectionId, u.id]);
      // Auto-subscribe to the user's own notification channel.
      await db.query('INSERT INTO ws_subscriptions (connection_id, channel) VALUES ($1, $2) ON CONFLICT DO NOTHING', [connectionId, `user:${u.id}:notifications`]);
      return reply(200);
    }
    if (routeKey === '$disconnect') {
      await db.query('DELETE FROM ws_connections WHERE connection_id = $1', [connectionId]);
      return reply(200);
    }

    const userId = await userForConnection(connectionId);
    if (!userId) return reply(403);
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      await send(connectionId, { type: 'error', data: { code: 'invalid_json' } });
      return reply(400);
    }
    await db.query('UPDATE ws_connections SET last_seen_at = now() WHERE connection_id = $1', [connectionId]);

    if (routeKey === 'subscribe') {
      const ok = await realtime.canSubscribe(db, userId, body.channel);
      if (!ok) {
        await send(connectionId, { type: 'subscription.denied', channel: body.channel, data: {} });
        return reply(403);
      }
      await db.query('INSERT INTO ws_subscriptions (connection_id, channel) VALUES ($1, $2) ON CONFLICT DO NOTHING', [connectionId, body.channel]);
      await send(connectionId, { type: 'subscription.ok', channel: body.channel, data: {} });
      return reply(200);
    }
    if (routeKey === 'unsubscribe') {
      await db.query('DELETE FROM ws_subscriptions WHERE connection_id = $1 AND channel = $2', [connectionId, String(body.channel || '')]);
      return reply(200);
    }
    await send(connectionId, { type: 'pong', data: {} });
    return reply(200);
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'ws_error', routeKey, error: e.message }));
    return reply(500);
  }
};
