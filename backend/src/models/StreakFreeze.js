'use strict';
// streak_freezes — one recover/freeze per ISO week, applied to a day ("YYYY-MM-DD").
const { makeSchema, model } = require('./_base');

const StreakFreezeSchema = makeSchema(
  {
    userId: { type: String, required: true },
    day: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
StreakFreezeSchema.index({ userId: 1, day: 1 }, { unique: true });

module.exports = model('StreakFreeze', StreakFreezeSchema, 'streak_freezes');
