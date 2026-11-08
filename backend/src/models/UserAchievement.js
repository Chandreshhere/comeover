'use strict';
// user_achievements
const { makeSchema, Mixed, model } = require('./_base');

const UserAchievementSchema = makeSchema(
  {
    userId: { type: String, required: true },
    achievementId: { type: String, required: true },
    earnedAt: { type: Date, default: Date.now },
    evidence: { type: Mixed, default: () => ({}) },
  },
  { timestamps: false }
);
UserAchievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });

module.exports = model('UserAchievement', UserAchievementSchema, 'user_achievements');
