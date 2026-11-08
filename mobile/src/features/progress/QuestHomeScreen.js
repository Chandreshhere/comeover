// quest_home — daily quests, XP, streak and a roadmap preview.
// The lighter, white-surface companion to the periwinkle Social Roadmap.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, HeroCard, Icon, ListGroup, ListRow, Mascot, Pictogram, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Skeleton, WeekStrip } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import AnimatedQuestCard from './components/AnimatedQuestCard';
import { ActionError, BurstHeader, FairPlayNote, dailyCapOf } from './components/progressShared';

export default function QuestHomeScreen() {
  const nav = useNavigation();
  const progress = useAppStore((s) => s.progress);
  const quests = useAppStore((s) => s.quests);
  const milestones = useAppStore((s) => s.milestones);
  const questsL = useLoader('quests', (s) => s.loadQuests());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const milestonesL = useLoader('milestones', (s) => s.loadMilestones());
  const [burst, setBurst] = useState({ key: 0, amount: 0 });
  const [celebrate, setCelebrate] = useState(null);
  const [actionError, setActionError] = useState(null);
  const refreshing = questsL.refreshing || progressL.refreshing || milestonesL.refreshing;
  const refreshAll = () => {
    setActionError(null);
    questsL.reload();
    progressL.reload();
    milestonesL.reload();
  };

  const lvl = levelFor(progress.xp);
  const daily = useMemo(() => quests.filter((q) => q.kind === 'daily'), [quests]);
  const weekly = useMemo(() => quests.filter((q) => q.kind === 'weekly'), [quests]);
  const current = useMemo(() => milestones.find((m) => m.state === 'current') || milestones.find((m) => m.state === 'locked'), [milestones]);
  const readyToClaim = useMemo(() => quests.filter((q) => q.state === 'completed').length, [quests]);

  const onClaimed = (xp) => {
    if (!xp) return;
    setBurst({ key: Date.now(), amount: xp });
    setCelebrate(Date.now());
  };

  const card = (q, i) => (
    <Animated.View key={q.id} entering={enter(i + 2)}>
      <AnimatedQuestCard
        quest={q}
        tone={q.state === 'completed' ? 'dark' : 'soft'}
        onClaimed={onClaimed}
        onError={setActionError}
        onOpen={() => nav.navigate('daily_challenges', { focus: q.id })}
      />
    </Animated.View>
  );

  return (
    <Screen
      bg={colors.surface}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.ink} />}
      header={
        <BurstHeader burst={burst} top={140} onDone={() => setCelebrate(null)}>
          <ScreenHeader title="Quests" subtitle={readyToClaim ? `${readyToClaim} ready to claim` : 'Real-world goals'} />
        </BurstHeader>
      }
    >
      <Animated.View entering={enter(0)}>
        <HeroCard>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color={colors.inkSoft}>
                Level {lvl.level}
              </AppText>
              <AppText variant="h1">{lvl.name}</AppText>
              <AppText variant="label" color={colors.inkSoft} style={{ marginTop: 2 }}>
                {progress.xp} XP{lvl.next ? ` · ${lvl.next.xp - progress.xp} to ${lvl.next.name}` : ''}
              </AppText>
            </View>
            <Mascot size={110} mood={celebrate ? 'celebrate' : 'idle'} celebrateKey={celebrate} />
          </View>
          <ProgressBar value={lvl.ratio} style={{ marginTop: space.sm }} track="rgba(255,255,255,0.65)" accessibilityLabel="Progress to next level" />
          <View style={{ flexDirection: 'row', marginTop: space.md, gap: space.xs }}>
            {[
              { icon: 'zap', label: `${progress.streakWeeks}-week streak` },
              { icon: 'target', label: `${Math.min(progress.weeklyDone, progress.weeklyGoal)}/${progress.weeklyGoal} this week` },
              { icon: 'shield', label: `${progress.freezesLeft} freeze` },
            ].map((s) => (
              <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glass, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Icon name={s.icon} size={12} />
                <AppText variant="caption" style={{ marginLeft: 4 }}>
                  {s.label}
                </AppText>
              </View>
            ))}
          </View>
        </HeroCard>
      </Animated.View>

      <Animated.View entering={enter(1)} style={{ marginTop: space.md }}>
        {progress.week?.length ? (
          <WeekStrip days={progress.week} pulseKey={progress.weeklyDone} style={{ borderWidth: 1.2, borderColor: colors.border }} />
        ) : progressL.loading ? (
          <Skeleton height={76} r={radius.card} />
        ) : null}
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
        style={{ marginTop: space.lg }}
        empty={{ title: 'No quests right now', body: 'New quests show up as you join plans. Rest days are part of the game.', cta: 'Find a plan', onCta: () => nav.navigate('main', { screen: 'discover_home' }) }}
      >
        <>
          {daily.length > 0 && (
            <>
              <SectionHeader title="Today" action="All quests" onAction={() => nav.navigate('daily_challenges')} />
              <View style={{ gap: space.xs }}>{daily.map(card)}</View>
            </>
          )}
          {weekly.length > 0 && (
            <>
              <SectionHeader title="This week" action="Weekly" onAction={() => nav.navigate('daily_challenges', { tab: 'weekly' })} />
              <View style={{ gap: space.xs }}>{weekly.map((q, i) => card(q, i + daily.length))}</View>
            </>
          )}
        </>
      </QueryState>

      {current && (
        <>
          <SectionHeader title="Next on your roadmap" />
          <Card onPress={() => nav.navigate('social_roadmap')} bg={colors.periwinkleWash} elevated={false} accessibilityLabel={`Next milestone: ${current.title}. Open roadmap.`}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.orange, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Pictogram name={current.pictogram} size={26} />
              </View>
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{current.title}</AppText>
                <AppText variant="caption" color={colors.inkSoft}>
                  {current.subtitle}
                </AppText>
                {current.total ? <ProgressBar value={current.progress / current.total} height={6} style={{ marginTop: 6 }} track={colors.white} accessibilityLabel={`${current.progress} of ${current.total}`} /> : null}
              </View>
              <Icon name="chevron-right" />
            </View>
          </Card>
        </>
      )}

      <ListGroup style={{ marginTop: space.lg, borderWidth: 1.2, borderColor: colors.border }}>
        <ListRow icon="map" title="Social roadmap" subtitle="Your full journey" onPress={() => nav.navigate('social_roadmap')} />
        <ListRow icon="calendar" title="Streak calendar" subtitle="Rest days & freezes" onPress={() => nav.navigate('streak_calendar')} />
        <ListRow icon="award" title="Achievements" subtitle="Badges & levels" onPress={() => nav.navigate('achievements')} last />
      </ListGroup>

      <FairPlayNote style={{ marginTop: space.lg }} cap={dailyCapOf(progress)} />
    </Screen>
  );
}
