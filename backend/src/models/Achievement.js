'use strict';
// achievements — badge definitions.
const { makeSchema, Mixed, model } = require('./_base');

const AchievementSchema = makeSchema({
  slug: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  pictogram: { type: String, default: null },
  color: { type: String, default: 'lavender' },
  criteria: { type: Mixed, required: true },
  active: { type: Boolean, default: true },
});
AchievementSchema.index({ slug: 1 }, { unique: true });

module.exports = model('Achievement', AchievementSchema, 'achievements');
