import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import RootNavigator from '@/navigation/RootNavigator';
import ErrorBoundary from '@/navigation/ErrorBoundary';
import NotConfigured from '@/navigation/NotConfigured';
import { useAppStore } from '@/store/useAppStore';
import { setHapticsEnabled } from '@/utils/haptics';
import ThemeProvider from '@/theme/ThemeProvider';
import { colors } from '@/theme/tokens';
import AnimatedSplash from '@/features/splash/AnimatedSplash';
import { navigationRef } from '@/navigation/navigationRef';

enableScreens(true);

export default function App() {
  const hapticsOn = useAppStore((s) => s.prefs.haptics);
  const appearance = useAppStore((s) => s.prefs.appearance || 'light');
  const boot = useAppStore((s) => s.boot);
  const initSession = useAppStore((s) => s.initSession);
  const [splashDone, setSplashDone] = useState(false);
  const [hydrated, setHydrated] = useState(useAppStore.persist?.hasHydrated?.() ?? true);

  useEffect(() => {
    setHapticsEnabled(hapticsOn);
  }, [hapticsOn]);

  useEffect(() => {
    if (hydrated) return undefined;
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    // It may have finished between the first render and this subscription,
    // and if reading storage fails the library never signals "finished":
    // check again now, and never wait more than 2.5 s for saved state.
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    const t = setTimeout(() => setHydrated(true), 2500);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [hydrated]);

  // Restore the signed-in session (Keychain) and load /me/bootstrap before routing.
  useEffect(() => {
    if (hydrated) initSession();
  }, [hydrated, initSession]);

  let body = <View style={{ flex: 1, backgroundColor: colors.canvas }} />; // never a bare black root while booting
  if (boot.ready) body = boot.configured ? <RootNavigator /> : <NotConfigured />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider preference={appearance} getNavState={() => (navigationRef.isReady() ? navigationRef.getRootState() : undefined)}>
          <ErrorBoundary>{body}</ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
      {/* Animated cold-start splash above everything; the app boots underneath. */}
      {!splashDone && <AnimatedSplash ready={boot.ready} onDone={() => setSplashDone(true)} />}
    </GestureHandlerRootView>
  );
}
