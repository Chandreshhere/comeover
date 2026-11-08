'use strict';
// audit_events — append-only trail for safety-relevant and admin actions.
// actorAdminId is the User id of an admin/moderator (admin_users is replaced by User.roles).
const { makeSchema, Mixed, model } = require('./_base');

const AuditEventSchema = makeSchema(
  {
    actorUserId: { type: String, default: null },
    actorAdminId: { type: String, default: null },
    action: { type: String, required: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    metadata: { type: Mixed, default: () => ({}) },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AuditEventSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
AuditEventSchema.index({ actorUserId: 1, createdAt: -1 });
AuditEventSchema.index({ actorAdminId: 1, createdAt: -1 });
AuditEventSchema.index({ createdAt: -1 });

module.exports = model('AuditEvent', AuditEventSchema, 'audit_events');
