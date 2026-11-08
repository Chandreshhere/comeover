'use strict';
// Razorpay — ONLY for Venue/Club plan invoices (B2B). No wallet, no stored
// balances, no customer-fund custody, no splitting of merchant proceeds.
// Credentials: RAZORPAY_KEY_ID + RAZORPAY_SECRET_ARN (JSON {key_secret, webhook_secret}). TODO(credentials).
const crypto = require('crypto');

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

const HEX = /^(?:[0-9a-f]{2})+$/i;

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !HEX.test(a) || !HEX.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// X-Razorpay-Signature over the raw webhook body.
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!webhookSecret || !signature) return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), String(signature));
}

// Checkout handler signature: HMAC(order_id + "|" + payment_id, key_secret).
function verifyPaymentSignature(orderId, paymentId, signature, keySecret) {
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), String(signature));
}

let secretsPromise;
async function secrets() {
  if (!secretsPromise) {
    secretsPromise = (async () => {
      if (process.env.RAZORPAY_SECRET_ARN) {
        const { getSecretJson } = require('../aws');
        return getSecretJson(process.env.RAZORPAY_SECRET_ARN);
      }
      return { key_secret: process.env.RAZORPAY_KEY_SECRET || null, webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || null };
    })();
  }
  return secretsPromise;
}

async function createOrder({ amountMinor, currency = 'INR', receipt, notes }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const { key_secret: keySecret } = await secrets();
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
