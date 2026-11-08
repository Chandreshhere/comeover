'use strict';
// Unauthenticated provider callbacks. Each one is signature-verified and
// idempotent (webhook_events primary key = provider event id).
const crypto = require('crypto');
const { createRouter, err, header } = require('../lib/http');
const db = require('../lib/db');
const ent = require('../lib/entitlements');
const { audit } = require('../lib/audit');
const razorpay = require('../lib/payments/razorpay');
const appstore = require('../lib/payments/appstore');
const playstore = require('../lib/payments/playstore');

async function recordEvent(client, provider, eventId, payload) {
  const { rowCount } = await client.query('INSERT INTO webhook_events (provider, event_id, payload) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [provider, eventId, JSON.stringify(payload)]);
  return rowCount > 0;
}

async function markInvoicePaid(orderId, paymentId) {
  await db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT i.*, b.owner_user_id FROM business_invoices i JOIN business_profiles b ON b.id = i.business_id WHERE i.razorpay_order_id = $1 FOR UPDATE OF i', [orderId]);
    const inv = rows[0];
    if (!inv || inv.status === 'paid') return;
    await client.query("UPDATE business_invoices SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1", [inv.id, paymentId]);
    const months = parseInt(String(inv.plan_code).replace(/\D/g, ''), 10) || 1;
    const { rows: cur } = await client.query("SELECT expires_at FROM entitlements WHERE user_id = $1 AND entitlement = 'venue'", [inv.owner_user_id]);
    const base = cur[0] && cur[0].expires_at && new Date(cur[0].expires_at) > new Date() ? new Date(cur[0].expires_at) : new Date();
    base.setUTCDate(base.getUTCDate() + 30 * months);
    await ent.grant(client, { userId: inv.owner_user_id, entitlement: 'venue', source: 'razorpay', sourceRef: inv.id, expiresAt: base.toISOString() });
    await audit(client, { actorUserId: inv.owner_user_id, action: 'invoice.paid', targetType: 'invoice', targetId: inv.id, metadata: { paymentId } });
  });
}

const routes = {
  'POST /v1/webhooks/razorpay': async (req) => {
    const raw = req.rawBody();
    const { webhook_secret: secret } = await razorpay.secrets();
    if (!secret) throw err.unavailable('payments_not_configured');
    if (!razorpay.verifyWebhookSignature(raw, header(req.event, 'x-razorpay-signature'), secret)) throw err.unauthorized('invalid_signature');
    const body = JSON.parse(raw);
    const eventId = header(req.event, 'x-razorpay-event-id') || crypto.createHash('sha256').update(raw).digest('hex');
    const fresh = await db.withTransaction((client) => recordEvent(client, 'razorpay', eventId, body));
    if (!fresh) return { ok: true, duplicate: true };
    const payment = body.payload && body.payload.payment && body.payload.payment.entity;
    const order = body.payload && body.payload.order && body.payload.order.entity;
    if (['payment.captured', 'order.paid'].includes(body.event)) {
      await markInvoicePaid((order && order.id) || (payment && payment.order_id), payment && payment.id);
    } else if (body.event === 'payment.failed' && payment) {
      await db.query("UPDATE business_invoices SET status = 'failed' WHERE razorpay_order_id = $1 AND status = 'created'", [payment.order_id]);
    } else if (body.event === 'refund.processed' && payment) {
      await db.query("UPDATE business_invoices SET status = 'refunded' WHERE razorpay_order_id = $1", [payment.order_id]);
    }
    return { ok: true };
  },

  // App Store Server Notifications V2 (signedPayload, verified against Apple's root CA).
  'POST /v1/webhooks/apple': async (req) => {
    const { signedPayload } = JSON.parse(req.rawBody() || '{}');
    let n;
    try {
      n = appstore.verifyAppleJws(signedPayload);
    } catch (e) {
      if (e.code === 'apple_not_configured') throw err.unavailable('billing_not_configured');
      throw err.unauthorized('invalid_signature');
    }
    const fresh = await db.withTransaction((client) => recordEvent(client, 'apple', n.notificationUUID, n));
    if (!fresh) return { ok: true, duplicate: true };
    const tx = n.data && n.data.signedTransactionInfo ? appstore.verifyAppleJws(n.data.signedTransactionInfo) : null;
    if (!tx) return { ok: true };
    const sub = await db.one("SELECT user_id FROM subscriptions WHERE store = 'apple' AND original_transaction_id = $1 LIMIT 1", [String(tx.originalTransactionId)]);
    if (!sub) return { ok: true, unmatched: true };
    const { applyPurchase } = require('./monetization');
    await db.withTransaction((client) =>
      applyPurchase(client, sub.user_id, {
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
  },

  // Google Play RTDN via Pub/Sub push. Authenticity: push subscription uses a
  // secret token query param (GOOGLE_RTDN_TOKEN) and we re-fetch state from the Play API.
  'POST /v1/webhooks/google': async (req) => {
    const token = (req.query && req.query.token) || '';
    const expected = process.env.GOOGLE_RTDN_TOKEN || '';
    if (!expected) throw err.unavailable('billing_not_configured');
    if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw err.unauthorized('invalid_token');
    const body = JSON.parse(req.rawBody() || '{}');
    const msg = body.message || {};
    const data = msg.data ? JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8')) : {};
    const fresh = await db.withTransaction((client) => recordEvent(client, 'google', msg.messageId || crypto.randomUUID(), data));
    if (!fresh) return { ok: true, duplicate: true };
    const sn = data.subscriptionNotification;
    if (!sn) return { ok: true };
    const sub = await db.one("SELECT user_id FROM subscriptions WHERE store = 'google' AND original_transaction_id = $1 LIMIT 1", [sn.purchaseToken]);
    if (!sub) return { ok: true, unmatched: true };
    const p = await playstore.getSubscription(sn.purchaseToken);
    if (!p) return { ok: true };
    const { applyPurchase } = require('./monetization');
    await db.withTransaction((client) => applyPurchase(client, sub.user_id, p));
    return { ok: true };
  },
};

exports.markInvoicePaid = markInvoicePaid;
exports.handler = createRouter(routes);
