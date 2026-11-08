'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const { startMongo, stopMongo } = require('./helpers/mongo');
const { createFakeSlide } = require('./helpers/fakeSlide');
const slide = require('../src/lib/slide');

let base;
let server;
let skip = null;
const fake = createFakeSlide({ phone: '+919876543210', code: '123456' });

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  slide.setFetch(fake.fetchImpl);
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await stopMongo();
});

// Each test starts with fresh rate-limit buckets (the per-phone send limit is 3/hour).
test.beforeEach(async () => {
  if (skip) return;
  const { RateLimit } = require('../src/models');
  await RateLimit.deleteMany({});
});

async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
}
const post = (p, b, h) => call('POST', p, b, h);

async function signIn() {
  await require('../src/models').RateLimit.deleteMany({}); // tests sign in more often than the 3/hour limit allows
  const r = await post('/v1/auth/otp/request', { phone: '98765 43210' });
  const v = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '123456' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body;
}

test('OTP request: normalises to +91, stores the request, masks the phone', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '9876543210' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.channel, 'whatsapp');
  assert.equal(r.body.retryAfterSec, 30);
  assert.equal(r.body.maskedPhone, '+91 ••••• •3210');
  const { OtpRequest } = require('../src/models');
  const doc = await OtpRequest.findById(r.body.requestId).lean();
  assert.equal(doc.phone, '+919876543210');
  assert.equal(doc.attempts, 0);
  const bad = await post('/v1/auth/otp/request', { phone: '12345' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid_phone');
});

test('OTP verify: wrong code → otp_invalid with attemptsLeft; right code → tokens and a new user; reuse → otp_expired', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '+919876543210' });
  const wrong = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '000000' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'otp_invalid');
  assert.equal(wrong.body.details.attemptsLeft, 4);
  const ok = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '123456' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.accessToken && ok.body.refreshToken);
  assert.equal(ok.body.tokenType, 'Bearer');
  assert.equal(ok.body.expiresIn, 900);
  assert.equal(ok.body.isNewUser, true);
  const claims = jwt.verify(ok.body.accessToken, process.env.JWT_SECRET);
  assert.equal(claims.sub, ok.body.user.id);
  assert.deepEqual(claims.roles, []);
  const { User } = require('../src/models');
  assert.equal((await User.countDocuments({ phone: '+919876543210' })), 1);
  const again = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '123456' });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'otp_expired');
  // Signing in again finds the same user.
  const second = await signIn();
  assert.equal(second.user.id, ok.body.user.id);
  assert.equal(await User.countDocuments({ phone: '+919876543210' }), 1);
});

test('OTP verify locks after 5 wrong codes, even for the right code afterwards', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '+919876543210' });
  for (let i = 1; i <= 4; i++) assert.equal((await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '111111' })).body.code, 'otp_invalid');
  assert.equal((await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '111111' })).body.code, 'otp_locked');
  const right = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '123456' });
  assert.equal(right.status, 400);
  assert.equal(right.body.code, 'otp_locked');
});

test('identifier mismatch from Slide is rejected', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '+919876543210' });
  fake.state.verifyIdentifier = '+910000000000';
  try {
    const v = await post('/v1/auth/otp/verify', { requestId: r.body.requestId, code: '123456' });
    assert.equal(v.status, 400);
    assert.equal(v.body.code, 'otp_invalid');
  } finally {
    fake.state.verifyIdentifier = '+919876543210';
  }
});

test('rate limits: 3 sends per phone per hour (otp_rate_limited + Retry-After); Slide 429/5xx mapping', async (t) => {
  if (skip) return t.skip(skip);
  for (let i = 0; i < 3; i++) assert.equal((await post('/v1/auth/otp/request', { phone: '9811111111' })).status, 200);
  const limited = await post('/v1/auth/otp/request', { phone: '9811111111' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'otp_rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  fake.state.sendStatus = 429;
  const s429 = await post('/v1/auth/otp/request', { phone: '9822222222' });
  assert.equal(s429.status, 429);
  assert.equal(s429.body.code, 'otp_rate_limited');
  assert.equal(s429.body.details.retryAfterSec, 42);
  fake.state.sendStatus = 500;
  const s500 = await post('/v1/auth/otp/request', { phone: '9833333333' });
  assert.equal(s500.status, 503);
  assert.equal(s500.body.code, 'slide_unavailable');
  fake.state.sendStatus = null;
});

test('resend enforces the cooldown and forwards the channel', async (t) => {
  if (skip) return t.skip(skip);
  const r = await post('/v1/auth/otp/request', { phone: '9844444444' });
  const early = await post('/v1/auth/otp/resend', { requestId: r.body.requestId, channel: 'sms' });
  assert.equal(early.status, 429);
  assert.equal(early.body.code, 'otp_rate_limited');
  const { OtpRequest } = require('../src/models');
  await OtpRequest.updateOne({ _id: r.body.requestId }, { $set: { lastSentAt: new Date(Date.now() - 60000) } });
  const ok = await post('/v1/auth/otp/resend', { requestId: r.body.requestId, channel: 'sms' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.channel, 'sms');
  const unknown = await post('/v1/auth/otp/resend', { requestId: 'otpreq_nope' });
  assert.equal(unknown.body.code, 'otp_expired');
});

test('refresh rotates; reusing a rotated token revokes the family; logout and logout-all', async (t) => {
  if (skip) return t.skip(skip);
  const s = await signIn();
  const r1 = await post('/v1/auth/session/refresh', { refreshToken: s.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, s.refreshToken);
  const reuse = await post('/v1/auth/session/refresh', { refreshToken: s.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.code, 'session_expired');
  const afterReuse = await post('/v1/auth/session/refresh', { refreshToken: r1.body.refreshToken });
  assert.equal(afterReuse.status, 401, 'family revoked');

  const s2 = await signIn();
  assert.equal((await post('/v1/auth/logout', { refreshToken: s2.refreshToken })).status, 200);
  assert.equal((await post('/v1/auth/session/refresh', { refreshToken: s2.refreshToken })).status, 401);

  const a = await signIn();
  const b = await signIn();
  const all = await post('/v1/auth/logout-all', {}, { authorization: `Bearer ${a.accessToken}` });
  assert.equal(all.status, 200);
  assert.ok(all.body.revoked >= 2);
  assert.equal((await post('/v1/auth/session/refresh', { refreshToken: b.refreshToken })).status, 401);
  assert.equal((await post('/v1/auth/session/refresh', { refreshToken: 'garbage' })).status, 401);
});

test('requireUser: expired token, suspended and deleted accounts', async (t) => {
  if (skip) return t.skip(skip);
  const { requireUser } = require('../src/lib/auth');
  const { User } = require('../src/models');
  const s = await signIn();
  const req = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  const u = await requireUser(req(s.accessToken));
  assert.equal(u.id, s.user.id);
  assert.equal(u.hasProfile, false);
  assert.equal(u.ageVerified, false);
  const expired = jwt.sign({ roles: [] }, process.env.JWT_SECRET, { subject: s.user.id, issuer: 'projectirl', expiresIn: -10 });
  await assert.rejects(() => requireUser(req(expired)), (e) => e.status === 401 && e.code === 'token_expired');
  await assert.rejects(() => requireUser({ headers: {} }), (e) => e.status === 401);
  await User.updateOne({ _id: s.user.id }, { $set: { status: 'suspended' } });
  await assert.rejects(() => requireUser(req(s.accessToken)), (e) => e.status === 403 && e.code === 'account_suspended');
  assert.equal((await requireUser(req(s.accessToken), { allowSuspended: true })).status, 'suspended');
  await User.updateOne({ _id: s.user.id }, { $set: { status: 'deleted' } });
  await assert.rejects(() => requireUser(req(s.accessToken), { allowSuspended: true }), (e) => e.code === 'account_deleted');
  await User.updateOne({ _id: s.user.id }, { $set: { status: 'active' } });
});

test('requireAdmin + GET /v1/admin/me use User.roles (re-read every call)', async (t) => {
  if (skip) return t.skip(skip);
  const { requireAdmin } = require('../src/lib/auth');
  const { grantRole } = require('../scripts/grant-role');
  const s = await signIn();
  const auth = { authorization: `Bearer ${s.accessToken}` };
  assert.equal((await call('GET', '/v1/admin/me', undefined, auth)).body.code, 'admin_only');
  await grantRole('+919876543210', 'moderator');
  const me = await call('GET', '/v1/admin/me', undefined, auth);
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'moderator');
  assert.equal(me.body.phone, '+91 ••••• •3210');
  await assert.rejects(() => requireAdmin({ headers: auth }, 'admin'), (e) => e.code === 'insufficient_role');
  await grantRole('+919876543210', 'admin');
  assert.equal((await requireAdmin({ headers: auth }, 'admin')).role, 'admin');
  await grantRole('+919876543210', 'none');
  assert.equal((await call('GET', '/v1/admin/me', undefined, auth)).status, 403);
});
