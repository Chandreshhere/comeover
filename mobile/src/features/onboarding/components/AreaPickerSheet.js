// Manual city + area picker: the no-GPS path. Only the coarse area is used.
// onSelect(areaName, city) where city is a GET /cities item.
import React from 'react';
import { ScrollView } from 'react-native';
import { AppText, Sheet } from '@/components';
import { colors, space } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
import CityAreaPicker from './CityAreaPicker';

export default function AreaPickerSheet({ visible, onClose, value, onSelect }) {
  const cityName = useAppStore((s) => s.profile.city);
  return (
    <Sheet visible={visible} onClose={onClose} title="Pick your area">
      <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.sm }}>
        Plans near here show first. Change it any time.
      </AppText>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingVertical: space.xxs }} showsVerticalScrollIndicator={false}>
        <CityAreaPicker value={value} cityName={cityName || undefined} onSelect={onSelect} />
      </ScrollView>
    </Sheet>
  );
}
