// Small "live" indicator: a solid dot with a soft breathing halo.
// Static under Reduce Motion.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/theme/tokens';

export default function LiveDot({ color, size = 8, style }) {
  const tint = color || colors.success;
  const reduce = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduce) return undefined;
    t.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [reduce]);

  const halo = useAnimatedStyle(
    () => ({ opacity: reduce ? 0 : 0.55 * (1 - t.value), transform: [{ scale: 1 + t.value * 1.8 }] }),
    [reduce]
  );

  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: tint },
          halo,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint }} />
    </View>
  );
}
