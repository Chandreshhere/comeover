// Push notifications via Firebase Cloud Messaging (FCM for Android, APNs
// through FCM for iOS). Requires android/app/google-services.json and
// ios/ProjectIRL/GoogleService-Info.plist (see README). If Firebase isn't
// configured, every call here is a safe no-op.
import { Platform } from 'react-native';
import { notifications as notificationsApi } from '@/api/endpoints';

let messagingModule = null;
function messaging() {
  if (messagingModule === null) {
    try {
      // eslint-disable-next-line global-require
      const firebase = require('@react-native-firebase/app').default;
      messagingModule = firebase.apps.length ? require('@react-native-firebase/messaging').default : false;
    } catch (e) {
      messagingModule = false;
    }
  }
  return messagingModule ? messagingModule() : null;
}

export const pushAvailable = () => !!messaging();

let registeredToken = null;
const unsubs = [];

export async function registerForPush({ onForegroundMessage, onOpen } = {}) {
  const m = messaging();
  if (!m) return { enabled: false, reason: 'not_configured' };
  if (Platform.OS === 'ios') {
    const status = await m.requestPermission();
    // 1 = AUTHORIZED, 2 = PROVISIONAL
    if (status !== 1 && status !== 2) return { enabled: false, reason: 'denied' };
    await m.registerDeviceForRemoteMessages().catch(() => {});
  }
  const token = await m.getToken();
  if (token && token !== registeredToken) {
    await notificationsApi.registerDevice(Platform.OS, token);
    registeredToken = token;
  }
  unsubs.push(
    m.onTokenRefresh(async (t) => {
      await notificationsApi.registerDevice(Platform.OS, t).catch(() => {});
      registeredToken = t;
    })
  );
  if (onForegroundMessage) unsubs.push(m.onMessage(onForegroundMessage));
  if (onOpen) {
    unsubs.push(m.onNotificationOpenedApp(onOpen));
    const initial = await m.getInitialNotification();
    if (initial) onOpen(initial);
  }
  return { enabled: true, token };
}

export async function unregisterPush() {
  unsubs.splice(0).forEach((u) => u && u());
  const m = messaging();
  if (!m || !registeredToken) return;
  await notificationsApi.unregisterDevice(registeredToken).catch(() => {});
  await m.deleteToken().catch(() => {});
  registeredToken = null;
}
