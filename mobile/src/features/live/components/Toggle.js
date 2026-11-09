// On/off switch for the live feature. iOS 26 draws UISwitch wider (63pt)
// than the 51pt box React Native lays it out in, so the extra spills past the
// right edge and the switch touches its card's border. Reserve that overhang
// so the switch lines up with the card's right padding on every iOS version.
import React from 'react';
import { Platform, Switch, View } from 'react-native';
import { colors, isDark, palettes } from '@/theme/tokens';

const IOS_MAJOR = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) || 0 : 0;
const OVERHANG = IOS_MAJOR >= 26 ? 12 : 0;

export default function Toggle({ value, onValueChange, accessibilityLabel, accessibilityHint, style }) {
  return (
    <View style={[{ marginRight: OVERHANG }, style]}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        // Same tones as ListRow switches: ink when on (a solid brand blue in dark
        // mode, where ink turns near-white and the white thumb would vanish).
        trackColor={{ false: colors.track, true: isDark() ? palettes.light.deep : colors.ink }}
        ios_backgroundColor={colors.track}
        thumbColor={colors.pureWhite}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      />
    </View>
  );
}
