'use strict';
// activities — plans. `location` (GeoJSON, 2dsphere) is derived from latitude/longitude
// on save; raw coordinates are never returned to non-participants (lib/geo.presentLocation).
//
// Capacity is enforced atomically with the denormalised `acceptedCount`
// (host + accepted/checked_in/completed participants):
//   Activity.findOneAndUpdate({ _id, status: { $in: ['open'] }, $expr: { $lt: ['$acceptedCount', '$capacity'] } },
//                             { $inc: { acceptedCount: 1 } }, { session, new: true })
const { makeSchema, pointSchema, toPoint, model } = require('./_base');
const { cellId } = require('../lib/geo');

const ActivitySchema = makeSchema({
  hostUserId: { type: String, required: true },
  category: { type: String, required: true }, // category slug
  title: { type: String, required: true, maxlength: 80 },
  description: { type: String, default: null, maxlength: 1000 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  capacity: { type: Number, min: 2, max: 30, default: 4 },
  visibility: { type: String, enum: ['public', 'circle', 'invite_only'], default: 'public' },
  venueName: { type: String, default: null },
  venueType: { type: String, default: null },
  venueId: { type: String, default: null },
  coarseArea: { type: String, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  location: { type: pointSchema, default: undefined },
  coarseCell: { type: String, default: null },
  exactLocationVisibleAfterAccept: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'open', 'full', 'in_progress', 'completed', 'cancelled', 'moderated'], default: 'open' },
  joinRule: { type: String, enum: ['approval', 'instant'], default: 'approval' },
  costNote: { type: String, default: null },
  tags: { type: [String], default: [] },
  accessibilityNotes: { type: String, default: null },
  activityLevel: { type: String, enum: ['any', 'beginner', 'intermediate', 'advanced'], default: 'any' },
  ageRange: { type: [Number], default: undefined },
  circleId: { type: String, default: null },
  sponsoredCampaignId: { type: String, default: null },
  acceptedCount: { type: Number, default: 1, min: 0 }, // host counts as one
  waitlistCount: { type: Number, default: 0, min: 0 },
  nextWaitlistPosition: { type: Number, default: 1 },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  moderationNote: { type: String, default: null },
  review: {
    status: { type: String, enum: ['none', 'flagged', 'approved', 'removed'], default: 'none' },
    flags: { type: [String], default: [] }, // spam | duplicate | private_location | fraud …
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  idempotencyKey: { type: String, default: undefined },
});

ActivitySchema.pre('validate', function deriveGeo(next) {
  if (this.isModified('latitude') || this.isModified('longitude') || this.isNew) {
    this.location = toPoint(this.latitude, this.longitude);
    this.coarseCell = this.location ? cellId(this.latitude, this.longitude) : null;
  }
  next();
});

ActivitySchema.index({ status: 1, startsAt: 1 });
ActivitySchema.index({ hostUserId: 1, createdAt: -1 });
ActivitySchema.index({ location: '2dsphere' });
ActivitySchema.index({ coarseCell: 1 });
ActivitySchema.index({ circleId: 1 }, { partialFilterExpression: { circleId: { $type: 'string' } } });
ActivitySchema.index({ venueId: 1 }, { partialFilterExpression: { venueId: { $type: 'string' } } });
ActivitySchema.index({ sponsoredCampaignId: 1 }, { partialFilterExpression: { sponsoredCampaignId: { $type: 'string' } } });
ActivitySchema.index({ 'review.status': 1, createdAt: -1 });
// Time-range scans for the admin insights dashboard (handlers/insights.js).
ActivitySchema.index({ createdAt: -1 });
ActivitySchema.index({ completedAt: -1 }, { partialFilterExpression: { completedAt: { $type: 'date' } } });
ActivitySchema.index({ cancelledAt: -1 }, { partialFilterExpression: { cancelledAt: { $type: 'date' } } });
ActivitySchema.index({ hostUserId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
ActivitySchema.index({ title: 'text', description: 'text', tags: 'text', coarseArea: 'text' });

module.exports = model('Activity', ActivitySchema, 'activities');
