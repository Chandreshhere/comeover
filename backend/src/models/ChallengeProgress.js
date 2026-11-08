'use strict';
// challenge_progress ← circle_challenge_progress
const { makeSchema, model } = require('./_base');

const ChallengeProgressSchema = makeSchema({
  challengeId: { type: String, required: true },
  userId: { type: String, required: true },
  count: { type: Number, default: 0, min: 0 },
});
ChallengeProgressSchema.index({ challengeId: 1, userId: 1 }, { unique: true });
ChallengeProgressSchema.index({ challengeId: 1, count: -1 });

module.exports = model('ChallengeProgress', ChallengeProgressSchema, 'challenge_progress');
