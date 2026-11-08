'use strict';
// circles — recurring groups. memberCount is denormalised (kept in sync with CircleMember).
const { makeSchema, model } = require('./_base');

const CircleSchema = makeSchema({
  ownerUserId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  description: { type: String, maxlength: 500, default: null },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  area: { type: String, default: null },
  pictogram: { type: String, default: 'people' },
  categorySlug: { type: String, default: null },
  rules: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'archived', 'moderated'], default: 'active' },
  memberCount: { type: Number, default: 1, min: 0 },
});
CircleSchema.index({ status: 1, visibility: 1, area: 1 });
CircleSchema.index({ ownerUserId: 1 });
CircleSchema.index({ name: 'text', description: 'text' });

module.exports = model('Circle', CircleSchema, 'circles');
