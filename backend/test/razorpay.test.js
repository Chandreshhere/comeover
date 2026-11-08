'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const rp = require('../src/lib/payments/razorpay');

const SECRET = 'whsec_test_123';
const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } });
const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

test('accepts a correct webhook signature', () => {
  assert.equal(rp.verifyWebhookSignature(body, sig, SECRET), true);
});

test('rejects tampered body, wrong secret, malformed or missing signature', () => {
  assert.equal(rp.verifyWebhookSignature(body.replace('pay_1', 'pay_2'), sig, SECRET), false);
  assert.equal(rp.verifyWebhookSignature(body, sig, 'other'), false);
  assert.equal(rp.verifyWebhookSignature(body, sig.slice(0, -2), SECRET), false);
  assert.equal(rp.verifyWebhookSignature(body, 'zz'.repeat(32), SECRET), false);
  assert.equal(rp.verifyWebhookSignature(body, undefined, SECRET), false);
  assert.equal(rp.verifyWebhookSignature(body, sig, ''), false);
});

test('checkout payment signature = HMAC(order_id|payment_id, key_secret)', () => {
  const key = 'rzp_secret';
  const good = crypto.createHmac('sha256', key).update('order_9|pay_9').digest('hex');
  assert.equal(rp.verifyPaymentSignature('order_9', 'pay_9', good, key), true);
  assert.equal(rp.verifyPaymentSignature('order_9', 'pay_8', good, key), false);
  assert.equal(rp.verifyPaymentSignature('order_9', 'pay_9', good, null), false);
});
