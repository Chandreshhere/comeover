#!/usr/bin/env node
'use strict';
// Clear the sign-in rate-limit buckets for one phone number (e.g. after repeated test sign-ins).
//   node --env-file=.env scripts/reset-otp-limits.js 98xxxxxxxx
const db = require('../src/lib/db');
const { normalizePhone } = require('../src/lib/phone');

(async () => {
  const raw = process.argv[2] || process.env.SEED_TEST_PHONE || process.env.TEST_LOGIN_PHONE;
  if (!raw) {
    console.error('usage: node --env-file=.env scripts/reset-otp-limits.js <phone>');
    process.exit(2);
  }
  const phone = normalizePhone(raw);
  await db.connect();
  const { RateLimit } = require('../src/models');
  const r = await RateLimit.deleteMany({ _id: { $in: ['otp_send_phone', 'otp_resend_phone', 'otp_verify_phone'].map((n) => `${n}:${phone}`) } });
  console.log(`cleared ${r.deletedCount} sign-in limit bucket(s)`);
  await db.disconnect();
})().catch(async (e) => {
  console.error(e.message || e);
  await db.disconnect().catch(() => {});
  process.exit(1);
});
