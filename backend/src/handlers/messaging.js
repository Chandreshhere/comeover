'use strict';
// Conversations & messages. Chat only opens after an approved join (activity
// groups), within circles you belong to, or 1:1 between people who shared an
// accepted plan. Blocks are enforced on every read and write.
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertCanAct } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const realtime = require('../lib/realtime');
const { enqueue } = require('../lib/queue');
const { pageParams, pageOf } = require('../lib/page');
const media = require('../lib/media');
const P = require('../lib/present');
const { REASON_CODES, priorityFor } = require('../services/safety');

const CONV_SELECT = `
  SELECT c.id, c.kind, c.activity_id, c.circle_id, c.created_at, cm.muted,
         CASE c.kind WHEN 'activity_group' THEN act.title WHEN 'circle' THEN ci.name
           ELSE (SELECT p.display_name FROM conversation_members o JOIN profiles p ON p.user_id = o.user_id
                  WHERE o.conversation_id = c.id AND o.user_id <> $1 LIMIT 1) END AS title,
         (SELECT COALESCE(array_agg(m.user_id::text), '{}') FROM conversation_members m WHERE m.conversation_id = c.id AND m.left_at IS NULL) AS member_ids,
         (SELECT count(*)::int FROM messages x
           WHERE x.conversation_id = c.id AND x.deleted_at IS NULL
             AND x.created_at > COALESCE(cm.last_read_at, cm.joined_at)
             AND (x.sender_user_id IS NULL OR x.sender_user_id <> $1)
             AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = $1 AND b.blocked_user_id = x.sender_user_id)) AS unread,
         lm.last_message_id, lm.last_message_sender, lm.last_message_body, lm.last_message_at, lm.last_message_kind
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    LEFT JOIN activities act ON act.id = c.activity_id
    LEFT JOIN circles ci ON ci.id = c.circle_id
    LEFT JOIN LATERAL (
      SELECT id AS last_message_id, sender_user_id AS last_message_sender, body AS last_message_body, created_at AS last_message_at, kind AS last_message_kind
        FROM messages WHERE conversation_id = c.id AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = $1 AND b.blocked_user_id = messages.sender_user_id)
       ORDER BY created_at DESC LIMIT 1) lm ON TRUE
   WHERE cm.user_id = $1 AND cm.left_at IS NULL
     AND NOT (c.kind = 'direct' AND EXISTS (
       SELECT 1 FROM conversation_members o JOIN user_blocks b
         ON (b.blocker_user_id = $1 AND b.blocked_user_id = o.user_id) OR (b.blocker_user_id = o.user_id AND b.blocked_user_id = $1)
        WHERE o.conversation_id = c.id AND o.user_id <> $1))`;

async function loadConversation(userId, conversationId) {
  const row = await db.one(`${CONV_SELECT} AND c.id = $2`, [userId, conversationId]);
  if (!row) throw err.notFound('conversation_not_found');
  return row;
}

const routes = {
  'GET /v1/conversations': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const page = pageParams(req.query, { def: 30, max: 100 });
    const rows = await db.many(
      `${CONV_SELECT} AND (cm.hidden_at IS NULL OR lm.last_message_at > cm.hidden_at)
       ORDER BY COALESCE(lm.last_message_at, c.created_at) DESC LIMIT $2 OFFSET $3`,
      [user.id, page.sqlLimit, page.offset]
    );
    return pageOf(rows, page, P.conversation);
  },

  'POST /v1/conversations': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'message');
    const v = check(
      {
        kind: { type: 'string', required: true, enum: ['direct', 'circle'] },
        userId: { type: 'string', format: 'uuid' },
        circleId: { type: 'string', format: 'uuid' },
      },
      req.body
    );
    let id;
    if (v.kind === 'direct') {
      if (!v.userId || v.userId === user.id) throw err.badRequest('user_required');
      const { rowCount: blocked } = await db.query(
        'SELECT 1 FROM user_blocks WHERE (blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1)',
        [user.id, v.userId]
      );
      if (blocked) throw err.forbidden('blocked');
      // Direct chat only between people who shared an accepted plan.
      const { rowCount: shared } = await db.query(
        `SELECT 1 FROM activity_participants a JOIN activity_participants b ON a.activity_id = b.activity_id
          WHERE a.user_id = $1 AND b.user_id = $2 AND a.state IN ('accepted','checked_in','completed') AND b.state IN ('accepted','checked_in','completed') LIMIT 1`,
        [user.id, v.userId]
      );
      if (!shared) throw err.forbidden('chat_not_available', 'You can message people after you share an accepted plan.');
      id = await db.withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT c.id FROM conversations c
             JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1
             JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2
            WHERE c.kind = 'direct' LIMIT 1`,
          [user.id, v.userId]
        );
        if (rows[0]) {
          await client.query('UPDATE conversation_members SET hidden_at = NULL, left_at = NULL WHERE conversation_id = $1 AND user_id = $2', [rows[0].id, user.id]);
          return rows[0].id;
        }
        const { rows: c } = await client.query("INSERT INTO conversations (kind) VALUES ('direct') RETURNING id");
        await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [c[0].id, user.id, v.userId]);
        return c[0].id;
      });
    } else {
      if (!v.circleId) throw err.badRequest('circle_required');
      const { rowCount: member } = await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [v.circleId, user.id]);
      if (!member) throw err.forbidden('not_circle_member');
      id = await db.withTransaction(async (client) => {
        const { rows } = await client.query("SELECT id FROM conversations WHERE kind = 'circle' AND circle_id = $1", [v.circleId]);
        const cid = rows[0] ? rows[0].id : (await client.query("INSERT INTO conversations (kind, circle_id) VALUES ('circle', $1) RETURNING id", [v.circleId])).rows[0].id;
        await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, hidden_at = NULL', [cid, user.id]);
        return cid;
      });
    }
    return created(P.conversation(await loadConversation(user.id, id)));
  },

  'DELETE /v1/conversations/{conversationId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const c = await loadConversation(user.id, req.params.conversationId);
    // Circles: leave the chat. Direct/activity chats: hide for me until a new message arrives.
    if (c.kind === 'circle') await db.query('UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, user.id]);
    else await db.query('UPDATE conversation_members SET hidden_at = now(), last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, user.id]);
    return { ok: true };
  },

  'POST /v1/conversations/{conversationId}/mute': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { muted } = check({ muted: { type: 'boolean', required: true } }, req.body);
    const r = await db.query('UPDATE conversation_members SET muted = $3 WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL', [req.params.conversationId, user.id, muted]);
    if (!r.rowCount) throw err.notFound('conversation_not_found');
    return { muted };
  },

  'POST /v1/conversations/{conversationId}/read': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const r = await db.query('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL', [req.params.conversationId, user.id]);
    if (!r.rowCount) throw err.notFound('conversation_not_found');
    return { ok: true };
  },

  // Newest page first; items within a page are oldest → newest. nextCursor loads older.
  'GET /v1/conversations/{conversationId}/messages': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    await loadConversation(user.id, req.params.conversationId);
    const page = pageParams(req.query, { def: 40, max: 100 });
    const rows = await db.many(
      `SELECT m.* FROM messages m
        WHERE m.conversation_id = $1
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = $2 AND b.blocked_user_id = m.sender_user_id)
        ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`,
      [req.params.conversationId, user.id, page.sqlLimit, page.offset]
    );
    const res = pageOf(rows, page, P.message);
    res.items.reverse();
    return res;
  },

  'POST /v1/conversations/{conversationId}/messages': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'message');
    const v = check({ body: { type: 'string', max: 2000 }, mediaKey: { type: 'string', max: 200 } }, req.body);
    if (!v.body && !v.mediaKey) throw err.badRequest('empty_message');
    if (v.mediaKey && !media.isOwnedKey(v.mediaKey, 'chat', user.id)) throw err.badRequest('invalid_media_key');
    const c = await loadConversation(user.id, req.params.conversationId);
    if (c.kind === 'activity_group') {
      const ok = await db.one(
        `SELECT 1 AS ok FROM activities a WHERE a.id = $1 AND a.status <> 'moderated' AND (a.host_user_id = $2 OR EXISTS (
           SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = $2 AND p.state IN ('accepted','checked_in','completed')))`,
        [c.activity_id, user.id]
      );
      if (!ok) throw err.forbidden('chat_closed', 'This chat is only for accepted participants.');
    }
    await enforce(db, 'chat_message', user.id);
    const row = await db.withTransaction(async (client, after) => {
      const { rows } = await client.query("INSERT INTO messages (conversation_id, sender_user_id, body, media_key, kind) VALUES ($1, $2, $3, $4, 'user') RETURNING *", [
        c.id,
        user.id,
        v.body || null,
        v.mediaKey || null,
      ]);
      await client.query('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, user.id]);
      const { rows: others } = await client.query(
        `SELECT m.user_id FROM conversation_members m WHERE m.conversation_id = $1 AND m.user_id <> $2 AND m.left_at IS NULL AND NOT m.muted
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = m.user_id AND b.blocked_user_id = $2)`,
        [c.id, user.id]
      );
      const msg = P.message(rows[0]);
      after(async () => {
        await realtime.publish(`conversation:${c.id}`, { type: 'message.created', data: msg });
        if (others.length) {
          const screen = c.kind === 'activity_group' ? 'group_chat' : 'chat_thread';
          await enqueue({
            type: 'push',
            userIds: others.map((o) => o.user_id),
            notification: { type: 'message', title: c.kind === 'direct' ? user.displayName : `${user.displayName} · ${c.title}`, body: (v.body || 'Sent a photo').slice(0, 140), data: { conversationId: c.id, target: { screen, params: { conversationId: c.id } } } },
          });
        }
      });
      return rows[0];
    });
    return created(P.message(row));
  },

  'POST /v1/messages/{messageId}/report': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check({ reasonCode: { type: 'string', required: true, enum: REASON_CODES }, details: { type: 'string', max: 2000 } }, req.body);
    const m = await db.one(
      `SELECT m.id, m.conversation_id, m.sender_user_id, c.activity_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2
        WHERE m.id = $1`,
      [req.params.messageId, user.id]
    );
    if (!m) throw err.notFound('message_not_found');
    if (!m.sender_user_id || m.sender_user_id === user.id) throw err.badRequest('cannot_report_message');
    await enforce(db, 'report', user.id);
    const r = await db.withTransaction(async (client, after) => {
      const { rows } = await client.query(
        `INSERT INTO reports (reporter_user_id, reported_user_id, activity_id, message_id, conversation_id, reason_code, details, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
        [user.id, m.sender_user_id, m.activity_id, m.id, m.conversation_id, v.reasonCode, v.details || null, priorityFor(v.reasonCode)]
      );
      after(() => enqueue({ type: 'moderation_alert', reportId: rows[0].id }));
      return rows[0];
    });
    return created({ id: r.id, status: r.status, createdAt: r.created_at });
  },
};

exports.handler = createRouter(routes);
