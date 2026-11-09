'use strict';
// Partner perks and table holds: database helpers and presenters shared by
// handlers/partners.js, handlers/discovery.js (venues), handlers/monetization.js
// (business hub), handlers/activities.js and handlers/admin.js (cancel holds).
// Pure rules (labels, windows, eligibility, codes) live in lib/perks.js.
const { notify } = require('../lib/notify');
const L = require('../lib/perks');
const { reliability, levelOf } = require('./progress');

const models = () => require('../models');
const sess = (q, session) => (session ? q.session(session) : q);
const IN_GROUP = ['accepted', 'checked_in', 'completed'];
const OPEN_HOLD = ['requested', 'confirmed'];

// Offers users can see right now (venue verification is checked separately).
function liveOfferFilter(now = new Date()) {
  return {
    status: 'active',
    $and: [{ $or: [{ validFrom: null }, { validFrom: { $lte: now } }] }, { $or: [{ validTo: null }, { validTo: { $gte: now } }] }],
  };
}

// A partner venue: verified, and its business (offers always have one) is verified.
const partnerVenueOk = (venue, business) => !!venue && !!venue.verified && !!venue.businessId && !!business && business.verificationStatus === 'verified';

async function loadLevels(session) {
  const { Level } = models();
  return sess(Level.find({}).select('level name xpThreshold').sort({ level: 1 }), session).lean();
}

// Everything eligibility needs about the viewer. Level comes from services/progress (Level collection
// + lib/xp levelForXp); the show-up rate from services/progress.reliability.
async function viewerContext(userId, { session } = {}) {
  const { User } = models();
  const [user, levels, rel] = await Promise.all([sess(User.findById(userId).select('progress.xpTotal'), session).lean(), loadLevels(session), reliability(userId, session)]);
  const xp = (user && user.progress && user.progress.xpTotal) || 0;
  const lvl = levelOf(xp, levels);
  return {
    userId,
    xp,
    level: lvl.level,
    levelName: lvl.name,
    levels,
    levelNames: new Map(levels.map((l) => [l.level, l.name])),
    showUpRate: rel.rate,
    plansConsidered: rel.plans,
  };
}

// This IST week's confirmed redemptions and the live code, per offer.
async function usageFor(userId, offerIds, now = new Date()) {
  const { OfferRedemption } = models();
  if (!offerIds.length) return { used: new Map(), active: new Map() };
  const [used, active] = await Promise.all([
    OfferRedemption.aggregate([{ $match: { userId, offerId: { $in: offerIds }, status: 'redeemed', weekKey: L.weekKey(now) } }, { $group: { _id: '$offerId', n: { $sum: 1 } } }]),
    OfferRedemption.find({ userId, offerId: { $in: offerIds }, status: 'issued', expiresAt: { $gt: now } }).select('offerId').lean(),
  ]);
  return { used: new Map(used.map((u) => [u._id, u.n])), active: new Map(active.map((a) => [a.offerId, a._id])) };
}

function eligibilityFor(o, viewer, usage, now) {
  return L.eligibility(o, viewer, { usedThisWeek: usage.used.get(o._id) || 0, activeRedemptionId: usage.active.get(o._id) || null, now, levelNames: viewer.levelNames });
}

// Offer shape (docs/API.md "Models" → Offer). business: adds status/validFrom/timestamps for the hub.
function presentOffer(o, { eligibility, business = false, stats } = {}) {
  const out = {
    id: o._id,
    venueId: o.venueId,
    title: o.title,
    description: o.description || null,
    kind: o.kind,
    value: o.kind === 'freebie' ? null : o.value ?? null,
    label: L.offerLabel(o),
    minGroup: o.minGroup ?? 2,
    minLevel: o.minLevel ?? 1,
    minShowUpRate: o.minShowUpRate ?? 0.8,
    days: L.normDays(o.days),
    startMinute: o.startMinute ?? 0,
    endMinute: o.endMinute ?? 1440,
    window: L.windowLabel(o),
    validTo: o.validTo || null,
    perUserPerWeek: o.perUserPerWeek ?? 1,
  };
  if (eligibility) out.eligibility = eligibility;
  if (business) Object.assign(out, { status: o.status, validFrom: o.validFrom || null, createdAt: o.createdAt, updatedAt: o.updatedAt });
  if (stats) out.stats = stats;
  return out;
}

// venues: lean Venue docs; biz: Map businessId → { verificationStatus }.
// Returns Map venueId → Offer[] (ranked; [0] is the best). With viewerId, each offer carries `eligibility`.
async function offersForVenues(venues, { biz, viewerId = null, now = new Date() } = {}) {
  const { VenueOffer, BusinessProfile } = models();
  const out = new Map();
  let bizMap = biz;
  if (!bizMap) {
    const ids = [...new Set(venues.map((v) => v.businessId).filter(Boolean))];
    bizMap = new Map((ids.length ? await BusinessProfile.find({ _id: { $in: ids } }).select('verificationStatus').lean() : []).map((b) => [b._id, b]));
  }
  const ok = venues.filter((v) => partnerVenueOk(v, bizMap.get(v.businessId)));
  if (!ok.length) return out;
  const rows = await VenueOffer.find({ venueId: { $in: ok.map((v) => v._id) }, ...liveOfferFilter(now) }).lean();
  if (!rows.length) return out;
  let elig = null;
  if (viewerId) {
    const [viewer, usage] = await Promise.all([viewerContext(viewerId), usageFor(viewerId, rows.map((r) => r._id), now)]);
    elig = (o) => eligibilityFor(o, viewer, usage, now);
  }
  const byVenue = new Map();
  for (const r of rows) {
    if (!byVenue.has(r.venueId)) byVenue.set(r.venueId, []);
    byVenue.get(r.venueId).push(elig ? { ...r, eligibility: elig(r) } : r);
  }
  for (const [venueId, list] of byVenue) out.set(venueId, L.rankOffers(list).map((o) => presentOffer(o, { eligibility: o.eligibility })));
  return out;
}

// Venue extras for Venue presenters: { offers, hasOffer, bestOfferLabel }.
function venueOfferFields(list) {
  const offers = list || [];
  return { offers, hasOffer: offers.length > 0, bestOfferLabel: offers.length ? offers[0].label : null };
}

// ---------------------------------------------------------------------------
// Redemptions
const statusOf = (r, now = new Date()) => (r.status === 'issued' && new Date(r.expiresAt).getTime() <= new Date(now).getTime() ? 'expired' : r.status);

// Redemption (+ user for the business view: first name and level only, never the phone).
async function presentRedemptions(rows, { now = new Date(), withUser = false } = {}) {
  const { VenueOffer, Venue, User } = models();
  if (!rows.length) return [];
  const [offers, venues, users, levels] = await Promise.all([
    VenueOffer.find({ _id: { $in: [...new Set(rows.map((r) => r.offerId))] } }).lean(),
    Venue.find({ _id: { $in: [...new Set(rows.map((r) => r.venueId))] } }).select('name area').lean(),
    withUser ? User.find({ _id: { $in: [...new Set(rows.map((r) => r.userId))] } }).select('profile.displayName progress.xpTotal').lean() : [],
    withUser ? loadLevels() : [],
  ]);
  const o = new Map(offers.map((x) => [x._id, x]));
  const v = new Map(venues.map((x) => [x._id, x]));
  const u = new Map(users.map((x) => [x._id, x]));
  return rows.map((r) => {
    const offer = o.get(r.offerId);
    const venue = v.get(r.venueId);
    const out = {
      id: r._id,
      code: r.code,
      qrPayload: L.qrPayload(r.code),
      status: statusOf(r, now),
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
      redeemedAt: r.redeemedAt || null,
      groupSize: r.groupSize ?? null,
      activityId: r.activityId || null,
      offer: offer ? { id: offer._id, title: offer.title, label: L.offerLabel(offer), window: L.windowLabel(offer), minGroup: offer.minGroup ?? 2 } : { id: r.offerId, title: null, label: null, window: null, minGroup: null },
      venue: venue ? { id: venue._id, name: venue.name, area: venue.area || null } : { id: r.venueId, name: null, area: null },
    };
    if (withUser) {
      const usr = u.get(r.userId);
      const lvl = levelOf((usr && usr.progress && usr.progress.xpTotal) || 0, levels);
      out.user = { firstName: L.firstName(usr && usr.profile && usr.profile.displayName), level: lvl.level, levelName: lvl.name || null };
    }
    return out;
  });
}

// Flip stale issued codes to 'expired' (reads already treat them as expired).
async function expireStale(filter = {}, now = new Date()) {
  const { OfferRedemption } = models();
  await OfferRedemption.updateMany({ ...filter, status: 'issued', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
}

// ---------------------------------------------------------------------------
// Business staff
async function staffBusinesses(userId, { session } = {}) {
  const { BusinessProfile } = models();
  return sess(BusinessProfile.find({ 'staff.userId': String(userId) }).select('name staff verificationStatus ownerUserId').sort({ createdAt: 1 }), session).lean();
}

const staffIdsOf = (b) => [...new Set([...(b.staff || []).map((s) => s.userId), b.ownerUserId].filter(Boolean))];

async function notifyStaff(session, after, businessId, payload) {
  const { BusinessProfile } = models();
  const b = await sess(BusinessProfile.findById(businessId).select('staff ownerUserId'), session).lean();
  if (!b) return;
  for (const userId of staffIdsOf(b)) await notify(session, after, userId, payload);
}

// ---------------------------------------------------------------------------
// Table holds
async function presentHolds(rows, { business = false, session } = {}) {
  const { Venue, Activity, Participant, User } = models();
  if (!rows.length) return [];
  const actIds = [...new Set(rows.map((h) => h.activityId))];
  const [venues, acts, counts, hosts] = await Promise.all([
    sess(Venue.find({ _id: { $in: [...new Set(rows.map((h) => h.venueId))] } }).select('name area'), session).lean(),
    business ? sess(Activity.find({ _id: { $in: actIds } }).select('title startsAt endsAt capacity'), session).lean() : [],
    business ? sess(Participant.aggregate([{ $match: { activityId: { $in: actIds }, state: { $in: IN_GROUP } } }, { $group: { _id: '$activityId', n: { $sum: 1 } } }]), session) : [],
    business ? sess(User.find({ _id: { $in: [...new Set(rows.map((h) => h.hostUserId))] } }).select('profile.displayName'), session).lean() : [],
  ]);
  const v = new Map(venues.map((x) => [x._id, x]));
  const a = new Map(acts.map((x) => [x._id, x]));
  const n = new Map(counts.map((x) => [x._id, x.n]));
  const h = new Map(hosts.map((x) => [x._id, x]));
  return rows.map((hold) => {
    const venue = v.get(hold.venueId);
    const out = {
      id: hold._id,
      activityId: hold.activityId,
      venueId: hold.venueId,
      partySize: hold.partySize,
      note: hold.note || null,
      status: hold.status,
      startsAt: hold.startsAt,
      createdAt: hold.createdAt,
      respondedAt: hold.respondedAt || null,
      declineReason: hold.declineReason || null,
      venue: venue ? { id: venue._id, name: venue.name, area: venue.area || null } : { id: hold.venueId, name: null, area: null },
    };
    if (business) {
      const act = a.get(hold.activityId);
      out.activity = act ? { id: act._id, title: act.title, startsAt: act.startsAt, endsAt: act.endsAt, capacity: act.capacity, joinedCount: n.get(act._id) || 0 } : null;
      const host = h.get(hold.hostUserId);
      out.host = { firstName: L.firstName(host && host.profile && host.profile.displayName) };
    }
    return out;
  });
}

// Cancel requested|confirmed holds of these activities (activity cancelled / moderated) and tell the venue.
async function cancelHolds(session, after, activityIds, { reason = 'The plan was cancelled.' } = {}) {
  const { TableHold, Activity } = models();
  const ids = [...new Set((activityIds || []).filter(Boolean).map(String))];
  if (!ids.length) return 0;
  const holds = await sess(TableHold.find({ activityId: { $in: ids }, status: { $in: OPEN_HOLD } }), session).lean();
  if (!holds.length) return 0;
  await TableHold.updateMany({ _id: { $in: holds.map((h) => h._id) }, status: { $in: OPEN_HOLD } }, { $set: { status: 'cancelled' } }, session ? { session } : {});
  const titles = new Map((await sess(Activity.find({ _id: { $in: holds.map((h) => h.activityId) } }).select('title'), session).lean()).map((a) => [a._id, a.title]));
  for (const h of holds) {
    await notifyStaff(session, after, h.businessId, {
      type: 'system',
      title: 'Table request cancelled',
      body: `${titles.get(h.activityId) || 'A plan'}, ${L.istWhen(h.startsAt)}: table for ${h.partySize}. ${reason}`,
      data: { holdId: h._id, target: { screen: 'business_holds', params: { holdId: h._id } } },
    });
  }
  return holds.length;
}

module.exports = {
  IN_GROUP,
  OPEN_HOLD,
  liveOfferFilter,
  partnerVenueOk,
  loadLevels,
  viewerContext,
  usageFor,
  eligibilityFor,
  presentOffer,
  offersForVenues,
  venueOfferFields,
  statusOf,
  presentRedemptions,
  expireStale,
  staffBusinesses,
  staffIdsOf,
  notifyStaff,
  presentHolds,
  cancelHolds,
};
