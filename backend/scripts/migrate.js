#!/usr/bin/env node
'use strict';
// Applies db/migrations/*.sql in order, each in its own transaction, recording
// them in schema_migrations. Uses DATABASE_URL (or DB_SECRET_ARN via src/lib/db).
const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');

async function main() {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const pool = await db.getPool();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) {
      console.log(`= ${f}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`+ ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`! ${f}: ${e.message}`);
      process.exitCode = 1;
      client.release();
      break;
    }
    client.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
