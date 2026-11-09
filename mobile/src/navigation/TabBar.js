// Bottom tab bar: Phosphor icons (fill when active, regular otherwise), a
// bubbly active pill that springs in, and a raised Create (+) button in the
// centre. Each item registers as an app-tour target (`tab:<route name>`).
import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '@/components';
import TourTarget from '@/features/guide/tourTargets';
import { colors, fonts, isDark, layout, palettes, shadow, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';

const META = {
  discover_home: { label: 'Discover', icon: 'Compass' },
  live_radar: { label: 'Live', icon: 'Broadcast' },
  create_tab: { label: 'Create', icon: 'Plus' },
  circles_home: { label: 'Circles', icon: 'UsersThree' },
  profile_home: { label: 'Profile', icon: 'UserCircle' },
};

const PILL_W = 58;
const PILL_H = 32;
const CREATE = 58;
const BOUNCY = { damping: 11, stiffness: 260, mass: 0.6 };

function TabItem({ routeName, focused, onPress, onLongPress }) {
  const m = META[routeName] || { label: routeName, icon: 'Circle' };
  const reduce = useReducedMotion();
  const p = useSharedValue(focused ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    p.value = reduce ? (focused ? 1 : 0) : withSpring(focused ? 1 : 0, BOUNCY);
    if (focused && !reduce) pop.value = withSequence(withTiming(0.82, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 300 }));
  }, [focused, reduce]);
  const pill = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scaleX: 0.4 + p.value * 0.6 }, { scaleY: 0.7 + p.value * 0.3 }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }, { translateY: -p.value * 1 }] }));
  const color = focused ? colors.deep : colors.muted;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={m.label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: layout.minTouch }}
    >
      <TourTarget id={`tab:${routeName}`} style={{ alignItems: 'center', paddingHorizontal: 2 }}>
        <View style={{ width: PILL_W, height: PILL_H, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute', width: PILL_W, height: PILL_H, borderRadius: PILL_H / 2, backgroundColor: colors.periwinkleWash }, pill]} />
          <Animated.View style={icon}>
            <Icon name={m.icon} size={23} color={color} weight={focused ? 'fill' : 'regular'} />
          </Animated.View>
        </View>
        <AppText variant="caption" color={focused ? colors.ink : colors.muted} maxScale={1.15} numberOfLines={1} style={{ marginTop: 3, fontFamily: focused ? fonts.semibold : fonts.medium }}>
          {m.label}
        </AppText>
      </TourTarget>
    </Pressable>
  );
}

function CreateButton({ onPress }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const r = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const plus = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: PILL_W, height: PILL_H, alignItems: 'center' }}>
        <TourTarget id="tab:create_tab" style={{ position: 'absolute', bottom: 2, left: (PILL_W - CREATE - 10) / 2, width: CREATE + 10, height: CREATE + 10, borderRadius: (CREATE + 10) / 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a plan"
            onPressIn={() => {
              if (!reduce) s.value = withTiming(0.92, { duration: 90 });
            }}
            onPressOut={() => {
              s.value = withSpring(1, BOUNCY);
            }}
            onPress={() => {
              haptics.medium();
              if (!reduce) r.value = withSequence(withTiming(90, { duration: 180 }), withTiming(0, { duration: 0 }));
              onPress();
            }}
            hitSlop={4}
          >
            <Animated.View
              style={[
                {
                  width: CREATE + 10,
                  height: CREATE + 10,
                  borderRadius: (CREATE + 10) / 2,
                  padding: 5,
                  backgroundColor: colors.surface,
                },
                shadow.floating,
                style,
              ]}
            >
              {/* Flat brand fill (no gradients). The fixed light-palette deep blue
                  keeps the white + legible in both schemes; the surface ring and
                  floating shadow around it give the lift. */}
              <View style={{ flex: 1, borderRadius: CREATE / 2, backgroundColor: palettes.light.deep, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={plus}>
                  <Icon name="Plus" size={26} color={colors.pureWhite} weight="bold" />
                </Animated.View>
              </View>
            </Animated.View>
          </Pressable>
        </TourTarget>
      </View>
      <AppText variant="caption" color={colors.muted} maxScale={1.15} numberOfLines={1} style={{ marginTop: 3, fontFamily: fonts.medium }}>
        Create
      </AppText>
    </View>
  );
}

export default function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const dark = isDark();
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
          borderWidth: dark ? 1 : 0,
          borderBottomWidth: 0,
          borderColor: colors.border,
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
          return <CreateButton key={route.key} onPress={() => navigation.navigate('create_activity_type')} />;
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
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          />
        );
      })}
    </View>
  );
}
