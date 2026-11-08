'use strict';
// In-memory MongoDB replica set for DB tests (transactions + change streams).
// If the mongod binary can't be downloaded/started, tests are skipped with a clear message.
let rs = null;

async function startMongo() {
  let MongoMemoryReplSet;
  try {
    ({ MongoMemoryReplSet } = require('mongodb-memory-server'));
  } catch (e) {
    return { skip: 'mongodb-memory-server is not installed' };
  }
  try {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  } catch (e) {
    return { skip: `could not start in-memory MongoDB: ${String(e.message).split('\n')[0]}` };
  }
  const db = require('../../src/lib/db');
  await db.connect(rs.getUri(`irl_test_${process.pid}`));
  await db.syncIndexes();
  return { uri: rs.getUri() };
}

async function stopMongo() {
  const db = require('../../src/lib/db');
  await db.disconnect().catch(() => {});
  if (rs) await rs.stop().catch(() => {});
  rs = null;
}

async function clearCollections() {
  const { mongoose } = require('../../src/lib/db');
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

module.exports = { startMongo, stopMongo, clearCollections };
