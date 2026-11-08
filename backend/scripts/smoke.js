#!/usr/bin/env node
'use strict';
// Boot smoke test: in-memory MongoDB (replica set) + mocked Slide, real HTTP + WS.
//   npm run smoke
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret-0123456789';
process.env.SLIDE_API_KEY = 'sk_test_smoke';
process.env.SLIDE_OTP_WIDGET_ID = 'wgt_smoke';
process.env.JOBS_ENABLED = 'false';

async function main() {
  let MongoMemoryReplSet;
  try {
    ({ MongoMemoryReplSet } = require('mongodb-memory-server'));
  } catch (e) {
    console.log('SKIP: mongodb-memory-server not installed');
    return;
  }
  let rs;
  try {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  } catch (e) {
    console.log(`SKIP: could not start an in-memory MongoDB (${e.message.split('\n')[0]})`);
    return;
  }
  process.env.MONGODB_URI = rs.getUri('irl_smoke');

  const slide = require('../src/lib/slide');
  slide.setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    const ok = (o) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(o) });
    if (url.endsWith('/v1/otp/send')) return ok({ requestId: 'otpreq_smoke_1', channel: 'whatsapp' });
    if (url.endsWith('/v1/otp/verify')) return body.otp === '123456' ? ok({ accessToken: 'slide.jwt' }) : { ok: false, status: 400, headers: { get: () => null }, text: async () => '{"message":"Invalid code"}' };
    if (url.endsWith('/v1/otp/verify-token')) return ok({ verified: true, identifier: '+919876543210', verifiedAt: new Date().toISOString() });
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{}' };
  });

  const { start } = require('../src/server');
  const { server } = await start({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, b, h = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const results = [];
  const check = (name, cond, extra) => {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  };

  check('GET /healthz', (await fetch(`${base}/healthz`)).status === 200);
  const ready = await (await fetch(`${base}/readyz`)).json();
  check('GET /readyz', ready.ok && ready.mongo, `realtime=${ready.realtime}`);
  const req1 = await post('/v1/auth/otp/request', { phone: '9876543210' });
  check('POST /v1/auth/otp/request', req1.status === 200 && req1.body.requestId === 'otpreq_smoke_1', JSON.stringify(req1.body));
  const bad = await post('/v1/auth/otp/verify', { requestId: 'otpreq_smoke_1', code: '000000' });
  check('verify wrong code → 400 otp_invalid', bad.status === 400 && bad.body.code === 'otp_invalid');
  const good = await post('/v1/auth/otp/verify', { requestId: 'otpreq_smoke_1', code: '123456' });
  check('verify right code → tokens', good.status === 200 && !!good.body.accessToken && !!good.body.refreshToken && good.body.isNewUser === true);
  const ref = await post('/v1/auth/session/refresh', { refreshToken: good.body.refreshToken });
  check('refresh rotates', ref.status === 200 && ref.body.refreshToken && ref.body.refreshToken !== good.body.refreshToken);
  const reuse = await post('/v1/auth/session/refresh', { refreshToken: good.body.refreshToken });
  check('reuse of rotated token → 401 session_expired', reuse.status === 401 && reuse.body.code === 'session_expired');
  const after = await post('/v1/auth/session/refresh', { refreshToken: ref.body.refreshToken });
  check('family revoked after reuse', after.status === 401);
  const nf = await fetch(`${base}/v1/nope`);
  check('unknown route → 404 JSON', nf.status === 404);

  // WebSocket: connect with the access token and get a pong.
  const WebSocket = require('ws');
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${good.body.accessToken}`);
    const t = setTimeout(() => resolve(false), 3000);
    ws.on('open', () => ws.send(JSON.stringify({ action: 'ping' })));
    ws.on('message', (m) => {
      if (JSON.parse(String(m)).type === 'pong') {
        clearTimeout(t);
        ws.close();
        resolve(true);
      }
    });
    ws.on('error', () => resolve(false));
  });
  check('WS /ws auth + ping', wsOk);
  const wsNoAuth = await new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    ws.on('unexpected-response', (q, res) => resolve(res.statusCode));
    ws.on('open', () => resolve(200));
    ws.on('error', () => resolve(0));
  });
  check('WS without token → 401', wsNoAuth === 401);

  await require('../src/lib/realtime').close();
  server.close();
  await require('../src/lib/db').disconnect();
  await rs.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} smoke checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
