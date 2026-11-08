'use strict';
require('./helpers/env');
// Webhook secrets must be in the environment before config is first required.
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.RAZORPAY_KEY_SECRET = 'key_secret_test';
process.env.GOOGLE_RTDN_TOKEN = 'rtdn-token-test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser } = require('./helpers/groupD');

let skip = null;
let app;
let call;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  app = await startApp(['webhooks', 'monetization']);
  call = client(app.base);
});

test.after(async () => {
  if (app) await app.close();
  await stopMongo();
});

test.beforeEach(async () => {
  if (!skip) await clearCollections();
});

const sign = (raw, secret = 'whsec_test_secret') => crypto.createHmac('sha256', secret).update(raw).digest('hex');

async function businessWithInvoice(months = 1) {
  const owner = await makeUser({ name: 'Owner' });
  const { BusinessProfile, BusinessInvoice } = require('../src/models');
  const b = await BusinessProfile.create({ ownerUserId: owner.id, name: 'Dice Café', kind: 'venue', staff: [{ userId: owner.id, role: 'owner' }] });
  const inv = await BusinessInvoice.create({ businessId: b._id, planCode: `venue_${months}m`, amountMinor: 99900 * months, razorpayOrderId: 'order_TEST1' });
  return { owner, b, inv };
}

const capturedEvent = (orderId = 'order_TEST1', paymentId = 'pay_TEST1') =>
  JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } } });

test('razorpay webhook: a bad signature is rejected and changes nothing', async (t) => {
  if (skip) return t.skip(skip);
  const { inv } = await businessWithInvoice();
  const raw = capturedEvent();
  const bad = await call('POST', '/v1/webhooks/razorpay', { raw, headers: { 'x-razorpay-signature': sign(raw, 'wrong-secret'), 'x-razorpay-event-id': 'evt_1' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'invalid_signature');
  const missing = await call('POST', '/v1/webhooks/razorpay', { raw });
  assert.equal(missing.status, 401);
  const nonHex = await call('POST', '/v1/webhooks/razorpay', { raw, headers: { 'x-razorpay-signature': 'zz'.repeat(32) } });
  assert.equal(nonHex.status, 401);
  const { BusinessInvoice, WebhookEvent } = require('../src/models');
  assert.equal((await BusinessInvoice.findById(inv._id).lean()).status, 'created');
  assert.equal(await WebhookEvent.countDocuments({}), 0);
});

test('razorpay webhook: payment.captured marks the invoice paid and extends the Venue plan; replays are no-ops', async (t) => {
  if (skip) return t.skip(skip);
  const { owner, inv } = await businessWithInvoice(2);
  const raw = capturedEvent();
  const headers = { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_1' };
  const r = await call('POST', '/v1/webhooks/razorpay', { raw, headers });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });

  const { BusinessInvoice, Entitlement, AuditEvent, WebhookEvent } = require('../src/models');
  const paid = await BusinessInvoice.findById(inv._id).lean();
  assert.equal(paid.status, 'paid');
  assert.equal(paid.razorpayPaymentId, 'pay_TEST1');
  const e = await Entitlement.findOne({ userId: owner.id, entitlement: 'venue' }).lean();
  assert.equal(e.source, 'razorpay');
  const days = (new Date(e.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 59 && days <= 60.01, `expected ~60 days, got ${days}`);
  assert.ok(await AuditEvent.exists({ action: 'invoice.paid', targetId: inv._id }));

  const replay = await call('POST', '/v1/webhooks/razorpay', { raw, headers });
  assert.deepEqual(replay.body, { ok: true, duplicate: true });
  // A different event id for the same order must not extend the plan twice.
  const raw2 = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: 'order_TEST1' } }, payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST1' } } } });
  const second = await call('POST', '/v1/webhooks/razorpay', { raw: raw2, headers: { 'x-razorpay-signature': sign(raw2), 'x-razorpay-event-id': 'evt_2' } });
  assert.equal(second.status, 200);
  const e2 = await Entitlement.findOne({ userId: owner.id, entitlement: 'venue' }).lean();
  assert.equal(new Date(e2.expiresAt).getTime(), new Date(e.expiresAt).getTime());
  assert.equal(await WebhookEvent.countDocuments({ provider: 'razorpay' }), 2);
});

test('razorpay webhook: payment.failed and refund.processed update the invoice', async (t) => {
  if (skip) return t.skip(skip);
  const { inv } = await businessWithInvoice();
  const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_TEST1' } } } });
  await call('POST', '/v1/webhooks/razorpay', { raw: failed, headers: { 'x-razorpay-signature': sign(failed), 'x-razorpay-event-id': 'evt_f' } });
  const { BusinessInvoice } = require('../src/models');
  assert.equal((await BusinessInvoice.findById(inv._id).lean()).status, 'failed');
  const refund = JSON.stringify({ event: 'refund.processed', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_TEST1' } } } });
  await call('POST', '/v1/webhooks/razorpay', { raw: refund, headers: { 'x-razorpay-signature': sign(refund), 'x-razorpay-event-id': 'evt_r' } });
  assert.equal((await BusinessInvoice.findById(inv._id).lean()).status, 'refunded');
});

test('checkout fast path: signature verified with the key secret; staff only', async (t) => {
  if (skip) return t.skip(skip);
  const { owner, inv } = await businessWithInvoice();
  const signature = crypto.createHmac('sha256', 'key_secret_test').update('order_TEST1|pay_FAST').digest('hex');
  const stranger = await makeUser();
  const nope = await call('POST', '/v1/business/payments/verify', { token: stranger.token, body: { orderId: 'order_TEST1', paymentId: 'pay_FAST', signature } });
  assert.equal(nope.body.code, 'invoice_not_found');
  const bad = await call('POST', '/v1/business/payments/verify', { token: owner.token, body: { orderId: 'order_TEST1', paymentId: 'pay_FAST', signature: 'ab'.repeat(32) } });
  assert.equal(bad.body.code, 'invalid_signature');
  const ok = await call('POST', '/v1/business/payments/verify', { token: owner.token, body: { orderId: 'order_TEST1', paymentId: 'pay_FAST', signature } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { status: 'paid', invoiceId: inv._id });
  const me = await call('GET', '/v1/business/venues/me', { token: owner.token });
  assert.equal(me.status, 404); // no venue row in this fixture — business only
});

test('google RTDN: token checked; unmatched purchases acknowledged; idempotent per message id', async (t) => {
  if (skip) return t.skip(skip);
  const data = Buffer.from(JSON.stringify({ subscriptionNotification: { purchaseToken: 'pt-unknown', notificationType: 4 } })).toString('base64');
  const body = { message: { messageId: 'm-1', data } };
  const wrong = await call('POST', '/v1/webhooks/google?token=nope', { body });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'invalid_token');
  const ok = await call('POST', '/v1/webhooks/google?token=rtdn-token-test', { body });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, unmatched: true });
  const dup = await call('POST', '/v1/webhooks/google?token=rtdn-token-test', { body });
  assert.deepEqual(dup.body, { ok: true, duplicate: true });
});

test('google RTDN: a known purchase is re-fetched from Play and applied', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  const { Subscription, Entitlement } = require('../src/models');
  await Subscription.create({ userId: u.id, store: 'google', productId: 'irl_plus_monthly', status: 'active', storeTransactionId: 'GPA.1', originalTransactionId: 'pt-known' });
  await require('../src/lib/entitlements').grant({ userId: u.id, entitlement: 'plus', source: 'google', sourceRef: 'pt-known', expiresAt: new Date(Date.now() + 86400000) });
  const playstore = require('../src/lib/payments/playstore');
  const real = playstore.getSubscription;
  playstore.getSubscription = async () => ({ store: 'google', productId: 'irl_plus_monthly', transactionId: 'GPA.1', originalTransactionId: 'pt-known', expiresAt: null, active: false, revoked: true, raw: {} });
  try {
    const data = Buffer.from(JSON.stringify({ subscriptionNotification: { purchaseToken: 'pt-known', notificationType: 13 } })).toString('base64');
    const r = await call('POST', '/v1/webhooks/google?token=rtdn-token-test', { body: { message: { messageId: 'm-2', data } } });
    assert.deepEqual(r.body, { ok: true });
    const s = await Subscription.findOne({ originalTransactionId: 'pt-known' }).lean();
    assert.equal(s.status, 'revoked');
    const e = await Entitlement.findOne({ userId: u.id, entitlement: 'plus' }).lean();
    assert.ok(new Date(e.expiresAt) <= new Date());
  } finally {
    playstore.getSubscription = real;
  }
});

test('apple notifications: not configured → 503; failures release the dedupe record', async (t) => {
  if (skip) return t.skip(skip);
  const r = await call('POST', '/v1/webhooks/apple', { body: { signedPayload: 'a.b.c' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'billing_not_configured');
  const { WebhookEvent } = require('../src/models');
  assert.equal(await WebhookEvent.countDocuments({ provider: 'apple' }), 0);
});
