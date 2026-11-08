'use strict';
// MongoDB connection (Mongoose) + transaction helper.
//
// withTransaction(fn): runs fn(session, after) inside a multi-document
// transaction (requires a replica set — Atlas, or `rs0` in docker-compose).
// Pass `{ session }` to every model call inside fn. `after(cb)` registers side
// effects (realtime publish, job enqueue) that run only after COMMIT.
// Transient errors are retried by the driver's withTransaction.
const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../logger');

// strictQuery drops filter paths that aren't in the schema. Never pass raw request
// objects into filters: validate with lib/validate (types/enums) or String(...) values,
// so a body like { "phone": { "$ne": null } } can't become a query operator.
mongoose.set('strictQuery', true);

let connecting = null;

async function connect(uri = config.mongoUri, opts = {}) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: Number(process.env.MONGO_POOL_MAX || 20), autoIndex: true, ...opts })
      .then((m) => {
        logger.info({ msg: 'mongo_connected', host: m.connection.host, db: m.connection.name });
        return m.connection;
      })
      .catch((e) => {
        connecting = null;
        throw e;
      });
  }
  return connecting;
}

async function disconnect() {
  connecting = null;
  await mongoose.disconnect();
}

async function ping() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch (e) {
    return false;
  }
}

// Ensure every model's indexes exist (call once at boot / in tests).
async function syncIndexes() {
  const models = require('../models');
  await Promise.all(Object.values(models).filter((m) => m && m.createIndexes).map((m) => m.createIndexes()));
}

async function withTransaction(fn) {
  const session = await mongoose.startSession();
  let afterCommit = [];
  let result;
  try {
    await session.withTransaction(async () => {
      afterCommit = []; // reset on driver retry
      result = await fn(session, (cb) => afterCommit.push(cb));
    });
  } finally {
    await session.endSession();
  }
  for (const cb of afterCommit) {
    try {
      await cb();
    } catch (e) {
      logger.error({ msg: 'after_commit_failed', err: e.message });
    }
  }
  return result;
}

// Whether the connected deployment supports transactions/change streams.
async function isReplicaSet() {
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return !!(hello.setName || hello.msg === 'isdbgrid');
  } catch (e) {
    return false;
  }
}

module.exports = { mongoose, connect, disconnect, ping, syncIndexes, withTransaction, isReplicaSet };
