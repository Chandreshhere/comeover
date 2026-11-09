'use strict';
// Social style (introvert / ambivert / extrovert) + the Thrifting / Smoke break
// categories, end to end against an in-memory MongoDB replica set.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client } = require('./helpers/fixtures');

let skip = null;
let app;
let call;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  app = await startApp();
  call = client(app.base);
});
test.after(async () => {
  if (app) await app.stop();
  await stopMongo();
});
test.beforeEach(async () => {
  if (skip) return;
  await clearCollections();
  await require('../scripts/seed').seed();
});

const AHMEDABAD = { lat: 23.0365, lng: 72.5611 };
let seq = 0;

async function makeUser(name, { socialStyle = null, ...profile } = {}) {
  const { User } = require('../src/models');
  const { signAccessToken } = require('../src/lib/tokens');
  seq += 1;
  const u = await User.create({
    phone: `+9196${String(seq).padStart(8, '0')}`,
    ageVerified: true,
    profile: { displayName: name, homeArea: 'Navrangpura', interests: ['chai'], socialStyle, preferences: { onboardedAt: new Date().toISOString() }, ...profile },
  });
  return { id: u._id, name, token: signAccessToken({ userId: u._id, roles: [], sid: `t-${u._id}` }) };
}

const goFree = (u, extra = {}) => call('PUT', '/v1/me/availability', { token: u.token, body: { status: 'now', activities: ['chai'], lat: 23.0372, lng: 72.5603, ...extra } });

async function createPlan(host, overrides = {}) {
  const r = await call('POST', '/v1/activities', {
    token: host.token,
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

test('PATCH /me: socialStyle is validated, stored, returned in /me and /me/bootstrap, and can be cleared', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser('Asha');

  const before = await call('GET', '/v1/me', { token: u.token });
  assert.equal(before.body.profile.socialStyle, null);

  const bad = await call('PATCH', '/v1/me', { token: u.token, body: { socialStyle: 'shy' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'validation_failed');

  const set = await call('PATCH', '/v1/me', { token: u.token, body: { socialStyle: 'introvert' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.profile.socialStyle, 'introvert');
  assert.equal(set.body.profile.name, 'Asha', 'other profile fields untouched');

  const boot = await call('GET', '/v1/me/bootstrap', { token: u.token });
  assert.equal(boot.body.me.profile.socialStyle, 'introvert');

  const cleared = await call('PATCH', '/v1/me', { token: u.token, body: { socialStyle: null } });
  assert.equal(cleared.body.profile.socialStyle, null);

  // Before profile setup it needs a name, like every other profile field; with one it is saved on creation.
  const { User } = require('../src/models');
  const { signAccessToken } = require('../src/lib/tokens');
  const fresh = await User.create({ phone: '+919699999999' });
  const token = signAccessToken({ userId: fresh._id, roles: [], sid: 't-fresh' });
  const noName = await call('PATCH', '/v1/me', { token, body: { socialStyle: 'extrovert' } });
  assert.equal(noName.body.code, 'name_required');
  const created = await call('PATCH', '/v1/me', { token, body: { name: 'Ravi', socialStyle: 'extrovert' } });
  assert.equal(created.body.profile.socialStyle, 'extrovert');
});

test('public projections carry socialStyle: nearby people, plan hosts, public profile, circle members, join requests', async (t) => {
  if (skip) return t.skip(skip);
  const me = await makeUser('Me', { socialStyle: 'ambivert' });
  const host = await makeUser('Host', { socialStyle: 'extrovert' });
  const guest = await makeUser('Guest', { socialStyle: 'introvert' });
  assert.equal((await goFree(host)).status, 200);

  const near = await call('GET', `/v1/availability/nearby?lat=${AHMEDABAD.lat}&lng=${AHMEDABAD.lng}&radius=5`, { token: me.token });
  assert.equal(near.status, 200, JSON.stringify(near.body));
  assert.equal(near.body.items[0].socialStyle, 'extrovert');

  const plan = await createPlan(host, { joinRule: 'approval' });
  const detail = await call('GET', `/v1/activities/${plan.id}`, { token: me.token });
  assert.equal(detail.body.host.socialStyle, 'extrovert');

  const pub = await call('GET', `/v1/users/${host.id}/public-profile`, { token: me.token });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.socialStyle, 'extrovert');

  const join = await call('POST', `/v1/activities/${plan.id}/join-requests`, { token: guest.token, body: { intro: 'Hi!' } });
  assert.equal(join.status, 200, JSON.stringify(join.body));
  const reqs = await call('GET', `/v1/activities/${plan.id}/join-requests`, { token: host.token });
  assert.equal(reqs.body.items[0].user.socialStyle, 'introvert');

  const circle = await call('POST', '/v1/circles', { token: host.token, body: { name: 'Sunday walkers', visibility: 'public', area: 'Navrangpura', category: 'walk' } });
  assert.ok([200, 201].includes(circle.status), JSON.stringify(circle.body));
  const members = await call('GET', `/v1/circles/${circle.body.id}/members`, { token: host.token });
  assert.equal(members.body.items[0].socialStyle, 'extrovert');

  // Users without a style read as null, never a guess.
  const plain = await makeUser('Plain');
  const pub2 = await call('GET', `/v1/users/${plain.id}/public-profile`, { token: me.token });
  assert.equal(pub2.body.socialStyle, null);
});

test('GET /availability/nearby: best social match first, nobody hidden; then free-now, then nearest', async (t) => {
  if (skip) return t.skip(skip);
  const me = await makeUser('Me', { socialStyle: 'introvert' });
  const ext = await makeUser('Ext', { socialStyle: 'extrovert' });
  const none = await makeUser('NoStyle');
  const amb = await makeUser('Amb', { socialStyle: 'ambivert' });
  const intLater = await makeUser('IntLater', { socialStyle: 'introvert' });
  const intNow = await makeUser('IntNow', { socialStyle: 'introvert' });
  for (const u of [ext, none, amb, intNow]) assert.equal((await goFree(u)).status, 200);
  assert.equal((await goFree(intLater, { status: 'later', until: new Date(Date.now() + 3 * 3600000).toISOString() })).status, 200);

  const url = `/v1/availability/nearby?lat=${AHMEDABAD.lat}&lng=${AHMEDABAD.lng}&radius=5`;
  const r = await call('GET', url, { token: me.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((u) => u.name), ['IntNow', 'IntLater', 'Amb', 'NoStyle', 'Ext']);

  // An extrovert sees the same people, in their own order.
  const r2 = await call('GET', url, { token: ext.token });
  assert.deepEqual(r2.body.items.map((u) => u.name), ['Amb', 'NoStyle', 'IntNow', 'IntLater']);

  // No style of my own → the original order (free now first).
  const plainViewer = await makeUser('Viewer');
  const r3 = await call('GET', url, { token: plainViewer.token });
  assert.equal(r3.body.items.length, 5);
  assert.equal(r3.body.items[4].name, 'IntLater', 'later comes after everyone free now');
});

test('GET /activities: gentle social nudge inside the page, rankedFor reported, nothing dropped', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const intro = await makeUser('Intro', { socialStyle: 'introvert' });
  const extro = await makeUser('Extro', { socialStyle: 'extrovert' });
  const plain = await makeUser('Plain');
  const at = (h) => new Date(Date.now() + h * 3600000).toISOString();
  await createPlan(host, { title: 'Big jam', category: 'music', capacity: 12, startsAt: at(2) });
  await createPlan(host, { title: 'Quiet chai', category: 'chai', capacity: 3, startsAt: at(3) });

  const q = `/v1/activities?lat=${AHMEDABAD.lat}&lng=${AHMEDABAD.lng}&radius=5`;
  const titles = (r) => r.body.items.map((a) => a.title);

  const asPlain = await call('GET', q, { token: plain.token });
  assert.deepEqual(titles(asPlain), ['Big jam', 'Quiet chai'], 'start time order without a style');
  assert.equal(asPlain.body.rankedFor, null);

  const asIntro = await call('GET', q, { token: intro.token });
  assert.deepEqual(titles(asIntro), ['Quiet chai', 'Big jam']);
  assert.equal(asIntro.body.rankedFor, 'introvert');

  const asExtro = await call('GET', q, { token: extro.token });
  assert.deepEqual(titles(asExtro), ['Big jam', 'Quiet chai']);
  assert.equal(asExtro.body.rankedFor, 'extrovert');
});

test('Thrifting and Smoke break: seeded, listed, creatable and filterable', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const viewer = await makeUser('Viewer');

  const cats = await call('GET', '/v1/activities/categories', { token: viewer.token });
  const bySlug = new Map(cats.body.items.map((c) => [c.slug, c]));
  assert.deepEqual(bySlug.get('thrifting'), { slug: 'thrifting', label: 'Thrifting', short: 'Thrift', pictogram: 'thrift', riskLevel: 'standard' });
  assert.deepEqual(bySlug.get('smoke'), { slug: 'smoke', label: 'Smoke break', short: 'Smoke', pictogram: 'smoke', riskLevel: 'elevated' });

  const thrift = await createPlan(host, { title: 'Sunday thrift run', category: 'thrifting', venueName: 'Law Garden market', venueType: 'Market' });
  const smoke = await createPlan(host, { title: 'Smoke break by the riverfront', category: 'smoke', startsAt: new Date(Date.now() + 3 * 3600000).toISOString(), venueName: 'Riverfront walkway', venueType: 'Public area' });
  assert.equal(thrift.pictogram, 'thrift');
  assert.equal(smoke.pictogram, 'smoke');

  const both = await call('GET', `/v1/activities?category=thrifting,smoke&lat=${AHMEDABAD.lat}&lng=${AHMEDABAD.lng}&radius=5`, { token: viewer.token });
  assert.deepEqual(both.body.items.map((a) => a.category).sort(), ['smoke', 'thrifting']);
  const one = await call('GET', '/v1/activities?category=thrifting', { token: viewer.token });
  assert.deepEqual(one.body.items.map((a) => a.title), ['Sunday thrift run']);

  // Interests accept the new slugs too.
  const me = await call('PATCH', '/v1/me', { token: viewer.token, body: { interests: ['thrifting', 'smoke'] } });
  assert.equal(me.status, 200, JSON.stringify(me.body));
});

test('seed --only-missing adds new categories without overwriting admin edits', async (t) => {
  if (skip) return t.skip(skip);
  const { Category } = require('../src/models');
  const { seed } = require('../scripts/seed');
  await Category.deleteMany({ slug: { $in: ['thrifting', 'smoke'] } });
  await Category.updateOne({ slug: 'chai' }, { $set: { label: 'Chai, coffee & more', isActive: false } });

  const counts = await seed({ onlyMissing: true });
  assert.equal(counts.categories, 2);
  const chai = await Category.findOne({ slug: 'chai' }).lean();
  assert.equal(chai.label, 'Chai, coffee & more');
  assert.equal(chai.isActive, false);
  assert.ok(await Category.exists({ slug: 'thrifting' }));
  assert.ok(await Category.exists({ slug: 'smoke', riskLevel: 'elevated' }));

  // The full seed still resets seeded fields (documented behaviour).
  await seed();
  assert.equal((await Category.findOne({ slug: 'chai' }).lean()).label, 'Chai & coffee');
});
