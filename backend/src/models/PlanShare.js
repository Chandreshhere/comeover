'use strict';
// plan_shares — time-limited plan share links for trusted contacts (TTL on expiresAt).
const { makeSchema, model } = require('./_base');

const PlanShareSchema = makeSchema(
  {
    userId: { type: String, required: true },
    activityId: { type: String, required: true },
    trustedContactId: { type: String, default: null },
    shareToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
PlanShareSchema.index({ shareToken: 1 }, { unique: true });
PlanShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PlanShareSchema.index({ userId: 1, activityId: 1 });

module.exports = model('PlanShare', PlanShareSchema, 'plan_shares');
