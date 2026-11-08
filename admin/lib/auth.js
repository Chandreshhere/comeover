// Cognito Hosted UI — OAuth 2.0 authorization code flow with PKCE (public
// client, no secret). Tokens live in sessionStorage (cleared when the tab
// closes). Roles come from the ID token `cognito:groups` claim:
//   admin     -> everything
//   moderator -> reports, activities, users, audit
// The backend verifies the access token and re-checks every permission; the
// UI only hides what a role cannot use.
import { config } from './config';

const TOKENS = 'irl-admin-tokens';
const PKCE = 'irl-admin-pkce';
export const UNAUTHORIZED_EVENT = 'irl-admin:unauthorized';

// ---------------- permissions ----------------
const PERMISSIONS = {
  admin: ['dashboard.view', 'reports.view', 'reports.act', 'appeals.decide', 'users.view', 'users.status', 'activities.review', 'audit.view', 'billing.view', 'taxonomy.edit'],
  moderator: ['reports.view', 'reports.act', 'appeals.decide', 'users.view', 'users.status', 'activities.review', 'audit.view'],
};
export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator' };
export const can = (role, permission) => !!PERMISSIONS[role]?.includes(permission);
export const homeFor = (role) => (role === 'admin' ? '/admin/dashboard' : '/admin/reports');

export function roleFromGroups(groups) {
  const g = Array.isArray(groups) ? groups : typeof groups === 'string' ? groups.split(/[,\s]+/) : [];
  if (g.includes('admin')) return 'admin';
  if (g.includes('moderator')) return 'moderator';
  return null;
}

// ---------------- helpers ----------------
const hasWindow = () => typeof window !== 'undefined';

function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64url(new Uint8Array(digest));
}

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

// ---------------- session ----------------
export function getSession() {
  const t = readTokens();
  if (!t?.idToken) return null;
  const claims = decodeJwt(t.idToken) || {};
  const groups = claims['cognito:groups'] || [];
  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name || claims.given_name || claims['cognito:username'] || claims.email || 'Admin',
    groups,
    role: roleFromGroups(groups),
    expiresAt: t.expiresAt,
  };
}

// ---------------- login ----------------
export async function startLogin(returnTo = '/admin') {
  const verifier = randomString(64);
  const state = randomString(24);
  const challenge = await sha256(verifier);
  window.sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state, returnTo }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.cognitoClientId,
    redirect_uri: config.cognitoRedirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${config.cognitoDomain}/oauth2/authorize?${q.toString()}`);
}

async function tokenRequest(params) {
  const res = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.cognitoClientId, ...params }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error_description || data.error || `Token endpoint returned ${res.status}`);
    e.status = res.status;
    e.code = data.error;
    throw e;
  }
  return data;
}

// Exchange ?code&state on /auth/callback. Returns the path to continue to.
export async function completeLogin(search) {
  const params = new URLSearchParams(search);
  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
  const code = params.get('code');
  const state = params.get('state');
  let pkce = null;
  try {
    pkce = JSON.parse(window.sessionStorage.getItem(PKCE));
  } catch {
    pkce = null;
  }
  window.sessionStorage.removeItem(PKCE);
  if (!code) throw new Error('No authorization code in the callback URL.');
  if (!pkce || pkce.state !== state) throw new Error('Sign-in state did not match. Start sign-in again from this browser tab.');
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.cognitoRedirectUri, code_verifier: pkce.verifier });
  writeTokens({
    idToken: t.id_token,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
  });
  return pkce.returnTo || '/admin';
}

// ---------------- refresh ----------------
let refreshing = null;

export function refreshTokens() {
  if (refreshing) return refreshing;
  const current = readTokens();
  if (!current?.refreshToken) return Promise.resolve(null);
  refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken })
    .then((t) => {
      // Cognito does not rotate the refresh token on this grant; keep the old one.
      const next = {
        idToken: t.id_token || current.idToken,
        accessToken: t.access_token,
        refreshToken: t.refresh_token || current.refreshToken,
        expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
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
export function logout() {
  clearTokens();
  window.sessionStorage.removeItem(PKCE);
  const q = new URLSearchParams({ client_id: config.cognitoClientId, logout_uri: config.cognitoLogoutUri });
  window.location.assign(`${config.cognitoDomain}/logout?${q.toString()}`);
}
