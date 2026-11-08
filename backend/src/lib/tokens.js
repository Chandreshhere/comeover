'use strict';
// Our own tokens (Slide only proves phone ownership; it doesn't issue our sessions).
//  - Access token: JWT HS256 (JWT_SECRET), 15 min, claims { sub, roles, sid }.
//  - Refresh token: 48 random bytes (base64url), stored as sha256 in `sessions`,
//    30-day expiry, rotated on every use within a `familyId`. Presenting an
//    already-rotated token is treated as theft: the whole family is revoked.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { err } = require('./http');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

function requireSecret() {
  if (!config.jwt.secret || config.jwt.secret.length < 32) {
    throw err.unavailable('auth_not_configured', 'JWT_SECRET must be set (at least 32 characters)');
  }
  return config.jwt.secret;
}

function signAccessToken({ userId, roles = [], sid }) {
  return jwt.sign({ roles, sid }, requireSecret(), {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: config.jwt.issuer,
    expiresIn: config.jwt.accessTtlSec,
  });
}

// Returns claims or throws 401 token_expired / token_invalid.
function verifyAccessToken(token) {
  try {
    return jwt.verify(String(token), requireSecret(), { algorithms: ['HS256'], issuer: config.jwt.issuer });
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') throw err.unauthorized('token_expired', 'Session expired. Refresh and retry.');
    if (e && e.code === 'auth_not_configured') throw e;
    throw err.unauthorized('token_invalid', 'Sign in again.');
  }
}

async function createSession(userId, { familyId = crypto.randomUUID(), ip = null, userAgent = null, session } = {}) {
  const { Session } = require('../models');
  const refreshToken = newRefreshToken();
  const [doc] = await Session.create(
    [{ userId, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 86400000), ip, userAgent: userAgent ? String(userAgent).slice(0, 200) : null }],
    session ? { session } : undefined
  );
  return { refreshToken, session: doc };
}

async function issueTokens(user, ctx = {}) {
  const { refreshToken, session } = await createSession(user._id || user.id, ctx);
  const accessToken = signAccessToken({ userId: user._id || user.id, roles: user.roles || [], sid: session.familyId });
  return { accessToken, refreshToken, expiresIn: config.jwt.accessTtlSec, tokenType: 'Bearer' };
}

async function revokeFamily(familyId, reason) {
  const { Session } = require('../models');
  await Session.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

// Rotate a refresh token. Throws 401 session_expired for unknown/expired/revoked/reused tokens.
async function rotateRefreshToken(refreshToken, { ip = null, userAgent = null } = {}) {
  const { Session, User } = require('../models');
  if (!refreshToken || typeof refreshToken !== 'string') throw err.unauthorized('session_expired', 'Sign in again.');
  const hash = sha256(refreshToken);
  const now = new Date();
  const claimed = await Session.findOneAndUpdate(
    { tokenHash: hash, rotatedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { rotatedAt: now, lastUsedAt: now } },
    { new: true }
  ).lean();
  if (!claimed) {
    const existing = await Session.findOne({ tokenHash: hash }).lean();
    if (existing && existing.rotatedAt && !existing.revokedAt) {
      // Reuse of a rotated token → assume theft, revoke the whole family.
      await revokeFamily(existing.familyId, 'reuse_detected');
    }
    throw err.unauthorized('session_expired', 'Sign in again.');
  }
  const user = await User.findById(claimed.userId).select('status roles').lean();
  if (!user || user.status === 'deleted') {
    await revokeFamily(claimed.familyId, 'user_unavailable');
    throw err.unauthorized('session_expired', 'Sign in again.');
  }
  const next = await createSession(user._id, { familyId: claimed.familyId, ip, userAgent });
  await Session.updateOne({ _id: claimed._id }, { $set: { replacedBy: next.session._id } });
  return {
    accessToken: signAccessToken({ userId: user._id, roles: user.roles || [], sid: claimed.familyId }),
    refreshToken: next.refreshToken,
    expiresIn: config.jwt.accessTtlSec,
    tokenType: 'Bearer',
  };
}

// Logout: revoke the family the refresh token belongs to (this device).
async function revokeRefreshToken(refreshToken) {
  const { Session } = require('../models');
  if (!refreshToken) return false;
  const s = await Session.findOne({ tokenHash: sha256(refreshToken) }).select('familyId').lean();
  if (!s) return false;
  await revokeFamily(s.familyId, 'logout');
  return true;
}

async function revokeAllForUser(userId, reason = 'logout_all') {
  const { Session } = require('../models');
  const r = await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
  return r.modifiedCount || 0;
}

module.exports = { sha256, signAccessToken, verifyAccessToken, createSession, issueTokens, rotateRefreshToken, revokeRefreshToken, revokeAllForUser, revokeFamily };
