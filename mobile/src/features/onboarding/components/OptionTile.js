// Square pictogram tile for multi-select onboarding steps (interests, what
// brings you here). Lay tiles out in a <ChipGrid> so every row lines up; the
// wrapper stretches to the tallest tile in its row, so a two-line label never
// leaves neighbouring tiles shorter.
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText, Icon, Pictogram, usePressScale } from '@/components';
import { accents, colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function OptionTile({ label, pictogram, index = 0, selected, onPress, width }) {
  const accent = accents[index % accents.length].bg;
  const press = usePressScale(0.94);
  // Bubble scales with the tile so the check never covers the label on narrow phones.
  const bubble = Math.round(Math.min(52, width * 0.48));
  return (
    <Animated.View entering={enter(Math.min(index, 8))} style={{ flex: 1 }}>
      <AnimatedPressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!selected }}
        accessibilityLabel={label}
        style={[
          {
            flex: 1,
            minHeight: width,
            borderRadius: radius.card,
            backgroundColor: selected ? colors.ink : colors.surface,
            borderWidth: 1.2,
            borderColor: selected ? colors.ink : colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.xs,
            paddingVertical: space.sm,
          },
          press.style,
        ]}
      >
        <View style={{ width: bubble, height: bubble, borderRadius: bubble / 2, backgroundColor: selected ? colors.white : accent, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={pictogram} size={Math.round(bubble * 0.54)} color={colors.ink} duotoneColor={selected ? colors.periwinkle : colors.ink} duotoneOpacity={selected ? 0.9 : 0.22} />
          {selected && (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: colors.periwinkle,
                borderWidth: 2,
                borderColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={12} color={colors.ink} />
            </View>
          )}
        </View>
        <AppText variant="label" color={selected ? colors.white : colors.ink} align="center" numberOfLines={2} style={{ marginTop: space.xs }}>
          {label}
        </AppText>
      </AnimatedPressable>
    </Animated.View>
  );
}

// Width of one tile in an N-column grid that spans the screen's content width.
export const tileWidth = (screenWidth, columns, gap, padding) => (screenWidth - padding * 2 - gap * (columns - 1)) / columns;
