'use strict';
// Request identity. The app middleware verifies `Authorization: Bearer <access JWT>`
// into req.authClaims (or req.authError); these helpers load the user and enforce status.
//
//   const user = await requireUser(req);                       // 401/403 when not allowed
//   const user = await requireUser(req, { allowSuspended: true });
//   assertCanAct(user, 'join'); assertAdult(user); assertProfile(user);
//   const admin = await requireAdmin(req, 'admin');           // 'moderator' (default) | 'admin'
const { err } = require('./http');
const { verifyAccessToken } = require('./tokens');

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : null;
}

// Returns verified claims or throws 401.
function claims(req) {
  if (req.authClaims) return req.authClaims;
  if (req.authError) throw req.authError;
  const token = bearer(req);
  if (!token) throw err.unauthorized('unauthorized', 'Sign in to continue.');
  req.authClaims = verifyAccessToken(token);
  return req.authClaims;
}

function toUser(u) {
  const roles = u.roles || [];
  return {
    id: u._id,
    sub: u._id,
    status: u.status,
    statusUntil: u.statusUntil || null,
    ageVerified: !!u.ageVerified,
    displayName: (u.profile && u.profile.displayName) || null,
    hasProfile: !!(u.profile && u.profile.displayName),
    visibility: (u.profile && u.profile.visibility) || 'discoverable',
    roles,
    groups: roles, // legacy alias (cognito:groups)
  };
}

async function requireUser(req, { allowSuspended = false, session } = {}) {
  if (req.user && req.user.id && (allowSuspended || req.user.status !== 'suspended')) return req.user;
  const c = claims(req);
  const { User } = require('../models');
  const q = User.findById(c.sub).select('status statusUntil ageVerified roles profile.displayName profile.visibility lastActiveAt');
  if (session) q.session(session);
  const u = await q.lean();
  if (!u) throw err.unauthorized('user_not_found', 'Sign in again.');
  if (u.status === 'deleted') throw err.forbidden('account_deleted', 'This account is pending deletion');
  if (u.status === 'suspended' && !allowSuspended) throw err.forbidden('account_suspended', 'This account is suspended. You can still view case status and appeal.');
  // Activity signal for KPIs (WAU), written at most hourly per user.
  if (!u.lastActiveAt || Date.now() - new Date(u.lastActiveAt).getTime() > 3600000) {
    User.updateOne({ _id: u._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
  }
  req.user = toUser(u);
  return req.user;
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

const ADMIN_RANK = { moderator: 2, admin: 3 };

function roleOf(roles = []) {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('moderator')) return 'moderator';
  return null;
}

// Admin console access is a role on the user (granted with scripts/grant-role.js):
//   admin     → everything
//   moderator → reports, activities, users, audit
// Roles are re-read from the database on every call, so revoking a role takes effect immediately.
async function requireAdmin(req, minRole = 'moderator') {
  const c = claims(req);
  const { User } = require('../models');
  const u = await User.findById(c.sub).select('status roles phone profile.displayName').lean();
  if (!u || u.status === 'deleted' || u.status === 'suspended') throw err.forbidden('admin_disabled');
  const role = roleOf(u.roles);
  if (!role) throw err.forbidden('admin_only');
  if ((ADMIN_RANK[role] || 0) < (ADMIN_RANK[minRole] || 0)) throw err.forbidden('insufficient_role', `Requires ${minRole}`);
  const name = (u.profile && u.profile.displayName) || 'Admin';
  return { id: u._id, userId: u._id, role, name, displayName: name, display_name: name, phone: u.phone, email: null, active: true };
}

module.exports = { bearer, claims, toUser, requireUser, assertCanAct, assertAdult, assertProfile, requireAdmin, roleOf, ADMIN_RANK };
