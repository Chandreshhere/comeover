// Illustration for the location explainer: a fuzzy area circle (what others
// see) around a pin (what stays on your device). Colours are read at render so
// the streets and area glow follow light/dark mode.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Pictogram } from '@/components';
import { colors, glass, radius, space } from '@/theme/tokens';

// The area circle sits a little above centre so the caption pill below never
// touches its dashed edge, at any screen width.
const AREA_CY = 86;
const PIN_SIZE = 52;

export default function CoarseMapArt({ area, height = 200 }) {
  const label = area ? `Others see: “around ${area}”` : 'Others see: just your neighbourhood';
  const street = glass(0.55);
  const streetSoft = glass(0.42);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Illustration: others only see an approximate area${area ? ` like ${area}` : ''}`}
      style={{ height, borderRadius: radius.hero, backgroundColor: colors.periwinkle, overflow: 'hidden', alignItems: 'center' }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute' }}>
        {/* streets */}
        <Path d="M-10 60 C80 40 160 90 330 50" stroke={street} strokeWidth={10} strokeLinecap="round" fill="none" />
        <Path d="M40 -10 C70 80 50 140 90 210" stroke={street} strokeWidth={8} strokeLinecap="round" fill="none" />
        <Path d="M-10 160 C100 140 210 175 330 140" stroke={streetSoft} strokeWidth={7} strokeLinecap="round" fill="none" />
        <Path d="M240 -10 C220 70 260 130 230 210" stroke={streetSoft} strokeWidth={7} strokeLinecap="round" fill="none" />
        {/* coarse area */}
        <Circle cx={160} cy={AREA_CY} r={60} fill={glass(0.32)} stroke={colors.ink} strokeWidth={2} strokeDasharray="4 7" strokeLinecap="round" />
        <Circle cx={160} cy={AREA_CY} r={38} fill={glass(0.4)} />
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: (height * AREA_CY) / 200 - PIN_SIZE / 2,
          width: PIN_SIZE,
          height: PIN_SIZE,
          borderRadius: PIN_SIZE / 2,
          backgroundColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pictogram name="pin" size={28} color={colors.white} duotoneColor={colors.periwinkle} duotoneOpacity={0.9} />
      </View>
      <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.sm, alignItems: 'center' }}>
        <View style={{ maxWidth: '100%', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 6 }}>
          <AppText variant="label" numberOfLines={1}>
            {label}
          </AppText>
        </View>
      </View>
    </View>
  );
}
