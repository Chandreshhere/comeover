// Amazon Cognito (passwordless phone OTP) via the public Cognito IDP JSON API.
// Flow (backend: DefineAuthChallenge / CreateAuthChallenge / VerifyAuthChallengeResponse,
// PreSignUp auto-confirm):
//   InitiateAuth(CUSTOM_AUTH) → [UserNotFound → SignUp → InitiateAuth] → SMS OTP
//   RespondToAuthChallenge(ANSWER=otp) → tokens
//   InitiateAuth(REFRESH_TOKEN_AUTH) to refresh.
import config from '@/config';

export class AuthError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const FRIENDLY = {
  UserNotFoundException: 'We could not find that number.',
  NotAuthorizedException: "That code didn't match or has expired. Request a new one.",
  CodeMismatchException: "That code didn't match. Check the SMS and try again.",
  TooManyRequestsException: 'Too many attempts. Please wait a minute and try again.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes.',
  TooManyFailedAttemptsException: 'Too many wrong codes. Request a new one.',
  UserLambdaValidationException: 'We could not send a code to this number right now.',
  InvalidParameterException: 'Please check the phone number.',
  network: 'No connection. Check your internet and try again.',
  not_configured: 'The app is not connected to a server yet.',
};

async function call(target, body) {
  if (!config.AWS_REGION || !config.COGNITO_CLIENT_ID) throw new AuthError('not_configured', FRIENDLY.not_configured);
  let res;
  try {
    res = await fetch(`https://cognito-idp.${config.AWS_REGION}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AuthError('network', FRIENDLY.network);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.__type || 'Unknown').split('#').pop();
    throw new AuthError(code, FRIENDLY[code] || data.message || 'Sign-in failed.');
  }
  return data;
}

// Cognito requires a password at SignUp even for passwordless custom auth.
// It is never stored or used (the app client only enables CUSTOM_AUTH + refresh).
function throwawayPassword() {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let p = 'Aa1!';
  for (let i = 0; i < 28; i++) p += pool[Math.floor(Math.random() * pool.length)];
  return p;
}

const initiateCustom = (phone) =>
  call('InitiateAuth', { AuthFlow: 'CUSTOM_AUTH', ClientId: config.COGNITO_CLIENT_ID, AuthParameters: { USERNAME: phone } });

// Returns { session } to pass to answerOtp.
export async function startPhoneSignIn(phone) {
  let r;
  try {
    r = await initiateCustom(phone);
  } catch (e) {
    if (e.code !== 'UserNotFoundException') throw e;
    await call('SignUp', {
      ClientId: config.COGNITO_CLIENT_ID,
      Username: phone,
      Password: throwawayPassword(),
      UserAttributes: [{ Name: 'phone_number', Value: phone }],
    });
    r = await initiateCustom(phone);
  }
  return { session: r.Session, challenge: r.ChallengeName, isNewUser: r.ChallengeParameters?.isNewUser === 'true' };
}

// Resolves to tokens, or throws AuthError('CodeMismatchException', …, { session }) with a
// fresh session when Cognito allows another attempt.
export async function answerOtp(phone, session, code) {
  const r = await call('RespondToAuthChallenge', {
    ClientId: config.COGNITO_CLIENT_ID,
    ChallengeName: 'CUSTOM_CHALLENGE',
    Session: session,
    ChallengeResponses: { USERNAME: phone, ANSWER: code },
  });
  if (r.AuthenticationResult) return toTokens(r.AuthenticationResult);
  throw new AuthError('CodeMismatchException', FRIENDLY.CodeMismatchException, { session: r.Session });
}

export async function refreshTokens(refreshToken) {
  const r = await call('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: config.COGNITO_CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return toTokens({ ...r.AuthenticationResult, RefreshToken: r.AuthenticationResult.RefreshToken || refreshToken });
}

export async function globalSignOut(accessToken) {
  try {
    await call('GlobalSignOut', { AccessToken: accessToken });
  } catch (e) {
    // token may already be expired/revoked — local sign-out still proceeds
  }
}

function toTokens(a) {
  return {
    accessToken: a.AccessToken,
    idToken: a.IdToken,
    refreshToken: a.RefreshToken,
    expiresAt: Date.now() + (a.ExpiresIn || 3600) * 1000,
  };
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
