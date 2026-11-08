'use strict';
// /v1/auth/* — thin, unauthenticated proxy over Cognito CUSTOM_AUTH so the
// mobile client keeps the simple contract (POST otp/request → otp/verify).
// The OTP itself is generated, sent, rate-limited and verified inside the
// Cognito triggers (handlers/cognito/triggers.js); this proxy never sees codes
// except to forward the user's answer. Clients may also talk to Cognito directly.
const crypto = require('crypto');
const { createRouter, err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { enforce } = require('../lib/rateLimit');
const { cognito } = require('../lib/aws');

const C = () => require('@aws-sdk/client-cognito-identity-provider');
const clientId = () => {
  if (!process.env.USER_POOL_CLIENT_ID) throw err.unavailable('auth_not_configured');
  return process.env.USER_POOL_CLIENT_ID;
};

// India-first: accept 10-digit local numbers and normalise to +91.
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  throw err.badRequest('invalid_phone', 'Enter a valid mobile number');
}

async function initiate(phone) {
  const { InitiateAuthCommand } = C();
  return cognito().send(new InitiateAuthCommand({ AuthFlow: 'CUSTOM_AUTH', ClientId: clientId(), AuthParameters: { USERNAME: phone } }));
}

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) {
    return {};
  }
}

const routes = {
  'POST /v1/auth/otp/request': async (req) => {
    const { phone: raw } = check({ phone: { type: 'string', required: true, max: 20 } }, req.body);
    const phone = normalisePhone(raw);
    await enforce(db, 'otp_send_ip', req.ip || 'unknown');
    let res;
    try {
      res = await initiate(phone);
    } catch (e) {
      if (e.name === 'UserNotFoundException') {
        const { SignUpCommand } = C();
        await cognito().send(
          new SignUpCommand({
            ClientId: clientId(),
            Username: phone,
            // Password is never used (CUSTOM_AUTH only) but Cognito requires one.
            Password: `${crypto.randomBytes(24).toString('base64url')}Aa1!`,
            UserAttributes: [{ Name: 'phone_number', Value: phone }],
          })
        );
        res = await initiate(phone);
      } else if (e.name === 'UserLambdaValidationException' && /rate limited/i.test(e.message)) {
        throw err.tooMany(60, 'otp_rate_limited', 'Too many codes requested. Wait a minute and try again.');
      } else if (e.name === 'NotAuthorizedException') {
        throw err.forbidden('sign_in_blocked', 'Sign-in is not available for this number');
      } else {
        throw e;
      }
    }
    return { sent: true, session: res.Session, challenge: res.ChallengeName, retryAfterSec: 30, maskedPhone: res.ChallengeParameters && res.ChallengeParameters.phone };
  },

  'POST /v1/auth/otp/verify': async (req) => {
    const v = check(
      {
        phone: { type: 'string', required: true, max: 20 },
        code: { type: 'string', required: true, pattern: /^\d{6}$/ },
        session: { type: 'string', required: true, max: 4096 },
      },
      req.body
    );
    const phone = normalisePhone(v.phone);
    const { RespondToAuthChallengeCommand } = C();
    let res;
    try {
      res = await cognito().send(
        new RespondToAuthChallengeCommand({ ClientId: clientId(), ChallengeName: 'CUSTOM_CHALLENGE', Session: v.session, ChallengeResponses: { USERNAME: phone, ANSWER: v.code } })
      );
    } catch (e) {
      if (e.name === 'NotAuthorizedException') throw err.unauthorized('otp_locked', 'Too many attempts or the code expired. Request a new code.');
      if (e.name === 'CodeMismatchException' || e.name === 'ExpiredCodeException') throw err.badRequest('otp_invalid', "That code didn't match.");
      throw e;
    }
    if (!res.AuthenticationResult) {
      // Wrong code but attempts remain: Cognito returns a fresh session.
      throw err.badRequest('otp_invalid', "That code didn't match. Check the SMS and try again.", { session: res.Session });
    }
    const a = res.AuthenticationResult;
    const idClaims = decodeJwt(a.IdToken);
    const profile = idClaims.sub
      ? await db.one('SELECT p.user_id FROM app_users u JOIN profiles p ON p.user_id = u.id WHERE u.cognito_sub = $1', [idClaims.sub]).catch(() => null)
      : null;
    return { accessToken: a.AccessToken, idToken: a.IdToken, refreshToken: a.RefreshToken, expiresIn: a.ExpiresIn, tokenType: a.TokenType, isNewUser: !profile };
  },

  'POST /v1/auth/session/refresh': async (req) => {
    const { refreshToken } = check({ refreshToken: { type: 'string', required: true, max: 8192 } }, req.body);
    const { InitiateAuthCommand } = C();
    try {
      const res = await cognito().send(new InitiateAuthCommand({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId(), AuthParameters: { REFRESH_TOKEN: refreshToken } }));
      const a = res.AuthenticationResult;
      return { accessToken: a.AccessToken, idToken: a.IdToken, expiresIn: a.ExpiresIn, tokenType: a.TokenType };
    } catch (e) {
      if (e.name === 'NotAuthorizedException') throw err.unauthorized('session_expired', 'Please sign in again');
      throw e;
    }
  },

  'POST /v1/auth/logout': async (req) => {
    const { refreshToken } = check({ refreshToken: { type: 'string', required: true, max: 8192 } }, req.body);
    const { RevokeTokenCommand } = C();
    await cognito().send(new RevokeTokenCommand({ ClientId: clientId(), Token: refreshToken })).catch(() => {});
    return { ok: true };
  },
};

exports.normalisePhone = normalisePhone;
exports.handler = createRouter(routes);
