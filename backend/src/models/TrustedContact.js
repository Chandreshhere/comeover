'use strict';
// trusted_contacts
const { makeSchema, model } = require('./_base');

const TrustedContactSchema = makeSchema({
  userId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  phone: { type: String, required: true }, // E.164, visible to its owner only
  status: { type: String, enum: ['invited', 'accepted', 'revoked'], default: 'invited' },
});
TrustedContactSchema.index({ userId: 1, phone: 1 }, { unique: true });

module.exports = model('TrustedContact', TrustedContactSchema, 'trusted_contacts');
