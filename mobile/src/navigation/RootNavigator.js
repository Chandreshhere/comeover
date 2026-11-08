import React, { useEffect } from 'react';
import { View } from 'react-native';
import { navigationRef, resetTo } from './navigationRef';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAppStore } from '@/store/useAppStore';
import { colors } from '@/theme/tokens';
import { SCREENS, getScreen } from './registry';
import { INVENTORY, TAB_SCREENS } from './inventory';
import TabBar from './TabBar';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.canvas, primary: colors.ink, card: colors.surface, text: colors.ink, border: colors.border } };

const Empty = () => <View />;

function MainTabs() {
  return (
    <Tab.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }} initialRouteName="discover_home">
      {TAB_SCREENS.map((name) => (
        <Tab.Screen key={name} name={name} component={name === 'create_tab' ? Empty : getScreen(name).component} />
      ))}
    </Tab.Navigator>
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

const ONBOARDING_PUBLIC = new Set(['boot_splash', 'service_status', 'welcome', 'phone_entry', 'otp_verify']);

// Modal-presented screens (sheets & full-screen flows).
const MODALS = new Set(['filters_sheet', 'join_request', 'block_confirm', 'report_flow', 'emergency_share', 'premium_checkout', 'availability_setup']);

export default function RootNavigator() {
  const onboarded = useAppStore((s) => s.session.onboarded);
  const verified = useAppStore((s) => s.session.verified);

  // Session expired / revoked elsewhere → back to the start of sign-in.
  useEffect(() => {
    if (!verified && navigationRef.isReady()) {
      const current = navigationRef.getCurrentRoute()?.name;
      if (current && !ONBOARDING_PUBLIC.has(current)) resetTo('welcome');
    }
  }, [verified]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <Stack.Navigator
        initialRouteName={verified && onboarded ? 'main' : 'boot_splash'}
        screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}
      >
        <Stack.Screen name="main" component={MainTabs} />
        {SCREENS.filter((s) => !TAB_SCREENS.includes(s.id)).map((s) => (
          <Stack.Screen
            key={s.id}
            name={s.id}
            component={s.component}
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
