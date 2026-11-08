// Manual city-area picker — the no-GPS path. Only the coarse area is used.
import React from 'react';
import { ScrollView } from 'react-native';
import { AppText, OptionCard, Sheet } from '@/components';
import { CITY } from '@/data/catalog';
import { colors, space } from '@/theme/tokens';

export default function AreaPickerSheet({ visible, onClose, value, onSelect }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={`Pick your area in ${CITY.name}`}>
      <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.sm }}>
        We'll show plans around this neighbourhood. Change it any time in Privacy controls.
      </AppText>
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        {CITY.areas.map((a) => (
          <OptionCard key={a} title={a} selected={value === a} onPress={() => onSelect(a)} />
        ))}
      </ScrollView>
    </Sheet>
  );
}
