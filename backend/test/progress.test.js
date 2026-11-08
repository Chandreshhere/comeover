'use strict';
// Progress / quests / streaks (group A port) against an in-memory MongoDB replica set.
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
async function makeUser(name) {
  const { User } = require('../src/models');
  phoneSeq += 1;
  const u = await User.create({ phone: `+9196000${String(phoneSeq).padStart(5, '0')}`, ageVerified: true, profile: { displayName: name, preferences: {} } });
  return { id: u._id, token: require('../src/lib/tokens').signAccessToken({ userId: u._id }) };
}

async function call(method, path, token, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// A verified completion today: user + a new person both completed a chai plan hosted by someone else.
async function completeChaiToday(userId, otherId, hostId) {
  const { Activity, Participant } = require('../src/models');
  const now = Date.now();
  const [a] = await Activity.create([
    { hostUserId: hostId, category: 'chai', title: 'Chai', startsAt: new Date(now - 2 * 3600000), endsAt: new Date(now - 3600000), completedAt: new Date(now), status: 'completed' },
  ]);
  await Participant.create([
    { activityId: a._id, userId, state: 'completed', completionConfirmedAt: new Date(now) },
    { activityId: a._id, userId: otherId, state: 'completed', completionConfirmedAt: new Date(now) },
  ]);
  return a;
}

const questById = (items, id) => items.find((q) => q.id === id);

test('progress from verified completions; quests evaluated server-side; claim awards XP once with the daily cap', async (t) => {
  if (skip) return t.skip(skip);
  const { XpDailyTotal, UserQuest, Quest, XpEvent } = require('../src/models');
  const { istDay } = require('../src/lib/xp');
  const u = await makeUser('Asha');
  const other = await makeUser('Ravi');
  const host = await makeUser('Host');

  const empty = await call('GET', '/v1/me/progress', u.token);
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.completedActivities, 0);
  assert.equal(empty.body.xp, 0);
  assert.equal(empty.body.level.level, 1);
  assert.equal(empty.body.dailyXpCap, 200);
  assert.equal(empty.body.week.length, 7);
  assert.equal(empty.body._stats, undefined);

  // Not complete yet → cannot claim.
  const early = await call('POST', '/v1/quests/q_new_person/claim', u.token, {});
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'quest_not_complete');

  await completeChaiToday(u.id, other.id, host.id);
  const prog = await call('GET', '/v1/me/progress', u.token);
  assert.equal(prog.body.completedActivities, 1);
  assert.equal(prog.body.peopleMet, 1);
  assert.deepEqual(prog.body.categoryCounts, { chai: 1 });
  assert.equal(prog.body.weeklyDone, 1);
  assert.ok(prog.body.week.some((d) => d.state === 'today_done'));

  const quests = await call('GET', '/v1/quests', u.token);
  assert.equal(quests.status, 200);
  assert.equal(questById(quests.body.items, 'q_new_person').state, 'completed');
  assert.equal(questById(quests.body.items, 'q_new_category').state, 'completed');
  const weekly = questById(quests.body.items, 'q_weekly_goal');
  assert.equal(weekly.state, 'started');
  assert.equal(weekly.progress, 1);
  assert.equal(weekly.total, 2);
  const daily = await call('GET', '/v1/quests?kind=daily', u.token);
  assert.ok(daily.body.items.every((q) => q.kind === 'daily'));

  const claim = await call('POST', '/v1/quests/q_new_person/claim', u.token, {});
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.claimed, true);
  assert.equal(claim.body.xpAwarded, 40);
  assert.equal(claim.body.capped, false);
  assert.equal(claim.body.progress.xp, 40);
  assert.equal(claim.body.progress.xpToday, 40);
  const again = await call('POST', '/v1/quests/q_new_person/claim', u.token, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_claimed');

  // Daily cap: only 10 XP of room left today.
  await XpDailyTotal.updateOne({ userId: u.id, day: istDay() }, { $set: { total: 190 } });
  const capped = await call('POST', '/v1/quests/q_new_category/claim', u.token, {});
  assert.equal(capped.status, 200, JSON.stringify(capped.body));
  assert.equal(capped.body.xpAwarded, 10);
  assert.equal(capped.body.capped, true);
  assert.equal(capped.body.progress.xp, 50);

  // Dedupe: even if the claim state were reset, the XP idempotency key never re-awards.
  const q = await Quest.findOne({ slug: 'q_new_person' }).lean();
  await UserQuest.updateOne({ userId: u.id, questId: q._id }, { $set: { state: 'completed' } });
  const replay = await call('POST', '/v1/quests/q_new_person/claim', u.token, {});
  assert.equal(replay.status, 200);
  assert.equal(replay.body.xpAwarded, 0);
  assert.equal(replay.body.progress.xp, 50);
  assert.equal(await XpEvent.countDocuments({ userId: u.id, eventType: 'quest_claimed' }), 2);

  assert.equal((await call('POST', '/v1/quests/nope/claim', u.token, {})).body.code, 'quest_not_found');
});

test('quest start marks a quest started; milestones, achievements and roadmap shapes', async (t) => {
  if (skip) return t.skip(skip);
  const u = await makeUser('Meera');
  const other = await makeUser('Zoya');
  const host = await makeUser('Host2');

  const started = await call('POST', '/v1/quests/q_host/start', u.token, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.id, 'q_host');
  assert.equal(started.body.state, 'started');
  assert.equal(typeof started.body.xp, 'number');

  await completeChaiToday(u.id, other.id, host.id);
  const ms = await call('GET', '/v1/me/milestones', u.token);
  assert.ok(ms.body.items.length > 0);
  assert.equal(ms.body.items[0].id, 'level-2');
  assert.equal(ms.body.items.filter((m) => m.state === 'current').length, 1);
  assert.equal(ms.body.nextCursor, null);

  const ach = await call('GET', '/v1/me/achievements', u.token);
  const chai = ach.body.items.find((a) => a.id === 'b_chai');
  assert.equal(chai.earned, false);
  assert.equal(chai.progress, 1);
  assert.equal(chai.total, 3);
  assert.equal(chai.category, 'chai');
  assert.equal(chai.kind, 'category_completed');
  assert.equal(chai.hint, '2 more chai plans to go');

  const rm = await call('GET', '/v1/me/roadmap', u.token);
  assert.deepEqual(Object.keys(rm.body).sort(), ['achievements', 'categoryCounts', 'level', 'milestones', 'xp']);
  assert.deepEqual(rm.body.categoryCounts, { chai: 1 });
});

test('quest_evaluate job: marks completed quests once and notifies once', async (t) => {
  if (skip) return t.skip(skip);
  const { UserQuest, Quest, Notification } = require('../src/models');
  const { runQuestEvaluate } = require('../src/handlers/progress');
  const u = await makeUser('Kabir');
  const other = await makeUser('Tanvi');
  const host = await makeUser('Host3');
  await completeChaiToday(u.id, other.id, host.id);

  await runQuestEvaluate({ userId: u.id });
  const q = await Quest.findOne({ slug: 'q_new_person' }).lean();
  assert.equal((await UserQuest.findOne({ userId: u.id, questId: q._id }).lean()).state, 'completed');
  const n1 = await Notification.countDocuments({ userId: u.id, type: 'quest' });
  assert.ok(n1 >= 2, 'q_new_person and q_new_category completed');
  await runQuestEvaluate({ userId: u.id });
  assert.equal(await Notification.countDocuments({ userId: u.id, type: 'quest' }), n1, 'no duplicate notifications');
});

test('streak freeze: week states, one freeze per week, calendar shape', async (t) => {
  if (skip) return t.skip(skip);
  const { StreakFreeze } = require('../src/models');
  const S = require('../src/services/progress');
  const { weekStart } = require('../src/lib/quests');
  const u = await makeUser('Dev');

  // Deterministic: evaluate a Thursday so earlier days of that week exist.
  const thursday = new Date(`${S.addDays(weekStart(new Date()), -3)}T12:00:00+05:30`); // Thursday of last week (IST)
  const wk = weekStart(thursday);
  const tuesday = S.addDays(wk, 2);
  const before = await S.progressFor(u.id, { now: thursday });
  assert.equal(before.freezesLeft, 1);
  assert.equal(before.week.find((d) => d.date === tuesday).state, 'rest');
  await StreakFreeze.create({ userId: u.id, day: tuesday });
  const after = await S.progressFor(u.id, { now: thursday });
  assert.equal(after.week.find((d) => d.date === tuesday).state, 'freeze');
  assert.equal(after.freezesLeft, 0);
  await StreakFreeze.deleteMany({ userId: u.id });

  // Route: depends on today's weekday (Sunday has no earlier day to protect).
  const cur = await call('GET', '/v1/me/progress', u.token);
  const candidates = cur.body.week.filter((d) => d.state === 'missed' || d.state === 'rest');
  const r = await call('POST', '/v1/me/streak-freeze', u.token, {});
  if (candidates.length) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.freezesLeft, 0);
    assert.equal(r.body.week.find((d) => d.date === candidates[candidates.length - 1].date).state, 'freeze');
    const second = await call('POST', '/v1/me/streak-freeze', u.token, {});
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'no_freezes_left');
  } else {
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'nothing_to_freeze');
  }

  const cal = await call('GET', '/v1/me/streak-calendar?months=1', u.token);
  assert.equal(cal.status, 200, JSON.stringify(cal.body));
  assert.ok(cal.body.days.length >= 28);
  assert.deepEqual(Object.keys(cal.body.days[0]).sort(), ['count', 'date', 'state']);
  assert.equal(cal.body.days[0].date, weekStart(new Date(Date.now() - 30 * 86400000)));
  assert.ok(cal.body.days.some((d) => d.state === 'today' || d.state === 'today_done'));
  assert.equal(typeof cal.body.weeklyGoal, 'number');
  assert.equal((await call('GET', '/v1/me/streak-calendar?months=20', u.token)).body.code, 'validation_failed');
});
