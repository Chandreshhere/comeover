'use strict';
// Unauthenticated provider callbacks. Each one is signature-verified and
// idempotent (WebhookEvent unique (provider, eventId)).
const crypto = require('crypto');
const { err, header } = require('../lib/http');
const db = require('../lib/db');
const config = require('../config');
const razorpay = require('../lib/payments/razorpay');
const appstore = require('../lib/payments/appstore');
const playstore = require('../lib/payments/playstore');
const billing = require('../services/billing');

// Record the event id first (dedupe), then process. If processing fails the
// record is released so the provider's retry is handled instead of being
// dropped as a duplicate.
async function processOnce(provider, eventId, payload, fn) {
  const fresh = await billing.recordWebhookEvent(provider, eventId, payload);
  if (!fresh) return { ok: true, duplicate: true };
  try {
    return await fn();
  } catch (e) {
    const { WebhookEvent } = require('../models');
    await WebhookEvent.deleteOne({ provider, eventId: String(eventId) }).catch(() => {});
    throw e;
  }
}

function parseJson(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    throw err.badRequest('invalid_json', 'Request body must be valid JSON');
  }
}

const routes = {
  'POST /v1/webhooks/razorpay': async (req) => {
    const { BusinessInvoice } = require('../models');
    const raw = req.rawBody();
    const { webhook_secret: secret } = await razorpay.secrets();
    if (!secret) throw err.unavailable('payments_not_configured');
    if (!razorpay.verifyWebhookSignature(raw, header(req, 'x-razorpay-signature'), secret)) throw err.unauthorized('invalid_signature');
    const body = parseJson(raw);
    const eventId = header(req, 'x-razorpay-event-id') || crypto.createHash('sha256').update(raw).digest('hex');
    return processOnce('razorpay', eventId, body, async () => {
      const payment = body.payload && body.payload.payment && body.payload.payment.entity;
      const order = body.payload && body.payload.order && body.payload.order.entity;
      if (['payment.captured', 'order.paid'].includes(body.event)) {
        await billing.markInvoicePaid((order && order.id) || (payment && payment.order_id), payment && payment.id);
      } else if (body.event === 'payment.failed' && payment && payment.order_id) {
        await BusinessInvoice.updateOne({ razorpayOrderId: String(payment.order_id), status: 'created' }, { $set: { status: 'failed' } });
      } else if (body.event === 'refund.processed' && payment && payment.order_id) {
        await BusinessInvoice.updateOne({ razorpayOrderId: String(payment.order_id) }, { $set: { status: 'refunded' } });
      }
      return { ok: true };
    });
  },

  // App Store Server Notifications V2 (signedPayload, verified against Apple's root CA).
  'POST /v1/webhooks/apple': async (req) => {
    const { Subscription } = require('../models');
    const { signedPayload } = parseJson(req.rawBody());
    let n;
    try {
      n = appstore.verifyAppleJws(signedPayload);
    } catch (e) {
      if (e.code === 'apple_not_configured') throw err.unavailable('billing_not_configured');
      throw err.unauthorized('invalid_signature');
    }
    let tx = null;
    try {
      tx = n.data && n.data.signedTransactionInfo ? appstore.verifyAppleJws(n.data.signedTransactionInfo) : null;
    } catch (e) {
      throw err.unauthorized('invalid_signature');
    }
    const eventId = n.notificationUUID || crypto.createHash('sha256').update(String(signedPayload)).digest('hex');
    return processOnce('apple', eventId, n, async () => {
      if (!tx) return { ok: true };
      const sub = await Subscription.findOne({ store: 'apple', originalTransactionId: String(tx.originalTransactionId) }).select('userId').lean();
      if (!sub) return { ok: true, unmatched: true };
      await db.withTransaction((session) =>
        billing.applyPurchase(session, sub.userId, {
          store: 'apple',
          productId: tx.productId,
          transactionId: String(tx.transactionId),
          originalTransactionId: String(tx.originalTransactionId),
          expiresAt: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null,
          revoked: !!tx.revocationDate || ['REFUND', 'REVOKE'].includes(n.notificationType),
          raw: tx,
        })
      );
      return { ok: true };
    });
  },

  // Google Play RTDN via Pub/Sub push. Authenticity: the push subscription uses a
  // secret token query param (GOOGLE_RTDN_TOKEN) and we re-fetch state from the Play API.
  'POST /v1/webhooks/google': async (req) => {
    const { Subscription } = require('../models');
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const expected = config.google.rtdnToken || '';
    if (!expected) throw err.unavailable('billing_not_configured');
    if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw err.unauthorized('invalid_token');
    const body = parseJson(req.rawBody());
    const msg = body.message || {};
    let data = {};
    try {
      data = msg.data ? JSON.parse(Buffer.from(String(msg.data), 'base64').toString('utf8')) : {};
    } catch (e) {
      throw err.badRequest('invalid_message');
    }
    return processOnce('google', msg.messageId || crypto.randomUUID(), data, async () => {
      const sn = data.subscriptionNotification;
      if (!sn || !sn.purchaseToken) return { ok: true };
      const sub = await Subscription.findOne({ store: 'google', originalTransactionId: String(sn.purchaseToken) }).select('userId').lean();
      if (!sub) return { ok: true, unmatched: true };
      let p;
      try {
        p = await playstore.getSubscription(String(sn.purchaseToken));
      } catch (e) {
        throw billing.storeError(e);
      }
      if (!p) return { ok: true };
      await db.withTransaction((session) => billing.applyPurchase(session, sub.userId, p));
      return { ok: true };
    });
  },
};

module.exports = { routes, markInvoicePaid: billing.markInvoicePaid };
