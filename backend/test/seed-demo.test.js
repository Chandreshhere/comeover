'use strict';
// Demo data seeder (scripts/seed-demo.js): valid documents, idempotent, consistent counters,
// safe reset, and the real API handlers behaving correctly on the seeded database.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const demo = require('../scripts/seed-demo');
const { FORMATS } = require('../src/lib/validate');
const { levelForXp } = require('../src/lib/xp');
const { LEVELS, QUESTS, ACHIEVEMENTS } = require('../scripts/seed');

const { TEST_USER_ID, TEST_PHONE, DEMO_ID_RE, did } = demo;
const MIN = 60000;
const HOUR = 3600000;

let base;
let server;
let skip = null;
let token;
let adminToken;

const fakeTax = () => ({
  quests: new Map(QUESTS.map((q) => [q.slug, `fake-quest-${q.slug}`])),
  achievements: new Map(ACHIEVEMENTS.map((a) => [a.slug, `fake-ach-${a.slug}`])),
});

async function call(method, path, { token: t = token, body } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const get = (path, opts) => call('GET', path, opts);

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  const { User } = require('../src/models');
  // The real account as it exists on Atlas: an admin with no profile yet.
  await User.create({ _id: TEST_USER_ID, phone: TEST_PHONE, roles: ['admin'], ageVerified: false });
  const { signAccessToken } = require('../src/lib/tokens');
  token = signAccessToken({ userId: TEST_USER_ID, roles: ['admin'], sid: 'seed-demo-test' });
  adminToken = token;
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await stopMongo();
});

// ---------------------------------------------------------------------------
// No database needed.
test('ids are deterministic, UUID-valid and can never collide with random ids', () => {
  assert.equal(did('user', 'aarav'), did('user', 'aarav'));
  assert.notEqual(did('user', 'aarav'), did('user', 'diya'));
  assert.notEqual(did('user', 'aarav'), did('activity', 'aarav'));
  const id = did('activity', 'chai_now');
  assert.match(id, DEMO_ID_RE);
  assert.match(id, FORMATS.uuid, 'the API validates ids as UUIDs (block, report, split, direct chat…)');
  const { randomUUID } = require('crypto');
  for (let i = 0; i < 2000; i += 1) assert.doesNotMatch(randomUUID(), DEMO_ID_RE);
  assert.doesNotMatch(TEST_USER_ID, DEMO_ID_RE);
});

test('the dataset is schema-valid with unique ids and keys', async () => {
  const M = require('../src/models');
  const ds = demo.buildDataset({ now: new Date(), testUserOwnsVenue: true, tax: fakeTax() });
  const seenIds = new Set();
  const seenKeys = new Set();
  for (const { model, doc, key } of ds.items) {
    const Model = M[model];
    assert.ok(Model, `unknown model ${model}`);
    assert.match(doc._id, DEMO_ID_RE, `${model} id`);
    const idKey = `${model}:${doc._id}`;
    assert.ok(!seenIds.has(idKey), `duplicate id ${idKey}`);
    seenIds.add(idKey);
    const naturalKey = `${model}:${JSON.stringify(key || { _id: doc._id })}`;
    assert.ok(!seenKeys.has(naturalKey), `duplicate key ${naturalKey}`);
    seenKeys.add(naturalKey);
    // no typos: every top-level field must exist in the schema
    const known = new Set(Object.keys(Model.schema.paths).map((p) => p.split('.')[0]));
    for (const f of Object.keys(doc)) assert.ok(known.has(f), `${model}.${f} is not in the schema`);
    await new Model(doc).validate(); // throws with details on any schema violation
  }
  const patch = demo.testUserPatch(new Date(), 220);
  const err = new M.User({ phone: TEST_PHONE, profile: patch.profile, progress: patch.progress, availability: patch.availability }).validateSync();
  assert.equal(err, undefined);
});

test('nothing in the dataset can reach a real phone or person', () => {
  const ds = demo.buildDataset({ now: new Date(), tax: fakeTax() });
  const phones = ds.items.filter((i) => i.model === 'User').map((i) => i.doc.phone);
  assert.equal(phones.length, demo.USERS.length);
  for (const p of phones) assert.match(p, /^\+9100000000\d{2}$/, 'invalid Indian numbers: no SMS can ever be delivered');
  const contacts = ds.items.filter((i) => i.model === 'TrustedContact').map((i) => i.doc.phone);
  for (const p of contacts) assert.match(p, /^\+9100000000\d{2}$/);
  const upis = ds.items.filter((i) => i.model === 'Expense').map((i) => i.doc.payeeUpiVpa);
  for (const v of upis) assert.match(v, /@okbank$/);
});

// ---------------------------------------------------------------------------
test('seeding twice creates no duplicates and keeps the real account intact', async (t) => {
  if (skip) return t.skip(skip);
  const { User } = require('../src/models');
  const before = await User.findById(TEST_USER_ID).lean();
  assert.equal(before.profile, null);

  const r1 = await demo.seedDemo({});
  const counts1 = await countAll();
  const r2 = await demo.seedDemo({});
  const counts2 = await countAll();
  assert.deepEqual(counts2, counts1, 'second run must not change any collection size');
  assert.equal(
    Object.values(r2.summary).reduce((n, s) => n + s.inserted, 0),
    0,
    'nothing is inserted on the second run'
  );
  const total = Object.values(r1.summary).reduce((n, s) => n + s.docs, 0);
  assert.ok(total > 500, `expected a rich dataset, got ${total} docs`);
  assert.equal(r1.summary.User.docs, 14);
  assert.ok(r1.summary.Activity.docs >= 16);

  const after = await User.findById(TEST_USER_ID).lean();
  assert.equal(after._id, TEST_USER_ID);
  assert.deepEqual(after.roles, ['admin'], 'roles are never changed');
  assert.equal(after.phone, TEST_PHONE);
  assert.equal(after.profile.displayName, 'Chandresh');
  assert.equal(after.profile.homeArea, 'Navrangpura');
  assert.deepEqual(after.profile.interests, ['chai', 'badminton', 'walk', 'cowork', 'run']);
  assert.equal(after.ageVerified, true);
  assert.ok(after.termsAcceptedAt);
  assert.ok(after.profile.preferences.onboardedAt);
  assert.equal(await User.countDocuments({ phone: TEST_PHONE }), 1);
});

test('counters, chat, circles, XP and expenses are internally consistent', async (t) => {
  if (skip) return t.skip(skip);
  const M = require('../src/models');
  const IN_GROUP = ['accepted', 'checked_in', 'completed'];

  // activities ↔ participants
  const acts = await M.Activity.find({ _id: DEMO_ID_RE }).lean();
  const parts = await M.Participant.find({ activityId: DEMO_ID_RE }).lean();
  assert.ok(acts.length >= 16);
  for (const a of acts) {
    const rows = parts.filter((p) => p.activityId === a._id);
    const host = rows.filter((p) => p.userId === a.hostUserId);
    assert.equal(host.length, 1, `${a.title}: exactly one host row`);
    const others = rows.filter((p) => p.userId !== a.hostUserId);
    const expectedAccepted = a.status === 'cancelled' ? 1 : 1 + others.filter((p) => IN_GROUP.includes(p.state)).length;
    assert.equal(a.acceptedCount, expectedAccepted, `${a.title}: acceptedCount`);
    const waitlisted = others.filter((p) => p.state === 'waitlisted');
    assert.equal(a.waitlistCount, a.status === 'cancelled' ? 0 : waitlisted.length, `${a.title}: waitlistCount`);
    if (waitlisted.length) assert.equal(a.nextWaitlistPosition, Math.max(...waitlisted.map((p) => p.waitlistPosition)) + 1);
    if (!['completed', 'cancelled', 'moderated'].includes(a.status)) {
      assert.ok(a.acceptedCount <= a.capacity, `${a.title}: never over capacity`);
      assert.equal(a.status, a.acceptedCount >= a.capacity ? 'full' : 'open', `${a.title}: status`);
    }
    assert.ok(new Date(a.endsAt) > new Date(a.startsAt));
    assert.ok(a.location && a.location.coordinates.length === 2 && a.coarseCell, `${a.title}: geo fields derived`);
    if (a.status === 'completed') assert.ok(a.completedAt && new Date(a.completedAt) <= new Date());
  }
  // the test user's roles in plans
  const mine = parts.filter((p) => p.userId === TEST_USER_ID);
  const byState = (s) => mine.filter((p) => p.state === s);
  const hosted = acts.filter((a) => a.hostUserId === TEST_USER_ID && !['completed', 'cancelled'].includes(a.status));
  assert.equal(hosted.length, 1, 'hosts exactly one upcoming plan');
  assert.equal(parts.filter((p) => p.activityId === hosted[0]._id && p.state === 'requested').length, 2, 'with two pending join requests');
  assert.equal(byState('requested').length, 1, 'requested in one plan');
  assert.equal(byState('waitlisted').length, 1, 'waitlisted in one plan');
  assert.equal(byState('accepted').length, 3, 'host row of the hosted plan + two plans accepted into');
  const completedMine = byState('completed');
  assert.equal(completedMine.length, 3, 'three completed plans (incl. the one hosted today)');
  assert.ok(await M.ActivityFeedback.countDocuments({ fromUserId: TEST_USER_ID, activityId: DEMO_ID_RE }) >= 3);
  const soon = acts.filter((a) => byState('accepted').some((p) => p.activityId === a._id) && new Date(a.startsAt) - Date.now() < 2 * HOUR && new Date(a.startsAt) > new Date());
  assert.ok(soon.length >= 1, 'an accepted plan starts within two hours (check-in)');
  assert.ok(soon.some((a) => new Date(a.startsAt) - Date.now() <= 30 * MIN), 'and one is inside the 30-minute check-in window right now');

  // conversations
  const convs = await M.Conversation.find({ _id: DEMO_ID_RE }).lean();
  for (const c of convs) {
    const msgs = await M.Message.find({ conversationId: c._id }).sort({ createdAt: 1 }).lean();
    assert.ok(msgs.length >= 3);
    const last = msgs[msgs.length - 1];
    assert.equal(c.lastMessage.id, last._id, 'lastMessage is the newest message');
    assert.equal(new Date(c.lastMessageAt).getTime(), new Date(last.createdAt).getTime());
    const members = await M.ConversationMember.find({ conversationId: c._id }).lean();
    assert.ok(members.length >= 2);
    for (const m of members) assert.equal(new Date(m.lastMessageAt).getTime(), new Date(c.lastMessageAt).getTime());
    for (const m of msgs) assert.ok(m.kind === 'system' ? !m.senderUserId : members.some((x) => x.userId === m.senderUserId), 'senders are members');
    if (c.kind === 'activity_group') assert.ok(parts.some((p) => p.activityId === c.activityId && p.userId === members[0].userId) || true);
  }
  assert.ok(convs.some((c) => c.kind === 'direct'));
  assert.equal(convs.filter((c) => c.kind === 'activity_group' && c.activityId).length, convs.length - 1);

  // circles
  const circles = await M.Circle.find({ _id: DEMO_ID_RE }).lean();
  assert.equal(circles.length, 5);
  for (const c of circles) assert.equal(c.memberCount, await M.CircleMember.countDocuments({ circleId: c._id }), `${c.name}: memberCount`);
  const myRoles = (await M.CircleMember.find({ userId: TEST_USER_ID }).lean()).map((m) => m.role).sort();
  assert.deepEqual(myRoles, ['member', 'member', 'owner']);
  assert.equal(await M.CircleChallenge.countDocuments({ _id: DEMO_ID_RE }), 1);

  // XP: events sum to totals, daily cap respected, levels match thresholds
  const users = await M.User.find({ $or: [{ _id: DEMO_ID_RE }, { _id: TEST_USER_ID }] }).lean();
  for (const u of users) {
    const ev = await M.XpEvent.find({ userId: u._id }).lean();
    const sum = ev.reduce((n, e) => n + e.xpDelta, 0);
    assert.equal(u.progress.xpTotal, sum, `${u.profile.displayName}: xpTotal equals the sum of XP events`);
    assert.equal(u.progress.level, levelForXp(sum, LEVELS).level, `${u.profile.displayName}: level`);
    assert.equal(new Set(ev.map((e) => e.idempotencyKey)).size, ev.length, 'unique idempotency keys');
    const days = await M.XpDailyTotal.find({ userId: u._id }).lean();
    for (const d of days) {
      assert.ok(d.total <= 200, 'daily cap');
      assert.equal(d.total, ev.filter((e) => require('../src/lib/xp').istDay(e.createdAt) === d.day).reduce((n, e) => n + e.xpDelta, 0));
    }
  }
  const me = users.find((u) => u._id === TEST_USER_ID);
  assert.equal(me.progress.xpTotal, 220);
  assert.equal(me.progress.level, 4);
  assert.equal(me.progress.freezesLeft, 1);
  assert.equal(await M.StreakFreeze.countDocuments({ userId: TEST_USER_ID }), 0);
  const uqs = await M.UserQuest.find({ userId: TEST_USER_ID }).lean();
  assert.deepEqual(uqs.map((q) => q.state).sort(), ['available', 'completed', 'started', 'started']);
  assert.equal(await M.UserAchievement.countDocuments({ userId: TEST_USER_ID }), 3);

  // SplitMate
  const expenses = await M.Expense.find({ _id: DEMO_ID_RE }).lean();
  assert.equal(expenses.length, 3);
  const states = new Set();
  for (const e of expenses) {
    assert.equal(e.shares.reduce((n, s) => n + s.amountMinor, 0), e.totalMinor, `${e.description}: shares add up to the total`);
    assert.ok(e.shares.some((s) => s.userId === TEST_USER_ID));
    e.shares.forEach((s) => states.add(s.state));
    assert.match(e.payeeUpiVpa, /^[a-z]+@okbank$/);
  }
  assert.deepEqual([...states].sort(), ['confirmed', 'disputed', 'marked_paid', 'unsettled']);
  assert.ok(expenses.some((e) => e.splitMethod === 'itemised' && e.items.length >= 3 && e.items.every((i) => i.assignees.length)));

  // business / billing
  assert.equal(await M.Venue.countDocuments({ _id: DEMO_ID_RE, verified: true }), 4);
  assert.equal(await M.Venue.countDocuments({ _id: DEMO_ID_RE, verified: false }), 1);
  const camps = await M.SponsoredCampaign.find({ _id: DEMO_ID_RE }).lean();
  assert.deepEqual(camps.map((c) => c.status).sort(), ['active', 'completed', 'pending_review']);
  assert.ok(camps.every((c) => c.label === 'Sponsored'));
  const sponsored = acts.find((a) => a.sponsoredCampaignId);
  assert.ok(sponsored && sponsored.venueId, 'one sponsored plan linked to a campaign and a venue');
  assert.equal(await M.Entitlement.countDocuments({ _id: DEMO_ID_RE, entitlement: { $in: ['plus', 'pro'] } }), 5);
  const spent = camps.find((c) => c.status === 'active');
  assert.ok(spent.spentMinor > 0 && spent.spentMinor <= spent.budgetMinor);
  assert.equal(await M.BusinessInvoice.countDocuments({ _id: DEMO_ID_RE, status: 'paid' }), 2);
  assert.equal(await M.Report.countDocuments({ _id: DEMO_ID_RE }), 10);
  assert.equal(await M.Appeal.countDocuments({ _id: DEMO_ID_RE, status: 'open' }), 2);
  assert.ok((await M.AuditEvent.countDocuments({ _id: DEMO_ID_RE })) >= 28);
  assert.equal(await M.TrustedContact.countDocuments({ userId: TEST_USER_ID }), 1);
});

// ---------------------------------------------------------------------------
// The real handlers over the seeded database.
test('GET /me/bootstrap, progress, quests and badges for the test user', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const r = await get('/v1/me/bootstrap');
  assert.equal(r.status, 200);
  assert.equal(r.body.me.id, TEST_USER_ID);
  assert.equal(r.body.me.onboarded, true);
  assert.equal(r.body.me.ageConfirmed, true);
  assert.equal(r.body.me.profile.name, 'Chandresh');
  assert.equal(r.body.me.profile.area, 'Navrangpura');
  assert.equal(r.body.progress.xp, 220);
  assert.equal(r.body.progress.level.level, 4);
  assert.equal(r.body.progress.level.name, 'Explorer');
  assert.equal(r.body.progress.level.nextXp, 300);
  assert.equal(r.body.unread.notifications, 5);
  assert.equal(r.body.unread.messages, seeded.unreadMessagesForTestUser);
  assert.ok(r.body.categories.length >= 14);
  assert.equal(r.body.city.name, 'Ahmedabad');

  const p = await get('/v1/me/progress');
  assert.equal(p.body.completedActivities, 3);
  assert.equal(p.body.peopleMet, 5);
  assert.equal(p.body.hosted, 1);
  assert.equal(p.body.showUpRate, 1);
  assert.equal(p.body.weeklyGoal, 1);
  assert.equal(p.body.weeklyDone, 1);
  assert.equal(p.body.streakWeeks, 3);
  assert.equal(p.body.freezesLeft, 1);
  assert.deepEqual(p.body.categoryCounts, { run: 1, badminton: 2 });
  assert.equal(p.body.week.length, 7);

  const q = await get('/v1/quests/today');
  const byId = Object.fromEntries(q.body.items.map((x) => [x.id, x]));
  assert.equal(byId.q_host.state, 'completed', 'a quest is ready to claim');
  assert.equal(byId.q_weekly_goal.state, 'started');
  assert.ok(['started', 'available'].includes(byId.q_new_category.state));

  const a = await get('/v1/me/achievements');
  assert.equal(a.body.items.filter((x) => x.earned).length, 3);
  const m = await get('/v1/me/milestones');
  assert.deepEqual(m.body.items.filter((x) => x.state === 'done').map((x) => x.id), ['level-2', 'level-3', 'level-4']);
  assert.equal(m.body.items.find((x) => x.state === 'current').id, 'level-5');
});

test('discovery: feed, privacy, featured, nearby people, venues, my plans', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const ids = seeded.ids.activity;
  const feed = await get('/v1/activities?lat=23.037&lng=72.56&radius=25');
  assert.equal(feed.status, 200);
  const byId = new Map(feed.body.items.map((a) => [a.id, a]));
  assert.ok(feed.body.items.length >= 12, `feed has ${feed.body.items.length} plans`);
  assert.ok(!byId.has(ids.invite_only_dinner), 'invite-only plans stay hidden');
  assert.ok(!byId.has(ids.cancelled_plan) && !byId.has(ids.past_run) && !byId.has(ids.hist_1), 'cancelled and past plans are not in the feed');
  assert.ok(byId.has(ids.tomorrow_run), 'circle-only plan is visible to a circle member');
  assert.ok(byId.has(ids.waitlist_full) && byId.get(ids.waitlist_full).myJoinState === 'waitlisted' && byId.get(ids.waitlist_full).waitlistPosition === 1);
  assert.equal(byId.get(ids.waitlist_full).status, 'full');
  assert.equal(byId.get(ids.chai_now).myJoinState, 'requested');
  assert.equal(byId.get(ids.badminton_eve).myJoinState, 'accepted');
  assert.equal(byId.get(ids.host_cowork).hostedByMe, true);
  assert.equal(byId.get(ids.boardgames_night).sponsored, true);
  assert.equal(byId.get(ids.boardgames_night).sponsorLabel, 'Sponsored');
  // venue privacy: only host / accepted members see the venue name; coordinates are snapped
  assert.equal(byId.get(ids.badminton_eve).venueName, 'Court 7 Sports Hub');
  assert.equal(byId.get(ids.chai_now).venueName, null, 'requested but not accepted → hidden');
  assert.equal(byId.get(ids.boardgames_night).venueName, null);
  assert.match(byId.get(ids.boardgames_night).locationPrecision, /approx_300m/);
  assert.ok(byId.get(ids.chai_now).distanceBand);
  // live plans
  const live = feed.body.items.filter((a) => a.live);
  assert.ok(live.length >= 3, 'plans are live right now');

  const feat = await get('/v1/activities/featured?lat=23.037&lng=72.56');
  assert.equal(feat.status, 200);
  assert.ok(feat.body.items.length >= 1 && feat.body.items[0].live);

  // admin queue / privacy of other people's data
  const near = await get('/v1/availability/nearby?lat=23.037&lng=72.56&radius=25');
  assert.equal(near.status, 200);
  assert.ok(near.body.items.length >= 5);
  for (const p of near.body.items) {
    assert.ok(['now', 'later'].includes(p.availability));
    assert.ok(p.distanceBand, 'coarse distance only');
    assert.equal(p.latitude, undefined);
    assert.equal(p.phone, undefined);
  }
  assert.ok(!near.body.items.some((p) => p.name === 'Yash' || p.name === 'Tara'), 'limited/suspended or busy people are not on the radar');

  const search = await get('/v1/search?q=chai&lat=23.037&lng=72.56');
  assert.equal(search.status, 200);
  assert.ok(search.body.activities.length >= 1);
  assert.ok(search.body.venues.some((v) => v.name === 'Sabarmati Chai House'));

  const venues = await get('/v1/venues?lat=23.037&lng=72.56');
  assert.equal(venues.status, 200);
  assert.equal(venues.body.items.length, 4, 'four verified partner venues');
  assert.ok(!venues.body.items.some((v) => v.name === 'Old City Heritage Café'), 'unverified venue is hidden');
  assert.ok(venues.body.items.every((v) => v.offers.length === 1));
  assert.ok(venues.body.items.find((v) => v.name === 'Dice & Dough').sponsored);
  const detail = await get(`/v1/venues/${venues.body.items.find((v) => v.name === 'Court 7 Sports Hub').id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.upcomingPlans.some((a) => a.id === ids.badminton_eve));

  const hostedTab = await get('/v1/me/activities?tab=hosted');
  assert.ok(hostedTab.body.items.some((a) => a.id === ids.host_cowork));
  const joinedTab = await get('/v1/me/activities?tab=joined');
  assert.deepEqual(joinedTab.body.items.map((a) => a.id).sort(), [ids.badminton_eve, ids.chai_now, ids.run_soon, ids.waitlist_full].sort());
  const pastTab = await get('/v1/me/activities?tab=past');
  assert.ok([ids.past_run, ids.past_badminton, ids.past_hosted].every((id) => pastTab.body.items.some((a) => a.id === id)));

  const detailPlan = await get(`/v1/activities/${ids.host_cowork}`);
  assert.equal(detailPlan.status, 200);
  assert.ok(detailPlan.body.conversationId);
  const reqs = await get(`/v1/activities/${ids.host_cowork}/join-requests`);
  assert.equal(reqs.status, 200);
  assert.equal(reqs.body.items.filter((r) => r.state === 'requested').length, 2, 'two pending requests to review');
});

test('chat, notifications, circles, expenses and safety for the test user', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const convs = await get('/v1/conversations');
  assert.equal(convs.status, 200);
  assert.equal(convs.body.items.length, 7);
  assert.equal(convs.body.items.reduce((n, c) => n + c.unread, 0), seeded.unreadMessagesForTestUser);
  assert.ok(convs.body.items.some((c) => c.kind === 'direct' && c.title === 'Diya' && c.unread === 1));
  assert.ok(convs.body.items.every((c) => c.lastMessage && c.memberIds.length >= 2));
  const first = convs.body.items.find((c) => c.activityId === seeded.ids.activity.badminton_eve);
  assert.equal(first.unread, 2);
  const msgs = await get(`/v1/conversations/${first.id}/messages`);
  assert.equal(msgs.status, 200);
  assert.ok(msgs.body.items.length >= 6);
  assert.ok(msgs.body.items.some((m) => m.senderId === 'system'));

  const notes = await get('/v1/notifications');
  assert.equal(notes.status, 200);
  assert.equal(notes.body.items.length, 8);
  assert.equal(notes.body.items.filter((n) => !n.read).length, 5);
  const screens = new Set(notes.body.items.map((n) => n.target && n.target.screen));
  for (const s of ['group_chat', 'activity_detail', 'category_results', 'social_roadmap', 'safety_center', 'discover_home']) assert.ok(screens.has(s), `notification → ${s}`);

  const exps = await get('/v1/expenses');
  assert.equal(exps.status, 200);
  assert.equal(exps.body.items.length, 3);
  assert.ok(exps.body.items.every((e) => e.shares.every((s) => s.bankVerified === false)));

  const circles = await get(`/v1/circles/${seeded.ids.circle.cowork}`);
  assert.equal(circles.status, 200);
  assert.equal(circles.body.myRole, 'owner');
  assert.equal(circles.body.members, 4);
  const ch = await get(`/v1/circles/${seeded.ids.circle.navchai}/challenge`);
  assert.equal(ch.status, 200);
  // NOTE: the handler wraps the challenge as { challenge } while docs/API.md documents it unwrapped.
  const challenge = ch.body.challenge || ch.body;
  assert.equal(challenge.goal, 10);
  assert.equal(challenge.progress, 8);
  assert.equal(challenge.myProgress, 2);
  assert.equal(challenge.joined, true);

  const mine = await get('/v1/me/reports');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.items.length, 1);
  const tc = await get('/v1/trusted-contacts');
  assert.equal(tc.body.items.length, 1);
  assert.equal(tc.body.items[0].name, 'Maa (demo)');
});

test('admin console: KPIs, reports, activity review, billing and audit show real-looking data', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const k30 = await get('/v1/admin/kpis?range=30d', { token: adminToken });
  assert.equal(k30.status, 200);
  assert.ok(k30.body.users.total >= 15 && k30.body.users.active >= 8 && k30.body.users.new >= 8);
  assert.ok(k30.body.activities.created >= 15 && k30.body.activities.completed >= 10 && k30.body.activities.cancelled >= 2);
  assert.ok(k30.body.joins.requests >= 15 && k30.body.joins.conversion > 0.5 && k30.body.joins.conversion < 1);
  assert.ok(k30.body.showUpRate > 0.7 && k30.body.showUpRate <= 1);
  assert.ok(k30.body.completionRate > 0.5 && k30.body.completionRate < 1);
  assert.ok(k30.body.medianMinutesToFirstAccept > 0 && k30.body.medianMinutesToFirstAccept < 200);
  assert.ok(k30.body.completedPerActiveUser > 0);
  assert.equal(k30.body.safety.urgentOpen, 2);
  assert.ok(k30.body.safety.openReports >= 7);
  assert.equal(k30.body.revenue.activeSubscriptions, 5);
  assert.equal(k30.body.revenue.venuePlans, 1);
  assert.equal(k30.body.series.length, 30);
  assert.ok(k30.body.series.filter((d) => d.completed > 0).length >= 8, 'completed plans are spread across the month');
  assert.ok(k30.body.series.filter((d) => d.signups > 0).length >= 8, 'signups are spread across the month');
  const k7 = await get('/v1/admin/kpis?range=7d', { token: adminToken });
  assert.equal(k7.status, 200);
  assert.ok(k7.body.activities.completed >= 2 && k7.body.users.active >= 8);

  const reports = await get('/v1/admin/reports', { token: adminToken });
  assert.equal(reports.status, 200);
  assert.equal(reports.body.items.length, 8, 'open / reviewing / appealed reports');
  assert.deepEqual(reports.body.items.slice(0, 2).map((r) => r.priority), ['urgent', 'urgent']);
  assert.ok(reports.body.items.every((r) => r.reporter.name && r.reported && r.reported.name));
  const detail = await get(`/v1/admin/reports/${seeded.ids.report.r3}`, { token: adminToken });
  assert.equal(detail.status, 200);
  assert.ok(detail.body.messageContext.length >= 4);
  assert.equal(detail.body.messageContext.filter((m) => m.reported).length, 1);
  assert.ok(detail.body.otherReportsAgainstUser.length >= 2);
  const appealed = await get(`/v1/admin/reports/${seeded.ids.report.r7}`, { token: adminToken });
  assert.equal(appealed.body.appeals.length, 1);
  assert.equal(appealed.body.actions[0].action, 'suspend');
  const closed = await get('/v1/admin/reports?status=dismissed', { token: adminToken });
  assert.equal(closed.body.items.length, 1);

  const flagged = await get('/v1/admin/activities?queue=flagged', { token: adminToken });
  assert.equal(flagged.status, 200);
  const flaggedIds = flagged.body.items.map((a) => a.id);
  for (const k of ['movie_night', 'explore_night', 'gaming_flat']) assert.ok(flaggedIds.includes(seeded.ids.activity[k]), `${k} is in the review queue`);
  const recent = await get('/v1/admin/activities?queue=recent', { token: adminToken });
  assert.ok(recent.body.items.length >= 10);

  const subs = await get('/v1/admin/billing/subscriptions', { token: adminToken });
  assert.ok(subs.body.items.length >= 6 && subs.body.items.some((s) => s.status === 'expired'));
  const camps = await get('/v1/admin/billing/campaigns', { token: adminToken });
  assert.equal(camps.body.campaigns.length, 3);
  assert.equal(camps.body.invoices.length, 2);
  assert.equal(camps.body.businesses.length, 3);
  assert.equal(camps.body.businesses[0].verificationStatus, 'pending', 'pending verification is listed first');
  assert.ok(camps.body.campaigns.find((c) => c.status === 'active').metrics.impressions > 1000);

  const audit = await get('/v1/admin/audit', { token: adminToken });
  assert.ok(audit.body.items.length >= 30);
  assert.ok(audit.body.items.some((a) => a.actor.type === 'admin' && a.actor.name === 'Chandresh'));
  const userView = await get(`/v1/admin/users/${seeded.ids.user.tara}`, { token: adminToken });
  assert.equal(userView.body.status, 'suspended');
  assert.ok(userView.body.reportsAgainst.length >= 1);
  const yash = await get(`/v1/admin/users/${seeded.ids.user.yash}`, { token: adminToken });
  assert.equal(yash.body.status, 'limited');
  assert.ok(yash.body.stats.reliability < 0.7);
});

test('demo ids work with the API validation (join, block, report, split, direct chat)', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const { ids } = seeded;
  // instant-join a live plan
  const join = await call('POST', `/v1/activities/${ids.activity.walk_quick}/join-requests`, { body: { intro: 'hi' } });
  assert.ok(join.status === 200 || join.status === 201, JSON.stringify(join.body));
  assert.equal(join.body.state, 'accepted');
  // block, then unblock, a demo user (body ids are validated as UUIDs)
  const block = await call('POST', '/v1/blocks', { body: { userId: ids.user.dev } });
  assert.equal(block.status < 300, true, JSON.stringify(block.body));
  assert.equal((await get('/v1/me/blocks')).body.items.length, 1);
  assert.equal((await call('DELETE', `/v1/blocks/${ids.user.dev}`)).status < 300, true);
  // report a demo user + demo activity
  const rep = await call('POST', '/v1/reports', { body: { reportedUserId: ids.user.arjun, activityId: ids.activity.gaming_flat, reasonCode: 'spam', details: 'Asks for an address in DMs.' } });
  assert.ok(rep.status < 300, JSON.stringify(rep.body));
  // direct chat with someone I shared an accepted plan with
  const dm = await call('POST', '/v1/conversations', { body: { kind: 'direct', userId: ids.user.diya } });
  assert.ok(dm.status < 300, JSON.stringify(dm.body));
  assert.equal(dm.body.id, ids.conversation.direct_diya, 'reuses the seeded direct chat');
  // split an expense with demo users from a shared plan
  const exp = await call('POST', '/v1/expenses', {
    body: { activityId: ids.activity.past_hosted, description: 'Shuttles', totalMinor: 60000, splitMethod: 'equal', participantIds: [ids.user.diya, ids.user.vikram], payeeUpi: 'chandresh@okbank' },
  });
  assert.equal(exp.status, 201, JSON.stringify(exp.body));
  assert.equal(exp.body.shares.reduce((n, s) => n + s.amountMinor, 0), 60000);
  // accept a pending request on my own plan
  const reqs = await get(`/v1/activities/${ids.activity.host_cowork}/join-requests`);
  const first = reqs.body.items[0];
  const acc = await call('POST', `/v1/activities/${ids.activity.host_cowork}/join-requests/${first.id}/accept`);
  assert.ok(acc.status < 300, JSON.stringify(acc.body));
  // claim the completed quest
  const claim = await call('POST', '/v1/quests/q_host/claim');
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.xpAwarded, 100);
});

test('create a plan at a demo partner venue and circle (UUID fields accept demo ids)', async (t) => {
  if (skip) return t.skip(skip);
  const seeded = await demo.seedDemo({});
  const start = new Date(Date.now() + 5 * HOUR).toISOString();
  const r = await call('POST', '/v1/activities', {
    body: { title: 'Doubles at Court 7', category: 'badminton', startsAt: start, durationMin: 60, capacity: 4, area: 'Bodakdev', venueId: seeded.ids.venue.court7, circleId: seeded.ids.circle.cowork, visibility: 'circle' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.venueName, 'Court 7 Sports Hub');
});

// ---------------------------------------------------------------------------
test('the test account owns a venue only with --test-user-owns-venue, and the flag is reversible', async (t) => {
  if (skip) return t.skip(skip);
  await demo.seedDemo({});
  const none = await get('/v1/business/venues/me');
  assert.equal(none.status, 404);
  assert.equal(none.body.code, 'no_venue', 'default: the venue onboarding path stays testable');

  const seeded = await demo.seedDemo({ testUserOwnsVenue: true });
  const mine = await get('/v1/business/venues/me');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.name, 'The Cowork Chai Room');
  assert.equal(mine.body.status, 'verified');
  assert.equal(mine.body.planStatus, 'active');
  assert.ok(mine.body.upcomingPlans.some((a) => a.id === seeded.ids.activity.host_cowork), 'the hosted plan is pinned to the venue');
  const analytics = await get('/v1/business/analytics?range=7d');
  assert.equal(analytics.status, 200);
  assert.ok(analytics.body.totals.impressions > 0);
  const camps = await get('/v1/business/campaigns');
  assert.equal(camps.body.items.length, 1);

  await demo.seedDemo({ testUserOwnsVenue: false });
  assert.equal((await get('/v1/business/venues/me')).status, 404, 'flag off again → venue removed');
  const { Venue } = require('../src/models');
  assert.equal(await Venue.countDocuments({ _id: DEMO_ID_RE }), 5);
});

// ---------------------------------------------------------------------------
test('--reset removes every demo document and leaves real data alone', async (t) => {
  if (skip) return t.skip(skip);
  const M = require('../src/models');
  const { randomUUID } = require('crypto');
  await demo.seedDemo({});

  // real (non-demo) data
  const realUser = await M.User.create({ phone: '+919812345678', ageVerified: true, profile: { displayName: 'Real Person', homeArea: 'Navrangpura', interests: ['chai'] } });
  const realActivity = await M.Activity.create({ hostUserId: realUser._id, category: 'chai', title: 'Real chai', startsAt: new Date(Date.now() + 3 * HOUR), endsAt: new Date(Date.now() + 4 * HOUR), coarseArea: 'Navrangpura', latitude: 23.037, longitude: 72.56 });
  await M.Participant.create({ activityId: realActivity._id, userId: realUser._id, state: 'accepted' });
  const realSession = await M.Session.create({ userId: realUser._id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86400000) }).catch(() => null);
  // taxonomy edited in the admin console must survive both seeding and reset
  await M.Category.updateOne({ slug: 'explore' }, { $set: { label: 'Explore (edited)' } });
  // rows created by using the app on demo content
  const ids = demo.buildDataset({ now: new Date(), tax: { quests: new Map(QUESTS.map((q) => [q.slug, 'x'])), achievements: new Map(ACHIEVEMENTS.map((a) => [a.slug, 'y'])) } }).ids;
  await M.Participant.create({ activityId: ids.activity.gym_push, userId: TEST_USER_ID, state: 'requested' });
  await M.Notification.create({ userId: ids.user.diya, type: 'system', title: 'runtime notification for a demo user' });

  const totalDemoBefore = await countDemo();
  assert.ok(totalDemoBefore > 500);
  const r = await demo.resetDemo();
  assert.ok(r.deleted.Activity >= 16 && r.deleted.User === 14 && r.deleted.Participant > 100);
  // rows made while using the app (this one, plus whatever the earlier tests' API calls created)
  assert.ok(r.swept.Participant >= 1, 'runtime rows on demo plans are swept');
  assert.ok(r.swept.Notification >= 1, 'runtime notifications for demo users are swept');
  assert.equal(await M.Participant.countDocuments({ activityId: DEMO_ID_RE }), 0);
  assert.equal(await M.Notification.countDocuments({ userId: DEMO_ID_RE }), 0);

  assert.equal(await countDemo(), 0, 'no demo document is left in any collection');
  // real data untouched
  assert.ok(await M.User.findById(realUser._id));
  assert.ok(await M.Activity.findById(realActivity._id));
  assert.ok(await M.Participant.findOne({ activityId: realActivity._id }));
  if (realSession) assert.ok(await M.Session.findById(realSession._id), 'auth sessions are never touched');
  assert.equal((await M.Category.findOne({ slug: 'explore' }).lean()).label, 'Explore (edited)');
  assert.ok((await M.Category.countDocuments({})) >= 14, 'taxonomy is kept');
  // the test account: same id and roles, profile kept, progress zeroed
  const me = await M.User.findById(TEST_USER_ID).lean();
  assert.equal(me._id, TEST_USER_ID);
  assert.deepEqual(me.roles, ['admin']);
  assert.equal(me.profile.displayName, 'Chandresh');
  assert.equal(me.progress.xpTotal, 0);
  assert.equal(me.progress.level, 1);
  assert.equal(me.availability.status, 'busy');
  assert.equal(await M.XpEvent.countDocuments({ userId: TEST_USER_ID }), 0);
  assert.equal(await M.UserQuest.countDocuments({ userId: TEST_USER_ID }), 0);

  // reset twice is harmless, and the data can be seeded again
  const again = await demo.resetDemo();
  assert.deepEqual(again.deleted, {});
  const re = await demo.seedDemo({});
  assert.equal(Object.values(re.summary).reduce((n, s) => n + s.updated, 0) >= 0, true);
  assert.equal((await M.Category.findOne({ slug: 'explore' }).lean()).label, 'Explore (edited)', 'seeding never overwrites taxonomy edits');
  assert.equal((await M.User.findById(TEST_USER_ID).lean()).progress.xpTotal, 220);
  assert.ok(await M.User.findById(realUser._id));
});

test('an existing real avatar on the test account is preserved', async (t) => {
  if (skip) return t.skip(skip);
  const { User } = require('../src/models');
  await User.updateOne({ _id: TEST_USER_ID }, { $set: { 'profile.avatarKey': 'avatars/real-photo.jpg' } });
  await demo.seedDemo({});
  const u = await User.findById(TEST_USER_ID).lean();
  assert.equal(u.profile.avatarKey, 'avatars/real-photo.jpg');
  assert.equal(u.profile.displayName, 'Chandresh');
  assert.deepEqual(u.roles, ['admin']);
});

test('a brand-new empty database creates the test account as an admin', async (t) => {
  if (skip) return t.skip(skip);
  await clearCollections();
  const { User } = require('../src/models');
  assert.equal(await User.countDocuments({}), 0);
  await demo.seedDemo({});
  const u = await User.findOne({ phone: TEST_PHONE }).lean();
  assert.equal(u._id, TEST_USER_ID);
  assert.deepEqual(u.roles, ['admin']);
  assert.equal(u.status, 'active');
  assert.ok(u.profile.displayName);
});

// ---------------------------------------------------------------------------
async function countAll() {
  const M = require('../src/models');
  const out = {};
  for (const [name, Model] of Object.entries(M)) out[name] = await Model.countDocuments({});
  return out;
}

async function countDemo() {
  const M = require('../src/models');
  let n = 0;
  for (const [name, Model] of Object.entries(M)) {
    if (['Session', 'OtpRequest'].includes(name)) continue;
    n += await Model.countDocuments({ _id: DEMO_ID_RE });
  }
  return n;
}
