'use strict';
// Social energy matching (lib/socialMatch) — pure functions, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../src/lib/socialMatch');

test('styleCompat: same style 1, ambivert pairs 0.8, opposite ends 0.45, unknown null', () => {
  for (const s of SM.SOCIAL_STYLES) assert.equal(SM.styleCompat(s, s), 1);
  assert.equal(SM.styleCompat('introvert', 'ambivert'), 0.8);
  assert.equal(SM.styleCompat('ambivert', 'introvert'), 0.8);
  assert.equal(SM.styleCompat('extrovert', 'ambivert'), 0.8);
  assert.equal(SM.styleCompat('ambivert', 'extrovert'), 0.8);
  assert.equal(SM.styleCompat('introvert', 'extrovert'), 0.45);
  assert.equal(SM.styleCompat('extrovert', 'introvert'), 0.45);
  assert.equal(SM.styleCompat('introvert', null), null);
  assert.equal(SM.styleCompat(undefined, 'introvert'), null);
  assert.equal(SM.styleCompat('introvert', 'toString'), null, 'prototype keys are not styles');
});

test('planCompat: introverts like small calm plans, extroverts big lively ones, ambiverts mid-size', () => {
  const smallChai = { capacity: 3, category: 'chai', pictogram: 'chai' };
  const bigGig = { capacity: 12, category: 'music', pictogram: 'music' };
  const midWalk = { capacity: 5, category: 'walk', pictogram: 'walk' };
  assert.ok(SM.planCompat('introvert', smallChai) > SM.planCompat('introvert', bigGig));
  assert.ok(SM.planCompat('extrovert', bigGig) > SM.planCompat('extrovert', smallChai));
  assert.ok(SM.planCompat('ambivert', midWalk) > SM.planCompat('ambivert', bigGig));
  assert.equal(SM.planCompat('introvert', smallChai), 1);
  assert.equal(SM.planCompat(null, smallChai), SM.NEUTRAL);
  assert.equal(SM.planCompat('introvert', null), SM.NEUTRAL);
  // Pictogram keys count too (category slug 'cowork' → pictogram 'laptop').
  assert.equal(SM.planCompat('introvert', { capacity: 4, category: 'x', pictogram: 'laptop' }), 1);
  for (const s of SM.SOCIAL_STYLES) {
    for (const a of [smallChai, bigGig, midWalk, { capacity: 2 }, { capacity: 30, category: 'party' }]) {
      const v = SM.planCompat(s, a);
      assert.ok(v >= 0 && v <= 1, `${s} → ${v}`);
    }
  }
});

test('rankPeople: best matches first, stable, nobody dropped', () => {
  const people = [
    { id: 'e1', socialStyle: 'extrovert' },
    { id: 'n1', socialStyle: null },
    { id: 'a1', socialStyle: 'ambivert' },
    { id: 'i1', socialStyle: 'introvert' },
    { id: 'e2', socialStyle: 'extrovert' },
    { id: 'i2', socialStyle: 'introvert' },
  ];
  const ids = (list) => list.map((p) => p.id);
  assert.deepEqual(ids(SM.rankPeople(people, 'introvert')), ['i1', 'i2', 'a1', 'n1', 'e1', 'e2']);
  assert.deepEqual(ids(SM.rankPeople(people, 'extrovert')), ['e1', 'e2', 'a1', 'n1', 'i1', 'i2']);
  assert.deepEqual(ids(SM.rankPeople(people, 'ambivert')), ['a1', 'e1', 'i1', 'e2', 'i2', 'n1']);
  // No style of my own → original order (a copy).
  const same = SM.rankPeople(people, null);
  assert.deepEqual(ids(same), ids(people));
  assert.notEqual(same, people);
  // Custom accessor (lean user docs keep the style under profile).
  const docs = [{ _id: 'x', profile: { socialStyle: 'extrovert' } }, { _id: 'y', profile: { socialStyle: 'introvert' } }];
  assert.deepEqual(SM.rankPeople(docs, 'introvert', (u) => u.profile.socialStyle).map((u) => u._id), ['y', 'x']);
});

test('rankPlans: gentle nudge — server order stays the main signal, nothing is dropped', () => {
  const big = (id) => ({ id, capacity: 12, category: 'music' }); // introvert: 0.3
  const small = (id) => ({ id, capacity: 3, category: 'chai' }); // introvert: 1.0
  const mid = (id) => ({ id, capacity: 6, category: 'explore' }); // introvert: 0.6
  const ids = (list) => list.map((a) => a.id);

  // A great match overtakes a poorer one right before it…
  assert.deepEqual(ids(SM.rankPlans([big('a'), small('b')], 'introvert')), ['b', 'a']);
  assert.deepEqual(ids(SM.rankPlans([mid('a'), small('b')], 'introvert')), ['b', 'a']);
  // …small differences don't reorder anything…
  const slightlyBetter = { id: 'b', capacity: 4, category: 'explore' }; // introvert: 0.85
  assert.deepEqual(ids(SM.rankPlans([mid('a'), slightlyBetter], 'introvert')), ['a', 'b']);
  // …and nothing jumps far up the list.
  const list = [mid('m1'), mid('m2'), mid('m3'), mid('m4'), small('s5')];
  assert.deepEqual(ids(SM.rankPlans(list, 'introvert')), ['m1', 'm2', 'm3', 's5', 'm4']);
  const poor = [big('b1'), big('b2'), big('b3'), big('b4'), small('s5')];
  assert.deepEqual(ids(SM.rankPlans(poor, 'introvert')), ['b1', 'b2', 's5', 'b3', 'b4']);
  // Ties keep the incoming order exactly.
  assert.deepEqual(ids(SM.rankPlans([small('x'), small('y'), small('z')], 'introvert')), ['x', 'y', 'z']);

  // Extroverts get the opposite nudge.
  assert.deepEqual(ids(SM.rankPlans([small('a'), big('b')], 'extrovert')), ['b', 'a']);
  // No style → unchanged.
  assert.deepEqual(ids(SM.rankPlans([big('a'), small('b')], null)), ['a', 'b']);
});
