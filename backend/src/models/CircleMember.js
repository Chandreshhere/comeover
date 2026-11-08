'use strict';
// circle_members
const { makeSchema, model } = require('./_base');

const CircleMemberSchema = makeSchema(
  {
    circleId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ['owner', 'moderator', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
CircleMemberSchema.index({ circleId: 1, userId: 1 }, { unique: true });
CircleMemberSchema.index({ userId: 1 });
CircleMemberSchema.index({ circleId: 1, role: 1, joinedAt: 1 });

module.exports = model('CircleMember', CircleMemberSchema, 'circle_members');
