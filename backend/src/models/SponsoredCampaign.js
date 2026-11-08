'use strict';
// sponsored_campaigns — paid placements are ALWAYS labelled.
const { makeSchema, Mixed, model } = require('./_base');

const SponsoredCampaignSchema = makeSchema({
  businessId: { type: String, required: true },
  activityId: { type: String, default: null },
  title: { type: String, required: true },
  audience: { type: Mixed, default: () => ({}) },
  budgetMinor: { type: Number, required: true, min: 1 },
  spentMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'pending_review', 'active', 'paused', 'completed', 'rejected'], default: 'pending_review' },
  label: { type: String, default: 'Sponsored' },
  createdBy: { type: String, default: null },
});
SponsoredCampaignSchema.index({ businessId: 1, createdAt: -1 });
SponsoredCampaignSchema.index({ status: 1, endsAt: 1 });

module.exports = model('SponsoredCampaign', SponsoredCampaignSchema, 'sponsored_campaigns');
