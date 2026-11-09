// boot_splash — routes onward as soon as the stored session is known. The
// visible splash is the animated overlay in src/features/splash/AnimatedSplash.js
// (mounted by App above everything), so this screen draws nothing of its own.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '@/store/useAppStore';
import { colors } from '@/theme/tokens';

export default function BootSplashScreen() {
  const nav = useNavigation();

  // The stored session + /me/bootstrap are resolved by App (initSession) before
  // this screen mounts, so routing reads settled server state.
  useEffect(() => {
    let t = setTimeout(() => {
      t = null;
      route();
    }, 50); // next frame: a navigate() during the first mount can be dropped
    return () => t && clearTimeout(t);
  }, [nav]);

  function route() {
    const s = useAppStore.getState();
    if (s.service?.status === 'maintenance') nav.replace('service_status');
    else if (!s.session.verified) nav.replace('welcome');
    else if (s.session.onboarded) nav.reset({ index: 0, routes: [{ name: 'main' }] });
    else if (s.session.ageConfirmed) nav.reset({ index: 0, routes: [{ name: 'profile_setup' }] });
    else nav.reset({ index: 0, routes: [{ name: 'age_gate' }] });
  }

  return <View style={{ flex: 1, backgroundColor: colors.canvas }} accessible accessibilityLabel="Come Over is loading" />;
}
