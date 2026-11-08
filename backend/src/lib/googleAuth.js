'use strict';
// Service-account OAuth2 (JWT bearer) for Google APIs: Play Developer API
// (subscription verification) and FCM HTTP v1 (push, incl. iOS via APNs).
// Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (the JSON key, single line).
const crypto = require('crypto');
const config = require('../config');

const cache = new Map();
let sa;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function serviceAccount() {
  if (sa === undefined) {
    try {
      sa = config.google.serviceAccountJson ? JSON.parse(config.google.serviceAccountJson) : null;
    } catch (e) {
      sa = null;
    }
  }
  return sa;
}

function signJwt(account, scope, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), account.private_key);
  return `${head}.${claims}.${b64url(sig)}`;
}

async function getAccessToken(scope) {
  const hit = cache.get(scope);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const account = serviceAccount();
  if (!account) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(account, scope) }),
  });
  if (!res.ok) throw new Error(`google token error ${res.status}`);
  const data = await res.json();
  cache.set(scope, { token: data.access_token, exp: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function projectId() {
  const account = serviceAccount();
  return config.google.fcmProjectId || (account && account.project_id) || null;
}

module.exports = { getAccessToken, projectId, signJwt };
