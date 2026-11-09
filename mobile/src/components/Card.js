import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { Pictogram } from '@/illustrations/Pictograms';
import { usePressScale } from './Button';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function Card({ children, onPress, style, padding = space.md, bg = colors.surface, elevated = true, accessibilityLabel, r = radius.card }) {
  const press = usePressScale(0.98);
  const base = [{ backgroundColor: bg, borderRadius: r, padding }, elevated && shadow.card, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[base, press.style]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Periwinkle signature surface (hero_card token).
export function HeroCard({ children, style, onPress, bg = colors.periwinkle, accessibilityLabel }) {
  return (
    <Card onPress={onPress} bg={bg} r={radius.hero} padding={18} elevated={false} style={[{ overflow: 'hidden' }, style]} accessibilityLabel={accessibilityLabel}>
      {children}
    </Card>
  );
}

// Soft pastel bubble tones: `bg` is the bubble, `duo` the second (fill) tone of
// a duotone glyph inside it. A function so it follows the live light/dark palette.
export function bubbleTone(tone = 'periwinkle') {
  const t = {
    periwinkle: { bg: colors.periwinkleWash, duo: colors.deep },
    pink: { bg: colors.pinkSoft, duo: colors.pink },
    orange: { bg: colors.orangeSoft, duo: colors.orange },
    mint: { bg: colors.mint, duo: colors.success },
    lavender: { bg: colors.lavender, duo: colors.deep },
    surface: { bg: colors.surface, duo: colors.deep },
    subtle: { bg: colors.surfaceSubtle, duo: colors.deep },
    ink: { bg: colors.ink, duo: colors.periwinkle },
  };
  return t[tone] || t.periwinkle;
}

// Round (or squircle) pastel bubble holding a duotone glyph. Pass one of
// `pictogram` (activity key), `icon` (app icon name), `glyph` (a Phosphor
// component) or plain children. Pastel cards get `tone="surface"` bubbles,
// white cards get pastel ones.
export function IconBubble({ size = 44, tone = 'periwinkle', bg, duo, color, pictogram, icon, glyph: Glyph, iconSize, shape = 'circle', style, children }) {
  const t = bubbleTone(tone);
  const s = iconSize || Math.round(size * 0.52);
  const tint = color || (tone === 'ink' ? colors.white : colors.ink);
  const glyphProps = { size: s, color: tint, weight: 'duotone', duotoneColor: duo || t.duo, duotoneOpacity: 0.5 };
  let content = children;
  if (!content && pictogram) content = <Pictogram name={pictogram} {...glyphProps} />;
  else if (!content && Glyph) content = <Glyph {...glyphProps} />;
  else if (!content && icon) content = <Icon name={icon} {...glyphProps} />;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: shape === 'squircle' ? Math.round(size * 0.32) : size / 2,
          backgroundColor: bg || t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {content}
    </View>
  );
}
