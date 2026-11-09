// interest_picker — multi-select activity interests (minimum 3).
import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, ChipGrid } from '@/components';
import { categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { layout, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';
import OptionTile, { tileWidth } from './components/OptionTile';

const MIN = 3;
const COLS = 3;
const GAP = space.xs;

export default function InterestPickerScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const interests = useAppStore((s) => s.profile.interests);
  const toggleInterest = useAppStore((s) => s.toggleInterest);

  const tileW = tileWidth(width, COLS, GAP, layout.screenPadding);
  const count = interests.length;

  return (
    <OnboardingFrame
      stepId="interest_picker"
      title="What are you into?"
      subtitle="Pick at least 3. We'll show these plans first."
      footer={
        // The button carries the count, so there's no extra status line.
        <Button
          title={count >= MIN ? 'Continue' : `Pick ${MIN - count} more`}
          accessibilityLabel={count >= MIN ? `Continue, ${count} selected` : `${count} of ${MIN} selected. Pick ${MIN - count} more`}
          disabled={count < MIN}
          onPress={() => nav.navigate('intent_picker')}
        />
      }
    >
      <ChipGrid columns={COLS} gap={GAP}>
        {categories.map((c, i) => (
          <OptionTile
            key={c.slug}
            label={c.label}
            pictogram={c.pictogram}
            index={i}
            width={tileW}
            selected={interests.includes(c.slug)}
            onPress={() => {
              haptics.select();
              toggleInterest(c.slug);
            }}
          />
        ))}
      </ChipGrid>
    </OnboardingFrame>
  );
}
