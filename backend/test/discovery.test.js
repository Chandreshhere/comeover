'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { mapError } = require('../src/lib/http');

let skip = null;
test.before(async () => {
  const m = await startMongo();
  if (m.skip) skip = m.skip;
});
test.after(stopMongo);
test.beforeEach(async () => {
  if (!skip) await clearCollections();
});

// Call a route function directly with a minimal request (same shape lib/http builds).
async function call(mod, routeKey, { user, params = {}, query = {}, body = {}, headers = {} } = {}) {
  const { routes } = require(`../src/handlers/${mod}`);
  const [method, path] = routeKey.split(' ');
  const req = { method, path, routeKey, params, query, body, headers, ip: '127.0.0.1', requestId: 't', rawBody: () => JSON.stringify(body), user: null, authClaims: user ? { sub: user } : null, authError: null };
  try {
    const out = await routes[routeKey](req);
    if (out && typeof out.statusCode === 'number') return { status: out.statusCode, body: out.body ? JSON.parse(out.body) : null };
    return { status: 200, body: out };
  } catch (e) {
    const r = mapError(e);
    return { status: r.statusCode, body: JSON.parse(r.body) };
  }
}

const AHMEDABAD = { lat: 23.0365, lng: 72.5611 };

async function seed() {
  const { Category, CityArea } = require('../src/models');
  await Category.create([
    { slug: 'chai', label: 'Chai & coffee', short: 'Chai', pictogram: 'chai', sortOrder: 1 },
    { slug: 'run', label: 'Running', short: 'Run', pictogram: 'run', sortOrder: 2 },
    { slug: 'nightlife', label: 'Nightlife', riskLevel: 'restricted', sortOrder: 3 },
  ]);
  await CityArea.create({ city: 'Ahmedabad', name: 'Navrangpura', centroid: { type: 'Point', coordinates: [AHMEDABAD.lng, AHMEDABAD.lat] } });
}

async function makeUser(name, extra = {}) {
  const { User } = require('../src/models');
  const u = await User.create({ phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, ageVerified: true, profile: { displayName: name, homeArea: 'Navrangpura', interests: ['chai'] }, ...extra });
  return u._id;
}

async function createPlan(host, overrides = {}) {
  const r = await call('activities', 'POST /v1/activities', {
    user: host,
    body: {
      title: 'Evening chai',
      category: 'chai',
      startsAt: new Date(Date.now() + 2 * 3600000).toISOString(),
      durationMin: 60,
      capacity: 4,
      area: 'Navrangpura',
      venueName: 'Cafe on CG Road',
      venueType: 'Public café',
      latitude: 23.0371,
      longitude: 72.5617,
      joinRule: 'instant',
      ...overrides,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('GET /activities: geo radius filter, coarse distance and snapped coordinates', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const viewer = await makeUser('Viewer');
  const near = await createPlan(host);
  await createPlan(host, { title: 'Far away run', category: 'run', latitude: 23.25, longitude: 72.75, startsAt: new Date(Date.now() + 3 * 3600000).toISOString() });

  const r = await call('discovery', 'GET /v1/activities', { user: viewer, query: { lat: String(AHMEDABAD.lat), lng: String(AHMEDABAD.lng), radius: '3' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((a) => a.id), [near.id]);
  const a = r.body.items[0];
  assert.equal(a.locationPrecision, 'approx_300m');
  assert.notEqual(a.latitude, 23.0371, 'exact coordinates must not leak');
  assert.ok(a.distanceM >= 300 && a.distanceM % 100 === 0, `coarse distance, got ${a.distanceM}`);
  assert.match(a.distanceBand, /m$|km$/);
  assert.equal(a.venueName, null, 'venue hidden from non-participants');
  assert.equal(a.joinedCount, 1);
  assert.deepEqual(a.participants, [host]);
  assert.equal(a.host.name, 'Host');
  assert.equal(a.pictogram, 'chai');

  // Manual area path (location off) resolves to the area centroid.
  const byArea = await call('discovery', 'GET /v1/activities', { user: viewer, query: { area: 'navrangpura', radius: '3' } });
  assert.deepEqual(byArea.body.items.map((x) => x.id), [near.id]);

  // City-wide without a point lists both, soonest first.
  const all = await call('discovery', 'GET /v1/activities', { user: viewer });
  assert.equal(all.body.items.length, 2);
  assert.equal(all.body.items[0].id, near.id);
  assert.equal(all.body.items[0].distanceM, null);

  // Category + text filters.
  const runs = await call('discovery', 'GET /v1/activities', { user: viewer, query: { category: 'run' } });
  assert.equal(runs.body.items.length, 1);
  const text = await call('discovery', 'GET /v1/activities', { user: viewer, query: { q: 'far away' } });
  assert.equal(text.body.items.length, 1);

  // Categories hide restricted ones; featured returns open plans.
  const cats = await call('discovery', 'GET /v1/activities/categories', { user: viewer });
  assert.deepEqual(cats.body.items.map((c) => c.slug), ['chai', 'run']);
  const featured = await call('discovery', 'GET /v1/activities/featured', { user: viewer, query: { lat: String(AHMEDABAD.lat), lng: String(AHMEDABAD.lng) } });
  assert.equal(featured.body.items[0].featured, true);
});

test('venueName privacy: hidden until accepted; host and accepted members see it', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const guest = await makeUser('Guest');
  const outsider = await makeUser('Outsider');
  const plan = await createPlan(host, { joinRule: 'approval' });

  const asHost = await call('discovery', 'GET /v1/activities/{activityId}', { user: host, params: { activityId: plan.id } });
  assert.equal(asHost.body.venueName, 'Cafe on CG Road');
  assert.equal(asHost.body.hostedByMe, true);
  assert.equal(asHost.body.locationPrecision, 'exact');
  assert.ok(asHost.body.conversationId);

  const join = await call('activities', 'POST /v1/activities/{activityId}/join-requests', { user: guest, params: { activityId: plan.id }, body: { intro: 'Hi!' } });
  assert.equal(join.body.state, 'requested');
  assert.equal(join.body.activity.venueName, null, 'requested is not accepted yet');
  assert.equal(join.body.activity.conversationId, null);

  const acc = await call('activities', 'POST /v1/activities/{activityId}/join-requests/{requestId}/accept', { user: host, params: { activityId: plan.id, requestId: join.body.requestId } });
  assert.equal(acc.body.state, 'accepted');
  const asGuest = await call('discovery', 'GET /v1/activities/{activityId}', { user: guest, params: { activityId: plan.id } });
  assert.equal(asGuest.body.venueName, 'Cafe on CG Road');
  assert.equal(asGuest.body.myJoinState, 'accepted');
  assert.equal(asGuest.body.conversationId, asHost.body.conversationId);
  assert.equal(asGuest.body.locationPrecision, 'exact', 'exactLocationAfterAccept defaults to true');

  const asOutsider = await call('discovery', 'GET /v1/activities/{activityId}', { user: outsider, params: { activityId: plan.id } });
  assert.equal(asOutsider.body.venueName, null);
  assert.equal(asOutsider.body.conversationId, null);
  assert.equal(asOutsider.body.joinedCount, 2);

  // Detail views by non-hosts feed venue analytics.
  const { ActivityDailyMetric } = require('../src/models');
  const m = await ActivityDailyMetric.findOne({ activityId: plan.id }).lean();
  assert.equal(m.views, 2);
});

test('blocks hide plans both ways; invite-only plans are hidden from outsiders', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const viewer = await makeUser('Viewer');
  const plan = await createPlan(host);
  await createPlan(host, { title: 'Invite only chai', visibility: 'invite_only', startsAt: new Date(Date.now() + 5 * 3600000).toISOString() });
  const { Block } = require('../src/models');
  let r = await call('discovery', 'GET /v1/activities', { user: viewer });
  assert.equal(r.body.items.length, 1);
  await Block.create({ blockerUserId: host, blockedUserId: viewer });
  r = await call('discovery', 'GET /v1/activities', { user: viewer });
  assert.equal(r.body.items.length, 0);
  const d = await call('discovery', 'GET /v1/activities/{activityId}', { user: viewer, params: { activityId: plan.id } });
  assert.equal(d.status, 404);
  assert.equal(d.body.code, 'activity_not_found');
});

test('availability: only a coarse cell is stored; nearby returns coarse PublicUsers', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const me = await makeUser('Me');
  const friend = await makeUser('Friend');
  const hidden = await makeUser('Hidden', { profile: { displayName: 'Hidden', visibility: 'hidden' } });
  for (const u of [friend, hidden]) {
    const r = await call('discovery', 'PUT /v1/me/availability', { user: u, body: { status: 'now', activities: ['chai'], lat: 23.0372, lng: 72.5603 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'now');
  }
  const { User } = require('../src/models');
  const stored = await User.findById(friend).lean();
  assert.equal(stored.availability.coarseCell.length, 6);
  assert.equal(JSON.stringify(stored.availability).includes('23.0372'), false, 'precise point is discarded');

  const r = await call('discovery', 'GET /v1/availability/nearby', { user: me, query: { lat: String(AHMEDABAD.lat), lng: String(AHMEDABAD.lng), radius: '5' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((u) => u.id), [friend]);
  assert.equal(r.body.items[0].availability, 'now');
  assert.equal(r.body.items[0].intent, 'chai');
  assert.ok(r.body.items[0].distanceM >= 300);
  assert.equal(r.body.items[0].latitude, undefined);

  const noPoint = await call('discovery', 'GET /v1/availability/nearby', { user: me });
  assert.equal(noPoint.body.code, 'location_required');
  const tooFar = await call('discovery', 'PUT /v1/me/availability', { user: me, body: { status: 'later', until: new Date(Date.now() + 30 * 3600000).toISOString() } });
  assert.equal(tooFar.body.code, 'until_too_far');
});

test('GET /me/activities tabs, search and venues', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Meher');
  const guest = await makeUser('Guest');
  const plan = await createPlan(host);
  const cancelled = await createPlan(host, { title: 'Cancelled chai', startsAt: new Date(Date.now() + 6 * 3600000).toISOString() });
  await call('activities', 'POST /v1/activities/{activityId}/join-requests', { user: guest, params: { activityId: plan.id } });
  await call('activities', 'POST /v1/activities/{activityId}/cancel', { user: host, params: { activityId: cancelled.id }, body: { reason: 'Rain' } });

  const hosted = await call('discovery', 'GET /v1/me/activities', { user: host, query: { tab: 'hosted' } });
  assert.deepEqual(hosted.body.items.map((a) => a.id), [plan.id]);
  const joined = await call('discovery', 'GET /v1/me/activities', { user: guest, query: { tab: 'joined' } });
  assert.deepEqual(joined.body.items.map((a) => a.id), [plan.id]);
  const gone = await call('discovery', 'GET /v1/me/activities', { user: host, query: { tab: 'cancelled' } });
  assert.deepEqual(gone.body.items.map((a) => a.id), [cancelled.id]);

  const { Venue } = require('../src/models');
  const v = await Venue.create({ name: 'Dice Cafe', area: 'Vastrapur', verified: true, latitude: 23.0371, longitude: 72.5617, categorySlugs: ['chai'] });
  const s = await call('discovery', 'GET /v1/search', { user: guest, query: { q: 'meh' } });
  assert.deepEqual(s.body.people.map((p) => p.name), ['Meher']);
  const s2 = await call('discovery', 'GET /v1/search', { user: guest, query: { q: 'dice' } });
  assert.deepEqual(s2.body.venues.map((x) => x.id), [v._id]);

  const list = await call('discovery', 'GET /v1/venues', { user: guest, query: { lat: String(AHMEDABAD.lat), lng: String(AHMEDABAD.lng), category: 'chai' } });
  assert.equal(list.body.items[0].id, v._id);
  assert.ok(list.body.items[0].distanceM >= 300);
  const detail = await call('discovery', 'GET /v1/venues/{venueId}', { user: guest, params: { venueId: v._id } });
  assert.deepEqual(detail.body.upcomingPlans.map((a) => a.id), [plan.id], 'plans within 75 m of the venue');
});

test('GET /activities: category accepts one slug or a comma list; radius is in km (0.2-25)', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const viewer = await makeUser('Viewer');
  await createPlan(host, { title: 'Chai plan' });
  await createPlan(host, { title: 'Run plan', category: 'run', startsAt: new Date(Date.now() + 3 * 3600000).toISOString() });
  const q = (extra) => call('discovery', 'GET /v1/activities', { user: viewer, query: { lat: String(AHMEDABAD.lat), lng: String(AHMEDABAD.lng), radius: '15', ...extra } });
  const titles = (r) => r.body.items.map((a) => a.title).sort();

  assert.deepEqual(titles(await q({})), ['Chai plan', 'Run plan']);
  assert.deepEqual(titles(await q({ category: 'chai' })), ['Chai plan']);
  assert.deepEqual(titles(await q({ category: 'chai,run' })), ['Chai plan', 'Run plan']); // the app's multi-select
  assert.deepEqual(titles(await q({ category: 'run,nightlife' })), ['Run plan']); // unknown slugs just match nothing

  const bad = await q({ category: 'chai,,run;drop' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'validation_failed');
  const metres = await q({ radius: '15000' }); // the old app bug: metres instead of km
  assert.equal(metres.status, 400);
  const tooMany = await q({ category: Array.from({ length: 11 }, (_, i) => `cat${i}`).join(',') });
  assert.equal(tooMany.status, 400);
});
