'use strict';
// Express application (no listening — see server.js). Exported for tests.
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const db = require('./lib/db');
const { json, mapError } = require('./lib/http');
const { bearer } = require('./lib/auth');
const { verifyAccessToken } = require('./lib/tokens');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: config.corsOrigins.length ? (config.corsOrigins.includes('*') ? true : config.corsOrigins) : false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['Retry-After', 'Idempotent-Replay', 'X-Request-Id'],
      maxAge: 600,
    })
  );

  // Request id + access log.
  app.use((req, res, next) => {
    req.id = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 64);
    res.setHeader('x-request-id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/healthz') return;
      logger.info({ msg: 'request', id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6 });
    });
    next();
  });

  // JSON bodies (raw bytes kept for webhook signature checks → req.rawBody()).
  app.use(
    express.json({
      limit: '1mb',
      type: ['application/json', 'application/*+json'],
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Verify the bearer token once; handlers call requireUser()/requireAdmin().
  app.use((req, res, next) => {
    const token = bearer(req);
    if (token) {
      try {
        req.authClaims = verifyAccessToken(token);
      } catch (e) {
        req.authError = e;
      }
    }
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', async (req, res) => {
    const mongo = await db.ping();
    const rt = require('./lib/realtime').stats();
    res.status(mongo ? 200 : 503).json({ ok: mongo, mongo, realtime: rt.mode });
  });

  const handlers = require('./handlers');
  app.locals.handlers = handlers.mountAll(app);

  app.use((req, res) => {
    const out = json(404, { code: 'route_not_found', message: `No route for ${req.method} ${req.path}` });
    res.status(out.statusCode).set(out.headers).send(out.body);
  });

  // Body-parser and unexpected errors.
  // eslint-disable-next-line no-unused-vars
  app.use((e, req, res, next) => {
    let out;
    if (e && e.type === 'entity.parse.failed') out = json(400, { code: 'invalid_json', message: 'Request body must be valid JSON' });
    else if (e && e.type === 'entity.too.large') out = json(413, { code: 'payload_too_large', message: 'Request body is too large' });
    else out = mapError(e, { route: `${req.method} ${req.path}` });
    res.status(out.statusCode).set(out.headers).send(out.body);
  });

  return app;
}

module.exports = { createApp };
