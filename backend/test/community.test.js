'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser } = require('./helpers/fixtures');

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
  if (!skip) await clearCollections();
});

async function circleWith(owner, { visibility = 'public' } = {}) {
  const r = await call('POST', '/v1/circles', { token: owner.token, body: { name: 'Chai Club', visibility, area: 'Navrangpura', rules: ['Be kind'] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('circle create: owner role, member count, circle chat', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser('Owner');
  const c = await circleWith(owner);
  assert.equal(c.myRole, 'owner');
  assert.equal(c.members, 1);
  assert.deepEqual(c.memberSeeds, [owner.id]);
  const { Conversation, ConversationMember } = require('../src/models');
  const conv = await Conversation.findOne({ kind: 'circle', circleId: c.id }).lean();
  assert.ok(conv);
  assert.ok(await ConversationMember.exists({ conversationId: conv._id, userId: owner.id }));
  const detail = await call('GET', `/v1/circles/${c.id}`, { token: owner.token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.conversationId, conv._id);
  assert.deepEqual(detail.body.upcomingPlans, []);
});

test('owner/moderator removal rules', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser('Owner');
  const mod = await makeUser('Mod');
  const mem = await makeUser('Member');
  const mem2 = await makeUser('Member2');
  const c = await circleWith(owner);
  for (const u of [mod, mem, mem2]) assert.equal((await call('POST', `/v1/circles/${c.id}/members`, { token: u.token, body: {} })).status, 200);
  const { CircleMember, Circle } = require('../src/models');
  await CircleMember.updateOne({ circleId: c.id, userId: mod.id }, { $set: { role: 'moderator' } });
  assert.equal((await Circle.findById(c.id).lean()).memberCount, 4);

  // Members list: owner first, then moderators, then members.
  const list = await call('GET', `/v1/circles/${c.id}/members`, { token: mem.token });
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.items.map((x) => x.role),
    ['owner', 'moderator', 'member', 'member']
  );
  assert.equal(list.body.items[0].name, 'Owner');

  // A plain member can't remove anyone.
  let r = await call('DELETE', `/v1/circles/${c.id}/members/${mem2.id}`, { token: mem.token });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'owner_or_moderator_only');
  // A moderator can't remove the owner or another moderator…
  r = await call('DELETE', `/v1/circles/${c.id}/members/${owner.id}`, { token: mod.token });
  assert.equal(r.body.code, 'cannot_remove_role');
  // …but can remove a member.
  r = await call('DELETE', `/v1/circles/${c.id}/members/${mem2.id}`, { token: mod.token });
  assert.equal(r.status, 200);
  // The owner can remove a moderator.
  r = await call('DELETE', `/v1/circles/${c.id}/members/${mod.id}`, { token: owner.token });
  assert.equal(r.status, 200);
  r = await call('DELETE', `/v1/circles/${c.id}/members/${mod.id}`, { token: owner.token });
  assert.equal(r.body.code, 'member_not_found');
  assert.equal((await Circle.findById(c.id).lean()).memberCount, 2);

  // The owner can't leave without transferring.
  r = await call('DELETE', `/v1/circles/${c.id}/members/me`, { token: owner.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'owner_must_transfer');
  r = await call('DELETE', `/v1/circles/${c.id}/members/me`, { token: mem.token });
  assert.equal(r.status, 200);
  assert.equal((await Circle.findById(c.id).lean()).memberCount, 1);
});

test('private circles: hidden from non-members, invite-only, owner can add (with notification)', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser('Owner');
  const guest = await makeUser('Guest');
  const c = await circleWith(owner, { visibility: 'private' });
  assert.equal((await call('GET', `/v1/circles/${c.id}`, { token: guest.token })).body.code, 'circle_not_found');
  assert.equal((await call('POST', `/v1/circles/${c.id}/members`, { token: guest.token, body: {} })).body.code, 'invite_only');
  const add = await call('POST', `/v1/circles/${c.id}/members`, { token: owner.token, body: { userId: guest.id } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.members, 2);
  const { Notification } = require('../src/models');
  assert.ok(await Notification.exists({ userId: guest.id, title: /added to Chai Club/ }));
  const seen = await call('GET', `/v1/circles/${c.id}`, { token: guest.token });
  assert.equal(seen.body.myRole, 'member');
  const joined = await call('GET', '/v1/circles?scope=joined', { token: guest.token });
  assert.deepEqual(
    joined.body.items.map((x) => x.id),
    [c.id]
  );
});

test('circle plans: created via the activities module; circle-only plans visible to members only', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser('Owner');
  const member = await makeUser('Member');
  const outsider = await makeUser('Outsider');
  const { Category } = require('../src/models');
  await Category.create({ slug: 'chai', label: 'Chai & coffee', short: 'Chai', pictogram: 'chai', isActive: true });
  const c = await circleWith(owner);
  await call('POST', `/v1/circles/${c.id}/members`, { token: member.token, body: {} });
  const body = { title: 'Circle chai', category: 'chai', startsAt: new Date(Date.now() + 2 * 3600000).toISOString(), durationMin: 60, area: 'Navrangpura', venueName: 'Cafe Lucky', venueType: 'Public café' };
  const no = await call('POST', `/v1/circles/${c.id}/plans`, { token: outsider.token, body });
  assert.equal(no.body.code, 'not_circle_member');
  const r = await call('POST', `/v1/circles/${c.id}/plans`, { token: owner.token, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.circleId, c.id);
  assert.equal(r.body.visibility, 'circle');

  const seen = await call('GET', `/v1/circles/${c.id}`, { token: member.token });
  assert.deepEqual(seen.body.nextPlanIds, [r.body.id]);
  assert.deepEqual(
    seen.body.upcomingPlans.map((p) => p.id),
    [r.body.id]
  );
  assert.equal(seen.body.upcomingPlans[0].venueName, null, 'exact venue is only for accepted participants');
  const list = await call('GET', '/v1/circles?scope=joined', { token: member.token });
  assert.equal(list.body.items[0].upcomingPlans[0].id, r.body.id);
  // A non-member viewing the public circle doesn't see circle-only plans.
  const out = await call('GET', `/v1/circles/${c.id}`, { token: outsider.token });
  assert.deepEqual(out.body.nextPlanIds, []);
  assert.deepEqual(out.body.upcomingPlans, []);
});

test('blocked owner hides the circle; challenge join + contributors', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser('Owner');
  const other = await makeUser('Other');
  const c = await circleWith(owner);
  await call('POST', `/v1/circles/${c.id}/members`, { token: other.token, body: {} });
  const { CircleChallenge, ChallengeProgress } = require('../src/models');
  await CircleChallenge.create({ circleId: c.id, title: '20 meetups', targetCount: 20, xpReward: 50, startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 5 * 86400000) });
  const j = await call('POST', `/v1/circles/${c.id}/challenge/join`, { token: other.token });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  assert.equal(j.body.challenge.joined, true);
  assert.equal(j.body.challenge.goal, 20);
  await ChallengeProgress.updateOne({ userId: other.id }, { $set: { count: 3 } });
  const g = await call('GET', `/v1/circles/${c.id}/challenge`, { token: owner.token });
  assert.equal(g.body.challenge.progress, 3);
  assert.deepEqual(g.body.challenge.contributors, [{ userId: other.id, name: 'Other', count: 3 }]);

  await call('POST', '/v1/blocks', { token: other.token, body: { userId: owner.id } });
  assert.equal((await call('GET', `/v1/circles/${c.id}`, { token: other.token })).body.code, 'circle_not_found');
  const all = await call('GET', '/v1/circles', { token: other.token });
  assert.equal(all.body.items.length, 0);
});
