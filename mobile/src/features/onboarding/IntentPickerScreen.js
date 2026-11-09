// intent_picker — one question per screen:
//   1. "What brings you here?" (required, saves profile.intents), then
//   2. "When are you free?"    (optional, saves profile.availabilityWindows).
// Part 2 is the same route pushed with { part: 'when' }, so the system back
// gesture returns to part 1 and the onboarding route list stays unchanged.
import React, { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Chip, ChipGrid } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { layout, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';
import OptionTile, { tileWidth } from './components/OptionTile';

const WHY = [
  { id: 'new_city', label: 'New to the city', pictogram: 'pin' },
  { id: 'fitness', label: 'Fitness buddy', pictogram: 'gym' },
  { id: 'quick_breaks', label: 'Quick breaks', pictogram: 'chai' },
  { id: 'weekend', label: 'Weekend plans', pictogram: 'sun' },
  { id: 'hobbies', label: 'Hobby company', pictogram: 'music' },
  { id: 'study_work', label: 'Study or cowork', pictogram: 'laptop' },
];

const WHEN = [
  { id: 'mornings', label: 'Mornings', icon: 'sun' },
  { id: 'lunch', label: 'Lunch breaks', icon: 'ForkKnife' },
  { id: 'evenings', label: 'Evenings', icon: 'sunset' },
  { id: 'late', label: 'Late nights', icon: 'moon' },
  { id: 'weekends', label: 'Weekends', icon: 'party' },
];

const COLS = 3;
const GAP = space.xs;

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function IntentPickerScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const { width } = useWindowDimensions();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const part = route.params?.part === 'when' ? 'when' : 'why';
  const [why, setWhy] = useState(profile.intents || []);
  const [when, setWhen] = useState(profile.availabilityWindows || []);

  if (part === 'when') {
    return (
      <OnboardingFrame
        stepId="intent_picker"
        title="When are you free?"
        subtitle="Optional. We'll suggest plans at these times."
        footer={
          <Button
            title="Continue"
            onPress={() => {
              setProfile({ availabilityWindows: when });
              nav.navigate('location_explainer');
            }}
          />
        }
      >
        <ChipGrid columns={2}>
          {WHEN.map((w) => (
            <Chip key={w.id} label={w.label} icon={w.icon} fill selected={when.includes(w.id)} onPress={() => setWhen((l) => toggle(l, w.id))} />
          ))}
        </ChipGrid>
      </OnboardingFrame>
    );
  }

  const tileW = tileWidth(width, COLS, GAP, layout.screenPadding);
  return (
    <OnboardingFrame
      stepId="intent_picker"
      title="What brings you here?"
      subtitle="Pick any that fit. It shapes suggestions, never who sees you."
      footer={
        <Button
          title="Continue"
          disabled={why.length === 0}
          onPress={() => {
            setProfile({ intents: why });
            nav.push('intent_picker', { part: 'when' });
          }}
        />
      }
    >
      <ChipGrid columns={COLS} gap={GAP}>
        {WHY.map((w, i) => (
          <OptionTile
            key={w.id}
            label={w.label}
            pictogram={w.pictogram}
            index={i}
            width={tileW}
            selected={why.includes(w.id)}
            onPress={() => {
              haptics.select();
              setWhy((l) => toggle(l, w.id));
            }}
          />
        ))}
      </ChipGrid>
    </OnboardingFrame>
  );
}
