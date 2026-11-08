'use strict';
// idempotency_keys — Idempotency-Key reservations + stored responses (TTL 48 h).
const { makeSchema, Mixed, model } = require('./_base');

const IdempotencyKeySchema = makeSchema(
  {
    userId: { type: String, required: true },
    key: { type: String, required: true },
    route: { type: String, required: true },
    requestHash: { type: String, required: true },
    statusCode: { type: Number, default: null },
    response: { type: Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
IdempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 });

module.exports = model('IdempotencyKey', IdempotencyKeySchema, 'idempotency_keys');
