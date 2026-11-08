'use strict';
// In-app notification (DB) + realtime `notification.created` + push enqueue (after commit).
// `data.target = { screen, params }` uses mobile inventory screen ids (e.g. activity_detail, group_chat).
const realtime = require('./realtime');
const { enqueue } = require('./queue');

async function notify(client, after, userId, { type, title, body = null, data = {}, push = true }) {
  const { rows } = await client.query(
    'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
    [userId, type, title, body, JSON.stringify(data)]
  );
  const n = { id: rows[0].id, type, title, body, createdAt: rows[0].created_at, read: false, target: data.target || null };
  after(async () => {
    await realtime.publish(`user:${userId}:notifications`, { type: 'notification.created', data: n });
    if (push) await enqueue({ type: 'push', userIds: [userId], notification: { type, title, body, data: { notificationId: n.id, target: data.target || null } } });
  });
  return n;
}

module.exports = { notify };
