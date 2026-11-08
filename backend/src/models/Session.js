'use strict';
// sessions — rotating refresh tokens (sha256 hashes only). A refresh rotates the
// token within the same `familyId`; presenting an already-rotated token is reuse
// and revokes the whole family.
const { makeSchema, model } = require('./_base');

const SessionSchema = makeSchema({
  userId: { type: String, required: true },
  familyId: { type: String, required: true },
  tokenHash: { type: String, required: true },
  rotatedAt: { type: Date, default: null }, // set when exchanged for a new token
  replacedBy: { type: String, default: null },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: Date.now },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
});
SessionSchema.index({ tokenHash: 1 }, { unique: true });
SessionSchema.index({ userId: 1, familyId: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('Session', SessionSchema, 'sessions');
