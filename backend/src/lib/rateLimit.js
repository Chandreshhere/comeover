'use strict';
// Token-bucket rate limits stored in MongoDB (one atomic pipeline upsert per check).
// Rate-limits OTP, create-plan, join-request, chat, report endpoints, etc.
//
//   await enforce('join_request', user.id)        // throws 429 rate_limited with Retry-After
//   const r = await consume('otp_send_ip', ip)   // { allowed, tokens, retryAfterSec }
const { err } = require('./http');

const LIMITS = {
  otp_send_phone: { capacity: 3, perHour: 3 },
  otp_send_ip: { capacity: 20, perHour: 20 },
  otp_resend_phone: { capacity: 5, perHour: 5 },
  otp_verify_phone: { capacity: 10, perHour: 10 },
  otp_verify_ip: { capacity: 60, perHour: 60 },
  refresh_ip: { capacity: 120, perHour: 120 },
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
  assistant: { capacity: 10, perMinute: 10 },
  search: { capacity: 60, perMinute: 60 },
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

async function consume(name, subject, cost = 1, { limits = LIMITS } = {}) {
  const l = limits[name];
  if (!l) throw new Error(`unknown rate limit ${name}`);
  const { RateLimit } = require('../models');
  const rate = ratePerSec(l);
  const now = new Date();
  const elapsedSec = { $divide: [{ $subtract: [now, { $ifNull: ['$updatedAt', now] }] }, 1000] };
  const refilled = { $min: [l.capacity, { $add: [{ $ifNull: ['$tokens', l.capacity] }, { $multiply: [elapsedSec, rate] }] }] };
  const doc = await RateLimit.collection.findOneAndUpdate(
    { _id: `${name}:${subject}` },
    [{ $set: { tokens: { $max: [-1, { $subtract: [refilled, cost] }] }, updatedAt: now, expireAt: new Date(now.getTime() + 7 * 86400000) } }],
    { upsert: true, returnDocument: 'after' }
  );
  const value = doc && doc.value !== undefined && doc.ok !== undefined ? doc.value : doc; // driver v5/v6 shapes
  const tokens = Number(value.tokens);
  return { allowed: tokens >= 0, tokens, retryAfterSec: retryAfterSec(tokens, rate) };
}

async function enforce(name, subject, cost = 1, { code = 'rate_limited', message } = {}) {
  const r = await consume(name, subject, cost);
  if (!r.allowed) throw err.tooMany(r.retryAfterSec, code, message);
  return r;
}

module.exports = { LIMITS, ratePerSec, nextTokens, retryAfterSec, consume, enforce };
