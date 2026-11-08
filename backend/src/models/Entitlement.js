'use strict';
// entitlements — server-owned access derived from verified store/business purchases.
const { makeSchema, model } = require('./_base');

const EntitlementSchema = makeSchema({
  userId: { type: String, required: true },
  entitlement: { type: String, enum: ['plus', 'pro', 'venue'], required: true },
  source: { type: String, enum: ['apple', 'google', 'razorpay', 'grant'], required: true },
  sourceRef: { type: String, default: null },
  expiresAt: { type: Date, default: null },
});
EntitlementSchema.index({ userId: 1, entitlement: 1 }, { unique: true });

module.exports = model('Entitlement', EntitlementSchema, 'entitlements');
