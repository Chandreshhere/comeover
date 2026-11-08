'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo } = require('./helpers/mongo');

let skip = null;
test.before(async () => {
  const m = await startMongo();
  if (m.skip) skip = m.skip;
});
test.after(stopMongo);

test('models: UUID ids, toJSON exposes id, geo derived on save, unique constraints', async (t) => {
  if (skip) return t.skip(skip);
  const { User, Activity, Participant, Block } = require('../src/models');
  const u = await User.create({ phone: '+919800000001' });
  assert.match(u._id, /^[0-9a-f-]{36}$/);
  const j = u.toJSON();
  assert.equal(j.id, u._id);
  assert.equal(j._id, undefined);
  assert.equal(u.hasProfile, false);
  await assert.rejects(() => User.create({ phone: '+919800000001' }), (e) => e.code === 11000);

  const a = await Activity.create({ hostUserId: u._id, category: 'chai', title: 'Chai', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000), latitude: 23.0365, longitude: 72.5611 });
  assert.deepEqual(a.location.coordinates, [72.5611, 23.0365]);
  assert.equal(a.coarseCell.length, 6);
  const noGeo = await Activity.create({ hostUserId: u._id, category: 'chai', title: 'Online', startsAt: new Date(), endsAt: new Date(Date.now() + 1000) });
  assert.equal(noGeo.location, undefined);

  await Participant.create({ activityId: a._id, userId: u._id, state: 'accepted' });
  await assert.rejects(() => Participant.create({ activityId: a._id, userId: u._id, state: 'requested' }), (e) => e.code === 11000);
  await assert.rejects(() => Block.create({ blockerUserId: u._id, blockedUserId: u._id }));
});

test('geo queries: $geoWithin filter and $geoNear distance', async (t) => {
  if (skip) return t.skip(skip);
  const geo = require('../src/lib/geo');
  const { Activity } = require('../src/models');
  const base = { hostUserId: 'h', category: 'run', startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) };
  await Activity.create([
    { ...base, title: 'Near', latitude: 23.037, longitude: 72.56 },
    { ...base, title: 'Far', latitude: 23.2, longitude: 72.7 },
  ]);
  const near = await Activity.find({ ...geo.withinFilter(23.0365, 72.5611, 3), title: { $in: ['Near', 'Far'] } }).lean();
  assert.deepEqual(near.map((x) => x.title), ['Near']);
  const withDist = await Activity.aggregate([geo.geoNearStage(23.0365, 72.5611, 25, { query: { title: { $in: ['Near', 'Far'] } } })]);
  assert.equal(withDist[0].title, 'Near');
  assert.ok(withDist[0].distanceM < 200);
});

test('atomic capacity check with $expr (no overbooking)', async (t) => {
  if (skip) return t.skip(skip);
  const { Activity } = require('../src/models');
  const a = await Activity.create({ hostUserId: 'h', category: 'chai', title: 'Cap', capacity: 3, startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
  const take = () => Activity.findOneAndUpdate({ _id: a._id, $expr: { $lt: ['$acceptedCount', '$capacity'] } }, { $inc: { acceptedCount: 1 } }, { new: true }).lean();
  const results = await Promise.all([take(), take(), take(), take()]);
  assert.equal(results.filter(Boolean).length, 2, 'host + 2 = capacity 3');
  assert.equal((await Activity.findById(a._id).lean()).acceptedCount, 3);
});

test('transactions roll back and run after-commit hooks only on success; rate limits persist', async (t) => {
  if (skip) return t.skip(skip);
  const db = require('../src/lib/db');
  const { Notification } = require('../src/models');
  let hook = 0;
  await assert.rejects(() =>
    db.withTransaction(async (session, after) => {
      await Notification.create([{ userId: 'u', type: 'system', title: 'rolled back' }], { session });
      after(() => hook++);
      throw new Error('abort');
    })
  );
  assert.equal(await Notification.countDocuments({ title: 'rolled back' }), 0);
  assert.equal(hook, 0);
  await db.withTransaction(async (session, after) => {
    await Notification.create([{ userId: 'u', type: 'system', title: 'kept' }], { session });
    after(() => hook++);
  });
  assert.equal(await Notification.countDocuments({ title: 'kept' }), 1);
  assert.equal(hook, 1);

  const rl = require('../src/lib/rateLimit');
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await rl.consume('otp_send_phone', '+919800000009'));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.ok(results[3].retryAfterSec > 0);
});

test('XP: idempotent awards, daily cap, level-up from the Level collection', async (t) => {
  if (skip) return t.skip(skip);
  const { seed } = require('../scripts/seed');
  await seed();
  const db = require('../src/lib/db');
  const xp = require('../src/lib/xp');
  const { User, XpEvent } = require('../src/models');
  const u = await User.create({ phone: '+919800000020' });
  const r1 = await db.withTransaction((s) => xp.awardXp(s, { userId: u._id, eventType: 'activity_completed', refId: 'a1', activityId: 'a1' }));
  assert.equal(r1.xp, 40);
  assert.equal(r1.leveledUp, true);
  assert.equal(r1.level.name, 'First Hello');
  const dup = await db.withTransaction((s) => xp.awardXp(s, { userId: u._id, eventType: 'activity_completed', refId: 'a1' }));
  assert.equal(dup.reason, 'duplicate');
  for (let i = 2; i <= 6; i++) await db.withTransaction((s) => xp.awardXp(s, { userId: u._id, eventType: 'activity_completed', refId: `a${i}` }));
  const capped = await db.withTransaction((s) => xp.awardXp(s, { userId: u._id, eventType: 'activity_completed', refId: 'a7' }));
  assert.equal(capped.reason, 'daily_cap_reached');
  const fresh = await User.findById(u._id).lean();
  assert.equal(fresh.progress.xpTotal, 200);
  assert.equal(await XpEvent.countDocuments({ userId: u._id }), 7);
  const none = await db.withTransaction((s) => xp.awardXp(s, { userId: u._id, eventType: 'message_sent', refId: 'm1' }));
  assert.equal(none.reason, 'non_qualifying');
});

test('seed is idempotent', async (t) => {
  if (skip) return t.skip(skip);
  const { seed } = require('../scripts/seed');
  await seed();
  const second = await seed();
  assert.deepEqual(second, { categories: 0, levels: 0, quests: 0, achievements: 0, cityAreas: 0 });
  const { Category, CityArea } = require('../src/models');
  assert.equal(await Category.countDocuments(), 14);
  assert.equal(await CityArea.countDocuments(), 9);
});

test('jobs: enqueue, run, retry with backoff, dedupe', async (t) => {
  if (skip) return t.skip(skip);
  const jobs = require('../src/lib/jobs');
  const { Job } = require('../src/models');
  let seen = 0;
  let flaky = 0;
  jobs.register('t_ok', async (p) => {
    seen += p.n;
  });
  jobs.register('t_flaky', async () => {
    flaky += 1;
    throw new Error('try again');
  });
  await jobs.enqueue('t_ok', { n: 2 });
  await jobs.enqueue({ type: 't_ok', n: 3 }); // legacy object form
  assert.equal(await jobs.enqueue('t_ok', { n: 100 }, { dedupeKey: 'd1', delayMs: 60000 }) !== null, true);
  assert.equal(await jobs.enqueue('t_ok', { n: 100 }, { dedupeKey: 'd1', delayMs: 60000 }), null);
  const f = await jobs.enqueue('t_flaky', {}, { maxAttempts: 2 });
  await jobs.drain();
  assert.equal(seen, 5);
  const after1 = await Job.findById(f._id).lean();
  assert.equal(after1.status, 'queued');
  assert.ok(after1.runAt > new Date());
  await Job.updateOne({ _id: f._id }, { $set: { runAt: new Date() } });
  await jobs.drain();
  assert.equal((await Job.findById(f._id).lean()).status, 'failed');
  assert.equal(flaky, 2);
});

test('realtime.canSubscribe: own user channel, conversation members, plan host/participants', async (t) => {
  if (skip) return t.skip(skip);
  const realtime = require('../src/lib/realtime');
  const { ConversationMember, Activity, Participant } = require('../src/models');
  const me = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  assert.equal(await realtime.canSubscribe(me, `user:${me}:notifications`), true);
  assert.equal(await realtime.canSubscribe(me, `user:${other}:notifications`), false);
  const conv = '33333333-3333-4333-8333-333333333333';
  await ConversationMember.create({ conversationId: conv, userId: me });
  assert.equal(await realtime.canSubscribe(me, `conversation:${conv}`), true);
  assert.equal(await realtime.canSubscribe(other, `conversation:${conv}`), false);
  const a = await Activity.create({ hostUserId: me, category: 'chai', title: 'x', startsAt: new Date(), endsAt: new Date(Date.now() + 1000) });
  assert.equal(await realtime.canSubscribe(me, `activity:${a._id}`), true);
  assert.equal(await realtime.canSubscribe(other, `activity:${a._id}`), false);
  await Participant.create({ activityId: a._id, userId: other, state: 'requested' });
  assert.equal(await realtime.canSubscribe(other, `activity:${a._id}`), true);
});
