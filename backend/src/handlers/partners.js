'use strict';
// Partner perks and table holds.
//  - Perks: venue-funded offers UNLOCKED by level (XP is never spent), show-up rate, an IST
//    day/time window and a weekly limit. The user shows a 6-character code / QR; venue staff
//    confirm it in the business hub. A confirmed redemption is one verified partner visit.
//  - Table holds: the host of a plan at a partner venue asks the venue to hold a table; staff
//    confirm or decline. No money moves in either flow.
// Venue lists with offers live in handlers/discovery.js; analytics in handlers/monetization.js.
const { err, created, HttpError } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { enforce } = require('../lib/rateLimit');
const realtime = require('../lib/realtime');
const jobs = require('../lib/jobs');
const geo = require('../lib/geo');
const L = require('../lib/perks');
const S = require('../services/perks');
const A = require('../services/activities');
const { myBusiness } = require('./monetization');

const models = () => require('../models');
const DAY = 86400000;
const MAX_PERKS = 50;

const OFFER_FIELDS = {
  title: { type: 'string', min: 2, max: 60 },
  description: { type: 'string', max: 240, nullable: true },
  kind: { type: 'string', enum: ['percent', 'flat', 'freebie'] },
  value: { type: 'integer', nullable: true },
  minGroup: { type: 'integer', min: 1, max: 20 },
  minLevel: { type: 'integer', min: 1, max: 10 },
  minShowUpRate: { type: 'number', min: 0, max: 1 },
  days: { type: 'array', min: 1, max: 7, unique: true, items: { type: 'integer', min: 0, max: 6 } },
  startMinute: { type: 'integer', min: 0, max: 1439 },
  endMinute: { type: 'integer', min: 1, max: 1440 },
  validFrom: { type: 'string', format: 'datetime', nullable: true },
  validTo: { type: 'string', format: 'datetime', nullable: true },
  perUserPerWeek: { type: 'integer', min: 1, max: 7 },
};
const STATUS_ORDER = { active: 0, paused: 1, ended: 2 };

const toDate = (s) => (s ? new Date(s) : null);
const sortDays = (d) => [...d].sort((a, b) => a - b);

function invalid(errors) {
  return err.badRequest('validation_failed', 'Some fields are invalid', errors);
}

// A live offer at a verified partner venue, or 404 offer_not_found.
async function liveOffer(offerId, now) {
  const { VenueOffer, Venue, BusinessProfile } = models();
  const o = await VenueOffer.findById(String(offerId)).lean();
  if (!o || !L.isLive(o, now)) throw err.notFound('offer_not_found', 'This perk is not available');
  const [venue, biz] = await Promise.all([Venue.findById(o.venueId).lean(), BusinessProfile.findById(o.businessId).select('verificationStatus').lean()]);
  if (!S.partnerVenueOk(venue, biz) || venue.businessId !== o.businessId) throw err.notFound('offer_not_found', 'This perk is not available');
  return { offer: o, venue };
}

// The caller's role on an activity: 'host' | 'member' | null.
async function roleOn(activity, userId) {
  if (!activity) return null;
  if (activity.hostUserId === userId) return 'host';
  const { Participant } = models();
  return (await Participant.exists({ activityId: activity._id, userId, state: { $in: S.IN_GROUP } })) ? 'member' : null;
}

async function myStaffBusinessIds(userId) {
  const list = await S.staffBusinesses(userId);
  if (!list.length) throw err.forbidden('no_business', 'Set up a business profile first');
  return list.map((b) => b._id);
}

async function presentRedemption(r, opts) {
  const [out] = await S.presentRedemptions([r], opts);
  return out;
}

async function presentHold(h, opts) {
  const [out] = await S.presentHolds([h], opts);
  return out;
}

function holdLine(activityTitle, hold) {
  return `${activityTitle || 'A plan'}, ${L.istWhen(hold.startsAt)}: table for ${hold.partySize}.`;
}

const routes = {
  // ---------------------------------------------------------------------------
  // App user: perks
  'GET /v1/me/perks': async (req) => {
    const user = await requireUser(req);
    const { VenueOffer, Venue, BusinessProfile } = models();
    const now = new Date();
    const point = await A.referencePoint(req.query).catch(() => null);
    const offers = await VenueOffer.find(S.liveOfferFilter(now)).limit(2000).lean();
    const venueIds = [...new Set(offers.map((o) => o.venueId))];
    const venues = venueIds.length ? await Venue.find({ _id: { $in: venueIds }, verified: true, isPublicPlace: true }).lean() : [];
    const bizIds = [...new Set(venues.map((v) => v.businessId).filter(Boolean))];
    const biz = new Map((bizIds.length ? await BusinessProfile.find({ _id: { $in: bizIds } }).select('verificationStatus').lean() : []).map((b) => [b._id, b]));
    const venueById = new Map(venues.filter((v) => S.partnerVenueOk(v, biz.get(v.businessId))).map((v) => [v._id, v]));
    const visible = offers.filter((o) => venueById.has(o.venueId) && venueById.get(o.venueId).businessId === o.businessId);
    const [viewer, usage] = await Promise.all([S.viewerContext(user.id), S.usageFor(user.id, visible.map((o) => o._id), now)]);

    const items = visible.map((o) => {
      const v = venueById.get(o.venueId);
      const el = S.eligibilityFor(o, viewer, usage, now);
      const d = point && v.latitude != null && v.longitude != null ? geo.haversineMeters({ latitude: point.lat, longitude: point.lng }, { latitude: v.latitude, longitude: v.longitude }) : null;
      return { raw: { ...o, eligibility: el }, d, name: v.name, venue: { id: v._id, name: v.name, area: v.area || null, venueType: v.venueType || null, categories: v.categorySlugs || [], distanceM: d != null ? geo.coarseDistanceMeters(d) : null } };
    });
    // Venue order (distance, else name), then the offer ranking within a venue.
    const rank = new Map(L.rankOffers(items.map((x) => x.raw)).map((o, i) => [o._id, i]));
    items.sort((a, b) => {
      if (point) {
        const da = a.d == null ? Infinity : a.d;
        const dbb = b.d == null ? Infinity : b.d;
        if (da !== dbb) return da - dbb;
      }
      return String(a.name).localeCompare(String(b.name)) || rank.get(a.raw._id) - rank.get(b.raw._id);
    });
    const toItem = (x) => ({ offer: S.presentOffer(x.raw, { eligibility: x.raw.eligibility }), venue: x.venue });
    const unlocked = items.filter((x) => L.isUnlocked(x.raw.eligibility));
    const locked = items.filter((x) => !L.isUnlocked(x.raw.eligibility));
    return {
      level: { level: viewer.level, name: viewer.levelName || null },
      showUpRate: Math.round(viewer.showUpRate * 100) / 100,
      plansConsidered: viewer.plansConsidered,
      unlocked: unlocked.slice(0, MAX_PERKS).map(toItem),
      locked: locked.slice(0, MAX_PERKS).map(toItem),
      nextUnlock: L.nextUnlock(visible, { level: viewer.level, xp: viewer.xp, levels: viewer.levels }),
    };
  },

  'POST /v1/offers/{offerId}/redeem': async (req) => {
    const user = await requireUser(req);
    const v = check({ activityId: { type: 'string', format: 'uuid', nullable: true } }, req.body);
    const { OfferRedemption, Activity } = models();
    const now = new Date();
    const { offer, venue } = await liveOffer(req.params.offerId, now);
    const mine = { offerId: offer._id, userId: user.id };
    await S.expireStale(mine, now);
    // Same unexpired code on repeat (also covers the user's own double tap).
    const existing = await OfferRedemption.findOne({ ...mine, status: 'issued', expiresAt: { $gt: now } }).lean();
    if (existing) return { redemption: await presentRedemption(existing, { now }) };

    const [viewer, usage] = await Promise.all([S.viewerContext(user.id), S.usageFor(user.id, [offer._id], now)]);
    const el = S.eligibilityFor(offer, viewer, usage, now);
    if (el.reasons.some((r) => L.LOCK_REASONS.includes(r))) {
      const msg = el.reasons.includes('level') ? `Reach level ${el.unlockLevel}${el.unlockLevelName ? ` (${el.unlockLevelName})` : ''} to unlock this perk` : 'Keep showing up to your plans to unlock this perk';
      throw new HttpError(403, 'offer_locked', msg, { reasons: el.reasons, unlockLevel: el.unlockLevel });
    }
    if (el.reasons.includes('weekly_limit')) throw err.conflict('weekly_limit', 'You have used this perk as often as you can this week. It resets on Sunday.', { usedThisWeek: el.usedThisWeek, perUserPerWeek: offer.perUserPerWeek ?? 1 });
    if (el.reasons.includes('not_now')) throw err.conflict('not_now', `This perk is available: ${L.windowLabel(offer)} (IST).`, { window: L.windowLabel(offer) });

    let activityId = null;
    if (v.activityId) {
      const a = await Activity.findById(v.activityId).select('hostUserId').lean();
      if (await roleOn(a, user.id)) activityId = a._id; // only plans you are part of count towards group size
    }
    await enforce('offer_redeem', user.id);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = L.generateCode();
      try {
        const doc = await OfferRedemption.create({
          offerId: offer._id,
          venueId: venue._id,
          businessId: offer.businessId,
          userId: user.id,
          activityId,
          code,
          status: 'issued',
          issuedAt: now,
          expiresAt: new Date(now.getTime() + L.CODE_TTL_MS),
          weekKey: L.weekKey(now),
        });
        return created({ redemption: await presentRedemption(doc.toObject(), { now }) });
      } catch (e) {
        if (!e || e.code !== 11000) throw e;
        const key = Object.keys(e.keyPattern || e.keyValue || {});
        if (key.includes('userId')) {
          // Raced with another request from this user: return that code.
          const other = await OfferRedemption.findOne({ ...mine, status: 'issued' }).lean();
          if (other) return { redemption: await presentRedemption(other, { now }) };
        }
        await S.expireStale({ code }, now); // a stale code with the same letters; try another
      }
    }
    throw err.unavailable('code_unavailable', 'Could not create a code. Please try again.');
  },

  'GET /v1/redemptions/{redemptionId}': async (req) => {
    const user = await requireUser(req);
    const { OfferRedemption } = models();
    const r = await OfferRedemption.findOne({ _id: String(req.params.redemptionId), userId: user.id }).lean();
    if (!r) throw err.notFound('redemption_not_found');
    return { redemption: await presentRedemption(r) };
  },

  'POST /v1/redemptions/{redemptionId}/cancel': async (req) => {
    const user = await requireUser(req);
    const { OfferRedemption } = models();
    const now = new Date();
    const id = String(req.params.redemptionId);
    const r = await OfferRedemption.findOne({ _id: id, userId: user.id }).lean();
    if (!r) throw err.notFound('redemption_not_found');
    if (r.status === 'cancelled') return { redemption: await presentRedemption(r, { now }) };
    const done = await OfferRedemption.findOneAndUpdate({ _id: id, status: 'issued', expiresAt: { $gt: now } }, { $set: { status: 'cancelled' } }, { new: true }).lean();
    if (!done) throw err.conflict('not_cancellable', 'This code was already used or has expired');
    return { redemption: await presentRedemption(done, { now }) };
  },

  'GET /v1/me/redemptions': async (req) => {
    const user = await requireUser(req);
    const { OfferRedemption } = models();
    const rows = await OfferRedemption.find({ userId: user.id, issuedAt: { $gte: new Date(Date.now() - 90 * DAY) } })
      .sort({ issuedAt: -1, _id: -1 })
      .limit(200)
      .lean();
    return { items: await S.presentRedemptions(rows), nextCursor: null };
  },

  // ---------------------------------------------------------------------------
  // Host: table holds
  'POST /v1/activities/{activityId}/table-hold': async (req) => {
    const user = await requireUser(req);
    const v = check({ partySize: { type: 'integer', min: 1, max: 20 }, note: { type: 'string', max: 140, nullable: true } }, req.body);
    const { Activity, Venue, BusinessProfile, TableHold } = models();
    let hold;
    try {
      hold = await db.withTransaction(async (session, after) => {
        const a = await Activity.findById(String(req.params.activityId)).session(session).lean();
        if (!a) throw err.notFound('activity_not_found');
        if (a.hostUserId !== user.id) throw err.forbidden('host_only', 'Only the host can ask the venue to hold a table');
        if (!['open', 'full'].includes(a.status) || new Date(a.endsAt).getTime() <= Date.now()) throw err.conflict('activity_not_open', 'This plan is not open any more');
        const venue = a.venueId ? await Venue.findById(a.venueId).session(session).lean() : null;
        const biz = venue && venue.businessId ? await BusinessProfile.findById(venue.businessId).select('verificationStatus').session(session).lean() : null;
        if (!S.partnerVenueOk(venue, biz)) throw err.conflict('not_partner_venue', 'Table holds work at verified partner venues only');
        if (await TableHold.exists({ activityId: a._id, status: { $in: S.OPEN_HOLD } }).session(session)) throw err.conflict('hold_exists', 'You already asked this venue to hold a table');
        const [h] = await TableHold.create(
          [
            {
              activityId: a._id,
              venueId: venue._id,
              businessId: venue.businessId,
              hostUserId: user.id,
              partySize: v.partySize ?? L.clampGroup(a.capacity),
              note: v.note || null,
              startsAt: a.startsAt,
              status: 'requested',
            },
          ],
          { session }
        );
        await S.notifyStaff(session, after, venue.businessId, {
          type: 'system',
          title: 'New table request',
          body: holdLine(a.title, h),
          data: { holdId: h._id, target: { screen: 'business_holds', params: { holdId: h._id } } },
        });
        await audit({ actorUserId: user.id, action: 'table_hold.request', targetType: 'table_hold', targetId: h._id, metadata: { activityId: a._id, venueId: venue._id }, ip: req.ip }, { session });
        return h.toObject();
      });
    } catch (e) {
      if (e && e.code === 11000) throw err.conflict('hold_exists', 'You already asked this venue to hold a table');
      throw e;
    }
    return created(await presentHold(hold));
  },

  'GET /v1/activities/{activityId}/table-hold': async (req) => {
    const user = await requireUser(req);
    const { Activity, TableHold } = models();
    const a = await Activity.findById(String(req.params.activityId)).select('hostUserId').lean();
    if (!a) throw err.notFound('activity_not_found');
    if (!(await roleOn(a, user.id))) throw err.forbidden('not_participant');
    const open = await TableHold.findOne({ activityId: a._id, status: { $in: S.OPEN_HOLD } }).lean();
    const h = open || (await TableHold.findOne({ activityId: a._id }).sort({ createdAt: -1, _id: -1 }).lean());
    return { hold: h ? await presentHold(h) : null };
  },

  'DELETE /v1/activities/{activityId}/table-hold': async (req) => {
    const user = await requireUser(req);
    const { Activity, TableHold } = models();
    await db.withTransaction(async (session, after) => {
      const a = await Activity.findById(String(req.params.activityId)).select('hostUserId title').session(session).lean();
      if (!a) throw err.notFound('activity_not_found');
      if (a.hostUserId !== user.id) throw err.forbidden('host_only');
      const h = await TableHold.findOneAndUpdate({ activityId: a._id, status: { $in: S.OPEN_HOLD } }, { $set: { status: 'cancelled' } }, { new: true, session }).lean();
      if (!h) throw err.notFound('hold_not_found', 'There is no table request to cancel');
      await S.notifyStaff(session, after, h.businessId, {
        type: 'system',
        title: 'Table request cancelled',
        body: `${holdLine(a.title, h)} The host cancelled the request.`,
        data: { holdId: h._id, target: { screen: 'business_holds', params: { holdId: h._id } } },
      });
      await audit({ actorUserId: user.id, action: 'table_hold.cancel', targetType: 'table_hold', targetId: h._id, ip: req.ip }, { session });
    });
    return { ok: true };
  },

  // ---------------------------------------------------------------------------
  // Business staff: offers
  'GET /v1/business/offers': async (req) => {
    const { VenueOffer, OfferRedemption } = models();
    const user = await requireUser(req);
    const q = check({ businessId: { type: 'string', format: 'uuid' }, venueId: { type: 'string', format: 'uuid' } }, req.query);
    const b = await myBusiness(user.id, q.businessId);
    const rows = await VenueOffer.find({ businessId: b._id, ...(q.venueId ? { venueId: q.venueId } : {}) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const wk = L.weekKey(new Date());
    const sums = rows.length
      ? await OfferRedemption.aggregate([
          { $match: { offerId: { $in: rows.map((o) => o._id) }, status: 'redeemed' } },
          { $group: { _id: '$offerId', total: { $sum: 1 }, week: { $sum: { $cond: [{ $eq: ['$weekKey', wk] }, 1, 0] } } } },
        ])
      : [];
    const by = new Map(sums.map((s) => [s._id, s]));
    rows.sort((x, y) => (STATUS_ORDER[x.status] ?? 9) - (STATUS_ORDER[y.status] ?? 9) || new Date(y.createdAt) - new Date(x.createdAt));
    return {
      items: rows.map((o) => {
        const s = by.get(o._id) || {};
        return S.presentOffer(o, { business: true, stats: { week: s.week || 0, total: s.total || 0 } });
      }),
      nextCursor: null,
    };
  },

  'POST /v1/business/offers': async (req) => {
    const { VenueOffer, Venue } = models();
    const user = await requireUser(req);
    const v = check(
      {
        ...OFFER_FIELDS,
        businessId: { type: 'string', format: 'uuid' },
        venueId: { type: 'string', format: 'uuid' },
        title: { ...OFFER_FIELDS.title, required: true },
        kind: { ...OFFER_FIELDS.kind, required: true },
        status: { type: 'string', enum: ['active', 'paused'], default: 'active' },
      },
      req.body
    );
    const b = await myBusiness(user.id, v.businessId);
    const venue = await Venue.findOne({ businessId: b._id, ...(v.venueId ? { _id: v.venueId } : {}) })
      .sort({ createdAt: 1 })
      .lean();
    if (!venue) throw err.notFound('no_venue', 'Set up your venue first');
    const doc = {
      venueId: venue._id,
      businessId: b._id,
      title: v.title,
      description: v.description || null,
      kind: v.kind,
      value: v.kind === 'freebie' ? null : v.value ?? null,
      minGroup: v.minGroup ?? 2,
      minLevel: v.minLevel ?? 1,
      minShowUpRate: v.minShowUpRate ?? 0.8,
      days: v.days ? sortDays(v.days) : [...L.ALL_DAYS],
      startMinute: v.startMinute ?? 0,
      endMinute: v.endMinute ?? 1440,
      validFrom: toDate(v.validFrom),
      validTo: toDate(v.validTo),
      perUserPerWeek: v.perUserPerWeek ?? 1,
      status: v.status,
      createdBy: user.id,
    };
    const errors = L.offerErrors(doc);
    if (errors.length) throw invalid(errors);
    if ((await VenueOffer.countDocuments({ venueId: venue._id, status: { $ne: 'ended' } })) >= L.MAX_LIVE_OFFERS_PER_VENUE) {
      throw err.conflict('too_many_offers', `A venue can have up to ${L.MAX_LIVE_OFFERS_PER_VENUE} offers. End one first.`);
    }
    const o = await db.withTransaction(async (session) => {
      const [row] = await VenueOffer.create([doc], { session });
      await audit({ actorUserId: user.id, action: 'offer.create', targetType: 'venue_offer', targetId: row._id, metadata: { venueId: venue._id }, ip: req.ip }, { session });
      return row.toObject();
    });
    return created(S.presentOffer(o, { business: true }));
  },

  'PATCH /v1/business/offers/{offerId}': async (req) => {
    const { VenueOffer } = models();
    const user = await requireUser(req);
    const v = check({ ...OFFER_FIELDS, status: { type: 'string', enum: ['active', 'paused', 'ended'] } }, req.body);
    const bizIds = await myStaffBusinessIds(user.id);
    const o = await VenueOffer.findOne({ _id: String(req.params.offerId), businessId: { $in: bizIds } }).lean();
    if (!o) throw err.notFound('offer_not_found');
    if (o.status === 'ended') throw err.conflict('offer_ended', 'This offer has ended. Create a new one instead.');
    const $set = {};
    for (const k of Object.keys(OFFER_FIELDS)) if (v[k] !== undefined) $set[k] = v[k];
    if ('validFrom' in $set) $set.validFrom = toDate($set.validFrom);
    if ('validTo' in $set) $set.validTo = toDate($set.validTo);
    if ($set.days) $set.days = sortDays($set.days);
    if ('description' in $set) $set.description = $set.description || null;
    if (v.status) $set.status = v.status;
    const merged = { ...o, ...$set };
    if (merged.kind === 'freebie') $set.value = merged.value = null;
    const errors = L.offerErrors(merged);
    if (errors.length) throw invalid(errors);
    const out = await db.withTransaction(async (session) => {
      const row = Object.keys($set).length ? await VenueOffer.findOneAndUpdate({ _id: o._id }, { $set }, { new: true, runValidators: true, session }).lean() : o;
      await audit({ actorUserId: user.id, action: 'offer.update', targetType: 'venue_offer', targetId: o._id, metadata: { fields: Object.keys($set) }, ip: req.ip }, { session });
      return row;
    });
    return S.presentOffer(out, { business: true });
  },

  // ---------------------------------------------------------------------------
  // Business staff: redemptions
  'POST /v1/business/redemptions/confirm': async (req) => {
    const { OfferRedemption, Participant } = models();
    const user = await requireUser(req);
    const v = check({ code: { type: 'string', required: true, max: 64 }, groupSize: { type: 'integer', min: 1, max: 1000 } }, req.body);
    const bizIds = await myStaffBusinessIds(user.id);
    await enforce('redemption_confirm', user.id);
    const code = L.normalizeCode(v.code);
    const now = new Date();
    const notFound = () => err.notFound('code_not_found', 'No perk matches this code. Check it with the guest.');
    if (!L.isCode(code)) throw notFound();
    // This business's live code first, then its most recent one with these letters, then anyone's.
    let r =
      (await OfferRedemption.findOne({ code, businessId: { $in: bizIds }, status: 'issued' }).sort({ issuedAt: -1 }).lean()) ||
      (await OfferRedemption.findOne({ code, businessId: { $in: bizIds } }).sort({ issuedAt: -1 }).lean());
    if (!r) {
      if (await OfferRedemption.exists({ code })) throw err.forbidden('wrong_venue', 'This code is for a different venue');
      throw notFound();
    }
    const used = () => err.conflict('code_used', 'This code was already used', { redeemedAt: r.redeemedAt || null });
    const expired = () => new HttpError(410, 'code_expired', 'This code has expired. Ask the guest to open the perk again for a new one.');
    if (r.status === 'redeemed') throw used();
    if (S.statusOf(r, now) !== 'issued') throw expired();

    let groupSize = v.groupSize != null ? L.clampGroup(v.groupSize) : 1;
    if (v.groupSize == null && r.activityId) {
      const n = await Participant.countDocuments({ activityId: r.activityId, state: { $in: S.IN_GROUP } });
      groupSize = L.clampGroup(n || 1);
    }
    const done = await OfferRedemption.findOneAndUpdate(
      { _id: r._id, status: 'issued', expiresAt: { $gt: now } },
      { $set: { status: 'redeemed', redeemedAt: now, redeemedBy: user.id, groupSize, weekKey: L.weekKey(now) } },
      { new: true }
    ).lean();
    if (!done) {
      r = (await OfferRedemption.findById(r._id).lean()) || r;
      throw r.status === 'redeemed' ? used() : expired();
    }
    await audit({ actorUserId: user.id, action: 'redemption.confirm', targetType: 'offer_redemption', targetId: done._id, metadata: { venueId: done.venueId, groupSize }, ip: req.ip });
    const redemption = await presentRedemption(done, { now, withUser: true });
    // The app polls GET /redemptions/{id}; realtime is a faster nudge. Quests may now be complete.
    const forUser = { ...redemption };
    delete forUser.user;
    await realtime.publish(`user:${done.userId}:notifications`, 'redemption.updated', forUser).catch(() => {});
    await jobs.enqueue('quest_evaluate', { userId: done.userId }, { dedupeKey: `qe:${done.userId}:redeem:${done._id}` }).catch(() => {});
    return { redemption };
  },

  'GET /v1/business/redemptions': async (req) => {
    const { OfferRedemption } = models();
    const user = await requireUser(req);
    const q = check({ businessId: { type: 'string', format: 'uuid' } }, req.query);
    const b = await myBusiness(user.id, q.businessId);
    const now = new Date();
    const base = { businessId: b._id, status: 'redeemed' };
    const [rows, today, week, month] = await Promise.all([
      OfferRedemption.find({ ...base, redeemedAt: { $gte: new Date(now.getTime() - 30 * DAY) } })
        .sort({ redeemedAt: -1, _id: -1 })
        .limit(200)
        .lean(),
      OfferRedemption.countDocuments({ ...base, redeemedAt: { $gte: L.istDayStart(now) } }),
      OfferRedemption.countDocuments({ ...base, redeemedAt: { $gte: L.istWeekStart(now) } }),
      OfferRedemption.countDocuments({ ...base, redeemedAt: { $gte: L.istMonthStart(now) } }),
    ]);
    return { items: await S.presentRedemptions(rows, { now, withUser: true }), counts: { today, week, month }, nextCursor: null };
  },

  // ---------------------------------------------------------------------------
  // Business staff: table holds
  'GET /v1/business/table-holds': async (req) => {
    const { TableHold } = models();
    const user = await requireUser(req);
    const q = check({ status: { type: 'string', enum: ['requested', 'upcoming', 'all'], default: 'upcoming' }, businessId: { type: 'string', format: 'uuid' } }, req.query);
    const b = await myBusiness(user.id, q.businessId);
    const recent = { $gte: new Date(Date.now() - 2 * 3600000) };
    const filter = {
      requested: { businessId: b._id, status: 'requested', startsAt: recent },
      upcoming: { businessId: b._id, status: { $in: S.OPEN_HOLD }, startsAt: recent },
      all: { businessId: b._id },
    }[q.status];
    const sort = q.status === 'all' ? { createdAt: -1, _id: -1 } : { startsAt: 1, _id: 1 };
    const rows = await TableHold.find(filter).sort(sort).limit(100).lean();
    return { items: await S.presentHolds(rows, { business: true }), nextCursor: null };
  },

  'POST /v1/business/table-holds/{holdId}/respond': async (req) => {
    const { TableHold, Activity, Venue } = models();
    const user = await requireUser(req);
    const v = check({ decision: { type: 'string', required: true, enum: ['confirm', 'decline'] }, reason: { type: 'string', max: 140, nullable: true } }, req.body);
    const bizIds = await myStaffBusinessIds(user.id);
    const out = await db.withTransaction(async (session, after) => {
      const h = await TableHold.findOne({ _id: String(req.params.holdId), businessId: { $in: bizIds } }).session(session).lean();
      if (!h) throw err.notFound('hold_not_found');
      if (v.decision === 'confirm' && h.status === 'confirmed') return h; // repeat tap
      // requested → confirmed | declined; a confirmed hold can still be declined (the venue withdraws it).
      const from = v.decision === 'confirm' ? ['requested'] : S.OPEN_HOLD;
      if (!from.includes(h.status)) throw err.conflict('hold_not_pending', 'This table request is no longer open');
      const status = v.decision === 'confirm' ? 'confirmed' : 'declined';
      const row = await TableHold.findOneAndUpdate(
        { _id: h._id, status: { $in: from } },
        { $set: { status, respondedAt: new Date(), respondedBy: user.id, declineReason: status === 'declined' ? v.reason || null : null } },
        { new: true, session }
      ).lean();
      if (!row) throw err.conflict('hold_not_pending', 'This table request is no longer open');
      const [a, venue] = await Promise.all([Activity.findById(h.activityId).select('title').session(session).lean(), Venue.findById(h.venueId).select('name').session(session).lean()]);
      const place = (venue && venue.name) || 'The venue';
      const plan = (a && a.title) || 'your plan';
      await notify(session, after, h.hostUserId, {
        type: 'activity',
        title: status === 'confirmed' ? `${place} is holding your table` : `${place} can't hold a table`,
        body: status === 'confirmed' ? `${plan}: table for ${row.partySize}, ${L.istWhen(row.startsAt)}.` : `${plan}${row.declineReason ? `: ${row.declineReason}` : '.'} You can still meet there or pick another spot.`,
        data: { activityId: h.activityId, holdId: h._id, target: { screen: 'activity_detail', params: { id: h.activityId } } },
      });
      await audit({ actorUserId: user.id, action: `table_hold.${v.decision}`, targetType: 'table_hold', targetId: h._id, metadata: { reason: v.reason || null }, ip: req.ip }, { session });
      return row;
    });
    return presentHold(out, { business: true });
  },
};

module.exports = { routes };
