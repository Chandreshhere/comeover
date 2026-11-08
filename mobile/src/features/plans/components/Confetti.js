// Confetti dots burst (mascot_success / join accepted). Brief, non-blocking,
// pointerEvents none, and fully skipped under Reduce Motion.
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { colors } from '@/theme/tokens';
import { durations } from '@/theme/motion';

const PALETTE = [colors.orange, colors.pink, colors.periwinkle, colors.ink, colors.mint, colors.deep];

function Dot({ angle, dist, size, color, delay, burstKey, round }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: durations.celebration + 250, easing: Easing.out(Easing.cubic) }));
  }, [burstKey]);
  const a = useAnimatedStyle(() => ({
    opacity: p.value < 0.7 ? 1 : 1 - (p.value - 0.7) / 0.3,
    transform: [
      { translateX: Math.cos(angle) * dist * p.value },
      { translateY: Math.sin(angle) * dist * p.value + 40 * p.value * p.value },
      { rotate: `${p.value * 220}deg` },
      { scale: 0.4 + p.value * 0.6 },
    ],
  }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: round ? size : size * 0.5, borderRadius: round ? size / 2 : 2, backgroundColor: color }, a]} />;
}

export default function Confetti({ burstKey = 1, count = 26, spread = 170, style }) {
  const reduce = useReducedMotion();
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: (i / count) * Math.PI * 2 + (i % 3) * 0.2,
        dist: spread * (0.55 + ((i * 37) % 45) / 100),
        size: 7 + (i % 4) * 2,
        color: PALETTE[i % PALETTE.length],
        delay: (i % 5) * 25,
        round: i % 2 === 0,
      })),
    [count, spread]
  );
  if (reduce || !burstKey) return null;
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 1, height: 1 }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dots.map((d, i) => (
        <Dot key={i} {...d} burstKey={burstKey} />
      ))}
    </View>
  );
}
