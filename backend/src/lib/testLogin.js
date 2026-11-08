'use strict';
// TEMPORARY fixed-code sign-in for ONE phone number, used to test the apps before
// Slide OTP is configured. Everything fails closed:
//   - needs TEST_LOGIN_PHONE and TEST_LOGIN_CODE;
//   - in production it also needs TEST_LOGIN_ALLOW_PRODUCTION=true and a valid,
//     future TEST_LOGIN_EXPIRES_AT (so it cannot be left on forever by accident);
//   - an unparsable expiry or phone disables it.
// Remove it by deleting the TEST_LOGIN_* variables (and redeploying).
const crypto = require('crypto');
const config = require('../config');
const { normalizePhone, maskPhone } = require('./phone');

function settings() {
  const t = config.testLogin;
  if (!t.phone || !t.code) return null;
  const production = config.env === 'production';
  if (production && !t.allowProduction) return null;
  let phone;
  try {
    phone = normalizePhone(t.phone);
  } catch (e) {
    return null;
  }
  let expiresAt = null;
  if (t.expiresAt) {
    expiresAt = new Date(t.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return null;
  } else if (production) {
    return null;
  }
  return { phone, code: String(t.code), expiresAt };
}

function isActive() {
  const s = settings();
  return !!s && (!s.expiresAt || s.expiresAt > new Date());
}

// True when `phone` (E.164) is the test number and the test login is currently active.
function matchesPhone(phone) {
  const s = settings();
  return !!s && isActive() && s.phone === phone;
}

function checkCode(code) {
  const s = settings();
  if (!s || !isActive()) return false;
  const a = crypto.createHash('sha256').update(String(code)).digest();
  const b = crypto.createHash('sha256').update(s.code).digest();
  return crypto.timingSafeEqual(a, b);
}

const codeLength = () => {
  const s = settings();
  return s ? s.code.length : 0;
};

// One loud line at boot so an enabled test login is never a surprise.
function logStatus(logger) {
  const s = settings();
  if (!s) return;
  logger.warn({
    msg: 'test_login_enabled',
    phone: maskPhone(s.phone),
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    active: isActive(),
    hint: 'Fixed-code sign-in is ON for one number. Remove TEST_LOGIN_* before real use.',
  });
}

module.exports = { isActive, matchesPhone, checkCode, codeLength, logStatus };
