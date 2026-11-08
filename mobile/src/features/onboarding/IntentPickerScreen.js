// intent_picker — why and when the user wants to connect.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, OptionCard, Pictogram } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import OnboardingFrame from './components/OnboardingFrame';

const WHY = [
  { id: 'new_city', title: 'New to the city', subtitle: 'Low-pressure ways to meet people', pictogram: 'pin' },
  { id: 'fitness', title: 'Fitness buddy', subtitle: 'Gym, runs, badminton — keep each other going', pictogram: 'gym' },
  { id: 'quick_breaks', title: 'Quick breaks', subtitle: 'Chai or a walk between things', pictogram: 'chai' },
  { id: 'weekend', title: 'Weekend plans', subtitle: 'Food walks, games, day trips', pictogram: 'sun' },
  { id: 'hobbies', title: 'Hobby company', subtitle: 'Music, photos, board games', pictogram: 'music' },
  { id: 'study_work', title: 'Study or cowork', subtitle: 'Focus sessions with others', pictogram: 'laptop' },
];

const WHEN = [
  { id: 'mornings', label: 'Mornings', icon: 'sunrise' },
  { id: 'lunch', label: 'Lunch breaks', icon: 'coffee' },
  { id: 'evenings', label: 'Evenings', icon: 'sunset' },
  { id: 'late', label: 'Late nights', icon: 'moon' },
  { id: 'weekends', label: 'Weekends', icon: 'calendar' },
];

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function IntentPickerScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const [why, setWhy] = useState(profile.intents || []);
  const [when, setWhen] = useState(profile.availabilityWindows || []);

  const next = () => {
    setProfile({ intents: why, availabilityWindows: when });
    nav.navigate('location_explainer');
  };

  return (
    <OnboardingFrame
      stepId="intent_picker"
      title="What brings you here?"
      subtitle="Pick any that fit. This shapes suggestions — never who can see you."
      footer={<Button title="Continue" disabled={why.length === 0} onPress={next} />}
    >
      {WHY.map((w) => (
        <OptionCard
          key={w.id}
          title={w.title}
          subtitle={w.subtitle}
          selected={why.includes(w.id)}
          onPress={() => setWhy((l) => toggle(l, w.id))}
          left={
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: why.includes(w.id) ? colors.white : colors.periwinkleWash, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={w.pictogram} size={24} />
            </View>
          }
        />
      ))}

      <AppText variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }} accessibilityRole="header">
        When are you usually free?
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {WHEN.map((w) => (
          <Chip key={w.id} label={w.label} icon={w.icon} selected={when.includes(w.id)} onPress={() => setWhen((l) => toggle(l, w.id))} />
        ))}
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Optional. You can set "available now" any time from Discover.
      </AppText>
    </OnboardingFrame>
  );
}
