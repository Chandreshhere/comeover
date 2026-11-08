'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const idem = require('../src/lib/idempotency');
const { HttpError } = require('../src/lib/http');
const { startMongo, stopMongo } = require('./helpers/mongo');

test('normalizeKey accepts UUIDs and rejects junk', () => {
  assert.equal(idem.normalizeKey(' 3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b '), '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b');
  assert.equal(idem.normalizeKey(undefined), null);
  assert.equal(idem.normalizeKey(''), null);
  assert.throws(() => idem.normalizeKey('short'), HttpError);
  assert.throws(() => idem.normalizeKey('has spaces in it'), HttpError);
  assert.throws(() => idem.normalizeKey('x'.repeat(200)), HttpError);
});

test('hashRequest ignores key order but not values', () => {
  const a = idem.hashRequest('POST', '/v1/expenses', { b: 1, a: { y: 2, x: [1, 2] } });
  const b = idem.hashRequest('POST', '/v1/expenses', { a: { x: [1, 2], y: 2 }, b: 1 });
  const c = idem.hashRequest('POST', '/v1/expenses', { a: { x: [2, 1], y: 2 }, b: 1 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, idem.hashRequest('PATCH', '/v1/expenses', { b: 1, a: { y: 2, x: [1, 2] } }));
});

test('decide: proceed / replay / conflict / in_progress', () => {
  assert.equal(idem.decide(null, 'h'), 'proceed');
  assert.equal(idem.decide({ requestHash: 'h', statusCode: 201 }, 'h'), 'replay');
  assert.equal(idem.decide({ requestHash: 'h', statusCode: null }, 'h'), 'in_progress');
  assert.equal(idem.decide({ requestHash: 'other', statusCode: 201 }, 'h'), 'conflict');
});

test('withIdempotency (MongoDB): replays without re-running, 422 on a different body, releases on error', async (t) => {
  const m = await startMongo();
  if (m.skip) return t.skip(m.skip);
  try {
    const req = { routeKey: 'POST /v1/expenses', method: 'POST', path: '/v1/expenses', headers: { 'idempotency-key': 'key-12345678' }, params: {}, body: { a: 1 } };
    let runs = 0;
    const fn = async () => {
      runs += 1;
      return { id: 'e1' };
    };
    const first = await idem.withIdempotency(req, 'u1', fn);
    const second = await idem.withIdempotency(req, 'u1', fn);
    assert.equal(runs, 1);
    assert.equal(first.statusCode, 200);
    assert.equal(second.headers['idempotent-replay'], 'true');
    assert.deepEqual(JSON.parse(second.body), { id: 'e1' });
    await assert.rejects(() => idem.withIdempotency({ ...req, body: { a: 2 } }, 'u1', fn), (e) => e.status === 422);
    // Keys are per user.
    await idem.withIdempotency(req, 'u2', fn);
    assert.equal(runs, 2);
    // A failing handler releases the key so a fixed retry can run.
    const req2 = { ...req, headers: { 'idempotency-key': 'key-failing-1' } };
    await assert.rejects(() => idem.withIdempotency(req2, 'u1', async () => {
      throw new Error('nope');
    }));
    const ok = await idem.withIdempotency(req2, 'u1', async () => ({ fixed: true }));
    assert.deepEqual(JSON.parse(ok.body), { fixed: true });
  } finally {
    await stopMongo();
  }
});
