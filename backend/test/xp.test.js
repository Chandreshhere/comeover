'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const xp = require('../src/lib/xp');

test('non-qualifying events never earn XP', () => {
  for (const t of ['swipe', 'like', 'message', 'message_sent', 'join_request', 'plan_created', 'made_up_event']) {
    assert.deepEqual(xp.computeAward({ eventType: t }), { xp: 0, reason: 'non_qualifying', capped: false });
  }
});

test('qualifying events use server rules', () => {
  assert.equal(xp.computeAward({ eventType: 'activity_completed' }).xp, 40);
  assert.equal(xp.computeAward({ eventType: 'hosted_completed' }).xp, 60);
  assert.equal(xp.computeAward({ eventType: 'quest_claimed', base: 80 }).xp, 80);
});

test('duplicates are rejected', () => {
  assert.equal(xp.computeAward({ eventType: 'activity_completed', alreadyAwarded: true }).reason, 'duplicate');
});

test('daily cap trims and then blocks awards', () => {
  const partial = xp.computeAward({ eventType: 'activity_completed', todayTotal: 180 });
  assert.deepEqual(partial, { xp: 20, reason: 'capped', capped: true });
  const none = xp.computeAward({ eventType: 'activity_completed', todayTotal: xp.DAILY_CAP });
  assert.deepEqual(none, { xp: 0, reason: 'daily_cap_reached', capped: true });
});

test('idempotency key is deterministic and requires all parts', () => {
  assert.equal(xp.xpIdempotencyKey('activity_completed', 'u1', 'a1'), 'xp:activity_completed:u1:a1');
  assert.throws(() => xp.xpIdempotencyKey('activity_completed', 'u1'));
});

test('levelForXp picks the right level and next threshold', () => {
  const levels = [
    { level: 1, name: 'Newcomer', xp_threshold: 0 },
    { level: 2, name: 'First Hello', xp_threshold: 40 },
    { level: 3, name: 'Regular', xp_threshold: 100 },
  ];
  const l = xp.levelForXp(70, levels);
  assert.equal(l.level, 2);
  assert.equal(l.next.level, 3);
  assert.equal(Math.round(l.ratio * 100), 50);
  assert.equal(xp.levelForXp(500, levels).next, null);
});

test('istDay uses India time', () => {
  assert.equal(xp.istDay(new Date('2026-11-08T19:00:00Z')), '2026-11-09');
  assert.equal(xp.istDay(new Date('2026-11-08T18:00:00Z')), '2026-11-08');
});
