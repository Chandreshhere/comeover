'use strict';
// Plans, store subscriptions (Apple IAP / Google Play Billing — verified
// server-side, entitlements server-owned) and the business hub (venue
// onboarding, labelled sponsored campaigns, analytics, Razorpay invoices for
// the Venue/Club plan). No wallet, no stored balances, no custody.
//
// GET /v1/venues and GET /v1/venues/{venueId} live in handlers/discovery.js.
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult } = require('../lib/auth');
const { audit } = require('../lib/audit');
const ent = require('../lib/entitlements');
const media = require('../lib/media');
const geo = require('../lib/geo');
const { withIdempotency } = require('../lib/idempotency');
const razorpay = require('../lib/payments/razorpay');
const config = require('../config');
const billing = require('../services/billing');

const SPONSOR_DISCLOSURE = 'Sponsored plans are always labelled "Sponsored" and never outrank relevance or bypass safety checks. We do not guarantee attendance.';
const IST_OFFSET_MS = 330 * 60000;
const VERIFICATION_TO_STATUS = { pending: 'in_review', verified: 'verified', rejected: 'rejected', suspended: 'suspended' };

// ----- presenters -----
function presentVenue(v, { business = null, sponsored = false, distanceM = null } = {}) {
  return {
    id: v._id,
    name: v.name,
    area: v.area || null,
    address: v.address || null,
    venueType: v.venueType || null,
    categories: v.categorySlugs || [],
    description: v.description || null,
    offers: v.offers || [],
    bookingUrl: v.bookingUrl || null,
    verified: !!v.verified,
    sponsored: !!sponsored,
    latitude: v.latitude, // venues are public businesses; the exact location is intended
    longitude: v.longitude,
    distanceM: distanceM != null ? geo.coarseDistanceMeters(Number(distanceM)) : null,
    business: business ? { id: business._id, name: business.name, verified: business.verificationStatus === 'verified' } : null,
  };
}

const presentBusiness = (b, role) => ({ id: b._id, name: b.name, kind: b.kind, verificationStatus: b.verificationStatus, role: role || 'owner', createdAt: b.createdAt });

function presentCampaign(c, metrics) {
  return {
    id: c._id,
    businessId: c.businessId,
    activityId: c.activityId || null,
    title: c.title,
    audience: c.audience || {},
    budgetMinor: Number(c.budgetMinor),
    spentMinor: Number(c.spentMinor || 0),
    currency: c.currency,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    status: c.status,
    label: c.label || 'Sponsored',
    metrics: metrics ? { impressions: metrics.impressions || 0, clicks: metrics.clicks || 0, joinRequests: metrics.joinRequests || 0, checkIns: metrics.checkIns || 0 } : undefined,
  };
}

// Activity presentation belongs to the activities port (lib/present.activity or
// services/activities.present). Fall back to a compact public summary until it exists.
async function presentPlans(rows, viewerId) {
  let fn = null;
  try {
    const P = require('../lib/present');
    if (typeof P.activity === 'function') fn = (a) => P.activity(a, { viewerId });
  } catch (e) {
    fn = null;
  }
  if (!fn) {
    try {
      const A = require('../services/activities');
      if (typeof A.present === 'function') fn = (a) => A.present(a, { viewerId });
    } catch (e) {
      fn = null;
    }
  }
  if (!fn) {
    fn = (a) => ({
      id: a._id,
      title: a.title,
      category: a.category,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      capacity: a.capacity,
      joinedCount: a.acceptedCount || 0,
      area: a.coarseArea || null,
      venueName: null,
      venueId: a.venueId || null,
      status: a.status,
      sponsored: !!a.sponsoredCampaignId,
    });
  }
  return Promise.all(rows.map((a) => fn(a)));
}

// ----- helpers -----
// The user's business (as staff). Throws 403 no_business.
async function myBusiness(userId, businessId) {
  const { BusinessProfile } = require('../models');
  const filter = { 'staff.userId': String(userId) };
  if (businessId) filter._id = String(businessId);
  const b = await BusinessProfile.findOne(filter).sort({ createdAt: 1 }).lean();
  if (!b) throw err.forbidden('no_business', 'Set up a business profile first');
  const role = ((b.staff || []).find((s) => s.userId === userId) || {}).role || 'staff';
  return { ...b, role };
}

// Plans at a venue: pinned by venueId, or legacy plans that name the venue in the same area.
const plansAtVenue = (v) => ({ $or: [{ venueId: v._id }, { venueId: null, venueName: v.name, coarseArea: v.area }] });

const istDay = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// IST day strings for a window of `days` days ending today (IST), plus UTC bounds.
function windowOf(days, endOffsetDays = 0) {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const startUtcMidnight = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - (days - 1) - endOffsetDays);
  const list = Array.from({ length: days }, (_, i) => new Date(startUtcMidnight + i * 86400000).toISOString().slice(0, 10));
  const from = new Date(startUtcMidnight - IST_OFFSET_MS);
  const to = new Date(from.getTime() + days * 86400000);
  return { days: list, from, to };
}

const routes = {
  'GET /v1/plans': async (req) => {
    await requireUser(req, { allowSuspended: true });
    const items = ent.plansWithFeatures().map((p) => ({
      id: p.code,
      planId: p.code,
      name: p.name,
      priceMonthlyInr: p.priceMonthlyInr,
      alternativeTestPriceInr: p.alternativeTestPriceInr || null,
      features: p.features,
      productIds: p.store ? { apple: p.store.apple, google: p.store.google } : null,
      audience: p.target,
      billing: p.billing || (p.store ? 'store' : 'free'),
    }));
    return { items, neverGated: [...ent.NEVER_GATED], currency: 'INR', nextCursor: null };
  },

  'GET /v1/me/subscription': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    return billing.subscriptionOf(user.id);
  },

  'POST /v1/subscriptions/receipt/verify': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        store: { type: 'string', required: true, enum: ['apple', 'google'] },
        transactionId: { type: 'string', max: 128 },
        purchaseToken: { type: 'string', max: 4096 },
        productId: { type: 'string', max: 128 },
      },
      req.body
    );
    if (v.store === 'apple' && !v.transactionId) throw err.badRequest('transaction_id_required');
    if (v.store === 'google' && !v.purchaseToken) throw err.badRequest('purchase_token_required');
    return withIdempotency(req, user.id, async () => {
      await billing.verifyOne(user.id, v);
      return billing.subscriptionOf(user.id);
    });
  },

  'POST /v1/subscriptions/restore': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        apple: { type: 'object', fields: { transactionIds: { type: 'array', max: 50, items: { type: 'string', max: 128 } } } },
        google: { type: 'object', fields: { purchaseTokens: { type: 'array', max: 50, items: { type: 'string', max: 4096 } } } },
      },
      req.body
    );
    const results = [];
    for (const id of (v.apple && v.apple.transactionIds) || []) results.push(await billing.verifyOne(user.id, { store: 'apple', transactionId: id }).then(() => 'ok', (e) => e.code || 'error'));
    for (const t of (v.google && v.google.purchaseTokens) || []) results.push(await billing.verifyOne(user.id, { store: 'google', purchaseToken: t }).then(() => 'ok', (e) => e.code || 'error'));
    return { ...(await billing.subscriptionOf(user.id)), restored: results.filter((r) => r === 'ok').length, failed: results.filter((r) => r !== 'ok') };
  },

  // ----- business hub -----
  'POST /v1/business/venues': async (req) => {
    const { BusinessProfile, Venue } = require('../models');
    const user = await requireUser(req);
    assertAdult(user);
    const body = req.body || {};
    const contactIn = body.contact && typeof body.contact === 'object' ? body.contact : {};
    const v = check(
      {
        businessName: { type: 'string', required: true, min: 2, max: 80 },
        kind: { type: 'string', required: true, enum: ['venue', 'club', 'organiser'] },
        contactEmail: { type: 'string', required: true, max: 120, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ },
        contactName: { type: 'string', max: 80 },
        contactPhone: { type: 'string', max: 20 },
        gstin: { type: 'string', pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/ },
        proofKey: { type: 'string', required: true, max: 200 },
        planId: { type: 'string', enum: ['venue', 'club'], default: 'venue' },
        agreements: { type: 'object', required: true, fields: { terms: { type: 'boolean', required: true }, sponsorLabelling: { type: 'boolean' }, noGuaranteedAttendance: { type: 'boolean' } } },
        venue: {
          type: 'object',
          required: true,
          fields: {
            name: { type: 'string', required: true, max: 80 },
            address: { type: 'string', required: true, max: 200 },
            area: { type: 'string', required: true, max: 60 },
            latitude: { type: 'number', required: true, min: -90, max: 90 },
            longitude: { type: 'number', required: true, min: -180, max: 180 },
            venueType: { type: 'string', required: true, max: 40 },
            categories: { type: 'array', max: 8, items: { type: 'string', format: 'slug' }, default: () => [] },
            bookingUrl: { type: 'string', max: 300, pattern: /^https:\/\// },
            description: { type: 'string', max: 1000 },
          },
        },
      },
      {
        ...body,
        contactEmail: body.contactEmail || contactIn.email,
        contactName: body.contactName || contactIn.name,
        contactPhone: body.contactPhone || contactIn.phone,
        agreements: Array.isArray(body.agreements) ? Object.fromEntries(body.agreements.filter((a) => typeof a === 'string').map((a) => [a, true])) : body.agreements,
      }
    );
    if (!v.agreements.terms) throw err.badRequest('terms_required', 'Accept the partner terms to continue');
    if (!media.isOwnedKey(v.proofKey, 'venue_proof', user.id)) throw err.badRequest('invalid_proof_key');
    if (await BusinessProfile.exists({ 'staff.userId': user.id })) throw err.conflict('already_onboarded', 'You already have a business profile');
    const out = await db.withTransaction(async (session) => {
      const [b] = await BusinessProfile.create(
        [
          {
            ownerUserId: user.id,
            name: v.businessName,
            kind: v.kind,
            contactEmail: v.contactEmail,
            contactName: v.contactName || null,
            contactPhone: v.contactPhone || null,
            gstin: v.gstin || null,
            verificationDocKey: v.proofKey,
            planId: v.planId,
            agreements: { ...v.agreements, acceptedAt: new Date().toISOString() },
            staff: [{ userId: user.id, role: 'owner' }],
          },
        ],
        { session }
      );
      const [ven] = await Venue.create(
        [
          {
            businessId: b._id,
            name: v.venue.name,
            address: v.venue.address,
            area: v.venue.area,
            latitude: v.venue.latitude,
            longitude: v.venue.longitude,
            venueType: v.venue.venueType,
            categorySlugs: v.venue.categories,
            bookingUrl: v.venue.bookingUrl || null,
            description: v.venue.description || null,
            verified: false,
          },
        ],
        { session }
      );
      await audit({ actorUserId: user.id, action: 'business.onboard', targetType: 'business', targetId: b._id, ip: req.ip }, { session });
      return { business: presentBusiness(b.toObject(), 'owner'), venueId: ven._id };
    });
    return created({ ...out, message: 'Thanks! We verify every venue before it appears in the app (usually 1–2 working days).' });
  },

  // The signed-in owner's/staff member's venue (business hub home).
  'GET /v1/business/venues/me': async (req) => {
    const { BusinessProfile, Venue, SponsoredCampaign, BusinessInvoice, Activity } = require('../models');
    const user = await requireUser(req);
    const b = await BusinessProfile.findOne({ 'staff.userId': user.id }).sort({ createdAt: 1 }).lean();
    const v = b && (await Venue.findOne({ businessId: b._id }).sort({ createdAt: 1 }).lean());
    if (!b || !v) throw err.notFound('no_venue', 'Set up your venue first');
    const role = ((b.staff || []).find((s) => s.userId === user.id) || {}).role || 'staff';
    const where = plansAtVenue(v);
    const [ents, sponsored, pendingInvoice, plans, planCount] = await Promise.all([
      ent.getActive(b.ownerUserId),
      SponsoredCampaign.exists({ businessId: b._id, status: 'active' }),
      BusinessInvoice.exists({ businessId: b._id, status: 'created', createdAt: { $gt: new Date(Date.now() - 86400000) } }),
      Activity.find({ ...where, status: { $in: ['open', 'full', 'in_progress'] }, endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).limit(10).lean(),
      Activity.countDocuments({ ...where, status: { $ne: 'moderated' } }),
    ]);
    return {
      ...presentVenue(v, { business: b, sponsored: !!sponsored }),
      status: VERIFICATION_TO_STATUS[b.verificationStatus] || 'in_review',
      planId: b.planId || 'venue',
      planStatus: ents.includes('venue') ? 'active' : pendingInvoice ? 'payment_processing' : 'none',
      reviewNote: b.reviewNote || null,
      contact: { name: b.contactName || null, phone: b.contactPhone || null, email: b.contactEmail || null },
      business: { id: b._id, name: b.name, kind: b.kind, role, verified: b.verificationStatus === 'verified' },
      upcomingPlans: await presentPlans(plans, user.id),
      planCount,
      sponsorDisclosure: SPONSOR_DISCLOSURE,
    };
  },

  'GET /v1/business/campaigns': async (req) => {
    const { SponsoredCampaign, CampaignMetric } = require('../models');
    const user = await requireUser(req);
    const b = await myBusiness(user.id, typeof req.query.businessId === 'string' ? req.query.businessId : null);
    const rows = await SponsoredCampaign.find({ businessId: b._id }).sort({ createdAt: -1 }).limit(200).lean();
    const sums = rows.length
      ? await CampaignMetric.aggregate([
          { $match: { campaignId: { $in: rows.map((c) => c._id) } } },
          { $group: { _id: '$campaignId', impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, joinRequests: { $sum: '$joinRequests' }, checkIns: { $sum: '$checkIns' } } },
        ])
      : [];
    const byId = new Map(sums.map((m) => [m._id, m]));
    return { business: presentBusiness(b, b.role), items: rows.map((c) => presentCampaign(c, byId.get(c._id) || {})), nextCursor: null };
  },

  'POST /v1/business/campaigns': async (req) => {
    const { SponsoredCampaign, Activity } = require('../models');
    const user = await requireUser(req);
    const v = check(
      {
        businessId: { type: 'string', format: 'uuid' },
        activityId: { type: 'string', format: 'uuid' },
        title: { type: 'string', required: true, max: 80 },
        audience: {
          type: 'object',
          fields: { areas: { type: 'array', max: 10, items: { type: 'string', max: 60 } }, categories: { type: 'array', max: 10, items: { type: 'string', format: 'slug' } } },
          default: () => ({}),
        },
        budgetMinor: { type: 'integer', required: true, min: 10000, max: 100000000 },
        startsAt: { type: 'string', required: true, format: 'datetime' },
        endsAt: { type: 'string', required: true, format: 'datetime' },
      },
      req.body
    );
    const b = await myBusiness(user.id, v.businessId);
    if (b.verificationStatus !== 'verified') throw err.forbidden('business_not_verified');
    if (!['owner', 'manager'].includes(b.role)) throw err.forbidden('manager_only');
    if (!ent.hasFeature(await ent.getActive(b.ownerUserId), 'sponsored_slots')) throw err.forbidden('venue_plan_required', 'Sponsored plans need an active Venue/Club plan');
    if (new Date(v.endsAt) <= new Date(v.startsAt)) throw err.badRequest('invalid_dates');
    if (v.activityId) {
      const a = await Activity.findOne({ _id: v.activityId, status: { $in: ['open', 'full'] } }).select('hostUserId').lean();
      const isStaff = a && (b.staff || []).some((s) => s.userId === a.hostUserId);
      if (!isStaff) throw err.forbidden('activity_not_owned', 'Sponsor plans hosted by your staff only');
    }
    const c = await db.withTransaction(async (session) => {
      // Always labelled "Sponsored"; starts in review — never auto-published.
      const [doc] = await SponsoredCampaign.create(
        [
          {
            businessId: b._id,
            activityId: v.activityId || null,
            title: v.title,
            audience: v.audience,
            budgetMinor: v.budgetMinor,
            startsAt: new Date(v.startsAt),
            endsAt: new Date(v.endsAt),
            status: 'pending_review',
            label: 'Sponsored',
            createdBy: user.id,
          },
        ],
        { session }
      );
      await audit({ actorUserId: user.id, action: 'campaign.create', targetType: 'campaign', targetId: doc._id, ip: req.ip }, { session });
      return doc.toObject();
    });
    return created(presentCampaign(c));
  },

  'GET /v1/business/analytics': async (req) => {
    const { Venue, Activity, ActivityDailyMetric, Participant, SponsoredCampaign, CampaignMetric } = require('../models');
    const user = await requireUser(req);
    const q = check({ venueId: { type: 'string', format: 'uuid' }, businessId: { type: 'string', format: 'uuid' }, range: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' } }, req.query);
    const b = await myBusiness(user.id, q.businessId);
    const days = parseInt(q.range, 10);
    const venue = await Venue.findOne({ businessId: b._id, ...(q.venueId ? { _id: q.venueId } : {}) }).sort({ createdAt: 1 }).lean();
    if (!venue) throw err.notFound('no_venue', 'Set up your venue first');

    const cur = windowOf(days);
    const prev = windowOf(days, days);
    const allDays = [...prev.days, ...cur.days];
    const acts = await Activity.find(plansAtVenue(venue)).select('_id hostUserId').lean();
    const actIds = acts.map((a) => a._id);
    const hostOf = new Map(acts.map((a) => [a._id, a.hostUserId]));
    const campaignIds = (await SponsoredCampaign.find({ businessId: b._id }).select('_id').lean()).map((c) => c._id);

    const [views, parts, cm] = await Promise.all([
      actIds.length
        ? ActivityDailyMetric.aggregate([{ $match: { activityId: { $in: actIds }, day: { $in: allDays } } }, { $group: { _id: '$day', views: { $sum: '$views' } } }])
        : [],
      actIds.length
        ? Participant.find({ activityId: { $in: actIds }, $or: [{ requestedAt: { $gte: prev.from, $lt: cur.to } }, { checkedInAt: { $gte: prev.from, $lt: cur.to } }] })
            .select('activityId userId requestedAt checkedInAt')
            .limit(100000)
            .lean()
        : [],
      campaignIds.length
        ? CampaignMetric.aggregate([{ $match: { campaignId: { $in: campaignIds }, day: { $in: allDays } } }, { $group: { _id: '$day', impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' } } }])
        : [],
    ]);

    const perDay = new Map(allDays.map((d) => [d, { planViews: 0, joins: 0, checkIns: 0, impressions: 0, clicks: 0 }]));
    for (const r of views) if (perDay.has(r._id)) perDay.get(r._id).planViews += r.views;
    for (const r of cm) {
      if (!perDay.has(r._id)) continue;
      perDay.get(r._id).impressions += r.impressions;
      perDay.get(r._id).clicks += r.clicks;
    }
    for (const p of parts) {
      if (p.requestedAt && p.userId !== hostOf.get(p.activityId)) {
        const d = istDay(new Date(p.requestedAt));
        if (perDay.has(d)) perDay.get(d).joins += 1;
      }
      if (p.checkedInAt) {
        const d = istDay(new Date(p.checkedInAt));
        if (perDay.has(d)) perDay.get(d).checkIns += 1;
      }
    }
    const KEYS = ['planViews', 'joins', 'checkIns', 'impressions', 'clicks'];
    const sum = (list) => Object.fromEntries(KEYS.map((k) => [k, list.reduce((n, d) => n + perDay.get(d)[k], 0)]));
    return {
      range: q.range,
      venue: { id: venue._id, name: venue.name, area: venue.area },
      days: cur.days,
      labels: cur.days.map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })),
      series: Object.fromEntries(KEYS.map((k) => [k, cur.days.map((d) => perDay.get(d)[k])])),
      totals: sum(cur.days),
      previousTotals: sum(prev.days),
      note: 'Attributable actions only. We never guarantee attendance.',
    };
  },

  'POST /v1/business/payments/order': async (req) => {
    const { BusinessInvoice } = require('../models');
    const user = await requireUser(req);
    const v = check({ businessId: { type: 'string', format: 'uuid' }, months: { type: 'integer', min: 1, max: 12, default: 1 } }, req.body);
    const b = await myBusiness(user.id, v.businessId);
    if (b.role !== 'owner') throw err.forbidden('owner_only');
    return withIdempotency(req, user.id, async () => {
      const amountMinor = config.razorpay.venuePlanPriceInr * 100 * v.months;
      const inv = await BusinessInvoice.create({ businessId: b._id, planCode: `venue_${v.months}m`, amountMinor });
      let order;
      try {
        order = await razorpay.createOrder({ amountMinor, receipt: inv._id, notes: { invoiceId: inv._id, businessId: b._id } });
      } catch (e) {
        await BusinessInvoice.updateOne({ _id: inv._id }, { $set: { status: 'failed' } });
        if (e.code === 'payments_not_configured') throw err.unavailable('payments_not_configured', 'Payments are not configured on the server yet');
        throw e;
      }
      await BusinessInvoice.updateOne({ _id: inv._id }, { $set: { razorpayOrderId: order.orderId } });
      return created({
        invoiceId: inv._id,
        orderId: order.orderId,
        amountMinor: order.amountMinor,
        currency: order.currency,
        keyId: order.keyId,
        description: `Come Over Venue/Club plan · ${v.months} month(s)`,
        businessName: b.name,
      });
    });
  },

  // Optional fast path after Razorpay Checkout returns; the webhook remains the source of truth.
  'POST /v1/business/payments/verify': async (req) => {
    const { BusinessInvoice, BusinessProfile } = require('../models');
    const user = await requireUser(req);
    const v = check({ orderId: { type: 'string', required: true, max: 64 }, paymentId: { type: 'string', required: true, max: 64 }, signature: { type: 'string', required: true, max: 256 } }, req.body);
    const inv = await BusinessInvoice.findOne({ razorpayOrderId: v.orderId }).lean();
    const staff = inv && (await BusinessProfile.exists({ _id: inv.businessId, 'staff.userId': user.id }));
    if (!inv || !staff) throw err.notFound('invoice_not_found');
    const { key_secret: keySecret } = await razorpay.secrets();
    if (!keySecret) throw err.unavailable('payments_not_configured', 'Payments are not configured on the server yet');
    if (!razorpay.verifyPaymentSignature(v.orderId, v.paymentId, v.signature, keySecret)) throw err.badRequest('invalid_signature');
    await billing.markInvoicePaid(inv.razorpayOrderId, v.paymentId);
    return { status: 'paid', invoiceId: inv._id };
  },
};

module.exports = { routes, presentVenue, presentCampaign, presentBusiness, applyPurchase: billing.applyPurchase };
