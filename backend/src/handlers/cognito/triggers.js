'use strict';
// Cognito User Pool triggers implementing phone OTP via CUSTOM_AUTH.
//   PreSignUp            → auto-confirm + mark phone verified (OTP proves possession)
//   DefineAuthChallenge  → up to 3 code attempts per session
//   CreateAuthChallenge  → 6-digit code via SNS SMS (rate-limited in Postgres)
//   VerifyAuthChallenge  → constant-time compare + 5-minute expiry
//   PostAuthentication   → provision/refresh app_users row (cognito_sub ↔ phone)
const crypto = require('crypto');
const db = require('../../lib/db');
const { consume } = require('../../lib/rateLimit');
const { sendSms } = require('../../lib/aws');

const MAX_ATTEMPTS = 3;
const CODE_TTL_MS = 5 * 60 * 1000;

exports.preSignUp = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes && event.request.userAttributes.phone_number) event.response.autoVerifyPhone = true;
  return event;
};

exports.defineAuthChallenge = async (event) => {
  const session = event.request.session || [];
  const last = session[session.length - 1];
  if (event.request.userNotFound) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else if (last && last.challengeName === 'CUSTOM_CHALLENGE' && last.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (session.length >= MAX_ATTEMPTS) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
  }
  return event;
};

exports.createAuthChallenge = async (event) => {
  if (event.request.challengeName !== 'CUSTOM_CHALLENGE') return event;
  const phone = event.request.userAttributes.phone_number;
  const session = event.request.session || [];
  // Re-use the code within one auth session (retries after a typo); new session → new code.
  const prev = session.length ? session[session.length - 1].challengeMetadata : null;
  let code;
  let issuedAt;
  if (prev && prev.startsWith('CODE-')) {
    [, code, issuedAt] = prev.split('-');
  } else {
    const limited = await consume(db, 'otp_send_phone', phone);
    await db.query("INSERT INTO otp_attempts (phone_e164, kind, success) VALUES ($1, 'send', $2)", [phone, limited.allowed]);
    if (!limited.allowed) throw new Error(`OTP rate limited; retry in ${limited.retryAfterSec}s`);
    code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    issuedAt = String(Date.now());
    await sendSms(phone, `${code} is your Project IRL code. It expires in 5 minutes. Never share it — we will never call you for it.`);
  }
  event.response.publicChallengeParameters = { phone: `${phone.slice(0, 3)}••••${phone.slice(-3)}`, length: '6' };
  event.response.privateChallengeParameters = { code, issuedAt };
  event.response.challengeMetadata = `CODE-${code}-${issuedAt}`;
  return event;
};

exports.verifyAuthChallenge = async (event) => {
  const expected = String(event.request.privateChallengeParameters.code || '');
  const issuedAt = Number(event.request.privateChallengeParameters.issuedAt || 0);
  const answer = String(event.request.challengeAnswer || '').trim();
  const fresh = Date.now() - issuedAt < CODE_TTL_MS;
  const match = answer.length === expected.length && expected.length === 6 && crypto.timingSafeEqual(Buffer.from(answer), Buffer.from(expected));
  event.response.answerCorrect = fresh && match;
  await db
    .query("INSERT INTO otp_attempts (phone_e164, kind, success) VALUES ($1, 'verify', $2)", [event.request.userAttributes.phone_number, event.response.answerCorrect])
    .catch(() => {});
  return event;
};

exports.postAuthentication = async (event) => {
  const { sub, phone_number: phone } = event.request.userAttributes;
  await db.query(
    `INSERT INTO app_users (phone_e164, cognito_sub) VALUES ($1, $2)
     ON CONFLICT (phone_e164) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub, last_active_at = now()
     WHERE app_users.status <> 'deleted'`,
    [phone, sub]
  );
  return event;
};
