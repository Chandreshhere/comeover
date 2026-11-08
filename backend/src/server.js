'use strict';
// Process entry: HTTP + WebSocket (/ws) + job worker, with graceful shutdown.
const http = require('http');
const config = require('./config');
const logger = require('./logger');
const db = require('./lib/db');
const realtime = require('./lib/realtime');
const jobs = require('./lib/jobs');

async function start({ port = config.port } = {}) {
  if (!config.jwt.secret || config.jwt.secret.length < 32) {
    logger.warn({ msg: 'jwt_secret_missing', hint: 'Set JWT_SECRET (≥32 chars); auth endpoints return 503 until then.' });
  }
  require('./lib/testLogin').logStatus(logger);
  await db.connect();
  const { createApp } = require('./app');
  const app = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000; // above typical load balancer idle timeouts
  server.headersTimeout = 66000;

  realtime.attach(server, { path: '/ws' });
  await realtime.startFanout();

  require('./jobs').registerAll();
  jobs.start({ id: realtime.INSTANCE_ID });

  await new Promise((resolve) => server.listen(port, resolve));
  logger.info({ msg: 'listening', port, routes: app.locals.handlers.routes.length, modules: app.locals.handlers.mounted, missing: app.locals.handlers.missing });

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ msg: 'shutting_down', signal });
    const force = setTimeout(() => process.exit(1), 15000);
    force.unref();
    server.close();
    await realtime.close().catch(() => {});
    await jobs.stop().catch(() => {});
    await db.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return { app, server };
}

if (require.main === module) {
  start().catch((e) => {
    logger.fatal({ msg: 'boot_failed', err: e.message, stack: e.stack });
    process.exit(1);
  });
}

module.exports = { start };
