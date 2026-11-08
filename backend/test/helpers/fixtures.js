'use strict';
// DB test fixtures for the community/chat/money/safety suites: users with access
// tokens, plans with accepted members, and a tiny HTTP client against the real app.
const http = require('http');

let seq = 0;

async function startApp() {
  const { createApp } = require('../../src/app');
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, stop: () => new Promise((r) => server.close(r)) };
}

function client(base) {
  return async function call(method, path, { token, body, headers = {} } = {}) {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

async function makeUser(name, { roles = [], ageVerified = true, status = 'active', homeArea = 'Navrangpura', interests = [] } = {}) {
  const { User } = require('../../src/models');
  const { signAccessToken } = require('../../src/lib/tokens');
  seq += 1;
  const u = await User.create({
    phone: `+9198${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`.slice(0, 13),
    ageVerified,
    status,
    roles,
    profile: { displayName: name, homeArea, interests },
  });
  return { id: u._id, name, token: signAccessToken({ userId: u._id, roles, sid: `test-${u._id}` }) };
}

// A plan hosted by `host` with `members` accepted (and optional others in `pending` as requested).
async function makePlan(host, members = [], { pending = [], withChat = true, capacity = 8 } = {}) {
  const { Activity, Participant, Conversation, ConversationMember } = require('../../src/models');
  const start = new Date(Date.now() + 3 * 3600000);
  const a = await Activity.create({
    hostUserId: host.id,
    category: 'chai',
    title: `Chai ${++seq}`,
    startsAt: start,
    endsAt: new Date(start.getTime() + 3600000),
    capacity,
    coarseArea: 'Navrangpura',
    latitude: 23.0365,
    longitude: 72.5611,
    acceptedCount: 1 + members.length,
  });
  await Participant.create({ activityId: a._id, userId: host.id, state: 'accepted', decidedAt: new Date() });
  for (const m of members) await Participant.create({ activityId: a._id, userId: m.id, state: 'accepted', decidedAt: new Date() });
  for (const m of pending) await Participant.create({ activityId: a._id, userId: m.id, state: 'requested' });
  let conversationId = null;
  if (withChat) {
    const c = await Conversation.create({ kind: 'activity_group', activityId: a._id });
    conversationId = c._id;
    for (const m of [host, ...members]) await ConversationMember.create({ conversationId: c._id, userId: m.id });
  }
  return { id: a._id, conversationId };
}

module.exports = { startApp, client, makeUser, makePlan };
