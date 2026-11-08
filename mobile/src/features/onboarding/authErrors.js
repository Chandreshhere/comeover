// Friendly copy for Cognito / API errors surfaced during sign-in.
// Codes come from store.requestOtp / verifyOtp (see src/api/cognito.js).
const COPY = {
  otp_rate_limited: 'Too many codes requested. Wait a minute, then try again.',
  otp_invalid: "That code didn't match. Check the SMS and try again.",
  otp_locked: 'Too many wrong attempts. Request a new code to try again.',
  network: 'No connection. Check your internet and try again.',
  timeout: 'The server took too long to respond. Try again.',
  not_configured: "This build isn't connected to a server yet.",
  InvalidParameterException: 'Please check the phone number.',
  UserLambdaValidationException: "We couldn't send a code to this number right now.",
  ExpiredCodeException: 'That code has expired. Request a new one.',
};

export function otpErrorMessage(e, fallback = 'Something went wrong. Try again.') {
  if (!e) return fallback;
  return COPY[e.code] || e.message || fallback;
}

export const isOffline = (e) => e?.code === 'network' || e?.code === 'timeout';
