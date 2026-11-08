'use strict';
// quests — criteria evaluated server-side by lib/quests.evaluateQuest.
const { makeSchema, Mixed, model } = require('./_base');

const QuestSchema = makeSchema({
  slug: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  criteria: { type: Mixed, required: true },
  xpReward: { type: Number, required: true, min: 0 },
  kind: { type: String, enum: ['daily', 'weekly', 'milestone'], default: 'weekly' },
  pictogram: { type: String, default: null },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
});
QuestSchema.index({ slug: 1 }, { unique: true });
QuestSchema.index({ active: 1, kind: 1 });

module.exports = model('Quest', QuestSchema, 'quests');
