'use strict';
// Response presenters for Mongo documents (lean objects, camelCase fields).
// Output shapes match docs/API.md "Models" and the mobile client models.
// present.activity(doc, viewer, ctx) — see below; ctx is built by services/activities.hydrate().
const geo = require('./geo');
const media = require('./media');

function accentIndex(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

const idOf = (d) => (d ? d._id || d.id : null);
const round2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);
// Public reliability is shown in 5% steps so single events can't be inferred.
const publicReliability = (n) => (n == null ? null : Math.round(Number(n) * 20) / 20);

const avatarUrl = (key) => media.publicUrl(key, 3600);

// Category doc → { slug, label, short, pictogram, riskLevel }
const category = (c) => ({ slug: c.slug, label: c.label, short: c.short || c.label, pictogram: c.pictogram || 'sparkle', riskLevel: c.riskLevel || 'standard' });

// User doc (with profile/progress/availability) → PublicUser.
// extras: { distanceM, completed, area }
async function publicUser(u, { distanceM, completed, area } = {}) {
  const p = u.profile || {};
  const av = u.availability || {};
  const availExpired = av.until && new Date(av.until) < new Date();
  return {
    id: idOf(u),
    name: p.displayName || 'Member',
    area: area || av.area || p.homeArea || null,
    ...(distanceM != null ? { distanceM: geo.coarseDistanceMeters(distanceM), distanceBand: geo.distanceBand(distanceM) } : {}),
    reliability: publicReliability(p.reliabilityScore),
    level: (u.progress && u.progress.level) || 1,
    interests: p.interests || [],
    availability: !av.status || availExpired ? 'busy' : av.status,
    intent: (av.activitySlugs && av.activitySlugs[0]) || null,
    completed: completed || 0,
    avatarKey: p.avatarKey || null,
    avatarUrl: await avatarUrl(p.avatarKey),
  };
}

// Conversation doc + viewer membership → Conversation.
// extras: { title, memberIds, muted, unread }
function conversation(c, { title, memberIds = [], muted = false, unread = 0 } = {}) {
  const lm = c.lastMessage;
  return {
    id: idOf(c),
    kind: c.kind,
    activityId: c.activityId || null,
    circleId: c.circleId || null,
    title: title || null,
    memberIds,
    muted: !!muted,
    unread: unread || 0,
    lastMessage: lm && lm.id ? { id: lm.id, senderId: lm.kind === 'system' ? 'system' : lm.senderId, body: lm.body, createdAt: lm.createdAt } : null,
  };
}

function message(m) {
  return {
    id: idOf(m),
    conversationId: m.conversationId,
    senderId: m.kind === 'system' ? 'system' : m.senderUserId,
    body: m.deletedAt ? null : m.body,
    mediaKey: m.deletedAt ? null : m.mediaKey || null,
    deleted: !!m.deletedAt,
    createdAt: m.createdAt,
  };
}

// Circle doc → Circle. extras: { memberSeeds, nextPlanIds, ownerName, myRole, upcomingPlans }
function circle(c, { memberSeeds = [], nextPlanIds = [], ownerName = null, myRole = null, upcomingPlans } = {}) {
  return {
    id: idOf(c),
    name: c.name,
    pictogram: c.pictogram || 'people',
    members: c.memberCount || 0,
    area: c.area || null,
    accentIndex: accentIndex(idOf(c)),
    visibility: c.visibility,
    description: c.description || '',
    rules: c.rules || [],
    memberSeeds: memberSeeds.slice(0, 6),
    nextPlanIds,
    ownerId: c.ownerUserId,
    ownerName,
    myRole,
    category: c.categorySlug || null,
    ...(upcomingPlans ? { upcomingPlans } : {}),
  };
}

// Quest doc + evaluated progress → Quest.
function quest(q, { progress = 0, total, state = 'available' } = {}) {
  return {
    id: q.slug,
    kind: q.kind,
    title: q.title,
    subtitle: q.description,
    pictogram: q.pictogram || 'sparkle',
    progress,
    total: total || (q.criteria && q.criteria.count) || 1,
    xp: q.xpReward,
    state,
  };
}

function expense(e) {
  return {
    id: idOf(e),
    activityId: e.activityId || null,
    description: e.description,
    totalMinor: Number(e.totalMinor),
    currency: e.currency,
    splitMethod: e.splitMethod,
    createdBy: e.creatorUserId,
    payeeId: e.payeeUserId || e.creatorUserId,
    payeeUpi: e.payeeUpiVpa || null,
    receiptKey: e.receiptKey || null,
    createdAt: e.createdAt,
    ...(e.items && e.items.length
      ? {
          items: e.items.map((i) => ({
            id: idOf(i),
            label: i.label,
            amountMinor: Number(i.amountMinor),
            quantity: i.quantity,
            assignees: (i.assignees || []).map((a) => a.userId),
          })),
        }
      : {}),
    shares: (e.shares || []).map((s) => ({ userId: s.userId, amountMinor: Number(s.amountMinor), state: s.state, paymentReference: s.paymentReference || null, bankVerified: false })),
  };
}

// ---------------------------------------------------------------------------
// Activity (docs/API.md "Models" → Activity). Stable export used by every group.
//
//   present.activity(doc, viewer, ctx)
//     doc    — lean Activity document (camelCase)
//     viewer — viewer user id (string) or { id }
//     ctx    — hydrated context (src/services/activities.hydrate builds it):
//       { host,           lean User (profile, progress) of the host, or null
//         hostCompleted,  number of completed participations of the host
//         participants,   accepted user ids, host first
//         my,             the viewer's lean Participant row, or null
//         conversationId, the activity_group conversation id, or null
//         sponsored,      { label } when an active campaign sponsors it, else null
//         pictogram,      category pictogram
//         distanceM,      raw distance from the reference point (coarsened here), or null
//         featured }      boolean
// Privacy: venueName is null unless the viewer is the host or accepted; coordinates
// are snapped to ~300 m (geo.presentLocation); distances are banded.
const IN_GROUP_STATES = ['accepted', 'checked_in', 'completed'];

function isLive(a, now = Date.now()) {
  return ['open', 'full', 'in_progress'].includes(a.status) && new Date(a.startsAt).getTime() <= now + 30 * 60000 && new Date(a.endsAt).getTime() > now;
}

function activity(a, viewer, ctx = {}) {
  const viewerId = viewer && typeof viewer === 'object' ? viewer.id : viewer;
  const id = idOf(a);
  const my = ctx.my || null;
  const isHost = a.hostUserId === viewerId;
  const accepted = !!(my && IN_GROUP_STATES.includes(my.state));
  const canSeeVenue = isHost || accepted;
  const loc = geo.presentLocation(a, { isHost, isAccepted: accepted });
  const participants = ctx.participants || [];
  const host = ctx.host || null;
  const hp = (host && host.profile) || {};
  const distanceM = ctx.distanceM != null && Number.isFinite(Number(ctx.distanceM)) ? Number(ctx.distanceM) : null;
  return {
    id,
    title: a.title,
    category: a.category,
    pictogram: ctx.pictogram || 'sparkle',
    description: a.description || '',
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    durationMin: Math.round((new Date(a.endsAt) - new Date(a.startsAt)) / 60000),
    capacity: a.capacity,
    joinedCount: participants.length,
    participants,
    host: {
      id: a.hostUserId,
      name: hp.displayName || 'Member',
      reliability: publicReliability(hp.reliabilityScore),
      completed: ctx.hostCompleted || 0,
      level: (host && host.progress && host.progress.level) || 1,
      avatarKey: hp.avatarKey || null,
    },
    area: a.coarseArea || null,
    venueName: canSeeVenue ? a.venueName || null : null,
    venueId: a.venueId || null,
    venueType: a.venueType || null,
    latitude: loc.latitude,
    longitude: loc.longitude,
    locationPrecision: loc.precision,
    distanceM: distanceM != null ? geo.coarseDistanceMeters(distanceM) : null,
    distanceBand: distanceM != null ? geo.distanceBand(distanceM) : null,
    joinRule: a.joinRule,
    live: isLive(a),
    featured: !!ctx.featured,
    sponsored: !!ctx.sponsored,
    sponsorLabel: ctx.sponsored ? ctx.sponsored.label || 'Sponsored' : null,
    cost: a.costNote || null,
    accentIndex: accentIndex(id),
    tags: a.tags || [],
    accessibility: a.accessibilityNotes || null,
    activityLevel: a.activityLevel || 'any',
    visibility: a.visibility,
    status: a.status,
    circleId: a.circleId || null,
    myJoinState: my ? my.state : null,
    myRequestId: my ? idOf(my) : null,
    waitlistPosition: my && my.state === 'waitlisted' ? my.waitlistPosition ?? null : null,
    conversationId: accepted || isHost ? ctx.conversationId || null : null,
    hostedByMe: isHost,
  };
}

function notification(n) {
  const data = n.data || {};
  return { id: idOf(n), type: n.type, title: n.title, body: n.body || null, createdAt: n.createdAt, read: !!n.readAt, target: data.target || null };
}

// ents: active entitlement names; sub: latest Subscription doc or null.
function subscription(ents, sub) {
  const rank = { pro: 2, plus: 1 };
  const tier = ents.filter((e) => rank[e]).sort((a, b) => rank[b] - rank[a])[0] || 'free';
  return {
    tier,
    status: sub ? sub.status : tier === 'free' ? null : 'active',
    expiresAt: sub ? sub.expiresAt : null,
    store: sub ? sub.store : null,
    venue: ents.includes('venue'),
  };
}

module.exports = { accentIndex, idOf, round2, publicReliability, avatarUrl, category, publicUser, conversation, message, circle, quest, expense, notification, subscription, activity, isLive, IN_GROUP_STATES };
