'use strict';
// Shared activity logic (discovery, activities, assistant, circles, admin):
// visibility scope, search, hydration + presentation, creation, group-chat helpers.
// Activity output shape: lib/present.activity (docs/API.md "Models" → Activity).
const { err } = require('../lib/http');
const { check } = require('../lib/validate');
const geo = require('../lib/geo');
const { audit } = require('../lib/audit');
const P = require('../lib/present');

const IN_GROUP_STATES = P.IN_GROUP_STATES; // accepted, checked_in, completed
const ACTIVE_STATES = ['requested', 'accepted', 'waitlisted', 'checked_in'];
const PRIVATE_VENUE_RE = /\b(home|residence|house|flat|apartment|hotel room|my place|bedroom)\b/i;
const WHEN = ['any', 'now', 'today', 'tonight', 'tomorrow', 'weekend'];
const IST_OFFSET_MS = 330 * 60000;

const models = () => require('../models');
const sess = (session) => session || null;

const ACTIVITY_FIELDS = {
  title: { type: 'string', required: true, min: 3, max: 80 },
  description: { type: 'string', max: 1000 },
  category: { type: 'string', required: true, format: 'slug' },
  startsAt: { type: 'string', required: true, format: 'datetime' },
  durationMin: { type: 'integer', required: true, min: 5, max: 720 },
  capacity: { type: 'integer', min: 2, max: 30, default: 4 },
  visibility: { type: 'string', enum: ['public', 'circle', 'invite_only'], default: 'public' },
  joinRule: { type: 'string', enum: ['approval', 'instant'], default: 'approval' },
  venueName: { type: 'string', max: 120 },
  venueType: { type: 'string', max: 40 },
  area: { type: 'string', required: true, max: 60 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  exactLocationAfterAccept: { type: 'boolean', default: true },
  cost: { type: 'string', max: 120 },
  tags: { type: 'array', max: 8, items: { type: 'string', max: 24 } },
  accessibility: { type: 'string', max: 300 },
  activityLevel: { type: 'string', enum: ['any', 'beginner', 'intermediate', 'advanced'], default: 'any' },
  circleId: { type: 'string', format: 'uuid' },
  venueId: { type: 'string', format: 'uuid' },
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLive = P.isLive;

// ---------------------------------------------------------------------------
// Viewer scope: blocks (both directions), circles, own participations.
async function viewerScope(viewerId, { session } = {}) {
  const { Block, CircleMember, Participant } = models();
  const [blocks, circleIds, myActivityIds] = await Promise.all([
    Block.find({ $or: [{ blockerUserId: viewerId }, { blockedUserId: viewerId }] })
      .select('blockerUserId blockedUserId')
      .session(sess(session))
      .lean(),
    CircleMember.distinct('circleId', { userId: viewerId }).session(sess(session)),
    Participant.distinct('activityId', { userId: viewerId }).session(sess(session)),
  ]);
  const blocked = [...new Set(blocks.map((b) => (b.blockerUserId === viewerId ? b.blockedUserId : b.blockerUserId)))];
  return { viewerId, blocked, circleIds, myActivityIds };
}

// Filter fragment: what this viewer may see (legacy VISIBLE_TO_VIEWER + NOT_BLOCKED).
function visibleFilter(scope) {
  return {
    status: { $ne: 'moderated' },
    hostUserId: { $nin: scope.blocked },
    $or: [
      { visibility: 'public' },
      { hostUserId: scope.viewerId },
      { visibility: 'circle', circleId: { $in: scope.circleIds } },
      { _id: { $in: scope.myActivityIds } },
    ],
  };
}

async function blockedBetween(a, b, { session } = {}) {
  const { Block } = models();
  return !!(await Block.exists({
    $or: [
      { blockerUserId: a, blockedUserId: b },
      { blockerUserId: b, blockedUserId: a },
    ],
  }).session(sess(session)));
}

// ---------------------------------------------------------------------------
// Hydration: everything present.activity needs, in a fixed number of queries.
async function hydrate(docs, viewerId, { session } = {}) {
  const { User, Participant, Conversation, SponsoredCampaign, Category } = models();
  const ids = docs.map((d) => d._id);
  const hostIds = [...new Set(docs.map((d) => d.hostUserId))];
  const campaignIds = [...new Set(docs.map((d) => d.sponsoredCampaignId).filter(Boolean))];
  const slugs = [...new Set(docs.map((d) => d.category))];
  const s = sess(session);
  const [hosts, hostCompleted, parts, mine, convs, campaigns, cats] = await Promise.all([
    User.find({ _id: { $in: hostIds } })
      .select('status profile.displayName profile.avatarKey profile.reliabilityScore profile.socialStyle progress.level')
      .session(s)
      .lean(),
    Participant.aggregate([{ $match: { userId: { $in: hostIds }, state: 'completed' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]).session(s),
    Participant.find({ activityId: { $in: ids }, state: { $in: IN_GROUP_STATES } })
      .select('activityId userId decidedAt requestedAt')
      .session(s)
      .lean(),
    viewerId ? Participant.find({ activityId: { $in: ids }, userId: viewerId }).session(s).lean() : [],
    Conversation.find({ activityId: { $in: ids }, kind: 'activity_group' }).select('_id activityId').session(s).lean(),
    campaignIds.length ? SponsoredCampaign.find({ _id: { $in: campaignIds } }).select('status label').session(s).lean() : [],
    Category.find({ slug: { $in: slugs } }).select('slug pictogram').session(s).lean(),
  ]);
  const byTime = (p) => (p.decidedAt ? new Date(p.decidedAt).getTime() : Number.MAX_SAFE_INTEGER);
  const partsBy = new Map();
  for (const p of parts.sort((a, b) => byTime(a) - byTime(b) || new Date(a.requestedAt) - new Date(b.requestedAt))) {
    if (!partsBy.has(p.activityId)) partsBy.set(p.activityId, []);
    partsBy.get(p.activityId).push(p.userId);
  }
  return {
    hosts: new Map(hosts.map((h) => [h._id, h])),
    hostCompleted: new Map(hostCompleted.map((r) => [r._id, r.n])),
    participants: partsBy,
    mine: new Map(mine.map((m) => [m.activityId, m])),
    conversations: new Map(convs.map((c) => [c.activityId, c._id])),
    campaigns: new Map(campaigns.map((c) => [c._id, c])),
    pictograms: new Map(cats.map((c) => [c.slug, c.pictogram])),
  };
}

const hostVisible = (h) => !!h && ['active', 'limited'].includes(h.status);

function presentOne(doc, viewerId, h, { featured = false, distanceM } = {}) {
  const host = h.hosts.get(doc.hostUserId) || null;
  const c = doc.sponsoredCampaignId ? h.campaigns.get(doc.sponsoredCampaignId) : null;
  // Host first in the participants list.
  let participants = h.participants.get(doc._id) || [];
  if (participants.includes(doc.hostUserId)) participants = [doc.hostUserId, ...participants.filter((u) => u !== doc.hostUserId)];
  return P.activity(doc, viewerId, {
    host,
    hostCompleted: h.hostCompleted.get(doc.hostUserId) || 0,
    participants,
    my: h.mine.get(doc._id) || null,
    conversationId: h.conversations.get(doc._id) || null,
    sponsored: c && c.status === 'active' ? { label: c.label || 'Sponsored' } : null,
    pictogram: h.pictograms.get(doc.category) || 'sparkle',
    distanceM: distanceM !== undefined ? distanceM : doc.distanceM,
    featured,
  });
}

// Present a list (drops plans whose host is suspended/deleted, like the legacy JOIN).
async function presentMany(docs, viewerId, { featured = false, session, keepHidden = false } = {}) {
  if (!docs.length) return [];
  const h = await hydrate(docs, viewerId, { session });
  return docs.filter((d) => keepHidden || hostVisible(h.hosts.get(d.hostUserId))).map((d) => presentOne(d, viewerId, h, { featured }));
}

// Visible activity (or null). Options: point { lat, lng } adds distanceM.
async function getVisible(activityId, viewerId, { session, point } = {}) {
  const { Activity, User } = models();
  const scope = await viewerScope(viewerId, { session });
  const filter = { $and: [{ _id: String(activityId) }, visibleFilter(scope)] };
  let doc;
  if (point) {
    // ($geoNear is not used inside transactions; detail reads pass no session.)
    const rows = await Activity.aggregate([geo.geoNearStage(point.lat, point.lng, geo.MAX_RADIUS_KM, { query: filter }), { $limit: 1 }]);
    doc = rows[0] || (await Activity.findOne(filter).session(sess(session)).lean());
  } else {
    doc = await Activity.findOne(filter).session(sess(session)).lean();
  }
  if (!doc) return null;
  const host = await User.findById(doc.hostUserId).select('status').session(sess(session)).lean();
  if (!hostVisible(host)) return null;
  return doc;
}

async function presentFresh(activityId, viewerId, { session } = {}) {
  const doc = await getVisible(activityId, viewerId, { session });
  if (!doc) return null;
  const [a] = await presentMany([doc], viewerId, { session, keepHidden: true });
  return a || null;
}

// ---------------------------------------------------------------------------
// Time windows (IST calendar days).
function istDayStartUtc(offsetDays = 0, now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + offsetDays) - IST_OFFSET_MS);
}

function whenFilter(when, now = new Date()) {
  const DAY = 86400000;
  switch (when) {
    case 'now':
      return { startsAt: { $lte: new Date(now.getTime() + 90 * 60000) } };
    case 'today': {
      const s = istDayStartUtc(0, now);
      return { startsAt: { $gte: s, $lt: new Date(s.getTime() + DAY) } };
    }
    case 'tonight': {
      const s = istDayStartUtc(0, now);
      return { startsAt: { $gte: new Date(s.getTime() + 17 * 3600000), $lt: new Date(s.getTime() + DAY) } };
    }
    case 'tomorrow': {
      const s = istDayStartUtc(1, now);
      return { startsAt: { $gte: s, $lt: new Date(s.getTime() + DAY) } };
    }
    case 'weekend': {
      const ranges = [];
      for (let d = 0; d <= 7; d++) {
        const s = istDayStartUtc(d, now);
        const dow = new Date(s.getTime() + IST_OFFSET_MS).getUTCDay();
        if (dow === 6 || dow === 0) ranges.push({ startsAt: { $gte: s, $lt: new Date(s.getTime() + DAY) } });
      }
      return ranges.length ? { $or: ranges } : { _id: null };
    }
    default:
      return null;
  }
}

// Reference point: device coords, else a named city area centroid, else null (city-wide).
async function referencePoint(query = {}) {
  const lat = query.lat != null && query.lat !== '' ? Number(query.lat) : null;
  const lng = query.lng != null && query.lng !== '' ? Number(query.lng) : null;
  if (lat != null || lng != null) {
    if (!geo.isValidCoord(lat, lng)) throw err.badRequest('invalid_location');
    return { lat, lng };
  }
  if (query.area) {
    const { CityArea } = models();
    const row = await CityArea.findOne({ active: true, name: new RegExp(`^${escapeRegex(String(query.area).trim())}$`, 'i') }).lean();
    if (row && row.centroid) return { lat: row.centroid.coordinates[1], lng: row.centroid.coordinates[0], area: row.name };
  }
  return null;
}

// Shared search used by /activities, /activities/featured, /search and the assistant.
// Returns lean docs (with distanceM when a point is given), already ordered.
async function findActivities(viewerId, { point, radiusKm, category, when, q, limit = 20, offset = 0, order = 'time', notFull = false, session } = {}) {
  const { Activity, Category, User } = models();
  const scope = await viewerScope(viewerId, { session });
  const and = [visibleFilter(scope), { status: { $in: ['open', 'full', 'in_progress'] } }, { endsAt: { $gt: new Date() } }];
  // `category` is one slug or a list (the app's multi-select sends "chai,run").
  const cats = (Array.isArray(category) ? category : String(category || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (cats.length === 1) and.push({ category: cats[0] });
  else if (cats.length > 1) and.push({ category: { $in: cats } });
  const w = whenFilter(when);
  if (w) and.push(w);
  if (q) {
    const re = new RegExp(escapeRegex(String(q).trim()), 'i');
    const catSlugs = await Category.distinct('slug', { label: re });
    and.push({ $or: [{ title: re }, { description: re }, { coarseArea: re }, { tags: re }, ...(catSlugs.length ? [{ category: { $in: catSlugs } }] : [])] });
  }
  if (notFull) and.push({ status: 'open' });
  const filter = { $and: and };

  const featured = order === 'featured';
  // Featured ranking needs host reliability (another collection), so rank a candidate set in JS.
  const fetchN = featured ? Math.max(50, offset + limit) : limit;
  let rows;
  if (point) {
    rows = await Activity.aggregate([
      geo.geoNearStage(point.lat, point.lng, radiusKm, { query: filter }),
      { $sort: featured ? { startsAt: 1 } : { startsAt: 1, distanceM: 1 } },
      { $skip: featured ? 0 : offset },
      { $limit: fetchN },
    ]).session(sess(session));
  } else {
    rows = await Activity.find(filter)
      .sort({ startsAt: 1, _id: 1 })
      .skip(featured ? 0 : offset)
      .limit(fetchN)
      .session(sess(session))
      .lean();
  }
  if (!featured) return rows;

  const hosts = await User.find({ _id: { $in: [...new Set(rows.map((r) => r.hostUserId))] } })
    .select('profile.reliabilityScore')
    .lean();
  const rel = new Map(hosts.map((h) => [h._id, (h.profile && h.profile.reliabilityScore) ?? 0]));
  const soon = Date.now() + 30 * 60000;
  rows.sort((a, b) => {
    const sa = new Date(a.startsAt).getTime() <= soon ? 1 : 0;
    const sb = new Date(b.startsAt).getTime() <= soon ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const ra = rel.get(a.hostUserId) || 0;
    const rb = rel.get(b.hostUserId) || 0;
    if (ra !== rb) return rb - ra;
    const da = a.distanceM == null ? Infinity : a.distanceM;
    const db = b.distanceM == null ? Infinity : b.distanceM;
    if (da !== db) return da - db;
    return new Date(a.startsAt) - new Date(b.startsAt);
  });
  return rows.slice(offset, offset + limit);
}

// ---------------------------------------------------------------------------
// Group chat helpers (activity_group conversation).
async function groupConversationId(activityId, { session } = {}) {
  const { Conversation } = models();
  const c = await Conversation.findOne({ activityId, kind: 'activity_group' }).select('_id').session(sess(session)).lean();
  return c ? c._id : null;
}

async function addToActivityConversation(activityId, userId, { session } = {}) {
  const { ConversationMember, Conversation } = models();
  const id = await groupConversationId(activityId, { session });
  if (!id) return null;
  const conv = await Conversation.findById(id).select('lastMessageAt').session(sess(session)).lean();
  await ConversationMember.updateOne(
    { conversationId: id, userId },
    { $set: { leftAt: null, lastMessageAt: (conv && conv.lastMessageAt) || null }, $setOnInsert: { joinedAt: new Date() } },
    { upsert: true, session }
  );
  return id;
}

async function removeFromActivityConversation(activityId, userId, { session } = {}) {
  const { ConversationMember } = models();
  const id = await groupConversationId(activityId, { session });
  if (!id) return;
  await ConversationMember.updateOne({ conversationId: id, userId, leftAt: null }, { $set: { leftAt: new Date() } }, { session });
}

// System message + denormalised lastMessage (Conversation and every member row).
// Returns the presented message (or null) so callers can publish it after commit.
async function systemMessage(conversationId, body, { session } = {}) {
  if (!conversationId) return null;
  const { Message, Conversation, ConversationMember } = models();
  const [m] = await Message.create([{ conversationId, senderUserId: null, kind: 'system', body }], { session });
  const at = m.createdAt || new Date();
  await Conversation.updateOne({ _id: conversationId }, { $set: { lastMessage: { id: m._id, senderId: null, kind: 'system', body, createdAt: at }, lastMessageAt: at } }, { session });
  await ConversationMember.updateMany({ conversationId }, { $set: { lastMessageAt: at, hiddenAt: null } }, { session });
  return P.message(m.toObject ? m.toObject() : m);
}

// ---------------------------------------------------------------------------
// Creation. Error codes are part of the client contract (docs/API.md → POST /activities).
function validateCreate(body) {
  const b = body || {};
  const cap = b.capacity == null ? null : Number(b.capacity);
  if (cap != null && (!Number.isInteger(cap) || cap < 2 || cap > 30)) throw err.badRequest('capacity_out_of_range', 'Groups can be 2–30 people');
  if (b.startsAt != null && (typeof b.startsAt !== 'string' || Number.isNaN(Date.parse(b.startsAt)))) throw err.badRequest('invalid_time', 'Pick a valid start time');
  const dur = b.durationMin == null ? null : Number(b.durationMin);
  if (dur != null && (!Number.isInteger(dur) || dur < 5 || dur > 720)) throw err.badRequest('invalid_time', 'Duration must be between 5 minutes and 12 hours');
  const v = check(ACTIVITY_FIELDS, b);
  const starts = new Date(v.startsAt);
  const now = Date.now();
  if (starts.getTime() < now - 5 * 60000) throw err.badRequest('start_in_past', 'Pick a start time in the future');
  if (starts.getTime() > now + 60 * 86400000) throw err.badRequest('invalid_time', 'Plans can be scheduled up to 60 days ahead');
  if ((v.latitude == null) !== (v.longitude == null)) throw err.badRequest('invalid_location', 'Send both latitude and longitude');
  if ([v.venueName, v.venueType].some((s) => s && PRIVATE_VENUE_RE.test(s))) throw err.badRequest('private_venue_not_allowed', 'Plans must meet at a public venue or public area');
  return v;
}

// Creates the plan, the host's participant row, the group chat and its first message.
// Returns { id, conversationId }. `session` is required (call inside db.withTransaction).
async function createActivity(session, user, body, { circleId = null, visibility, ip } = {}) {
  const { Category, Venue, BusinessProfile, CircleMember, Activity, Participant, Conversation, ConversationMember } = models();
  const v = validateCreate(body);
  const cat = await Category.findOne({ slug: v.category }).session(sess(session)).lean();
  if (!cat || !cat.isActive) throw err.badRequest('unknown_category');
  if (cat.riskLevel === 'restricted') throw err.forbidden('category_restricted', 'This activity type is not allowed');
  const cid = circleId || v.circleId || null;
  const vis = visibility || v.visibility;
  if (v.venueId) {
    // Partner venue: must be verified, public, and owned by a verified business (if any).
    const venue = await Venue.findOne({ _id: v.venueId, verified: true, isPublicPlace: true }).session(sess(session)).lean();
    let okBusiness = !!venue;
    if (venue && venue.businessId) {
      const b = await BusinessProfile.findById(venue.businessId).select('verificationStatus').session(sess(session)).lean();
      okBusiness = !!b && b.verificationStatus === 'verified';
    }
    if (!venue || !okBusiness) throw err.badRequest('venue_not_allowed', 'That venue is not available for plans');
    v.venueName = v.venueName || venue.name;
    v.venueType = v.venueType || venue.venueType;
    if (v.latitude == null) {
      v.latitude = venue.latitude;
      v.longitude = venue.longitude;
    }
  }
  if (cid) {
    if (!(await CircleMember.exists({ circleId: cid, userId: user.id }).session(sess(session)))) throw err.forbidden('not_circle_member');
  } else if (vis === 'circle') {
    throw err.badRequest('circle_required', 'Circle plans need a circleId');
  }

  const starts = new Date(v.startsAt);
  // Spam / anti-gaming: one similar plan per host per 30-minute window.
  const dup = await Activity.exists({
    hostUserId: user.id,
    category: v.category,
    status: { $in: ['open', 'full', 'draft'] },
    startsAt: { $gt: new Date(starts.getTime() - 1800000), $lt: new Date(starts.getTime() + 1800000) },
  }).session(sess(session));
  if (dup) throw err.conflict('duplicate_plan', 'You already have a similar plan at that time');

  const now = new Date();
  const [a] = await Activity.create(
    [
      {
        hostUserId: user.id,
        category: v.category,
        title: v.title,
        description: v.description || null,
        startsAt: starts,
        endsAt: new Date(starts.getTime() + v.durationMin * 60000),
        capacity: v.capacity,
        visibility: vis,
        venueName: v.venueName || null,
        venueType: v.venueType || null,
        venueId: v.venueId || null,
        coarseArea: v.area,
        latitude: v.latitude ?? null,
        longitude: v.longitude ?? null,
        exactLocationVisibleAfterAccept: v.exactLocationAfterAccept,
        joinRule: v.joinRule,
        costNote: v.cost || null,
        tags: v.tags || [],
        accessibilityNotes: v.accessibility || null,
        activityLevel: v.activityLevel,
        circleId: cid,
        acceptedCount: 1,
      },
    ],
    { session }
  );
  await Participant.create([{ activityId: a._id, userId: user.id, state: 'accepted', decidedAt: now, requestedAt: now }], { session });
  const [conv] = await Conversation.create([{ kind: 'activity_group', activityId: a._id }], { session });
  await ConversationMember.create([{ conversationId: conv._id, userId: user.id, joinedAt: now }], { session });
  await systemMessage(conv._id, 'Your plan is live. People you accept will join this chat.', { session });
  await audit({ actorUserId: user.id, action: 'activity.create', targetType: 'activity', targetId: a._id, metadata: { category: v.category, circleId: cid }, ip }, { session });
  return { id: a._id, conversationId: conv._id };
}

// ---------------------------------------------------------------------------
// Geohash decode (cell centre) for coarse availability cells.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohashCenter(hash) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;
  for (const ch of String(hash || '')) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { latitude: (latMin + latMax) / 2, longitude: (lngMin + lngMax) / 2 };
}

// Precision-4 geohash prefixes (~39 × 20 km) covering a circle — candidate filter for coarse cells.
function coveringPrefixes(lat, lng, radiusKm, precision = 4) {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const out = new Set();
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const la = lat - dLat + (2 * dLat * i) / steps;
      const ln = lng - dLng + (2 * dLng * j) / steps;
      const h = geo.geohash(Math.max(-90, Math.min(90, la)), ((ln + 540) % 360) - 180, precision);
      if (h) out.add(h);
    }
  }
  return [...out];
}

module.exports = {
  IN_GROUP_STATES,
  ACTIVE_STATES,
  ACTIVITY_FIELDS,
  PRIVATE_VENUE_RE,
  WHEN,
  escapeRegex,
  isLive,
  viewerScope,
  visibleFilter,
  blockedBetween,
  hydrate,
  presentOne,
  presentMany,
  getVisible,
  presentFresh,
  istDayStartUtc,
  whenFilter,
  referencePoint,
  findActivities,
  groupConversationId,
  addToActivityConversation,
  removeFromActivityConversation,
  systemMessage,
  validateCreate,
  createActivity,
  geohashCenter,
  coveringPrefixes,
};
