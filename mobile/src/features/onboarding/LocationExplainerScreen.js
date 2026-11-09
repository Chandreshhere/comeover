// location_explainer — explain approximate location use BEFORE the OS prompt.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MapPinArea } from 'phosphor-react-native/src/icons/MapPinArea';
import { Button } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { space } from '@/theme/tokens';
import OnboardingFrame, { PointRow } from './components/OnboardingFrame';
import AreaPickerSheet from './components/AreaPickerSheet';
import CoarseMapArt from './components/CoarseMapArt';

export default function LocationExplainerScreen() {
  const nav = useNavigation();
  const area = useAppStore((s) => s.profile.area);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const [picker, setPicker] = useState(false);

  return (
    <OnboardingFrame
      stepId="location_explainer"
      hero={<CoarseMapArt area={area} />}
      title="Find plans nearby"
      subtitle="We only use your rough area, never your exact spot."
      footer={
        <View>
          <Button title="Continue" onPress={() => nav.navigate('location_permission')} />
          <Button title="Choose my area manually" variant="ghost" style={{ marginTop: space.xs }} onPress={() => setPicker(true)} />
        </View>
      }
    >
      <PointRow icon={MapPinArea} tone="periwinkle" title="Others see only your area" />
      <PointRow icon="pause-circle" tone="orange" title="No background tracking" />
      <PointRow icon="map" tone="lavender" title="Works without GPS too" />

      <AreaPickerSheet
        visible={picker}
        value={area}
        onClose={() => setPicker(false)}
        onSelect={(a, city) => {
          useAppStore.getState().setHomeArea(a, city);
          setPrefs({ location: 'manual', coords: null });
          setPicker(false);
          nav.navigate('notification_opt_in');
        }}
      />
    </OnboardingFrame>
  );
}
