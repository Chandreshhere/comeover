'use strict';
// Circles: recurring groups, members/roles, circle plans and group challenges.
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult, assertCanAct, assertProfile } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const geo = require('../lib/geo');
const { blockedByMe, blockedEither, isBlockedEither } = require('../services/safety');

const models = () => require('../models');
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Activity visibility + presentation (owned by the activities service) ----
// services/activities provides viewerScope/visibleFilter (who may see which plan)
// and presentMany (hydrated Activity models). If it can't be loaded, fall back
// to a minimal, privacy-safe presenter (no exact venue or coordinates).
function activitiesService() {
  try {
    const A = require('../services/activities');
    return typeof A.presentMany === 'function' && typeof A.visibleFilter === 'function' ? A : null;
  } catch (e) {
    return null;
  }
}

function fallbackActivity(a, { viewerId } = {}) {
  const isHost = a.hostUserId === viewerId;
  const loc = geo.presentLocation(a, { isHost, isAccepted: false });
  return {
    id: a._id,
    title: a.title,
    category: a.category,
    description: a.description || null,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    durationMin: Math.round((new Date(a.endsAt) - new Date(a.startsAt)) / 60000),
    capacity: a.capacity,
    joinedCount: a.acceptedCount || 1,
    participants: [],
    host: { id: a.hostUserId },
    area: a.coarseArea || null,
    venueName: isHost ? a.venueName || null : null,
    venueId: a.venueId || null,
    venueType: a.venueType || null,
    latitude: loc.latitude,
    longitude: loc.longitude,
    locationPrecision: loc.precision,
    joinRule: a.joinRule,
    visibility: a.visibility,
    status: a.status,
    circleId: a.circleId || null,
    hostedByMe: isHost,
    myJoinState: null,
  };
}

// Activity docs → Activity models (hosts that are suspended/deleted are dropped).
async function presentPlans(plans, viewerId) {
  const A = activitiesService();
  if (A) return A.presentMany(plans, viewerId);
  return plans.map((p) => fallbackActivity(p, { viewerId }));
}

// Upcoming plans of circles that this viewer may see (same rules as discovery:
// public, own, circle-only for members, joined; hosts not blocked either way).
async function upcomingPlans(circleIds, viewerId, memberOf, limit) {
  const { Activity } = models();
  if (!circleIds.length) return [];
  const base = { circleId: { $in: circleIds }, status: { $in: ['open', 'full'] }, endsAt: { $gt: new Date() } };
  const A = activitiesService();
  if (A) {
    const scope = await A.viewerScope(viewerId);
    return Activity.find({ $and: [base, A.visibleFilter(scope)] }).sort({ startsAt: 1 }).limit(limit).lean();
  }
  const either = [...(await blockedEither(viewerId))];
  const rows = await Activity.find({ ...base, ...(either.length ? { hostUserId: { $nin: either } } : {}) })
    .sort({ startsAt: 1 })
    .limit(limit)
    .lean();
  return rows.filter((a) => a.visibility === 'public' || a.hostUserId === viewerId || (a.visibility === 'circle' && memberOf.has(a.circleId)));
}

// Circle doc → Circle (with seeds, next plans, owner name and my role).
async function describeCircle(c, viewerId, myRole) {
  const { CircleMember, User, Activity } = models();
  const [seeds, owner, next] = await Promise.all([
    CircleMember.find({ circleId: c._id }).sort({ joinedAt: 1 }).limit(50).select('userId role joinedAt').lean(),
    User.findById(c.ownerUserId).select('profile.displayName').lean(),
    Activity.find({ circleId: c._id, status: { $in: ['open', 'full'] }, endsAt: { $gt: new Date() }, ...(myRole ? {} : { visibility: 'public' }) })
      .sort({ startsAt: 1 })
      .limit(5)
      .select('_id')
      .lean(),
  ]);
  // Owner first, then by join date.
  const ordered = seeds.sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || new Date(a.joinedAt) - new Date(b.joinedAt));
  return P.circle(c, {
    memberSeeds: ordered.slice(0, 6).map((m) => m.userId),
    nextPlanIds: next.map((a) => a._id),
    ownerName: (owner && owner.profile && owner.profile.displayName) || null,
    myRole: myRole || null,
  });
}

// Load an active circle the viewer may see (private → members only; blocked owner → hidden).
async function loadCircle(userId, circleId, { requireMember = false, session } = {}) {
  const { Circle, CircleMember } = models();
  const id = String(circleId);
  const cq = Circle.findOne({ _id: id, status: 'active' });
  const mq = CircleMember.findOne({ circleId: id, userId }).select('role');
  if (session) {
    cq.session(session);
    mq.session(session);
  }
  const [c, mine] = await Promise.all([cq.lean(), mq.lean()]);
  if (!c) throw err.notFound('circle_not_found');
  const myRole = mine ? mine.role : null;
  if (await isBlockedEither(userId, c.ownerUserId, { session })) throw err.notFound('circle_not_found');
  if (c.visibility === 'private' && !myRole) throw err.notFound('circle_not_found');
  if (requireMember && !myRole) throw err.forbidden('not_circle_member');
  return { c, myRole };
}

async function activeChallenge(userId, circleId) {
  const { CircleChallenge, ChallengeProgress, User } = models();
  const ch = await CircleChallenge.findOne({ circleId, endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).lean();
  if (!ch) return null;
  const blocked = [...(await blockedByMe(userId))];
  const [sum, mine, top] = await Promise.all([
    ChallengeProgress.aggregate([{ $match: { challengeId: ch._id } }, { $group: { _id: null, total: { $sum: '$count' } } }]),
    ChallengeProgress.findOne({ challengeId: ch._id, userId }).lean(),
    ChallengeProgress.find({ challengeId: ch._id, count: { $gt: 0 }, ...(blocked.length ? { userId: { $nin: blocked } } : {}) })
      .sort({ count: -1 })
      .limit(10)
      .lean(),
  ]);
  const names = top.length ? await User.find({ _id: { $in: top.map((t) => t.userId) } }).select('profile.displayName').lean() : [];
  const nameOf = new Map(names.map((u) => [u._id, u.profile ? u.profile.displayName : null]));
  const groupProgress = (sum[0] && sum[0].total) || 0;
  return {
    id: ch._id,
    title: ch.title,
    description: ch.description,
    goal: ch.targetCount,
    progress: Math.min(groupProgress, ch.targetCount),
    myProgress: (mine && mine.count) || 0,
    joined: !!mine,
    rewardXp: ch.xpReward,
    startsAt: ch.startsAt,
    endsAt: ch.endsAt,
    daysLeft: Math.max(0, Math.ceil((new Date(ch.endsAt) - Date.now()) / 86400000)),
    contributors: top.map((x) => ({ userId: x.userId, name: nameOf.get(x.userId) || null, count: x.count })),
  };
}

// Add (or re-activate) a member; keeps memberCount and the circle chat in step.
async function addMember(circleId, userId, session) {
  const { Circle, CircleMember, Conversation, ConversationMember } = models();
  const r = await CircleMember.updateOne({ circleId, userId }, { $setOnInsert: { circleId, userId, role: 'member', joinedAt: new Date() } }, { upsert: true, session });
  if (r.upsertedCount) await Circle.updateOne({ _id: circleId }, { $inc: { memberCount: 1 } }, { session });
  const conv = await Conversation.findOne({ kind: 'circle', circleId }).select('_id lastMessageAt').session(session).lean();
  if (conv) {
    await ConversationMember.updateOne(
      { conversationId: conv._id, userId },
      { $set: { leftAt: null }, $setOnInsert: { conversationId: conv._id, userId, joinedAt: new Date(), lastMessageAt: conv.lastMessageAt || null } },
      { upsert: true, session }
    );
  }
  return !!r.upsertedCount;
}

async function removeMember(circleId, userId, session) {
  const { Circle, CircleMember, Conversation, ConversationMember } = models();
  const r = await CircleMember.deleteOne({ circleId, userId }, { session });
  if (r.deletedCount) await Circle.updateOne({ _id: circleId, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } }, { session });
  const convIds = await Conversation.distinct('_id', { kind: 'circle', circleId }).session(session);
  if (convIds.length) await ConversationMember.updateMany({ conversationId: { $in: convIds }, userId }, { $set: { leftAt: new Date() } }, { session });
}

const routes = {
  'GET /v1/circles': async (req) => {
    const user = await requireUser(req);
    const q = check({ scope: { type: 'string', enum: ['all', 'joined', 'suggested', 'local'], default: 'all' }, area: { type: 'string', max: 60 }, q: { type: 'string', max: 60 } }, req.query);
    const page = pageParams(req.query);
    const { Circle, CircleMember, User } = models();
    const [me, mine, either] = await Promise.all([
      User.findById(user.id).select('profile.interests profile.homeArea').lean(),
      CircleMember.find({ userId: user.id }).select('circleId role').lean(),
      blockedEither(user.id),
    ]);
    const roleOf = new Map(mine.map((m) => [m.circleId, m.role]));
    const myIds = [...roleOf.keys()];
    const interests = (me && me.profile && me.profile.interests) || [];
    const homeArea = (me && me.profile && me.profile.homeArea) || '';
    const and = [{ status: 'active' }];
    if (either.size) and.push({ ownerUserId: { $nin: [...either] } });
    if (q.scope === 'joined') and.push({ _id: { $in: myIds } });
    else and.push({ $or: [{ visibility: 'public' }, { _id: { $in: myIds } }] });
    if (q.scope === 'suggested') and.push({ _id: { $nin: myIds } }, { $or: [{ categorySlug: { $in: interests } }, ...(homeArea ? [{ area: homeArea }] : [])] });
    if (q.scope === 'local') and.push({ area: { $regex: `^${escapeRe(q.area || homeArea || '')}$`, $options: 'i' } });
    if (q.q) and.push({ name: { $regex: escapeRe(q.q), $options: 'i' } });
    const rows = await Circle.aggregate([
      { $match: { $and: and } },
      { $addFields: { _joined: { $in: ['$_id', myIds] } } },
      { $sort: { _joined: -1, memberCount: -1, createdAt: -1, _id: 1 } },
      { $skip: page.offset },
      { $limit: page.fetchLimit },
    ]);
    const visible = rows.slice(0, page.limit);
    const memberOf = new Set(myIds);
    const plans = await upcomingPlans(
      visible.map((c) => c._id),
      user.id,
      memberOf,
      100
    );
    const presented = await presentPlans(plans, user.id);
    return pageOf(rows, page, async (c) => ({
      ...(await describeCircle(c, user.id, roleOf.get(c._id))),
      upcomingPlans: presented.filter((p) => p.circleId === c._id).slice(0, 3),
    }));
  },

  'POST /v1/circles': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'circle_create');
    const v = check(
      {
        name: { type: 'string', required: true, min: 3, max: 60 },
        description: { type: 'string', max: 500 },
        visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
        area: { type: 'string', max: 60 },
        category: { type: 'string', format: 'slug' },
        pictogram: { type: 'string', max: 30 },
        rules: { type: 'array', max: 10, items: { type: 'string', max: 140 }, default: () => [] },
      },
      req.body
    );
    await enforce('circle_create', user.id);
    const { Circle, CircleMember, Conversation, ConversationMember, Category } = models();
    const cat = v.category ? await Category.findOne({ slug: v.category }).select('pictogram').lean() : null;
    const id = await db.withTransaction(async (session) => {
      const [c] = await Circle.create(
        [
          {
            ownerUserId: user.id,
            name: v.name,
            description: v.description || null,
            visibility: v.visibility,
            area: v.area || null,
            categorySlug: v.category || null,
            pictogram: v.pictogram || (cat && cat.pictogram) || 'people',
            rules: v.rules,
            memberCount: 1,
          },
        ],
        { session }
      );
      await CircleMember.create([{ circleId: c._id, userId: user.id, role: 'owner' }], { session });
      const [conv] = await Conversation.create([{ kind: 'circle', circleId: c._id }], { session });
      await ConversationMember.create([{ conversationId: conv._id, userId: user.id }], { session });
      await audit({ actorUserId: user.id, action: 'circle.create', targetType: 'circle', targetId: c._id, ip: req.ip }, { session });
      return c._id;
    });
    const { c, myRole } = await loadCircle(user.id, id);
    return created(await describeCircle(c, user.id, myRole));
  },

  'GET /v1/circles/{circleId}': async (req) => {
    const user = await requireUser(req);
    const { Conversation } = models();
    const { c, myRole } = await loadCircle(user.id, req.params.circleId);
    const plans = await upcomingPlans([c._id], user.id, new Set(myRole ? [c._id] : []), 10);
    const conv = myRole ? await Conversation.findOne({ kind: 'circle', circleId: c._id }).select('_id').lean() : null;
    return {
      ...(await describeCircle(c, user.id, myRole)),
      upcomingPlans: await presentPlans(plans, user.id),
      challenge: await activeChallenge(user.id, c._id),
      conversationId: conv ? conv._id : null,
    };
  },

  'POST /v1/circles/{circleId}/members': async (req) => {
    const user = await requireUser(req);
    assertAdult(user);
    const v = check({ userId: { type: 'string', format: 'uuid' } }, req.body);
    const { Circle, CircleMember } = models();
    const c = await Circle.findOne({ _id: String(req.params.circleId), status: 'active' }).select('name visibility ownerUserId').lean();
    if (!c) throw err.notFound('circle_not_found');
    const mine = await CircleMember.findOne({ circleId: c._id, userId: user.id }).select('role').lean();
    const myRole = mine && mine.role;
    const target = v.userId && v.userId !== user.id ? v.userId : user.id;
    if (target === user.id) {
      if (c.visibility === 'private' && !myRole) throw err.forbidden('invite_only', 'This circle is invite-only');
    } else if (!['owner', 'moderator'].includes(myRole)) {
      throw err.forbidden('owner_or_moderator_only');
    }
    if (await isBlockedEither(target, c.ownerUserId)) throw err.forbidden('blocked');
    await db.withTransaction(async (session, after) => {
      await addMember(c._id, target, session);
      if (target !== user.id) {
        await notify(session, after, target, {
          type: 'activity',
          title: `You were added to ${c.name}`,
          body: 'Say hi in the circle chat.',
          data: { circleId: c._id, target: { screen: 'circle_detail', params: { id: c._id } } },
        });
        await audit({ actorUserId: user.id, action: 'circle.member_add', targetType: 'circle', targetId: c._id, metadata: { userId: target }, ip: req.ip }, { session });
      }
    });
    const r = await loadCircle(user.id, c._id);
    return describeCircle(r.c, user.id, r.myRole);
  },

  'GET /v1/circles/{circleId}/members': async (req) => {
    const user = await requireUser(req);
    const { CircleMember, Participant } = models();
    const { c } = await loadCircle(user.id, req.params.circleId);
    const page = pageParams(req.query, { def: 50, max: 100 });
    const blocked = [...(await blockedByMe(user.id))];
    const rows = await CircleMember.aggregate([
      { $match: { circleId: c._id, ...(blocked.length ? { userId: { $nin: blocked } } : {}) } },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u', pipeline: [{ $project: { status: 1, profile: 1, progress: 1, availability: 1 } }] } },
      { $unwind: '$u' },
      { $match: { 'u.status': { $in: ['active', 'limited'] }, 'u.profile': { $ne: null } } },
      { $addFields: { _rank: { $switch: { branches: [{ case: { $eq: ['$role', 'owner'] }, then: 0 }, { case: { $eq: ['$role', 'moderator'] }, then: 1 }], default: 2 } } } },
      { $sort: { _rank: 1, joinedAt: 1, _id: 1 } },
      { $skip: page.offset },
      { $limit: page.fetchLimit },
    ]);
    const ids = rows.slice(0, page.limit).map((r) => r.userId);
    const counts = ids.length ? await Participant.aggregate([{ $match: { userId: { $in: ids }, state: 'completed' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]) : [];
    const completedOf = new Map(counts.map((x) => [x._id, x.n]));
    // PublicUser + role (avatarUrl is part of PublicUser).
    return pageOf(rows, page, async (r) => ({ ...(await P.publicUser(r.u, { completed: completedOf.get(r.userId) || 0 })), role: r.role, joinedAt: r.joinedAt }));
  },

  'DELETE /v1/circles/{circleId}/members/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { CircleMember } = models();
    const circleId = String(req.params.circleId);
    const m = await CircleMember.findOne({ circleId, userId: user.id }).select('role').lean();
    if (!m) throw err.notFound('not_circle_member');
    if (m.role === 'owner') throw err.conflict('owner_must_transfer', 'Make someone else owner before leaving');
    await db.withTransaction((session) => removeMember(circleId, user.id, session));
    return { ok: true };
  },

  'DELETE /v1/circles/{circleId}/members/{userId}': async (req) => {
    const user = await requireUser(req);
    const { CircleMember } = models();
    const circleId = String(req.params.circleId);
    const targetId = String(req.params.userId);
    const [mine, theirs] = await Promise.all([
      CircleMember.findOne({ circleId, userId: user.id }).select('role').lean(),
      CircleMember.findOne({ circleId, userId: targetId }).select('role').lean(),
    ]);
    if (!mine || !['owner', 'moderator'].includes(mine.role)) throw err.forbidden('owner_or_moderator_only');
    if (!theirs) throw err.notFound('member_not_found');
    if (theirs.role === 'owner' || (theirs.role === 'moderator' && mine.role !== 'owner')) throw err.forbidden('cannot_remove_role');
    await db.withTransaction(async (session) => {
      await removeMember(circleId, targetId, session);
      await audit({ actorUserId: user.id, action: 'circle.member_remove', targetType: 'circle', targetId: circleId, metadata: { userId: targetId }, ip: req.ip }, { session });
    });
    return { ok: true };
  },

  // Same body/response as POST /v1/activities; created through the activities module.
  'POST /v1/circles/{circleId}/plans': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'create');
    const { c } = await loadCircle(user.id, req.params.circleId, { requireMember: true });
    let create = null;
    try {
      const activities = require('./activities');
      create = activities.routes && activities.routes['POST /v1/activities'];
    } catch (e) {
      create = null;
    }
    if (typeof create !== 'function') throw err.unavailable('activities_unavailable', 'Plans are not available right now.');
    const visibility = req.body && req.body.visibility === 'public' ? 'public' : 'circle';
    return create({ ...req, user, routeKey: 'POST /v1/activities', body: { ...(req.body || {}), circleId: c._id, visibility } });
  },

  'GET /v1/circles/{circleId}/challenge': async (req) => {
    const user = await requireUser(req);
    const { c } = await loadCircle(user.id, req.params.circleId);
    return { challenge: await activeChallenge(user.id, c._id) };
  },

  'POST /v1/circles/{circleId}/challenge/join': async (req) => {
    const user = await requireUser(req);
    const { CircleChallenge, ChallengeProgress } = models();
    const { c } = await loadCircle(user.id, req.params.circleId, { requireMember: true });
    const ch = await CircleChallenge.findOne({ circleId: c._id, endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).select('_id').lean();
    if (!ch) throw err.notFound('no_active_challenge');
    await ChallengeProgress.updateOne({ challengeId: ch._id, userId: user.id }, { $setOnInsert: { challengeId: ch._id, userId: user.id, count: 0 } }, { upsert: true });
    return { challenge: await activeChallenge(user.id, c._id) };
  },
};

module.exports = { routes, loadCircle, activeChallenge, addMember, removeMember };
