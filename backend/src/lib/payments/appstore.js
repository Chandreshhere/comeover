'use strict';
// Apple App Store Server API (StoreKit 2) verification.
// Credentials (TODO): APPLE_IAP_SECRET_ARN → { issuerId, keyId, privateKey (p8 PEM) },
// APPLE_BUNDLE_ID, APPLE_ROOT_CA_G3_SHA256 (fingerprint of Apple Root CA - G3), APPLE_ENV=Production|Sandbox.
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function decodeJwsPayload(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw new Error('malformed JWS');
  return JSON.parse(fromB64url(parts[1]).toString('utf8'));
}

// Verify an Apple-signed JWS (signedPayload / signedTransactionInfo):
// x5c chain leaf→intermediate→root, root pinned by SHA-256 fingerprint, ES256 signature.
function verifyAppleJws(jws, rootFingerprint = process.env.APPLE_ROOT_CA_G3_SHA256) {
  if (!rootFingerprint) {
    const e = new Error('Apple root CA fingerprint not configured');
    e.code = 'apple_not_configured';
    throw e;
  }
  const [h, p, s] = String(jws).split('.');
  const header = JSON.parse(fromB64url(h).toString('utf8'));
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length < 3) throw new Error('unexpected JWS header');
  const certs = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  const [leaf, intermediate, root] = certs;
  const norm = (f) => f.replace(/:/g, '').toLowerCase();
  if (norm(root.fingerprint256) !== norm(rootFingerprint)) throw new Error('untrusted root');
  if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey)) throw new Error('broken chain');
  const now = Date.now();
  for (const c of certs) if (Date.parse(c.validFrom) > now || Date.parse(c.validTo) < now) throw new Error('certificate expired');
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(s));
  if (!ok) throw new Error('bad signature');
  return JSON.parse(fromB64url(p).toString('utf8'));
}

let credsPromise;
async function creds() {
  if (!credsPromise) {
    credsPromise = (async () => {
      if (!process.env.APPLE_IAP_SECRET_ARN) return null;
      const { getSecretJson } = require('../aws');
      return getSecretJson(process.env.APPLE_IAP_SECRET_ARN);
    })();
  }
  return credsPromise;
}

function apiJwt({ issuerId, keyId, privateKey }, bundleId, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: issuerId, iat: nowSec, exp: nowSec + 1200, aud: 'appstoreconnect-v1', bid: bundleId }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

// Fetch a transaction directly from Apple and verify its signed payload.
async function getTransaction(transactionId) {
  const c = await creds();
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!c || !bundleId) {
    const e = new Error('App Store Server API not configured');
    e.code = 'apple_not_configured';
    throw e;
  }
  const host = process.env.APPLE_ENV === 'Production' ? 'https://api.storekit.itunes.apple.com' : 'https://api.storekit-sandbox.itunes.apple.com';
  const res = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, { headers: { authorization: `Bearer ${apiJwt(c, bundleId)}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`apple api ${res.status}`);
  const data = await res.json();
  const tx = verifyAppleJws(data.signedTransactionInfo);
  if (tx.bundleId !== bundleId) throw new Error('bundle mismatch');
  return {
    store: 'apple',
    productId: tx.productId,
    transactionId: String(tx.transactionId),
    originalTransactionId: String(tx.originalTransactionId),
    expiresAt: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null,
    revoked: !!tx.revocationDate,
    raw: tx,
  };
}

module.exports = { decodeJwsPayload, verifyAppleJws, apiJwt, getTransaction };
