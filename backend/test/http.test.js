'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { mountRoutes, err, json, mapError, compileRouteKey } = require('../src/lib/http');

async function serve(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('compileRouteKey converts {param} to express :param', () => {
  assert.deepEqual(compileRouteKey('GET /v1/activities/{activityId}/join-requests/{requestId}'), { method: 'GET', expressPath: '/v1/activities/:activityId/join-requests/:requestId' });
  assert.throws(() => compileRouteKey('nonsense'));
});

test('mountRoutes: values → 200, passthrough responses, params/query/body, error mapping', async () => {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));
  mountRoutes(app, {
    'GET /v1/things/{id}': async (req) => ({ id: req.params.id, q: req.query.x || null, route: req.routeKey }),
    'POST /v1/things': async (req) => json(201, { got: req.body, raw: req.rawBody() }),
    'DELETE /v1/things/{id}': async () => undefined,
    'POST /v1/forbidden': async () => {
      throw err.forbidden('host_only', 'Only the host can do that');
    },
    'POST /v1/dup': async () => {
      const e = new Error('E11000 duplicate key');
      e.code = 11000;
      throw e;
    },
    'POST /v1/cast': async () => {
      const e = new Error('Cast to ObjectId failed');
      e.name = 'CastError';
      throw e;
    },
    'POST /v1/transient': async () => {
      const e = new Error('write conflict');
      e.errorLabels = ['TransientTransactionError'];
      throw e;
    },
    'POST /v1/slow-down': async () => {
      throw err.tooMany(17);
    },
    'POST /v1/crash': async () => {
      throw new Error('kaboom');
    },
  });
  const s = await serve(app);
  try {
    const r1 = await fetch(`${s.base}/v1/things/abc?x=1`);
    assert.equal(r1.status, 200);
    assert.deepEqual(await r1.json(), { id: 'abc', q: '1', route: 'GET /v1/things/{id}' });
    const r2 = await fetch(`${s.base}/v1/things`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.equal(r2.status, 201);
    assert.deepEqual(await r2.json(), { got: { a: 1 }, raw: '{"a":1}' });
    assert.deepEqual(await (await fetch(`${s.base}/v1/things/abc`, { method: 'DELETE' })).json(), { ok: true });
    const r3 = await fetch(`${s.base}/v1/forbidden`, { method: 'POST' });
    assert.equal(r3.status, 403);
    assert.deepEqual(await r3.json(), { code: 'host_only', message: 'Only the host can do that' });
    assert.equal((await fetch(`${s.base}/v1/dup`, { method: 'POST' })).status, 409);
    const cast = await fetch(`${s.base}/v1/cast`, { method: 'POST' });
    assert.equal(cast.status, 400);
    assert.equal((await cast.json()).code, 'invalid_value');
    const tr = await fetch(`${s.base}/v1/transient`, { method: 'POST' });
    assert.equal(tr.status, 409);
    assert.equal((await tr.json()).code, 'retry');
    const rl = await fetch(`${s.base}/v1/slow-down`, { method: 'POST' });
    assert.equal(rl.status, 429);
    assert.equal(rl.headers.get('retry-after'), '17');
    assert.deepEqual((await rl.json()).details, { retryAfterSec: 17 });
    const crash = await fetch(`${s.base}/v1/crash`, { method: 'POST' });
    assert.equal(crash.status, 500);
    assert.deepEqual(await crash.json(), { code: 'internal', message: 'Something went wrong.' });
  } finally {
    await s.close();
  }
});

test('mapError never leaks internals', () => {
  const out = mapError(new Error('secret db detail'));
  assert.equal(out.statusCode, 500);
  assert.ok(!out.body.includes('secret'));
});

test('createApp: invalid JSON → 400, unknown route → 404 JSON, health endpoint', async () => {
  const { createApp } = require('../src/app');
  const s = await serve(createApp());
  try {
    const bad = await fetch(`${s.base}/v1/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'invalid_json');
    const nf = await fetch(`${s.base}/v1/does-not-exist`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).code, 'route_not_found');
    assert.deepEqual(await (await fetch(`${s.base}/healthz`)).json(), { ok: true });
    // Bearer token that doesn't verify → 401 token_invalid on an authenticated route.
    const ra = await fetch(`${s.base}/v1/auth/logout-all`, { method: 'POST', headers: { authorization: 'Bearer nope' } });
    assert.equal(ra.status, 401);
    assert.equal((await ra.json()).code, 'token_invalid');
  } finally {
    await s.close();
  }
});
