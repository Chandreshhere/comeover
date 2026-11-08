'use strict';
// Postgres token bucket (single atomic upsert; no extra infrastructure).
// Rate-limits OTP, create-plan, join-request, chat and report endpoints.
const { err } = require('./http');

const LIMITS = {
  otp_send_phone: { capacity: 3, perHour: 3 },
  otp_send_ip: { capacity: 20, perHour: 20 },
  otp_verify_phone: { capacity: 10, perHour: 10 },
  create_plan: { capacity: 10, perDay: 10 },
  join_request: { capacity: 30, perDay: 30 },
  chat_message: { capacity: 30, perMinute: 60 },
  report: { capacity: 20, perDay: 20 },
  block: { capacity: 50, perDay: 50 },
  trusted_share: { capacity: 10, perDay: 10 },
  circle_create: { capacity: 3, perDay: 3 },
  media_upload: { capacity: 30, perHour: 30 },
  expense_create: { capacity: 30, perDay: 30 },
  data_export: { capacity: 3, perDay: 3 },
};

function ratePerSec(l) {
  if (l.perMinute) return l.perMinute / 60;
  if (l.perHour) return l.perHour / 3600;
  if (l.perDay) return l.perDay / 86400;
  return l.capacity / 60;
}

// Pure: tokens after refill + one take. Floor at -1 so hammering doesn't bury the bucket.
function nextTokens(current, elapsedSec, capacity, rate, cost = 1) {
  const start = current == null ? capacity : current;
  const refilled = Math.min(capacity, start + Math.max(0, elapsedSec) * rate);
  return Math.max(-1, refilled - cost);
}

function retryAfterSec(tokensAfter, rate) {
  if (tokensAfter >= 0) return 0;
  return Math.max(1, Math.ceil((1 - tokensAfter) / rate));
}

async function consume(db, name, subject, cost = 1) {
  const l = LIMITS[name];
  if (!l) throw new Error(`unknown rate limit ${name}`);
  const rate = ratePerSec(l);
  const key = `${name}:${subject}`;
  const { rows } = await db.query(
    `INSERT INTO rate_limits (bucket_key, tokens, updated_at) VALUES ($1, $2 - $4, now())
     ON CONFLICT (bucket_key) DO UPDATE SET
       tokens = GREATEST(-1, LEAST($2, rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.updated_at)) * $3) - $4),
       updated_at = now()
     RETURNING tokens`,
    [key, l.capacity, rate, cost]
  );
  const tokens = Number(rows[0].tokens);
  return { allowed: tokens >= 0, tokens, retryAfterSec: retryAfterSec(tokens, rate) };
}

async function enforce(db, name, subject, cost = 1) {
  const r = await consume(db, name, subject, cost);
  if (!r.allowed) throw err.tooMany(r.retryAfterSec);
  return r;
}

module.exports = { LIMITS, ratePerSec, nextTokens, retryAfterSec, consume, enforce };
