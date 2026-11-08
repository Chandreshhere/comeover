'use strict';
// Plan lifecycle: create/edit, join requests (capacity enforced atomically on the
// denormalised Activity.acceptedCount), host approval, waitlist promotion, cancel,
// check-in, mutual completion + XP, private feedback.
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult, assertCanAct, assertProfile } = require('../lib/auth');
const { withIdempotency } = require('../lib/idempotency');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const realtime = require('../lib/realtime');
const jobs = require('../lib/jobs');
const geo = require('../lib/geo');
const { awardXp } = require('../lib/xp');
const P = require('../lib/present');
const A = require('../services/activities');

const CHECKIN_RADIUS_M = 300;
const models = () => require('../models');

function publishJoin(after, activityId, userId, state, extra = {}) {
  after(async () => {
    const data = { activityId, userId, state, ...extra };
    await realtime.publish(`activity:${activityId}`, 'join.updated', data);
    await realtime.publish(`user:${userId}:notifications`, 'join.updated', data);
  });
}

function publishActivity(after, activityId, data) {
  after(() => realtime.publish(`activity:${activityId}`, 'activity.updated', { activityId, ...data }));
}

function publishMessage(after, msg) {
  if (msg) after(() => realtime.publish(`conversation:${msg.conversationId}`, 'message.created', msg));
}

async function loadActivity(id, session) {
  const { Activity } = models();
  const a = await Activity.findById(String(id)).session(session).lean();
  if (!a) throw err.notFound('activity_not_found');
  return a;
}

async function displayName(userId, session) {
  const { User } = models();
  const u = await User.findById(userId).select('profile.displayName').session(session || null).lean();
  return (u && u.profile && u.profile.displayName) || 'A member';
}

// Atomically take one seat. Returns the updated activity, or null when full / not joinable.
async function takeSeat(activityId, session, statuses = ['open', 'full', 'in_progress']) {
  const { Activity } = models();
  const a = await Activity.findOneAndUpdate(
    { _id: activityId, status: { $in: statuses }, $expr: { $lt: ['$acceptedCount', '$capacity'] } },
    { $inc: { acceptedCount: 1 } },
    { new: true, session }
  ).lean();
  if (a && a.acceptedCount >= a.capacity && a.status === 'open') {
    await Activity.updateOne({ _id: activityId }, { $set: { status: 'full' } }, { session });
    a.status = 'full';
  }
  return a;
}

// Give a seat back (cancel, removal, no-show) and reopen a full plan.
async function releaseSeat(activityId, session) {
  const { Activity } = models();
  const a = await Activity.findOneAndUpdate({ _id: activityId, acceptedCount: { $gt: 1 } }, { $inc: { acceptedCount: -1 } }, { new: true, session }).lean();
  if (a && a.status === 'full' && a.acceptedCount < a.capacity) await Activity.updateOne({ _id: activityId }, { $set: { status: 'open' } }, { session });
  return a;
}

// Promote the first waitlisted person when a spot frees up.
async function promoteWaitlist(session, after, activityId) {
  const { Activity, Participant } = models();
  const activity = await Activity.findById(activityId).session(session).lean();
  if (!activity || activity.acceptedCount >= activity.capacity) return null;
  const w = await Participant.findOne({ activityId, state: 'waitlisted' }).sort({ waitlistPosition: 1, requestedAt: 1 }).session(session).lean();
  if (!w) {
    if (activity.status === 'full') await Activity.updateOne({ _id: activityId }, { $set: { status: 'open' } }, { session });
    return null;
  }
  let next = activity.joinRule === 'instant' ? 'accepted' : 'requested';
  if (next === 'accepted' && !(await takeSeat(activityId, session))) next = 'requested';
  await Activity.updateOne({ _id: activityId, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
  await Participant.updateOne({ _id: w._id }, { $set: { state: next, waitlistPosition: null, ...(next === 'accepted' ? { decidedAt: new Date() } : {}) } }, { session });
  if (next === 'accepted') {
    const convId = await A.addToActivityConversation(activityId, w.userId, { session });
    await notify(session, after, w.userId, { type: 'join', title: "A spot opened — you're in", body: activity.title, data: { activityId, target: { screen: 'group_chat', params: { conversationId: convId } } } });
  } else {
    await notify(session, after, w.userId, { type: 'join', title: 'A spot opened up', body: `Your request for "${activity.title}" is now with the host.`, data: { activityId, target: { screen: 'activity_detail', params: { id: activityId } } } });
    await notify(session, after, activity.hostUserId, { type: 'join', title: 'New join request', body: activity.title, data: { activityId, target: { screen: 'activity_detail', params: { id: activityId, tab: 'requests' } } } });
  }
  publishJoin(after, activityId, w.userId, next);
  return w.userId;
}

// Mutual completion rule: host + ≥1 attendee confirmed, or ≥2 verified (proximity/host) check-ins.
async function maybeComplete(session, after, activity) {
  const { Activity, Participant, ReliabilityEvent } = models();
  const rows = await Participant.find({ activityId: activity._id, state: { $in: A.IN_GROUP_STATES } }).session(session).lean();
  const hostConfirmed = rows.some((r) => r.userId === activity.hostUserId && r.completionConfirmedAt);
  const guestConfirmed = rows.some((r) => r.userId !== activity.hostUserId && r.completionConfirmedAt);
  const verifiedCheckins = rows.filter((r) => ['proximity', 'host'].includes(r.checkInMethod)).length;
  const mutual = activity.status === 'completed' || (hostConfirmed && guestConfirmed) || verifiedCheckins >= 2;
  if (!mutual) return { mutual: false, awards: {} };

  const awards = {};
  const eligible = rows.filter((r) => r.completionConfirmedAt || ['proximity', 'host'].includes(r.checkInMethod));
  for (const r of eligible) {
    const total = { xp: 0 };
    const base = await awardXp(session, { userId: r.userId, eventType: 'activity_completed', refId: activity._id, activityId: activity._id });
    total.xp += base.xp;
    if (base.leveledUp) total.level = base.level;
    if (activity.category && r.state !== 'completed') {
      const doneIds = await Participant.distinct('activityId', { userId: r.userId, state: 'completed', activityId: { $ne: activity._id } }).session(session);
      const before = doneIds.length ? await Activity.exists({ _id: { $in: doneIds }, category: activity.category }).session(session) : null;
      if (!before) {
        const nc = await awardXp(session, { userId: r.userId, eventType: 'new_category_explored', refId: activity.category, activityId: activity._id });
        total.xp += nc.xp;
        if (nc.leveledUp) total.level = nc.level;
      }
    }
    if (r.userId === activity.hostUserId && !activity.cancelledAt) {
      const h = await awardXp(session, { userId: r.userId, eventType: 'hosted_completed', refId: activity._id, activityId: activity._id });
      total.xp += h.xp;
      if (h.leveledUp) total.level = h.level;
    }
    await Participant.updateOne({ _id: r._id }, { $set: { state: 'completed', completionConfirmedAt: r.completionConfirmedAt || new Date() } }, { session });
    await ReliabilityEvent.updateOne({ userId: r.userId, activityId: activity._id, kind: 'attended' }, { $setOnInsert: { userId: r.userId, activityId: activity._id, kind: 'attended' } }, { upsert: true, session });
    awards[r.userId] = total;
  }
  if (activity.status !== 'completed') {
    await Activity.updateOne({ _id: activity._id }, { $set: { status: 'completed', completedAt: new Date() } }, { session });
    publishActivity(after, activity._id, { status: 'completed' });
  }
  after(async () => {
    for (const userId of Object.keys(awards)) {
      await jobs.enqueue('quest_evaluate', { userId }, { dedupeKey: `qe:${userId}:${activity._id}` });
      await jobs.enqueue('reliability_recalc', { userId }, { dedupeKey: `rr:${userId}:${activity._id}` });
    }
  });
  return { mutual: true, awards };
}

// Progress for the completion response (services/progress is ported by the "me & progress" group).
async function progressFor(userId) {
  try {
    const S = require('../services/progress');
    const fn = S.progressFor;
    const out = fn.length >= 2 ? await fn(null, userId) : await fn(userId);
    const { _stats, ...progress } = out || {};
    return progress;
  } catch (e) {
    const { User } = models();
    const u = await User.findById(userId).select('progress').lean();
    const p = (u && u.progress) || {};
    return { xp: p.xpTotal || 0, level: { level: p.level || 1 } };
  }
}

const routes = {
  'POST /v1/activities': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'create');
    return withIdempotency(req, user.id, async () => {
      await enforce('create_plan', user.id);
      const { id } = await db.withTransaction((session) => A.createActivity(session, user, req.body, { ip: req.ip }));
      return created(await A.presentFresh(id, user.id));
    });
  },

  'PATCH /v1/activities/{activityId}': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        title: { type: 'string', min: 3, max: 80 },
        description: { type: 'string', max: 1000 },
        joinRule: { type: 'string', enum: ['approval', 'instant'] },
        venueName: { type: 'string', max: 120 },
        costNote: { type: 'string', max: 120 },
        cost: { type: 'string', max: 120 },
        tags: { type: 'array', max: 8, items: { type: 'string', max: 24 } },
        accessibility: { type: 'string', max: 300 },
      },
      req.body
    );
    if (req.body.capacity != null) {
      const cap = Number(req.body.capacity);
      if (!Number.isInteger(cap) || cap < 2 || cap > 30) throw err.badRequest('capacity_out_of_range', 'Groups can be 2–30 people');
      v.capacity = cap;
    }
    const { Activity } = models();
    await db.withTransaction(async (session, after) => {
      const a = await loadActivity(req.params.activityId, session);
      if (a.hostUserId !== user.id) throw err.forbidden('host_only');
      if (!['open', 'full', 'draft'].includes(a.status)) throw err.conflict('not_editable', 'This plan can no longer be edited');
      if (v.capacity != null && v.capacity < a.acceptedCount) throw err.conflict('capacity_below_joined', `${a.acceptedCount} people have already joined`);
      if (v.venueName && A.PRIVATE_VENUE_RE.test(v.venueName)) throw err.badRequest('private_venue_not_allowed', 'Plans must meet at a public venue or public area');
      const set = {};
      if (v.title != null) set.title = v.title;
      if (v.description != null) set.description = v.description;
      if (v.capacity != null) set.capacity = v.capacity;
      if (v.joinRule != null) set.joinRule = v.joinRule;
      if (v.venueName != null) set.venueName = v.venueName;
      if ((v.cost ?? v.costNote) != null) set.costNote = v.cost ?? v.costNote;
      if (v.tags != null) set.tags = v.tags;
      if (v.accessibility != null) set.accessibilityNotes = v.accessibility;
      if (v.capacity != null && ['open', 'full'].includes(a.status)) set.status = a.acceptedCount >= v.capacity ? 'full' : 'open';
      if (Object.keys(set).length) await Activity.updateOne({ _id: a._id }, { $set: set }, { session });
      if (v.capacity != null && a.acceptedCount < v.capacity) {
        // Fill newly opened seats from the waitlist.
        for (let i = 0; i < v.capacity - a.acceptedCount; i++) {
          if (!(await promoteWaitlist(session, after, a._id))) break;
        }
      }
      await audit({ actorUserId: user.id, action: 'activity.update', targetType: 'activity', targetId: a._id, metadata: Object.keys(v), ip: req.ip }, { session });
      publishActivity(after, a._id, { fields: Object.keys(v) });
    });
    return A.presentFresh(req.params.activityId, user.id);
  },

  'POST /v1/activities/{activityId}/join-requests': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'join');
    const { intro } = check({ intro: { type: 'string', max: 280 } }, req.body);
    return withIdempotency(req, user.id, async () => {
      await enforce('join_request', user.id);
      const result = await db.withTransaction(async (session, after) => {
        const { Activity, Participant } = models();
        const a = await A.getVisible(req.params.activityId, user.id, { session });
        if (!a) throw err.notFound('activity_not_found');
        if (a.hostUserId === user.id) throw err.conflict('own_plan', "You're hosting this plan");
        if (await A.blockedBetween(user.id, a.hostUserId, { session })) throw err.notFound('activity_not_found');
        if (!['open', 'full'].includes(a.status)) throw err.conflict('not_joinable', 'This plan is not taking requests');
        if (new Date(a.startsAt).getTime() < Date.now() - 15 * 60000) throw err.conflict('already_started', 'This plan has already started');

        const existing = await Participant.findOne({ activityId: a._id, userId: user.id }).session(session).lean();
        if (existing && ['requested', 'accepted', 'waitlisted', 'checked_in', 'completed'].includes(existing.state)) {
          return { requestId: existing._id, state: existing.state, waitlistPosition: existing.waitlistPosition ?? null, conversationId: null };
        }
        if (existing && existing.state === 'declined') throw err.conflict('declined', 'The host declined this request');
        if (existing && existing.state === 'no_show') throw err.conflict('not_joinable');

        let state;
        let waitlistPosition = null;
        let seat = null;
        if (a.joinRule === 'instant') {
          seat = await takeSeat(a._id, session, ['open', 'full']);
          if (seat) state = 'accepted';
        } else if (a.acceptedCount < a.capacity) {
          state = 'requested';
        }
        if (!state) {
          // Waitlist holds at most max(5, capacity) people; beyond that the plan is simply full.
          const w = await Activity.findOneAndUpdate(
            { _id: a._id, $expr: { $lt: ['$waitlistCount', { $max: [5, '$capacity'] }] } },
            { $inc: { waitlistCount: 1, nextWaitlistPosition: 1 } },
            { new: false, session }
          ).lean();
          if (!w) throw err.conflict('capacity_full', 'This plan and its waitlist are full');
          state = 'waitlisted';
          waitlistPosition = w.nextWaitlistPosition || 1;
        }
        const now = new Date();
        const fields = { state, intro: intro || null, waitlistPosition, requestedAt: now, decidedAt: state === 'accepted' ? now : null };
        let requestId;
        if (existing) {
          await Participant.updateOne({ _id: existing._id }, { $set: fields }, { session });
          requestId = existing._id;
        } else {
          const [p] = await Participant.create([{ activityId: a._id, userId: user.id, ...fields }], { session });
          requestId = p._id;
        }
        let conversationId = null;
        if (state === 'accepted') {
          conversationId = await A.addToActivityConversation(a._id, user.id, { session });
          publishMessage(after, await A.systemMessage(conversationId, `${user.displayName} joined the plan.`, { session }));
          await notify(session, after, a.hostUserId, { type: 'join', title: `${user.displayName} joined your plan`, body: a.title, data: { activityId: a._id, target: { screen: 'activity_detail', params: { id: a._id } } } });
        } else if (state === 'requested') {
          await notify(session, after, a.hostUserId, { type: 'join', title: `${user.displayName} wants to join`, body: a.title, data: { activityId: a._id, requestId, target: { screen: 'activity_detail', params: { id: a._id, tab: 'requests' } } } });
        }
        publishJoin(after, a._id, user.id, state, { requestId });
        return { requestId, state, waitlistPosition, conversationId };
      });
      return { ...result, activity: await A.presentFresh(req.params.activityId, user.id) };
    });
  },

  'GET /v1/activities/{activityId}/join-requests': async (req) => {
    const user = await requireUser(req);
    const { Activity, Participant, User } = models();
    const a = await Activity.findById(String(req.params.activityId)).select('hostUserId').lean();
    if (!a) throw err.notFound('activity_not_found');
    if (a.hostUserId !== user.id) throw err.forbidden('host_only');
    const rows = await Participant.find({ activityId: a._id, userId: { $ne: user.id }, state: { $in: ['requested', 'waitlisted', 'accepted', 'checked_in'] } }).lean();
    rows.sort((x, y) => (y.state === 'requested') - (x.state === 'requested') || new Date(x.requestedAt) - new Date(y.requestedAt));
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } })
      .select('profile progress availability')
      .lean();
    const byId = new Map(users.map((u) => [u._id, u]));
    const counts = await Participant.aggregate([{ $match: { userId: { $in: rows.map((r) => r.userId) }, state: 'completed' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
    const done = new Map(counts.map((c) => [c._id, c.n]));
    const items = await Promise.all(
      rows
        .filter((r) => byId.has(r.userId))
        .map(async (r) => {
          const u = byId.get(r.userId);
          return {
            id: r._id,
            userId: r.userId,
            user: await P.publicUser(u, { completed: done.get(r.userId) || 0, area: (u.profile && u.profile.homeArea) || undefined }),
            intro: r.intro,
            state: r.state,
            requestedAt: r.requestedAt,
            waitlistPosition: r.waitlistPosition ?? null,
          };
        })
    );
    return { items, nextCursor: null };
  },

  'DELETE /v1/activities/{activityId}/join-requests/me': async (req) => {
    const user = await requireUser(req);
    await db.withTransaction(async (session, after) => {
      const { Activity, Participant, ReliabilityEvent } = models();
      const a = await loadActivity(req.params.activityId, session);
      if (a.hostUserId === user.id) throw err.conflict('host_cannot_leave', 'Cancel the plan instead');
      const p = await Participant.findOne({ activityId: a._id, userId: user.id }).session(session).lean();
      if (!p || !A.ACTIVE_STATES.includes(p.state)) throw err.notFound('no_active_request');
      await Participant.updateOne({ _id: p._id }, { $set: { state: 'cancelled', waitlistPosition: null } }, { session });
      if (p.state === 'waitlisted') await Activity.updateOne({ _id: a._id, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
      if (['accepted', 'checked_in'].includes(p.state)) {
        await releaseSeat(a._id, session);
        await A.removeFromActivityConversation(a._id, user.id, { session });
        const convId = await A.groupConversationId(a._id, { session });
        publishMessage(after, await A.systemMessage(convId, `${user.displayName} can't make it anymore.`, { session }));
        if (new Date(a.startsAt).getTime() - Date.now() < 2 * 3600000) {
          await ReliabilityEvent.updateOne({ userId: user.id, activityId: a._id, kind: 'late_cancel' }, { $setOnInsert: { userId: user.id, activityId: a._id, kind: 'late_cancel' } }, { upsert: true, session });
        }
        await notify(session, after, a.hostUserId, { type: 'join', title: `${user.displayName} dropped out`, body: a.title, data: { activityId: a._id, target: { screen: 'activity_detail', params: { id: a._id } } } });
        await promoteWaitlist(session, after, a._id);
      }
      publishJoin(after, a._id, user.id, 'cancelled');
    });
    return { state: 'cancelled', activity: await A.presentFresh(req.params.activityId, user.id) };
  },

  'POST /v1/activities/{activityId}/join-requests/{requestId}/accept': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'host');
    return withIdempotency(req, user.id, async () =>
      db.withTransaction(async (session, after) => {
        const { Activity, Participant } = models();
        const a = await loadActivity(req.params.activityId, session);
        if (a.hostUserId !== user.id) throw err.forbidden('host_only');
        const p = await Participant.findOne({ _id: String(req.params.requestId), activityId: a._id }).session(session).lean();
        if (!p) throw err.notFound('request_not_found');
        if (p.state === 'accepted') return { requestId: p._id, state: 'accepted' };
        if (!['requested', 'waitlisted'].includes(p.state)) throw err.conflict('not_pending');
        if (await A.blockedBetween(user.id, p.userId, { session })) throw err.conflict('blocked');
        if (!(await takeSeat(a._id, session))) throw err.conflict('capacity_full', 'The plan is full — raise capacity or wait for a spot');
        if (p.state === 'waitlisted') await Activity.updateOne({ _id: a._id, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
        await Participant.updateOne({ _id: p._id }, { $set: { state: 'accepted', decidedAt: new Date(), decidedBy: user.id, waitlistPosition: null } }, { session });
        const convId = await A.addToActivityConversation(a._id, p.userId, { session });
        const who = await displayName(p.userId, session);
        publishMessage(after, await A.systemMessage(convId, `${user.displayName} accepted ${who}. The exact meeting spot is shared in this chat only.`, { session }));
        await notify(session, after, p.userId, { type: 'join', title: `${user.displayName} accepted your request`, body: `${a.title} — group chat is open.`, data: { activityId: a._id, target: { screen: 'group_chat', params: { conversationId: convId } } } });
        await audit({ actorUserId: user.id, action: 'join.accept', targetType: 'activity_participant', targetId: p._id, ip: req.ip }, { session });
        publishJoin(after, a._id, p.userId, 'accepted', { requestId: p._id, conversationId: convId });
        return { requestId: p._id, state: 'accepted', conversationId: convId };
      })
    );
  },

  'POST /v1/activities/{activityId}/join-requests/{requestId}/decline': async (req) => {
    const user = await requireUser(req);
    return db.withTransaction(async (session, after) => {
      const { Activity, Participant } = models();
      const a = await loadActivity(req.params.activityId, session);
      if (a.hostUserId !== user.id) throw err.forbidden('host_only');
      const p = await Participant.findOne({ _id: String(req.params.requestId), activityId: a._id }).session(session).lean();
      if (!p) throw err.notFound('request_not_found');
      if (!['requested', 'waitlisted'].includes(p.state)) throw err.conflict('not_pending');
      await Participant.updateOne({ _id: p._id }, { $set: { state: 'declined', decidedAt: new Date(), decidedBy: user.id, waitlistPosition: null } }, { session });
      if (p.state === 'waitlisted') await Activity.updateOne({ _id: a._id, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
      // Kind, non-specific copy — no reasons are shared.
      await notify(session, after, p.userId, { type: 'join', title: "This one didn't work out", body: `The host couldn't fit you into "${a.title}". Plenty more nearby.`, data: { activityId: a._id, target: { screen: 'discover_home', params: {} } } });
      publishJoin(after, a._id, p.userId, 'declined', { requestId: p._id });
      return { requestId: p._id, state: 'declined' };
    });
  },

  'POST /v1/activities/{activityId}/cancel': async (req) => {
    const user = await requireUser(req);
    const { reason } = check({ reason: { type: 'string', max: 280 } }, req.body);
    await db.withTransaction(async (session, after) => {
      const { Activity, Participant, ReliabilityEvent } = models();
      const a = await loadActivity(req.params.activityId, session);
      if (a.hostUserId !== user.id) throw err.forbidden('host_only', 'Only the host can cancel the plan. Use DELETE …/join-requests/me to leave.');
      if (['cancelled', 'completed', 'moderated'].includes(a.status)) throw err.conflict('not_cancellable');
      await Activity.updateOne({ _id: a._id }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null, acceptedCount: 1, waitlistCount: 0 } }, { session });
      const affected = await Participant.find({ activityId: a._id, userId: { $ne: user.id }, state: { $in: A.ACTIVE_STATES } }).select('userId').session(session).lean();
      await Participant.updateMany({ activityId: a._id, userId: { $ne: user.id }, state: { $in: A.ACTIVE_STATES } }, { $set: { state: 'cancelled', waitlistPosition: null } }, { session });
      if (new Date(a.startsAt).getTime() - Date.now() < 2 * 3600000 && affected.length) {
        await ReliabilityEvent.updateOne({ userId: user.id, activityId: a._id, kind: 'host_cancel' }, { $setOnInsert: { userId: user.id, activityId: a._id, kind: 'host_cancel' } }, { upsert: true, session });
      }
      const convId = await A.groupConversationId(a._id, { session });
      publishMessage(after, await A.systemMessage(convId, `${user.displayName} cancelled this plan${reason ? `: ${reason}` : '.'}`, { session }));
      for (const r of affected) {
        await notify(session, after, r.userId, { type: 'activity', title: 'Plan cancelled', body: `"${a.title}" was cancelled by the host.`, data: { activityId: a._id, target: { screen: 'activity_detail', params: { id: a._id } } } });
      }
      await audit({ actorUserId: user.id, action: 'activity.cancel', targetType: 'activity', targetId: a._id, metadata: { reason }, ip: req.ip }, { session });
      publishActivity(after, a._id, { status: 'cancelled' });
    });
    return A.presentFresh(req.params.activityId, user.id);
  },

  'POST /v1/activities/{activityId}/check-ins': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        method: { type: 'string', enum: ['proximity', 'manual', 'host'], default: 'manual' },
        lat: { type: 'number', min: -90, max: 90 },
        lng: { type: 'number', min: -180, max: 180 },
        userId: { type: 'string', format: 'uuid' },
      },
      req.body
    );
    return db.withTransaction(async (session, after) => {
      const { Activity, Participant } = models();
      const a = await loadActivity(req.params.activityId, session);
      const now = Date.now();
      if (now < new Date(a.startsAt).getTime() - 30 * 60000 || now > new Date(a.endsAt).getTime() + 30 * 60000) {
        throw err.conflict('checkin_window_closed', 'Check-in is open from 30 minutes before the start until 30 minutes after the end');
      }
      let target = user.id;
      if (v.method === 'host') {
        if (a.hostUserId !== user.id) throw err.forbidden('host_only');
        if (!v.userId) throw err.badRequest('user_required');
        target = v.userId;
      }
      if (v.method === 'proximity') {
        // Coordinates are used for this comparison only and never stored.
        if (a.latitude == null || !geo.withinMeters({ latitude: v.lat, longitude: v.lng }, { latitude: a.latitude, longitude: a.longitude }, CHECKIN_RADIUS_M)) {
          throw err.conflict('too_far', "You don't seem to be at the venue yet. Use manual check-in instead.");
        }
      }
      const p = await Participant.findOne({ activityId: a._id, userId: target, state: { $in: ['accepted', 'checked_in'] } }).session(session).lean();
      if (!p) throw err.forbidden('not_participant');
      await Participant.updateOne({ _id: p._id }, { $set: { state: 'checked_in', checkedInAt: p.checkedInAt || new Date(), checkInMethod: v.method } }, { session });
      if (['open', 'full'].includes(a.status) && new Date(a.startsAt).getTime() <= now) {
        await Activity.updateOne({ _id: a._id }, { $set: { status: 'in_progress' } }, { session });
        a.status = 'in_progress';
      }
      publishJoin(after, a._id, target, 'checked_in', { method: v.method });
      const c = await maybeComplete(session, after, a);
      return { checkedIn: true, method: v.method, verified: v.method !== 'manual', mutual: c.mutual };
    });
  },

  'POST /v1/activities/{activityId}/completion-confirmations': async (req) => {
    const user = await requireUser(req);
    return withIdempotency(req, user.id, async () => {
      const r = await db.withTransaction(async (session, after) => {
        const { Participant } = models();
        const a = await loadActivity(req.params.activityId, session);
        if (['cancelled', 'moderated'].includes(a.status)) throw err.conflict('not_completable');
        if (Date.now() < new Date(a.startsAt).getTime()) throw err.conflict('too_early', 'You can confirm once the plan has started');
        const p = await Participant.findOne({ activityId: a._id, userId: user.id, state: { $in: A.IN_GROUP_STATES } }).session(session).lean();
        if (!p) throw err.forbidden('not_participant');
        const duplicate = !!p.completionConfirmedAt;
        if (!duplicate) await Participant.updateOne({ _id: p._id }, { $set: { completionConfirmedAt: new Date() } }, { session });
        const c = await maybeComplete(session, after, a);
        const mine = c.awards[user.id] || { xp: 0 };
        return { state: c.mutual ? 'completed' : 'confirmed', xpAwarded: mine.xp, duplicate, pendingOthers: !c.mutual, leveledUp: !!mine.level, level: mine.level || null };
      });
      return { ...r, progress: await progressFor(user.id) };
    });
  },

  // Private: never shown raw to other users; feeds reliability + safety review.
  'POST /v1/activities/{activityId}/feedback': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        about: {
          type: 'array',
          required: true,
          min: 1,
          max: 30,
          items: { type: 'object', fields: { userId: { type: 'string', required: true, format: 'uuid' }, showedUp: { type: 'boolean' }, rating: { type: 'integer', min: 1, max: 5 }, note: { type: 'string', max: 500 } } },
        },
      },
      req.body
    );
    const activityId = String(req.params.activityId);
    await db.withTransaction(async (session, after) => {
      const { Participant, ActivityFeedback } = models();
      const rows = await Participant.find({ activityId, state: { $in: ['accepted', 'checked_in', 'completed', 'no_show'] } }).select('userId').session(session).lean();
      const members = new Set(rows.map((r) => r.userId));
      if (!members.has(user.id)) throw err.forbidden('not_participant');
      if (await ActivityFeedback.exists({ activityId, fromUserId: user.id }).session(session)) throw err.conflict('already_submitted', 'You already shared feedback for this plan');
      for (const f of v.about) {
        if (f.userId === user.id || !members.has(f.userId)) continue;
        await ActivityFeedback.updateOne(
          { activityId, fromUserId: user.id, aboutUserId: f.userId },
          { $set: { showedUp: f.showedUp ?? null, rating: f.rating ?? null, note: f.note || null } },
          { upsert: true, session }
        );
        after(() => jobs.enqueue('reliability_recalc', { userId: f.userId }, { dedupeKey: `rr:${f.userId}:fb:${activityId}` }));
      }
    });
    return { ok: true };
  },
};

module.exports = { routes, maybeComplete, promoteWaitlist, takeSeat, releaseSeat };
