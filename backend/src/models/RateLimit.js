'use strict';
// rate_limits — token buckets. _id is the bucket key ("name:subject"); expires 7 days after last use.
const { Schema, model } = require('./_base');

const RateLimitSchema = new Schema(
  {
    _id: { type: String, required: true },
    tokens: { type: Number, required: true },
    updatedAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: false }
);
RateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RateLimit', RateLimitSchema, 'rate_limits');
