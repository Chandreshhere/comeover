'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser } = require('./helpers/groupD');

let skip = null;
let app;
let call;
const appstore = require('../src/lib/payments/appstore');
const playstore = require('../src/lib/payments/playstore');
const realGetTransaction = appstore.getTransaction;
const realGetSubscription = playstore.getSubscription;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  app = await startApp(['monetization']);
  call = client(app.base);
});

test.after(async () => {
  appstore.getTransaction = realGetTransaction;
  playstore.getSubscription = realGetSubscription;
  if (app) await app.close();
  await stopMongo();
});

test.beforeEach(async () => {
  if (skip) return;
  await clearCollections();
  appstore.getTransaction = realGetTransaction;
  playstore.getSubscription = realGetSubscription;
});

const applePurchase = (over = {}) => ({
  store: 'apple',
  productId: 'irl_plus_monthly',
  transactionId: 'tx-1',
  originalTransactionId: 'otx-1',
  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  revoked: false,
  raw: {},
  ...over,
});

test('GET /plans: items wrapped with nextCursor, never-gated list, store product ids', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  const r = await call('GET', '/v1/plans', { token: u.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((p) => p.planId), ['free', 'plus', 'pro', 'venue']);
  assert.equal(r.body.nextCursor, null);
  assert.ok(r.body.neverGated.includes('safety'));
  assert.equal(r.body.items[1].productIds.apple, 'irl_plus_monthly');
  assert.equal(r.body.items[3].billing, 'razorpay_invoice');
  const anon = await call('GET', '/v1/plans');
  assert.equal(anon.status, 401);
});

test('receipt verify: a verified Apple purchase grants the server-owned entitlement', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  appstore.getTransaction = async (id) => (id === 'tx-1' ? applePurchase({ raw: { appAccountToken: u.id } }) : null);
  const r = await call('POST', '/v1/subscriptions/receipt/verify', { token: u.token, body: { store: 'apple', transactionId: 'tx-1' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tier, 'plus');
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.store, 'apple');
  const { Entitlement, Subscription, AuditEvent } = require('../src/models');
  const e = await Entitlement.findOne({ userId: u.id, entitlement: 'plus' }).lean();
  assert.equal(e.source, 'apple');
  assert.equal(e.sourceRef, 'otx-1');
  assert.equal(await Subscription.countDocuments({ userId: u.id }), 1);
  assert.ok(await AuditEvent.exists({ action: 'subscription.verify', actorUserId: u.id }));

  const me = await call('GET', '/v1/me/subscription', { token: u.token });
  assert.equal(me.body.tier, 'plus');

  // Same receipt again is an update, not a second subscription.
  await call('POST', '/v1/subscriptions/receipt/verify', { token: u.token, body: { store: 'apple', transactionId: 'tx-1' } });
  assert.equal(await Subscription.countDocuments({ userId: u.id }), 1);

  // A refunded/revoked transaction removes access.
  appstore.getTransaction = async () => applePurchase({ revoked: true, raw: { appAccountToken: u.id } });
  const revoked = await call('POST', '/v1/subscriptions/receipt/verify', { token: u.token, body: { store: 'apple', transactionId: 'tx-1' } });
  assert.equal(revoked.body.tier, 'free');
});

test('receipt verify: purchases are bound to one account; validation and config errors', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser({ name: 'A' });
  const b = await makeUser({ name: 'B' });
  appstore.getTransaction = async () => applePurchase();
  const ok = await call('POST', '/v1/subscriptions/receipt/verify', { token: a.token, body: { store: 'apple', transactionId: 'tx-1' } });
  assert.equal(ok.status, 200);
  const stolen = await call('POST', '/v1/subscriptions/receipt/verify', { token: b.token, body: { store: 'apple', transactionId: 'tx-1' } });
  assert.equal(stolen.status, 409);
  assert.equal(stolen.body.code, 'purchase_belongs_to_another_account');

  // appAccountToken bound to someone else
  appstore.getTransaction = async () => applePurchase({ transactionId: 'tx-9', originalTransactionId: 'otx-9', raw: { appAccountToken: a.id } });
  const bound = await call('POST', '/v1/subscriptions/receipt/verify', { token: b.token, body: { store: 'apple', transactionId: 'tx-9' } });
  assert.equal(bound.body.code, 'purchase_belongs_to_another_account');

  const noToken = await call('POST', '/v1/subscriptions/receipt/verify', { token: a.token, body: { store: 'google' } });
  assert.equal(noToken.status, 400);
  assert.equal(noToken.body.code, 'purchase_token_required');

  appstore.getTransaction = async () => {
    const e = new Error('nope');
    e.code = 'apple_not_configured';
    throw e;
  };
  const unconf = await call('POST', '/v1/subscriptions/receipt/verify', { token: a.token, body: { store: 'apple', transactionId: 'tx-2' } });
  assert.equal(unconf.status, 503);
  assert.equal(unconf.body.code, 'billing_not_configured');

  playstore.getSubscription = async () => null;
  const missing = await call('POST', '/v1/subscriptions/receipt/verify', { token: a.token, body: { store: 'google', purchaseToken: 'pt-x' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'purchase_not_found');
});

test('restore: reports restored and failed items', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  playstore.getSubscription = async (tok) => (tok === 'good' ? { store: 'google', productId: 'irl_pro_monthly', transactionId: 'GPA.1', originalTransactionId: 'good', expiresAt: null, active: true, raw: {} } : null);
  const r = await call('POST', '/v1/subscriptions/restore', { token: u.token, body: { google: { purchaseTokens: ['good', 'bad'] } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tier, 'pro');
  assert.equal(r.body.restored, 1);
  assert.deepEqual(r.body.failed, ['purchase_not_found']);
});

const onboardBody = (userId, over = {}) => ({
  businessName: 'Dice Café',
  kind: 'venue',
  contact: { name: 'Owner', email: 'owner@dice.example' },
  proofKey: `venue_proof/${userId}/doc.pdf`,
  agreements: ['terms', 'sponsorLabelling'],
  venue: { name: 'Dice Café', address: '12 CG Road', area: 'Navrangpura', latitude: 23.03, longitude: 72.56, venueType: 'Board game café', categories: ['boardgames'] },
  ...over,
});

test('venue onboarding: no_venue before, review state after, one business per owner', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser({ name: 'Owner' });
  const before = await call('GET', '/v1/business/venues/me', { token: u.token });
  assert.equal(before.status, 404);
  assert.equal(before.body.code, 'no_venue');

  const badProof = await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id, { proofKey: 'venue_proof/someone-else/doc.pdf' }) });
  assert.equal(badProof.body.code, 'invalid_proof_key');
  const noTerms = await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id, { agreements: { terms: false } }) });
  assert.equal(noTerms.body.code, 'terms_required');

  const r = await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.business.verificationStatus, 'pending');
  assert.equal(r.body.business.role, 'owner');
  assert.ok(r.body.venueId);

  const again = await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id) });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_onboarded');

  const me = await call('GET', '/v1/business/venues/me', { token: u.token });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.status, 'in_review');
  assert.equal(me.body.planStatus, 'none');
  assert.equal(me.body.contact.email, 'owner@dice.example');
  assert.equal(me.body.business.role, 'owner');
  assert.equal(me.body.verified, false);
  assert.deepEqual(me.body.upcomingPlans, []);
  assert.match(me.body.sponsorDisclosure, /Sponsored/);

  const minor = await makeUser({ ageVerified: false });
  const gated = await call('POST', '/v1/business/venues', { token: minor.token, body: onboardBody(minor.id) });
  assert.equal(gated.body.code, 'age_gate_required');
});

test('campaigns: verified business with a Venue plan creates a labelled Sponsored campaign in review', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser({ name: 'Owner' });
  await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id) });
  const body = { title: 'Friday board-game night', budgetMinor: 50000, startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 8 * 86400000).toISOString() };

  const none = await makeUser();
  const nb = await call('GET', '/v1/business/campaigns', { token: none.token });
  assert.equal(nb.status, 403);
  assert.equal(nb.body.code, 'no_business');

  const pending = await call('POST', '/v1/business/campaigns', { token: u.token, body });
  assert.equal(pending.body.code, 'business_not_verified');

  const { BusinessProfile, CampaignMetric } = require('../src/models');
  await BusinessProfile.updateOne({ ownerUserId: u.id }, { $set: { verificationStatus: 'verified' } });
  const noPlan = await call('POST', '/v1/business/campaigns', { token: u.token, body });
  assert.equal(noPlan.body.code, 'venue_plan_required');

  await require('../src/lib/entitlements').grant({ userId: u.id, entitlement: 'venue', source: 'grant', expiresAt: new Date(Date.now() + 30 * 86400000) });
  const badDates = await call('POST', '/v1/business/campaigns', { token: u.token, body: { ...body, endsAt: body.startsAt } });
  assert.equal(badDates.body.code, 'invalid_dates');

  const c = await call('POST', '/v1/business/campaigns', { token: u.token, body });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.label, 'Sponsored');
  assert.equal(c.body.status, 'pending_review');
  assert.equal(c.body.budgetMinor, 50000);

  await CampaignMetric.create({ campaignId: c.body.id, day: '2026-11-01', impressions: 40, clicks: 4 });
  const list = await call('GET', '/v1/business/campaigns', { token: u.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].label, 'Sponsored');
  assert.equal(list.body.items[0].metrics.impressions, 40);
  assert.equal(list.body.business.role, 'owner');
});

test('analytics: per-day IST series for the venue and the preceding period', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser({ name: 'Owner' });
  const on = await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id) });
  const { Activity, Participant, ActivityDailyMetric } = require('../src/models');
  const a = await Activity.create({ hostUserId: u.id, category: 'boardgames', title: 'Catan', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000), venueId: on.body.venueId, latitude: 23.03, longitude: 72.56 });
  const guest = await makeUser({ name: 'Guest' });
  await Participant.create({ activityId: a._id, userId: guest.id, state: 'requested', requestedAt: new Date() });
  await Participant.create({ activityId: a._id, userId: u.id, state: 'accepted', requestedAt: new Date() }); // host row is not a join
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  await ActivityDailyMetric.create({ activityId: a._id, day: today, views: 7 });

  const r = await call('GET', '/v1/business/analytics?range=7d', { token: u.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.days.length, 7);
  assert.equal(r.body.days[6], today);
  assert.equal(r.body.series.planViews.length, 7);
  assert.equal(r.body.totals.planViews, 7);
  assert.equal(r.body.totals.joins, 1);
  assert.equal(r.body.previousTotals.joins, 0);
  assert.equal(r.body.venue.id, on.body.venueId);

  const staffless = await makeUser();
  const denied = await call('GET', '/v1/business/analytics', { token: staffless.token });
  assert.equal(denied.body.code, 'no_business');
});

test('payments order: owner only; not configured → 503', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser({ name: 'Owner' });
  await call('POST', '/v1/business/venues', { token: u.token, body: onboardBody(u.id) });
  const r = await call('POST', '/v1/business/payments/order', { token: u.token, body: { months: 1 } });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'payments_not_configured');
  const { BusinessInvoice } = require('../src/models');
  const inv = await BusinessInvoice.findOne({}).lean();
  assert.equal(inv.status, 'failed');
});
