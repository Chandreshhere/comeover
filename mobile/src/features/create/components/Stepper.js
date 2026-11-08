import React from 'react';
import { View } from 'react-native';
import { AppText, IconButton } from '@/components';
import { colors, radius, space } from '@/theme/tokens';

// Numeric − value + control (group capacity etc.).
export default function Stepper({ value, onChange, min = 2, max = 30, label, suffix = 'people', style }) {
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: `${value} ${suffix}` }}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - 1));
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1.2, borderColor: colors.border, padding: 4 }, style]}
    >
      <IconButton icon="minus" variant={value <= min ? 'surface' : 'ink'} onPress={() => onChange(Math.max(min, value - 1))} accessibilityLabel="Fewer" style={{ opacity: value <= min ? 0.4 : 1 }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <AppText variant="h2">{value}</AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: -2 }}>
          {suffix}
        </AppText>
      </View>
      <IconButton icon="plus" variant={value >= max ? 'surface' : 'ink'} onPress={() => onChange(Math.min(max, value + 1))} accessibilityLabel="More" style={{ opacity: value >= max ? 0.4 : 1, marginLeft: space.xs }} />
    </View>
  );
}
