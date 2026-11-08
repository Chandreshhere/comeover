'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeShares, upiLink } = require('../src/lib/split');
const { evaluateQuest, periodKey } = require('../src/lib/quests');
const { isQuietHours, shouldDeliver } = require('../src/lib/push');
const { nextTokens, retryAfterSec } = require('../src/lib/rateLimit');
const { createRouter, err } = require('../src/lib/http');
const { pageParams, pageOf, encodeCursor } = require('../src/lib/page');
const ent = require('../src/lib/entitlements');
const { BLOCKED_INTENT, schemaFor } = require('../src/handlers/assistant');
const { normalisePhone } = require('../src/handlers/auth');

const sum = (s) => s.reduce((n, x) => n + x.amountMinor, 0);

test('SplitMate: equal split distributes remainder deterministically', () => {
  const s = computeShares('equal', 1000, ['a', 'b', 'c']);
  assert.equal(sum(s), 1000);
  assert.deepEqual(s.map((x) => x.amountMinor), [334, 333, 333]);
});

test('SplitMate: percentage, custom and itemised with tax', () => {
  assert.equal(sum(computeShares('percentage', 999, ['a', 'b'], { percentages: { a: 33.3, b: 66.7 } })), 999);
  assert.throws(() => computeShares('percentage', 100, ['a', 'b'], { percentages: { a: 10, b: 10 } }));
  assert.throws(() => computeShares('custom', 100, ['a', 'b'], { amounts: { a: 10, b: 10 } }));
  const items = [
    { label: 'Pav bhaji', amountMinor: 20000, assignments: [{ userId: 'a' }, { userId: 'b' }] },
    { label: 'Kulfi', amountMinor: 6000, assignments: [{ userId: 'b' }] },
  ];
  const s = computeShares('itemised', 28600, ['a', 'b', 'c'], { items });
  assert.equal(sum(s), 28600);
  assert.equal(s.find((x) => x.userId === 'c').amountMinor, 0);
  assert.ok(s.find((x) => x.userId === 'b').amountMinor > s.find((x) => x.userId === 'a').amountMinor);
});

test('UPI deep link (no custody, just a handoff)', () => {
  const link = upiLink({ vpa: 'meher@okbank', payeeName: 'Meher', amountMinor: 20050, note: 'Court' });
  assert.match(link, /^upi:\/\/pay\?pa=meher%40okbank&pn=Meher&am=200\.50&cu=INR&tn=Court$/);
  assert.equal(upiLink({ vpa: 'not a vpa', amountMinor: 1 }), null);
});

test('quest evaluation only counts verified stats', () => {
  const stats = {
    day: { completed: 1, newPeople: 1, newCategories: 0, hostedCompleted: 0, startHours: [7] },
    week: { completed: 1, newPeople: 2, newCategories: 1, hostedCompleted: 0, startHours: [7, 19] },
    all: { completed: 12, categoryCounts: { chai: 3, run: 1 }, reliability: 0.96, plansConsidered: 11, startHours: [] },
  };
  assert.deepEqual(evaluateQuest({ type: 'complete_activities', count: 2, window: 'week' }, stats), { progress: 1, total: 2, done: false });
  assert.equal(evaluateQuest({ type: 'early_activity', count: 1, beforeHour: 8, window: 'day' }, stats).done, true);
  assert.equal(evaluateQuest({ type: 'category_completed', category: 'chai', count: 3 }, stats).done, true);
  assert.equal(evaluateQuest({ type: 'reliability', min: 0.95, minPlans: 10 }, stats).done, true);
  assert.equal(evaluateQuest({ type: 'swipes', count: 1 }, stats).progress, 0);
  assert.match(periodKey('daily', new Date('2026-11-08T20:00:00Z')), /^D2026-11-09$/);
  assert.equal(periodKey('weekly', new Date('2026-11-11T06:00:00Z')), 'W2026-11-08');
});

test('push quiet hours (IST, overnight) and category prefs', () => {
  const at = (iso) => new Date(iso);
  assert.equal(isQuietHours(at('2026-11-08T17:00:00Z'), '22:00', '08:00'), true); // 22:30 IST
  assert.equal(isQuietHours(at('2026-11-08T06:00:00Z'), '22:00', '08:00'), false); // 11:30 IST
  assert.equal(isQuietHours(at('2026-11-08T17:00:00Z'), '00:00', '00:00'), false);
  const prefs = { messages: false, product_updates: false, quiet_hours: { start: '22:00', end: '08:00' } };
  assert.equal(shouldDeliver(prefs, 'message', at('2026-11-08T06:00:00Z')), false);
  assert.equal(shouldDeliver(prefs, 'marketing', at('2026-11-08T06:00:00Z')), false);
  assert.equal(shouldDeliver(prefs, 'safety', at('2026-11-08T17:00:00Z')), true);
});

test('token bucket refills and floors at -1', () => {
  assert.equal(nextTokens(null, 0, 3, 1), 2);
  assert.equal(nextTokens(0, 0, 3, 1), -1);
  assert.equal(nextTokens(-1, 0, 3, 1), -1);
  assert.equal(nextTokens(0, 10, 3, 1), 2);
  assert.equal(retryAfterSec(-1, 1 / 60), 120);
});

test('router: routeKey dispatch, path fallback, 404 and error mapping', async () => {
  const h = createRouter({
    'GET /v1/things/{id}': async (req) => ({ id: req.params.id }),
    'POST /v1/boom': async () => {
      const e = new Error('dup');
      e.code = '23505';
      throw e;
    },
    'POST /v1/nope': async () => {
      throw err.forbidden('host_only');
    },
  });
  const ok = await h({ requestContext: { http: { method: 'GET' } }, rawPath: '/v1/things/abc' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(JSON.parse(ok.body), { id: 'abc' });
  assert.equal((await h({ routeKey: 'GET /v1/missing', requestContext: { http: { method: 'GET' } }, rawPath: '/v1/missing' })).statusCode, 404);
  assert.equal((await h({ routeKey: 'POST /v1/boom', requestContext: {} })).statusCode, 409);
  const f = await h({ routeKey: 'POST /v1/nope', requestContext: {} });
  assert.equal(f.statusCode, 403);
  assert.equal(JSON.parse(f.body).code, 'host_only');
});

test('pagination cursors', () => {
  const p = pageParams({ limit: '2', cursor: encodeCursor({ o: 4 }) });
  assert.deepEqual(p, { limit: 2, offset: 4, sqlLimit: 3 });
  assert.deepEqual(pageOf([1, 2, 3], p), { items: [1, 2], nextCursor: encodeCursor({ o: 6 }) });
  assert.deepEqual(pageOf([1], p), { items: [1], nextCursor: null });
  assert.throws(() => pageParams({ cursor: '%%%' }));
});

test('entitlements: safety and core features are never gated', () => {
  for (const f of ['safety', 'reporting', 'blocking', 'basic_join', 'basic_create', 'accepted_plan_chat']) assert.equal(ent.hasFeature([], f), true);
  assert.equal(ent.hasFeature([], 'advanced_filters'), false);
  assert.equal(ent.hasFeature(['plus'], 'advanced_filters'), true);
  assert.equal(ent.hasFeature(['plus'], 'co_host_roles'), false);
  assert.equal(ent.hasFeature(['pro'], 'advanced_filters'), true);
  assert.equal(ent.hasFeature(['pro'], 'sponsored_slots'), false);
  assert.equal(ent.productToEntitlement('irl_pro_monthly'), 'pro');
});

test('assistant refuses dating/companionship intents without blocking normal plans', () => {
  for (const p of ['find me a girlfriend', 'looking for dating', 'need an escort tonight', 'paid companion for dinner', 'someone to go on a date']) assert.ok(BLOCKED_INTENT.test(p), p);
  for (const p of ['find someone for chai', 'pick a date for the weekend plan', 'I have 20 minutes free', 'find a gym partner', 'update my plan']) assert.ok(!BLOCKED_INTENT.test(p), p);
  const s = schemaFor(['chai', 'gym']);
  assert.deepEqual(s.properties.draft.properties.category.enum, ['chai', 'gym']);
  assert.equal(s.additionalProperties, false);
});

test('phone normalisation (India-first)', () => {
  assert.equal(normalisePhone('98123 45678'), '+919812345678');
  assert.equal(normalisePhone('+14155550123'), '+14155550123');
  assert.throws(() => normalisePhone('12345'));
});
