'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/lib/geo');

test('snapToGrid is deterministic per ~300 m cell', () => {
  const a = geo.snapToGrid(23.03651, 72.56112);
  const b = geo.snapToGrid(23.03652, 72.56113);
  assert.deepEqual(a, b);
});

test('snapped point stays within the cell (≤ ~215 m from original)', () => {
  for (const [lat, lng] of [[23.0365, 72.5611], [19.076, 72.8777], [28.6139, 77.209], [12.9716, 77.5946]]) {
    const s = geo.snapToGrid(lat, lng);
    const d = geo.haversineMeters({ latitude: lat, longitude: lng }, s);
    assert.ok(d <= 215, `distance ${d} too large`);
    assert.ok(!(s.latitude === lat && s.longitude === lng), 'must not return the exact point');
  }
});

test('snapToGrid rejects invalid coordinates', () => {
  assert.equal(geo.snapToGrid(91, 0), null);
  assert.equal(geo.snapToGrid(NaN, 10), null);
});

test('coarse distance bands never reveal precise distance', () => {
  assert.equal(geo.distanceBand(120), '< 300 m');
  assert.equal(geo.coarseDistanceMeters(120), 300);
  assert.equal(geo.distanceBand(640), '~600 m');
  assert.equal(geo.distanceBand(1740), '~1.5 km');
  assert.equal(geo.distanceBand(2760), '~3 km');
  assert.equal(geo.distanceBand(14200), '~14 km');
  assert.equal(geo.distanceBand(null), 'Nearby');
});

test('clampRadiusKm caps at 25 km and defaults to 3 km', () => {
  assert.equal(geo.clampRadiusKm(100), 25);
  assert.equal(geo.clampRadiusKm('abc'), 3);
  assert.equal(geo.clampRadiusKm(-1), 3);
  assert.equal(geo.clampRadiusKm(5), 5);
});

test('presentLocation: exact only for host or accepted participant (when host allows)', () => {
  const act = { latitude: 23.0365, longitude: 72.5611, coarse_area: 'Navrangpura', exact_location_visible_after_accept: true };
  assert.equal(geo.presentLocation(act, { isHost: true }).precision, 'exact');
  assert.equal(geo.presentLocation(act, { isAccepted: true }).precision, 'exact');
  const stranger = geo.presentLocation(act, { isAccepted: false });
  assert.equal(stranger.precision, 'approx_300m');
  assert.notEqual(stranger.latitude, act.latitude);
  const hidden = geo.presentLocation({ ...act, exact_location_visible_after_accept: false }, { isAccepted: true });
  assert.equal(hidden.precision, 'approx_300m');
});

test('withinMeters for proximity check-in', () => {
  const venue = { latitude: 23.0365, longitude: 72.5611 };
  assert.ok(geo.withinMeters({ latitude: 23.0375, longitude: 72.5611 }, venue, 300));
  assert.ok(!geo.withinMeters({ latitude: 23.0465, longitude: 72.5611 }, venue, 300));
  assert.ok(!geo.withinMeters({ latitude: null, longitude: 1 }, venue, 300));
});
