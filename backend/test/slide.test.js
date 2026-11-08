'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const slide = require('../src/lib/slide');
const { createFakeSlide, response } = require('./helpers/fakeSlide');

test('send/verify/verify-token with the bearer API key and widget id', async () => {
  const fake = createFakeSlide();
  slide.setFetch(fake.fetchImpl);
  const sent = await slide.sendOtp('+919876543210');
  assert.deepEqual(sent, { requestId: 'otpreq_1', channel: 'whatsapp' });
  assert.equal(fake.state.calls[0].auth, 'Bearer sk_test_unit');
  assert.deepEqual(fake.state.calls[0].body, { widgetId: 'wgt_unit', identifier: '+919876543210' });
  const { accessToken } = await slide.verifyOtp('otpreq_1', '123456');
  const v = await slide.verifyToken(accessToken);
  assert.equal(v.verified, true);
  assert.equal(v.identifier, '+919876543210');
});

test('retry only forwards known channels', async () => {
  const fake = createFakeSlide();
  slide.setFetch(fake.fetchImpl);
  await slide.retryOtp('otpreq_9', 'whatsapp');
  await slide.retryOtp('otpreq_9', 'carrier-pigeon');
  assert.deepEqual(fake.state.calls[0].body, { requestId: 'otpreq_9', channel: 'whatsapp' });
  assert.deepEqual(fake.state.calls[1].body, { requestId: 'otpreq_9' });
});

test('error mapping: 400 invalid, 429 rate_limited with Retry-After, 5xx/timeout unavailable, 401 unauthorized', async () => {
  const fake = createFakeSlide();
  slide.setFetch(fake.fetchImpl);
  await assert.rejects(() => slide.verifyOtp('otpreq_1', '000000'), (e) => e instanceof slide.SlideError && e.kind === 'invalid' && e.status === 400);
  fake.state.sendStatus = 429;
  await assert.rejects(() => slide.sendOtp('+919876543210'), (e) => e.kind === 'rate_limited' && e.retryAfterSec === 42);
  fake.state.sendStatus = 500;
  await assert.rejects(() => slide.sendOtp('+919876543210'), (e) => e.kind === 'unavailable');
  slide.setFetch(async () => response(401, { message: 'bad key' }));
  await assert.rejects(() => slide.sendOtp('+919876543210'), (e) => e.kind === 'unauthorized');
  slide.setFetch(async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  });
  await assert.rejects(() => slide.sendOtp('+919876543210'), (e) => e.kind === 'unavailable' && /timed out/.test(e.message));
  slide.setFetch(async () => response(200, {}));
  await assert.rejects(() => slide.sendOtp('+919876543210'), (e) => e.kind === 'bad_response');
  slide.setFetch(null);
});
