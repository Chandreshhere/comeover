// location_explainer — explain approximate location use BEFORE the OS prompt.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { space } from '@/theme/tokens';
import OnboardingFrame, { PointRow } from './components/OnboardingFrame';
import AreaPickerSheet from './components/AreaPickerSheet';
import CoarseMapArt from './components/CoarseMapArt';

export default function LocationExplainerScreen() {
  const nav = useNavigation();
  const area = useAppStore((s) => s.profile.area);
  const setProfile = useAppStore((s) => s.setProfile);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const [picker, setPicker] = useState(false);

  return (
    <OnboardingFrame
      stepId="location_explainer"
      hero={<CoarseMapArt area={area} />}
      title="Plans near you, privately"
      subtitle="Location helps us show what's happening close by. Here's exactly how it's used."
      footer={
        <View>
          <Button title="Continue" onPress={() => nav.navigate('location_permission')} />
          <Button title="Choose my area manually" variant="ghost" style={{ marginTop: space.xs }} onPress={() => setPicker(true)} />
        </View>
      }
    >
      <PointRow icon="target" title="Approximate only" body="Others see your neighbourhood and a rounded distance — never your exact spot." />
      <PointRow icon="map-pin" title="Venue details after you're accepted" body="Hosts share the exact meeting point with their group only." />
      <PointRow icon="pause-circle" title="No background tracking" body="We only check location while you're using the app. Turn it off any time." />
      <PointRow icon="slash" title="Not required" body="Pick an area by hand and everything still works." />

      <AreaPickerSheet
        visible={picker}
        value={area}
        onClose={() => setPicker(false)}
        onSelect={(a) => {
          setProfile({ area: a });
          setPrefs({ location: 'manual', coords: null });
          setPicker(false);
          nav.navigate('notification_opt_in');
        }}
      />
    </OnboardingFrame>
  );
}
