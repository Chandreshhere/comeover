'use strict';
require('./helpers/env');
// Temporary fixed-code test login (src/lib/testLogin.js). Config is read at require time,
// so the variables must be set before anything loads ../src/config.
process.env.TEST_LOGIN_PHONE = '7898817127';
process.env.TEST_LOGIN_CODE = '1234';
process.env.SLIDE_API_KEY = ''; // prove the test login works with Slide unconfigured
process.env.SLIDE_OTP_WIDGET_ID = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startMongo, stopMongo } = require('./helpers/mongo');

let base;
let server;
let skip = null;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await stopMongo();
});

test.beforeEach(async () => {
  if (skip) return;
  await require('../src/models').RateLimit.deleteMany({});
});

async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('test number: request needs no Slide, reports a 4-digit code, and 1234 signs in', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '7898817127' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel, 'test');
  assert.equal(r.body.codeLength, 4);
  assert.equal(r.body.maskedPhone, '+91 ••••• •7127');
  assert.match(r.body.requestId, /^otpreq_test_/);
  assert.equal(JSON.stringify(r.body).includes('1234'), false, 'the code must never be echoed back');
  const v = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '1234' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.ok(v.body.accessToken && v.body.refreshToken);
  const { AuditEvent } = require('../src/models');
  assert.ok(await AuditEvent.findOne({ action: 'auth.test_login' }).lean());
});

test('test number: wrong codes are counted and lock after 5 attempts', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '7898817127' });
  for (let i = 1; i <= 4; i++) {
    const bad = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '0000' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'otp_invalid');
    assert.equal(bad.body.details.attemptsLeft, 5 - i);
  }
  const fifth = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '9999' });
  assert.equal(fifth.body.code, 'otp_locked');
  const right = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '1234' });
  assert.equal(right.status, 400); // locked: even the right code is refused
  assert.equal(right.body.code, 'otp_locked');
});

test('test number: resend works without Slide and respects the cooldown', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '7898817127' });
  const early = await post('/v1/auth/otp/resend', { requestId: r.body.requestId });
  assert.equal(early.status, 429);
  const { OtpRequest } = require('../src/models');
  await OtpRequest.updateOne({ _id: r.body.requestId }, { $set: { lastSentAt: new Date(Date.now() - 60000) } });
  const again = await post('/v1/auth/otp/resend', { requestId: r.body.requestId });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.channel, 'test');
});

test('any other number still needs Slide: 503 auth_not_configured, and 1234 is not special', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '9876543210' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'auth_not_configured');
  const v = await post('/v1/auth/otp/verify', { requestId: 'otpreq_test_forged', code: '1234' });
  assert.equal(v.body.code, 'otp_expired'); // a forged test request id does not exist
});

test('a stored test request stops working once the test login is switched off', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '7898817127' });
  const config = require('../src/config');
  const original = config.testLogin.code;
  config.testLogin.code = ''; // simulate removing TEST_LOGIN_CODE
  try {
    const v = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '1234' });
    assert.equal(v.status, 400);
    assert.equal(v.body.code, 'otp_expired');
  } finally {
    config.testLogin.code = original;
  }
});

test('production guard: ignored without the allow flag or an expiry; honours a future expiry', async () => {
  const config = require('../src/config');
  const testLogin = require('../src/lib/testLogin');
  const saved = { env: config.env, ...config.testLogin };
  try {
    config.env = 'production';
    config.testLogin.allowProduction = false;
    config.testLogin.expiresAt = '';
    assert.equal(testLogin.isActive(), false, 'production without the allow flag');
    config.testLogin.allowProduction = true;
    assert.equal(testLogin.isActive(), false, 'production without an expiry');
    config.testLogin.expiresAt = 'not-a-date';
    assert.equal(testLogin.isActive(), false, 'unparsable expiry fails closed');
    config.testLogin.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal(testLogin.isActive(), false, 'expired');
    config.testLogin.expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    assert.equal(testLogin.isActive(), true, 'allowed + future expiry');
    assert.equal(testLogin.matchesPhone('+917898817127'), true);
    assert.equal(testLogin.matchesPhone('+919876543210'), false);
    assert.equal(testLogin.checkCode('1234'), true);
    assert.equal(testLogin.checkCode('12345'), false);
  } finally {
    config.env = saved.env;
    Object.assign(config.testLogin, { phone: saved.phone, code: saved.code, expiresAt: saved.expiresAt, allowProduction: saved.allowProduction });
  }
});
