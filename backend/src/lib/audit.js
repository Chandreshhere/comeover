'use strict';
// Append-only audit trail for safety-relevant and admin actions.
//   await audit({ actorUserId, action: 'user.age_confirmed', targetType: 'user', targetId, ip }, { session });
// actorAdminId is the admin's User id (admins are users with roles).
async function audit(entry, { session } = {}) {
  const { AuditEvent } = require('../models');
  const { actorUserId = null, actorAdminId = null, action, targetType = null, targetId = null, metadata = {}, ip = null } = entry;
  await AuditEvent.create([{ actorUserId, actorAdminId, action, targetType, targetId: targetId == null ? null : String(targetId), metadata, ip }], session ? { session } : undefined);
}

module.exports = { audit };
