'use strict';
// venue_offers: partner perks. Venues fund the discount; Come Over never holds money.
// A perk is UNLOCKED by level (minLevel) and show-up rate; XP is never spent.
// Times are IST: days 0=Sun..6=Sat, startMinute/endMinute = minutes from IST midnight (end exclusive).
const { makeSchema, model } = require('./_base');

const VenueOfferSchema = makeSchema({
  venueId: { type: String, required: true },
  businessId: { type: String, required: true },
  title: { type: String, required: true, minlength: 2, maxlength: 60 },
  description: { type: String, maxlength: 240, default: null },
  kind: { type: String, enum: ['percent', 'flat', 'freebie'], required: true },
  value: { type: Number, default: null }, // percent 5..50 | whole INR 10..5000 | null for freebie
  minGroup: { type: Number, min: 1, max: 20, default: 2 },
  minLevel: { type: Number, min: 1, max: 10, default: 1 },
  minShowUpRate: { type: Number, min: 0, max: 1, default: 0.8 },
  days: { type: [Number], default: () => [0, 1, 2, 3, 4, 5, 6] },
  startMinute: { type: Number, min: 0, max: 1439, default: 0 },
  endMinute: { type: Number, min: 1, max: 1440, default: 1440 },
  validFrom: { type: Date, default: null },
  validTo: { type: Date, default: null },
  perUserPerWeek: { type: Number, min: 1, max: 7, default: 1 },
  status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
  createdBy: { type: String, default: null },
});
VenueOfferSchema.index({ venueId: 1, status: 1 });
VenueOfferSchema.index({ businessId: 1, createdAt: -1 });
VenueOfferSchema.index({ status: 1, minLevel: 1 });

module.exports = model('VenueOffer', VenueOfferSchema, 'venue_offers');
