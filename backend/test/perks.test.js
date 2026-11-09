'use strict';
// Partner perks: pure rules (labels, IST windows, eligibility, codes). No database.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/perks');

// UTC instant for an IST wall-clock time: ist('2026-11-12', '16:00') = Thu 12 Nov 2026, 4 pm IST.
const ist = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00+05:30`));
const offer = (over = {}) => ({ _id: 'o1', kind: 'percent', value: 15, title: '15% off food', minGroup: 2, minLevel: 1, minShowUpRate: 0.8, days: L.ALL_DAYS, startMinute: 0, endMinute: 1440, perUserPerWeek: 1, status: 'active', ...over });
const viewer = (over = {}) => ({ level: 3, showUpRate: 1, plansConsidered: 5, ...over });
const EM_DASH = /—/;

test('offer labels: percent, flat (Indian grouping), freebie uses the title', () => {
  assert.equal(L.offerLabel(offer({ kind: 'percent', value: 15 })), '15% off');
  assert.equal(L.offerLabel(offer({ kind: 'flat', value: 100 })), '₹100 off');
  assert.equal(L.offerLabel(offer({ kind: 'flat', value: 1500 })), '₹1,500 off');
  assert.equal(L.offerLabel(offer({ kind: 'freebie', value: null, title: 'Free chai' })), 'Free chai');
  assert.equal(L.offerLabel(null), null);
});

test('window labels: plain English for common shapes', () => {
  const w = (days, startMinute, endMinute) => L.windowLabel({ days, startMinute, endMinute });
  assert.equal(w(undefined, 0, 1440), 'Any time');
  assert.equal(w([], 0, 1440), 'Any time', 'empty days means every day');
  assert.equal(w([0, 1, 2, 3, 4, 5, 6], 0, 1440), 'Any time');
  assert.equal(w([1, 2, 3, 4], 16 * 60, 19 * 60), 'Mon to Thu, 4 to 7 pm');
  assert.equal(w([0, 6], 8 * 60, 1440), 'Weekends, from 8 am');
  assert.equal(w([6, 0], 0, 1440), 'Weekends', 'order of days does not matter');
  assert.equal(w([1, 2, 3, 4, 5], 0, 11 * 60), 'Weekdays, until 11 am');
  assert.equal(w(L.ALL_DAYS, 16 * 60, 19 * 60), 'Every day, 4 to 7 pm');
  assert.equal(w(L.ALL_DAYS, 9 * 60 + 30, 21 * 60), 'Every day, 9:30 am to 9 pm');
  assert.equal(w([1, 2, 3, 4], 11 * 60, 14 * 60), 'Mon to Thu, 11 am to 2 pm');
  assert.equal(w([3], 12 * 60, 15 * 60), 'Wednesdays, noon to 3 pm');
  assert.equal(w([3], 9 * 60, 12 * 60), 'Wednesdays, 9 am to noon');
  assert.equal(w([1], 12 * 60, 1440), 'Mondays, from noon');
  assert.equal(w([1, 3, 5]), 'Mon, Wed and Fri');
  assert.equal(w([1, 2]), 'Mon and Tue');
  assert.equal(w([1, 2, 3, 4, 5, 6]), 'Mon to Sat');
  assert.equal(w([0, 1, 2, 3, 4, 5]), 'Sun to Fri');
  assert.equal(w([5, 6, 0], 18 * 60, 23 * 60), 'Fri to Sun, 6 to 11 pm', 'runs wrap round the week');
  assert.equal(w([6, 0, 1], 0, 12 * 60), 'Sat to Mon, until noon');
  assert.equal(w([0, 2, 3, 4]), 'Tue to Thu and Sun', 'Monday-first order');
  assert.equal(w(L.ALL_DAYS, 0, 1), 'Every day, until 12:01 am');
  assert.equal(w(L.ALL_DAYS, 1439, 1440), 'Every day, from 11:59 pm');
  // Never an em dash in user-facing text.
  for (const days of [[1, 2, 3, 4], [0, 6], [3], [1, 3, 5], [5, 6, 0], L.ALL_DAYS]) {
    for (const [s, e] of [[0, 1440], [960, 1140], [480, 1440], [0, 660], [720, 900]]) assert.doesNotMatch(w(days, s, e), EM_DASH);
  }
});

test('IST clock and week keys: UTC instants convert to IST (+5:30) correctly', () => {
  // Sat 14 Nov 2026 23:59 IST = 18:29 UTC; one minute later it is Sunday in IST.
  assert.deepEqual(L.istClock(new Date('2026-11-14T18:29:00Z')), { dow: 6, minute: 1439, date: '2026-11-14' });
  assert.deepEqual(L.istClock(new Date('2026-11-14T18:30:00Z')), { dow: 0, minute: 0, date: '2026-11-15' });
  // Weeks start on Sunday (IST), same as quests and the progress week strip.
  assert.equal(L.weekKey(ist('2026-11-14', '23:59')), '2026-11-08');
  assert.equal(L.weekKey(ist('2026-11-15', '00:00')), '2026-11-15');
  assert.equal(L.weekKey(ist('2026-11-12', '04:00')), '2026-11-08');
  // UTC midnight on Thursday is already 5:30 am Thursday in IST.
  assert.equal(L.istClock(new Date('2026-11-12T00:00:00Z')).minute, 330);
  // Period starts are IST midnights.
  assert.equal(L.istDayStart(ist('2026-11-12', '00:10')).toISOString(), '2026-11-11T18:30:00.000Z');
  assert.equal(L.istWeekStart(ist('2026-11-12', '16:00')).toISOString(), '2026-11-07T18:30:00.000Z');
  assert.equal(L.istMonthStart(ist('2026-11-12', '16:00')).toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(L.istMonthStart(ist('2026-12-01', '00:05')).toISOString(), '2026-11-30T18:30:00.000Z');
  assert.equal(L.istWhen(ist('2026-11-14', '19:30')), 'Sat 14 Nov, 7:30 pm');
});

test('inWindow: IST day and time, start inclusive, end exclusive', () => {
  const o = offer({ days: [1, 2, 3, 4], startMinute: 16 * 60, endMinute: 19 * 60 }); // Mon to Thu, 4 to 7 pm
  assert.equal(L.inWindow(o, ist('2026-11-12', '16:00')), true, 'Thu 4:00 pm: start is inclusive');
  assert.equal(L.inWindow(o, ist('2026-11-12', '18:59')), true);
  assert.equal(L.inWindow(o, ist('2026-11-12', '19:00')), false, 'end is exclusive');
  assert.equal(L.inWindow(o, ist('2026-11-12', '15:59')), false);
  assert.equal(L.inWindow(o, ist('2026-11-13', '17:00')), false, 'Friday is not in the window');
  assert.equal(L.inWindow(o, ist('2026-11-08', '17:00')), false, 'Sunday is not in the window');
  // Thu 10:45 UTC = Thu 4:15 pm IST: in the window although 10:45 is outside it in UTC.
  assert.equal(L.inWindow(o, new Date('2026-11-12T10:45:00Z')), true);
  // Thu 20:00 UTC = Fri 1:30 am IST: the IST day decides.
  assert.equal(L.inWindow(offer({ days: [4] }), new Date('2026-11-12T20:00:00Z')), false);
  assert.equal(L.inWindow(offer({ days: [5] }), new Date('2026-11-12T20:00:00Z')), true);
  // All day, every day; end 1440 includes 11:59 pm.
  assert.equal(L.inWindow(offer(), ist('2026-11-14', '23:59')), true);
  assert.equal(L.inWindow(offer({ days: [0, 6], startMinute: 8 * 60 }), ist('2026-11-15', '07:59')), false);
  assert.equal(L.inWindow(offer({ days: [0, 6], startMinute: 8 * 60 }), ist('2026-11-15', '08:00')), true);
});

test('isLive: status and validFrom / validTo', () => {
  const now = ist('2026-11-12', '12:00');
  assert.equal(L.isLive(offer(), now), true);
  assert.equal(L.isLive(offer({ status: 'paused' }), now), false);
  assert.equal(L.isLive(offer({ status: 'ended' }), now), false);
  assert.equal(L.isLive(offer({ validFrom: ist('2026-11-13', '00:00') }), now), false, 'not started yet');
  assert.equal(L.isLive(offer({ validTo: ist('2026-11-11', '23:59') }), now), false, 'already over');
  assert.equal(L.isLive(offer({ validFrom: ist('2026-11-01', '00:00'), validTo: ist('2026-11-30', '00:00') }), now), true);
  assert.equal(L.isLive(null, now), false);
});

test('eligibility: every reason code, in a stable order', () => {
  const now = ist('2026-11-12', '17:00'); // Thursday
  const names = new Map([
    [3, 'Regular'],
    [5, 'Connector'],
  ]);
  const ok = L.eligibility(offer(), viewer(), { now, levelNames: names });
  assert.deepEqual(ok, { eligible: true, reasons: [], unlockLevel: 1, unlockLevelName: null, usedThisWeek: 0, activeRedemptionId: null });

  const lvl = L.eligibility(offer({ minLevel: 5 }), viewer({ level: 3 }), { now, levelNames: names });
  assert.deepEqual(lvl.reasons, ['level']);
  assert.equal(lvl.unlockLevel, 5);
  assert.equal(lvl.unlockLevelName, 'Connector');
  assert.equal(L.eligibility(offer({ minLevel: 3 }), viewer({ level: 3 }), { now }).eligible, true, 'level equal to minLevel is enough');

  const show = L.eligibility(offer({ minShowUpRate: 0.9 }), viewer({ showUpRate: 0.8, plansConsidered: 5 }), { now });
  assert.deepEqual(show.reasons, ['show_up']);
  assert.equal(L.eligibility(offer({ minShowUpRate: 0.8 }), viewer({ showUpRate: 4 / 5, plansConsidered: 5 }), { now }).eligible, true, '0.8 meets 0.8');

  const weekly = L.eligibility(offer({ perUserPerWeek: 2 }), viewer(), { now, usedThisWeek: 2 });
  assert.deepEqual(weekly.reasons, ['weekly_limit']);
  assert.equal(weekly.usedThisWeek, 2);
  assert.equal(L.eligibility(offer({ perUserPerWeek: 2 }), viewer(), { now, usedThisWeek: 1 }).eligible, true);

  const notNow = L.eligibility(offer({ days: [0, 6] }), viewer(), { now });
  assert.deepEqual(notNow.reasons, ['not_now']);

  const all = L.eligibility(offer({ minLevel: 5, minShowUpRate: 0.95, days: [0], perUserPerWeek: 1 }), viewer({ level: 2, showUpRate: 0.5, plansConsidered: 10 }), { now, usedThisWeek: 1, activeRedemptionId: 'r1' });
  assert.deepEqual(all.reasons, ['level', 'show_up', 'weekly_limit', 'not_now']);
  assert.equal(all.eligible, false);
  assert.equal(all.activeRedemptionId, 'r1');
  assert.equal(L.isUnlocked(all), false);
  assert.equal(L.isUnlocked(weekly), true, 'weekly limit / not now do not lock a perk');
  assert.equal(L.isUnlocked(notNow), true);
  assert.deepEqual(L.REASONS, ['level', 'show_up', 'weekly_limit', 'not_now']);
});

test('show-up rate counts as 1.0 until 3 considered plans', () => {
  const now = ist('2026-11-12', '17:00');
  const strict = offer({ minShowUpRate: 1 });
  assert.equal(L.effectiveShowUp(0, 0), 1);
  assert.equal(L.effectiveShowUp(0.5, 2), 1);
  assert.equal(L.effectiveShowUp(0.5, 3), 0.5);
  assert.equal(L.eligibility(strict, viewer({ showUpRate: 0, plansConsidered: 2 }), { now }).eligible, true, 'two plans: still counts as 1.0');
  assert.deepEqual(L.eligibility(strict, viewer({ showUpRate: 2 / 3, plansConsidered: 3 }), { now }).reasons, ['show_up'], 'three plans: the real rate applies');
  assert.equal(L.eligibility(offer({ minShowUpRate: 0 }), viewer({ showUpRate: 0, plansConsidered: 9 }), { now }).eligible, true);
});

test('codes: alphabet, length, normalisation and QR payload', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const c = L.generateCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.doesNotMatch(c, /[01ILO]/, 'no look-alike characters');
    seen.add(c);
  }
  assert.ok(seen.size > 490, 'codes are random');
  assert.equal(L.generateCode(() => 0), 'AAAAAA');
  assert.equal(L.generateCode((n) => n - 1), '999999');
  assert.equal(L.normalizeCode(' ab c 2-34 '), 'ABC234', 'case-insensitive, spaces and dashes ignored');
  assert.equal(L.normalizeCode('comeover:redeem:abc234'), 'ABC234', 'a scanned QR payload works too');
  assert.equal(L.normalizeCode(null), '');
  assert.equal(L.isCode('ABC234'), true);
  assert.equal(L.isCode('ABC23'), false);
  assert.equal(L.isCode('ABC10O'), false);
  assert.equal(L.qrPayload('ABC234'), 'comeover:redeem:ABC234');
  assert.equal(L.CODE_TTL_MS, 20 * 60000);
});

test('offerErrors: value by kind, window order, validity order, days', () => {
  assert.deepEqual(L.offerErrors(offer()), []);
  assert.deepEqual(L.offerErrors(offer({ kind: 'percent', value: 4 })), [{ path: 'value', code: 'too_small', min: 5 }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'percent', value: 51 })), [{ path: 'value', code: 'too_large', max: 50 }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'percent', value: null })), [{ path: 'value', code: 'required' }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'flat', value: 9 })), [{ path: 'value', code: 'too_small', min: 10 }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'flat', value: 5001 })), [{ path: 'value', code: 'too_large', max: 5000 }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'flat', value: 99.5 })), [{ path: 'value', code: 'type', expected: 'integer' }]);
  assert.deepEqual(L.offerErrors(offer({ kind: 'freebie', value: null })), []);
  assert.deepEqual(L.offerErrors(offer({ startMinute: 600, endMinute: 600 })), [{ path: 'endMinute', code: 'must_be_after_start' }]);
  assert.deepEqual(L.offerErrors(offer({ validFrom: new Date('2026-11-10'), validTo: new Date('2026-11-09') })), [{ path: 'validTo', code: 'must_be_after_valid_from' }]);
  assert.deepEqual(L.offerErrors(offer({ days: [] })), [{ path: 'days', code: 'too_few', min: 1 }]);
});

test('rankOffers and nextUnlock', () => {
  const a = offer({ _id: 'a', minLevel: 1, kind: 'freebie', value: null, title: 'Free chai', createdAt: new Date('2026-11-01') });
  const b = offer({ _id: 'b', minLevel: 1, kind: 'percent', value: 10, createdAt: new Date('2026-11-02') });
  const c = offer({ _id: 'c', minLevel: 1, kind: 'percent', value: 20, createdAt: new Date('2026-11-03') });
  const d = offer({ _id: 'd', minLevel: 4, kind: 'flat', value: 200 });
  const e = offer({ _id: 'e', minLevel: 6, kind: 'flat', value: 300 });
  const f = offer({ _id: 'f', minLevel: 4, kind: 'percent', value: 25 });
  assert.deepEqual(L.rankOffers([a, b, c, d]).map((o) => o._id), ['c', 'b', 'a', 'd']);
  // With eligibility, unlocked offers come first.
  const withEl = [
    { ...c, eligibility: { reasons: ['show_up'] } },
    { ...a, eligibility: { reasons: ['not_now'] } },
  ];
  assert.deepEqual(L.rankOffers(withEl).map((o) => o._id), ['a', 'c']);

  const levels = [
    { level: 1, name: 'Newcomer', xpThreshold: 0 },
    { level: 4, name: 'Explorer', xpThreshold: 160 },
    { level: 6, name: 'Host', xpThreshold: 480 },
  ];
  assert.deepEqual(L.nextUnlock([a, b, d, e, f], { level: 2, xp: 60, levels }), { level: 4, name: 'Explorer', xpNeeded: 100, offers: 2 });
  assert.deepEqual(L.nextUnlock([a, e], { level: 4, xp: 200, levels }), { level: 6, name: 'Host', xpNeeded: 280, offers: 1 });
  assert.equal(L.nextUnlock([a, b], { level: 3, xp: 120, levels }), null, 'nothing left to unlock by level');
  assert.deepEqual(L.nextUnlock([offer({ minLevel: 9 })], { level: 3, xp: 120, levels }), { level: 9, name: null, xpNeeded: null, offers: 1 }, 'level not defined yet');
});

test('small helpers: first name only, group size clamp', () => {
  assert.equal(L.firstName('Asha Patel'), 'Asha');
  assert.equal(L.firstName('  Ravi  '), 'Ravi');
  assert.equal(L.firstName(''), null);
  assert.equal(L.firstName(null), null);
  assert.equal(L.clampGroup(0), 1);
  assert.equal(L.clampGroup(4), 4);
  assert.equal(L.clampGroup(30), 20);
  assert.equal(L.clampGroup(undefined), 1);
});
