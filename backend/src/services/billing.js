'use strict';
// Billing domain logic shared by handlers/monetization.js and handlers/webhooks.js.
//  - Store subscriptions (Apple / Google) are verified with the stores; the
//    server derives and owns entitlements.
//  - Venue/Club plans are B2B Razorpay invoices; the signed webhook is the
//    source of truth. No wallet, no stored balances, no custody.
const { err } = require('../lib/http');
const db = require('../lib/db');
const ent = require('../lib/entitlements');
const { audit } = require('../lib/audit');
const P = require('../lib/present');
const appstore = require('../lib/payments/appstore');
const playstore = require('../lib/payments/playstore');

async function subscriptionOf(userId) {
  const { Subscription } = require('../models');
  const [ents, sub] = await Promise.all([ent.getActive(userId), Subscription.findOne({ userId }).sort({ createdAt: -1 }).select('store status expiresAt').lean()]);
  return P.subscription(ents, sub);
}

function storeError(e) {
  if (e && /not_configured$/.test(e.code || '')) return err.unavailable('billing_not_configured', 'Store billing is not configured on the server yet');
  return e;
}

// Upsert a verified store purchase and derive the entitlement (inside a transaction).
async function applyPurchase(session, userId, p) {
  const { Subscription } = require('../models');
  const owner = await Subscription.findOne({ originalTransactionId: p.originalTransactionId, store: p.store }).select('userId').session(session).lean();
  if (owner && owner.userId !== userId) throw err.conflict('purchase_belongs_to_another_account', 'This purchase is linked to a different account');
  const active = p.store === 'google' ? !!p.active : !p.revoked && (!p.expiresAt || new Date(p.expiresAt) > new Date());
  const entitlement = ent.productToEntitlement(p.productId);
  const status = active ? 'active' : p.revoked ? 'revoked' : 'expired';
  await Subscription.updateOne(
    { storeTransactionId: p.transactionId },
    {
      $set: { status, expiresAt: p.expiresAt ? new Date(p.expiresAt) : null, rawStatus: p.raw || {}, autoRenew: p.raw && typeof p.raw.autoRenewStatus === 'number' ? p.raw.autoRenewStatus === 1 : null },
      $setOnInsert: { userId, store: p.store, productId: p.productId, startedAt: new Date(), originalTransactionId: p.originalTransactionId },
    },
    { upsert: true, session }
  );
  if (entitlement) {
    if (active) await ent.grant({ userId, entitlement, source: p.store, sourceRef: p.originalTransactionId, expiresAt: p.expiresAt }, { session });
    else await ent.revoke({ userId, entitlement, sourceRef: p.originalTransactionId }, { session });
  }
  await audit({ actorUserId: userId, action: 'subscription.verify', targetType: 'subscription', targetId: p.transactionId, metadata: { store: p.store, productId: p.productId, active } }, { session });
  return active;
}

// Fetch from the store, check account binding, persist.
async function verifyOne(userId, { store, transactionId, purchaseToken }) {
  let p;
  try {
    p = store === 'apple' ? await appstore.getTransaction(transactionId) : await playstore.getSubscription(purchaseToken);
  } catch (e) {
    throw storeError(e);
  }
  if (!p) throw err.notFound('purchase_not_found');
  // Clients pass the user id as appAccountToken (Apple) / obfuscatedExternalAccountId (Google).
  const raw = p.raw || {};
  const bound = store === 'apple' ? raw.appAccountToken : raw.externalAccountIdentifiers && raw.externalAccountIdentifiers.obfuscatedExternalAccountId;
  if (bound && bound !== userId) throw err.conflict('purchase_belongs_to_another_account');
  await db.withTransaction((session) => applyPurchase(session, userId, p));
  if (store === 'google' && p.needsAcknowledge) await playstore.acknowledge(p.productId, purchaseToken).catch(() => {});
  return p;
}

// Provider event de-duplication. Returns true the first time an event id is seen.
async function recordWebhookEvent(provider, eventId, payload) {
  const { WebhookEvent } = require('../models');
  try {
    await WebhookEvent.create({ provider, eventId: String(eventId), payload: payload || {} });
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false;
    throw e;
  }
}

// Razorpay invoice paid → extend the owner's Venue entitlement by 30 days per month bought.
async function markInvoicePaid(orderId, paymentId) {
  const { BusinessInvoice, BusinessProfile, Entitlement } = require('../models');
  if (!orderId) return null;
  return db.withTransaction(async (session) => {
    // Conditional update guards against double processing (webhook + client fast path).
    const inv = await BusinessInvoice.findOneAndUpdate(
      { razorpayOrderId: String(orderId), status: { $ne: 'paid' } },
      { $set: { status: 'paid', razorpayPaymentId: paymentId || null, paidAt: new Date() } },
      { new: true, session }
    ).lean();
    if (!inv) return null;
    const b = await BusinessProfile.findById(inv.businessId).select('ownerUserId').session(session).lean();
    if (!b) return inv;
    const months = parseInt(String(inv.planCode).replace(/\D/g, ''), 10) || 1;
    const cur = await Entitlement.findOne({ userId: b.ownerUserId, entitlement: 'venue' }).select('expiresAt').session(session).lean();
    const base = cur && cur.expiresAt && new Date(cur.expiresAt) > new Date() ? new Date(cur.expiresAt) : new Date();
    base.setUTCDate(base.getUTCDate() + 30 * months);
    await ent.grant({ userId: b.ownerUserId, entitlement: 'venue', source: 'razorpay', sourceRef: inv._id, expiresAt: base }, { session });
    await audit({ actorUserId: b.ownerUserId, action: 'invoice.paid', targetType: 'invoice', targetId: inv._id, metadata: { paymentId: paymentId || null, months } }, { session });
    return inv;
  });
}

module.exports = { subscriptionOf, storeError, applyPurchase, verifyOne, recordWebhookEvent, markInvoicePaid };
