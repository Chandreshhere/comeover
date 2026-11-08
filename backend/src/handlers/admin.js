'use strict';
// Admin web API (/v1/admin/*). Authorised by user roles (lib/auth.requireAdmin):
//   admin     → everything
//   moderator → reports, activities, users, audit
// Every state-changing call writes an AuditEvent (actorAdminId = the admin's
// User id) with the written reason. GET /v1/admin/me lives in handlers/auth.js.
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { pageParams, pageOf } = require('../lib/page');
const media = require('../lib/media');
const realtime = require('../lib/realtime');
const tokens = require('../lib/tokens');

const RANGE_DAYS = { '7d': 7, '30d': 30 };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const IN_GROUP = ['accepted', 'checked_in', 'completed'];
const ACCEPTED_LIKE = ['accepted', 'checked_in', 'completed', 'no_show'];
const QUEST_CRITERIA = ['complete_activities', 'new_people', 'new_category', 'host_completed', 'early_activity', 'late_activity', 'category_completed', 'distinct_categories', 'reliability'];
const REASON = { type: 'string', required: true, min: 3, max: 1000 };

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round(n * 100) / 100;

// id → { id, name, status, phone, createdAt }
async function usersById(ids) {
  const { User } = require('../models');
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await User.find({ _id: { $in: list } }).select('status phone createdAt profile.displayName').lean();
  return new Map(rows.map((u) => [u._id, { id: u._id, name: (u.profile && u.profile.displayName) || null, status: u.status, phone: u.phone, createdAt: u.createdAt }]));
}

const brief = (map, id, withStatus = false) => {
  if (!id) return null;
  const u = map.get(id);
  return withStatus ? { id, name: u ? u.name : null, status: u ? u.status : null } : { id, name: u ? u.name : null };
};

const actorOf = (a, admins) =>
  a.actorAdminId
    ? { type: 'admin', id: a.actorAdminId, name: (admins.get(a.actorAdminId) || {}).name || null, email: null }
    : a.actorUserId
      ? { type: 'user', id: a.actorUserId }
      : { type: 'system' };

// Change an app user's status (inside a transaction).
async function setUserStatus(session, after, adminId, userId, status, reason, durationDays, ip) {
  const { User, Activity } = require('../models');
  const until = durationDays ? new Date(Date.now() + durationDays * 86400000) : null;
  const $set = { status, statusReason: reason, statusUntil: until };
  if (status !== 'active') $set['availability.status'] = 'busy';
  const res = await User.updateOne({ _id: String(userId), status: { $ne: 'deleted' } }, { $set }, { session });
  if (!res.matchedCount) throw err.notFound('user_not_found');
  if (status === 'suspended') {
    await Activity.updateMany(
      { hostUserId: String(userId), status: { $in: ['open', 'full'] } },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'host_suspended' } },
      { session }
    );
    // Sign the user out everywhere (refresh tokens revoked; access tokens expire within 15 min
    // and requireUser re-reads the suspended status on every request).
    after(() => tokens.revokeAllForUser(String(userId), 'suspended'));
  }
  await notify(session, after, String(userId), {
    type: 'safety',
    title: status === 'active' ? 'Your account is fully restored' : status === 'limited' ? 'Some actions are paused on your account' : 'Your account is suspended',
    body: status === 'active' ? 'Thanks for your patience.' : 'See Safety → Case status for details and how to appeal.',
    data: { target: { screen: 'safety_center', params: { tab: 'case' } } },
  });
  await audit({ actorAdminId: adminId, action: `user.status.${status}`, targetType: 'user', targetId: userId, metadata: { reason, durationDays: durationDays || null }, ip }, { session });
}

async function reportDetail(req, admin) {
  const { Report, ReportAction, Appeal, Message, Activity } = require('../models');
  const r = await Report.findById(String(req.params.reportId)).lean();
  if (!r) throw err.notFound('report_not_found');
  const reportedMsg = r.messageId ? await Message.findById(r.messageId).select('conversationId createdAt').lean() : null;
  const [people, activity, actions, appeals, context, history] = await Promise.all([
    usersById([r.reporterUserId, r.reportedUserId]),
    r.activityId ? Activity.findById(r.activityId).select('title status venueName coarseArea').lean() : null,
    ReportAction.find({ reportId: r._id }).sort({ createdAt: 1 }).lean(),
    Appeal.find({ reportId: r._id }).sort({ createdAt: 1 }).lean(),
    reportedMsg
      ? Message.find({
          conversationId: reportedMsg.conversationId,
          createdAt: { $gte: new Date(reportedMsg.createdAt.getTime() - 30 * 60000), $lte: new Date(reportedMsg.createdAt.getTime() + 30 * 60000) },
        })
          .sort({ createdAt: 1 })
          .limit(30)
          .lean()
      : [],
    r.reportedUserId ? Report.find({ reportedUserId: r.reportedUserId, _id: { $ne: r._id } }).sort({ createdAt: -1 }).limit(20).select('reasonCode status createdAt').lean() : [],
  ]);
  const admins = await usersById(actions.map((a) => a.adminId));
  const evidence = await Promise.all((r.evidenceKeys || []).map(async (key) => ({ key, url: await media.signedGet(key, 300).catch(() => null) })));
  if (evidence.length) await audit({ actorAdminId: admin.id, action: 'report.evidence_viewed', targetType: 'report', targetId: r._id, metadata: { count: evidence.length }, ip: req.ip });
  let status = r.status;
  if (r.status === 'open') {
    await Report.updateOne({ _id: r._id, status: 'open' }, { $set: { status: 'reviewing' } });
    await Report.updateOne({ _id: r._id, assignedAdminId: null }, { $set: { assignedAdminId: admin.id } });
    await audit({ actorAdminId: admin.id, action: 'report.review_started', targetType: 'report', targetId: r._id, ip: req.ip });
    status = 'reviewing';
  }
  const reported = r.reportedUserId ? people.get(r.reportedUserId) : null;
  return {
    id: r._id,
    reasonCode: r.reasonCode,
    details: r.details || null,
    status,
    priority: r.priority,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt || null,
    reporter: brief(people, r.reporterUserId),
    reported: r.reportedUserId ? { id: r.reportedUserId, name: reported ? reported.name : null, status: reported ? reported.status : null, memberSince: reported ? reported.createdAt : null } : null,
    activity: activity ? { id: activity._id, title: activity.title, status: activity.status, venueName: activity.venueName || null, area: activity.coarseArea || null } : null,
    messageId: r.messageId || null,
    messageContext: context.map((m) => ({
      id: m._id,
      senderId: m.kind === 'system' ? 'system' : m.senderUserId,
      body: m.body,
      deleted: !!m.deletedAt,
      createdAt: m.createdAt,
      reported: m._id === r.messageId,
    })),
    evidence,
    actions: actions.map((a) => ({ id: a._id, action: a.action, notes: a.notes || null, durationDays: a.durationDays || null, admin: (admins.get(a.adminId) || {}).name || null, adminId: a.adminId || null, createdAt: a.createdAt })),
    appeals: appeals.map((a) => ({ id: a._id, statement: a.statement, status: a.status, createdAt: a.createdAt, decidedAt: a.decidedAt || null })),
    otherReportsAgainstUser: history.map((h) => ({ id: h._id, reasonCode: h.reasonCode, status: h.status, createdAt: h.createdAt })),
  };
}

// IST calendar day strings for the last `days` days (oldest first).
function istDays(days) {
  const nowIst = new Date(Date.now() + 330 * 60000);
  const end = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate());
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
}

const presentCategory = (c, activityCount) => ({
  slug: c.slug,
  label: c.label,
  short: c.short || c.label,
  pictogram: c.pictogram || 'sparkle',
  riskLevel: c.riskLevel || 'standard',
  active: c.isActive !== false,
  sortOrder: c.sortOrder,
  ...(activityCount !== undefined ? { activityCount } : {}),
});

const presentArea = (a) => ({
  id: a._id,
  city: a.city,
  name: a.name,
  active: a.active !== false,
  latitude: a.centroid && a.centroid.coordinates ? a.centroid.coordinates[1] : null,
  longitude: a.centroid && a.centroid.coordinates ? a.centroid.coordinates[0] : null,
});

const presentQuest = (q, claims) => ({
  id: q._id,
  slug: q.slug,
  kind: q.kind,
  title: q.title,
  description: q.description,
  pictogram: q.pictogram || 'sparkle',
  criteria: q.criteria,
  xpReward: q.xpReward,
  active: q.active !== false,
  startsAt: q.startsAt || null,
  endsAt: q.endsAt || null,
  ...(claims !== undefined ? { claims } : {}),
});

const routes = {
  'GET /v1/admin/kpis': async (req) => {
    const { User, Activity, Participant, Report, Entitlement } = require('../models');
    await requireAdmin(req, 'admin');
    const { range } = check({ range: { type: 'string', enum: ['7d', '30d'], default: '7d' } }, req.query);
    const days = RANGE_DAYS[range];
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const dayList = istDays(days);
    const seriesFrom = new Date(Date.parse(`${dayList[0]}T00:00:00Z`) - 330 * 60000);
    const istDate = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'Asia/Kolkata' } });

    // Non-host participants joined with their activity (host may or may not have a Participant row).
    const withActivity = (match) => [
      { $match: match },
      { $lookup: { from: 'activities', localField: 'activityId', foreignField: '_id', as: 'a', pipeline: [{ $project: { hostUserId: 1, status: 1, endsAt: 1, createdAt: 1 } }] } },
      { $unwind: '$a' },
      { $match: { $expr: { $ne: ['$userId', '$a.hostUserId'] } } },
    ];

    const [users, acts, joins, show, firstAccepts, safety, revenue, signupSeries, completedSeries] = await Promise.all([
      User.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: { $cond: [{ $ne: ['$status', 'deleted'] }, 1, 0] } },
            new: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
            active: { $sum: { $cond: [{ $gte: ['$lastActiveAt', since] }, 1, 0] } },
          },
        },
      ]),
      Activity.aggregate([
        {
          $group: {
            _id: null,
            created: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $gte: ['$completedAt', since] }] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $gte: ['$cancelledAt', since] }] }, 1, 0] } },
          },
        },
      ]),
      Participant.aggregate([
        ...withActivity({ requestedAt: { $gte: since } }),
        { $group: { _id: null, requests: { $sum: 1 }, accepted: { $sum: { $cond: [{ $in: ['$state', ACCEPTED_LIKE] }, 1, 0] } } } },
      ]),
      Participant.aggregate([
        { $lookup: { from: 'activities', localField: 'activityId', foreignField: '_id', as: 'a', pipeline: [{ $project: { hostUserId: 1, status: 1, endsAt: 1 } }] } },
        { $unwind: '$a' },
        { $match: { 'a.endsAt': { $gte: since, $lte: now }, $expr: { $ne: ['$userId', '$a.hostUserId'] } } },
        {
          $group: {
            _id: null,
            showed: { $sum: { $cond: [{ $or: [{ $ne: [{ $ifNull: ['$checkInMethod', null] }, null] }, { $eq: ['$state', 'completed'] }] }, 1, 0] } },
            accepted: { $sum: { $cond: [{ $in: ['$state', ACCEPTED_LIKE] }, 1, 0] } },
            plans: { $addToSet: '$a._id' },
            completedPlans: { $addToSet: { $cond: [{ $eq: ['$a.status', 'completed'] }, '$a._id', null] } },
          },
        },
        { $project: { showed: 1, accepted: 1, plans: { $size: '$plans' }, completedPlans: { $size: { $setDifference: ['$completedPlans', [null]] } } } },
      ]),
      // Liquidity: minutes from publish to the first accepted non-host participant.
      Participant.aggregate([
        ...withActivity({ state: { $in: IN_GROUP }, decidedAt: { $ne: null } }),
        { $match: { 'a.createdAt': { $gte: since } } },
        { $group: { _id: '$activityId', firstAccept: { $min: '$decidedAt' }, createdAt: { $first: '$a.createdAt' } } },
        { $project: { minutes: { $divide: [{ $subtract: ['$firstAccept', '$createdAt'] }, 60000] } } },
        { $sort: { minutes: 1 } },
      ]),
      Report.aggregate([
        {
          $group: {
            _id: null,
            open: { $sum: { $cond: [{ $in: ['$status', ['open', 'reviewing', 'appealed']] }, 1, 0] } },
            urgent: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['open', 'reviewing']] }, { $eq: ['$priority', 'urgent'] }] }, 1, 0] } },
            substantiated: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'actioned'] }, { $gte: ['$resolvedAt', since] }] }, 1, 0] } },
          },
        },
      ]),
      Entitlement.aggregate([
        { $match: { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] } },
        {
          $group: {
            _id: null,
            subscriptions: { $sum: { $cond: [{ $in: ['$entitlement', ['plus', 'pro']] }, 1, 0] } },
            venue: { $sum: { $cond: [{ $eq: ['$entitlement', 'venue'] }, 1, 0] } },
          },
        },
      ]),
      User.aggregate([{ $match: { createdAt: { $gte: seriesFrom } } }, { $group: { _id: istDate('$createdAt'), n: { $sum: 1 } } }]),
      Activity.aggregate([{ $match: { completedAt: { $gte: seriesFrom } } }, { $group: { _id: istDate('$completedAt'), n: { $sum: 1 } } }]),
    ]);

    const u = users[0] || { total: 0, new: 0, active: 0 };
    const a = acts[0] || { created: 0, completed: 0, cancelled: 0 };
    const j = joins[0] || { requests: 0, accepted: 0 };
    const s = show[0] || { showed: 0, accepted: 0, plans: 0, completedPlans: 0 };
    const sf = safety[0] || { open: 0, urgent: 0, substantiated: 0 };
    const rv = revenue[0] || { subscriptions: 0, venue: 0 };
    const mins = firstAccepts.map((x) => x.minutes).filter((x) => Number.isFinite(x));
    let median = null;
    if (mins.length) {
      const mid = Math.floor(mins.length / 2);
      median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
    }
    const signups = new Map(signupSeries.map((x) => [x._id, x.n]));
    const completedByDay = new Map(completedSeries.map((x) => [x._id, x.n]));
    return {
      range,
      users: { total: u.total, new: u.new, active: u.active },
      activities: { created: a.created, completed: a.completed, cancelled: a.cancelled },
      joins: { requests: j.requests, accepted: j.accepted, conversion: j.requests ? round2(j.accepted / j.requests) : null },
      showUpRate: s.accepted ? round2(s.showed / s.accepted) : null,
      completionRate: s.plans ? round2(s.completedPlans / s.plans) : null,
      medianMinutesToFirstAccept: median != null ? Math.round(median) : null,
      completedPerActiveUser: u.active ? round2(a.completed / u.active) : null,
      safety: { openReports: sf.open, urgentOpen: sf.urgent, substantiatedPer1000Meetups: a.completed ? Math.round((sf.substantiated / a.completed) * 1000 * 10) / 10 : null },
      revenue: { activeSubscriptions: rv.subscriptions, venuePlans: rv.venue },
      series: dayList.map((day) => ({ day, signups: signups.get(day) || 0, completed: completedByDay.get(day) || 0 })),
    };
  },

  'GET /v1/admin/reports': async (req) => {
    const { Report, Activity, Message } = require('../models');
    await requireAdmin(req, 'moderator');
    const q = check({ status: { type: 'string', enum: ['open', 'reviewing', 'actioned', 'dismissed', 'appealed', 'queue'], default: 'queue' } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    const statuses = q.status === 'queue' ? ['open', 'reviewing', 'appealed'] : [q.status];
    const rows = await Report.aggregate([
      { $match: { status: { $in: statuses } } },
      {
        $addFields: {
          _prio: { $switch: { branches: Object.entries(PRIORITY_RANK).map(([k, v]) => ({ case: { $eq: ['$priority', k] }, then: v })), default: 3 } },
        },
      },
      { $sort: { _prio: 1, createdAt: 1, _id: 1 } },
      { $skip: page.offset },
      { $limit: page.fetchLimit },
    ]);
    const reportedIds = [...new Set(rows.map((r) => r.reportedUserId).filter(Boolean))];
    const [people, acts, msgs, counts] = await Promise.all([
      usersById(rows.flatMap((r) => [r.reporterUserId, r.reportedUserId])),
      Activity.find({ _id: { $in: rows.map((r) => r.activityId).filter(Boolean) } }).select('title').lean(),
      Message.find({ _id: { $in: rows.map((r) => r.messageId).filter(Boolean) } }).select('body').lean(),
      reportedIds.length ? Report.aggregate([{ $match: { reportedUserId: { $in: reportedIds } } }, { $group: { _id: '$reportedUserId', n: { $sum: 1 } } }]) : [],
    ]);
    const actById = new Map(acts.map((a) => [a._id, a]));
    const msgById = new Map(msgs.map((m) => [m._id, m]));
    const countBy = new Map(counts.map((c) => [c._id, c.n]));
    return pageOf(rows, page, (r) => ({
      id: r._id,
      reasonCode: r.reasonCode,
      status: r.status,
      priority: r.priority,
      createdAt: r.createdAt,
      reporter: brief(people, r.reporterUserId),
      reported: brief(people, r.reportedUserId, true),
      activity: r.activityId ? { id: r.activityId, title: (actById.get(r.activityId) || {}).title || null } : null,
      messageSnippet: r.messageId && msgById.get(r.messageId) ? String(msgById.get(r.messageId).body || '').slice(0, 160) : null,
      priorReports: r.reportedUserId ? Math.max(0, (countBy.get(r.reportedUserId) || 1) - 1) : 0,
    }));
  },

  'GET /v1/admin/reports/{reportId}': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    return reportDetail(req, admin);
  },

  'POST /v1/admin/reports/{reportId}/actions': async (req) => {
    const { Report, ReportAction, Message, Activity, User } = require('../models');
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ action: { type: 'string', required: true, enum: ['warn', 'limit', 'suspend', 'remove_content', 'dismiss'] }, reason: REASON, durationDays: { type: 'integer', min: 1, max: 365 } }, req.body);
    await db.withTransaction(async (session, after) => {
      const r = await Report.findById(String(req.params.reportId)).session(session).lean();
      if (!r) throw err.notFound('report_not_found');
      if (['warn', 'limit', 'suspend'].includes(v.action) && !r.reportedUserId) throw err.badRequest('no_reported_user');
      await ReportAction.create([{ reportId: r._id, adminId: admin.id, action: v.action, notes: v.reason, durationDays: v.durationDays || null }], { session });
      switch (v.action) {
        case 'warn':
          await notify(session, after, r.reportedUserId, {
            type: 'safety',
            title: 'A note from the safety team',
            body: 'A report about you was reviewed. Please follow the community rules — repeated issues can limit your account.',
            data: { target: { screen: 'safety_center', params: { tab: 'case' } } },
          });
          break;
        case 'limit':
          await setUserStatus(session, after, admin.id, r.reportedUserId, 'limited', v.reason, v.durationDays, req.ip);
          break;
        case 'suspend':
          await setUserStatus(session, after, admin.id, r.reportedUserId, 'suspended', v.reason, v.durationDays, req.ip);
          break;
        case 'remove_content':
          if (r.messageId) {
            await Message.updateOne({ _id: r.messageId }, { $set: { deletedAt: new Date() } }, { session });
          } else if (r.activityId) {
            await Activity.updateOne({ _id: r.activityId }, { $set: { status: 'moderated', moderationNote: v.reason, 'review.status': 'removed', 'review.reviewedBy': admin.id, 'review.reviewedAt': new Date() } }, { session });
            after(() => realtime.publish(`activity:${r.activityId}`, 'activity.updated', { activityId: r.activityId, status: 'moderated' }));
          } else if (r.reportedUserId) {
            await User.updateOne({ _id: r.reportedUserId, profile: { $ne: null } }, { $set: { 'profile.bio': null, 'profile.avatarKey': null, 'profile.updatedAt': new Date() } }, { session });
          }
          break;
        default:
          break;
      }
      await Report.updateOne({ _id: r._id }, { $set: { status: v.action === 'dismiss' ? 'dismissed' : 'actioned', resolvedAt: new Date() } }, { session });
      await audit(
        { actorAdminId: admin.id, action: `report.${v.action}`, targetType: 'report', targetId: r._id, metadata: { reason: v.reason, durationDays: v.durationDays || null, reportedUserId: r.reportedUserId || null }, ip: req.ip },
        { session }
      );
    });
    return reportDetail(req, admin);
  },

  'POST /v1/admin/reports/{reportId}/appeal': async (req) => {
    const { Report, ReportAction, Appeal, ReliabilityEvent } = require('../models');
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ decision: { type: 'string', required: true, enum: ['uphold', 'overturn'] }, reason: REASON }, req.body);
    const reportId = String(req.params.reportId);
    await db.withTransaction(async (session, after) => {
      const ap = await Appeal.findOne({ reportId, status: 'open' }).session(session).lean();
      if (!ap) throw err.notFound('no_open_appeal');
      await Appeal.updateOne({ _id: ap._id }, { $set: { status: v.decision === 'uphold' ? 'upheld' : 'overturned', decidedBy: admin.id, decidedAt: new Date() } }, { session });
      await Report.updateOne({ _id: reportId }, { $set: { status: v.decision === 'uphold' ? 'actioned' : 'dismissed', resolvedAt: new Date() } }, { session });
      if (v.decision === 'overturn') {
        await ReportAction.create([{ reportId, adminId: admin.id, action: 'restore', notes: v.reason }], { session });
        // Upsert (never insert-then-fail inside a transaction).
        await ReliabilityEvent.updateOne({ userId: ap.userId, activityId: null, kind: 'appeal_upheld' }, { $setOnInsert: { userId: ap.userId, activityId: null, kind: 'appeal_upheld' } }, { upsert: true, session });
        await setUserStatus(session, after, admin.id, ap.userId, 'active', `appeal overturned: ${v.reason}`, null, req.ip);
      } else {
        await notify(session, after, ap.userId, {
          type: 'safety',
          title: 'Appeal reviewed',
          body: 'The original decision stands. You can contact support for more details.',
          data: { target: { screen: 'safety_center', params: { tab: 'case' } } },
        });
      }
      await audit({ actorAdminId: admin.id, action: `appeal.${v.decision}`, targetType: 'report', targetId: reportId, metadata: { reason: v.reason, appealId: ap._id }, ip: req.ip }, { session });
    });
    return reportDetail(req, admin);
  },

  'GET /v1/admin/users/{userId}': async (req) => {
    const { User, Activity, Participant, Block, Report, AuditEvent, Entitlement } = require('../models');
    const admin = await requireAdmin(req, 'moderator');
    const u = await User.findById(String(req.params.userId)).lean();
    if (!u) throw err.notFound('user_not_found');
    const [hosted, completed, noShows, blockedBy, against, by, auditRows, ents] = await Promise.all([
      Activity.countDocuments({ hostUserId: u._id }),
      Participant.countDocuments({ userId: u._id, state: 'completed' }),
      Participant.countDocuments({ userId: u._id, state: 'no_show' }),
      Block.countDocuments({ blockedUserId: u._id }),
      Report.find({ reportedUserId: u._id }).sort({ createdAt: -1 }).limit(50).select('reasonCode status priority createdAt').lean(),
      Report.find({ reporterUserId: u._id }).sort({ createdAt: -1 }).limit(50).select('reasonCode status createdAt').lean(),
      AuditEvent.find({ $or: [{ targetType: 'user', targetId: String(u._id) }, { actorUserId: u._id }] }).sort({ createdAt: -1 }).limit(100).lean(),
      Entitlement.find({ userId: u._id }).select('entitlement source expiresAt').lean(),
    ]);
    const admins = await usersById(auditRows.map((a) => a.actorAdminId));
    await audit({ actorAdminId: admin.id, action: 'user.viewed', targetType: 'user', targetId: u._id, ip: req.ip });
    const p = u.profile;
    const pr = u.progress || {};
    return {
      id: u._id,
      phone: u.phone,
      status: u.status,
      statusReason: u.statusReason || null,
      statusUntil: u.statusUntil || null,
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt || null,
      roles: u.roles || [],
      verification: { phone: true, ageSelfDeclaredAt: u.ageVerifiedAt || null, ageMethod: u.ageVerificationMethod || null, termsAcceptedAt: u.termsAcceptedAt || null },
      profile: p ? { name: p.displayName, bio: p.bio || null, avatarKey: p.avatarKey || null, city: p.homeCity || null, area: p.homeArea || null, interests: p.interests || [], visibility: p.visibility } : null,
      stats: { xp: pr.xpTotal || 0, level: pr.level || 1, hosted, completed, noShows, blockedBy, reliability: Number(p && p.reliabilityScore != null ? p.reliabilityScore : 1) },
      entitlements: ents.map((e) => ({ entitlement: e.entitlement, source: e.source, expiresAt: e.expiresAt || null })),
      reportsAgainst: against.map((r) => ({ id: r._id, reasonCode: r.reasonCode, status: r.status, priority: r.priority, createdAt: r.createdAt })),
      reportsFiled: by.map((r) => ({ id: r._id, reasonCode: r.reasonCode, status: r.status, createdAt: r.createdAt })),
      audit: auditRows.map((a) => ({ id: a._id, action: a.action, actor: actorOf(a, admins), metadata: a.metadata || {}, createdAt: a.createdAt })),
    };
  },

  'POST /v1/admin/users/{userId}/status': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ status: { type: 'string', required: true, enum: ['active', 'limited', 'suspended'] }, reason: REASON, durationDays: { type: 'integer', min: 1, max: 365 } }, req.body);
    const userId = String(req.params.userId);
    await db.withTransaction((session, after) => setUserStatus(session, after, admin.id, userId, v.status, v.reason, v.durationDays, req.ip));
    return { id: userId, status: v.status };
  },

  'GET /v1/admin/audit': async (req) => {
    const { AuditEvent } = require('../models');
    await requireAdmin(req, 'moderator');
    const q = check({ entityType: { type: 'string', max: 40 }, entityId: { type: 'string', max: 80 }, action: { type: 'string', max: 60 } }, req.query);
    const page = pageParams(req.query, { def: 50, max: 200 });
    const filter = {};
    if (q.entityType) filter.targetType = q.entityType;
    if (q.entityId) filter.targetId = q.entityId;
    if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
    const rows = await AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 }).skip(page.offset).limit(page.fetchLimit).lean();
    const admins = await usersById(rows.map((a) => a.actorAdminId));
    return pageOf(rows, page, (a) => ({
      id: String(a._id),
      action: a.action,
      entityType: a.targetType || null,
      entityId: a.targetId || null,
      actor: actorOf(a, admins),
      metadata: a.metadata || {},
      ip: a.ip || null,
      createdAt: a.createdAt,
    }));
  },

  'GET /v1/admin/activities': async (req) => {
    const { Activity, Report, Category, User } = require('../models');
    await requireAdmin(req, 'moderator');
    const { queue } = check({ queue: { type: 'string', enum: ['flagged', 'recent'], default: 'flagged' } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    let rows;
    if (queue === 'flagged') {
      // Flagged = open report, elevated-risk category, limited host, host reliability < 0.7,
      // late night (23:00–05:00 IST), or flagged by automated review.
      const [reported, elevated, riskyHosts] = await Promise.all([
        Report.distinct('activityId', { status: { $in: ['open', 'reviewing'] }, activityId: { $ne: null } }),
        Category.distinct('slug', { riskLevel: 'elevated' }),
        User.distinct('_id', { $or: [{ status: 'limited' }, { 'profile.reliabilityScore': { $lt: 0.7 } }] }),
      ]);
      const hourIst = { $hour: { date: '$startsAt', timezone: 'Asia/Kolkata' } };
      const candidates = await Activity.find({
        status: { $in: ['open', 'full', 'in_progress'] },
        moderationNote: { $ne: 'approved' },
        'review.status': { $ne: 'approved' },
        $or: [
          { _id: { $in: reported } },
          { category: { $in: elevated } },
          { hostUserId: { $in: riskyHosts } },
          { 'review.status': 'flagged' },
          { $expr: { $or: [{ $gte: [hourIst, 23] }, { $lt: [hourIst, 5] }] } },
        ],
      })
        .sort({ startsAt: 1 })
        .limit(1000)
        .lean();
      const counts = candidates.length ? await Report.aggregate([{ $match: { activityId: { $in: candidates.map((a) => a._id) } } }, { $group: { _id: '$activityId', n: { $sum: 1 } } }]) : [];
      const countBy = new Map(counts.map((c) => [c._id, c.n]));
      candidates.forEach((a) => (a._reportCount = countBy.get(a._id) || 0));
      candidates.sort((x, y) => y._reportCount - x._reportCount || new Date(x.startsAt) - new Date(y.startsAt));
      rows = candidates.slice(page.offset, page.offset + page.fetchLimit);
    } else {
      rows = await Activity.find({ createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } })
        .sort({ createdAt: -1 })
        .skip(page.offset)
        .limit(page.fetchLimit)
        .lean();
      const counts = rows.length ? await Report.aggregate([{ $match: { activityId: { $in: rows.map((a) => a._id) } } }, { $group: { _id: '$activityId', n: { $sum: 1 } } }]) : [];
      const countBy = new Map(counts.map((c) => [c._id, c.n]));
      rows.forEach((a) => (a._reportCount = countBy.get(a._id) || 0));
    }
    const [cats, hosts] = await Promise.all([
      Category.find({ slug: { $in: [...new Set(rows.map((a) => a.category))] } }).select('slug riskLevel').lean(),
      User.find({ _id: { $in: [...new Set(rows.map((a) => a.hostUserId))] } }).select('status profile.displayName profile.reliabilityScore').lean(),
    ]);
    const riskOf = new Map(cats.map((c) => [c.slug, c.riskLevel]));
    const hostOf = new Map(hosts.map((h) => [h._id, h]));
    return pageOf(rows, page, (a) => {
      const h = hostOf.get(a.hostUserId) || {};
      const hp = h.profile || {};
      return {
        id: a._id,
        title: a.title,
        description: a.description || null,
        category: a.category,
        riskLevel: riskOf.get(a.category) || 'standard',
        status: a.status,
        startsAt: a.startsAt,
        area: a.coarseArea || null,
        venueName: a.venueName || null,
        venueType: a.venueType || null,
        latitude: a.latitude,
        longitude: a.longitude,
        capacity: a.capacity,
        joinedCount: a.acceptedCount || 0,
        host: { id: a.hostUserId, name: hp.displayName || null, status: h.status || null, reliability: Number(hp.reliabilityScore != null ? hp.reliabilityScore : 1) },
        reportCount: a._reportCount || 0,
        moderationNote: a.moderationNote || null,
        createdAt: a.createdAt,
      };
    });
  },

  'POST /v1/admin/activities/{activityId}/decision': async (req) => {
    const { Activity, Participant } = require('../models');
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ decision: { type: 'string', required: true, enum: ['approve', 'remove'] }, reason: REASON }, req.body);
    const activityId = String(req.params.activityId);
    await db.withTransaction(async (session, after) => {
      const a = await Activity.findById(activityId).select('hostUserId title status').session(session).lean();
      if (!a) throw err.notFound('activity_not_found');
      const reviewed = { 'review.reviewedBy': admin.id, 'review.reviewedAt': new Date() };
      if (v.decision === 'approve') {
        await Activity.updateOne({ _id: a._id }, { $set: { moderationNote: 'approved', 'review.status': 'approved', ...reviewed } }, { session });
      } else {
        await Activity.updateOne({ _id: a._id }, { $set: { status: 'moderated', moderationNote: v.reason, 'review.status': 'removed', ...reviewed } }, { session });
        const ps = await Participant.find({ activityId: a._id, state: { $in: ['requested', 'accepted', 'waitlisted', 'checked_in'] } }).select('userId').session(session).lean();
        const recipients = [...new Set([a.hostUserId, ...ps.map((p) => p.userId)])];
        for (const userId of recipients) {
          const isHost = userId === a.hostUserId;
          await notify(session, after, userId, {
            type: isHost ? 'safety' : 'activity',
            title: isHost ? 'Your plan was removed' : 'A plan you joined was removed',
            body: isHost ? 'It did not meet the community guidelines. You can appeal from Safety.' : `"${a.title}" is no longer available.`,
            data: { activityId: a._id, target: { screen: isHost ? 'safety_center' : 'my_activities', params: {} } },
          });
        }
        after(() => realtime.publish(`activity:${a._id}`, 'activity.updated', { activityId: a._id, status: 'moderated' }));
      }
      await audit({ actorAdminId: admin.id, action: `activity.${v.decision}`, targetType: 'activity', targetId: a._id, metadata: { reason: v.reason }, ip: req.ip }, { session });
    });
    return { id: activityId, decision: v.decision };
  },

  // ---- admin-only below ----
  'GET /v1/admin/billing/subscriptions': async (req) => {
    const { Subscription, User } = require('../models');
    await requireAdmin(req, 'admin');
    const { q } = check({ q: { type: 'string', max: 80 } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    const filter = {};
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      const userIds = await User.distinct('_id', { $or: [{ phone: rx }, { 'profile.displayName': rx }] });
      filter.$or = [{ userId: { $in: [...userIds, q] } }, { originalTransactionId: q }];
    }
    const rows = await Subscription.find(filter).sort({ updatedAt: -1 }).skip(page.offset).limit(page.fetchLimit).lean();
    const people = await usersById(rows.map((s) => s.userId));
    // No card or payment-instrument data exists in this system.
    return pageOf(rows, page, (s) => {
      const u = people.get(s.userId) || {};
      return {
        id: s._id,
        user: { id: s.userId, name: u.name || null, phone: u.phone || null },
        store: s.store,
        productId: s.productId,
        status: s.status,
        startedAt: s.startedAt || null,
        expiresAt: s.expiresAt || null,
        transactionId: s.storeTransactionId || null,
        originalTransactionId: s.originalTransactionId || null,
        updatedAt: s.updatedAt,
      };
    });
  },

  'GET /v1/admin/billing/campaigns': async (req) => {
    const { SponsoredCampaign, CampaignMetric, BusinessInvoice, BusinessProfile } = require('../models');
    await requireAdmin(req, 'admin');
    const [campaigns, invoices, businesses] = await Promise.all([
      SponsoredCampaign.find({}).sort({ createdAt: -1 }).limit(200).lean(),
      BusinessInvoice.find({}).sort({ createdAt: -1 }).limit(200).lean(),
      BusinessProfile.aggregate([
        { $addFields: { _pending: { $cond: [{ $eq: ['$verificationStatus', 'pending'] }, 1, 0] } } },
        { $sort: { _pending: -1, createdAt: -1 } },
        { $limit: 200 },
        { $project: { name: 1, kind: 1, verificationStatus: 1, contactEmail: 1, createdAt: 1 } },
      ]),
    ]);
    const metrics = campaigns.length
      ? await CampaignMetric.aggregate([
          { $match: { campaignId: { $in: campaigns.map((c) => c._id) } } },
          { $group: { _id: '$campaignId', impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, joinRequests: { $sum: '$joinRequests' }, checkIns: { $sum: '$checkIns' } } },
        ])
      : [];
    const m = new Map(metrics.map((x) => [x._id, x]));
    const bizIds = [...new Set([...campaigns.map((c) => c.businessId), ...invoices.map((i) => i.businessId)])];
    const names = new Map((await BusinessProfile.find({ _id: { $in: bizIds } }).select('name').lean()).map((b) => [b._id, b.name]));
    return {
      campaigns: campaigns.map((c) => {
        const x = m.get(c._id) || {};
        return {
          id: c._id,
          business: { id: c.businessId, name: names.get(c.businessId) || null },
          title: c.title,
          status: c.status,
          label: c.label || 'Sponsored',
          budgetMinor: Number(c.budgetMinor),
          spentMinor: Number(c.spentMinor || 0),
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          metrics: { impressions: x.impressions || 0, clicks: x.clicks || 0, joinRequests: x.joinRequests || 0, checkIns: x.checkIns || 0 },
        };
      }),
      invoices: invoices.map((i) => ({
        id: i._id,
        business: { id: i.businessId, name: names.get(i.businessId) || null },
        planCode: i.planCode,
        amountMinor: Number(i.amountMinor),
        currency: i.currency,
        status: i.status,
        razorpayOrderId: i.razorpayOrderId || null,
        razorpayPaymentId: i.razorpayPaymentId || null,
        createdAt: i.createdAt,
        paidAt: i.paidAt || null,
      })),
      businesses: businesses.map((b) => ({ id: b._id, name: b.name, kind: b.kind, verificationStatus: b.verificationStatus, contactEmail: b.contactEmail || null, createdAt: b.createdAt })),
    };
  },

  // Extension: labelled sponsored placements go live only after review.
  'POST /v1/admin/billing/campaigns/{campaignId}/decision': async (req) => {
    const { SponsoredCampaign, Activity } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check({ decision: { type: 'string', required: true, enum: ['approve', 'reject', 'pause'] }, reason: { type: 'string', required: true, min: 3, max: 500 } }, req.body);
    const status = { approve: 'active', reject: 'rejected', pause: 'paused' }[v.decision];
    const campaignId = String(req.params.campaignId);
    await db.withTransaction(async (session) => {
      const c = await SponsoredCampaign.findOneAndUpdate({ _id: campaignId }, { $set: { status } }, { new: true, session }).lean();
      if (!c) throw err.notFound('campaign_not_found');
      if (c.activityId) await Activity.updateOne({ _id: c.activityId }, { $set: { sponsoredCampaignId: status === 'active' ? campaignId : null } }, { session });
      await audit({ actorAdminId: admin.id, action: `campaign.${v.decision}`, targetType: 'campaign', targetId: campaignId, metadata: { reason: v.reason }, ip: req.ip }, { session });
    });
    return { id: campaignId, status };
  },

  'POST /v1/admin/businesses/{businessId}/verification': async (req) => {
    const { BusinessProfile, Venue } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check({ decision: { type: 'string', required: true, enum: ['verify', 'reject', 'suspend'] }, reason: { type: 'string', required: true, min: 3, max: 500 } }, req.body);
    const status = { verify: 'verified', reject: 'rejected', suspend: 'suspended' }[v.decision];
    const businessId = String(req.params.businessId);
    await db.withTransaction(async (session) => {
      const res = await BusinessProfile.updateOne({ _id: businessId }, { $set: { verificationStatus: status, reviewNote: v.reason } }, { session });
      if (!res.matchedCount) throw err.notFound('business_not_found');
      await Venue.updateMany({ businessId }, { $set: { verified: status === 'verified' } }, { session });
      await audit({ actorAdminId: admin.id, action: `business.${v.decision}`, targetType: 'business', targetId: businessId, metadata: { reason: v.reason }, ip: req.ip }, { session });
    });
    return { id: businessId, verificationStatus: status };
  },

  'GET /v1/admin/taxonomy/categories': async (req) => {
    const { Category, Activity } = require('../models');
    await requireAdmin(req, 'admin');
    const [rows, counts] = await Promise.all([Category.find({}).sort({ sortOrder: 1, label: 1 }).lean(), Activity.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }])]);
    const countBy = new Map(counts.map((c) => [c._id, c.n]));
    return { items: rows.map((c) => presentCategory(c, countBy.get(c.slug) || 0)), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/categories': async (req) => {
    const { Category } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        slug: { type: 'string', required: true, format: 'slug' },
        label: { type: 'string', required: true, max: 40 },
        short: { type: 'string', max: 16 },
        pictogram: { type: 'string', max: 30 },
        riskLevel: { type: 'string', enum: ['standard', 'elevated', 'restricted'], default: 'standard' },
        sortOrder: { type: 'integer', min: 0, max: 10000, default: 100 },
        reason: REASON,
      },
      req.body
    );
    const { reason, ...fields } = v;
    const c = await db.withTransaction(async (session) => {
      const [doc] = await Category.create([{ slug: fields.slug, label: fields.label, short: fields.short || fields.label, pictogram: fields.pictogram || 'sparkle', riskLevel: fields.riskLevel, sortOrder: fields.sortOrder }], { session });
      await audit({ actorAdminId: admin.id, action: 'taxonomy.category.create', targetType: 'category', targetId: doc.slug, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc.toObject();
    });
    return created(presentCategory(c));
  },

  'PATCH /v1/admin/taxonomy/categories/{slug}': async (req) => {
    const { Category } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      { label: { type: 'string', max: 40 }, short: { type: 'string', max: 16 }, pictogram: { type: 'string', max: 30 }, riskLevel: { type: 'string', enum: ['standard', 'elevated', 'restricted'] }, active: { type: 'boolean' }, sortOrder: { type: 'integer', min: 0, max: 10000 }, reason: REASON },
      req.body
    );
    const { reason, ...fields } = v;
    const $set = {};
    for (const k of ['label', 'short', 'pictogram', 'riskLevel', 'sortOrder']) if (fields[k] !== undefined) $set[k] = fields[k];
    if (fields.active !== undefined) $set.isActive = fields.active;
    const slug = String(req.params.slug);
    const c = await db.withTransaction(async (session) => {
      const doc = Object.keys($set).length ? await Category.findOneAndUpdate({ slug }, { $set }, { new: true, session }).lean() : await Category.findOne({ slug }).session(session).lean();
      if (!doc) throw err.notFound('category_not_found');
      await audit({ actorAdminId: admin.id, action: 'taxonomy.category.update', targetType: 'category', targetId: slug, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc;
    });
    return presentCategory(c);
  },

  'GET /v1/admin/taxonomy/areas': async (req) => {
    const { CityArea } = require('../models');
    await requireAdmin(req, 'admin');
    const rows = await CityArea.find({}).sort({ city: 1, name: 1 }).lean();
    return { items: rows.map(presentArea), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/areas': async (req) => {
    const { CityArea } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      { city: { type: 'string', required: true, max: 60 }, name: { type: 'string', required: true, max: 60 }, latitude: { type: 'number', required: true, min: -90, max: 90 }, longitude: { type: 'number', required: true, min: -180, max: 180 }, active: { type: 'boolean', default: true }, reason: REASON },
      req.body
    );
    const { reason, ...fields } = v;
    const a = await db.withTransaction(async (session) => {
      const [doc] = await CityArea.create([{ city: fields.city, name: fields.name, active: fields.active, centroid: { type: 'Point', coordinates: [fields.longitude, fields.latitude] } }], { session });
      await audit({ actorAdminId: admin.id, action: 'taxonomy.area.create', targetType: 'area', targetId: doc._id, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc.toObject();
    });
    return created(presentArea(a));
  },

  'PATCH /v1/admin/taxonomy/areas/{areaId}': async (req) => {
    const { CityArea } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check({ name: { type: 'string', max: 60 }, active: { type: 'boolean' }, latitude: { type: 'number', min: -90, max: 90 }, longitude: { type: 'number', min: -180, max: 180 }, reason: REASON }, req.body);
    if ((v.latitude == null) !== (v.longitude == null)) throw err.badRequest('invalid_location');
    const { reason, ...fields } = v;
    const $set = {};
    if (fields.name !== undefined) $set.name = fields.name;
    if (fields.active !== undefined) $set.active = fields.active;
    if (fields.latitude != null) $set.centroid = { type: 'Point', coordinates: [fields.longitude, fields.latitude] };
    const areaId = String(req.params.areaId);
    const a = await db.withTransaction(async (session) => {
      const doc = Object.keys($set).length ? await CityArea.findOneAndUpdate({ _id: areaId }, { $set }, { new: true, session }).lean() : await CityArea.findById(areaId).session(session).lean();
      if (!doc) throw err.notFound('area_not_found');
      await audit({ actorAdminId: admin.id, action: 'taxonomy.area.update', targetType: 'area', targetId: areaId, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc;
    });
    return presentArea(a);
  },

  'GET /v1/admin/taxonomy/quests': async (req) => {
    const { Quest, UserQuest } = require('../models');
    await requireAdmin(req, 'admin');
    const [rows, claims] = await Promise.all([Quest.find({}).sort({ kind: 1, slug: 1 }).lean(), UserQuest.aggregate([{ $match: { state: 'claimed' } }, { $group: { _id: '$questId', n: { $sum: 1 } } }])]);
    const claimsBy = new Map(claims.map((c) => [c._id, c.n]));
    return { items: rows.map((q) => presentQuest(q, claimsBy.get(q._id) || claimsBy.get(q.slug) || 0)), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/quests': async (req) => {
    const { Quest } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        slug: { type: 'string', required: true, format: 'slug' },
        kind: { type: 'string', required: true, enum: ['daily', 'weekly', 'milestone'] },
        title: { type: 'string', required: true, max: 60 },
        description: { type: 'string', required: true, max: 200 },
        pictogram: { type: 'string', max: 30 },
        criteria: { type: 'object', required: true },
        xpReward: { type: 'integer', required: true, min: 0, max: 500 },
        active: { type: 'boolean', default: true },
        startsAt: { type: 'string', format: 'datetime' },
        endsAt: { type: 'string', format: 'datetime' },
        reason: REASON,
      },
      req.body
    );
    if (!QUEST_CRITERIA.includes(v.criteria.type)) throw err.badRequest('invalid_criteria', `criteria.type must be one of ${QUEST_CRITERIA.join(', ')} (verified real-world actions only)`);
    const { reason, ...fields } = v;
    const q = await db.withTransaction(async (session) => {
      const [doc] = await Quest.create(
        [
          {
            slug: fields.slug,
            kind: fields.kind,
            title: fields.title,
            description: fields.description,
            pictogram: fields.pictogram || 'sparkle',
            criteria: fields.criteria,
            xpReward: fields.xpReward,
            active: fields.active,
            startsAt: fields.startsAt ? new Date(fields.startsAt) : null,
            endsAt: fields.endsAt ? new Date(fields.endsAt) : null,
          },
        ],
        { session }
      );
      await audit({ actorAdminId: admin.id, action: 'taxonomy.quest.create', targetType: 'quest', targetId: doc._id, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc.toObject();
    });
    return created(presentQuest(q));
  },

  'PATCH /v1/admin/taxonomy/quests/{questId}': async (req) => {
    const { Quest } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        title: { type: 'string', max: 60 },
        description: { type: 'string', max: 200 },
        pictogram: { type: 'string', max: 30 },
        xpReward: { type: 'integer', min: 0, max: 500 },
        active: { type: 'boolean' },
        startsAt: { type: 'string', format: 'datetime', nullable: true },
        endsAt: { type: 'string', format: 'datetime', nullable: true },
        reason: REASON,
      },
      req.body
    );
    const { reason, ...fields } = v;
    const $set = {};
    for (const k of ['title', 'description', 'pictogram', 'xpReward', 'active']) if (fields[k] !== undefined) $set[k] = fields[k];
    for (const k of ['startsAt', 'endsAt']) if (k in fields) $set[k] = fields[k] ? new Date(fields[k]) : null;
    const key = String(req.params.questId);
    const q = await db.withTransaction(async (session) => {
      const filter = { $or: [{ _id: key }, { slug: key }] };
      const doc = Object.keys($set).length ? await Quest.findOneAndUpdate(filter, { $set }, { new: true, session }).lean() : await Quest.findOne(filter).session(session).lean();
      if (!doc) throw err.notFound('quest_not_found');
      await audit({ actorAdminId: admin.id, action: 'taxonomy.quest.update', targetType: 'quest', targetId: doc._id, metadata: { reason, ...fields }, ip: req.ip }, { session });
      return doc;
    });
    return presentQuest(q);
  },
};

module.exports = { routes, setUserStatus };
