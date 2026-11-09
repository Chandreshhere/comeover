// Activity pictograms. Server taxonomy keys ('chai', 'badminton', 'gym'…) map
// to Phosphor (MIT) glyphs in components/iconMap.js. Duotone by default: the
// soft second tone keeps them friendly next to Poppins.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors } from '../theme/tokens';
import { PICTOGRAM_ICONS, iconComponent } from '../components/iconMap';

export const PICTOGRAM_NAMES = Object.keys(PICTOGRAM_ICONS);

// strokeWidth is kept for old call sites: thick strokes → bold, otherwise duotone.
export function Pictogram({ name, size = 28, color, strokeWidth = 2, weight, duotoneColor, duotoneOpacity = 0.28 }) {
  const Glyph = iconComponent(PICTOGRAM_ICONS[name] || PICTOGRAM_ICONS.sparkle);
  const tint = color || colors.ink;
  return <Glyph size={size} color={tint} weight={weight || (strokeWidth >= 2.5 ? 'bold' : 'duotone')} duotoneColor={duotoneColor || tint} duotoneOpacity={duotoneOpacity} />;
}

// Floating activity bubbles used above the mascot on hero screens. Positions
// are relative (0..1) so the cluster scales with its container; each bubble
// bobs gently on its own rhythm (still when Reduce Motion is on).
const CLUSTER = [
  { n: 'chai', x: 0.02, y: 0.22, s: 1, tone: 'orange' },
  { n: 'badminton', x: 0.2, y: 0.0, s: 0.86, tone: 'mint' },
  { n: 'music', x: 0.4, y: 0.16, s: 0.74, tone: 'pink' },
  { n: 'walk', x: 0.6, y: 0.0, s: 0.9, tone: 'lavender' },
  { n: 'camera', x: 0.8, y: 0.2, s: 1, tone: 'orange' },
  { n: 'gym', x: 0.1, y: 0.62, s: 0.78, tone: 'lavender' },
  { n: 'game', x: 0.84, y: 0.64, s: 0.8, tone: 'mint' },
];
const toneBg = (t) => ({ orange: colors.orangeSoft, mint: colors.mint, pink: colors.pinkSoft, lavender: colors.lavender }[t] || colors.surface);
const toneFg = (t) => ({ orange: colors.orange, mint: colors.success, pink: colors.pink, lavender: colors.deep }[t] || colors.ink);

function Bubble({ p, i, width, height }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withDelay(i * 180, withRepeat(withSequence(withTiming(-6, { duration: 1500 + i * 120, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1500 + i * 120, easing: Easing.inOut(Easing.sin) })), -1));
  }, [reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const d = Math.round(48 * p.s);
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: p.x * (width - d),
          top: p.y * (height - d),
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: toneBg(p.tone),
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: colors.surface,
        },
        style,
      ]}
    >
      <Pictogram name={p.n} size={d * 0.52} color={colors.ink} duotoneColor={toneFg(p.tone)} duotoneOpacity={0.6} />
    </Animated.View>
  );
}

export function PictogramCluster({ width, height }) {
  return (
    <View pointerEvents="none" style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {CLUSTER.map((p, i) => (
        <Bubble key={p.n} p={p} i={i} width={width} height={height} />
      ))}
    </View>
  );
}
