'use strict';
// Profile / me routes (group A port) against an in-memory MongoDB replica set.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startMongo, stopMongo } = require('./helpers/mongo');

let base;
let server;
let skip = null;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  await require('../scripts/seed').seed();
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await stopMongo();
});

let phoneSeq = 0;
async function makeUser(extra = {}) {
  const { User } = require('../src/models');
  phoneSeq += 1;
  const u = await User.create({ phone: `+9197000${String(phoneSeq).padStart(5, '0')}`, ...extra });
  const token = require('../src/lib/tokens').signAccessToken({ userId: u._id, roles: [] });
  return { id: u._id, token };
}

async function call(method, path, token, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const profileDoc = (name, extra = {}) => ({ displayName: name, interests: ['chai'], visibility: 'discoverable', preferences: {}, ...extra });

test('GET /me/bootstrap: full shape for a brand-new user (no profile yet)', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  const r = await call('GET', '/v1/me/bootstrap', u.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  for (const k of ['me', 'city', 'service', 'subscription', 'categories', 'levels', 'progress', 'unread', 'serverTime']) assert.ok(k in b, `missing ${k}`);
  assert.equal(b.me.id, u.id);
  assert.equal(b.me.ageConfirmed, false);
  assert.equal(b.me.onboarded, false);
  assert.equal(b.me.status, 'active');
  assert.equal(b.me.profile, null);
  assert.equal(b.me.prefs.radiusKm, 3);
  assert.equal(b.me.prefs.notifications.quietEnabled, true);
  assert.deepEqual(b.me.availability, { status: 'busy', activities: [], until: null, area: null });
  assert.equal(b.city.name, 'Ahmedabad');
  assert.equal(typeof b.city.center.lat, 'number');
  assert.equal(typeof b.city.center.lng, 'number');
  assert.equal(b.city.areas.length, 9);
  assert.deepEqual(Object.keys(b.city.areas[0]).sort(), ['lat', 'lng', 'name']);
  assert.deepEqual(b.service, { status: 'ok' });
  assert.equal(b.subscription.tier, 'free');
  assert.ok(b.categories.length > 0 && b.categories[0].slug && b.categories[0].pictogram);
  assert.ok(b.levels.length > 0 && typeof b.levels[0].xp === 'number');
  assert.equal(b.progress.xp, 0);
  assert.equal(b.progress.week.length, 7);
  assert.equal(b.progress._stats, undefined);
  assert.deepEqual(b.unread, { notifications: 0, messages: 0 });
});

test('bootstrap: unread counts notifications and other people’s messages since last read', async (t) => {
  if (skip) return t.skip(skip);
  const { Notification, Conversation, ConversationMember, Message } = require('../src/models');
  const u = await makeUser();
  await Notification.create([{ userId: u.id, type: 'system', title: 'a' }, { userId: u.id, type: 'system', title: 'b', readAt: new Date() }]);
  const [c] = await Conversation.create([{ kind: 'direct' }]);
  const joined = new Date(Date.now() - 60000);
  await ConversationMember.create([{ conversationId: c._id, userId: u.id, joinedAt: joined }]);
  await Message.create([
    { conversationId: c._id, senderUserId: 'someone', body: 'hi' },
    { conversationId: c._id, senderUserId: u.id, body: 'mine' },
    { conversationId: c._id, kind: 'system', body: 'Accepted' },
  ]);
  const r = await call('GET', '/v1/me/bootstrap', u.token);
  assert.deepEqual(r.body.unread, { notifications: 1, messages: 2 });
});

test('PATCH /me: flag-only before profile setup, then name required, then profile + prefs fields', async (t) => {
  if (skip) return t.skip(skip);
  const { AuditEvent } = require('../src/models');
  const u = await makeUser();

  const flags = await call('PATCH', '/v1/me', u.token, { ageConfirmed: true, termsAccepted: true });
  assert.equal(flags.status, 200, JSON.stringify(flags.body));
  assert.equal(flags.body.ageConfirmed, true);
  assert.ok(flags.body.session.termsAcceptedAt);
  assert.equal(flags.body.profile, null);
  assert.equal(await AuditEvent.countDocuments({ action: 'user.age_confirmed', targetId: u.id }), 1);

  const noName = await call('PATCH', '/v1/me', u.token, { bio: 'hello' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, 'name_required');

  const badInterest = await call('PATCH', '/v1/me', u.token, { name: 'Asha', interests: ['not-a-category'] });
  assert.equal(badInterest.body.code, 'unknown_interest');
  const badAvatar = await call('PATCH', '/v1/me', u.token, { name: 'Asha', avatarKey: 'avatar/someone-else/x.jpg' });
  assert.equal(badAvatar.body.code, 'invalid_avatar_key');

  const created = await call('PATCH', '/v1/me', u.token, {
    name: 'Asha',
    area: 'Navrangpura',
    interests: ['chai', 'walk'],
    pronouns: 'she/her',
    avatarSeed: 'me-k3x9',
    availabilityWindows: ['evenings', 'weekends'],
    avatarKey: `avatar/${u.id}/a.jpg`,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const p = created.body.profile;
  assert.equal(p.name, 'Asha');
  assert.equal(p.area, 'Navrangpura');
  assert.deepEqual(p.interests, ['chai', 'walk']);
  assert.equal(p.pronouns, 'she/her');
  assert.equal(p.avatarSeed, 'me-k3x9');
  assert.deepEqual(p.availabilityWindows, ['evenings', 'weekends']);
  assert.equal(p.avatarKey, `avatar/${u.id}/a.jpg`);
  assert.equal(p.reliability, 1);
  assert.equal(created.body.onboarded, false);

  const upd = await call('PATCH', '/v1/me', u.token, { bio: 'Chai > coffee', avatarSeed: 'me-zz', onboardingCompleted: true });
  assert.equal(upd.body.profile.bio, 'Chai > coffee');
  assert.equal(upd.body.profile.avatarSeed, 'me-zz');
  assert.equal(upd.body.profile.pronouns, 'she/her'); // untouched preference keys survive
  assert.equal(upd.body.onboarded, true);
  assert.equal(upd.body.session.hasProfile, true);
});

test('PATCH /me/preferences: notifications, quiet hours, radius, streak settings, radar opt-out', async (t) => {
  if (skip) return t.skip(skip);
  const { User } = require('../src/models');
  const u = await makeUser({ profile: profileDoc('Ravi'), availability: { status: 'now', until: new Date(Date.now() + 3600000) } });
  const r = await call('PATCH', '/v1/me/preferences', u.token, {
    notifications: { nearby: false, productUpdates: true, quietStart: '23:00' },
    radiusKm: 5,
    weeklyGoal: 3,
    dailyStreakOptIn: true,
    analyticsConsent: true,
    language: 'Hindi',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = r.body.prefs.notifications;
  assert.equal(n.nearby, false);
  assert.equal(n.productUpdates, true);
  assert.equal(n.quietStart, '23:00');
  assert.equal(n.quietEnd, '08:00');
  assert.equal(n.quietEnabled, true);
  assert.equal(r.body.prefs.radiusKm, 5);
  assert.equal(r.body.prefs.dailyStreakOptIn, true);
  assert.equal(r.body.prefs.analyticsConsent, true);
  assert.equal(r.body.prefs.language, 'Hindi');
  assert.equal((await User.findById(u.id).lean()).progress.weeklyGoal, 3);

  const off = await call('PATCH', '/v1/me/preferences', u.token, { notifications: { quietEnabled: false }, showOnRadar: false });
  assert.equal(off.body.prefs.notifications.quietEnabled, false);
  assert.equal(off.body.prefs.showOnRadar, false);
  assert.equal(off.body.availability.status, 'busy');

  const bad = await call('PATCH', '/v1/me/preferences', u.token, { radiusKm: 100 });
  assert.equal(bad.body.code, 'validation_failed');
});

test('PUT /me/availability: stores only a coarse cell + area, never coordinates', async (t) => {
  if (skip) return t.skip(skip);
  const { User } = require('../src/models');
  const geo = require('../src/lib/geo');
  const u = await makeUser({ profile: profileDoc('Meera') });
  const lat = 23.0371234;
  const lng = 72.5609876;
  const r = await call('PUT', '/v1/me/availability', u.token, { status: 'now', activities: ['chai'], lat, lng, area: 'Navrangpura' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'now');
  assert.deepEqual(r.body.activities, ['chai']);
  assert.equal(r.body.area, 'Navrangpura');
  const untilMs = new Date(r.body.until).getTime() - Date.now();
  assert.ok(untilMs > 1.9 * 3600000 && untilMs <= 2 * 3600000, 'now defaults to 2 hours');

  const stored = (await User.findById(u.id).lean()).availability;
  assert.equal(stored.coarseCell, geo.cellId(lat, lng));
  assert.equal(stored.coarseCell.length, 6);
  const raw = JSON.stringify(stored);
  assert.ok(!raw.includes('23.037') && !raw.includes('72.560'), 'precise coordinates must not be stored');

  const areaOnly = await makeUser({ profile: profileDoc('Kabir') });
  await call('PUT', '/v1/me/availability', areaOnly.token, { status: 'later', area: 'Bodakdev' });
  assert.equal((await User.findById(areaOnly.id).lean()).availability.coarseCell, geo.cellId(23.04, 72.507));

  const far = await call('PUT', '/v1/me/availability', u.token, { status: 'later', until: new Date(Date.now() + 30 * 3600000).toISOString() });
  assert.equal(far.status, 400);
  assert.equal(far.body.code, 'until_too_far');
});

test('GET /users/{id}/public-profile: public fields only; hidden or blocked → user_not_found', async (t) => {
  if (skip) return t.skip(skip);
  const { User, Block } = require('../src/models');
  const { Activity } = require('../src/models');
  const viewer = await makeUser({ profile: profileDoc('Viewer') });
  const target = await makeUser({ profile: profileDoc('Tanvi', { homeArea: 'Vastrapur', preferences: { avatarSeed: 'me-t1' } }) });
  const soon = { hostUserId: target.id, category: 'chai', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000), venueName: 'Secret Café' };
  await Activity.create([{ ...soon, title: 'Public chai' }, { ...soon, title: 'Circle only', visibility: 'circle', circleId: 'c-not-mine' }]);

  const ok = await call('GET', `/v1/users/${target.id}/public-profile`, viewer.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.id, target.id);
  assert.equal(ok.body.name, 'Tanvi');
  assert.equal(ok.body.area, 'Vastrapur');
  assert.equal(ok.body.avatarSeed, 'me-t1');
  assert.deepEqual(ok.body.verification, { phone: true });
  assert.ok(Array.isArray(ok.body.badges) && Array.isArray(ok.body.sharedCircleIds) && Array.isArray(ok.body.upcomingPlans));
  assert.equal(ok.body.phone, undefined);
  assert.equal(ok.body.upcomingPlans.length, 1, 'only plans the viewer may see');
  assert.equal(ok.body.upcomingPlans[0].title, 'Public chai');
  assert.equal(ok.body.upcomingPlans[0].venueName, null, 'venue stays private until accepted');

  await User.updateOne({ _id: target.id }, { $set: { 'profile.visibility': 'hidden' } });
  const hidden = await call('GET', `/v1/users/${target.id}/public-profile`, viewer.token);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.code, 'user_not_found');
  await User.updateOne({ _id: target.id }, { $set: { 'profile.visibility': 'discoverable' } });

  await Block.create({ blockerUserId: target.id, blockedUserId: viewer.id }); // they blocked me
  const blocked = await call('GET', `/v1/users/${target.id}/public-profile`, viewer.token);
  assert.equal(blocked.status, 404);
  assert.equal(blocked.body.code, 'user_not_found');
  await Block.deleteMany({});
  await Block.create({ blockerUserId: viewer.id, blockedUserId: target.id }); // I blocked them
  assert.equal((await call('GET', `/v1/users/${target.id}/public-profile`, viewer.token)).body.code, 'user_not_found');
});

test('notifications inbox, devices and media upload URL', async (t) => {
  if (skip) return t.skip(skip);
  const { Notification, DeviceToken } = require('../src/models');
  const u = await makeUser({ profile: profileDoc('Dev') });
  const docs = await Notification.create([
    { userId: u.id, type: 'join', title: 'one', data: { target: { screen: 'activity_detail', params: { id: 'a1' } } } },
    { userId: u.id, type: 'quest', title: 'two' },
  ]);
  const list = await call('GET', '/v1/notifications?limit=1', u.token);
  assert.equal(list.body.items.length, 1);
  assert.ok(list.body.nextCursor);
  const one = await call('POST', `/v1/notifications/${docs[0]._id}/read`, u.token, {});
  assert.deepEqual(one.body, { ok: true });
  assert.equal((await call('POST', '/v1/notifications/nope/read', u.token, {})).body.code, 'notification_not_found');
  const all = await call('POST', '/v1/notifications/read-all', u.token, {});
  assert.deepEqual(all.body, { updated: 1 });

  const token = 'f'.repeat(40);
  assert.deepEqual((await call('POST', '/v1/devices', u.token, { platform: 'android', token })).body, { ok: true });
  assert.equal(await DeviceToken.countDocuments({ token, userId: u.id }), 1);
  const other = await makeUser({ profile: profileDoc('Other') });
  await call('POST', '/v1/devices', other.token, { platform: 'ios', token }); // a token moves to the latest owner
  assert.equal((await DeviceToken.findOne({ token }).lean()).userId, other.id);
  assert.deepEqual((await call('DELETE', `/v1/devices/${token}`, other.token)).body, { ok: true });
  assert.equal(await DeviceToken.countDocuments({ token }), 0);

  const badKind = await call('POST', '/v1/media/upload-url', u.token, { kind: 'export', contentType: 'application/json', sizeBytes: 10 });
  assert.equal(badKind.body.code, 'validation_failed');
  const noS3 = await call('POST', '/v1/media/upload-url', u.token, { kind: 'avatar', contentType: 'image/jpeg', sizeBytes: 1000 });
  assert.equal(noS3.status, 503);
  assert.equal(noS3.body.code, 'media_not_configured');
  const exp = await call('POST', '/v1/me/data-export', u.token, {});
  assert.equal(exp.body.code, 'media_not_configured');
});

test('DELETE /me: deactivates, cancels hosted plans, leaves joined plans (counters kept), revokes sessions', async (t) => {
  if (skip) return t.skip(skip);
  const { User, Activity, Participant, Session } = require('../src/models');
  const tokens = require('../src/lib/tokens');
  const u = await makeUser({ profile: profileDoc('Leaving') });
  const host = await makeUser({ profile: profileDoc('Host') });
  const soon = { startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000), category: 'chai' };
  const [mine] = await Activity.create([{ ...soon, hostUserId: u.id, title: 'Mine' }]);
  const [theirs] = await Activity.create([{ ...soon, hostUserId: host.id, title: 'Theirs', capacity: 2, acceptedCount: 2, status: 'full' }]);
  await Participant.create([{ activityId: theirs._id, userId: u.id, state: 'accepted' }]);
  await tokens.createSession(u.id);
  assert.equal(await Session.countDocuments({ userId: u.id, revokedAt: null }), 1);

  const r = await call('DELETE', '/v1/me', u.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'deletion_pending');
  assert.ok(new Date(r.body.purgeAfter) > new Date(Date.now() + 29 * 86400000));

  const after = await User.findById(u.id).lean();
  assert.equal(after.status, 'deleted');
  assert.equal(after.profile.visibility, 'hidden');
  assert.equal((await Activity.findById(mine._id).lean()).status, 'cancelled');
  const t2 = await Activity.findById(theirs._id).lean();
  assert.equal(t2.acceptedCount, 1);
  assert.equal(t2.status, 'open');
  assert.equal((await Participant.findOne({ activityId: theirs._id, userId: u.id }).lean()).state, 'cancelled');
  assert.equal(await Session.countDocuments({ userId: u.id, revokedAt: null }), 0);
  assert.equal((await call('GET', '/v1/me', u.token)).body.code, 'account_deleted');
});

test('GET /cities lists every seeded city with areas; a saved home city drives bootstrap', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser();
  const r = await call('GET', '/v1/cities', u.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const names = r.body.items.map((c) => c.name);
  for (const c of ['Ahmedabad', 'Indore', 'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Kolkata', 'Chennai']) assert.ok(names.includes(c), `missing ${c}`);
  assert.deepEqual([...names].sort(), names, 'alphabetical');
  const indore = r.body.items.find((c) => c.name === 'Indore');
  assert.ok(indore.areas.some((a) => a.name === 'Vijay Nagar'));
  assert.ok(indore.center.lat > 22 && indore.center.lat < 23.2 && indore.center.lng > 75.5 && indore.center.lng < 76.2);
  assert.equal((await call('GET', '/v1/cities')).status, 401);

  const v = await makeUser({ profile: profileDoc('Riya', { homeCity: 'Indore', homeArea: 'Palasia' }) });
  const b = await call('GET', '/v1/me/bootstrap', v.token);
  assert.equal(b.body.city.name, 'Indore');
  assert.ok(b.body.city.areas.some((a) => a.name === 'Palasia'));
});
