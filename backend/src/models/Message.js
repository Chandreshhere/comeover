'use strict';
// messages — senderUserId is null for system messages ("Meher accepted you…").
const { makeSchema, model } = require('./_base');

const MessageSchema = makeSchema({
  conversationId: { type: String, required: true },
  senderUserId: { type: String, default: null },
  kind: { type: String, enum: ['user', 'system'], default: 'user' },
  body: { type: String, maxlength: 2000, default: null },
  mediaKey: { type: String, default: null },
  deletedAt: { type: Date, default: null },
  clientKey: { type: String, default: undefined }, // Idempotency-Key from the client send
});
MessageSchema.pre('validate', function senderRule(next) {
  if (this.kind !== 'system' && !this.senderUserId) return next(new Error('senderUserId is required for user messages'));
  return next();
});
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderUserId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, senderUserId: 1, clientKey: 1 }, { unique: true, partialFilterExpression: { clientKey: { $type: 'string' } } });

module.exports = model('Message', MessageSchema, 'messages');
