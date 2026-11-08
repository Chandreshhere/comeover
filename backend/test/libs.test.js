'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeShares, upiLink } = require('../src/lib/split');
const { evaluateQuest, periodKey } = require('../src/lib/quests');
const { isQuietHours, shouldDeliver, stringifyData } = require('../src/lib/push');
const { nextTokens, retryAfterSec } = require('../src/lib/rateLimit');
const { pageParams, pageOf, encodeCursor, keysetPageOf, afterKeyset, decodeCursor } = require('../src/lib/page');
const ent = require('../src/lib/entitlements');
const { normalizePhone, maskPhone } = require('../src/lib/phone');
const geo = require('../src/lib/geo');
const realtime = require('../src/lib/realtime');
const tokens = require('../src/lib/tokens');
const present = require('../src/lib/present');

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
});

test('UPI deep link (no custody, just a handoff)', () => {
  assert.match(upiLink({ vpa: 'meher@okbank', payeeName: 'Meher', amountMinor: 20050, note: 'Court' }), /^upi:\/\/pay\?pa=meher%40okbank&pn=Meher&am=200\.50&cu=INR&tn=Court$/);
  assert.equal(upiLink({ vpa: 'not a vpa', amountMinor: 1 }), null);
});

test('quest evaluation only counts verified stats', () => {
  const stats = {
    day: { completed: 1, newPeople: 1, newCategories: 0, hostedCompleted: 0, startHours: [7] },
    week: { completed: 1, newPeople: 2, newCategories: 1, hostedCompleted: 0, startHours: [7, 19] },
    all: { completed: 12, categoryCounts: { chai: 3, run: 1 }, reliability: 0.96, plansConsidered: 11, startHours: [] },
  };
  assert.deepEqual(evaluateQuest({ type: 'complete_activities', count: 2, window: 'week' }, stats), { progress: 1, total: 2, done: false });
  assert.equal(evaluateQuest({ type: 'category_completed', category: 'chai', count: 3 }, stats).done, true);
  assert.equal(evaluateQuest({ type: 'swipes', count: 1 }, stats).progress, 0);
  assert.equal(periodKey('weekly', new Date('2026-11-11T06:00:00Z')), 'W2026-11-08');
});

test('push: quiet hours (IST, overnight), camelCase prefs, string data', () => {
  const at = (iso) => new Date(iso);
  assert.equal(isQuietHours(at('2026-11-08T17:00:00Z'), '22:00', '08:00'), true); // 22:30 IST
  assert.equal(isQuietHours(at('2026-11-08T06:00:00Z'), '22:00', '08:00'), false);
  const prefs = { messages: false, productUpdates: false, quietHours: { start: '22:00', end: '08:00' } };
  assert.equal(shouldDeliver(prefs, 'message', at('2026-11-08T06:00:00Z')), false);
  assert.equal(shouldDeliver(prefs, 'marketing', at('2026-11-08T06:00:00Z')), false);
  assert.equal(shouldDeliver(prefs, 'join', at('2026-11-08T17:00:00Z')), false); // quiet hours
  assert.equal(shouldDeliver(prefs, 'safety', at('2026-11-08T17:00:00Z')), true);
  assert.deepEqual(stringifyData({ target: { screen: 'group_chat', params: { conversationId: 'c1' } }, n: 2, x: null }), {
    target: '{"screen":"group_chat","params":{"conversationId":"c1"}}',
    n: '2',
  });
});

test('token bucket refills and floors at -1', () => {
  assert.equal(nextTokens(null, 0, 3, 1), 2);
  assert.equal(nextTokens(0, 0, 3, 1), -1);
  assert.equal(nextTokens(-1, 0, 3, 1), -1);
  assert.equal(nextTokens(0, 10, 3, 1), 2);
  assert.equal(retryAfterSec(-1, 1 / 60), 120);
});

test('pagination: offset and keyset cursors', async () => {
  const p = pageParams({ limit: '2', cursor: encodeCursor({ o: 4 }) });
  assert.equal(p.limit, 2);
  assert.equal(p.offset, 4);
  assert.equal(p.fetchLimit, 3);
  assert.deepEqual(await pageOf([1, 2, 3], p), { items: [1, 2], nextCursor: encodeCursor({ o: 6 }) });
  assert.deepEqual(await pageOf([1], p), { items: [1], nextCursor: null });
  assert.throws(() => pageParams({ cursor: '%%%' }));
  const rows = [
    { _id: 'c', createdAt: new Date('2026-11-03') },
    { _id: 'b', createdAt: new Date('2026-11-02') },
    { _id: 'a', createdAt: new Date('2026-11-01') },
  ];
  const kp = await keysetPageOf(rows, { limit: 2 }, 'createdAt', (r) => r._id);
  assert.deepEqual(kp.items, ['c', 'b']);
  const f = afterKeyset(decodeCursor(kp.nextCursor), 'createdAt');
  assert.deepEqual(f.$or[1], { createdAt: new Date('2026-11-02'), _id: { $lt: 'b' } });
});

test('entitlements: safety and core features are never gated', () => {
  for (const f of ['safety', 'reporting', 'blocking', 'basic_join', 'basic_create', 'accepted_plan_chat']) assert.equal(ent.hasFeature([], f), true);
  assert.equal(ent.hasFeature([], 'advanced_filters'), false);
  assert.equal(ent.hasFeature(['plus'], 'advanced_filters'), true);
  assert.equal(ent.hasFeature(['plus'], 'co_host_roles'), false);
  assert.equal(ent.hasFeature(['pro'], 'sponsored_slots'), false);
  assert.deepEqual(ent.activeEntitlements([{ entitlement: 'plus', expiresAt: new Date(Date.now() - 1000) }, { entitlement: 'venue', expiresAt: null }]), ['venue']);
});

test('phone normalisation (India-first) and masking', () => {
  assert.equal(normalizePhone('98123 45678'), '+919812345678');
  assert.equal(normalizePhone('09812345678'), '+919812345678');
  assert.equal(normalizePhone('919812345678'), '+919812345678');
  assert.equal(normalizePhone('+14155550123'), '+14155550123');
  assert.throws(() => normalizePhone('12345'), (e) => e.code === 'invalid_phone');
  assert.throws(() => normalizePhone('+911234567890'), (e) => e.code === 'invalid_phone');
  assert.equal(maskPhone('+919812345678'), '+91 ••••• •5678');
});

test('geohash cells and Mongo geo filters', () => {
  assert.equal(geo.geohash(57.64911, 10.40744, 6), 'u4pruy'); // well-known reference value
  assert.equal(geo.cellId(23.0365, 72.5611).length, 6);
  assert.equal(geo.cellId(999, 0), null);
  const f = geo.withinFilter(23.03, 72.56, 100);
  assert.deepEqual(f.location.$geoWithin.$centerSphere[0], [72.56, 23.03]);
  assert.ok(Math.abs(f.location.$geoWithin.$centerSphere[1] - 25 / 6378.1) < 1e-9, 'radius clamped to 25 km');
  assert.equal(geo.geoNearStage(23, 72, 3).$geoNear.maxDistance, 3000);
});

test('realtime channel parsing', () => {
  const id = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';
  assert.deepEqual(realtime.parseChannel(`conversation:${id}`), { type: 'conversation', id });
  assert.deepEqual(realtime.parseChannel(`user:${id}:notifications`), { type: 'user', id });
  assert.equal(realtime.parseChannel('conversation:nope'), null);
  assert.equal(realtime.parseChannel(`admin:${id}`), null);
});

test('access tokens: sign/verify round-trip, tamper and wrong issuer rejected', () => {
  const t = tokens.signAccessToken({ userId: 'u1', roles: ['moderator'], sid: 'f1' });
  const c = tokens.verifyAccessToken(t);
  assert.equal(c.sub, 'u1');
  assert.deepEqual(c.roles, ['moderator']);
  assert.equal(c.sid, 'f1');
  const [h, p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), roles: ['admin'] })).toString('base64url');
  assert.throws(() => tokens.verifyAccessToken(`${h}.${forged}.${s}`), (e) => e.code === 'token_invalid');
  const jwt = require('jsonwebtoken');
  assert.throws(() => tokens.verifyAccessToken(jwt.sign({}, process.env.JWT_SECRET, { subject: 'u1', issuer: 'someone-else' })), (e) => e.code === 'token_invalid');
  assert.throws(() => tokens.verifyAccessToken(jwt.sign({}, process.env.JWT_SECRET, { subject: 'u1', issuer: 'projectirl', algorithm: 'HS512' })), (e) => e.code === 'token_invalid');
});

test('presenters: publicUser hides precise data; expense shares are never bank-verified', async () => {
  const u = await present.publicUser(
    { _id: 'u1', profile: { displayName: 'Meher', reliabilityScore: 0.937, interests: ['run'], homeArea: 'Bodakdev' }, progress: { level: 5 }, availability: { status: 'now', activitySlugs: ['badminton'], until: new Date(Date.now() + 3600000) } },
    { distanceM: 1430, completed: 22 }
  );
  assert.equal(u.name, 'Meher');
  assert.equal(u.reliability, 0.95);
  assert.equal(u.distanceM, 1500);
  assert.equal(u.distanceBand, '~1.5 km');
  assert.equal(u.availability, 'now');
  assert.equal(u.intent, 'badminton');
  const e = present.expense({ _id: 'e1', creatorUserId: 'u1', description: 'Court', totalMinor: 800, currency: 'INR', splitMethod: 'equal', shares: [{ userId: 'u1', amountMinor: 400, state: 'confirmed' }] });
  assert.equal(e.payeeId, 'u1');
  assert.equal(e.shares[0].bankVerified, false);
});
