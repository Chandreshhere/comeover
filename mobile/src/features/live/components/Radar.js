// Live radar: concentric distance bands with plan blips placed by a stable
// pseudo-bearing + coarse distance band — never real positions, never people.
// radar_pulse: one subtle ring pulse per refresh; static under Reduce Motion.
import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { AppText, Pictogram } from '@/components';
import { colors } from '@/theme/tokens';
import { durations } from '@/theme/motion';
import { hashStr } from '@/features/discover/utils';

export const BANDS = [
  { id: 'b1', label: '< 1 km', maxM: 1000, inner: 0.14, outer: 0.33 },
  { id: 'b2', label: '1–3 km', maxM: 3000, inner: 0.38, outer: 0.63 },
  { id: 'b3', label: '3–10 km', maxM: 10000, inner: 0.68, outer: 0.9 },
];

export const bandFor = (m) => BANDS.find((b) => (m ?? 0) <= b.maxM) || BANDS[BANDS.length - 1];

const BLIP = 38;

export default function Radar({ size, items, pulseKey, onPressItem }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(1);
  const r = size / 2;

  useEffect(() => {
    if (reduce) return;
    p.value = 0;
    p.value = withTiming(1, { duration: durations.radarPulse, easing: Easing.out(Easing.quad) });
  }, [pulseKey, reduce]);

  const pulse = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - p.value), transform: [{ scale: 0.1 + p.value * 0.9 }] }));

  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {BANDS.map((b) => (
          <Circle key={b.id} cx={r} cy={r} r={r * (b.outer + 0.04)} stroke={colors.white} strokeOpacity={0.75} strokeWidth={1.4} fill="none" />
        ))}
        <Circle cx={r} cy={r} r={r * 0.98} stroke={colors.ink} strokeOpacity={0.12} strokeWidth={1} fill="none" />
        <Line x1={r} y1={6} x2={r} y2={size - 6} stroke={colors.white} strokeOpacity={0.5} strokeDasharray="3 6" />
        <Line x1={6} y1={r} x2={size - 6} y2={r} stroke={colors.white} strokeOpacity={0.5} strokeDasharray="3 6" />
      </Svg>

      {/* single refresh pulse */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: r, borderWidth: 2, borderColor: colors.white, backgroundColor: 'rgba(255,255,255,0.18)' }, pulse]} />

      {/* band labels */}
      {BANDS.map((b) => (
        <View key={b.id} pointerEvents="none" style={{ position: 'absolute', left: r + 4, top: r - r * (b.outer + 0.04) + 2 }}>
          <AppText variant="caption" color={colors.inkSoft}>
            {b.label}
          </AppText>
        </View>
      ))}

      {/* centre: you (abstract origin, not a map position) */}
      <View pointerEvents="none" style={{ position: 'absolute', left: r - 22, top: r - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white }}>
        <AppText variant="caption" color={colors.white}>
          You
        </AppText>
      </View>

      {items.map((a) => {
        const h = hashStr(a.id);
        const band = bandFor(a.distanceM);
        const angle = ((h % 360) * Math.PI) / 180;
        const frac = band.inner + ((h >> 8) % 100) / 100 * (band.outer - band.inner);
        const x = r + Math.cos(angle) * frac * r - BLIP / 2;
        const y = r + Math.sin(angle) * frac * r - BLIP / 2;
        const soon = a.live || new Date(a.startsAt) - Date.now() < 30 * 60000;
        return (
          <Pressable
            key={a.id}
            onPress={() => onPressItem?.(a)}
            accessibilityRole="button"
            accessibilityLabel={`${a.title}, ${band.label} away`}
            hitSlop={4}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: BLIP,
              height: BLIP,
              borderRadius: BLIP / 2,
              backgroundColor: soon ? colors.orange : colors.white,
              borderWidth: 2,
              borderColor: colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Pictogram name={a.pictogram} size={20} />
          </Pressable>
        );
      })}
    </View>
  );
}
