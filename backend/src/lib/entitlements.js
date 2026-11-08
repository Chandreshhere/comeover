'use strict';
// Server-owned entitlements + remotely configurable feature matrix
// (05_monetization_model.json). Safety, reporting, blocking, basic join/create
// and accepted-plan chat are NEVER gated.
const config = require('../config');

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
  { code: 'plus', name: 'Plus', priceMonthlyInr: 149, alternativeTestPriceInr: 199, target: 'active members', store: { apple: config.iap.plusProductId, google: config.iap.plusProductId } },
  { code: 'pro', name: 'Pro', priceMonthlyInr: 399, alternativeTestPriceInr: 499, target: 'power hosts and community organisers', store: { apple: config.iap.proProductId, google: config.iap.proProductId } },
  { code: 'venue', name: 'Venue / Club', priceMonthlyInr: config.razorpay.venuePlanPriceInr, alternativeTestPriceInr: 1499, target: 'local businesses, clubs and organisers', billing: 'razorpay_invoice' },
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

// rows: [{ entitlement, expiresAt }]
function activeEntitlements(rows, now = new Date()) {
  return rows.filter((r) => !(r.expiresAt || r.expires_at) || new Date(r.expiresAt || r.expires_at) > now).map((r) => r.entitlement);
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

async function getActive(userId, { session } = {}) {
  const { Entitlement } = require('../models');
  const q = Entitlement.find({ userId }).select('entitlement expiresAt source').lean();
  if (session) q.session(session);
  return activeEntitlements(await q);
}

// Upsert; never shortens an existing expiry (GREATEST semantics).
async function grant({ userId, entitlement, source, sourceRef, expiresAt }, { session } = {}) {
  const { Entitlement } = require('../models');
  const existing = await Entitlement.findOne({ userId, entitlement }).session(session || null).lean();
  let exp = expiresAt ? new Date(expiresAt) : null;
  if (existing && existing.expiresAt && exp && existing.expiresAt > exp) exp = existing.expiresAt;
  if (existing && existing.expiresAt === null && existing.source === 'grant') exp = null; // permanent grants stay permanent
  await Entitlement.updateOne(
    { userId, entitlement },
    { $set: { source, sourceRef: sourceRef || null, expiresAt: exp } },
    { upsert: true, session }
  );
}

async function revoke({ userId, entitlement, sourceRef }, { session } = {}) {
  const { Entitlement } = require('../models');
  const filter = { userId, entitlement, ...(sourceRef ? { sourceRef } : {}) };
  await Entitlement.updateMany(filter, { $set: { expiresAt: new Date() } }, { session });
}

module.exports = { NEVER_GATED, DEFAULT_MATRIX, PLANS, matrix, plansWithFeatures, activeEntitlements, hasFeature, productToEntitlement, getActive, grant, revoke };
