// boot_splash — native splash hand-off / app hydration, then routes onward.
import React, { useEffect } from 'react';
import { StatusBar, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Mascot } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';

export default function BootSplashScreen() {
  const nav = useNavigation();

  // The stored session + /me/bootstrap are resolved by App (initSession) before
  // this screen mounts, so routing reads settled server state.
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useAppStore.getState();
      if (s.service?.status === 'maintenance') nav.replace('service_status');
      else if (!s.session.verified) nav.replace('welcome');
      else if (s.session.onboarded) nav.reset({ index: 0, routes: [{ name: 'main' }] });
      else if (s.session.ageConfirmed) nav.reset({ index: 0, routes: [{ name: 'profile_setup' }] });
      else nav.reset({ index: 0, routes: [{ name: 'age_gate' }] });
    }, 900);
    return () => clearTimeout(t);
  }, [nav]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel="Project IRL is loading">
      <StatusBar barStyle="dark-content" backgroundColor={colors.periwinkle} />
      <Mascot size={200} />
      <Animated.View entering={fadeIn(150)} style={{ alignItems: 'center', marginTop: space.lg }}>
        <AppText variant="display">Project IRL</AppText>
        <AppText variant="bodyStrong" color={colors.inkSoft} style={{ marginTop: 4 }}>
          Less scrolling. More living.
        </AppText>
      </Animated.View>
    </View>
  );
}
