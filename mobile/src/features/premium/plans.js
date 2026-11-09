// Plans come from GET /plans (server-owned remote config: tiers, features,
// prices per experiment cohort). Display prices prefer the store-localised
// price from StoreKit / Play Billing (react-native-iap) over the server value.
//
// GET /v1/plans (backend/src/handlers/monetization.js) returns:
//   { items: [{ id, planId, name, priceMonthlyInr, alternativeTestPriceInr, features: ['saved_searches', …],
//               productIds: { apple, google } | null, audience, billing: 'store'|'free'|'razorpay_invoice' }],
//     neverGated: [...codes], currency: 'INR' }
// Older / alternative shapes ({ plans: [{ tier, productId, priceMonthly, target, … }], matrix }) are
// still accepted. Feature codes are mapped to human copy in featureCatalog.js.
import { useMemo } from 'react';
import { Platform } from 'react-native';
import config from '@/config';
import { monetization } from '@/api/endpoints';
import { loadProducts } from '@/services/billing';
import useRemote from './useRemote';
import { featureInfo } from './featureCatalog';

// Policy copy: things that are NEVER behind a paywall (paywall_policy.never_gate).
export const NEVER_GATED = [
  { icon: 'shield', label: 'Safety tools & safety center' },
  { icon: 'flag', label: 'Reporting people, plans and venues' },
  { icon: 'slash', label: 'Blocking anyone, anytime' },
  { icon: 'plus-circle', label: 'Creating and joining normal plans' },
  { icon: 'message-circle', label: 'Group chat for plans you’re accepted into' },
];

export const TIER_RANK = { free: 0, plus: 1, pro: 2, venue: 3 };

const PICTOGRAM_BY_TIER = { free: 'people', plus: 'sparkle', pro: 'star', venue: 'pin' };
const ACCENT_BY_TIER = { free: 'surface', plus: 'periwinkle', pro: 'orange', venue: 'ink' };
const TAGLINE_BY_TIER = {
  free: 'Everything you need to find people and make plans.',
  plus: 'Plan smarter: power tools for regulars.',
  pro: 'Host bigger: tools for hosts and organisers.',
};

export const storeName = () => (Platform.OS === 'ios' ? 'App Store' : 'Google Play');
export const storeKey = () => (Platform.OS === 'ios' ? 'apple' : 'google');

function billingOf(p, tier) {
  const b = String(p.billing || '').toLowerCase();
  if (b === 'invoice' || b.includes('invoice') || b === 'razorpay' || tier === 'venue') return 'invoice';
  if (b === 'store') return 'store';
  if (b === 'free' || b === 'none' || tier === 'free') return 'none';
  return p.productId || p.productIds ? 'store' : 'none';
}

export function normalisePlan(p) {
  const tier = String(p.tier || p.code || p.planId || p.id || 'free').toLowerCase();
  const billing = billingOf(p, tier);
  const productId =
    p.productId || p.productIds?.[storeKey()] || (billing === 'store' ? config.IAP_PRODUCTS?.[tier] : null) || null;
  const price = p.priceMonthly ?? p.priceMonthlyInr ?? (p.priceMinor != null ? p.priceMinor / 100 : null);
  const rawFeatures = Array.isArray(p.features) ? p.features : [];
  const featureItems = rawFeatures.map(featureInfo).filter((f) => f.label);
  return {
    ...p,
    id: p.id || tier,
    tier,
    name: p.name || tier.charAt(0).toUpperCase() + tier.slice(1),
    productId: billing === 'store' ? productId : null,
    priceMonthly: Number(price) || 0,
    target: p.target || p.audience || '',
    tagline: p.tagline || TAGLINE_BY_TIER[tier] || '',
    pictogram: p.pictogram || PICTOGRAM_BY_TIER[tier] || 'sparkle',
    accent: p.accent || ACCENT_BY_TIER[tier] || 'surface',
    // "Most popular" only when the server says so (it has the data); otherwise
    // an honest editorial "Recommended" on Plus.
    badge: p.badge || (p.popular || p.mostPopular ? 'Most popular' : tier === 'plus' ? 'Recommended' : null),
    billing,
    featureCodes: rawFeatures.map((f) => (typeof f === 'string' ? f : f?.code || f?.id || '')),
    featureItems,
    // Human labels (kept as `features` for older call sites).
    features: featureItems.map((f) => f.label),
  };
}

// Consumer tiers are cumulative on the server (Pro lists Plus features too).
// Work out what each tier adds over the one below it.
export function withDeltas(consumer) {
  return consumer.map((p, i) => {
    const below = i > 0 ? consumer[i - 1] : null;
    if (!below || p.tier === 'free') return { ...p, includes: p.includes || null, newItems: p.featureItems };
    const lower = new Set(below.featureItems.map((f) => f.key));
    const newItems = p.featureItems.filter((f) => !lower.has(f.key));
    const cumulative = newItems.length < p.featureItems.length;
    return { ...p, includes: p.includes || (cumulative && below.tier !== 'free' ? below.tier : null), newItems };
  });
}

// Feature × tier comparison built from the plans themselves (unless the server
// sent its own matrix). Rows: [{ key, label, Glyph, tone, cells: { free: true, plus: … } }]
export function buildMatrix(consumer, serverMatrix) {
  const tiers = consumer.map((p) => p.tier);
  if (Array.isArray(serverMatrix) && serverMatrix.length) {
    return serverMatrix.map((row) => {
      const info = featureInfo(row.code || row.label);
      return { ...info, label: row.label ? featureInfo(row.label).label : info.label, cells: Object.fromEntries(tiers.map((t) => [t, !!row[t]])) };
    });
  }
  const paid = consumer.filter((p) => p.tier !== 'free');
  const free = consumer.find((p) => p.tier === 'free');
  const rows = [];
  const seen = new Set();
  // A couple of "always free" anchors first so the table shows what Free includes.
  (free?.featureItems || []).slice(0, 3).forEach((f) => {
    seen.add(f.key);
    rows.push({ ...f, cells: Object.fromEntries(consumer.map((p) => [p.tier, true])) });
  });
  paid.forEach((p) =>
    p.featureItems.forEach((f) => {
      if (seen.has(f.key)) return;
      seen.add(f.key);
      rows.push({ ...f, cells: Object.fromEntries(consumer.map((q) => [q.tier, q.featureItems.some((x) => x.key === f.key)])) });
    })
  );
  return rows;
}

async function fetchPlansAndProducts() {
  const [res, products] = await Promise.all([monetization.plans(), loadProducts().catch(() => [])]);
  const list = Array.isArray(res) ? res : res?.items || res?.plans || [];
  return {
    plans: list.map(normalisePlan).sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)),
    matrix: Array.isArray(res?.matrix) ? res.matrix : null,
    products: Object.fromEntries((products || []).filter((pr) => pr?.productId).map((pr) => [pr.productId, pr])),
  };
}

async function fetchPlansOnly() {
  const res = await monetization.plans();
  const list = Array.isArray(res) ? res : res?.items || res?.plans || [];
  return list.map(normalisePlan).sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9));
}

// -> { status, error, reload, refreshing, plans, consumer, paid, venue, matrix, products,
//      byId(id), byProductId(productId), priceLabel(plan), storePrice(plan) }
export function usePlans() {
  const remote = useRemote(fetchPlansAndProducts, []);
  const data = remote.data;
  return useMemo(() => {
    const plans = data?.plans || [];
    const products = data?.products || {};
    const consumer = withDeltas(plans.filter((p) => p.billing !== 'invoice'));
    const all = plans.map((p) => consumer.find((c) => c.id === p.id) || p);
    return {
      ...remote,
      plans: all,
      products,
      consumer,
      paid: consumer.filter((p) => p.billing === 'store'),
      matrix: consumer.length > 1 ? buildMatrix(consumer, data?.matrix) : [],
      venue: all.find((p) => p.billing === 'invoice') || null,
      byId: (id) => all.find((p) => p.id === id || p.tier === id) || null,
      byProductId: (productId) => all.find((p) => p.productId && p.productId === productId) || null,
      priceLabel: (plan) => priceLabel(plan, products),
      storePrice: (plan) => storePrice(plan, products),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, remote.status, remote.error, remote.refreshing]);
}

// Lightweight: plan copy only (no store connection) for upsell cards.
export function usePlanSummary() {
  const remote = useRemote(fetchPlansOnly, [], { refetchOnFocus: false });
  return useMemo(() => {
    const plans = remote.data || [];
    const consumer = withDeltas(plans.filter((p) => p.billing !== 'invoice'));
    return { status: remote.status, reload: remote.reload, byId: (id) => consumer.find((p) => p.id === id || p.tier === id) || null };
  }, [remote.data, remote.status, remote.reload]);
}

// The store-localised price string, or null when the store hasn't returned it.
export function storePrice(plan, products = {}) {
  if (!plan?.productId) return null;
  return products[plan.productId]?.localizedPrice || null;
}

// Display price. Paid store plans only ever show the store's own price; when it
// can't be loaded this returns null and callers show PRICE_FALLBACK instead.
export function priceLabel(plan, products = {}) {
  if (!plan) return null;
  if (plan.billing === 'store') return storePrice(plan, products);
  if (plan.billing === 'invoice') return plan.priceMonthly ? rupees(plan.priceMonthly) : null;
  return 'Free';
}

export const PRICE_FALLBACK = 'Price shown at checkout';

// Indian digit grouping without relying on Intl availability.
export function rupees(n) {
  const s = Math.round(n || 0).toString();
  if (s.length <= 3) return `₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest},${last3}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
};
