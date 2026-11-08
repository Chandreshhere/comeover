'use strict';
// PostgreSQL via RDS Proxy. Credentials from Secrets Manager (DB_SECRET_ARN)
// in AWS, or DATABASE_URL locally. Small pool per Lambda container — the proxy
// does the multiplexing.
const { Pool } = require('pg');

let poolPromise;

async function resolveConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
  }
  if (!process.env.DB_SECRET_ARN) throw new Error('DATABASE_URL or DB_SECRET_ARN must be set');
  const { getSecretJson } = require('./aws');
  const s = await getSecretJson(process.env.DB_SECRET_ARN);
  return {
    host: process.env.DB_PROXY_ENDPOINT || s.host,
    port: Number(s.port || 5432),
    user: s.username,
    password: s.password,
    database: process.env.DB_NAME || s.dbname || 'irl',
    // RDS Proxy presents an Amazon-issued certificate trusted by Node's CA bundle.
    ssl: { rejectUnauthorized: true },
  };
}

function getPool() {
  if (!poolPromise) {
    poolPromise = resolveConfig().then((cfg) => {
      const pool = new Pool({ ...cfg, max: Number(process.env.DB_POOL_MAX || 2), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
      pool.on('error', (e) => console.error(JSON.stringify({ level: 'error', msg: 'pg_pool_error', error: e.message })));
      return pool;
    });
    poolPromise.catch(() => {
      poolPromise = undefined;
    });
  }
  return poolPromise;
}

async function query(text, params) {
  const pool = await getPool();
  return pool.query(text, params);
}

async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

// Run fn(client, after) in a transaction. `after(cb)` registers side effects
// (realtime publish, SQS enqueue) that run only after COMMIT succeeds.
async function withTransaction(fn) {
  const pool = await getPool();
  const client = await pool.connect();
  const afterCommit = [];
  let result;
  try {
    await client.query('BEGIN');
    result = await fn(client, (cb) => afterCommit.push(cb));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw e;
  }
  client.release();
  for (const cb of afterCommit) {
    try {
      await cb();
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'after_commit_failed', error: e.message }));
    }
  }
  return result;
}

module.exports = { getPool, query, one, many, withTransaction };
