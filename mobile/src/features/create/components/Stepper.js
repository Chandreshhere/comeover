import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AppText, IconButton } from '@/components';
import { colors, radius } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';

// Numeric − value + control (group capacity etc.). The number does a little
// springy pop when it changes (still under Reduce Motion).
export default function Stepper({ value, onChange, min = 2, max = 30, label, suffix = 'people', style }) {
  const reduce = useReducedMotion();
  const pop = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!reduce) pop.value = withSequence(withTiming(1.18, { duration: durations.micro }), withSpring(1, spring));
  }, [value, reduce]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: `${value} ${suffix}` }}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - 1));
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1.2, borderColor: colors.border, padding: 4 }, style]}
    >
      <IconButton icon="minus" variant={atMin ? 'surface' : 'ink'} onPress={() => onChange(Math.max(min, value - 1))} accessibilityLabel="Fewer" style={{ opacity: atMin ? 0.4 : 1 }} />
      <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, popStyle]}>
        <AppText variant="h2">{value}</AppText>
        <AppText variant="caption" color={colors.muted}>
          {suffix}
        </AppText>
      </Animated.View>
      <IconButton icon="plus" variant={atMax ? 'surface' : 'ink'} onPress={() => onChange(Math.min(max, value + 1))} accessibilityLabel="More" style={{ opacity: atMax ? 0.4 : 1 }} />
    </View>
  );
}
