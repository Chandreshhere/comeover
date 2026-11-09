// Manual city-area picker — the no-GPS path. Only the coarse area is used.
import React from 'react';
import { ScrollView } from 'react-native';
import { AppText, Chip, ChipGrid, Sheet } from '@/components';
import { CITY } from '@/data/catalog';
import { colors, space } from '@/theme/tokens';

export default function AreaPickerSheet({ visible, onClose, value, onSelect }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Pick your area">
      <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.sm }}>
        Plans near here show first. Change it any time.
      </AppText>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: space.xxs }} showsVerticalScrollIndicator={false}>
        <ChipGrid columns={2}>
          {CITY.areas.map((a) => (
            <Chip key={a} label={a} fill selected={value === a} onPress={() => onSelect(a)} />
          ))}
        </ChipGrid>
      </ScrollView>
    </Sheet>
  );
}
