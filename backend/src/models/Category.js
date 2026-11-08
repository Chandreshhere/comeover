'use strict';
// categories ← activity_categories
const { makeSchema, model } = require('./_base');

const CategorySchema = makeSchema({
  slug: { type: String, required: true },
  label: { type: String, required: true },
  short: { type: String, default: null },
  pictogram: { type: String, default: 'sparkle' },
  riskLevel: { type: String, enum: ['standard', 'elevated', 'restricted'], default: 'standard' },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 100 },
});
CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ isActive: 1, sortOrder: 1 });

module.exports = model('Category', CategorySchema, 'categories');
