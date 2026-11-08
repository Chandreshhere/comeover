import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '@/components';
import { colors, layout, shadow, space } from '@/theme/tokens';
import { durations } from '@/theme/motion';
import haptics from '@/utils/haptics';

const META = {
  discover_home: { label: 'Discover', icon: 'compass' },
  live_radar: { label: 'Live', icon: 'radio' },
  create_tab: { label: 'Create', icon: 'plus' },
  circles_home: { label: 'Circles', icon: 'users' },
  profile_home: { label: 'Profile', icon: 'user' },
};

function TabItem({ routeName, focused, onPress }) {
  const m = META[routeName];
  const p = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(focused ? 1 : 0, { duration: durations.navTab });
  }, [focused]);
  // bottom_nav: icon fill + label fade/slide 3dp
  const label = useAnimatedStyle(() => ({ opacity: 0.55 + p.value * 0.45, transform: [{ translateY: (1 - p.value) * 3 }] }));
  const dot = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: p.value }] }));
  const color = focused ? colors.deep : colors.muted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={m.label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: layout.minTouch }}
    >
      <Icon name={m.icon} size={22} color={color} />
      <Animated.View style={label}>
        <AppText variant="caption" color={color} style={{ marginTop: 3 }}>
          {m.label}
        </AppText>
      </Animated.View>
      <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.deep, marginTop: 3 }, dot]} />
    </Pressable>
  );
}

export default function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          height: layout.bottomNavHeight + insets.bottom,
          paddingBottom: insets.bottom,
          paddingHorizontal: space.xs,
        },
        shadow.floating,
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        if (route.name === 'create_tab') {
          return (
            <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a plan"
                onPress={() => {
                  haptics.medium();
                  navigation.navigate('create_activity_type');
                }}
                style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: -18, borderWidth: 4, borderColor: colors.surface }}
              >
                <Icon name="plus" size={24} color={colors.white} />
              </Pressable>
            </View>
          );
        }
        return (
          <TabItem
            key={route.key}
            routeName={route.name}
            focused={focused}
            onPress={() => {
              haptics.select();
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
            }}
          />
        );
      })}
    </View>
  );
}
