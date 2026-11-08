import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, layout, radius, space } from '@/theme/tokens';
import { Pictogram } from '@/illustrations/Pictograms';
import haptics from '@/utils/haptics';
import { usePressScale } from './Button';
import AppText from './AppText';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Category / filter pill. `pictogram` takes an activity glyph name; `icon` a Feather name.
export default function Chip({ label, selected = false, onPress, pictogram, icon, tone = 'surface', style, count }) {
  const press = usePressScale(0.96);
  const bg = selected ? colors.ink : tone === 'glass' ? colors.glass : colors.surface;
  const fg = selected ? colors.white : colors.inkSoft;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        {
          height: layout.chipHeight + 4,
          borderRadius: radius.pill,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: bg,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : colors.border,
        },
        press.style,
        style,
      ]}
    >
      {pictogram && (
        <View style={{ marginRight: 6 }}>
          <Pictogram name={pictogram} size={18} color={fg} />
        </View>
      )}
      {icon && <Icon name={icon} size={15} color={fg} style={{ marginRight: 6 }} />}
      <AppText variant="label" color={fg}>
        {label}
      </AppText>
      {count != null && (
        <AppText variant="caption" color={selected ? colors.periwinkle : colors.muted} style={{ marginLeft: 6 }}>
          {count}
        </AppText>
      )}
    </AnimatedPressable>
  );
}

export function ChipRow({ children, style, contentStyle }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={[{ paddingHorizontal: layout.screenPadding, gap: space.xs }, contentStyle]}
    >
      {children}
    </ScrollView>
  );
}

// Small static label pill, e.g. "Public venue", "Sponsored", "Host-approved".
export function Tag({ label, bg = colors.surfaceSubtle, fg = colors.inkSoft, icon, style }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={12} color={fg} style={{ marginRight: 4 }} />}
      <AppText variant="caption" color={fg}>
        {label}
      </AppText>
    </View>
  );
}
