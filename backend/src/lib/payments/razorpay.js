'use strict';
// Razorpay — ONLY for Venue/Club plan invoices (B2B). No wallet, no stored
// balances, no customer-fund custody, no splitting of merchant proceeds.
// Credentials: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
const crypto = require('crypto');
const config = require('../../config');

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

const HEX = /^(?:[0-9a-f]{2})+$/i;

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !HEX.test(a) || !HEX.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// X-Razorpay-Signature over the raw webhook body (use req.rawBody()).
function verifyWebhookSignature(rawBody, signature, webhookSecret = config.razorpay.webhookSecret) {
  if (!webhookSecret || !signature) return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), String(signature));
}

// Checkout handler signature: HMAC(order_id + "|" + payment_id, key_secret).
function verifyPaymentSignature(orderId, paymentId, signature, keySecret = config.razorpay.keySecret) {
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), String(signature));
}

async function secrets() {
  return { key_secret: config.razorpay.keySecret || null, webhook_secret: config.razorpay.webhookSecret || null };
}

async function createOrder({ amountMinor, currency = 'INR', receipt, notes }) {
  const keyId = config.razorpay.keyId;
  const keySecret = config.razorpay.keySecret;
  if (!keyId || !keySecret) {
    const e = new Error('Razorpay is not configured');
    e.code = 'payments_not_configured';
    throw e;
  }
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: amountMinor, currency, receipt, notes, payment_capture: 1 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`razorpay order failed: ${data && data.error && data.error.description}`);
  return { orderId: data.id, amountMinor: data.amount, currency: data.currency, keyId };
}

module.exports = { hmacHex, safeEqualHex, verifyWebhookSignature, verifyPaymentSignature, createOrder, secrets };
