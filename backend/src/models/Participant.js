'use strict';
// participants ← activity_participants (join requests, waitlist, check-ins, completion).
const { makeSchema, model } = require('./_base');

const STATES = ['requested', 'accepted', 'waitlisted', 'declined', 'cancelled', 'checked_in', 'completed', 'no_show'];

const ParticipantSchema = makeSchema({
  activityId: { type: String, required: true },
  userId: { type: String, required: true },
  state: { type: String, enum: STATES, required: true },
  intro: { type: String, maxlength: 280, default: null },
  idempotencyKey: { type: String, default: undefined },
  waitlistPosition: { type: Number, default: null },
  requestedAt: { type: Date, default: Date.now },
  decidedAt: { type: Date, default: null },
  decidedBy: { type: String, default: null },
  checkedInAt: { type: Date, default: null },
  checkInMethod: { type: String, enum: ['proximity', 'manual', 'host', null], default: null },
  completionConfirmedAt: { type: Date, default: null },
});
ParticipantSchema.index({ activityId: 1, userId: 1 }, { unique: true });
ParticipantSchema.index({ userId: 1, requestedAt: -1 });
ParticipantSchema.index({ activityId: 1, state: 1 });
ParticipantSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

ParticipantSchema.statics.STATES = STATES;
ParticipantSchema.statics.IN_GROUP = ['accepted', 'checked_in', 'completed'];

module.exports = model('Participant', ParticipantSchema, 'participants');
