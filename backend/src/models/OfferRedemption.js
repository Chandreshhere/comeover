'use strict';
// offer_redemptions: one code shown by a user and confirmed by venue staff.
// A confirmed (status 'redeemed') row is one verified partner visit.
// An 'issued' row past expiresAt is treated as expired on read (stale rows are flipped lazily).
const { makeSchema, model } = require('./_base');

const OfferRedemptionSchema = makeSchema({
  offerId: { type: String, required: true },
  venueId: { type: String, required: true },
  businessId: { type: String, required: true },
  userId: { type: String, required: true },
  activityId: { type: String, default: null },
  code: { type: String, required: true }, // 6 chars from lib/perks CODE_ALPHABET
  status: { type: String, enum: ['issued', 'redeemed', 'expired', 'cancelled'], default: 'issued' },
  issuedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  redeemedAt: { type: Date, default: null },
  redeemedBy: { type: String, default: null },
  groupSize: { type: Number, min: 1, max: 20, default: null },
  weekKey: { type: String, required: true }, // IST week start "YYYY-MM-DD" (Sunday)
});
// Live codes are unique; one live code per user per offer.
OfferRedemptionSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { status: 'issued' } });
OfferRedemptionSchema.index({ offerId: 1, userId: 1 }, { unique: true, partialFilterExpression: { status: 'issued' }, name: 'one_live_code_per_offer' });
OfferRedemptionSchema.index({ code: 1, issuedAt: -1 });
OfferRedemptionSchema.index({ userId: 1, issuedAt: -1 });
OfferRedemptionSchema.index({ userId: 1, status: 1, weekKey: 1, offerId: 1 });
OfferRedemptionSchema.index({ businessId: 1, status: 1, redeemedAt: -1 });
OfferRedemptionSchema.index({ venueId: 1, status: 1, redeemedAt: -1 });
OfferRedemptionSchema.index({ offerId: 1, status: 1, weekKey: 1 });
OfferRedemptionSchema.index({ status: 1, redeemedAt: -1 }); // admin insights: confirmed visits over time

module.exports = model('OfferRedemption', OfferRedemptionSchema, 'offer_redemptions');
