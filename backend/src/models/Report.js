'use strict';
// reports — user safety reports (moderation queue).
const { makeSchema, model } = require('./_base');

const ReportSchema = makeSchema({
  reporterUserId: { type: String, required: true },
  reportedUserId: { type: String, default: null },
  activityId: { type: String, default: null },
  messageId: { type: String, default: null },
  conversationId: { type: String, default: null },
  circleId: { type: String, default: null },
  reasonCode: { type: String, required: true },
  details: { type: String, maxlength: 2000, default: null },
  evidenceKeys: { type: [String], default: [] },
  evidenceNote: { type: String, maxlength: 2000, default: null },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['open', 'reviewing', 'actioned', 'dismissed', 'appealed'], default: 'open' },
  assignedAdminId: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
});
ReportSchema.index({ status: 1, priority: 1, createdAt: 1 });
ReportSchema.index({ reportedUserId: 1, createdAt: -1 });
ReportSchema.index({ reporterUserId: 1, createdAt: -1 });

module.exports = model('Report', ReportSchema, 'reports');
