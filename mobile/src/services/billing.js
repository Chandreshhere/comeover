// Store billing for digital subscriptions (Plus / Pro) with react-native-iap 12
// (StoreKit on iOS, Google Play Billing on Android). Entitlements are granted
// only after the backend verifies the receipt with Apple / Google.
import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import config from '@/config';
import { monetization } from '@/api/endpoints';

let connected = false;
let listeners = [];
let pending = null; // { resolve, reject, sku }

const SKUS = () => Object.values(config.IAP_PRODUCTS);

async function verify(purchase) {
  const body = {
    store: Platform.OS === 'ios' ? 'apple' : 'google',
    productId: purchase.productId,
    transactionId: purchase.transactionId,
    receipt: Platform.OS === 'ios' ? purchase.transactionReceipt : undefined,
    purchaseToken: Platform.OS === 'android' ? purchase.purchaseToken : undefined,
    originalTransactionId: purchase.originalTransactionIdentifierIOS,
  };
  const entitlement = await monetization.verifyReceipt(body);
  await RNIap.finishTransaction({ purchase, isConsumable: false });
  return entitlement;
}

export async function initBilling() {
  if (connected) return true;
  try {
    await RNIap.initConnection();
    if (Platform.OS === 'android') await RNIap.flushFailedPurchasesCachedAsPendingAndroid().catch(() => {});
    connected = true;
    listeners = [
      RNIap.purchaseUpdatedListener(async (purchase) => {
        try {
          const ent = await verify(purchase);
          pending?.resolve({ status: 'success', entitlement: ent });
        } catch (e) {
          pending?.resolve({ status: 'pending_verification', error: e });
        } finally {
          pending = null;
        }
      }),
      RNIap.purchaseErrorListener((err) => {
        const status = err.code === 'E_USER_CANCELLED' ? 'cancelled' : err.code === 'E_DEFERRED_PAYMENT' ? 'pending' : 'failed';
        pending?.resolve({ status, error: err });
        pending = null;
      }),
    ];
    return true;
  } catch (e) {
    connected = false;
    return false;
  }
}

export async function endBilling() {
  listeners.forEach((l) => l?.remove?.());
  listeners = [];
  if (connected) await RNIap.endConnection().catch(() => {});
  connected = false;
}

// Store-localised products: [{ productId, title, localizedPrice, offerToken? }]
export async function loadProducts() {
  if (!(await initBilling())) return [];
  const subs = await RNIap.getSubscriptions({ skus: SKUS() });
  return subs.map((s) => ({
    productId: s.productId,
    title: s.title,
    localizedPrice: s.localizedPrice || s.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice,
    offerToken: s.subscriptionOfferDetails?.[0]?.offerToken,
  }));
}

// Resolves { status: 'success'|'cancelled'|'pending'|'failed'|'pending_verification', entitlement? }
export async function purchase(productId, offerToken) {
  if (!(await initBilling())) return { status: 'failed', error: new Error('Store unavailable') };
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, sku: productId };
    const req =
      Platform.OS === 'android'
        ? { subscriptionOffers: [{ sku: productId, offerToken }] }
        : { sku: productId, andDangerouslyFinishTransactionAutomaticallyIOS: false };
    RNIap.requestSubscription(req).catch((err) => {
      pending = null;
      resolve({ status: err.code === 'E_USER_CANCELLED' ? 'cancelled' : 'failed', error: err });
    });
  });
}

export async function restore() {
  if (!(await initBilling())) return { entitlement: null };
  const purchases = await RNIap.getAvailablePurchases();
  // Shape expected by POST /v1/subscriptions/restore.
  const body =
    Platform.OS === 'ios'
      ? { apple: { transactionIds: purchases.map((p) => p.transactionId).filter(Boolean).slice(0, 50) } }
      : { google: { purchaseTokens: purchases.map((p) => p.purchaseToken).filter(Boolean).slice(0, 50) } };
  return monetization.restore(body);
}

export const manageSubscriptionsUrl = () =>
  Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
