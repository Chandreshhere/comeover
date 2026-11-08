'use strict';
// blocks ← user_blocks
const { makeSchema, model } = require('./_base');

const BlockSchema = makeSchema(
  {
    blockerUserId: { type: String, required: true },
    blockedUserId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
BlockSchema.pre('validate', function notSelf(next) {
  if (this.blockerUserId === this.blockedUserId) return next(new Error('cannot block yourself'));
  return next();
});
BlockSchema.index({ blockerUserId: 1, blockedUserId: 1 }, { unique: true });
BlockSchema.index({ blockedUserId: 1 });

module.exports = model('Block', BlockSchema, 'blocks');
