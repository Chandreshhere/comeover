// Illustration for the location explainer: a fuzzy area circle (what others
// see) around a pin (what stays on your device).
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Pictogram } from '@/components';
import { colors, radius } from '@/theme/tokens';

export default function CoarseMapArt({ area = 'Navrangpura', height = 200 }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Illustration: others only see an approximate area like ${area}`}
      style={{ height, borderRadius: radius.hero, backgroundColor: colors.periwinkle, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute' }}>
        {/* streets */}
        <Path d="M-10 60 C80 40 160 90 330 50" stroke="rgba(255,255,255,0.55)" strokeWidth={10} fill="none" />
        <Path d="M40 -10 C70 80 50 140 90 210" stroke="rgba(255,255,255,0.55)" strokeWidth={8} fill="none" />
        <Path d="M-10 160 C100 140 210 175 330 140" stroke="rgba(255,255,255,0.45)" strokeWidth={7} fill="none" />
        <Path d="M240 -10 C220 70 260 130 230 210" stroke="rgba(255,255,255,0.45)" strokeWidth={7} fill="none" />
        {/* coarse area */}
        <Circle cx={160} cy={100} r={72} fill="rgba(255,255,255,0.32)" stroke={colors.ink} strokeWidth={2} strokeDasharray="4 7" />
        <Circle cx={160} cy={100} r={44} fill="rgba(255,255,255,0.35)" />
      </Svg>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Pictogram name="pin" size={28} color={colors.white} />
      </View>
      <View style={{ position: 'absolute', bottom: 14, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
        <AppText variant="label">Others see: “around {area}”</AppText>
      </View>
    </View>
  );
}
