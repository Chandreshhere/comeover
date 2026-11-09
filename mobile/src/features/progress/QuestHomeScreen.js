// quest_home — this week's streak and today's / this week's quests.
// Level + XP live on the journey screen; this screen is just the to-do list.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SectionHeader, Skeleton, WeekStrip } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import AnimatedQuestCard from './components/AnimatedQuestCard';
import { ActionError, BurstHeader } from './components/progressShared';

export default function QuestHomeScreen() {
  const nav = useNavigation();
  const progress = useAppStore((s) => s.progress);
  const quests = useAppStore((s) => s.quests);
  const questsL = useLoader('quests', (s) => s.loadQuests());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const [burst, setBurst] = useState({ key: 0, amount: 0 });
  const [actionError, setActionError] = useState(null);
  const refreshing = questsL.refreshing || progressL.refreshing;
  const refreshAll = () => {
    setActionError(null);
    questsL.reload();
    progressL.reload();
  };

  const lvl = levelFor(progress.xp ?? 0);
  const daily = useMemo(() => quests.filter((q) => q.kind === 'daily'), [quests]);
  const weekly = useMemo(() => quests.filter((q) => q.kind === 'weekly'), [quests]);
  const readyToClaim = useMemo(() => quests.filter((q) => q.state === 'completed').length, [quests]);
  const weeks = progress.streakWeeks ?? 0;
  const goal = progress.weeklyGoal ?? 0;
  const freezes = progress.freezesLeft ?? 0;

  const card = (q, i) => (
    <Animated.View key={q.id} entering={enter(i + 1)}>
      <AnimatedQuestCard
        quest={q}
        tone={q.state === 'completed' ? 'dark' : 'light'}
        onClaimed={(xp) => xp && setBurst({ key: Date.now(), amount: xp })}
        onError={setActionError}
        onOpen={() => nav.navigate('daily_challenges', { focus: q.id })}
      />
    </Animated.View>
  );

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.ink} />}
      header={
        <BurstHeader burst={burst} top={120}>
          <ScreenHeader title="Quests" subtitle={readyToClaim ? `${readyToClaim} ready to claim` : undefined} />
        </BurstHeader>
      }
    >
      {/* Streak */}
      <SectionHeader
        title="This week"
        style={{ marginTop: space.xs }}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={`${weeks} week streak`}>
            <Icon name="fire" size={15} color={colors.ink} weight="duotone" />
            <AppText variant="label" style={{ marginLeft: space.xxs }}>
              {weeks}-week streak
            </AppText>
          </View>
        }
      />
      <Animated.View entering={enter(0)}>
        {progress.week?.length ? (
          <WeekStrip days={progress.week} pulseKey={progress.weeklyDone} />
        ) : progressL.loading ? (
          <Skeleton height={76} r={radius.card} />
        ) : null}
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
          {Math.min(progress.weeklyDone ?? 0, goal)} of {goal} meetups · {freezes} freeze{freezes === 1 ? '' : 's'} left
        </AppText>
      </Animated.View>
      {progressL.status === 'error' ? <ActionError message={progressL.error || 'Couldn’t refresh your progress.'} onRetry={progressL.reload} /> : null}
      <ActionError message={actionError} onDismiss={() => setActionError(null)} />

      <QueryState
        status={questsL.status}
        error={questsL.error}
        hasData={quests.length > 0}
        onRetry={questsL.reload}
        skeletonRows={4}
        skeletonHeight={66}
        style={{ marginTop: space.xl }}
        empty={{ title: 'No quests right now', body: 'New quests show up as you join plans.', cta: 'Find a plan', onCta: () => nav.navigate('main', { screen: 'discover_home' }) }}
      >
        <>
          {daily.length > 0 && (
            <>
              <SectionHeader title="Today" action="See all" onAction={() => nav.navigate('daily_challenges')} />
              <View style={{ gap: space.xs }}>{daily.map(card)}</View>
            </>
          )}
          {weekly.length > 0 && (
            <>
              <SectionHeader title="Weekly" action="See all" onAction={() => nav.navigate('daily_challenges', { tab: 'weekly' })} />
              <View style={{ gap: space.xs }}>{weekly.map((q, i) => card(q, i + daily.length))}</View>
            </>
          )}
        </>
      </QueryState>

      <SectionHeader title="More" />
      <ListGroup>
        <ListRow icon="map-trifold" iconBg={colors.periwinkleWash} title="Your journey" subtitle={`Level ${lvl.level} · ${lvl.name}`} onPress={() => nav.navigate('social_roadmap')} />
        <ListRow icon="calendar" iconBg={colors.orangeSoft} title="Streak calendar" subtitle="Rest days and freezes" onPress={() => nav.navigate('streak_calendar')} />
        <ListRow icon="award" iconBg={colors.mint} title="Achievements" subtitle="Badges and levels" onPress={() => nav.navigate('achievements')} last />
      </ListGroup>
    </Screen>
  );
}
