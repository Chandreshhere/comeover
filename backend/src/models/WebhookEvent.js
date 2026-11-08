'use strict';
// webhook_events — provider event de-duplication (kept 90 days).
const { makeSchema, Mixed, model } = require('./_base');

const WebhookEventSchema = makeSchema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    payload: { type: Mixed, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86400 });

module.exports = model('WebhookEvent', WebhookEventSchema, 'webhook_events');
