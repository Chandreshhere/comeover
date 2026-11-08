'use strict';
// In-app notification (Mongo) + realtime `notification.created` + push job (after commit).
// `data.target = { screen, params }` uses mobile inventory screen ids (e.g. activity_detail, group_chat).
//
//   await notify(session, after, userId, { type: 'join', title, body, data: { target } });   // inside withTransaction
//   await notify(null, null, userId, {...});                                                  // outside a transaction
const realtime = require('./realtime');
const jobs = require('./jobs');

function present(n) {
  return { id: n._id, type: n.type, title: n.title, body: n.body || null, createdAt: n.createdAt, read: !!n.readAt, target: (n.data && n.data.target) || null };
}

async function notify(session, after, userId, { type, title, body = null, data = {}, push = true }) {
  const { Notification } = require('../models');
  const [doc] = await Notification.create([{ userId, type, title, body, data }], session ? { session } : undefined);
  const n = present(doc);
  const sideEffects = async () => {
    await realtime.publish(`user:${userId}:notifications`, 'notification.created', n);
    if (push) await jobs.enqueue('push', { userIds: [userId], notification: { type, title, body, data: { notificationId: n.id, target: data.target || null } } });
  };
  if (typeof after === 'function') after(sideEffects);
  else await sideEffects();
  return n;
}

module.exports = { notify, presentNotification: present };
