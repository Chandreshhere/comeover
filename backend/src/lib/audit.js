'use strict';
// Append-only audit trail for safety-relevant and admin actions.
async function audit(q, { actorUserId = null, actorAdminId = null, action, targetType = null, targetId = null, metadata = {}, ip = null }) {
  await q.query(
    'INSERT INTO audit_events (actor_user_id, actor_admin_id, action, target_type, target_id, metadata, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [actorUserId, actorAdminId, action, targetType, targetId == null ? null : String(targetId), JSON.stringify(metadata), ip]
  );
}

module.exports = { audit };
