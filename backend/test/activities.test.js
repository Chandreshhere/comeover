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

let phoneSeq = 0;
async function makeUser(name, extra = {}) {
  const { User } = require('../src/models');
  phoneSeq += 1;
  const u = await User.create({ phone: `+9197${String(phoneSeq).padStart(8, '0')}`, ageVerified: true, profile: { displayName: name }, ...extra });
  return u._id;
}

async function seed() {
  const { Category, Level } = require('../src/models');
  await Category.create([
    { slug: 'chai', label: 'Chai', pictogram: 'chai' },
    { slug: 'badminton', label: 'Badminton', pictogram: 'badminton' },
    { slug: 'nightlife', label: 'Nightlife', riskLevel: 'restricted' },
  ]);
  await Level.create([
    { level: 1, name: 'Newcomer', xpThreshold: 0 },
    { level: 2, name: 'First Hello', xpThreshold: 40 },
    { level: 3, name: 'Regular', xpThreshold: 100 },
  ]);
}

const planBody = (o = {}) => ({
  title: 'Badminton doubles',
  category: 'badminton',
  startsAt: new Date(Date.now() + 2 * 3600000).toISOString(),
  durationMin: 90,
  capacity: 4,
  area: 'Bodakdev',
  venueName: 'Community sports hall',
  latitude: 23.04,
  longitude: 72.51,
  joinRule: 'approval',
  ...o,
});

async function createPlan(host, o) {
  const r = await call('activities', 'POST /v1/activities', { user: host, body: planBody(o) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

const join = (user, id, intro) => call('activities', 'POST /v1/activities/{activityId}/join-requests', { user, params: { activityId: id }, body: intro ? { intro } : {} });

test('create: validation codes, private venues, restricted categories, duplicates, age gate', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const minor = await makeUser('Unverified', { ageVerified: false });

  const plan = await createPlan(host);
  assert.equal(plan.hostedByMe, true);
  assert.equal(plan.joinedCount, 1);
  assert.equal(plan.durationMin, 90);
  assert.ok(plan.conversationId, 'group chat created with the plan');
  const { Message, Participant } = require('../src/models');
  assert.equal(await Message.countDocuments({ conversationId: plan.conversationId, kind: 'system' }), 1);
  assert.equal(await Participant.countDocuments({ activityId: plan.id, userId: host, state: 'accepted' }), 1);

  const cases = [
    [{ capacity: 1 }, 'capacity_out_of_range'],
    [{ startsAt: new Date(Date.now() - 3600000).toISOString() }, 'start_in_past'],
    [{ startsAt: 'not-a-date' }, 'invalid_time'],
    [{ venueName: 'My place, 3rd floor flat' }, 'private_venue_not_allowed'],
    [{ category: 'nightlife' }, 'category_restricted'],
    [{ startsAt: new Date(Date.now() + 2 * 3600000 + 600000).toISOString() }, 'duplicate_plan'],
  ];
  for (const [o, code] of cases) {
    const r = await call('activities', 'POST /v1/activities', { user: host, body: planBody(o) });
    assert.equal(r.body.code, code, `${JSON.stringify(o)} → ${JSON.stringify(r.body)}`);
  }
  const r = await call('activities', 'POST /v1/activities', { user: minor, body: planBody({ startsAt: new Date(Date.now() + 9 * 3600000).toISOString() }) });
  assert.equal(r.body.code, 'age_gate_required');
});

test('instant vs approval joins; host accept; decline', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');

  const instant = await createPlan(host, { joinRule: 'instant' });
  const j1 = await join(a, instant.id);
  assert.equal(j1.body.state, 'accepted');
  assert.ok(j1.body.conversationId);
  assert.equal(j1.body.activity.joinedCount, 2);
  const again = await join(a, instant.id);
  assert.equal(again.body.state, 'accepted', 'repeat join is idempotent');
  assert.equal(again.body.requestId, j1.body.requestId);

  const approval = await createPlan(host, { joinRule: 'approval', category: 'chai', title: 'Chai', startsAt: new Date(Date.now() + 5 * 3600000).toISOString() });
  const ra = await join(a, approval.id, 'Hi');
  const rb = await join(b, approval.id);
  assert.equal(ra.body.state, 'requested');
  const list = await call('activities', 'GET /v1/activities/{activityId}/join-requests', { user: host, params: { activityId: approval.id } });
  assert.deepEqual(list.body.items.map((x) => x.user.name).sort(), ['Asha', 'Bilal']);
  assert.equal(list.body.items.find((x) => x.userId === a).intro, 'Hi');
  const notHost = await call('activities', 'GET /v1/activities/{activityId}/join-requests', { user: a, params: { activityId: approval.id } });
  assert.equal(notHost.body.code, 'host_only');

  const acc = await call('activities', 'POST /v1/activities/{activityId}/join-requests/{requestId}/accept', { user: host, params: { activityId: approval.id, requestId: ra.body.requestId } });
  assert.equal(acc.body.state, 'accepted');
  const dec = await call('activities', 'POST /v1/activities/{activityId}/join-requests/{requestId}/decline', { user: host, params: { activityId: approval.id, requestId: rb.body.requestId } });
  assert.equal(dec.body.state, 'declined');
  const rejoin = await join(b, approval.id);
  assert.equal(rejoin.body.code, 'declined');

  const { Notification, ConversationMember } = require('../src/models');
  assert.ok(await Notification.exists({ userId: a, title: /accepted your request/ }));
  assert.ok(await ConversationMember.exists({ conversationId: approval.conversationId, userId: a, leftAt: null }));
  assert.equal(await ConversationMember.countDocuments({ conversationId: approval.conversationId, userId: b }), 0);
});

test('concurrent instant joins never exceed capacity; overflow goes to the waitlist', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const plan = await createPlan(host, { joinRule: 'instant', capacity: 3 });
  const users = [];
  for (let i = 0; i < 6; i++) users.push(await makeUser(`U${i}`));
  const results = await Promise.all(users.map((u) => join(u, plan.id)));
  const states = results.map((r) => r.body.state || r.body.code);
  assert.equal(states.filter((s) => s === 'accepted').length, 2, `host + 2 = capacity 3, got ${states}`);
  assert.equal(states.filter((s) => s === 'waitlisted').length, 4, `${states}`);
  const { Activity, Participant } = require('../src/models');
  const a = await Activity.findById(plan.id).lean();
  assert.equal(a.acceptedCount, 3);
  assert.equal(a.status, 'full');
  assert.equal(a.waitlistCount, 4);
  assert.equal(await Participant.countDocuments({ activityId: plan.id, state: { $in: ['accepted', 'checked_in', 'completed'] } }), 3);
  const positions = results.filter((r) => r.body.state === 'waitlisted').map((r) => r.body.waitlistPosition).sort();
  assert.deepEqual(positions, [1, 2, 3, 4]);
});

test('waitlist: cap, promotion on drop-out, cancel by participant', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const plan = await createPlan(host, { joinRule: 'approval', capacity: 2 });
  const a = await makeUser('A');
  const w1 = await makeUser('W1');
  const w2 = await makeUser('W2');
  const ra = await join(a, plan.id);
  await call('activities', 'POST /v1/activities/{activityId}/join-requests/{requestId}/accept', { user: host, params: { activityId: plan.id, requestId: ra.body.requestId } });
  const r1 = await join(w1, plan.id);
  const r2 = await join(w2, plan.id);
  assert.equal(r1.body.state, 'waitlisted');
  assert.equal(r1.body.waitlistPosition, 1);
  assert.equal(r2.body.waitlistPosition, 2);
  assert.equal(r1.body.activity.waitlistPosition, 1);

  // A drops out → first waitlisted person is promoted (approval plan → back to the host as a request).
  const left = await call('activities', 'DELETE /v1/activities/{activityId}/join-requests/me', { user: a, params: { activityId: plan.id } });
  assert.equal(left.body.state, 'cancelled');
  const { Participant, Activity } = require('../src/models');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: w1 }).lean()).state, 'requested');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: w2 }).lean()).state, 'waitlisted');
  const act = await Activity.findById(plan.id).lean();
  assert.equal(act.acceptedCount, 1);
  assert.equal(act.status, 'open');
  assert.equal(act.waitlistCount, 1);

  // Waitlisted person leaves → waitlist count drops.
  await call('activities', 'DELETE /v1/activities/{activityId}/join-requests/me', { user: w2, params: { activityId: plan.id } });
  assert.equal((await Activity.findById(plan.id).lean()).waitlistCount, 0);
  const none = await call('activities', 'DELETE /v1/activities/{activityId}/join-requests/me', { user: w2, params: { activityId: plan.id } });
  assert.equal(none.body.code, 'no_active_request');
  const hostLeave = await call('activities', 'DELETE /v1/activities/{activityId}/join-requests/me', { user: host, params: { activityId: plan.id } });
  assert.equal(hostLeave.body.code, 'host_cannot_leave');
});

test('host cancel: participants cancelled and notified; plan no longer joinable', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const g = await makeUser('Guest');
  const plan = await createPlan(host, { joinRule: 'instant' });
  await join(g, plan.id);
  const notHost = await call('activities', 'POST /v1/activities/{activityId}/cancel', { user: g, params: { activityId: plan.id } });
  assert.equal(notHost.body.code, 'host_only');
  const r = await call('activities', 'POST /v1/activities/{activityId}/cancel', { user: host, params: { activityId: plan.id }, body: { reason: 'Rain' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'cancelled');
  const { Participant, Notification, Message } = require('../src/models');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: g }).lean()).state, 'cancelled');
  assert.ok(await Notification.exists({ userId: g, title: 'Plan cancelled' }));
  assert.ok(await Message.exists({ conversationId: plan.conversationId, body: /cancelled this plan: Rain/ }));
  const late = await join(await makeUser('Late'), plan.id);
  assert.equal(late.body.code, 'not_joinable');
  const again = await call('activities', 'POST /v1/activities/{activityId}/cancel', { user: host, params: { activityId: plan.id } });
  assert.equal(again.body.code, 'not_cancellable');
});

test('check-in: window, too_far, proximity and manual', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const g = await makeUser('Guest');
  const plan = await createPlan(host, { joinRule: 'instant' });
  await join(g, plan.id);
  const early = await call('activities', 'POST /v1/activities/{activityId}/check-ins', { user: g, params: { activityId: plan.id }, body: { method: 'manual' } });
  assert.equal(early.body.code, 'checkin_window_closed');

  const { Activity } = require('../src/models');
  await Activity.updateOne({ _id: plan.id }, { $set: { startsAt: new Date(Date.now() - 5 * 60000), endsAt: new Date(Date.now() + 85 * 60000) } });
  const far = await call('activities', 'POST /v1/activities/{activityId}/check-ins', { user: g, params: { activityId: plan.id }, body: { method: 'proximity', lat: 23.1, lng: 72.6 } });
  assert.equal(far.status, 409);
  assert.equal(far.body.code, 'too_far');
  const near = await call('activities', 'POST /v1/activities/{activityId}/check-ins', { user: g, params: { activityId: plan.id }, body: { method: 'proximity', lat: 23.0401, lng: 72.5101 } });
  assert.deepEqual(near.body, { checkedIn: true, method: 'proximity', verified: true, mutual: false });
  assert.equal((await Activity.findById(plan.id).lean()).status, 'in_progress');
  const outsider = await call('activities', 'POST /v1/activities/{activityId}/check-ins', { user: await makeUser('X'), params: { activityId: plan.id }, body: { method: 'manual' } });
  assert.equal(outsider.body.code, 'not_participant');
});

test('completion: pendingOthers first, then XP once (mutual, deduplicated)', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const g = await makeUser('Guest');
  const plan = await createPlan(host, { joinRule: 'instant' });
  await join(g, plan.id);
  const tooEarly = await call('activities', 'POST /v1/activities/{activityId}/completion-confirmations', { user: g, params: { activityId: plan.id } });
  assert.equal(tooEarly.body.code, 'too_early');

  const { Activity, XpEvent, User, Job } = require('../src/models');
  await Activity.updateOne({ _id: plan.id }, { $set: { startsAt: new Date(Date.now() - 60 * 60000), endsAt: new Date(Date.now() + 30 * 60000) } });

  const h1 = await call('activities', 'POST /v1/activities/{activityId}/completion-confirmations', { user: host, params: { activityId: plan.id } });
  assert.equal(h1.status, 200, JSON.stringify(h1.body));
  assert.equal(h1.body.pendingOthers, true);
  assert.equal(h1.body.state, 'confirmed');
  assert.equal(h1.body.xpAwarded, 0);
  assert.ok(h1.body.progress, 'progress included');

  const g1 = await call('activities', 'POST /v1/activities/{activityId}/completion-confirmations', { user: g, params: { activityId: plan.id } });
  assert.equal(g1.body.state, 'completed');
  assert.equal(g1.body.pendingOthers, false);
  assert.equal(g1.body.xpAwarded, 60, 'activity_completed 40 + new category 20');
  assert.equal(g1.body.leveledUp, true);

  const g2 = await call('activities', 'POST /v1/activities/{activityId}/completion-confirmations', { user: g, params: { activityId: plan.id } });
  assert.equal(g2.body.duplicate, true);
  assert.equal(g2.body.xpAwarded, 0);

  assert.equal(await XpEvent.countDocuments({ userId: g, eventType: 'activity_completed' }), 1);
  assert.equal((await User.findById(g).lean()).progress.xpTotal, 60);
  assert.equal((await User.findById(host).lean()).progress.xpTotal, 120, 'host: 40 + 20 + hosted 60');
  assert.equal((await Activity.findById(plan.id).lean()).status, 'completed');
  assert.ok(await Job.exists({ type: 'quest_evaluate', 'payload.userId': g }));
  assert.ok(await Job.exists({ type: 'reliability_recalc', 'payload.userId': g }));

  const outsider = await call('activities', 'POST /v1/activities/{activityId}/completion-confirmations', { user: await makeUser('Out'), params: { activityId: plan.id } });
  assert.equal(outsider.body.code, 'not_participant');
});

test('feedback: private, once per plan; reliability job marks peer-confirmed no-shows', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const a = await makeUser('A');
  const b = await makeUser('B');
  const plan = await createPlan(host, { joinRule: 'instant' });
  await join(a, plan.id);
  await join(b, plan.id);
  const f1 = await call('activities', 'POST /v1/activities/{activityId}/feedback', { user: host, params: { activityId: plan.id }, body: { about: [{ userId: b, showedUp: false }] } });
  assert.deepEqual(f1.body, { ok: true });
  const dup = await call('activities', 'POST /v1/activities/{activityId}/feedback', { user: host, params: { activityId: plan.id }, body: { about: [{ userId: b, showedUp: false }] } });
  assert.equal(dup.body.code, 'already_submitted');
  await call('activities', 'POST /v1/activities/{activityId}/feedback', { user: a, params: { activityId: plan.id }, body: { about: [{ userId: b, showedUp: false }] } });

  const { reliabilityRecalc } = require('../src/jobs/activities');
  const res = await reliabilityRecalc({ userId: b });
  const { Participant, User } = require('../src/models');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: b }).lean()).state, 'no_show');
  assert.ok(res.score < 1);
  assert.equal((await User.findById(b).lean()).profile.reliabilityScore, res.score);
});

test('lifecycle cron: started plans go in_progress; unanswered requests expire', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const g = await makeUser('Guest');
  const plan = await createPlan(host, { joinRule: 'approval' });
  await join(g, plan.id);
  const { Activity, Participant } = require('../src/models');
  await Activity.updateOne({ _id: plan.id }, { $set: { startsAt: new Date(Date.now() - 60000) } });
  const { lifecycle } = require('../src/jobs/activities');
  const r = await lifecycle();
  assert.equal(r.startedPlans, 1);
  assert.equal(r.expiredRequests, 1);
  assert.equal((await Activity.findById(plan.id).lean()).status, 'in_progress');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: g }).lean()).state, 'declined');
});

test('assistant: unsupported_intent, quota_exceeded, grounding guard', async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const host = await makeUser('Host');
  const me = await makeUser('Me');
  const plan = await createPlan(host, { joinRule: 'instant' });

  const anthropic = require('../src/lib/anthropic');
  const original = anthropic.getClient;
  let calls = 0;
  anthropic.getClient = async () => ({
    beta: {
      messages: {
        create: async () => {
          calls += 1;
          return {
            model: anthropic.MODEL,
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ refused: false, reply: 'Try this one.', activityIds: [plan.id, 'invented-id'], includeDraft: false, draft: { category: 'chai', title: 'x', durationMin: 30, when: 'now', capacity: 4 } }) }],
          };
        },
      },
    },
  });
  try {
    const refused = await call('assistant', 'POST /v1/assistant/suggest', { user: me, body: { prompt: 'looking for a date tonight' } });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.code, 'unsupported_intent');
    assert.equal(refused.body.details.promptsLeft, 16);
    assert.equal(calls, 0, 'refused before calling the model');

    const ok = await call('assistant', 'POST /v1/assistant/suggest', { user: me, body: { prompt: 'badminton tonight?' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.activityIds, [plan.id], 'invented ids are dropped');
    assert.equal(ok.body.activities[0].id, plan.id);
    assert.equal(ok.body.promptsLeft, 15);

    const { AssistantUsage } = require('../src/models');
    const { istDate } = require('../src/lib/quests');
    await AssistantUsage.updateOne({ userId: me, day: istDate() }, { $set: { count: 16 } });
    const quota = await call('assistant', 'POST /v1/assistant/suggest', { user: me, body: { prompt: 'anything nearby?' } });
    assert.equal(quota.status, 429);
    assert.equal(quota.body.code, 'quota_exceeded');
    assert.equal(calls, 1);
  } finally {
    anthropic.getClient = original;
  }
});
