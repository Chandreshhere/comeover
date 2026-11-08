'use strict';
// Activity jobs (ported from legacy/src/handlers/jobs.js):
//   reliability_recalc { userId }   — peer no-show evidence → no_show state → smoothed show-up score
//   lifecycle (cron, every 15 min)  — plans → in_progress, expire unanswered requests,
//                                     availability expiry, account status_until expiry, campaign completion
const db = require('../lib/db');
const { notify } = require('../lib/notify');

const models = () => require('../models');

// Reliability = Bayesian-smoothed show-up rate. Peer "didn't show" feedback only
// counts when ≥2 different people say so and the person never checked in.
async function reliabilityRecalc({ userId }) {
  if (!userId) return;
  const { ActivityFeedback, Participant, ReliabilityEvent, Activity, User } = models();

  const reports = await ActivityFeedback.aggregate([
    { $match: { aboutUserId: userId, showedUp: false } },
    { $group: { _id: '$activityId', from: { $addToSet: '$fromUserId' } } },
    { $match: { 'from.1': { $exists: true } } },
  ]);
  for (const r of reports) {
    const p = await Participant.findOne({ activityId: r._id, userId }).lean();
    if (!p || p.checkedInAt || p.state === 'completed') continue;
    await ReliabilityEvent.updateOne({ userId, activityId: r._id, kind: 'no_show' }, { $setOnInsert: { userId, activityId: r._id, kind: 'no_show' } }, { upsert: true });
  }

  const noShows = await ReliabilityEvent.distinct('activityId', { userId, kind: 'no_show' });
  if (noShows.length) {
    const flip = await Participant.find({ userId, activityId: { $in: noShows }, state: { $in: ['accepted', 'checked_in'] } }).select('_id activityId').lean();
    for (const p of flip) {
      const res = await Participant.updateOne({ _id: p._id, state: { $in: ['accepted', 'checked_in'] } }, { $set: { state: 'no_show' } });
      if (res.modifiedCount) await Activity.updateOne({ _id: p.activityId, acceptedCount: { $gt: 1 } }, { $inc: { acceptedCount: -1 } });
    }
  }

  const counts = await ReliabilityEvent.aggregate([{ $match: { userId } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const attended = c.attended || 0;
  const noShow = c.no_show || 0;
  const late = (c.late_cancel || 0) + (c.host_cancel || 0);
  const score = Math.min(1, Math.max(0, (attended + 2) / (attended + noShow + 0.5 * late + 2)));
  await User.updateOne({ _id: userId, profile: { $ne: null } }, { $set: { 'profile.reliabilityScore': score } });
  return { score };
}

async function lifecycle(now = new Date()) {
  const { Activity, Participant, User, SponsoredCampaign } = models();

  // Plans that started move to in_progress.
  const started = await Activity.updateMany({ status: { $in: ['open', 'full'] }, startsAt: { $lte: now }, endsAt: { $gt: now } }, { $set: { status: 'in_progress' } });

  // Unanswered requests / waitlist entries expire at start time.
  const pending = await Participant.find({ state: { $in: ['requested', 'waitlisted'] } }).select('activityId').lean();
  const startedIds = pending.length
    ? await Activity.distinct('_id', { _id: { $in: [...new Set(pending.map((p) => p.activityId))] }, startsAt: { $lte: now } })
    : [];
  let expired = 0;
  if (startedIds.length) {
    const rows = await Participant.find({ activityId: { $in: startedIds }, state: { $in: ['requested', 'waitlisted'] } }).lean();
    const titles = new Map((await Activity.find({ _id: { $in: startedIds } }).select('title').lean()).map((a) => [a._id, a.title]));
    for (const p of rows) {
      await db.withTransaction(async (session, after) => {
        const res = await Participant.updateOne({ _id: p._id, state: { $in: ['requested', 'waitlisted'] } }, { $set: { state: 'declined', decidedAt: now, waitlistPosition: null } }, { session });
        if (!res.modifiedCount) return;
        expired++;
        if (p.state === 'waitlisted') await Activity.updateOne({ _id: p.activityId, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
        await notify(session, after, p.userId, {
          type: 'join',
          title: 'Request expired',
          body: `"${titles.get(p.activityId) || 'A plan'}" started before the host replied. Plenty more nearby.`,
          data: { activityId: p.activityId, target: { screen: 'discover_home', params: {} } },
          push: false,
        });
      });
    }
  }

  const availability = await User.updateMany({ 'availability.status': { $ne: 'busy' }, 'availability.until': { $ne: null, $lt: now } }, { $set: { 'availability.status': 'busy' } });
  const restored = await User.updateMany(
    { status: { $in: ['limited', 'suspended'] }, statusUntil: { $ne: null, $lt: now } },
    { $set: { status: 'active', statusReason: null, statusUntil: null } }
  );
  const campaigns = await SponsoredCampaign.updateMany({ status: 'active', endsAt: { $lt: now } }, { $set: { status: 'completed' } });
  const inactive = await SponsoredCampaign.distinct('_id', { status: { $ne: 'active' } });
  if (inactive.length) await Activity.updateMany({ sponsoredCampaignId: { $in: inactive } }, { $set: { sponsoredCampaignId: null } });

  return {
    startedPlans: started.modifiedCount || 0,
    expiredRequests: expired,
    availabilityExpired: availability.modifiedCount || 0,
    statusRestored: restored.modifiedCount || 0,
    campaignsCompleted: campaigns.modifiedCount || 0,
  };
}

function register(jobs, logger) {
  jobs.register('reliability_recalc', reliabilityRecalc);
  jobs.schedule('lifecycle', '*/15 * * * *', async () => {
    const res = await lifecycle();
    if (logger) logger.info({ msg: 'lifecycle_done', ...res });
  });
}

module.exports = { reliabilityRecalc, lifecycle, register };
