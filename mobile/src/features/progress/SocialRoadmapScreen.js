// social_roadmap — "Your journey". The one place for level + XP to next,
// then what to do next (quests), the milestone path and what you've explored.
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Chip, ChipGrid, HeroCard, Icon, IconButton, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { categories } from '@/data/catalog';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, glass, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import AnimatedQuestCard from './components/AnimatedQuestCard';
import RoadmapPath from './components/RoadmapPath';
import { ActionError, BurstHeader } from './components/progressShared';

const EXPLORED_PREVIEW = 6;

// Level, XP to the next level and the streak: the only level summary in Progress.
function LevelSummary({ progress, error, onRetry, onPerks }) {
  const xp = progress.xp ?? 0;
  const lvl = levelFor(xp);
  const weeks = progress.streakWeeks ?? 0;
  return (
    <HeroCard>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, marginRight: space.sm }}>
          <AppText variant="caption" color={colors.inkSoft}>
            Level {lvl.level}
          </AppText>
          <AppText variant="h2" numberOfLines={1}>
            {lvl.name}
          </AppText>
        </View>
        <AppText variant="h3">{xp} XP</AppText>
      </View>
      <ProgressBar value={lvl.ratio} style={{ marginTop: space.sm }} track={glass(0.65)} accessibilityLabel="Progress to next level" />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ flex: 1 }}>
          {lvl.next ? `${lvl.next.xp - xp} XP to ${lvl.next.name}` : 'Top level reached'}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={`${weeks} week streak`}>
          <Icon name="fire" size={14} color={colors.ink} weight="duotone" />
          <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: space.xxs }}>
            {weeks}-week streak
          </AppText>
        </View>
      </View>
      {onPerks ? (
        <Pressable
          onPress={onPerks}
          accessibilityRole="button"
          accessibilityLabel="See your perks. Your XP is never spent."
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: layout.minTouch, marginTop: space.sm, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: glass(0.6), opacity: pressed ? 0.7 : 1 })}
        >
          <Icon name="ticket" size={16} color={colors.ink} />
          <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }} numberOfLines={1}>
            See your perks
          </AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginRight: space.xxs }} numberOfLines={1}>
            XP is never spent
          </AppText>
          <Icon name="chevron-right" size={14} color={colors.inkSoft} />
        </Pressable>
      ) : null}
      {error ? <ActionError message={error} onRetry={onRetry} style={{ backgroundColor: glass(0.7) }} /> : null}
    </HeroCard>
  );
}

export default function SocialRoadmapScreen() {
  const nav = useNavigation();
  const progress = useAppStore((s) => s.progress);
  const quests = useAppStore((s) => s.quests);
  const milestones = useAppStore((s) => s.milestones);

  const questsL = useLoader('quests', (s) => s.loadQuests());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const milestonesL = useLoader('milestones', (s) => s.loadMilestones());

  const [burst, setBurst] = useState({ key: 0, amount: 0 });
  const [actionError, setActionError] = useState(null);

  const upNext = useMemo(() => quests.filter((q) => q.state !== 'claimed' && q.state !== 'expired').slice(0, 3), [quests]);
  const counts = progress.categoryCounts || {};
  const explored = useMemo(() => categories.filter((c) => counts[c.slug] > 0).sort((a, b) => counts[b.slug] - counts[a.slug]), [counts]);
  const preview = useMemo(() => [...explored, ...categories.filter((c) => !counts[c.slug])].slice(0, EXPLORED_PREVIEW), [explored, counts]);
  const refreshing = questsL.refreshing || progressL.refreshing || milestonesL.refreshing;

  const refreshAll = () => {
    setActionError(null);
    questsL.reload();
    progressL.reload();
    milestonesL.reload();
  };

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.ink} />}
      header={
        <BurstHeader burst={burst} top={150}>
          <ScreenHeader
            title="Your journey"
            onBack={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('main'))}
            right={<IconButton icon="calendar" accessibilityLabel="Open streak calendar" onPress={() => nav.navigate('streak_calendar')} />}
          />
        </BurstHeader>
      }
    >
      <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
        <LevelSummary
          progress={progress}
          error={progressL.status === 'error' ? progressL.error || 'Couldn’t refresh your progress.' : null}
          onRetry={progressL.reload}
          onPerks={() => nav.navigate('my_perks')}
        />
      </Animated.View>

      {/* Quests */}
      <SectionHeader title="Up next" action="All quests" onAction={() => nav.navigate('daily_challenges')} />
      <ActionError message={actionError} onDismiss={() => setActionError(null)} style={{ marginTop: 0, marginBottom: space.sm }} />
      <QueryState
        status={questsL.status}
        error={questsL.error}
        hasData={upNext.length > 0}
        onRetry={questsL.reload}
        skeletonRows={3}
        skeletonHeight={66}
        empty={{ title: 'No quests right now', body: 'New quests arrive as you join plans.', cta: 'Find a plan', onCta: () => nav.navigate('main', { screen: 'discover_home' }) }}
      >
        <View style={{ gap: space.xs }}>
          {upNext.map((q, i) => (
            <Animated.View key={q.id} entering={enter(1 + i)}>
              <AnimatedQuestCard
                quest={q}
                tone={q.state === 'completed' ? 'dark' : 'light'}
                onClaimed={(xp) => {
                  setActionError(null);
                  if (xp) setBurst({ key: Date.now(), amount: xp });
                }}
                onError={setActionError}
                onOpen={() => nav.navigate('daily_challenges', { focus: q.id })}
              />
            </Animated.View>
          ))}
        </View>
      </QueryState>

      {/* Milestone path */}
      <SectionHeader title="Milestones" action="Badges" onAction={() => nav.navigate('achievements')} />
      <QueryState
        status={milestonesL.status}
        error={milestonesL.error}
        hasData={milestones.length > 0}
        onRetry={milestonesL.reload}
        skeletonRows={2}
        skeletonHeight={72}
        empty={{ title: 'Your journey starts here', body: 'Milestones unlock with each verified meetup.', pose: 'stride' }}
      >
        <RoadmapPath milestones={milestones} onPressMilestone={() => nav.navigate('achievements')} />
      </QueryState>

      {/* Categories */}
      <SectionHeader
        title="Explored"
        right={
          <AppText variant="label" color={colors.muted}>
            {explored.length} of {categories.length}
          </AppText>
        }
      />
      <ChipGrid columns={2}>
        {preview.map((c) => (
          <Chip
            key={c.slug}
            label={c.short}
            pictogram={c.pictogram}
            fill
            count={counts[c.slug] > 0 ? counts[c.slug] : undefined}
            accessibilityLabel={counts[c.slug] > 0 ? `${c.short}, ${counts[c.slug]} done` : `${c.short}, not tried yet`}
            onPress={() => nav.navigate('category_results', { category: c.slug })}
          />
        ))}
      </ChipGrid>
    </Screen>
  );
}
