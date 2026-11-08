'use strict';
// circle_challenges — shared group milestones.
const { makeSchema, model } = require('./_base');

const CircleChallengeSchema = makeSchema({
  circleId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, maxlength: 500, default: null },
  targetCount: { type: Number, required: true, min: 1 },
  xpReward: { type: Number, default: 0, min: 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  createdBy: { type: String, default: null },
});
CircleChallengeSchema.index({ circleId: 1, endsAt: -1 });

module.exports = model('CircleChallenge', CircleChallengeSchema, 'circle_challenges');
