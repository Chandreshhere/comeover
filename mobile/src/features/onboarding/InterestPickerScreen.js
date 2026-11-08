// interest_picker — multi-select activity interests (minimum 3).
import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Pictogram } from '@/components';
import { categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';

const MIN = 3;

function Tile({ c, index, selected, onPress, width }) {
  const accent = accents[index % accents.length].bg;
  return (
    <Animated.View entering={enter(Math.min(index, 8))}>
      <Pressable
        onPress={onPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={c.label}
        style={{
          width,
          height: width * 1.02,
          borderRadius: radius.card,
          backgroundColor: selected ? colors.ink : colors.surface,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.xs,
        }}
      >
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: selected ? colors.white : accent, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={c.pictogram} size={28} />
        </View>
        <AppText variant="label" color={selected ? colors.white : colors.ink} align="center" numberOfLines={2} style={{ marginTop: space.xs }}>
          {c.label}
        </AppText>
        {selected && (
          <View style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={13} color={colors.ink} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function InterestPickerScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const interests = useAppStore((s) => s.profile.interests);
  const toggleInterest = useAppStore((s) => s.toggleInterest);

  const cols = 3;
  const gap = space.xs;
  const tileW = (width - layout.screenPadding * 2 - gap * (cols - 1)) / cols;
  const count = interests.length;

  return (
    <OnboardingFrame
      stepId="interest_picker"
      title="What are you into?"
      subtitle="Pick at least 3. We'll show these plans first — you can still see everything."
      footer={
        <View>
          <AppText variant="label" align="center" color={count >= MIN ? colors.success : colors.muted} style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
            {count >= MIN ? `${count} selected — nice mix!` : `${count} of ${MIN} selected`}
          </AppText>
          <Button title="Continue" disabled={count < MIN} onPress={() => nav.navigate('intent_picker')} />
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {categories.map((c, i) => (
          <Tile
            key={c.slug}
            c={c}
            index={i}
            width={tileW}
            selected={interests.includes(c.slug)}
            onPress={() => {
              haptics.select();
              toggleInterest(c.slug);
            }}
          />
        ))}
      </View>
    </OnboardingFrame>
  );
}
