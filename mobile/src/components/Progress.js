import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors, radius } from '@/theme/tokens';
import { durations, easeOut } from '@/theme/motion';
import AppText from './AppText';

export function ProgressBar({ value = 0, height = 7, track = colors.track, fill = colors.ink, style, accessibilityLabel }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, value)), { duration: durations.expressive, easing: easeOut });
  }, [value]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[{ height, borderRadius: radius.pill, backgroundColor: track, overflow: 'hidden' }, style]}
    >
      <Animated.View style={[{ height, borderRadius: radius.pill, backgroundColor: fill }, a]} />
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Circular capacity / quest ring with a centred "2/3" label, as in the reference.
export function ProgressRing({ value = 0, size = 40, stroke = 3, color = colors.ink, track = 'rgba(9,10,14,0.15)', label, labelColor = colors.ink }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(1, value)), { duration: durations.expressive, easing: easeOut });
  }, [value]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={label}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
        />
      </Svg>
      {label ? (
        <AppText variant="caption" color={labelColor} style={{ fontSize: size < 36 ? 9 : 11 }}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
