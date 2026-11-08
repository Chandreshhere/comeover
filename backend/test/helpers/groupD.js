'use strict';
// Test harness for the monetisation / webhooks / admin modules: mounts only
// those route maps on an Express app with the same middleware as src/app.js
// (raw-body capture + bearer verification), so other modules don't affect these tests.
const http = require('http');
const express = require('express');

async function startApp(moduleNames = ['monetization', 'webhooks', 'admin']) {
  const { mountRoutes } = require('../../src/lib/http');
  const { bearer } = require('../../src/lib/auth');
  const { verifyAccessToken } = require('../../src/lib/tokens');
  const app = express();
  app.use(express.json({ limit: '1mb', verify: (req, res, buf) => (req.rawBody = buf) }));
  app.use((req, res, next) => {
    const t = bearer(req);
    if (t) {
      try {
        req.authClaims = verifyAccessToken(t);
      } catch (e) {
        req.authError = e;
      }
    }
    next();
  });
  for (const m of moduleNames) mountRoutes(app, require(`../../src/handlers/${m}`).routes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

function client(base) {
  return async function call(method, path, { body, token, headers = {}, raw } = {}) {
    const h = { 'content-type': 'application/json', ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
  };
}

let seq = 0;
async function makeUser({ roles = [], name = 'Test User', ageVerified = true, status = 'active', phone } = {}) {
  const { User } = require('../../src/models');
  const { signAccessToken } = require('../../src/lib/tokens');
  seq += 1;
  const u = await User.create({
    phone: phone || `+9198${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`,
    roles,
    status,
    ageVerified,
    profile: { displayName: name },
  });
  return { id: u._id, user: u, token: signAccessToken({ userId: u._id, roles, sid: `test-${seq}` }) };
}

module.exports = { startApp, client, makeUser };
