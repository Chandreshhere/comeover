'use strict';
// report_actions — enforcement decisions (adminId = User id of the admin/moderator).
const { makeSchema, model } = require('./_base');

const ReportActionSchema = makeSchema(
  {
    reportId: { type: String, required: true },
    adminId: { type: String, default: null },
    action: { type: String, enum: ['dismiss', 'warn', 'limit', 'suspend', 'remove_content', 'cancel_activity', 'restore', 'escalate'], required: true },
    notes: { type: String, default: null },
    durationDays: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ReportActionSchema.index({ reportId: 1, createdAt: 1 });

module.exports = model('ReportAction', ReportActionSchema, 'report_actions');
