'use strict';
// table_holds: a host asks a partner venue to hold a table for a plan. No money involved.
const { makeSchema, model } = require('./_base');

const TableHoldSchema = makeSchema({
  activityId: { type: String, required: true },
  venueId: { type: String, required: true },
  businessId: { type: String, required: true },
  hostUserId: { type: String, required: true },
  partySize: { type: Number, min: 1, max: 20, required: true },
  note: { type: String, maxlength: 140, default: null },
  startsAt: { type: Date, required: true }, // copied from the activity
  status: { type: String, enum: ['requested', 'confirmed', 'declined', 'cancelled'], default: 'requested' },
  respondedAt: { type: Date, default: null },
  respondedBy: { type: String, default: null },
  declineReason: { type: String, maxlength: 140, default: null },
});
// At most one requested|confirmed hold per activity.
TableHoldSchema.index({ activityId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } }, name: 'one_open_hold_per_activity' });
TableHoldSchema.index({ activityId: 1, createdAt: -1 });
TableHoldSchema.index({ businessId: 1, status: 1, startsAt: 1 });
TableHoldSchema.index({ businessId: 1, createdAt: -1 });
TableHoldSchema.index({ createdAt: -1 }); // admin insights: holds over time

module.exports = model('TableHold', TableHoldSchema, 'table_holds');
