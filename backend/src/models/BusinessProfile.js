'use strict';
// business_profiles ← business_profiles + business_staff (embedded `staff`).
const { makeSchema, sub, Mixed, model } = require('./_base');

const StaffSchema = sub({
  userId: { type: String, required: true },
  role: { type: String, enum: ['owner', 'manager', 'staff'], default: 'staff' },
});

const BusinessProfileSchema = makeSchema({
  ownerUserId: { type: String, required: true },
  name: { type: String, required: true },
  kind: { type: String, enum: ['venue', 'club', 'organiser'], required: true },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected', 'suspended'], default: 'pending' },
  contactEmail: { type: String, default: null },
  contactName: { type: String, default: null },
  contactPhone: { type: String, default: null },
  gstin: { type: String, default: null },
  verificationDocKey: { type: String, default: null },
  reviewNote: { type: String, default: null },
  planId: { type: String, default: null },
  agreements: { type: Mixed, default: () => ({}) },
  staff: { type: [StaffSchema], default: [] },
});
BusinessProfileSchema.index({ ownerUserId: 1 });
BusinessProfileSchema.index({ 'staff.userId': 1 });
BusinessProfileSchema.index({ verificationStatus: 1, createdAt: -1 });

module.exports = model('BusinessProfile', BusinessProfileSchema, 'business_profiles');
