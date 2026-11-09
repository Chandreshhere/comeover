// Phone OTP sign-in via the Come Over API, which uses Slide
// (https://slide.synquic.com) to deliver codes over WhatsApp or SMS.
// The Slide API key lives only on the server; the app sees a requestId.
//
//   POST /v1/auth/otp/request {phone}            → {requestId, channel, retryAfterSec, maskedPhone}
//   POST /v1/auth/otp/resend  {requestId, channel?} → {requestId, channel, retryAfterSec, notice?}
//   POST /v1/auth/otp/verify  {requestId, code}   → {accessToken, refreshToken, expiresIn, isNewUser, user}
//   POST /v1/auth/session/refresh {refreshToken}  → rotated {accessToken, refreshToken, expiresIn}
//   POST /v1/auth/logout {refreshToken}
import config, { isConfigured } from '@/config';

export class AuthError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const FRIENDLY = {
  invalid_phone: 'Please check the phone number.',
  otp_rate_limited: 'Too many codes requested. Please wait a moment and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  otp_invalid: "That code didn't match. Check the message and try again.",
  otp_expired: 'That code has expired. Request a new one.',
  otp_locked: 'Too many wrong codes. Request a new one.',
  session_expired: 'Your session expired. Please sign in again.',
  slide_unavailable: "We couldn't send a code right now. Try again in a minute.",
  auth_not_configured: 'Sign-in is not set up on this server yet.',
  network: 'No connection. Check your internet and try again.',
  timeout: 'The server took too long to respond.',
  not_configured: 'The app is not connected to a server yet.',
};

async function post(path, body) {
  if (!isConfigured()) throw new AuthError('not_configured', FRIENDLY.not_configured);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${config.API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
  } catch (e) {
    const code = e?.name === 'AbortError' ? 'timeout' : 'network';
    throw new AuthError(code, FRIENDLY[code]);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.code || `http_${res.status}`;
    throw new AuthError(code, FRIENDLY[code] || data.message || 'Sign-in failed.', {
      status: res.status,
      retryAfterSec: data.details?.retryAfterSec ?? (Number(res.headers.get('retry-after')) || undefined),
    });
  }
  return data;
}

const toTokens = (r, prevRefresh) => ({
  accessToken: r.accessToken,
  refreshToken: r.refreshToken || prevRefresh,
  expiresAt: Date.now() + (r.expiresIn || 900) * 1000,
});

export const requestOtp = (phone) => post('/auth/otp/request', { phone });
export const resendOtp = (requestId, channel) => post('/auth/otp/resend', { requestId, channel });

export async function verifyOtp(requestId, code) {
  const r = await post('/auth/otp/verify', { requestId, code });
  return { tokens: toTokens(r), isNewUser: !!r.isNewUser, user: r.user || null };
}

export async function refreshTokens(refreshToken) {
  const r = await post('/auth/session/refresh', { refreshToken });
  return toTokens(r, refreshToken);
}

export async function logoutRemote(refreshToken) {
  try {
    await post('/auth/logout', { refreshToken });
  } catch (e) {
    // local sign-out proceeds regardless
  }
}

export function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(global.atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}
