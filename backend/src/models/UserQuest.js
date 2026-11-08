'use strict';
// user_quests — per-period quest state (daily/weekly quests repeat; periodKey from lib/quests.periodKey).
const { makeSchema, Mixed, model } = require('./_base');

const UserQuestSchema = makeSchema({
  userId: { type: String, required: true },
  questId: { type: String, required: true },
  periodKey: { type: String, default: 'all' },
  progress: { type: Mixed, default: () => ({}) },
  state: { type: String, enum: ['available', 'started', 'completed', 'claimed', 'expired'], default: 'available' },
});
UserQuestSchema.index({ userId: 1, questId: 1, periodKey: 1 }, { unique: true });
UserQuestSchema.index({ userId: 1, state: 1 });

module.exports = model('UserQuest', UserQuestSchema, 'user_quests');
