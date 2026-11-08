'use strict';
// notifications — in-app inbox. data.target = { screen, params } (mobile inventory ids).
const { makeSchema, Mixed, model } = require('./_base');

const NotificationSchema = makeSchema(
  {
    userId: { type: String, required: true },
    type: { type: String, enum: ['activity', 'nearby', 'join', 'message', 'quest', 'safety', 'system', 'marketing'], required: true },
    title: { type: String, required: true },
    body: { type: String, default: null },
    data: { type: Mixed, default: () => ({}) },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });

module.exports = model('Notification', NotificationSchema, 'notifications');
