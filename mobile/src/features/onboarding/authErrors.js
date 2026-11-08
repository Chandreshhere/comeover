// Friendly copy for sign-in errors. Codes come from the API's Slide-backed
// OTP endpoints via store.requestOtp / resendOtp / verifyOtp (src/api/auth.js).
const COPY = {
  invalid_phone: 'Please check the phone number.',
  otp_rate_limited: 'Too many codes requested. Wait a minute, then try again.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  otp_invalid: "That code didn't match. Check the message and try again.",
  otp_expired: 'That code has expired. Request a new one.',
  otp_locked: 'Too many wrong attempts. Request a new code to try again.',
  slide_unavailable: "We couldn't send a code right now. Try again in a minute.",
  auth_not_configured: "Sign-in isn't set up on this server yet.",
  network: 'No connection. Check your internet and try again.',
  timeout: 'The server took too long to respond. Try again.',
  not_configured: "This build isn't connected to a server yet.",
};

export function otpErrorMessage(e, fallback = 'Something went wrong. Try again.') {
  if (!e) return fallback;
  return COPY[e.code] || e.message || fallback;
}

export const isOffline = (e) => e?.code === 'network' || e?.code === 'timeout';
