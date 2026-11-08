import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { usePressScale } from './Button';

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
