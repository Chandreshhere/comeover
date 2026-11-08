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

test('direct chat needs a shared accepted plan; unread counts and read marker', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  let r = await call('POST', '/v1/conversations', { token: a.token, body: { kind: 'direct', userId: b.id } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'chat_not_available');

  await makePlan(a, [b]);
  r = await call('POST', '/v1/conversations', { token: a.token, body: { kind: 'direct', userId: b.id } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const conv = r.body;
  assert.equal(conv.kind, 'direct');
  assert.equal(conv.title, 'Bilal');
  assert.deepEqual([...conv.memberIds].sort(), [a.id, b.id].sort());
  const again = await call('POST', '/v1/conversations', { token: a.token, body: { kind: 'direct', userId: b.id } });
  assert.equal(again.body.id, conv.id, 'same direct conversation is reused');

  const sent = await call('POST', `/v1/conversations/${conv.id}/messages`, { token: a.token, body: { body: 'Same time next week?' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.senderId, a.id);

  let inbox = await call('GET', '/v1/conversations', { token: b.token });
  const row = inbox.body.items.find((x) => x.id === conv.id);
  assert.equal(row.unread, 1);
  assert.equal(row.title, 'Asha');
  assert.equal(row.lastMessage.body, 'Same time next week?');
  assert.equal((await call('POST', `/v1/conversations/${conv.id}/read`, { token: b.token })).status, 200);
  inbox = await call('GET', '/v1/conversations', { token: b.token });
  assert.equal(inbox.body.items.find((x) => x.id === conv.id).unread, 0);

  // The sender's own messages never count as unread.
  inbox = await call('GET', '/v1/conversations', { token: a.token });
  assert.equal(inbox.body.items.find((x) => x.id === conv.id).unread, 0);
});

test('plan group chat: only accepted participants can post', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const yes = await makeUser('Accepted');
  const maybe = await makeUser('Requested');
  const outsider = await makeUser('Outsider');
  const plan = await makePlan(host, [yes], { pending: [maybe] });
  const { ConversationMember, Participant } = require('../src/models');
  assert.equal((await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: yes.token, body: { body: 'Hi!' } })).status, 201);
  // Not a member of the chat at all → not found.
  const o = await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: outsider.token, body: { body: 'Hi?' } });
  assert.equal(o.status, 404);
  assert.equal(o.body.code, 'conversation_not_found');
  // A chat member whose request isn't accepted → chat_closed.
  await ConversationMember.create({ conversationId: plan.conversationId, userId: maybe.id });
  const m = await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: maybe.token, body: { body: 'Me too?' } });
  assert.equal(m.status, 403);
  assert.equal(m.body.code, 'chat_closed');
  // Once they leave the plan, an accepted member loses posting rights too.
  await Participant.updateOne({ activityId: plan.id, userId: yes.id }, { $set: { state: 'cancelled' } });
  assert.equal((await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: yes.token, body: { body: 'Bye' } })).body.code, 'chat_closed');
  // The host can always post.
  assert.equal((await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: host.token, body: { body: 'See you' } })).status, 201);
});

test('blocked senders are hidden in group chats, and blocking hides direct chats', async (t) => {
  if (skip) return t.skip(skip);
  const host = await makeUser('Host');
  const b = await makeUser('Bea');
  const c = await makeUser('Chirag');
  const plan = await makePlan(host, [b, c]);
  const direct = await call('POST', '/v1/conversations', { token: b.token, body: { kind: 'direct', userId: c.id } });
  assert.equal(direct.status, 201);

  await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: c.token, body: { body: 'from Chirag' } });
  await call('POST', `/v1/conversations/${plan.conversationId}/messages`, { token: host.token, body: { body: 'from Host' } });
  assert.equal((await call('POST', '/v1/blocks', { token: b.token, body: { userId: c.id } })).status, 200);

  const msgs = await call('GET', `/v1/conversations/${plan.conversationId}/messages`, { token: b.token });
  assert.deepEqual(
    msgs.body.items.map((x) => x.body),
    ['from Host']
  );
  const inbox = await call('GET', '/v1/conversations', { token: b.token });
  const group = inbox.body.items.find((x) => x.id === plan.conversationId);
  assert.equal(group.unread, 1, 'the blocked sender does not count as unread');
  assert.ok(!inbox.body.items.some((x) => x.id === direct.body.id), 'direct chat with a blocked person is hidden');
  // Hidden in both directions, and closed for posting.
  const cInbox = await call('GET', '/v1/conversations', { token: c.token });
  assert.ok(!cInbox.body.items.some((x) => x.id === direct.body.id));
  const post = await call('POST', `/v1/conversations/${direct.body.id}/messages`, { token: c.token, body: { body: 'hello?' } });
  assert.equal(post.body.code, 'conversation_not_found');
  assert.equal((await call('POST', '/v1/conversations', { token: c.token, body: { kind: 'direct', userId: b.id } })).body.code, 'blocked');
});

test('idempotent send, delete-for-me, mute, message report', async (t) => {
  if (skip) return t.skip(skip);
  const a = await makeUser('Asha');
  const b = await makeUser('Bilal');
  await makePlan(a, [b]);
  const conv = (await call('POST', '/v1/conversations', { token: a.token, body: { kind: 'direct', userId: b.id } })).body;
  const headers = { 'idempotency-key': 'msg_tmp_12345' };
  const one = await call('POST', `/v1/conversations/${conv.id}/messages`, { token: a.token, body: { body: 'once' }, headers });
  const two = await call('POST', `/v1/conversations/${conv.id}/messages`, { token: a.token, body: { body: 'once' }, headers });
  assert.equal(one.body.id, two.body.id);
  const { Message } = require('../src/models');
  assert.equal(await Message.countDocuments({ conversationId: conv.id }), 1);

  // Delete for me hides the chat until a new message arrives.
  assert.equal((await call('DELETE', `/v1/conversations/${conv.id}`, { token: b.token })).status, 200);
  assert.ok(!(await call('GET', '/v1/conversations', { token: b.token })).body.items.some((x) => x.id === conv.id));
  await new Promise((r) => setTimeout(r, 5));
  await call('POST', `/v1/conversations/${conv.id}/messages`, { token: a.token, body: { body: 'still there?' } });
  assert.ok((await call('GET', '/v1/conversations', { token: b.token })).body.items.some((x) => x.id === conv.id));

  const mute = await call('POST', `/v1/conversations/${conv.id}/mute`, { token: b.token, body: { muted: true } });
  assert.deepEqual(mute.body, { muted: true });

  const rep = await call('POST', `/v1/messages/${one.body.id}/report`, { token: b.token, body: { reasonCode: 'harassment' } });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
  assert.equal(rep.body.status, 'open');
  const own = await call('POST', `/v1/messages/${one.body.id}/report`, { token: a.token, body: { reasonCode: 'spam' } });
  assert.equal(own.body.code, 'cannot_report_message');
  const { Report, Job } = require('../src/models');
  const r = await Report.findById(rep.body.id).lean();
  assert.equal(r.reportedUserId, a.id);
  assert.equal(r.priority, 'high');
  assert.ok(await Job.exists({ type: 'moderation_alert', 'payload.reportId': rep.body.id }));
});
