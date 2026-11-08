import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import RootNavigator from '@/navigation/RootNavigator';
import ErrorBoundary from '@/navigation/ErrorBoundary';
import NotConfigured from '@/navigation/NotConfigured';
import { useAppStore } from '@/store/useAppStore';
import { setHapticsEnabled } from '@/utils/haptics';

enableScreens(true);

export default function App() {
  const hapticsOn = useAppStore((s) => s.prefs.haptics);
  const boot = useAppStore((s) => s.boot);
  const initSession = useAppStore((s) => s.initSession);
  const [hydrated, setHydrated] = useState(useAppStore.persist?.hasHydrated?.() ?? true);

  useEffect(() => {
    setHapticsEnabled(hapticsOn);
  }, [hapticsOn]);

  useEffect(() => {
    if (hydrated) return undefined;
    return useAppStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  // Restore the signed-in session (Keychain) and load /me/bootstrap before routing.
  useEffect(() => {
    if (hydrated) initSession();
  }, [hydrated, initSession]);

  let body = null;
  if (boot.ready) body = boot.configured ? <RootNavigator /> : <NotConfigured />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>{body}</ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
