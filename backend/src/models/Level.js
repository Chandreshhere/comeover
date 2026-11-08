'use strict';
// levels — XP thresholds; doubles as roadmap milestones.
const { makeSchema, model } = require('./_base');

const LevelSchema = makeSchema(
  {
    level: { type: Number, required: true },
    name: { type: String, required: true },
    xpThreshold: { type: Number, required: true },
    subtitle: { type: String, default: null },
    pictogram: { type: String, default: null },
  },
  { timestamps: false }
);
LevelSchema.index({ level: 1 }, { unique: true });
LevelSchema.index({ xpThreshold: 1 }, { unique: true });

module.exports = model('Level', LevelSchema, 'levels');
