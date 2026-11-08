// Plans come from GET /plans (server-owned remote config: tiers, features,
// prices per experiment cohort). Display prices prefer the store-localised
// price from StoreKit / Play Billing (react-native-iap) over the server value.
//
// Expected GET /plans shape (rendered defensively):
//   { plans: [{ id, tier, name, productId, priceMonthly, currency, target, tagline,
//               pictogram, accent, includes, billing: 'store'|'invoice', planId?, features: [] }],
//     matrix?: [{ label, free, plus, pro }] }
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { monetization } from '@/api/endpoints';
import { loadProducts } from '@/services/billing';
import useRemote from './useRemote';

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

function normalisePlan(p) {
  const tier = p.tier || p.id;
  return {
    ...p,
    id: p.id || tier,
    tier,
    name: p.name || tier,
    productId: p.productId || null,
    priceMonthly: p.priceMonthly ?? (p.priceMinor != null ? p.priceMinor / 100 : 0),
    pictogram: p.pictogram || PICTOGRAM_BY_TIER[tier] || 'sparkle',
    accent: p.accent || ACCENT_BY_TIER[tier] || 'surface',
    billing: p.billing || (tier === 'venue' ? 'invoice' : tier === 'free' ? 'none' : 'store'),
    features: Array.isArray(p.features) ? p.features : [],
  };
}

async function fetchPlansAndProducts() {
  const [res, products] = await Promise.all([monetization.plans(), loadProducts().catch(() => [])]);
  const list = Array.isArray(res) ? res : res?.plans || res?.items || [];
  return {
    plans: list.map(normalisePlan).sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)),
    matrix: Array.isArray(res?.matrix) ? res.matrix : null,
    products: Object.fromEntries((products || []).map((pr) => [pr.productId, pr])),
  };
}

// -> { status, error, reload, refreshing, plans, consumer, venue, matrix, products,
//      byId(id), byProductId(productId), priceLabel(plan) }
export function usePlans() {
  const remote = useRemote(fetchPlansAndProducts, []);
  const data = remote.data;
  return useMemo(() => {
    const plans = data?.plans || [];
    const products = data?.products || {};
    return {
      ...remote,
      plans,
      products,
      matrix: data?.matrix || null,
      consumer: plans.filter((p) => p.billing !== 'invoice'),
      venue: plans.find((p) => p.billing === 'invoice') || null,
      byId: (id) => plans.find((p) => p.id === id || p.tier === id) || null,
      byProductId: (productId) => plans.find((p) => p.productId === productId) || null,
      priceLabel: (plan) => priceLabel(plan, products),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, remote.status, remote.error, remote.refreshing]);
}

export function priceLabel(plan, products = {}) {
  if (!plan) return '';
  const store = plan.productId ? products[plan.productId]?.localizedPrice : null;
  if (store) return store;
  return plan.priceMonthly ? rupees(plan.priceMonthly) : '₹0';
}

export const storeName = () => (Platform.OS === 'ios' ? 'App Store' : 'Google Play');
export const storeKey = () => (Platform.OS === 'ios' ? 'apple' : 'google');

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
