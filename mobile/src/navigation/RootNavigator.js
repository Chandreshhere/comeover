import React, { useEffect } from 'react';
import { View } from 'react-native';
import { navigationRef, resetTo } from './navigationRef';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAppStore } from '@/store/useAppStore';
import { colors } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { SCREENS, getScreen } from './registry';
import { INVENTORY, TAB_SCREENS } from './inventory';
import TabBar from './TabBar';
import AppTour from '@/features/guide/AppTour';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Built at render time so it follows the light/dark palette.
const makeNavTheme = (dark) => {
  const base = dark ? DarkTheme : DefaultTheme;
  return { ...base, dark, colors: { ...base.colors, background: colors.canvas, primary: colors.ink, card: colors.surface, text: colors.ink, border: colors.border } };
};

const Empty = () => <View />;

function MainTabs() {
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }} initialRouteName="discover_home">
        {TAB_SCREENS.map((name) => (
          <Tab.Screen key={name} name={name} component={name === 'create_tab' ? Empty : getScreen(name).component} />
        ))}
      </Tab.Navigator>
      {/* First-run coach marks; shows only while `main` itself is focused. */}
      <AppTour />
    </View>
  );
}

const pathFor = (id) => INVENTORY.find((s) => s.id === id)?.path;

// Deep links: projectirl://<inventory path>, e.g. projectirl://activity/detail?id=a1
const linking = {
  prefixes: ['projectirl://', 'https://projectirl.app'],
  config: {
    screens: {
      main: { screens: Object.fromEntries(TAB_SCREENS.filter((n) => n !== 'create_tab').map((n) => [n, pathFor(n)])) },
      ...Object.fromEntries(SCREENS.filter((s) => !TAB_SCREENS.includes(s.id)).map((s) => [s.id, s.path])),
    },
  },
};

// The first screen, decided synchronously from the restored session (App only
// mounts the navigator once boot is ready). No redirect hop through
// boot_splash: a navigate() fired during the very first mount can be dropped.
function firstRoute(s) {
  if (s.service?.status === 'maintenance') return 'service_status';
  if (!s.session.verified) return 'welcome';
  if (s.session.onboarded) return !s.profile.socialStyle && !s.prefs.socialStyleAsked ? 'social_style' : 'main';
  if (s.session.ageConfirmed) return 'profile_setup';
  return 'age_gate';
}

const ONBOARDING_PUBLIC = new Set(['boot_splash', 'service_status', 'welcome', 'phone_entry', 'otp_verify']);

// Modal-presented screens (sheets & full-screen flows).
const MODALS = new Set(['filters_sheet', 'join_request', 'block_confirm', 'report_flow', 'emergency_share', 'premium_checkout', 'availability_setup']);

export default function RootNavigator() {
  const verified = useAppStore((s) => s.session.verified);
  const theme = useTheme();
  // After a light/dark switch the tree remounts; put the user back where they were.
  const [initialState] = React.useState(() => theme.takeNavState?.());

  // Session expired / revoked elsewhere → back to the start of sign-in.
  useEffect(() => {
    if (!verified && navigationRef.isReady()) {
      const current = navigationRef.getCurrentRoute()?.name;
      if (current && !ONBOARDING_PUBLIC.has(current)) resetTo('welcome');
    }
  }, [verified]);

  return (
    <NavigationContainer ref={navigationRef} theme={makeNavTheme(theme.isDark)} linking={initialState ? { ...linking, getInitialURL: async () => null } : linking} initialState={initialState}>
      <Stack.Navigator
        initialRouteName={firstRoute(useAppStore.getState())}
        screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}
      >
        <Stack.Screen name="main" component={MainTabs} />
        {SCREENS.filter((s) => !TAB_SCREENS.includes(s.id)).map((s) => (
          <Stack.Screen
            key={s.id}
            name={s.id}
            component={s.component}
            initialParams={s.id === 'social_style' ? { mode: 'prompt' } : undefined}
            options={{
              ...(MODALS.has(s.id) ? { presentation: 'modal', animation: 'slide_from_bottom' } : null),
              ...s.options,
            }}
          />
        ))}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
