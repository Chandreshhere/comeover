'use strict';
// Server-owned entitlements + remotely configurable feature matrix
// (05_monetization_model.json). Safety, reporting, blocking, basic join/create
// and accepted-plan chat are NEVER gated.

const NEVER_GATED = new Set(['safety', 'reporting', 'blocking', 'basic_join', 'basic_create', 'accepted_plan_chat', 'core_quests', 'browse']);

const DEFAULT_MATRIX = {
  saved_searches: 'plus',
  advanced_filters: 'plus',
  extra_plan_drafts: 'plus',
  availability_scheduling: 'plus',
  activity_insights: 'plus',
  profile_themes: 'plus',
  advanced_circle_discovery: 'plus',
  more_guide_prompts: 'plus',
  recurring_plan_templates: 'pro',
  large_groups: 'pro',
  co_host_roles: 'pro',
  community_analytics: 'pro',
  scheduled_quest_challenges: 'pro',
  attendance_export: 'pro',
  sponsored_slots: 'venue',
  campaign_analytics: 'venue',
  offer_tracking: 'venue',
  staff_roles: 'venue',
};

const PLANS = [
  { code: 'free', name: 'Free', priceMonthlyInr: 0, target: 'everyone', features: ['browse', 'basic_create', 'basic_join', 'accepted_plan_chat', 'safety', 'core_quests'] },
  { code: 'plus', name: 'Plus', priceMonthlyInr: 149, alternativeTestPriceInr: 199, target: 'active members', store: { apple: process.env.IAP_PLUS_PRODUCT_ID || 'irl_plus_monthly', google: process.env.IAP_PLUS_PRODUCT_ID || 'irl_plus_monthly' } },
  { code: 'pro', name: 'Pro', priceMonthlyInr: 399, alternativeTestPriceInr: 499, target: 'power hosts and community organisers', store: { apple: process.env.IAP_PRO_PRODUCT_ID || 'irl_pro_monthly', google: process.env.IAP_PRO_PRODUCT_ID || 'irl_pro_monthly' } },
  { code: 'venue', name: 'Venue / Club', priceMonthlyInr: 999, alternativeTestPriceInr: 1499, target: 'local businesses, clubs and organisers', billing: 'razorpay_invoice' },
];

const RANK = { free: 0, plus: 1, pro: 2 };

function matrix() {
  try {
    return process.env.PLAN_MATRIX_JSON ? { ...DEFAULT_MATRIX, ...JSON.parse(process.env.PLAN_MATRIX_JSON) } : DEFAULT_MATRIX;
  } catch (e) {
    return DEFAULT_MATRIX;
  }
}

function plansWithFeatures() {
  const m = matrix();
  return PLANS.map((p) => ({
    ...p,
    features: p.features || Object.entries(m).filter(([, tier]) => (p.code === 'venue' ? tier === 'venue' : tier !== 'venue' && RANK[tier] <= RANK[p.code])).map(([f]) => f),
  }));
}

function activeEntitlements(rows, now = new Date()) {
  return rows.filter((r) => !r.expires_at || new Date(r.expires_at) > now).map((r) => r.entitlement);
}

function hasFeature(active, feature) {
  if (NEVER_GATED.has(feature)) return true;
  const tier = matrix()[feature];
  if (!tier) return true; // unknown features default open — avoid accidental paywalls
  if (tier === 'venue') return active.includes('venue');
  const best = active.reduce((acc, e) => Math.max(acc, RANK[e] ?? 0), 0);
  return best >= RANK[tier];
}

function productToEntitlement(productId) {
  const id = String(productId || '').toLowerCase();
  if (id.includes('pro')) return 'pro';
  if (id.includes('plus')) return 'plus';
  return null;
}

async function getActive(db, userId) {
  const { rows } = await db.query('SELECT entitlement, expires_at, source FROM entitlements WHERE user_id = $1', [userId]);
  return activeEntitlements(rows);
}

async function grant(db, { userId, entitlement, source, sourceRef, expiresAt }) {
  await db.query(
    `INSERT INTO entitlements (user_id, entitlement, source, source_ref, expires_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, entitlement) DO UPDATE SET source = EXCLUDED.source, source_ref = EXCLUDED.source_ref,
       expires_at = GREATEST(entitlements.expires_at, EXCLUDED.expires_at), updated_at = now()`,
    [userId, entitlement, source, sourceRef || null, expiresAt || null]
  );
}

async function revoke(db, { userId, entitlement, sourceRef }) {
  await db.query('UPDATE entitlements SET expires_at = now(), updated_at = now() WHERE user_id = $1 AND entitlement = $2 AND ($3::text IS NULL OR source_ref = $3)', [userId, entitlement, sourceRef || null]);
}

module.exports = { NEVER_GATED, DEFAULT_MATRIX, PLANS, matrix, plansWithFeatures, activeEntitlements, hasFeature, productToEntitlement, getActive, grant, revoke };
