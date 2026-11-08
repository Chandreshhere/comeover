'use strict';
// reliability_events — inputs to the smoothed show-up score.
const { makeSchema, model } = require('./_base');

const ReliabilityEventSchema = makeSchema({
  userId: { type: String, required: true },
  activityId: { type: String, default: null },
  kind: { type: String, enum: ['attended', 'no_show', 'late_cancel', 'host_cancel', 'disputed', 'appeal_upheld'], required: true },
});
ReliabilityEventSchema.index({ userId: 1, activityId: 1, kind: 1 }, { unique: true });

module.exports = model('ReliabilityEvent', ReliabilityEventSchema, 'reliability_events');
