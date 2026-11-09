'use strict';
// Admin insights, user directory and announcements (/v1/admin/*), admin role only.
//   GET  /v1/admin/insights?range=7d|30d|90d   growth, engagement, cohorts, partners, revenue, safety
//   GET  /v1/admin/users?q=&status=&sort=      searchable directory (phones always masked)
//   POST /v1/admin/announcements               dry run or send (in-app + push), max 3 per rolling 24 h
//   GET  /v1/admin/announcements               history
// Days and weeks are IST calendar buckets (timezone Asia/Kolkata). Weeks start on Sunday,
// like the app's week strip (lib/quests.weekStart).
// Partner models (VenueOffer, OfferRedemption, TableHold) are optional: a missing model reads as zero.
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const { requireAdmin } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { pageParams, pageOf } = require('../lib/page');
const { maskPhone } = require('../lib/phone');
const { weekStart } = require('../lib/quests');
const jobs = require('../lib/jobs');
const logger = require('../logger');

const TZ = 'Asia/Kolkata';
const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const ACCEPTED_LIKE = ['accepted', 'checked_in', 'completed', 'no_show'];
const MET_UP = ['checked_in', 'completed'];
const LIVE_PLAN = ['open', 'full', 'in_progress', 'completed'];
const METRICS = ['signups', 'engagedUsers', 'plansCreated', 'joinRequests', 'accepted', 'checkIns', 'completed', 'cancelled', 'reports', 'messages', 'redemptions', 'tableHolds'];
const COHORT_WEEKS = 8;
const ANNOUNCEMENTS_PER_DAY = 3;
const SEND_BATCH = 500;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round = (n, d = 4) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const ratio = (a, b) => (b ? round(a / b) : null);

// ---------- IST calendar helpers ----------
const istToday = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const istStart = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS); // UTC instant of IST midnight
const dayList = (first, n) => Array.from({ length: n }, (_, i) => addDays(first, i));
const dayExpr = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
const weekExpr = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: field, unit: 'week', timezone: TZ, startOfWeek: 'sunday' } }, timezone: TZ } });

// Partner models are added by another module; treat a missing one as "no data".
function optionalModel(name) {
  try {
    const m = require('../models')[name] || require(`../models/${name}`);
    return m && typeof m.aggregate === 'function' ? m : null;
  } catch (e) {
    return null;
  }
}

// Never let one optional panel take the whole dashboard down.
async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    logger.warn({ msg: 'insights_panel_failed', panel: label, err: e.message });
    return fallback;
  }
}

const sumDays = (map, days) => days.reduce((s, d) => s + (map.get(d) || 0), 0);

// Count documents per IST day of `field` in [from, end).
async function countByDay(Model, field, from, end, match = {}) {
  if (!Model) return new Map();
  const rows = await Model.aggregate([{ $match: { ...match, [field]: { $type: 'date', $gte: from, $lt: end } } }, { $group: { _id: dayExpr(`$${field}`), n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

// One row per (bucket, user) for everyone who did something real in [from, end):
// created a plan, asked to join, checked in, sent a message or earned XP.
// `userIds` narrows every branch to those users (uses the per-user compound indexes).
function engagementPipeline(from, end, bucket, userIds) {
  const { Participant, Message, XpEvent } = require('../models');
  const range = { $gte: from, $lt: end };
  const only = (field) => (userIds ? { [field]: { $in: userIds } } : {});
  const branch = (Model, match, userField, timeField) => ({
    $unionWith: { coll: Model.collection.collectionName, pipeline: [{ $match: { ...only(userField), ...match } }, { $project: { _id: 0, u: `$${userField}`, t: `$${timeField}` } }] },
  });
  return [
    { $match: { ...only('hostUserId'), createdAt: range } },
    { $project: { _id: 0, u: '$hostUserId', t: '$createdAt' } },
    branch(Participant, { requestedAt: range }, 'userId', 'requestedAt'),
    branch(Participant, { checkedInAt: { $type: 'date', ...range } }, 'userId', 'checkedInAt'),
    branch(Message, { createdAt: range, kind: 'user' }, 'senderUserId', 'createdAt'),
    branch(XpEvent, { createdAt: range, xpDelta: { $gt: 0 } }, 'userId', 'createdAt'),
    { $match: { u: { $type: 'string' } } },
    { $group: { _id: { k: bucket('$t'), u: '$u' } } },
  ];
}

const median = (sorted) => {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// List prices from the monetisation plans config (lib/entitlements PLANS).
function planPrices() {
  const { PLANS } = require('../lib/entitlements');
  const price = (code) => Number((PLANS.find((p) => p.code === code) || {}).priceMonthlyInr) || 0;
  return { plus: price('plus'), pro: price('pro'), venue: price('venue') };
}

// ---------- insights sections ----------
async function dailyMetrics({ from, prevFrom, end, days, prevDays }) {
  const { User, Activity, Participant, Report, Message } = require('../models');
  const OfferRedemption = optionalModel('OfferRedemption');
  const TableHold = optionalModel('TableHold');
  const [signups, plansCreated, completed, cancelled, reports, messages, checkIns, redemptions, tableHolds, joins, engaged] = await Promise.all([
    countByDay(User, 'createdAt', prevFrom, end),
    countByDay(Activity, 'createdAt', prevFrom, end, { status: { $ne: 'draft' } }),
    countByDay(Activity, 'completedAt', prevFrom, end, { status: 'completed' }),
    countByDay(Activity, 'cancelledAt', prevFrom, end, { status: 'cancelled' }),
    countByDay(Report, 'createdAt', prevFrom, end),
    countByDay(Message, 'createdAt', prevFrom, end, { kind: 'user' }),
    countByDay(Participant, 'checkedInAt', prevFrom, end),
    safe('redemptions', () => countByDay(OfferRedemption, 'redeemedAt', prevFrom, end, { status: 'redeemed' }), new Map()),
    safe('tableHolds', () => countByDay(TableHold, 'createdAt', prevFrom, end), new Map()),
    // Join requests by the day they were made (host rows excluded); `accepted` = those that got in.
    Participant.aggregate([
      { $match: { requestedAt: { $gte: prevFrom, $lt: end } } },
      { $lookup: { from: Activity.collection.collectionName, localField: 'activityId', foreignField: '_id', as: 'a', pipeline: [{ $project: { hostUserId: 1 } }] } },
      { $unwind: '$a' },
      { $match: { $expr: { $ne: ['$userId', '$a.hostUserId'] } } },
      { $group: { _id: dayExpr('$requestedAt'), requests: { $sum: 1 }, accepted: { $sum: { $cond: [{ $in: ['$state', ACCEPTED_LIKE] }, 1, 0] } } } },
    ]),
    Activity.aggregate([
      ...engagementPipeline(prevFrom, end, dayExpr),
      {
        $facet: {
          byDay: [{ $group: { _id: '$_id.k', n: { $sum: 1 } } }],
          cur: [{ $match: { '_id.k': { $gte: days[0] } } }, { $group: { _id: '$_id.u' } }, { $count: 'n' }],
          prev: [{ $match: { '_id.k': { $lt: days[0] } } }, { $group: { _id: '$_id.u' } }, { $count: 'n' }],
        },
      },
    ]),
  ]);
  const joinRequests = new Map(joins.map((j) => [j._id, j.requests]));
  const accepted = new Map(joins.map((j) => [j._id, j.accepted]));
  const e = engaged[0] || { byDay: [], cur: [], prev: [] };
  const engagedUsers = new Map(e.byDay.map((x) => [x._id, x.n]));
  const maps = { signups, engagedUsers, plansCreated, joinRequests, accepted, checkIns, completed, cancelled, reports, messages, redemptions, tableHolds };

  const series = days.map((day) => Object.fromEntries([['day', day], ...METRICS.map((k) => [k, maps[k].get(day) || 0])]));
  const totals = Object.fromEntries(METRICS.map((k) => [k, sumDays(maps[k], days)]));
  const prev = Object.fromEntries(METRICS.map((k) => [k, sumDays(maps[k], prevDays)]));
  // Engaged users are distinct people across the whole period (a daily sum would count user-days).
  totals.engagedUsers = (e.cur[0] && e.cur[0].n) || 0;
  prev.engagedUsers = (e.prev[0] && e.prev[0].n) || 0;
  totals.prev = prev;
  return { series, totals };
}

// Show-up rate: non-host accepted people on plans that started in the window and have ended,
// who checked in or completed. Join conversion: share of join requests that got accepted.
async function rates({ prevFrom, end, now, days, totals, series }) {
  const { Activity, Participant } = require('../models');
  const rows = await Activity.aggregate([
    { $match: { status: { $in: LIVE_PLAN }, startsAt: { $gte: prevFrom, $lt: end }, endsAt: { $lte: now } } },
    { $project: { hostUserId: 1, startsAt: 1 } },
    {
      $lookup: {
        from: Participant.collection.collectionName,
        localField: '_id',
        foreignField: 'activityId',
        as: 'ps',
        pipeline: [{ $match: { state: { $in: ACCEPTED_LIKE } } }, { $project: { userId: 1, state: 1, checkedInAt: 1 } }],
      },
    },
    { $unwind: '$ps' },
    { $match: { $expr: { $ne: ['$ps.userId', '$hostUserId'] } } },
    {
      $group: {
        _id: dayExpr('$startsAt'),
        accepted: { $sum: 1 },
        showed: { $sum: { $cond: [{ $or: [{ $in: ['$ps.state', MET_UP] }, { $ne: [{ $ifNull: ['$ps.checkedInAt', null] }, null] }] }, 1, 0] } },
      },
    },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const cur = { accepted: 0, showed: 0 };
  const prev = { accepted: 0, showed: 0 };
  for (const r of rows) {
    const bucket = r._id >= days[0] ? cur : prev;
    bucket.accepted += r.accepted;
    bucket.showed += r.showed;
  }
  return {
    showUpRate: ratio(cur.showed, cur.accepted),
    joinConversion: ratio(totals.accepted, totals.joinRequests),
    prev: { showUpRate: ratio(prev.showed, prev.accepted), joinConversion: ratio(totals.prev.accepted, totals.prev.joinRequests) },
    daily: series.map((s) => {
      const r = byDay.get(s.day);
      return { day: s.day, showUpRate: r ? ratio(r.showed, r.accepted) : null, joinConversion: ratio(s.accepted, s.joinRequests) };
    }),
  };
}

// Signed up inside the range → finished profile → asked to join → got accepted → met up.
// Each step is a subset of the one before it.
async function funnel({ from, end }) {
  const { User, Participant, Activity } = require('../models');
  const users = await User.find({ createdAt: { $gte: from, $lt: end } }).select('_id profile.displayName').lean();
  const withProfile = users.filter((u) => u.profile && u.profile.displayName).map((u) => u._id);
  let asked = 0;
  let accepted = 0;
  let met = 0;
  if (withProfile.length) {
    const rows = await Participant.aggregate([
      { $match: { userId: { $in: withProfile } } },
      { $lookup: { from: Activity.collection.collectionName, localField: 'activityId', foreignField: '_id', as: 'a', pipeline: [{ $project: { hostUserId: 1 } }] } },
      { $unwind: '$a' },
      { $match: { $expr: { $ne: ['$userId', '$a.hostUserId'] } } },
      {
        $group: {
          _id: '$userId',
          accepted: { $max: { $cond: [{ $in: ['$state', ACCEPTED_LIKE] }, 1, 0] } },
          met: { $max: { $cond: [{ $or: [{ $in: ['$state', MET_UP] }, { $ne: [{ $ifNull: ['$checkedInAt', null] }, null] }] }, 1, 0] } },
        },
      },
    ]);
    asked = rows.length;
    accepted = rows.filter((r) => r.accepted).length;
    met = rows.filter((r) => r.accepted && r.met).length;
  }
  return [
    { label: 'Signed up', value: users.length },
    { label: 'Finished profile', value: withProfile.length },
    { label: 'Asked to join', value: asked },
    { label: 'Got accepted', value: accepted },
    { label: 'Met up', value: met },
  ];
}

// Last 8 IST signup weeks. weeks[k] = share of the cohort engaged during week k after the
// signup week (k = 0 is the signup week); null when that week has not started yet.
// Retention (Week 1..4) is the size-weighted average over cohorts whose week k has fully ended.
async function cohorts({ now, end }) {
  const { User, Activity } = require('../models');
  const current = weekStart(now);
  const weekKeys = Array.from({ length: COHORT_WEEKS }, (_, i) => addDays(current, (i - COHORT_WEEKS + 1) * 7));
  const cohortFrom = istStart(weekKeys[0]);
  const members = await User.aggregate([{ $match: { createdAt: { $gte: cohortFrom, $lt: end } } }, { $project: { w: weekExpr('$createdAt') } }]);
  const weekOf = new Map(members.map((m) => [m._id, m.w]));
  const size = new Map(weekKeys.map((w) => [w, 0]));
  for (const m of members) if (size.has(m.w)) size.set(m.w, size.get(m.w) + 1);
  const engaged = new Map(weekKeys.map((w) => [w, Array(COHORT_WEEKS).fill(0)]));
  if (members.length) {
    const pairs = await Activity.aggregate(engagementPipeline(cohortFrom, end, weekExpr, [...weekOf.keys()]));
    for (const { _id } of pairs) {
      const signup = weekOf.get(_id.u);
      if (!signup || !engaged.has(signup)) continue;
      const k = Math.round((Date.parse(_id.k) - Date.parse(signup)) / WEEK_MS);
      if (k >= 0 && k < COHORT_WEEKS) engaged.get(signup)[k] += 1;
    }
  }
  const rows = weekKeys.map((w) => ({
    week: w,
    size: size.get(w),
    weeks: engaged.get(w).map((n, k) => (addDays(w, k * 7) > current || !size.get(w) ? null : round(n / size.get(w)))),
  }));
  const retention = [1, 2, 3, 4].map((k) => {
    let num = 0;
    let den = 0;
    for (const w of weekKeys) {
      if (addDays(w, (k + 1) * 7) > current) continue; // week k not finished yet
      num += engaged.get(w)[k];
      den += size.get(w);
    }
    return { label: `Week ${k}`, value: den ? round(num / den) : null, cohortUsers: den };
  });
  return { cohorts: rows, retention };
}

// Categories, areas and the weekday x hour heatmap for plans created in the range.
async function planMix({ from, end }) {
  const { Activity, Category, User } = require('../models');
  const [facets, homeAreas] = await Promise.all([
    Activity.aggregate([
      { $match: { createdAt: { $gte: from, $lt: end }, status: { $ne: 'draft' } } },
      {
        $facet: {
          categories: [
            { $group: { _id: '$category', plans: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
            { $sort: { plans: -1, _id: 1 } },
            { $limit: 12 },
          ],
          areas: [{ $match: { coarseArea: { $type: 'string', $ne: '' } } }, { $group: { _id: '$coarseArea', plans: { $sum: 1 } } }, { $sort: { plans: -1, _id: 1 } }, { $limit: 50 }],
          heat: [{ $group: { _id: { d: { $dayOfWeek: { date: '$startsAt', timezone: TZ } }, h: { $hour: { date: '$startsAt', timezone: TZ } } }, n: { $sum: 1 } } }],
        },
      },
    ]),
    User.aggregate([
      { $match: { status: { $ne: 'deleted' }, 'profile.homeArea': { $type: 'string', $ne: '' } } },
      { $group: { _id: '$profile.homeArea', users: { $sum: 1 } } },
      { $sort: { users: -1, _id: 1 } },
      { $limit: 50 },
    ]),
  ]);
  const f = facets[0] || { categories: [], areas: [], heat: [] };
  const labels = new Map((await Category.find({ slug: { $in: f.categories.map((c) => c._id) } }).select('slug label').lean()).map((c) => [c.slug, c.label]));
  const areas = new Map();
  const keyOf = (s) => String(s).trim().toLowerCase();
  for (const a of f.areas) areas.set(keyOf(a._id), { area: String(a._id).trim(), plans: a.plans, users: 0 });
  for (const a of homeAreas) {
    const k = keyOf(a._id);
    if (areas.has(k)) areas.get(k).users += a.users;
    else areas.set(k, { area: String(a._id).trim(), plans: 0, users: a.users });
  }
  const values = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of f.heat) if (c._id.d >= 1 && c._id.d <= 7 && c._id.h >= 0 && c._id.h < 24) values[c._id.d - 1][c._id.h] += c.n;
  return {
    categories: f.categories.map((c) => ({ slug: c._id, label: labels.get(c._id) || c._id, plans: c.plans, completed: c.completed })),
    areas: [...areas.values()].sort((a, b) => b.plans - a.plans || b.users - a.users || a.area.localeCompare(b.area)).slice(0, 12),
    heatmap: { values },
  };
}

// Current member base (everyone with a profile who is not deleted).
async function community() {
  const { User, Level } = require('../models');
  const [facets, levels] = await Promise.all([
    User.aggregate([
      { $match: { status: { $ne: 'deleted' }, profile: { $ne: null } } },
      { $facet: { style: [{ $group: { _id: '$profile.socialStyle', n: { $sum: 1 } } }], levels: [{ $group: { _id: { $ifNull: ['$progress.level', 1] }, n: { $sum: 1 } } }] } },
    ]),
    Level.find({}).sort({ level: 1 }).select('level name').lean(),
  ]);
  const f = facets[0] || { style: [], levels: [] };
  const socialStyle = { introvert: 0, ambivert: 0, extrovert: 0, unset: 0 };
  for (const s of f.style) {
    if (s._id && Object.prototype.hasOwnProperty.call(socialStyle, s._id)) socialStyle[s._id] += s.n;
    else socialStyle.unset += s.n;
  }
  const counts = new Map(f.levels.map((l) => [Number(l._id), l.n]));
  const known = levels.map((l) => ({ level: l.level, name: l.name, users: counts.get(l.level) || 0 }));
  const extra = [...counts.entries()].filter(([lv]) => !levels.some((l) => l.level === lv)).map(([lv, n]) => ({ level: lv, name: null, users: n }));
  return { socialStyle, levels: [...known, ...extra].sort((a, b) => a.level - b.level) };
}

async function partners({ from, end, totals }) {
  const { Venue, BusinessProfile } = require('../models');
  const VenueOffer = optionalModel('VenueOffer');
  const TableHold = optionalModel('TableHold');
  const now = new Date();
  const [verified, pending, offers, holds] = await Promise.all([
    Venue.countDocuments({ verified: true }),
    Venue.aggregate([
      { $match: { verified: { $ne: true }, businessId: { $type: 'string' } } },
      { $lookup: { from: BusinessProfile.collection.collectionName, localField: 'businessId', foreignField: '_id', as: 'b', pipeline: [{ $project: { verificationStatus: 1 } }] } },
      { $match: { 'b.verificationStatus': 'pending' } },
      { $count: 'n' },
    ]),
    safe('offers', () => (VenueOffer ? VenueOffer.countDocuments({ status: 'active', $or: [{ validTo: null }, { validTo: { $gt: now } }] }) : 0), 0),
    safe('tableHoldStatus', () => (TableHold ? TableHold.aggregate([{ $match: { createdAt: { $gte: from, $lt: end } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]) : []), []),
  ]);
  const holdBy = new Map(holds.map((h) => [h._id, h.n]));
  return {
    venues: { verified, pending: (pending[0] && pending[0].n) || 0 },
    offers: { active: offers },
    redemptions: { range: totals.redemptions, prev: totals.prev.redemptions },
    tableHolds: { requested: holdBy.get('requested') || 0, confirmed: holdBy.get('confirmed') || 0, declined: holdBy.get('declined') || 0, cancelled: holdBy.get('cancelled') || 0 },
  };
}

// Paid entitlements (grants excluded) x list price. History is approximate: a renewed
// entitlement keeps its first createdAt, and a lapsed one only remembers its last expiry.
async function revenue({ from, days, now }) {
  const { Entitlement } = require('../models');
  const rows = await Entitlement.find({}).select('entitlement source createdAt expiresAt').lean();
  const activeAt = (r, t) => new Date(r.createdAt) <= t && (!r.expiresAt || new Date(r.expiresAt) > t);
  const paid = rows.filter((r) => r.source !== 'grant');
  const count = (kind, t) => paid.filter((r) => r.entitlement === kind && activeAt(r, t)).length;
  const prices = planPrices();
  const at = (t) => ({ plus: count('plus', t), pro: count('pro', t), venuePlans: count('venue', t) });
  const cur = at(now);
  const prev = at(from);
  const mrr = (x) => x.plus * prices.plus + x.pro * prices.pro + x.venuePlans * prices.venue;
  return {
    ...cur,
    mrrEstimateInr: mrr(cur),
    granted: rows.filter((r) => r.source === 'grant' && activeAt(r, now)).length,
    prices: { plusInr: prices.plus, proInr: prices.pro, venueInr: prices.venue },
    prev: { ...prev, mrrEstimateInr: mrr(prev) },
    daily: days.map((day) => {
      const t = new Date(Math.min(istStart(addDays(day, 1)).getTime(), now.getTime()));
      return { day, subscriptions: count('plus', t) + count('pro', t) };
    }),
    note: 'Estimate: active paid plans x monthly list price, before store fees and GST. Complimentary grants are excluded.',
  };
}

async function safety({ from, end }) {
  const { Report, Block } = require('../models');
  const [byReason, resolved, blocks, open] = await Promise.all([
    Report.aggregate([{ $match: { createdAt: { $gte: from, $lt: end } } }, { $group: { _id: '$reasonCode', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }]),
    Report.aggregate([
      { $match: { resolvedAt: { $type: 'date', $gte: from, $lt: end } } },
      { $project: { h: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3600000] } } },
      { $sort: { h: 1 } },
    ]),
    Block.countDocuments({ createdAt: { $gte: from, $lt: end } }),
    Report.countDocuments({ status: { $in: ['open', 'reviewing', 'appealed'] } }),
  ]);
  const hours = resolved.map((r) => r.h).filter((h) => Number.isFinite(h) && h >= 0);
  const med = median(hours);
  return {
    reportsByReason: byReason.map((r) => ({ reason: r._id || 'other', n: r.n })),
    medianHoursToResolve: med == null ? null : Math.round(med * 10) / 10,
    resolved: hours.length,
    openReports: open,
    blocks,
  };
}

// ---------- users ----------
const presentUser = (u, reportsAgainst) => {
  const p = u.profile || {};
  const pr = u.progress || {};
  return {
    id: u._id,
    displayName: p.displayName || null,
    phoneMasked: typeof u.phone === 'string' && u.phone.startsWith('+') ? maskPhone(u.phone) : null,
    area: p.homeArea || null,
    status: u.status,
    level: pr.level || 1,
    xp: pr.xpTotal || 0,
    createdAt: u.createdAt,
    lastActiveAt: u.lastActiveAt || null,
    roles: u.roles || [],
    reportsAgainst,
  };
};

// ---------- announcements ----------
const DEEP_LINK = /^projectirl:\/\/[a-z0-9][a-z0-9/_-]*(\?[A-Za-z0-9_=&.%-]*)?$/;
// Common deep link paths → mobile screen ids (navigation/inventory.js) for the in-app target.
const DEEP_LINK_SCREENS = {
  'discover/home': 'discover_home',
  'discover/search': 'discover_search',
  'map/discovery': 'map_discovery',
  'live/radar': 'live_radar',
  'me/perks': 'my_perks',
  'my/activities': 'my_activities',
  'create/activity/type': 'create_activity_type',
  'quest/home': 'quest_home',
  'social/roadmap': 'social_roadmap',
  'circles/home': 'circles_home',
  'premium/compare': 'premium_compare',
  'business/discovery': 'business_discovery',
  'safety/center': 'safety_center',
  'profile/home': 'profile_home',
  'notifications/center': 'notifications_center',
};

function targetOf(deepLink) {
  if (!deepLink) return null;
  const rest = deepLink.slice('projectirl://'.length);
  const [path, query = ''] = rest.split('?');
  const screen = DEEP_LINK_SCREENS[path.replace(/\/+$/, '')];
  if (!screen) return null;
  return { screen, params: Object.fromEntries(new URLSearchParams(query)) };
}

// Active members with a profile in the audience. Announcements are "News & offers", so only
// people who turned that on (notificationPrefs.productUpdates, off by default) receive them.
function audienceFilter(audience) {
  const f = { status: 'active', profile: { $ne: null } };
  if (audience.kind === 'area') f['profile.homeArea'] = { $regex: `^\\s*${escapeRegex(audience.value.trim())}\\s*$`, $options: 'i' };
  return f;
}
const recipientFilter = (audience) => ({ ...audienceFilter(audience), 'notificationPrefs.productUpdates': true });

const presentAnnouncement = (a, names) => ({
  id: a._id,
  title: a.title,
  body: a.body,
  audience: { kind: a.audience.kind, value: a.audience.value || null },
  deepLink: a.deepLink || null,
  recipients: a.recipients || 0,
  status: a.status,
  reason: a.reason,
  createdBy: { id: a.createdBy, name: names.get(a.createdBy) || null },
  createdAt: a.createdAt,
});

async function sendLimit(now = new Date()) {
  const { Announcement } = require('../models');
  const since = new Date(now.getTime() - DAY_MS);
  const recent = await Announcement.find({ createdAt: { $gte: since } }).sort({ createdAt: 1, _id: 1 }).select('_id createdAt').lean();
  const nextAvailableAt = recent.length >= ANNOUNCEMENTS_PER_DAY ? new Date(new Date(recent[recent.length - ANNOUNCEMENTS_PER_DAY].createdAt).getTime() + DAY_MS) : null;
  return { recent, usedLast24h: recent.length, max: ANNOUNCEMENTS_PER_DAY, nextAvailableAt };
}

function limitError(nextAvailableAt) {
  const retry = nextAvailableAt ? Math.max(1, Math.ceil((nextAvailableAt.getTime() - Date.now()) / 1000)) : 3600;
  return err.tooMany(retry, 'announcement_limit', `At most ${ANNOUNCEMENTS_PER_DAY} announcements can go out in 24 hours.`);
}

const routes = {
  'GET /v1/admin/insights': async (req) => {
    await requireAdmin(req, 'admin');
    const { range } = check({ range: { type: 'string', enum: Object.keys(RANGE_DAYS), default: '30d' } }, req.query);
    const n = RANGE_DAYS[range];
    const now = new Date();
    const today = istToday(now);
    const days = dayList(addDays(today, -(n - 1)), n);
    const prevDays = dayList(addDays(days[0], -n), n);
    const ctx = { now, days, prevDays, from: istStart(days[0]), prevFrom: istStart(prevDays[0]), end: istStart(addDays(today, 1)) };

    const daily = await dailyMetrics(ctx);
    Object.assign(ctx, daily);
    const [rateBlock, funnelSteps, cohortBlock, mix, people, partnerBlock, revenueBlock, safetyBlock] = await Promise.all([
      rates(ctx),
      funnel(ctx),
      cohorts(ctx),
      planMix(ctx),
      community(),
      safe('partners', () => partners(ctx), { venues: { verified: 0, pending: 0 }, offers: { active: 0 }, redemptions: { range: 0, prev: 0 }, tableHolds: { requested: 0, confirmed: 0, declined: 0, cancelled: 0 } }),
      revenue(ctx),
      safety(ctx),
    ]);
    return {
      range,
      timezone: TZ,
      generatedAt: now,
      days,
      series: daily.series,
      totals: daily.totals,
      rates: rateBlock,
      funnel: funnelSteps,
      cohorts: cohortBlock.cohorts,
      retention: cohortBlock.retention,
      categories: mix.categories,
      areas: mix.areas,
      heatmap: mix.heatmap,
      socialStyle: people.socialStyle,
      levels: people.levels,
      partners: partnerBlock,
      revenue: revenueBlock,
      safety: safetyBlock,
    };
  },

  'GET /v1/admin/users': async (req) => {
    const { User, Report } = require('../models');
    await requireAdmin(req, 'admin');
    const v = check(
      {
        q: { type: 'string', max: 80 },
        status: { type: 'string', enum: ['active', 'limited', 'suspended', 'deleted', 'all'], default: 'all' },
        sort: { type: 'string', enum: ['new', 'active'], default: 'new' },
      },
      req.query
    );
    const page = pageParams(req.query, { def: 25, max: 100 });
    const filter = {};
    if (v.status !== 'all') filter.status = v.status;
    if (v.q) {
      const q = v.q.trim();
      const or = [{ _id: q }, { 'profile.displayName': { $regex: escapeRegex(q), $options: 'i' } }];
      const digits = q.replace(/[\s-]/g, '');
      // Last four digits of the phone only; full numbers are never searchable or returned here.
      if (/^\d{4}$/.test(digits)) or.push({ phone: { $regex: `^\\+\\d+${digits}$` } });
      filter.$or = or;
    }
    const sort = v.sort === 'active' ? { lastActiveAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };
    const since7d = new Date(Date.now() - 7 * DAY_MS);
    const [rows, total, active7d, suspended] = await Promise.all([
      User.find(filter).sort(sort).skip(page.offset).limit(page.fetchLimit).select('phone status roles profile.displayName profile.homeArea progress.level progress.xpTotal createdAt lastActiveAt').lean(),
      User.countDocuments({ status: { $ne: 'deleted' } }),
      User.countDocuments({ status: { $ne: 'deleted' }, lastActiveAt: { $gte: since7d } }),
      User.countDocuments({ status: 'suspended' }),
    ]);
    const ids = rows.map((u) => u._id);
    const against = ids.length ? await Report.aggregate([{ $match: { reportedUserId: { $in: ids } } }, { $group: { _id: '$reportedUserId', n: { $sum: 1 } } }]) : [];
    const countBy = new Map(against.map((r) => [r._id, r.n]));
    const out = await pageOf(rows, page, (u) => presentUser(u, countBy.get(u._id) || 0));
    return { ...out, counts: { total, active7d, suspended } };
  },

  'POST /v1/admin/announcements': async (req) => {
    const { Announcement, User, Notification } = require('../models');
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        title: { type: 'string', min: 2, max: 60 },
        body: { type: 'string', min: 2, max: 180 },
        audience: {
          type: 'object',
          required: true,
          fields: { kind: { type: 'string', required: true, enum: ['all', 'area'] }, value: { type: 'string', max: 60, nullable: true } },
        },
        deepLink: { type: 'string', max: 200, nullable: true },
        dryRun: { type: 'boolean', default: false },
        reason: { type: 'string', min: 10, max: 600 },
      },
      req.body
    );
    const audience = { kind: v.audience.kind, value: v.audience.kind === 'area' ? (v.audience.value || '').trim() : null };
    if (audience.kind === 'area' && !audience.value) throw err.badRequest('audience_area_required', 'Pick an area for this audience.');
    const deepLink = v.deepLink || null;
    if (deepLink && !DEEP_LINK.test(deepLink)) throw err.badRequest('invalid_deep_link', 'Deep links look like projectirl://discover/home');

    if (v.dryRun) {
      const [eligible, recipients] = await Promise.all([User.countDocuments(audienceFilter(audience)), User.countDocuments(recipientFilter(audience))]);
      return { dryRun: true, recipients, eligible, optedOut: Math.max(0, eligible - recipients) };
    }

    const missing = ['title', 'body', 'reason'].filter((k) => !v[k]);
    if (missing.length) throw err.badRequest('validation_failed', 'Some fields are invalid', missing.map((path) => ({ path, code: 'required' })));

    const pre = await sendLimit();
    if (pre.usedLast24h >= ANNOUNCEMENTS_PER_DAY) throw limitError(pre.nextAvailableAt);
    const doc = await Announcement.create({ title: v.title, body: v.body, audience, deepLink, createdBy: admin.id, reason: v.reason, status: 'sending' });
    // Concurrent sends: whoever lands past the limit (by createdAt, then id) backs out.
    const after = await sendLimit();
    const rank = after.recent.findIndex((r) => r._id === doc._id);
    if (rank >= ANNOUNCEMENTS_PER_DAY) {
      await Announcement.deleteOne({ _id: doc._id });
      throw limitError(after.nextAvailableAt);
    }

    const target = targetOf(deepLink);
    const data = { announcementId: doc._id, deepLink, target };
    let recipients = 0;
    try {
      const cursor = User.find(recipientFilter(audience)).sort({ _id: 1 }).select('_id').lean().cursor({ batchSize: SEND_BATCH });
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        const userIds = batch;
        batch = [];
        await Notification.insertMany(
          userIds.map((userId) => ({ userId, type: 'marketing', title: v.title, body: v.body, data })),
          { ordered: false }
        );
        // The push job applies each user's preferences and quiet hours, and is a no-op when FCM is not configured.
        await jobs.enqueue('push', { userIds, notification: { type: 'marketing', title: v.title, body: v.body, data } });
        recipients += userIds.length;
      };
      for await (const u of cursor) {
        batch.push(u._id);
        if (batch.length >= SEND_BATCH) await flush();
      }
      await flush();
    } catch (e) {
      await Announcement.updateOne({ _id: doc._id }, { $set: { status: 'failed', recipients } }).catch(() => {});
      throw e;
    }
    await Announcement.updateOne({ _id: doc._id }, { $set: { status: 'sent', recipients } });
    await audit({
      actorAdminId: admin.id,
      action: 'announcement.send',
      targetType: 'announcement',
      targetId: doc._id,
      metadata: { reason: v.reason, title: v.title, audience, deepLink, recipients },
      ip: req.ip,
    });
    return created({ id: doc._id, recipients });
  },

  'GET /v1/admin/announcements': async (req) => {
    const { Announcement, User } = require('../models');
    await requireAdmin(req, 'admin');
    const [rows, limit] = await Promise.all([Announcement.find({}).sort({ createdAt: -1, _id: -1 }).limit(50).lean(), sendLimit()]);
    const people = await User.find({ _id: { $in: [...new Set(rows.map((r) => r.createdBy))] } }).select('profile.displayName').lean();
    const names = new Map(people.map((u) => [u._id, (u.profile && u.profile.displayName) || null]));
    return {
      items: rows.map((a) => presentAnnouncement(a, names)),
      limit: { max: limit.max, usedLast24h: limit.usedLast24h, nextAvailableAt: limit.nextAvailableAt },
      nextCursor: null,
    };
  },
};

module.exports = { routes, targetOf, DEEP_LINK_SCREENS };
