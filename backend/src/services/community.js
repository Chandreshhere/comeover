'use strict';
// "Who is connected to whom" — used by chat access, direct messages and SplitMate.
// A plan group = the host + participants in an accepted state. Hosts are checked
// explicitly so this doesn't depend on whether a host Participant row exists.
const IN_GROUP = ['accepted', 'checked_in', 'completed'];

// Activity ids the user hosts or is accepted into.
async function planGroupIds(userId, { session } = {}) {
  const { Participant, Activity } = require('../models');
  const p = Participant.distinct('activityId', { userId, state: { $in: IN_GROUP } });
  const h = Activity.distinct('_id', { hostUserId: userId });
  if (session) {
    p.session(session);
    h.session(session);
  }
  const [a, b] = await Promise.all([p, h]);
  return new Set([...a, ...b].map(String));
}

// Host + accepted participants of one plan (null when the plan doesn't exist).
async function planGroupMembers(activityId, { session } = {}) {
  const { Participant, Activity } = require('../models');
  const aq = Activity.findById(activityId).select('hostUserId status');
  const pq = Participant.find({ activityId, state: { $in: IN_GROUP } }).select('userId');
  if (session) {
    aq.session(session);
    pq.session(session);
  }
  const [a, ps] = await Promise.all([aq.lean(), pq.lean()]);
  if (!a) return null;
  return { activity: a, members: new Set([a.hostUserId, ...ps.map((p) => p.userId)]) };
}

async function isInPlanGroup(activityId, userId, opts) {
  const g = await planGroupMembers(activityId, opts);
  return !!(g && g.members.has(userId));
}

async function sharesAcceptedPlan(a, b, opts) {
  const [x, y] = await Promise.all([planGroupIds(a, opts), planGroupIds(b, opts)]);
  for (const id of x) if (y.has(id)) return true;
  return false;
}

async function sharesCircle(a, b, { session } = {}) {
  const { CircleMember } = require('../models');
  const q = CircleMember.distinct('circleId', { userId: a });
  if (session) q.session(session);
  const mine = await q;
  if (!mine.length) return false;
  const e = CircleMember.exists({ userId: b, circleId: { $in: mine } });
  if (session) e.session(session);
  return !!(await e);
}

module.exports = { IN_GROUP, planGroupIds, planGroupMembers, isInPlanGroup, sharesAcceptedPlan, sharesCircle };
