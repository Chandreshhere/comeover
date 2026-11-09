'use strict';
// xp_events — every award (incl. 0-XP capped ones) keyed by a unique idempotencyKey.
const { makeSchema, model } = require('./_base');

const XpEventSchema = makeSchema(
  {
    userId: { type: String, required: true },
    activityId: { type: String, default: null },
    eventType: { type: String, required: true },
    xpDelta: { type: Number, required: true, min: 0 },
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
XpEventSchema.index({ idempotencyKey: 1 }, { unique: true });
XpEventSchema.index({ userId: 1, createdAt: -1 });
XpEventSchema.index({ createdAt: -1 }); // admin insights time ranges

module.exports = model('XpEvent', XpEventSchema, 'xp_events');
