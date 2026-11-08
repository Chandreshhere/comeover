'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser, makePlan } = require('./helpers/fixtures');

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

test('report + alsoBlock: blocks in the same call, queues a moderation alert', async (t) => {
  if (skip) return t.skip(skip);
  const me = await makeUser('Me');
  const them = await makeUser('Them');
  const r = await call('POST', '/v1/reports', { token: me.token, body: { userId: them.id, reasonCode: 'harassment', details: 'Kept messaging', alsoBlock: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.blocked, true);
  assert.equal(r.body.priority, 'high');
  const { Block, Job, AuditEvent } = require('../src/models');
  assert.ok(await Block.exists({ blockerUserId: me.id, blockedUserId: them.id }));
  assert.ok(await Job.exists({ type: 'moderation_alert', 'payload.reportId': r.body.id }));
  assert.ok(await AuditEvent.exists({ action: 'report.create', targetId: r.body.id }));

  const mine = await call('GET', '/v1/me/reports', { token: me.token });
  assert.equal(mine.body.items[0].target.name, 'Them');
  assert.equal(mine.body.items[0].outcome, null);
  const blocks = await call('GET', '/v1/me/blocks', { token: me.token });
  assert.deepEqual(
    blocks.body.items.map((b) => [b.userId, b.name]),
    [[them.id, 'Them']]
  );

  assert.equal((await call('POST', '/v1/reports', { token: me.token, body: { userId: me.id, reasonCode: 'spam' } })).body.code, 'cannot_report_self');
  assert.equal((await call('POST', '/v1/reports', { token: me.token, body: { reasonCode: 'spam' } })).body.code, 'target_required');
  // Idempotent with the same key.
  const h = { 'idempotency-key': 'report-key-0001' };
  const one = await call('POST', '/v1/reports', { token: me.token, body: { activityId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', reasonCode: 'unsafe_venue' }, headers: h });
  const two = await call('POST', '/v1/reports', { token: me.token, body: { activityId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', reasonCode: 'unsafe_venue' }, headers: h });
  assert.equal(one.body.id, two.body.id);
});

test('block withdraws pending requests both ways; unblock', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const guest = await makeUser('Guest');
  const plan = await makePlan(host, [], { pending: [guest] });
  const theirs = await makePlan(guest, [], { pending: [host] });
  const r = await call('POST', '/v1/blocks', { token: host.token, body: { userId: guest.id } });
  assert.deepEqual(r.body, { blocked: true, userId: guest.id });
  const { Participant } = require('../src/models');
  assert.equal((await Participant.findOne({ activityId: plan.id, userId: guest.id }).lean()).state, 'declined');
  assert.equal((await Participant.findOne({ activityId: theirs.id, userId: host.id }).lean()).state, 'declined');
  assert.equal((await call('POST', '/v1/blocks', { token: host.token, body: { userId: host.id } })).body.code, 'cannot_block_self');
  const un = await call('DELETE', `/v1/blocks/${guest.id}`, { token: host.token });
  assert.deepEqual(un.body, { blocked: false, userId: guest.id });
  assert.equal((await call('GET', '/v1/me/blocks', { token: host.token })).body.items.length, 0);
});

test('trusted contacts are unique per phone; revoke and re-invite reuse the record', async (t) => {
  if (skip) return t.skip(skip);
  const me = await makeUser('Me');
  const one = await call('POST', '/v1/trusted-contacts/invitations', { token: me.token, body: { name: 'Mum', phone: '98765 00001' } });
  assert.equal(one.status, 201, JSON.stringify(one.body));
  assert.equal(one.body.phone, '+919876500001');
  assert.equal(one.body.status, 'invited');
  assert.equal(one.body.smsSent, false, 'SMS is skipped when Slide SMS is not configured');
  const two = await call('POST', '/v1/trusted-contacts/invitations', { token: me.token, body: { name: 'Mom', phone: '+919876500001' } });
  assert.equal(two.body.id, one.body.id);
  assert.equal(two.body.name, 'Mom');
  let list = await call('GET', '/v1/trusted-contacts', { token: me.token });
  assert.equal(list.body.items.length, 1);

  assert.equal((await call('DELETE', `/v1/trusted-contacts/${one.body.id}`, { token: me.token })).status, 200);
  list = await call('GET', '/v1/trusted-contacts', { token: me.token });
  assert.equal(list.body.items.length, 0);
  const back = await call('POST', '/v1/trusted-contacts/invitations', { token: me.token, body: { name: 'Mom', phone: '9876500001' } });
  assert.equal(back.body.id, one.body.id);
  assert.equal(back.body.status, 'invited');
  assert.equal((await call('POST', '/v1/trusted-contacts/invitations', { token: me.token, body: { name: 'X', phone: '12345' } })).body.code, 'invalid_phone');
});

test('plan share needs membership; creates an expiring share', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const guest = await makeUser('Guest');
  const outsider = await makeUser('Outsider');
  const plan = await makePlan(host, [guest]);
  const ok = await call('POST', '/v1/trusted-contacts/invitations', { token: guest.token, body: { name: 'Sis', phone: '9876500002', activityId: plan.id } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.shared.activityId, plan.id);
  const { PlanShare } = require('../src/models');
  const share = await PlanShare.findOne({ userId: guest.id }).lean();
  assert.ok(share && share.expiresAt > new Date());
  const no = await call('POST', '/v1/trusted-contacts/invitations', { token: outsider.token, body: { name: 'Sis', phone: '9876500003', activityId: plan.id } });
  assert.equal(no.body.code, 'not_participant');
});

test('case status + appeal; moderation alert notifies staff', async (t) => {
  if (skip) return t.skip(skip);
  const reporter = await makeUser('Reporter');
  const reported = await makeUser('Reported');
  const admin = await makeUser('Admin', { roles: ['admin'] });
  const { Report, ReportAction, Notification } = require('../src/models');
  const rep = await Report.create({ reporterUserId: reporter.id, reportedUserId: reported.id, reasonCode: 'spam', priority: 'low', status: 'actioned', resolvedAt: new Date() });
  await ReportAction.create({ reportId: rep._id, adminId: admin.id, action: 'warn' });
  const open = await Report.create({ reporterUserId: reporter.id, reportedUserId: reported.id, reasonCode: 'other' });

  let cs = await call('GET', '/v1/safety/case-status', { token: reported.token });
  assert.equal(cs.status, 200);
  assert.equal(cs.body.account.status, 'active');
  assert.equal(cs.body.cases.length, 1);
  assert.equal(cs.body.cases[0].action, 'warn');
  assert.equal(cs.body.cases[0].appealable, true);
  assert.ok(!('reporterUserId' in cs.body.cases[0]), 'reporter identity is never revealed');

  assert.equal((await call('POST', '/v1/appeals', { token: reported.token, body: { reportId: open._id, statement: 'I did nothing wrong here.' } })).body.code, 'report_not_appealable');
  const ap = await call('POST', '/v1/appeals', { token: reported.token, body: { reportId: rep._id, statement: 'This was a misunderstanding.' } });
  assert.equal(ap.status, 201, JSON.stringify(ap.body));
  cs = await call('GET', '/v1/safety/case-status', { token: reported.token });
  assert.equal(cs.body.cases[0].status, 'appealed');
  assert.equal(cs.body.cases[0].appeal.status, 'open');
  assert.equal(cs.body.cases[0].appealable, false);

  const { runModerationAlert } = require('../src/services/safety');
  const res = await runModerationAlert({ reportId: rep._id, appeal: true });
  assert.equal(res.notified, 1);
  assert.ok(await Notification.exists({ userId: admin.id, type: 'safety', title: /APPEAL/ }));
  assert.deepEqual(await runModerationAlert({ reportId: open._id }), { skipped: 'low_priority' });
});
