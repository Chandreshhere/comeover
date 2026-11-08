'use strict';
// venues — partner places (public business location).
const { makeSchema, pointSchema, toPoint, Mixed, model } = require('./_base');

const VenueSchema = makeSchema({
  businessId: { type: String, default: null },
  name: { type: String, required: true },
  address: { type: String, default: null },
  area: { type: String, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  location: { type: pointSchema, default: undefined },
  venueType: { type: String, default: null },
  categorySlugs: { type: [String], default: [] },
  description: { type: String, maxlength: 1000, default: null },
  isPublicPlace: { type: Boolean, default: true },
  bookingUrl: { type: String, default: null },
  offers: { type: [Mixed], default: [] },
  verified: { type: Boolean, default: false },
});
VenueSchema.pre('validate', function deriveGeo(next) {
  if (this.isNew || this.isModified('latitude') || this.isModified('longitude')) this.location = toPoint(this.latitude, this.longitude);
  next();
});
VenueSchema.index({ location: '2dsphere' });
VenueSchema.index({ businessId: 1 });
VenueSchema.index({ verified: 1, categorySlugs: 1 });
VenueSchema.index({ name: 'text', area: 'text', description: 'text' });

module.exports = model('Venue', VenueSchema, 'venues');
