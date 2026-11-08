'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const idem = require('../src/lib/idempotency');
const { HttpError } = require('../src/lib/http');

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
  assert.equal(idem.decide({ request_hash: 'h', status_code: 201 }, 'h'), 'replay');
  assert.equal(idem.decide({ request_hash: 'h', status_code: null }, 'h'), 'in_progress');
  assert.equal(idem.decide({ request_hash: 'other', status_code: 201 }, 'h'), 'conflict');
});

test('withIdempotency replays a stored response without re-running the handler', async () => {
  const store = new Map();
  const fakeDb = {
    async query(sql, params) {
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        const k = `${params[0]}:${params[1]}`;
        if (store.has(k)) return { rowCount: 0, rows: [] };
        store.set(k, { request_hash: params[3], status_code: null, response: null });
        return { rowCount: 1, rows: [{ key: params[1] }] };
      }
      if (sql.startsWith('SELECT request_hash')) return { rows: [store.get(`${params[0]}:${params[1]}`)] };
      if (sql.startsWith('UPDATE idempotency_keys')) {
        const r = store.get(`${params[0]}:${params[1]}`);
        r.status_code = params[2];
        r.response = JSON.parse(params[3]);
        return { rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const req = { event: { routeKey: 'POST /v1/expenses', headers: { 'Idempotency-Key': 'key-12345678' } }, params: {}, body: { a: 1 } };
  let runs = 0;
  const fn = async () => {
    runs += 1;
    return { id: 'e1' };
  };
  const first = await idem.withIdempotency(fakeDb, req, 'u1', fn);
  const second = await idem.withIdempotency(fakeDb, req, 'u1', fn);
  assert.equal(runs, 1);
  assert.equal(first.statusCode, 200);
  assert.equal(second.headers['idempotent-replay'], 'true');
  assert.deepEqual(JSON.parse(second.body), { id: 'e1' });
  await assert.rejects(() => idem.withIdempotency(fakeDb, { ...req, body: { a: 2 } }, 'u1', fn), (e) => e.status === 422);
});
