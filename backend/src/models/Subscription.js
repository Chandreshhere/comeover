'use strict';
// subscriptions — verified store purchases (Apple / Google). Entitlements are derived.
const { makeSchema, Mixed, model } = require('./_base');

const SubscriptionSchema = makeSchema({
  userId: { type: String, required: true },
  store: { type: String, enum: ['apple', 'google', 'web'], required: true },
  productId: { type: String, required: true },
  status: { type: String, required: true },
  startedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  storeTransactionId: { type: String, default: undefined },
  originalTransactionId: { type: String, default: null },
  autoRenew: { type: Boolean, default: null },
  rawStatus: { type: Mixed, default: null },
});
SubscriptionSchema.index({ userId: 1, createdAt: -1 });
SubscriptionSchema.index({ storeTransactionId: 1 }, { unique: true, partialFilterExpression: { storeTransactionId: { $type: 'string' } } });
SubscriptionSchema.index({ originalTransactionId: 1 });

module.exports = model('Subscription', SubscriptionSchema, 'subscriptions');
