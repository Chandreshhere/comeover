'use strict';
// conversations — direct, activity group and circle chats. `lastMessage` is
// denormalised on every send so the inbox needs one query.
const { makeSchema, sub, model } = require('./_base');

const LastMessageSchema = sub({
  id: String,
  senderId: { type: String, default: null }, // null for system
  kind: { type: String, enum: ['user', 'system'], default: 'user' },
  body: { type: String, default: null },
  createdAt: Date,
});

const ConversationSchema = makeSchema({
  kind: { type: String, enum: ['direct', 'activity_group', 'circle'], required: true },
  activityId: { type: String, default: null },
  circleId: { type: String, default: null },
  directKey: { type: String, default: undefined }, // sorted "userA:userB" for direct chats (unique)
  lastMessage: { type: LastMessageSchema, default: null },
  lastMessageAt: { type: Date, default: null },
});
ConversationSchema.index({ activityId: 1 }, { partialFilterExpression: { activityId: { $type: 'string' } } });
ConversationSchema.index({ circleId: 1 }, { partialFilterExpression: { circleId: { $type: 'string' } } });
ConversationSchema.index({ directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } });

module.exports = model('Conversation', ConversationSchema, 'conversations');
