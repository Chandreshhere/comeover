'use strict';
// conversation_members — membership + per-user state (mute, read marker, left, hidden).
const { makeSchema, model } = require('./_base');

const ConversationMemberSchema = makeSchema(
  {
    conversationId: { type: String, required: true },
    userId: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
    muted: { type: Boolean, default: false },
    lastReadAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    hiddenAt: { type: Date, default: null }, // "delete for me" on direct chats (reappears on new message)
    lastMessageAt: { type: Date, default: null }, // copied from the conversation for inbox sorting
  },
  { timestamps: false }
);
ConversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
ConversationMemberSchema.index({ userId: 1, leftAt: 1, lastMessageAt: -1 });

module.exports = model('ConversationMember', ConversationMemberSchema, 'conversation_members');
