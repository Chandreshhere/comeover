// Phone OTP sign-in against the Come Over API, which delivers codes via
// Slide (WhatsApp or SMS). The API issues a short-lived JWT access token
// (claims: sub, roles) and a rotating refresh token. Tokens live in
// sessionStorage (cleared when the tab closes). Roles are assigned on the
// server (`npm run grant-role` in backend/):
//   admin     -> everything
//   moderator -> reports, activities, users, audit
// The backend re-checks every permission; the UI only hides what a role cannot use.
import { config } from './config';

const TOKENS = 'irl-admin-tokens';
export const UNAUTHORIZED_EVENT = 'irl-admin:unauthorized';

// ---------------- permissions ----------------
const PERMISSIONS = {
  admin: ['dashboard.view', 'reports.view', 'reports.act', 'appeals.decide', 'users.view', 'users.directory', 'users.status', 'activities.review', 'audit.view', 'billing.view', 'partners.manage', 'announcements.send', 'taxonomy.edit'],
  moderator: ['reports.view', 'reports.act', 'appeals.decide', 'users.view', 'users.status', 'activities.review', 'audit.view'],
};
export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' };
export const can = (role, permission) => !!PERMISSIONS[role]?.includes(permission);
export const homeFor = (role) => (role === 'admin' ? '/admin/dashboard' : '/admin/reports');

export function roleFromRoles(roles) {
  const r = Array.isArray(roles) ? roles : typeof roles === 'string' ? roles.split(/[,\s]+/) : [];
  if (r.includes('admin')) return 'admin';
  if (r.includes('moderator')) return 'moderator';
  return null;
}

// ---------------- helpers ----------------
const hasWindow = () => typeof window !== 'undefined';

export function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = part.length % 4 ? '='.repeat(4 - (part.length % 4)) : '';
    const json = decodeURIComponent(
      atob(part + pad)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readTokens() {
  if (!hasWindow()) return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(TOKENS));
  } catch {
    return null;
  }
}

function writeTokens(t) {
  window.sessionStorage.setItem(TOKENS, JSON.stringify(t));
}

export function clearTokens() {
  if (hasWindow()) window.sessionStorage.removeItem(TOKENS);
}

export class AuthError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const FRIENDLY = {
  invalid_phone: 'Check the phone number.',
  otp_rate_limited: 'Too many codes requested. Wait a minute and try again.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  otp_invalid: "That code didn't match.",
  otp_expired: 'That code has expired. Request a new one.',
  otp_locked: 'Too many wrong codes. Request a new one.',
  session_expired: 'Your session expired. Sign in again.',
  slide_unavailable: "Couldn't send a code right now. Try again shortly.",
  auth_not_configured: 'Sign-in is not configured on the server.',
  network: 'Network error. Check your connection, the API URL and the CORS settings.',
};

async function authPost(path, body, token) {
  let res;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new AuthError('network', FRIENDLY.network);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.code || `http_${res.status}`;
    throw new AuthError(code, FRIENDLY[code] || data.message || `Request failed (${res.status})`, { status: res.status, retryAfterSec: data.details?.retryAfterSec });
  }
  return data;
}

// ---------------- session ----------------
export function getSession() {
  const t = readTokens();
  if (!t?.accessToken) return null;
  const claims = decodeJwt(t.accessToken) || {};
  const roles = t.profile?.role ? [t.profile.role] : claims.roles || [];
  return {
    sub: claims.sub,
    id: claims.sub,
    email: t.profile?.phone || '',
    phone: t.profile?.phone || '',
    name: t.profile?.name || 'Admin',
    groups: roles,
    role: roleFromRoles(roles),
    expiresAt: t.expiresAt,
  };
}

// ---------------- login (OTP) ----------------
// Returns { requestId, channel, retryAfterSec, maskedPhone }.
export const requestOtp = (phone) => authPost('/auth/otp/request', { phone });
export const resendOtp = (requestId, channel) => authPost('/auth/otp/resend', { requestId, channel });

export async function verifyOtp(requestId, code) {
  const r = await authPost('/auth/otp/verify', { requestId, code });
  const t = { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: Date.now() + (Number(r.expiresIn) || 900) * 1000, profile: null };
  writeTokens(t);
  // Admin identity + role (the server is the source of truth).
  try {
    const res = await fetch(`${config.apiUrl}/admin/me`, { headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json' } });
    if (res.ok) {
      const me = await res.json();
      writeTokens({ ...t, profile: { id: me.id, name: me.name, phone: me.phone, role: me.role } });
    }
  } catch {
    // role falls back to the token claims
  }
  return getSession();
}

// ---------------- refresh (rotating) ----------------
let refreshing = null;

export function refreshTokens() {
  if (refreshing) return refreshing;
  const current = readTokens();
  if (!current?.refreshToken) return Promise.resolve(null);
  refreshing = authPost('/auth/session/refresh', { refreshToken: current.refreshToken })
    .then((r) => {
      const next = {
        ...current,
        accessToken: r.accessToken,
        refreshToken: r.refreshToken || current.refreshToken,
        expiresAt: Date.now() + (Number(r.expiresIn) || 900) * 1000,
      };
      writeTokens(next);
      return next.accessToken;
    })
    .catch(() => {
      clearTokens();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function getAccessToken() {
  const t = readTokens();
  if (!t?.accessToken) return null;
  if (Date.now() > (t.expiresAt || 0) - 60000) return refreshTokens();
  return t.accessToken;
}

export function notifyUnauthorized() {
  if (hasWindow()) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

// ---------------- logout ----------------
export async function logout() {
  const t = readTokens();
  clearTokens();
  if (t?.refreshToken) {
    try {
      await authPost('/auth/logout', { refreshToken: t.refreshToken });
    } catch {
      // ignore: local sign-out already done
    }
  }
  window.location.assign('/login?signedout=1');
}
