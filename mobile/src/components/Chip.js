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
const CHIP_HEIGHT = layout.chipHeight + 4;

// Category / filter pill. `pictogram` takes an activity glyph name; `icon` an
// app icon name; `glyph` a Phosphor component (for glyphs outside the map).
// `fill`: stretch to the parent's width with centred content (use inside ChipGrid).
export default function Chip({ label, selected = false, onPress, pictogram, icon, glyph: Glyph, tone = 'surface', style, count, accessibilityLabel, fill = false }) {
  const press = usePressScale(0.95);
  const bg = selected ? colors.ink : tone === 'glass' ? colors.glass : colors.surface;
  const fg = selected ? colors.white : colors.inkSoft;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel || (count != null ? `${label}, ${count}` : label)}
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={(layout.minTouch - CHIP_HEIGHT) / 2}
      style={[
        {
          height: CHIP_HEIGHT,
          maxWidth: '100%',
          borderRadius: radius.pill,
          paddingHorizontal: 14,
          ...(fill ? { alignSelf: 'stretch', justifyContent: 'center' } : null),
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
      {!!pictogram && (
        <View style={{ marginRight: 6 }}>
          <Pictogram name={pictogram} size={18} color={fg} duotoneOpacity={selected ? 0.4 : 0.28} />
        </View>
      )}
      {!!Glyph && <Glyph size={15} color={fg} weight="bold" style={{ marginRight: 6 }} />}
      {!!icon && !Glyph && <Icon name={icon} size={15} color={fg} style={{ marginRight: 6 }} />}
      <AppText variant="label" color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>
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
      contentContainerStyle={[{ paddingHorizontal: layout.screenPadding, gap: space.xs, alignItems: 'center' }, contentStyle]}
    >
      {children}
    </ScrollView>
  );
}

// Small static label pill, e.g. "Public venue", "Sponsored", "Host-approved".
// `glyph` takes a Phosphor component for icons outside the app icon map.
export function Tag({ label, bg = colors.surfaceSubtle, fg = colors.inkSoft, icon, glyph: Glyph, style }) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          maxWidth: '100%',
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingHorizontal: 10,
          paddingVertical: space.xxs,
        },
        style,
      ]}
    >
      {!!Glyph && <Glyph size={12} color={fg} weight="bold" style={{ marginRight: space.xxs }} />}
      {!!icon && !Glyph && <Icon name={icon} size={12} color={fg} style={{ marginRight: space.xxs }} />}
      <AppText variant="caption" color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </View>
  );
}
