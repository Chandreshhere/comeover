'use strict';
// appeals — one appeal per (report, user).
const { makeSchema, model } = require('./_base');

const AppealSchema = makeSchema({
  reportId: { type: String, required: true },
  userId: { type: String, required: true },
  statement: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'upheld', 'overturned'], default: 'open' },
  decidedBy: { type: String, default: null },
  decidedAt: { type: Date, default: null },
});
AppealSchema.index({ reportId: 1, userId: 1 }, { unique: true });
AppealSchema.index({ status: 1, createdAt: 1 });

module.exports = model('Appeal', AppealSchema, 'appeals');
