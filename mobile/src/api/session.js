// Token storage (iOS Keychain / Android Keystore via react-native-keychain)
// with single-flight, rotating refresh. Tokens never touch AsyncStorage.
import * as Keychain from 'react-native-keychain';
import { decodeJwt, logoutRemote, refreshTokens } from './auth';

const SERVICE = 'app.projectirl.session';
let tokens = null;
let refreshing = null;
const listeners = new Set();

export const onSignedOut = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function loadSession() {
  try {
    const c = await Keychain.getGenericPassword({ service: SERVICE });
    tokens = c ? JSON.parse(c.password) : null;
  } catch (e) {
    tokens = null;
  }
  return tokens;
}

export async function saveSession(t) {
  tokens = t;
  await Keychain.setGenericPassword('irl', JSON.stringify(t), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearSession({ remote = true } = {}) {
  const t = tokens;
  tokens = null;
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (e) {
    // ignore
  }
  if (remote && t?.refreshToken) await logoutRemote(t.refreshToken);
}

export const hasSession = () => !!tokens?.refreshToken;
export const getUserSub = () => (tokens?.accessToken ? decodeJwt(tokens.accessToken)?.sub : null);
export const getRawAccessToken = () => tokens?.accessToken || null;

export async function getAccessToken({ force = false } = {}) {
  if (!tokens) return null;
  const fresh = tokens.expiresAt - Date.now() > 60000;
  if (fresh && !force) return tokens.accessToken;
  if (!refreshing) {
    refreshing = refreshTokens(tokens.refreshToken)
      .then(async (t) => {
        await saveSession(t);
        return t.accessToken;
      })
      .catch(async (e) => {
        // Rotated/revoked/expired refresh token → sign out. Network errors keep the session.
        if (e.code === 'session_expired' || e.status === 401) {
          await clearSession({ remote: false });
          listeners.forEach((fn) => fn('expired'));
          return null;
        }
        throw e;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export const notifySignedOut = (reason) => listeners.forEach((fn) => fn(reason));
