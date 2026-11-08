'use strict';
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser } = require('./helpers/groupD');

let skip = null;
let app;
let call;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  app = await startApp(['admin']);
  call = client(app.base);
});

test.after(async () => {
  if (app) await app.close();
  await stopMongo();
});

test.beforeEach(async () => {
  if (!skip) await clearCollections();
});

const later = (h) => new Date(Date.now() + h * 3600000);

test('role gating: no role → admin_only; moderator is limited to reports/activities/users/audit', async (t) => {
  if (skip) return t.skip(skip);
  const plain = await makeUser();
  const mod = await makeUser({ roles: ['moderator'], name: 'Mo' });
  const admin = await makeUser({ roles: ['admin'], name: 'Ada' });

  const noRole = await call('GET', '/v1/admin/reports', { token: plain.token });
  assert.equal(noRole.status, 403);
  assert.equal(noRole.body.code, 'admin_only');
  const anon = await call('GET', '/v1/admin/reports');
  assert.equal(anon.status, 401);

  for (const path of ['/v1/admin/kpis', '/v1/admin/taxonomy/categories', '/v1/admin/taxonomy/areas', '/v1/admin/taxonomy/quests', '/v1/admin/billing/subscriptions', '/v1/admin/billing/campaigns']) {
    const r = await call('GET', path, { token: mod.token });
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'insufficient_role', path);
  }
  const taxWrite = await call('POST', '/v1/admin/taxonomy/categories', { token: mod.token, body: { slug: 'x-cat', label: 'X', reason: 'testing access' } });
  assert.equal(taxWrite.status, 403);

  for (const path of ['/v1/admin/reports', '/v1/admin/activities', '/v1/admin/audit']) {
    const r = await call('GET', path, { token: mod.token });
    assert.equal(r.status, 200, `${path} ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.items));
  }
  const kpis = await call('GET', '/v1/admin/kpis?range=30d', { token: admin.token });
  assert.equal(kpis.status, 200, JSON.stringify(kpis.body));
  assert.equal(kpis.body.range, '30d');
  assert.equal(kpis.body.series.length, 30);
  assert.ok(kpis.body.users.total >= 3);
  assert.deepEqual(Object.keys(kpis.body.safety).sort(), ['openReports', 'substantiatedPer1000Meetups', 'urgentOpen']);

  // Revoking the role takes effect immediately (roles are re-read from the database).
  const { User } = require('../src/models');
  await User.updateOne({ _id: mod.id }, { $set: { roles: [] } });
  const revoked = await call('GET', '/v1/admin/reports', { token: mod.token });
  assert.equal(revoked.body.code, 'admin_only');
});

test('KPIs: joins, show-up and liquidity are computed from participants (host excluded)', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await makeUser({ roles: ['admin'] });
  const host = await makeUser({ name: 'Host' });
  const g1 = await makeUser({ name: 'G1' });
  const g2 = await makeUser({ name: 'G2' });
  const { Activity, Participant } = require('../src/models');
  const created = new Date(Date.now() - 3 * 3600000);
  const a = await Activity.create({ hostUserId: host.id, category: 'chai', title: 'Chai', startsAt: new Date(Date.now() - 2 * 3600000), endsAt: new Date(Date.now() - 3600000), status: 'completed', completedAt: new Date(), latitude: 23, longitude: 72.5 });
  await Activity.collection.updateOne({ _id: a._id }, { $set: { createdAt: created } }); // createdAt is immutable via Mongoose
  await Participant.create([
    { activityId: a._id, userId: host.id, state: 'accepted', requestedAt: new Date() },
    { activityId: a._id, userId: g1.id, state: 'completed', requestedAt: new Date(), decidedAt: new Date(created.getTime() + 30 * 60000), checkInMethod: 'manual' },
    { activityId: a._id, userId: g2.id, state: 'no_show', requestedAt: new Date(), decidedAt: new Date(created.getTime() + 90 * 60000) },
  ]);
  const r = await call('GET', '/v1/admin/kpis', { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.joins, { requests: 2, accepted: 2, conversion: 1 });
  assert.equal(r.body.showUpRate, 0.5);
  assert.equal(r.body.completionRate, 1);
  assert.equal(r.body.medianMinutesToFirstAccept, 30);
  assert.equal(r.body.activities.completed, 1);
});

test('report action: suspend writes report action + audit, suspends the user, cancels hosted plans, revokes sessions', async (t) => {
  if (skip) return t.skip(skip);
  const mod = await makeUser({ roles: ['moderator'], name: 'Mo' });
  const reporter = await makeUser({ name: 'Reporter' });
  const target = await makeUser({ name: 'Target' });
  const { Report, ReportAction, AuditEvent, User, Activity, Notification, Session } = require('../src/models');
  const plan = await Activity.create({ hostUserId: target.id, category: 'chai', title: 'Late chai', startsAt: later(5), endsAt: later(6), latitude: 23, longitude: 72.5 });
  await require('../src/lib/tokens').createSession(target.id);
  const rep = await Report.create({ reporterUserId: reporter.id, reportedUserId: target.id, reasonCode: 'harassment', priority: 'high' });

  const list = await call('GET', '/v1/admin/reports', { token: mod.token });
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].reported.name, 'Target');
  assert.equal(list.body.items[0].reporter.name, 'Reporter');
  assert.equal(list.body.items[0].priorReports, 0);

  const detail = await call('GET', `/v1/admin/reports/${rep._id}`, { token: mod.token });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.status, 'reviewing');
  assert.equal((await Report.findById(rep._id).lean()).assignedAdminId, mod.id);
  assert.ok(await AuditEvent.exists({ action: 'report.review_started', targetId: rep._id, actorAdminId: mod.id }));

  const noReason = await call('POST', `/v1/admin/reports/${rep._id}/actions`, { token: mod.token, body: { action: 'suspend' } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'validation_failed');

  const r = await call('POST', `/v1/admin/reports/${rep._id}/actions`, { token: mod.token, body: { action: 'suspend', reason: 'Repeated harassment confirmed', durationDays: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'actioned');
  assert.equal(r.body.actions.length, 1);
  assert.equal(r.body.actions[0].action, 'suspend');
  assert.equal(r.body.actions[0].admin, 'Mo');

  const u = await User.findById(target.id).lean();
  assert.equal(u.status, 'suspended');
  assert.equal(u.statusReason, 'Repeated harassment confirmed');
  assert.ok(u.statusUntil > new Date());
  assert.equal((await Activity.findById(plan._id).lean()).status, 'cancelled');
  assert.equal(await ReportAction.countDocuments({ reportId: rep._id }), 1);
  const a1 = await AuditEvent.findOne({ action: 'report.suspend', targetId: rep._id }).lean();
  assert.equal(a1.actorAdminId, mod.id);
  assert.equal(a1.metadata.reason, 'Repeated harassment confirmed');
  assert.ok(await AuditEvent.exists({ action: 'user.status.suspended', targetId: target.id }));
  assert.ok(await Notification.exists({ userId: target.id, type: 'safety' }));
  assert.equal(await Session.countDocuments({ userId: target.id, revokedAt: null }), 0);

  const missing = await call('POST', '/v1/admin/reports/00000000-0000-4000-8000-000000000000/actions', { token: mod.token, body: { action: 'warn', reason: 'not here' } });
  assert.equal(missing.body.code, 'report_not_found');
});

test('appeal overturn restores the account and records appeal_upheld', async (t) => {
  if (skip) return t.skip(skip);
  const mod = await makeUser({ roles: ['moderator'] });
  const reporter = await makeUser();
  const target = await makeUser({ status: 'suspended' });
  const { Report, Appeal, User, ReliabilityEvent, AuditEvent } = require('../src/models');
  const rep = await Report.create({ reporterUserId: reporter.id, reportedUserId: target.id, reasonCode: 'spam', status: 'appealed' });
  const none = await call('POST', `/v1/admin/reports/${rep._id}/appeal`, { token: mod.token, body: { decision: 'overturn', reason: 'Mistaken identity' } });
  assert.equal(none.body.code, 'no_open_appeal');
  await Appeal.create({ reportId: rep._id, userId: target.id, statement: 'That was not me.' });
  const r = await call('POST', `/v1/admin/reports/${rep._id}/appeal`, { token: mod.token, body: { decision: 'overturn', reason: 'Mistaken identity' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'dismissed');
  assert.equal(r.body.appeals[0].status, 'overturned');
  assert.equal((await User.findById(target.id).lean()).status, 'active');
  assert.ok(await ReliabilityEvent.exists({ userId: target.id, kind: 'appeal_upheld' }));
  assert.ok(await AuditEvent.exists({ action: 'appeal.overturn', targetId: rep._id }));
});

test('user detail, status change and audit log', async (t) => {
  if (skip) return t.skip(skip);
  const mod = await makeUser({ roles: ['moderator'], name: 'Mo' });
  const target = await makeUser({ name: 'Target' });
  const st = await call('POST', `/v1/admin/users/${target.id}/status`, { token: mod.token, body: { status: 'limited', reason: 'Pending review of reports' } });
  assert.deepEqual(st.body, { id: target.id, status: 'limited' });
  const missing = await call('POST', '/v1/admin/users/nope/status', { token: mod.token, body: { status: 'limited', reason: 'Pending review' } });
  assert.equal(missing.body.code, 'user_not_found');

  const d = await call('GET', `/v1/admin/users/${target.id}`, { token: mod.token });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.status, 'limited');
  assert.equal(d.body.profile.name, 'Target');
  assert.equal(d.body.stats.hosted, 0);
  const entry = d.body.audit.find((a) => a.action === 'user.status.limited');
  assert.ok(entry);
  assert.deepEqual(entry.actor, { type: 'admin', id: mod.id, name: 'Mo', email: null });

  const log = await call('GET', `/v1/admin/audit?entityType=user&entityId=${target.id}&action=user.`, { token: mod.token });
  assert.equal(log.status, 200);
  assert.ok(log.body.items.some((a) => a.action === 'user.status.limited'));
  assert.ok(log.body.items.some((a) => a.action === 'user.viewed'));
  assert.ok(log.body.items.every((a) => a.entityId === target.id));
});

test('activity review: flagged queue and remove decision notify host + participants', async (t) => {
  if (skip) return t.skip(skip);
  const mod = await makeUser({ roles: ['moderator'] });
  const host = await makeUser({ name: 'Host' });
  const guest = await makeUser({ name: 'Guest' });
  const { Activity, Participant, Report, Notification, Category } = require('../src/models');
  await Category.create({ slug: 'nightlife', label: 'Nightlife', riskLevel: 'elevated' });
  const flagged = await Activity.create({ hostUserId: host.id, category: 'nightlife', title: 'Club night', startsAt: later(30), endsAt: later(32), latitude: 23, longitude: 72.5 });
  const clean = await Activity.create({ hostUserId: host.id, category: 'chai', title: 'Chai', startsAt: new Date(Date.parse('2030-01-01T06:00:00Z')), endsAt: new Date(Date.parse('2030-01-01T07:00:00Z')), latitude: 23, longitude: 72.5 });
  await Report.create({ reporterUserId: guest.id, activityId: flagged._id, reasonCode: 'unsafe' });
  await Participant.create({ activityId: flagged._id, userId: guest.id, state: 'accepted' });

  const q = await call('GET', '/v1/admin/activities?queue=flagged', { token: mod.token });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const ids = q.body.items.map((a) => a.id);
  assert.ok(ids.includes(flagged._id));
  assert.ok(!ids.includes(clean._id));
  const item = q.body.items.find((a) => a.id === flagged._id);
  assert.equal(item.riskLevel, 'elevated');
  assert.equal(item.reportCount, 1);
  assert.equal(item.host.name, 'Host');

  const rm = await call('POST', `/v1/admin/activities/${flagged._id}/decision`, { token: mod.token, body: { decision: 'remove', reason: 'Not a public venue' } });
  assert.deepEqual(rm.body, { id: flagged._id, decision: 'remove' });
  const after = await Activity.findById(flagged._id).lean();
  assert.equal(after.status, 'moderated');
  assert.equal(after.review.status, 'removed');
  assert.ok(await Notification.exists({ userId: host.id, title: 'Your plan was removed' }));
  assert.ok(await Notification.exists({ userId: guest.id, title: 'A plan you joined was removed' }));

  const recent = await call('GET', '/v1/admin/activities?queue=recent', { token: mod.token });
  assert.equal(recent.body.items.length, 2);
});

test('taxonomy edits are audited with the written reason', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await makeUser({ roles: ['admin'], name: 'Ada' });
  const { AuditEvent } = require('../src/models');

  const c = await call('POST', '/v1/admin/taxonomy/categories', { token: admin.token, body: { slug: 'pickleball', label: 'Pickleball', reason: 'New sport demand in pilot' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.short, 'Pickleball');
  const dup = await call('POST', '/v1/admin/taxonomy/categories', { token: admin.token, body: { slug: 'pickleball', label: 'Pickleball', reason: 'Duplicate attempt' } });
  assert.equal(dup.status, 409);

  const noReason = await call('PATCH', '/v1/admin/taxonomy/categories/pickleball', { token: admin.token, body: { riskLevel: 'elevated' } });
  assert.equal(noReason.status, 400);
  const p = await call('PATCH', '/v1/admin/taxonomy/categories/pickleball', { token: admin.token, body: { riskLevel: 'elevated', active: false, reason: 'Injury reports at night games' } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.riskLevel, 'elevated');
  assert.equal(p.body.active, false);
  const ev = await AuditEvent.findOne({ action: 'taxonomy.category.update', targetId: 'pickleball' }).lean();
  assert.equal(ev.actorAdminId, admin.id);
  assert.equal(ev.metadata.reason, 'Injury reports at night games');
  assert.equal(ev.metadata.riskLevel, 'elevated');
  const nf = await call('PATCH', '/v1/admin/taxonomy/categories/nope', { token: admin.token, body: { label: 'x', reason: 'checking 404' } });
  assert.equal(nf.body.code, 'category_not_found');

  const cats = await call('GET', '/v1/admin/taxonomy/categories', { token: admin.token });
  assert.equal(cats.body.items[0].activityCount, 0);

  const area = await call('POST', '/v1/admin/taxonomy/areas', { token: admin.token, body: { city: 'Ahmedabad', name: 'Thaltej', latitude: 23.05, longitude: 72.51, reason: 'New pilot cluster' } });
  assert.equal(area.status, 201, JSON.stringify(area.body));
  assert.equal(area.body.latitude, 23.05);
  const half = await call('PATCH', `/v1/admin/taxonomy/areas/${area.body.id}`, { token: admin.token, body: { latitude: 23.06, reason: 'Fix centroid' } });
  assert.equal(half.body.code, 'invalid_location');
  const moved = await call('PATCH', `/v1/admin/taxonomy/areas/${area.body.id}`, { token: admin.token, body: { latitude: 23.06, longitude: 72.52, reason: 'Fix centroid' } });
  assert.equal(moved.body.longitude, 72.52);
  assert.ok(await AuditEvent.exists({ action: 'taxonomy.area.update', targetId: area.body.id }));

  const badQuest = await call('POST', '/v1/admin/taxonomy/quests', { token: admin.token, body: { slug: 'msg-spree', kind: 'daily', title: 'Chatty', description: 'Send 50 messages', criteria: { type: 'messages_sent' }, xpReward: 10, reason: 'Testing guardrail' } });
  assert.equal(badQuest.body.code, 'invalid_criteria');
  const quest = await call('POST', '/v1/admin/taxonomy/quests', { token: admin.token, body: { slug: 'try-two', kind: 'weekly', title: 'Try two', description: 'Two categories', criteria: { type: 'distinct_categories', count: 2 }, xpReward: 50, reason: 'Weekly variety quest' } });
  assert.equal(quest.status, 201, JSON.stringify(quest.body));
  const qp = await call('PATCH', '/v1/admin/taxonomy/quests/try-two', { token: admin.token, body: { xpReward: 60, endsAt: null, reason: 'Balance XP' } });
  assert.equal(qp.body.xpReward, 60);
  assert.equal(qp.body.endsAt, null);
  const quests = await call('GET', '/v1/admin/taxonomy/quests', { token: admin.token });
  assert.equal(quests.body.items[0].claims, 0);
});

test('billing (admin only): subscriptions search and campaigns/invoices/businesses', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await makeUser({ roles: ['admin'] });
  const buyer = await makeUser({ name: 'Priya' });
  const { Subscription, BusinessProfile, SponsoredCampaign, Venue, AuditEvent } = require('../src/models');
  await Subscription.create({ userId: buyer.id, store: 'apple', productId: 'irl_plus_monthly', status: 'active', storeTransactionId: 'tx-a', originalTransactionId: 'otx-a' });
  const s = await call('GET', '/v1/admin/billing/subscriptions?q=priya', { token: admin.token });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.items.length, 1);
  assert.equal(s.body.items[0].user.name, 'Priya');
  const byTx = await call('GET', '/v1/admin/billing/subscriptions?q=otx-a', { token: admin.token });
  assert.equal(byTx.body.items.length, 1);

  const b = await BusinessProfile.create({ ownerUserId: buyer.id, name: 'Dice Café', kind: 'venue', staff: [{ userId: buyer.id, role: 'owner' }] });
  await Venue.create({ businessId: b._id, name: 'Dice Café', latitude: 23, longitude: 72.5 });
  const c = await SponsoredCampaign.create({ businessId: b._id, title: 'Promo', budgetMinor: 50000, startsAt: later(1), endsAt: later(48) });
  const bc = await call('GET', '/v1/admin/billing/campaigns', { token: admin.token });
  assert.equal(bc.status, 200);
  assert.equal(bc.body.campaigns[0].label, 'Sponsored');
  assert.equal(bc.body.campaigns[0].business.name, 'Dice Café');
  assert.equal(bc.body.businesses[0].verificationStatus, 'pending');

  const dec = await call('POST', `/v1/admin/billing/campaigns/${c._id}/decision`, { token: admin.token, body: { decision: 'approve', reason: 'Labelled and compliant' } });
  assert.deepEqual(dec.body, { id: c._id, status: 'active' });
  const ver = await call('POST', `/v1/admin/businesses/${b._id}/verification`, { token: admin.token, body: { decision: 'verify', reason: 'GST and proof checked' } });
  assert.deepEqual(ver.body, { id: b._id, verificationStatus: 'verified' });
  assert.equal((await Venue.findOne({ businessId: b._id }).lean()).verified, true);
  assert.ok(await AuditEvent.exists({ action: 'business.verify', targetId: b._id }));
});
