import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { colors, layout, radius } from '@/theme/tokens';
import { spring } from '@/theme/motion';
import haptics from '@/utils/haptics';
import AppText from './AppText';

const PAD = 3;
const BORDER = 1.2;
const INSET = 2 * (PAD + BORDER);

// Pill segmented control with a sliding ink thumb (Day/Week/Month, List/Map…).
export default function Segmented({ options, value, onChange, style, compact = false }) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => (o.value ?? o) === value));
  const segW = w / options.length;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(idx * segW, spring) }] }), [idx, segW]);
  const h = compact ? 34 : 44;
  const slop = Math.max(0, (layout.minTouch - h) / 2);
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setW(e.nativeEvent.layout.width - INSET)}
      style={[{ height: h, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: BORDER, borderColor: colors.border, padding: PAD, flexDirection: 'row' }, style]}
    >
      {w > 0 && <Animated.View style={[{ position: 'absolute', top: PAD, left: PAD, width: segW, height: h - INSET, borderRadius: radius.pill, backgroundColor: colors.ink }, thumb]} />}
      {options.map((o) => {
        const v = o.value ?? o;
        const label = o.label ?? o;
        const active = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="tab"
            accessibilityLabel={String(label)}
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptics.select();
              onChange?.(v);
            }}
            hitSlop={{ top: slop, bottom: slop }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}
          >
            <AppText variant="label" color={active ? colors.white : colors.inkSoft} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
