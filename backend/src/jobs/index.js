'use strict';
// Job handlers + schedules (Mongo-backed queue + node-cron, one instance per slot).
//
// Queued jobs:   push { userIds, notification } · quest_evaluate { userId }
//                reliability_recalc { userId } (jobs/activities.js) · moderation_alert { reportId, appeal }
// Schedules:     lifecycle */15 min (plans → in_progress/completed, expire requests, availability
//                and status_until expiry, campaign completion) · retention 03:17 · housekeeping 04:41
const jobs = require('../lib/jobs');
const push = require('../lib/push');
const logger = require('../logger');

async function runPush({ userIds = [], notification }) {
  if (!userIds.length || !notification) return;
  const { DeviceToken, User } = require('../models');
  const users = await User.find({ _id: { $in: userIds }, status: { $ne: 'deleted' } }).select('notificationPrefs').lean();
  const allowed = new Set(users.filter((u) => push.shouldDeliver(u.notificationPrefs || null, notification.type)).map((u) => u._id));
  if (!allowed.size) return;
  const tokens = await DeviceToken.find({ userId: { $in: [...allowed] } }).select('token').lean();
  const res = await push.sendToTokens(
    tokens.map((t) => t.token),
    notification
  );
  if (res.invalid && res.invalid.length) await DeviceToken.deleteMany({ token: { $in: res.invalid } });
}

// DPDP-style purge: anonymise accounts whose 30-day deletion window has passed.
async function retention() {
  const { User, TrustedContact, Notification, Message, DeviceToken, Session } = require('../models');
  const due = await User.find({ status: 'deleted', purgeAfter: { $ne: null, $lt: new Date() } }).select('_id').lean();
  for (const { _id: id } of due) {
    await User.updateOne(
      { _id: id },
      {
        $set: {
          phone: `deleted:${id}`,
          purgeAfter: null,
          roles: [],
          'availability.status': 'busy',
          'availability.activitySlugs': [],
          'availability.coarseCell': null,
          'availability.area': null,
        },
      }
    );
    await User.updateOne(
      { _id: id, profile: { $ne: null } },
      { $set: { 'profile.displayName': 'Deleted user', 'profile.bio': null, 'profile.avatarKey': null, 'profile.interests': [], 'profile.intents': [], 'profile.boundaries': null, 'profile.socialStyle': null, 'profile.preferences': {} } }
    );
    await TrustedContact.deleteMany({ userId: id });
    await Notification.deleteMany({ userId: id });
    await DeviceToken.deleteMany({ userId: id });
    await Session.deleteMany({ userId: id });
    await Message.updateMany({ senderUserId: id, deletedAt: null }, { $set: { body: null, mediaKey: null, deletedAt: new Date() } });
  }
  return { purgedAccounts: due.length };
}

// Most cleanup is handled by TTL indexes (idempotency keys, OTP requests,
// rate limits, sessions, plan shares, webhook events, realtime events, finished jobs).
async function housekeeping() {
  const { Notification } = require('../models');
  const cutoff = new Date(Date.now() - 180 * 86400000);
  const r = await Notification.deleteMany({ readAt: { $ne: null }, createdAt: { $lt: cutoff } });
  return { oldNotifications: r.deletedCount || 0 };
}

let registered = false;
function registerAll() {
  if (registered) return;
  registered = true;
  jobs.register('push', runPush);
  require('./activities').register(jobs, logger); // plans & discovery (group B): reliability_recalc + lifecycle cron
  jobs.register('moderation_alert', (payload) => require('../services/safety').runModerationAlert(payload)); // group C: safety
  jobs.schedule('retention', '17 3 * * *', async () => logger.info({ msg: 'retention_done', ...(await retention()) }));
  jobs.schedule('housekeeping', '41 4 * * *', async () => logger.info({ msg: 'housekeeping_done', ...(await housekeeping()) }));
  // progress (group A): mark completed quests + award badges after verified completions.
  jobs.register('quest_evaluate', (payload) => require('../handlers/progress').runQuestEvaluate(payload));
}

module.exports = { registerAll, runPush, retention, housekeeping };
