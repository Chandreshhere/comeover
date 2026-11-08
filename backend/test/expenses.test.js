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

const sum = (shares) => shares.reduce((n, s) => n + s.amountMinor, 0);

test('equal split sums to the paisa; payee share auto-confirmed; bankVerified always false', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  const c = await makeUser('Chirag');
  const plan = await makePlan(a, [b, c]);
  const r = await call('POST', '/v1/expenses', {
    token: a.token,
    body: { activityId: plan.id, description: 'Court booking', totalMinor: 100000 + 1, splitMethod: 'equal', participantIds: [b.id, c.id], payeeUpi: 'asha@okbank' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(sum(r.body.shares), 100001);
  assert.deepEqual(
    r.body.shares.map((s) => s.amountMinor),
    [33334, 33334, 33333].sort((x, y) => y - x)
  );
  const mine = r.body.shares.find((s) => s.userId === a.id);
  assert.equal(mine.state, 'confirmed');
  assert.ok(r.body.shares.every((s) => s.bankVerified === false));
  assert.equal(r.body.payeeUpi, 'asha@okbank');
  const { Notification } = require('../src/models');
  assert.equal(await Notification.countDocuments({ title: /split "Court booking"/ }), 2);

  // Settlement intent builds a UPI deep link only (no money moves through IRL).
  const intent = await call('POST', `/v1/expenses/${r.body.id}/settlement-intent`, { token: b.token });
  assert.equal(intent.status, 200);
  assert.match(intent.body.upiLink, /^upi:\/\/pay\?pa=asha%40okbank/);
  assert.equal(intent.body.hasUpi, true);
});

test('only the payee confirms; owner marks paid; either party disputes', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  const c = await makeUser('Chirag');
  await makePlan(a, [b, c]);
  const e = (await call('POST', '/v1/expenses', { token: a.token, body: { description: 'Chai', totalMinor: 9000, splitMethod: 'equal', participantIds: [b.id, c.id] } })).body;

  let r = await call('PATCH', `/v1/expenses/${e.id}/shares/${b.id}`, { token: b.token, body: { state: 'marked_paid', paymentReference: 'UTR123' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.shares.find((s) => s.userId === b.id).state, 'marked_paid');
  // A non-payee can't confirm (not even their own share).
  r = await call('PATCH', `/v1/expenses/${e.id}/shares/${b.id}`, { token: b.token, body: { state: 'confirmed' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'forbidden');
  // …nor touch someone else's share.
  r = await call('PATCH', `/v1/expenses/${e.id}/shares/${c.id}`, { token: b.token, body: { state: 'marked_paid' } });
  assert.equal(r.status, 403);
  // The payee confirms via the settlement-confirmation shortcut.
  r = await call('POST', `/v1/expenses/${e.id}/settlement-confirmation`, { token: a.token, body: { action: 'confirm', userId: b.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const share = r.body.shares.find((s) => s.userId === b.id);
  assert.equal(share.state, 'confirmed');
  assert.equal(share.paymentReference, 'UTR123');
  // Either party may dispute.
  r = await call('PATCH', `/v1/expenses/${e.id}/shares/${c.id}`, { token: a.token, body: { state: 'disputed' } });
  assert.equal(r.body.shares.find((s) => s.userId === c.id).state, 'disputed');

  const summary = await call('GET', `/v1/expenses/${e.id}/summary`, { token: c.token });
  assert.equal(summary.body.totals.confirmedMinor, 6000);
  assert.equal(summary.body.totals.outstandingMinor, 3000);
  assert.equal(summary.body.payee.name, 'Asha');
  assert.ok(summary.body.disclaimer);
});

test('custom / percentage / itemised maths and validation', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  await makePlan(a, [b]);
  let r = await call('POST', '/v1/expenses', { token: a.token, body: { description: 'x', totalMinor: 1000, splitMethod: 'custom', amounts: { [a.id]: 400, [b.id]: 500 }, participantIds: [b.id] } });
  assert.equal(r.body.code, 'custom_amounts_mismatch');
  r = await call('POST', '/v1/expenses', { token: a.token, body: { description: 'x', totalMinor: 1000, splitMethod: 'percentage', shares: [{ userId: a.id, percent: 30 }, { userId: b.id, percent: 70 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.shares.find((s) => s.userId === b.id).amountMinor, 700);
  // Itemised: 500 + 2×200 of items, 100 tax spread by subtotal.
  r = await call('POST', '/v1/expenses', {
    token: a.token,
    body: {
      description: 'Dinner',
      totalMinor: 1000,
      splitMethod: 'itemised',
      participantIds: [b.id],
      items: [
        { label: 'Thali', amountMinor: 500, assigneeIds: [a.id] },
        { label: 'Lassi', amountMinor: 200, quantity: 2, assigneeIds: [b.id] },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(sum(r.body.shares), 1000);
  assert.equal(r.body.items.length, 2);
  assert.deepEqual(r.body.items[1].assignees, [b.id]);
  assert.equal(r.body.shares.find((s) => s.userId === a.id).amountMinor, 556);
  assert.equal(r.body.shares.find((s) => s.userId === b.id).amountMinor, 444);
});

test('participants must be connected; blocked people are refused; idempotent create', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  const stranger = await makeUser('Stranger');
  await makePlan(a, [b]);
  let r = await call('POST', '/v1/expenses', { token: a.token, body: { description: 'x', totalMinor: 500, splitMethod: 'equal', participantIds: [stranger.id] } });
  assert.equal(r.body.code, 'participant_not_connected');

  const headers = { 'idempotency-key': 'expense-create-0001' };
  const body = { description: 'Snacks', totalMinor: 500, splitMethod: 'equal', participantIds: [b.id] };
  const one = await call('POST', '/v1/expenses', { token: a.token, body, headers });
  const two = await call('POST', '/v1/expenses', { token: a.token, body, headers });
  assert.equal(one.status, 201);
  assert.equal(two.body.id, one.body.id);
  const { Expense } = require('../src/models');
  assert.equal(await Expense.countDocuments({ creatorUserId: a.id }), 1);

  await call('POST', '/v1/blocks', { token: b.token, body: { userId: a.id } });
  r = await call('POST', '/v1/expenses', { token: a.token, body: { description: 'y', totalMinor: 500, splitMethod: 'equal', participantIds: [b.id] } });
  assert.equal(r.body.code, 'participant_blocked');

  // Only people on the expense can see it.
  assert.equal((await call('GET', `/v1/expenses/${one.body.id}`, { token: stranger.token })).body.code, 'expense_not_found');
  const list = await call('GET', '/v1/expenses', { token: b.token });
  assert.deepEqual(
    list.body.items.map((x) => x.id),
    [one.body.id]
  );
});
