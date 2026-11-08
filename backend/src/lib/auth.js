'use strict';
// Identity from the API Gateway Cognito JWT authorizer + app_users status.
// app_users rows are provisioned by the Cognito PostAuthentication trigger.
const db = require('./db');
const { err } = require('./http');

function claims(event) {
  const a = event && event.requestContext && event.requestContext.authorizer;
  return (a && a.jwt && a.jwt.claims) || (a && a.lambda) || (a && a.claims) || null;
}

// HTTP API stringifies array claims, e.g. "[admins moderators]".
function groupsFrom(c) {
  const g = c && c['cognito:groups'];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  return String(g).replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

async function requireUser(req, { allowSuspended = false, client } = {}) {
  const c = claims(req.event);
  if (!c || !c.sub) throw err.unauthorized();
  const q = client || db;
  const { rows } = await q.query(
    `SELECT u.id, u.status, u.status_until, u.age_verified, u.phone_e164, p.display_name, p.visibility
       FROM app_users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.cognito_sub = $1`,
    [c.sub]
  );
  const u = rows[0];
  if (!u) throw err.unauthorized('user_not_provisioned', 'Sign in again to finish setting up your account');
  if (u.status === 'deleted') throw err.forbidden('account_deleted', 'This account is pending deletion');
  if (u.status === 'suspended' && !allowSuspended) throw err.forbidden('account_suspended', 'This account is suspended. You can still view case status and appeal.');
  // Activity signal for KPIs (WAU), written at most hourly per user.
  await q.query("UPDATE app_users SET last_active_at = now() WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '1 hour')", [u.id]).catch(() => {});
  return { id: u.id, sub: c.sub, status: u.status, ageVerified: u.age_verified, displayName: u.display_name, hasProfile: !!u.display_name, groups: groupsFrom(c) };
}

// Limited accounts keep safety tools but cannot create, join, message or start circles.
function assertCanAct(user, action) {
  if (user.status === 'limited' && ['create', 'join', 'message', 'circle_create', 'host'].includes(action)) {
    throw err.forbidden('account_restricted', 'Some actions are paused while a report is reviewed.');
  }
}

function assertAdult(user) {
  if (!user.ageVerified) throw err.forbidden('age_gate_required', 'Confirm you are 18+ before creating or joining plans.');
}

function assertProfile(user) {
  if (!user.hasProfile) throw err.forbidden('profile_required', 'Finish your profile first.');
}

const ADMIN_RANK = { viewer: 0, support: 1, moderator: 2, admin: 3 };

// Admin web uses the separate admin user pool (MFA required). Cognito groups:
//   admin     → everything
//   moderator → reports, activities, users, audit
// The admin_users row is upserted from the token so audit_events can reference it;
// deactivating that row (active = false) revokes access even if the token is valid.
async function requireAdmin(req, minRole = 'moderator') {
  const c = claims(req.event);
  if (!c || !c.sub) throw err.unauthorized();
  const groups = groupsFrom(c);
  const role = groups.includes('admin') ? 'admin' : groups.includes('moderator') ? 'moderator' : null;
  if (!role) throw err.forbidden('admin_only');
  if (ADMIN_RANK[role] < ADMIN_RANK[minRole]) throw err.forbidden('insufficient_role', `Requires ${minRole}`);
  const email = c.email || `${c.username || c['cognito:username'] || c.sub}@admin.irl`;
  const { rows } = await db.query(
    `INSERT INTO admin_users (cognito_sub, email, display_name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (cognito_sub) DO UPDATE SET role = EXCLUDED.role
     RETURNING id, email, display_name, role, active`,
    [c.sub, email, c.name || c.username || email, role]
  );
  const a = rows[0];
  if (!a.active) throw err.forbidden('admin_disabled');
  return a;
}

module.exports = { claims, groupsFrom, requireUser, assertCanAct, assertAdult, assertProfile, requireAdmin, ADMIN_RANK };
