'use strict';
// Plans, store subscriptions (Apple IAP / Google Play Billing — verified
// server-side, entitlements server-owned) and the business hub (venue
// onboarding, labelled sponsored campaigns, analytics, Razorpay invoices for
// the Venue/Club plan). No wallet, no stored balances, no custody.
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult } = require('../lib/auth');
const { audit } = require('../lib/audit');
const ent = require('../lib/entitlements');
const media = require('../lib/media');
const { withIdempotency } = require('../lib/idempotency');
const appstore = require('../lib/payments/appstore');
const playstore = require('../lib/payments/playstore');
const razorpay = require('../lib/payments/razorpay');
const P = require('../lib/present');

const VENUE_PLAN_INR = () => Number(process.env.VENUE_PLAN_PRICE_INR || 999);

async function subscriptionOf(userId) {
  const [ents, sub] = await Promise.all([ent.getActive(db, userId), db.one('SELECT store, status, expires_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId])]);
  return P.subscription(ents, sub);
}

function storeError(e) {
  if (e && /not_configured$/.test(e.code || '')) return err.unavailable('billing_not_configured', 'Store billing is not configured on the server yet');
  return e;
}

// Upsert a verified store purchase and derive the entitlement.
async function applyPurchase(client, userId, p) {
  const owner = await client.query('SELECT user_id FROM subscriptions WHERE original_transaction_id = $1 AND store = $2 LIMIT 1', [p.originalTransactionId, p.store]);
  if (owner.rows[0] && owner.rows[0].user_id !== userId) throw err.conflict('purchase_belongs_to_another_account', 'This purchase is linked to a different account');
  const active = p.store === 'google' ? p.active : !p.revoked && (!p.expiresAt || new Date(p.expiresAt) > new Date());
  const entitlement = ent.productToEntitlement(p.productId);
  await client.query(
    `INSERT INTO subscriptions (user_id, store, product_id, status, started_at, expires_at, store_transaction_id, original_transaction_id, raw_status, updated_at)
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, now())
     ON CONFLICT (store_transaction_id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, raw_status = EXCLUDED.raw_status, updated_at = now()`,
    [userId, p.store, p.productId, active ? 'active' : p.revoked ? 'revoked' : 'expired', p.expiresAt, p.transactionId, p.originalTransactionId, JSON.stringify(p.raw || {})]
  );
  if (entitlement) {
    if (active) await ent.grant(client, { userId, entitlement, source: p.store, sourceRef: p.originalTransactionId, expiresAt: p.expiresAt });
    else await ent.revoke(client, { userId, entitlement, sourceRef: p.originalTransactionId });
  }
  await audit(client, { actorUserId: userId, action: 'subscription.verify', targetType: 'subscription', targetId: p.transactionId, metadata: { store: p.store, productId: p.productId, active } });
  return active;
}

async function verifyOne(userId, { store, transactionId, purchaseToken }) {
  let p;
  try {
    if (store === 'apple') p = await appstore.getTransaction(transactionId);
    else p = await playstore.getSubscription(purchaseToken);
  } catch (e) {
    throw storeError(e);
  }
  if (!p) throw err.notFound('purchase_not_found');
  // Bind purchases to accounts: clients pass the user id as appAccountToken / obfuscatedExternalAccountId.
  const bound = store === 'apple' ? p.raw.appAccountToken : p.raw.externalAccountIdentifiers && p.raw.externalAccountIdentifiers.obfuscatedExternalAccountId;
  if (bound && bound !== userId) throw err.conflict('purchase_belongs_to_another_account');
  await db.withTransaction((client) => applyPurchase(client, userId, p));
  if (store === 'google' && p.needsAcknowledge) await playstore.acknowledge(p.productId, purchaseToken).catch(() => {});
}

async function myBusiness(userId, businessId) {
  const b = await db.one(
    `SELECT b.*, s.role FROM business_profiles b JOIN business_staff s ON s.business_id = b.id AND s.user_id = $1 WHERE ($2::uuid IS NULL OR b.id = $2) ORDER BY b.created_at LIMIT 1`,
    [userId, businessId || null]
  );
  if (!b) throw err.forbidden('no_business', 'Set up a business profile first');
  return b;
}

const presentBusiness = (b) => ({ id: b.id, name: b.name, kind: b.kind, verificationStatus: b.verification_status, role: b.role || 'owner', createdAt: b.created_at });
const presentCampaign = (c) => ({
  id: c.id,
  businessId: c.business_id,
  activityId: c.activity_id,
  title: c.title,
  audience: c.audience,
  budgetMinor: Number(c.budget_minor),
  spentMinor: Number(c.spent_minor || 0),
  currency: c.currency,
  startsAt: c.starts_at,
  endsAt: c.ends_at,
  status: c.status,
  label: c.label,
  metrics: c.impressions != null ? { impressions: c.impressions, clicks: c.clicks, joinRequests: c.join_requests, checkIns: c.check_ins } : undefined,
});

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
    return subscriptionOf(user.id);
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
    return withIdempotency(db, req, user.id, async () => {
      await verifyOne(user.id, v);
      return subscriptionOf(user.id);
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
    for (const id of (v.apple && v.apple.transactionIds) || []) results.push(await verifyOne(user.id, { store: 'apple', transactionId: id }).then(() => 'ok', (e) => e.code || 'error'));
    for (const t of (v.google && v.google.purchaseTokens) || []) results.push(await verifyOne(user.id, { store: 'google', purchaseToken: t }).then(() => 'ok', (e) => e.code || 'error'));
    return { ...(await subscriptionOf(user.id)), restored: results.filter((r) => r === 'ok').length, failed: results.filter((r) => r !== 'ok') };
  },

  // ----- business hub -----
  'POST /v1/business/venues': async (req) => {
    const user = await requireUser(req);
    assertAdult(user);
    const body = req.body || {};
    const contactIn = body.contact || {};
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
        agreements: Array.isArray(body.agreements) ? Object.fromEntries(body.agreements.map((a) => [a, true])) : body.agreements,
      }
    );
    if (!v.agreements.terms) throw err.badRequest('terms_required', 'Accept the partner terms to continue');
    if (!media.isOwnedKey(v.proofKey, 'venue_proof', user.id)) throw err.badRequest('invalid_proof_key');
    const existing = await db.one('SELECT 1 AS x FROM business_staff WHERE user_id = $1 LIMIT 1', [user.id]);
    if (existing) throw err.conflict('already_onboarded', 'You already have a business profile');
    const out = await db.withTransaction(async (client) => {
      const { rows: b } = await client.query(
        `INSERT INTO business_profiles (owner_user_id, name, kind, contact_email, contact_name, contact_phone, gstin, verification_doc_key, plan_id, agreements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [user.id, v.businessName, v.kind, v.contactEmail, v.contactName || null, v.contactPhone || null, v.gstin || null, v.proofKey, v.planId, JSON.stringify({ ...v.agreements, acceptedAt: new Date().toISOString() })]
      );
      await client.query("INSERT INTO business_staff (business_id, user_id, role) VALUES ($1, $2, 'owner')", [b[0].id, user.id]);
      const { rows: ven } = await client.query(
        `INSERT INTO venues (business_id, name, address, area, latitude, longitude, venue_type, category_slugs, booking_url, description, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE) RETURNING id`,
        [b[0].id, v.venue.name, v.venue.address, v.venue.area, v.venue.latitude, v.venue.longitude, v.venue.venueType, v.venue.categories, v.venue.bookingUrl || null, v.venue.description || null]
      );
      await audit(client, { actorUserId: user.id, action: 'business.onboard', targetType: 'business', targetId: b[0].id, ip: req.ip });
      return { business: presentBusiness({ ...b[0], role: 'owner' }), venueId: ven[0].id };
    });
    return created({ ...out, message: 'Thanks! We verify every venue before it appears in the app (usually 1–2 working days).' });
  },

  'GET /v1/business/campaigns': async (req) => {
    const user = await requireUser(req);
    const b = await myBusiness(user.id, req.query.businessId);
    const rows = await db.many(
      `SELECT c.*, m.impressions, m.clicks, m.join_requests, m.check_ins FROM sponsored_campaigns c
         LEFT JOIN LATERAL (SELECT sum(impressions)::int AS impressions, sum(clicks)::int AS clicks, sum(join_requests)::int AS join_requests, sum(check_ins)::int AS check_ins
                              FROM campaign_metrics WHERE campaign_id = c.id) m ON TRUE
        WHERE c.business_id = $1 ORDER BY c.created_at DESC`,
      [b.id]
    );
    return { business: presentBusiness(b), items: rows.map(presentCampaign), nextCursor: null };
  },

  'POST /v1/business/campaigns': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        businessId: { type: 'string', format: 'uuid' },
        activityId: { type: 'string', format: 'uuid' },
        title: { type: 'string', required: true, max: 80 },
        audience: { type: 'object', fields: { areas: { type: 'array', max: 10, items: { type: 'string', max: 60 } }, categories: { type: 'array', max: 10, items: { type: 'string', format: 'slug' } } }, default: () => ({}) },
        budgetMinor: { type: 'integer', required: true, min: 10000, max: 100000000 },
        startsAt: { type: 'string', required: true, format: 'datetime' },
        endsAt: { type: 'string', required: true, format: 'datetime' },
      },
      req.body
    );
    const b = await myBusiness(user.id, v.businessId);
    if (b.verification_status !== 'verified') throw err.forbidden('business_not_verified');
    if (!['owner', 'manager'].includes(b.role)) throw err.forbidden('manager_only');
    const owner = await db.one('SELECT owner_user_id FROM business_profiles WHERE id = $1', [b.id]);
    if (!ent.hasFeature(await ent.getActive(db, owner.owner_user_id), 'sponsored_slots')) throw err.forbidden('venue_plan_required', 'Sponsored plans need an active Venue/Club plan');
    if (new Date(v.endsAt) <= new Date(v.startsAt)) throw err.badRequest('invalid_dates');
    if (v.activityId) {
      const a = await db.one("SELECT host_user_id FROM activities WHERE id = $1 AND status IN ('open','full')", [v.activityId]);
      const staff = a && (await db.one('SELECT 1 AS ok FROM business_staff WHERE business_id = $1 AND user_id = $2', [b.id, a.host_user_id]));
      if (!staff) throw err.forbidden('activity_not_owned', 'Sponsor plans hosted by your staff only');
    }
    const c = await db.withTransaction(async (client) => {
      // Always labelled "Sponsored"; starts in review — never auto-published.
      const { rows } = await client.query(
        `INSERT INTO sponsored_campaigns (business_id, activity_id, title, audience, budget_minor, starts_at, ends_at, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review', $8) RETURNING *`,
        [b.id, v.activityId || null, v.title, JSON.stringify(v.audience), v.budgetMinor, v.startsAt, v.endsAt, user.id]
      );
      await audit(client, { actorUserId: user.id, action: 'campaign.create', targetType: 'campaign', targetId: rows[0].id, ip: req.ip });
      return rows[0];
    });
    return created(presentCampaign(c));
  },

  // The signed-in owner's/staff member's venue (business hub home).
  'GET /v1/business/venues/me': async (req) => {
    const user = await requireUser(req);
    const v = await db.one(
      `SELECT v.*, b.id AS business_id, b.name AS business_name, b.kind, b.verification_status, b.review_note, b.owner_user_id,
              b.contact_name, b.contact_email, b.contact_phone, b.plan_id, s.role,
              EXISTS (SELECT 1 FROM sponsored_campaigns sc WHERE sc.business_id = b.id AND sc.status = 'active') AS sponsored,
              NULL::float8 AS distance_m
         FROM business_staff s JOIN business_profiles b ON b.id = s.business_id
         JOIN venues v ON v.business_id = b.id
        WHERE s.user_id = $1 ORDER BY b.created_at, v.created_at LIMIT 1`,
      [user.id]
    );
    if (!v) throw err.notFound('no_venue', 'Set up your venue first');
    const [ents, pendingInvoice, plans, planCount] = await Promise.all([
      ent.getActive(db, v.owner_user_id),
      db.one("SELECT 1 AS x FROM business_invoices WHERE business_id = $1 AND status = 'created' AND created_at > now() - interval '1 day' LIMIT 1", [v.business_id]),
      db.many(
        `${require('../services/activities').SELECT} WHERE (a.venue_id = $2 OR (a.venue_id IS NULL AND a.venue_name = $3 AND a.coarse_area = $4))
           AND a.status IN ('open','full','in_progress') AND a.ends_at > now() ORDER BY a.starts_at LIMIT 10`,
        [user.id, v.id, v.name, v.area]
      ),
      db.one("SELECT count(*)::int AS n FROM activities a WHERE (a.venue_id = $1 OR (a.venue_id IS NULL AND a.venue_name = $2 AND a.coarse_area = $3)) AND a.status <> 'moderated'", [v.id, v.name, v.area]),
    ]);
    const A = require('../services/activities');
    const { presentVenue } = require('./discovery');
    const statusMap = { pending: 'in_review', verified: 'verified', rejected: 'rejected', suspended: 'suspended' };
    return {
      ...presentVenue(v),
      status: statusMap[v.verification_status] || 'in_review',
      planId: v.plan_id || 'venue',
      planStatus: ents.includes('venue') ? 'active' : pendingInvoice ? 'payment_processing' : 'none',
      reviewNote: v.review_note || null,
      contact: { name: v.contact_name, phone: v.contact_phone, email: v.contact_email },
      business: { id: v.business_id, name: v.business_name, kind: v.kind, role: v.role, verified: v.verification_status === 'verified' },
      upcomingPlans: plans.map((r) => A.present(r, { viewerId: user.id })),
      planCount: planCount.n,
      sponsorDisclosure: 'Sponsored plans are always labelled "Sponsored" and never outrank relevance or bypass safety checks. We do not guarantee attendance.',
    };
  },

  'GET /v1/business/analytics': async (req) => {
    const user = await requireUser(req);
    const q = check({ venueId: { type: 'string', format: 'uuid' }, range: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' } }, req.query);
    const b = await myBusiness(user.id, req.query.businessId);
    const days = parseInt(q.range, 10);
    const venue = await db.one('SELECT id, name, area FROM venues WHERE business_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at LIMIT 1', [b.id, q.venueId || null]);
    if (!venue) throw err.notFound('no_venue', 'Set up your venue first');
    // Per-day series for plans at the venue + the business's sponsored campaigns (IST days).
    const seriesSql = `
      WITH d AS (SELECT generate_series($3::date, $3::date + ($4::int - 1), interval '1 day')::date AS day),
      acts AS (SELECT a.id, a.host_user_id FROM activities a
                WHERE a.venue_id = $2 OR (a.venue_id IS NULL AND a.venue_name = $5 AND a.coarse_area = $6))
      SELECT d.day,
        COALESCE((SELECT sum(m.views) FROM activity_daily_metrics m WHERE m.day = d.day AND m.activity_id IN (SELECT id FROM acts)), 0)::int AS plan_views,
        (SELECT count(*) FROM activity_participants p JOIN acts ON acts.id = p.activity_id
          WHERE p.user_id <> acts.host_user_id AND (p.requested_at AT TIME ZONE 'Asia/Kolkata')::date = d.day)::int AS joins,
        (SELECT count(*) FROM activity_participants p JOIN acts ON acts.id = p.activity_id
          WHERE p.checked_in_at IS NOT NULL AND (p.checked_in_at AT TIME ZONE 'Asia/Kolkata')::date = d.day)::int AS check_ins,
        COALESCE((SELECT sum(cm.impressions) FROM campaign_metrics cm JOIN sponsored_campaigns sc ON sc.id = cm.campaign_id WHERE sc.business_id = $1 AND cm.day = d.day), 0)::int AS impressions,
        COALESCE((SELECT sum(cm.clicks) FROM campaign_metrics cm JOIN sponsored_campaigns sc ON sc.id = cm.campaign_id WHERE sc.business_id = $1 AND cm.day = d.day), 0)::int AS clicks
      FROM d ORDER BY d.day`;
    const todayIst = new Date(Date.now() + 330 * 60000);
    const start = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() - (days - 1)));
    const prevStart = new Date(start.getTime() - days * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const [cur, prev] = await Promise.all([
      db.many(seriesSql, [b.id, venue.id, iso(start), days, venue.name, venue.area]),
      db.many(seriesSql, [b.id, venue.id, iso(prevStart), days, venue.name, venue.area]),
    ]);
    const keys = { planViews: 'plan_views', joins: 'joins', checkIns: 'check_ins', impressions: 'impressions', clicks: 'clicks' };
    const sum = (rows) => Object.fromEntries(Object.entries(keys).map(([k, col]) => [k, rows.reduce((n, r) => n + r[col], 0)]));
    const dayIso = (r) => (r.day instanceof Date ? iso(r.day) : String(r.day).slice(0, 10));
    return {
      range: q.range,
      venue: { id: venue.id, name: venue.name, area: venue.area },
      days: cur.map(dayIso),
      labels: cur.map((r) => new Date(`${dayIso(r)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })),
      series: Object.fromEntries(Object.entries(keys).map(([k, col]) => [k, cur.map((r) => r[col])])),
      totals: sum(cur),
      previousTotals: sum(prev),
      note: 'Attributable actions only. We never guarantee attendance.',
    };
  },

  'POST /v1/business/payments/order': async (req) => {
    const user = await requireUser(req);
    const v = check({ businessId: { type: 'string', format: 'uuid' }, months: { type: 'integer', min: 1, max: 12, default: 1 } }, req.body);
    const b = await myBusiness(user.id, v.businessId);
    if (b.role !== 'owner') throw err.forbidden('owner_only');
    return withIdempotency(db, req, user.id, async () => {
      const amountMinor = VENUE_PLAN_INR() * 100 * v.months;
      const inv = await db.one("INSERT INTO business_invoices (business_id, plan_code, amount_minor) VALUES ($1, $2, $3) RETURNING id", [b.id, `venue_${v.months}m`, amountMinor]);
      let order;
      try {
        order = await razorpay.createOrder({ amountMinor, receipt: inv.id, notes: { invoiceId: inv.id, businessId: b.id } });
      } catch (e) {
        await db.query("UPDATE business_invoices SET status = 'failed' WHERE id = $1", [inv.id]);
        if (e.code === 'payments_not_configured') throw err.unavailable('payments_not_configured', 'Payments are not configured on the server yet');
        throw e;
      }
      await db.query('UPDATE business_invoices SET razorpay_order_id = $2 WHERE id = $1', [inv.id, order.orderId]);
      return created({ invoiceId: inv.id, orderId: order.orderId, amountMinor: order.amountMinor, currency: order.currency, keyId: order.keyId, description: `Project IRL Venue/Club plan · ${v.months} month(s)`, businessName: b.name });
    });
  },

  // Optional fast path after Razorpay Checkout returns; the webhook remains the source of truth.
  'POST /v1/business/payments/verify': async (req) => {
    const user = await requireUser(req);
    const v = check({ orderId: { type: 'string', required: true, max: 64 }, paymentId: { type: 'string', required: true, max: 64 }, signature: { type: 'string', required: true, max: 256 } }, req.body);
    const inv = await db.one('SELECT i.* FROM business_invoices i JOIN business_staff s ON s.business_id = i.business_id AND s.user_id = $2 WHERE i.razorpay_order_id = $1', [v.orderId, user.id]);
    if (!inv) throw err.notFound('invoice_not_found');
    const { key_secret: keySecret } = await razorpay.secrets();
    if (!razorpay.verifyPaymentSignature(v.orderId, v.paymentId, v.signature, keySecret)) throw err.badRequest('invalid_signature');
    const { markInvoicePaid } = require('./webhooks');
    await markInvoicePaid(inv.razorpay_order_id, v.paymentId);
    return { status: 'paid', invoiceId: inv.id };
  },
};

exports.applyPurchase = applyPurchase;
exports.handler = createRouter(routes);
