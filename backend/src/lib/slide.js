'use strict';
// Slide (https://slide.synquic.com) OTP client — server-side only; the API key
// never reaches the app. Docs: https://slide.synquic.com/docs/api-reference#otp-api
//
//   POST /v1/otp/send          { widgetId, identifier }   → { requestId, channel }
//   POST /v1/otp/retry         { requestId, channel? }    → { requestId, channel, requestedChannel?, requestedChannelAvailable?, notice? }
//   POST /v1/otp/verify        { requestId, otp }         → { accessToken }            (400 if invalid/expired/blocked)
//   POST /v1/otp/verify-token  { accessToken }            → { verified, identifier, verifiedAt }  (single use)
//
// Auth: Authorization: Bearer <sk_live_… | sk_test_…>. Errors: { statusCode, error, message }; 429 has Retry-After.
const config = require('../config');

class SlideError extends Error {
  constructor(kind, status, message, extra = {}) {
    super(message || kind);
    this.name = 'SlideError';
    this.kind = kind; // not_configured | rate_limited | invalid | unavailable | unauthorized | bad_response
    this.status = status;
    Object.assign(this, extra);
  }
}

let fetchImpl = (...args) => fetch(...args);
// Tests inject a fake fetch.
function setFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

function isConfigured() {
  return !!(config.slide.apiKey && config.slide.otpWidgetId);
}

async function call(path, body) {
  if (!config.slide.apiKey) throw new SlideError('not_configured', 503, 'Slide API key is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.slide.timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${config.slide.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.slide.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new SlideError('unavailable', 503, e && e.name === 'AbortError' ? 'Slide timed out' : 'Slide unreachable');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = {};
  }
  if (res.ok) return data;
  const message = (data && (data.message || data.error)) || `Slide HTTP ${res.status}`;
  if (res.status === 429) {
    const ra = Number((res.headers && res.headers.get && res.headers.get('retry-after')) || data.retryAfter || 60);
    throw new SlideError('rate_limited', 429, message, { retryAfterSec: Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : 60 });
  }
  if (res.status === 401 || res.status === 403) throw new SlideError('unauthorized', res.status, message);
  if (res.status >= 500) throw new SlideError('unavailable', res.status, message);
  throw new SlideError('invalid', res.status, message);
}

async function sendOtp(identifier) {
  if (!isConfigured()) throw new SlideError('not_configured', 503, 'Slide OTP is not configured');
  const r = await call('/v1/otp/send', { widgetId: config.slide.otpWidgetId, identifier });
  if (!r || !r.requestId) throw new SlideError('bad_response', 502, 'Slide send returned no requestId');
  return { requestId: r.requestId, channel: r.channel || null };
}

async function retryOtp(requestId, channel) {
  const body = { requestId };
  if (channel === 'sms' || channel === 'whatsapp') body.channel = channel;
  const r = await call('/v1/otp/retry', body);
  return {
    requestId: r.requestId || requestId,
    channel: r.channel || null,
    requestedChannel: r.requestedChannel,
    requestedChannelAvailable: r.requestedChannelAvailable,
    notice: r.notice,
  };
}

async function verifyOtp(requestId, otp) {
  const r = await call('/v1/otp/verify', { requestId, otp: String(otp) });
  if (!r || !r.accessToken) throw new SlideError('bad_response', 502, 'Slide verify returned no accessToken');
  return { accessToken: r.accessToken };
}

// Confirms + consumes Slide's single-use access token. Returns { verified, identifier, verifiedAt }.
async function verifyToken(accessToken) {
  const r = await call('/v1/otp/verify-token', { accessToken });
  return { verified: r.verified === true, identifier: r.identifier || null, verifiedAt: r.verifiedAt || null };
}

module.exports = { SlideError, isConfigured, sendOtp, retryOtp, verifyOtp, verifyToken, setFetch };
