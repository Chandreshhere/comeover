'use strict';
process.env.MAINTENANCE_MODE = 'true';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { mountRoutes } = require('../src/lib/http');

test('maintenance mode returns 503 maintenance except admin, auth and webhooks', async () => {
  const app = express();
  mountRoutes(app, {
    'GET /v1/activities': async () => ({ items: [] }),
    'GET /v1/admin/kpis': async () => ({ ok: true }),
    'POST /v1/webhooks/razorpay': async () => ({ ok: true }),
    'POST /v1/auth/otp/request': async () => ({ ok: true }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(`${base}/v1/activities`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '300');
    assert.equal((await r.json()).code, 'maintenance');
    assert.equal((await fetch(`${base}/v1/admin/kpis`)).status, 200);
    assert.equal((await fetch(`${base}/v1/webhooks/razorpay`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/v1/auth/otp/request`, { method: 'POST' })).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
