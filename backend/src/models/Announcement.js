'use strict';
// announcements — admin broadcasts for pilot launches and events (handlers/insights.js).
// Each send writes one in-app Notification per recipient and queues push in batches.
const { makeSchema, sub, model } = require('./_base');

const AudienceSchema = sub({
  kind: { type: String, enum: ['all', 'area'], required: true },
  value: { type: String, default: null }, // area name when kind = 'area'
});

const AnnouncementSchema = makeSchema({
  title: { type: String, required: true, maxlength: 60 },
  body: { type: String, required: true, maxlength: 180 },
  audience: { type: AudienceSchema, required: true },
  deepLink: { type: String, default: null }, // projectirl://<path>
  recipients: { type: Number, default: 0 },
  status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending' },
  createdBy: { type: String, required: true }, // admin User id
  reason: { type: String, required: true },
});
AnnouncementSchema.index({ createdAt: -1 });

module.exports = model('Announcement', AnnouncementSchema, 'announcements');
