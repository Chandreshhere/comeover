'use strict';
// Idempotency-Key support for mutating endpoints (join requests, expense creation,
// payment callbacks). The first request reserves the key; retries with the same
// key + same body replay the stored response; a different body is 422.
//
//   return withIdempotency(req, user.id, async () => { ...; return result; }, { required: false });
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
  if (existing.requestHash !== hash) return 'conflict';
  if (existing.statusCode == null) return 'in_progress';
  return 'replay';
}

async function withIdempotency(req, userId, fn, { required = false } = {}) {
  const { IdempotencyKey } = require('../models');
  const key = normalizeKey(header(req, 'idempotency-key'));
  if (!key) {
    if (required) throw err.badRequest('idempotency_key_required', 'Send an Idempotency-Key header for this request');
    return fn();
  }
  const route = req.routeKey || `${req.method} ${req.path}`;
  const method = route.split(' ')[0];
  const hash = hashRequest(method, `${route}:${JSON.stringify(req.params || {})}`, req.body);

  try {
    await IdempotencyKey.create({ userId, key, route, requestHash: hash });
  } catch (e) {
    if (e && e.code !== 11000) throw e;
    const existing = await IdempotencyKey.findOne({ userId, key }).lean();
    const d = decide(existing, hash);
    if (d === 'replay') return json(existing.statusCode, existing.response, { 'idempotent-replay': 'true' });
    if (d === 'conflict') throw err.unprocessable('idempotency_key_reused', 'This Idempotency-Key was used with a different request');
    if (d === 'in_progress') throw err.conflict('request_in_progress', 'The original request is still being processed');
  }
  try {
    const res = await fn();
    const isResponse = res && typeof res.statusCode === 'number';
    const status = isResponse ? res.statusCode : 200;
    const body = isResponse ? (res.body ? JSON.parse(res.body) : null) : res === undefined ? { ok: true } : res;
    await IdempotencyKey.updateOne({ userId, key }, { $set: { statusCode: status, response: body } });
    return isResponse ? res : json(200, body);
  } catch (e) {
    // Release the reservation so the client can retry after fixing the request.
    await IdempotencyKey.deleteOne({ userId, key, statusCode: null }).catch(() => {});
    throw e;
  }
}

module.exports = { normalizeKey, stableStringify, hashRequest, decide, withIdempotency };
