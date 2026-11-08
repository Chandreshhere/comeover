import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { colors, radius } from '@/theme/tokens';
import { spring } from '@/theme/motion';
import haptics from '@/utils/haptics';
import AppText from './AppText';

// Pill segmented control with a sliding ink thumb (Day/Week/Month, List/Map…).
export default function Segmented({ options, value, onChange, style, compact = false }) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => (o.value ?? o) === value));
  const segW = w / options.length;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(idx * segW, spring) }] }), [idx, segW]);
  const h = compact ? 34 : 44;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setW(e.nativeEvent.layout.width - 8)}
      style={[{ height: h, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1.2, borderColor: colors.border, padding: 3, flexDirection: 'row' }, style]}
    >
      {w > 0 && <Animated.View style={[{ position: 'absolute', top: 3, left: 3, width: segW, height: h - 8.4, borderRadius: radius.pill, backgroundColor: colors.ink }, thumb]} />}
      {options.map((o) => {
        const v = o.value ?? o;
        const label = o.label ?? o;
        const active = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptics.select();
              onChange?.(v);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppText variant="label" color={active ? colors.white : colors.inkSoft}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
