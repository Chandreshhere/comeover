// first_plan_prompt — finish onboarding: create a first plan or browse first.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, Chip, Icon, Mascot, Pictogram } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';

export default function FirstPlanPromptScreen() {
  const nav = useNavigation();
  const name = useAppStore((s) => s.profile.name);
  const interests = useAppStore((s) => s.profile.interests);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const picks = useMemo(() => interests.map((s) => categoryBySlug[s]).filter(Boolean).slice(0, 4), [interests]);

  const create = (category) => {
    haptics.success();
    completeOnboarding();
    nav.reset({ index: 1, routes: [{ name: 'main' }, { name: 'create_activity_type', params: category ? { category } : undefined }] });
  };
  const browse = () => {
    haptics.success();
    completeOnboarding();
    nav.reset({ index: 0, routes: [{ name: 'main' }] });
  };

  return (
    <OnboardingFrame
      stepId="first_plan_prompt"
      hero={
        <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, height: 220, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: 18, left: 22, opacity: 0.8 }}>
            <Pictogram name="sparkle" size={26} />
          </View>
          <View style={{ position: 'absolute', top: 40, right: 28, opacity: 0.8 }}>
            <Pictogram name="star" size={22} />
          </View>
          <Mascot size={210} mood="celebrate" celebrateKey={1} />
        </View>
      }
      title={`You're in${name ? `, ${name}` : ''}!`}
      subtitle="The fastest way to meet people is a small plan. Start one now, or look around first."
    >
      <Animated.View entering={enter(4)}>
        <Card onPress={() => create(picks[0]?.slug)} bg={colors.ink} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="Create your first plan">
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={24} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong" color={colors.white}>
              Create your first plan
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.7)">
              Takes about a minute · hosts earn bonus XP
            </AppText>
          </View>
          <Icon name="arrow-right" color={colors.white} />
        </Card>
      </Animated.View>

      {picks.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }}>
          {picks.map((c) => (
            <Chip key={c.slug} label={`${c.short} now`} pictogram={c.pictogram} onPress={() => create(c.slug)} />
          ))}
        </View>
      )}

      <Animated.View entering={enter(5)}>
        <Card onPress={browse} style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }} accessibilityLabel="Browse plans first">
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.periwinkleWash, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="compass" size={22} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Browse plans first</AppText>
            <AppText variant="caption" color={colors.muted}>
              See what's happening around you today
            </AppText>
          </View>
          <Icon name="arrow-right" />
        </Card>
      </Animated.View>
    </OnboardingFrame>
  );
}
