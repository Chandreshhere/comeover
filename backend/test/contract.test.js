'use strict';
// Error codes the mobile client branches on (docs/API.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreate } = require('../src/services/activities');
const { createRouter } = require('../src/lib/http');

const base = () => ({ title: 'Chai break', category: 'chai', startsAt: new Date(Date.now() + 3600000).toISOString(), durationMin: 45, area: 'Navrangpura' });
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code;
  }
};

test('publish validation codes', () => {
  assert.equal(codeOf(() => validateCreate(base())), null);
  assert.equal(codeOf(() => validateCreate({ ...base(), capacity: 1 })), 'capacity_out_of_range');
  assert.equal(codeOf(() => validateCreate({ ...base(), capacity: 31 })), 'capacity_out_of_range');
  assert.equal(codeOf(() => validateCreate({ ...base(), startsAt: 'tomorrow-ish' })), 'invalid_time');
  assert.equal(codeOf(() => validateCreate({ ...base(), durationMin: 2 })), 'invalid_time');
  assert.equal(codeOf(() => validateCreate({ ...base(), startsAt: new Date(Date.now() - 3600000).toISOString() })), 'start_in_past');
  assert.equal(codeOf(() => validateCreate({ ...base(), startsAt: new Date(Date.now() + 90 * 86400000).toISOString() })), 'invalid_time');
  assert.equal(codeOf(() => validateCreate({ ...base(), venueName: "Riya's flat" })), 'private_venue_not_allowed');
  assert.equal(codeOf(() => validateCreate({ ...base(), venueType: 'Hotel room' })), 'private_venue_not_allowed');
});

test('maintenance mode returns 503 maintenance except admin and webhooks', async () => {
  const h = createRouter({ 'GET /v1/me': async () => ({ ok: 1 }), 'GET /v1/admin/kpis': async () => ({ ok: 2 }), 'POST /v1/webhooks/razorpay': async () => ({ ok: 3 }) });
  process.env.MAINTENANCE_MODE = 'true';
  try {
    const r = await h({ routeKey: 'GET /v1/me', requestContext: {} });
    assert.equal(r.statusCode, 503);
    assert.equal(JSON.parse(r.body).code, 'maintenance');
    assert.equal((await h({ routeKey: 'GET /v1/admin/kpis', requestContext: {} })).statusCode, 200);
    assert.equal((await h({ routeKey: 'POST /v1/webhooks/razorpay', requestContext: {} })).statusCode, 200);
  } finally {
    delete process.env.MAINTENANCE_MODE;
  }
  assert.equal((await h({ routeKey: 'GET /v1/me', requestContext: {} })).statusCode, 200);
});
