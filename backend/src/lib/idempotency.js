'use strict';
// Idempotency-Key support for mutating endpoints (join requests, expense
// creation, payment callbacks). First request reserves the key; retries with
// the same key + same body replay the stored response; a different body is 422.
const crypto = require('crypto');
const { err, header, json } = require('./http');

const KEY_RE = /^[A-Za-z0-9:_\-.]{8,128}$/;

function normalizeKey(raw) {
  if (raw == null || raw === '') return null;
  const k = String(raw).trim();
  if (!KEY_RE.test(k)) throw err.badRequest('invalid_idempotency_key', 'Idempotency-Key must be 8–128 chars of [A-Za-z0-9:_-.]');
  return k;
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(',')}}`;
}

function hashRequest(method, route, body) {
  return crypto.createHash('sha256').update(`${method} ${route}\n${stableStringify(body || {})}`).digest('hex');
}

// Pure decision (unit-tested): what to do given a stored record.
function decide(existing, hash) {
  if (!existing) return 'proceed';
  if (existing.request_hash !== hash) return 'conflict';
  if (existing.status_code == null) return 'in_progress';
  return 'replay';
}

// Wrap a handler body. `db` must expose query(). Keys are scoped per user.
async function withIdempotency(db, req, userId, fn, { required = false } = {}) {
  const key = normalizeKey(header(req.event, 'idempotency-key'));
  if (!key) {
    if (required) throw err.badRequest('idempotency_key_required', 'Send an Idempotency-Key header for this request');
    return fn();
  }
  const route = req.event.routeKey || `${req.event.requestContext?.http?.method} ${req.event.rawPath}`;
  const method = route.split(' ')[0];
  const hash = hashRequest(method, `${route}:${JSON.stringify(req.params || {})}`, req.body);

  const reserved = await db.query(
    'INSERT INTO idempotency_keys (user_id, key, route, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING key',
    [userId, key, route, hash]
  );
  if (!reserved.rowCount) {
    const { rows } = await db.query('SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
    const d = decide(rows[0], hash);
    if (d === 'replay') return json(rows[0].status_code, rows[0].response, { 'idempotent-replay': 'true' });
    if (d === 'conflict') throw err.unprocessable('idempotency_key_reused', 'This Idempotency-Key was used with a different request');
    if (d === 'in_progress') throw err.conflict('request_in_progress', 'The original request is still being processed');
  }
  try {
    const res = await fn();
    const isResponse = res && typeof res.statusCode === 'number';
    const status = isResponse ? res.statusCode : 200;
    const body = isResponse ? (res.body ? JSON.parse(res.body) : null) : res === undefined ? { ok: true } : res;
    await db.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2', [userId, key, status, JSON.stringify(body)]);
    return isResponse ? res : json(200, body);
  } catch (e) {
    // Release the reservation so the client can retry after fixing the request.
    await db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status_code IS NULL', [userId, key]).catch(() => {});
    throw e;
  }
}

module.exports = { normalizeKey, stableStringify, hashRequest, decide, withIdempotency };
