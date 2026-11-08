import { createNavigationContainerRef } from '@react-navigation/native';
import { TAB_SCREENS } from './inventory';

export const navigationRef = createNavigationContainerRef();

// Notification targets are { screen: <inventory id>, params }.
export function navigateFromNotification(target) {
  if (!target?.screen || !navigationRef.isReady()) return;
  if (TAB_SCREENS.includes(target.screen)) navigationRef.navigate('main', { screen: target.screen, params: target.params });
  else navigationRef.navigate(target.screen, target.params);
}

export function resetTo(name, params) {
  if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name, params }] });
}
