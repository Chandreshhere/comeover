'use strict';
// Google Play Developer API — subscriptionsv2 verification + acknowledgement.
// Credentials (TODO): service account with Play Console access (see googleAuth.js),
// ANDROID_PACKAGE_NAME.
const { getAccessToken } = require('../googleAuth');

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const ACTIVE = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);

async function getSubscription(purchaseToken) {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  const token = await getAccessToken(SCOPE);
  if (!pkg || !token) {
    const e = new Error('Google Play API not configured');
    e.code = 'google_not_configured';
    throw e;
  }
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`play api ${res.status}`);
  const s = await res.json();
  const line = (s.lineItems || [])[0] || {};
  return {
    store: 'google',
    productId: line.productId,
    transactionId: s.latestOrderId || purchaseToken,
    originalTransactionId: purchaseToken,
    expiresAt: line.expiryTime || null,
    active: ACTIVE.has(s.subscriptionState),
    revoked: s.subscriptionState === 'SUBSCRIPTION_STATE_EXPIRED' && !!s.canceledStateContext,
    needsAcknowledge: s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    raw: s,
  };
}

async function acknowledge(productId, purchaseToken) {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  const token = await getAccessToken(SCOPE);
  if (!pkg || !token) return false;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  return res.ok;
}

module.exports = { getSubscription, acknowledge };
