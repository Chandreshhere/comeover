// first_plan_prompt — finish onboarding: create a first plan or browse first.
// Either way the last step, social_style ("What are you?"), comes next and then
// lands on home (opening the create flow on top when the user chose to create).
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Chip, ChipGrid, Mascot } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';

export default function FirstPlanPromptScreen() {
  const nav = useNavigation();
  const name = useAppStore((s) => s.profile.name);
  const interests = useAppStore((s) => s.profile.interests);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const picks = useMemo(() => interests.map((s) => categoryBySlug[s]).filter(Boolean).slice(0, 4), [interests]);

  // Marks the account onboarded (server + session) here, so quitting on the next
  // screen never sends anyone back through onboarding.
  const finish = (then) => {
    haptics.success();
    completeOnboarding();
    nav.reset({ index: 0, routes: [{ name: 'social_style', params: { mode: 'onboarding', ...(then ? { then } : null) } }] });
  };
  const create = (category) => finish({ name: 'create_activity_type', params: category ? { category } : undefined });
  const browse = () => finish(null);

  return (
    <OnboardingFrame
      stepId="first_plan_prompt"
      hero={
        <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, height: 200, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <Mascot size={190} mood="celebrate" celebrateKey={1} />
        </View>
      }
      title={`You're in${name ? `, ${name}` : ''}!`}
      subtitle="A small plan is the fastest way to meet people."
      footer={
        <View>
          <Button title="Create a plan" icon="plus" onPress={() => create(picks[0]?.slug)} accessibilityLabel="Create your first plan" />
          <Button title="Browse plans first" variant="ghost" style={{ marginTop: space.xs }} onPress={browse} />
        </View>
      }
    >
      {/* Quick starts from the interests picked earlier: one tap opens the
          create flow with that activity already chosen. */}
      {picks.length > 0 && (
        <ChipGrid columns={2}>
          {picks.map((c) => (
            <Chip key={c.slug} label={`${c.short} now`} pictogram={c.pictogram} fill accessibilityLabel={`Start a ${c.short} plan now`} onPress={() => create(c.slug)} />
          ))}
        </ChipGrid>
      )}
    </OnboardingFrame>
  );
}
