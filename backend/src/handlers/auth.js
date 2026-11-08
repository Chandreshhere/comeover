'use strict';
// Phone sign-in with Slide OTP (https://slide.synquic.com) + our own tokens.
//
//   POST /v1/auth/otp/request      { phone }                 → { requestId, channel, retryAfterSec, maskedPhone }
//   POST /v1/auth/otp/resend       { requestId, channel? }   → { requestId, channel, retryAfterSec, notice? }
//   POST /v1/auth/otp/verify       { requestId, code }       → { accessToken, refreshToken, expiresIn, tokenType, isNewUser, user: { id, roles } }
//   POST /v1/auth/session/refresh  { refreshToken }          → { accessToken, refreshToken (rotated), expiresIn, tokenType }
//   POST /v1/auth/logout           { refreshToken }          → { ok }
//   POST /v1/auth/logout-all       (Bearer)                  → { ok, revoked }
//   GET  /v1/admin/me              (Bearer, admin|moderator) → { id, name, phone (masked), role }
//
// The Slide API key and widget id stay on the server. Slide proves phone
// ownership; we look up / create the user by phone and issue our own session.
const config = require('../config');
const logger = require('../logger');
const { err } = require('../lib/http');
const slide = require('../lib/slide');
const { normalizePhone, maskPhone } = require('../lib/phone');
const { enforce } = require('../lib/rateLimit');
const tokens = require('../lib/tokens');
const testLogin = require('../lib/testLogin');
const crypto = require('crypto');
const { requireUser, requireAdmin } = require('../lib/auth');
const { audit } = require('../lib/audit');

const ipOf = (req) => req.ip || 'unknown';
const CODE_RE = /^\d{4,8}$/;

function mapSlideError(e, { phase }) {
  if (!(e instanceof slide.SlideError)) throw e;
  switch (e.kind) {
    case 'not_configured':
      return err.unavailable('auth_not_configured', 'Sign-in is not configured on this server.');
    case 'rate_limited':
      return err.tooMany(e.retryAfterSec || 60, 'otp_rate_limited', 'Too many codes requested. Please wait and try again.');
    case 'invalid':
      if (phase === 'send') return err.badRequest('invalid_phone', 'Enter a valid mobile number');
      if (phase === 'resend') return err.badRequest('otp_expired', 'That code has expired. Request a new one.');
      return err.badRequest('otp_invalid', "That code didn't match. Check the message and try again.");
    case 'unauthorized':
      logger.error({ msg: 'slide_unauthorized', phase, status: e.status }); // bad/expired API key or missing scope
      return err.unavailable('slide_unavailable', "We couldn't send a code right now. Try again in a minute.");
    default:
      logger.warn({ msg: 'slide_unavailable', phase, kind: e.kind, status: e.status, err: e.message });
      return err.unavailable('slide_unavailable', "We couldn't send a code right now. Try again in a minute.");
  }
}

function assertConfigured() {
  if (!slide.isConfigured()) throw err.unavailable('auth_not_configured', 'Sign-in is not configured on this server.');
}

async function findOrCreateUser(phone) {
  const { User } = require('../models');
  let user = await User.findOne({ phone }).lean();
  let created = false;
  if (!user) {
    try {
      user = (await User.create({ phone })).toObject();
      created = true;
    } catch (e) {
      if (e && e.code === 11000) user = await User.findOne({ phone }).lean();
      else throw e;
    }
  }
  return { user, created };
}

const routes = {
  'POST /v1/auth/otp/request': async (req) => {
    const phone = normalizePhone(req.body.phone);
    const isTest = testLogin.matchesPhone(phone); // temporary fixed-code login (see lib/testLogin.js)
    if (!isTest) assertConfigured();
    await enforce('otp_send_ip', ipOf(req), 1, { code: 'rate_limited' });
    await enforce('otp_send_phone', phone, 1, { code: 'otp_rate_limited', message: 'Too many codes requested. Please wait and try again.' });
    if (isTest) {
      const { OtpRequest } = require('../models');
      const requestId = `otpreq_test_${crypto.randomBytes(9).toString('hex')}`;
      await OtpRequest.create({
        _id: requestId,
        phone,
        ip: req.ip || null,
        channel: 'test',
        provider: 'test',
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + config.slide.otpTtlSec * 1000),
      });
      return { requestId, channel: 'test', retryAfterSec: config.slide.resendAfterSec, maskedPhone: maskPhone(phone), codeLength: testLogin.codeLength() };
    }
    let sent;
    try {
      sent = await slide.sendOtp(phone);
    } catch (e) {
      throw mapSlideError(e, { phase: 'send' });
    }
    const { OtpRequest } = require('../models');
    await OtpRequest.create({
      _id: sent.requestId,
      phone,
      ip: req.ip || null,
      channel: sent.channel,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + config.slide.otpTtlSec * 1000),
    });
    return { requestId: sent.requestId, channel: sent.channel, retryAfterSec: config.slide.resendAfterSec, maskedPhone: maskPhone(phone), codeLength: config.slide.codeLength };
  },

  'POST /v1/auth/otp/resend': async (req) => {
    const requestId = String(req.body.requestId || '');
    const channel = req.body.channel;
    const { OtpRequest } = require('../models');
    const otp = await OtpRequest.findById(requestId).lean();
    if (!otp || otp.verifiedAt || otp.expiresAt < new Date()) throw err.badRequest('otp_expired', 'That code has expired. Request a new one.');
    const isTest = otp.provider === 'test';
    if (!isTest) assertConfigured();
    const waited = (Date.now() - new Date(otp.lastSentAt).getTime()) / 1000;
    if (waited < config.slide.resendAfterSec) {
      throw err.tooMany(Math.ceil(config.slide.resendAfterSec - waited), 'otp_rate_limited', 'Please wait before requesting another code.');
    }
    await enforce('otp_resend_phone', otp.phone, 1, { code: 'otp_rate_limited', message: 'Too many codes requested. Please wait and try again.' });
    if (isTest) {
      if (!testLogin.isActive()) throw err.badRequest('otp_expired', 'That code has expired. Request a new one.');
      await OtpRequest.updateOne({ _id: requestId }, { $set: { lastSentAt: new Date() }, $inc: { resendCount: 1 } });
      return { requestId, channel: 'test', retryAfterSec: config.slide.resendAfterSec };
    }
    let r;
    try {
      r = await slide.retryOtp(requestId, channel);
    } catch (e) {
      throw mapSlideError(e, { phase: 'resend' });
    }
    await OtpRequest.updateOne({ _id: requestId }, { $set: { lastSentAt: new Date(), channel: r.channel || otp.channel }, $inc: { resendCount: 1 } });
    return { requestId: r.requestId || requestId, channel: r.channel || otp.channel, retryAfterSec: config.slide.resendAfterSec, ...(r.notice ? { notice: r.notice } : {}) };
  },

  'POST /v1/auth/otp/verify': async (req) => {
    const requestId = String(req.body.requestId || '');
    const code = String(req.body.code || '').trim();
    if (!requestId) throw err.badRequest('otp_expired', 'That code has expired. Request a new one.');
    if (!CODE_RE.test(code)) throw err.badRequest('otp_invalid', "That code didn't match. Check the message and try again.");
    await enforce('otp_verify_ip', ipOf(req), 1, { code: 'rate_limited' });

    const { OtpRequest } = require('../models');
    const max = config.slide.maxVerifyAttempts;
    const existing = await OtpRequest.findById(requestId).lean();
    if (!existing || existing.verifiedAt || existing.expiresAt < new Date()) throw err.badRequest('otp_expired', 'That code has expired. Request a new one.');
    const isTest = existing.provider === 'test';
    if (!isTest) assertConfigured();
    if (existing.attempts >= max) throw err.badRequest('otp_locked', 'Too many wrong codes. Request a new one.');
    const otp = await OtpRequest.findOneAndUpdate({ _id: requestId, verifiedAt: null, attempts: { $lt: max } }, { $inc: { attempts: 1 } }, { new: true }).lean();
    if (!otp) throw err.badRequest('otp_locked', 'Too many wrong codes. Request a new one.');

    if (isTest) {
      // Fixed-code test login (lib/testLogin.js): same attempt limits as real codes.
      if (!testLogin.isActive() || !testLogin.matchesPhone(otp.phone)) throw err.badRequest('otp_expired', 'That code has expired. Request a new one.');
      if (!testLogin.checkCode(code)) {
        if (otp.attempts >= max) throw err.badRequest('otp_locked', 'Too many wrong codes. Request a new one.');
        throw err.badRequest('otp_invalid', "That code didn't match. Check the message and try again.", { attemptsLeft: max - otp.attempts });
      }
    } else {
      let slideToken;
      try {
        slideToken = (await slide.verifyOtp(requestId, code)).accessToken;
      } catch (e) {
        if (e instanceof slide.SlideError && e.kind === 'invalid') {
          if (otp.attempts >= max) throw err.badRequest('otp_locked', 'Too many wrong codes. Request a new one.');
          throw err.badRequest('otp_invalid', "That code didn't match. Check the message and try again.", { attemptsLeft: max - otp.attempts });
        }
        throw mapSlideError(e, { phase: 'verify' });
      }
      let confirmed;
      try {
        confirmed = await slide.verifyToken(slideToken);
      } catch (e) {
        throw mapSlideError(e, { phase: 'verify' });
      }
      if (!confirmed.verified || confirmed.identifier !== otp.phone) {
        logger.warn({ msg: 'slide_identifier_mismatch', requestId });
        throw err.badRequest('otp_invalid', "That code didn't match. Check the message and try again.");
      }
    }
    await OtpRequest.updateOne({ _id: requestId }, { $set: { verifiedAt: new Date() } });

    const { user, created } = await findOrCreateUser(otp.phone);
    if (user.status === 'deleted') throw err.forbidden('account_deleted', 'This account is pending deletion. Contact support to restore it.');
    const t = await tokens.issueTokens(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
    const action = isTest ? 'auth.test_login' : created ? 'auth.sign_up' : 'auth.sign_in';
    await audit({ actorUserId: user._id, action, targetType: 'user', targetId: user._id, ip: req.ip, metadata: { channel: otp.channel, testLogin: isTest } }).catch(() => {});
    return { ...t, isNewUser: !(user.profile && user.profile.displayName), user: { id: user._id, roles: user.roles || [] } };
  },

  'POST /v1/auth/session/refresh': async (req) => {
    await enforce('refresh_ip', ipOf(req), 1, { code: 'rate_limited' });
    return tokens.rotateRefreshToken(req.body.refreshToken, { ip: req.ip, userAgent: req.headers['user-agent'] });
  },

  'POST /v1/auth/logout': async (req) => {
    await tokens.revokeRefreshToken(req.body.refreshToken);
    return { ok: true };
  },

  'POST /v1/auth/logout-all': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const revoked = await tokens.revokeAllForUser(user.id);
    await audit({ actorUserId: user.id, action: 'auth.logout_all', targetType: 'user', targetId: user.id, ip: req.ip }).catch(() => {});
    return { ok: true, revoked };
  },

  'GET /v1/admin/me': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    return { id: admin.id, name: admin.name, phone: maskPhone(admin.phone), role: admin.role };
  },
};

module.exports = { routes, mapSlideError };
