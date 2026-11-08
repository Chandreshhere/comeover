import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const options = { enableVibrateFallback: false, ignoreAndroidSystemSettings: false };

// Haptics are optional per 04_motion_system.json; respect the user toggle.
let enabled = true;
export const setHapticsEnabled = (v) => {
  enabled = v;
};

const fire = (type) => {
  if (!enabled) return;
  try {
    ReactNativeHapticFeedback.trigger(type, options);
  } catch (e) {
    // no-op on unsupported devices
  }
};

export const haptics = {
  light: () => fire('impactLight'),
  medium: () => fire('impactMedium'),
  select: () => fire('selection'),
  success: () => fire('notificationSuccess'),
  warning: () => fire('notificationWarning'),
};

export default haptics;
