// SCREEN A — Social Roadmap (reference: left phone).
// Full-periwinkle surface, editorial headline, pictogram cluster + mascot,
// week strip, dark quest rows — adapted to real-world social progression.
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Button,
  Chip,
  IconButton,
  Icon,
  Mascot,
  PictogramCluster,
  ProgressBar,
  QueryState,
  QuestRow,
  Screen,
  SectionHeader,
  Skeleton,
  WeekStrip,
} from '@/components';
import { categories } from '@/data/catalog';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, layout, radius, space, type } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import RoadmapPath, { Badge } from './components/RoadmapPath';
import XpBurst from './components/XpBurst';
import { ActionError, errorText } from './components/progressShared';

const GLASS = 'rgba(255,255,255,0.38)';

function Stat({ value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${value} ${label}`}>
      <AppText variant="h2">{value}</AppText>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
    </View>
  );
}

export default function SocialRoadmapScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const progress = useAppStore((s) => s.progress);
  const quests = useAppStore((s) => s.quests);
  const milestones = useAppStore((s) => s.milestones);
  const achievements = useAppStore((s) => s.achievements);
  const claimQuest = useAppStore((s) => s.claimQuest);
  const applyStreakFreeze = useAppStore((s) => s.applyStreakFreeze);

  const questsL = useLoader('quests', (s) => s.loadQuests());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const milestonesL = useLoader('milestones', (s) => s.loadMilestones());
  const achievementsL = useLoader('achievements', (s) => s.loadAchievements());

  const [burst, setBurst] = useState({ key: 0, amount: 0 });
  const [celebrate, setCelebrate] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [freezing, setFreezing] = useState(false);

  const lvl = levelFor(progress.xp);
  const activeQuests = useMemo(() => quests.filter((q) => q.state !== 'claimed' && q.state !== 'expired').slice(0, 3), [quests]);
  const counts = progress.categoryCounts || {};
  const explored = useMemo(() => Object.keys(counts).filter((slug) => counts[slug] > 0), [counts]);
  const unexplored = useMemo(() => categories.filter((c) => !counts[c.slug]).slice(0, 4), [counts]);
  const week = progress.week || [];
  const hasMissed = week.some((d) => d.state === 'missed');
  const heroW = width - layout.screenPadding * 2;
  const refreshing = questsL.refreshing || progressL.refreshing || milestonesL.refreshing || achievementsL.refreshing;
  const progressFailed = progressL.status === 'error';

  const refreshAll = () => {
    setActionError(null);
    questsL.reload();
    progressL.reload();
    milestonesL.reload();
    achievementsL.reload();
  };

  const onQuestPress = async (q) => {
    if (q.state !== 'completed') {
      nav.navigate('daily_challenges', { focus: q.id });
      return;
    }
    if (claiming) return;
    setClaiming(q.id);
    setActionError(null);
    try {
      const xp = await claimQuest(q.id);
      if (xp) {
        haptics.success();
        setBurst({ key: Date.now(), amount: xp });
        setCelebrate(Date.now());
      }
    } catch (e) {
      setActionError(errorText(e, 'Couldn’t claim that quest. Try again.'));
    } finally {
      setClaiming(null);
    }
  };

  const applyFreeze = async () => {
    if (freezing) return;
    setFreezing(true);
    setActionError(null);
    try {
      await applyStreakFreeze();
      haptics.success();
    } catch (e) {
      setActionError(errorText(e, 'Couldn’t use your freeze. Try again.'));
    } finally {
      setFreezing(false);
    }
  };

  return (
    <Screen
      bg={colors.periwinkle}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.ink} />}
      header={
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: space.xs }}>
          <IconButton icon="arrow-left" variant="glass" accessibilityLabel="Go back" onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('main'))} />
          <IconButton icon="calendar" variant="glass" accessibilityLabel="Open streak calendar" onPress={() => nav.navigate('streak_calendar')} />
        </View>
      }
    >
      {/* Editorial headline */}
      <Animated.View entering={enter(0)}>
        <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header">
          <AppText variant="h1" style={{ fontFamily: type.h3.fontFamily }}>
            Check your Social Roadmap{'\n'}and{' '}
          </AppText>
          Upcoming Quests
        </AppText>
      </Animated.View>

      {/* Pictogram cluster + mascot */}
      <View style={{ height: 250, marginTop: space.md, alignItems: 'center' }}>
        <View style={{ position: 'absolute', top: 0 }}>
          <PictogramCluster width={heroW} height={140} />
        </View>
        <Mascot size={Math.min(230, heroW * 0.66)} mood={celebrate ? 'celebrate' : 'idle'} celebrateKey={celebrate} style={{ position: 'absolute', bottom: 0 }} />
        <XpBurst amount={burst.amount} burstKey={burst.key} style={{ top: 70 }} onDone={() => setCelebrate(null)} />
      </View>

      {/* Level & XP */}
      <Animated.View entering={enter(1)} style={{ backgroundColor: GLASS, borderRadius: radius.card, padding: space.md, marginTop: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="h3" color={colors.white}>
              {lvl.level}
            </AppText>
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="caption" color={colors.inkSoft}>
              Current level
            </AppText>
            <AppText variant="h3">{lvl.name}</AppText>
          </View>
          <AppText variant="bodyStrong">{progress.xp} XP</AppText>
        </View>
        <ProgressBar value={lvl.ratio} style={{ marginTop: space.sm }} track="rgba(255,255,255,0.7)" accessibilityLabel="Progress to next level" />
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
          {lvl.next ? `${lvl.next.xp - progress.xp} XP to ${lvl.next.name}` : 'Top level reached'}
        </AppText>
        <View style={{ flexDirection: 'row', marginTop: space.md }}>
          <Stat value={progress.completedActivities} label="Meetups" />
          <Stat value={progress.peopleMet} label="People met" />
          <Stat value={`${Math.round((progress.showUpRate ?? 1) * 100)}%`} label="Show-up" />
        </View>
        {progressFailed ? (
          <ActionError message={progressL.error || 'Couldn’t refresh your progress.'} onRetry={progressL.reload} style={{ backgroundColor: 'rgba(255,255,255,0.7)' }} />
        ) : null}
      </Animated.View>

      {/* Weekly streak */}
      <Animated.View entering={enter(2)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm }}>
          <AppText variant="h3">This week</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="zap" size={14} color={colors.ink} />
            <AppText variant="label" style={{ marginLeft: 4 }}>
              {progress.streakWeeks}-week streak
            </AppText>
          </View>
        </View>
        {week.length ? (
          <WeekStrip days={week} pulseKey={progress.weeklyDone} />
        ) : progressL.loading ? (
          <Skeleton height={76} r={radius.card} />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">
              {Math.min(progress.weeklyDone, progress.weeklyGoal)}/{progress.weeklyGoal} verified meetups
            </AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              Rest days never break a streak · {progress.freezesLeft} freeze{progress.freezesLeft === 1 ? '' : 's'} left
            </AppText>
          </View>
          {hasMissed && progress.freezesLeft > 0 ? (
            <Button title="Use freeze" size="xs" variant="light" full={false} icon="shield" loading={freezing} disabled={freezing} onPress={applyFreeze} />
          ) : null}
        </View>
      </Animated.View>
      <ActionError message={actionError} onDismiss={() => setActionError(null)} style={{ backgroundColor: 'rgba(255,255,255,0.8)' }} />

      {/* Quests */}
      <SectionHeader
        title="My Quests"
        right={<IconButton icon="list" variant="plain" size={40} accessibilityLabel="All quests" onPress={() => nav.navigate('daily_challenges')} />}
      />
      <QueryState
        status={questsL.status}
        error={questsL.error}
        hasData={activeQuests.length > 0}
        onRetry={questsL.reload}
        skeletonRows={3}
        skeletonHeight={66}
        empty={{ title: 'No quests right now', body: 'New quests arrive as you join plans. Rest days are part of the game.', cta: 'Find a plan', onCta: () => nav.navigate('main', { screen: 'discover_home' }), pose: 'wave' }}
      >
        <View style={{ gap: space.xs }}>
          {activeQuests.map((q, i) => (
            <Animated.View key={q.id} entering={enter(3 + i)} style={{ opacity: claiming === q.id ? 0.6 : 1 }}>
              <QuestRow
                title={q.title}
                subtitle={q.state === 'completed' ? (claiming === q.id ? 'Claiming…' : 'Tap to claim your reward') : q.subtitle}
                pictogram={q.pictogram}
                tone={i === 0 ? 'dark' : 'soft'}
                progress={q.state === 'completed' ? undefined : q.progress}
                total={q.state === 'completed' ? undefined : q.total}
                xp={q.state === 'completed' ? q.xp : undefined}
                onPress={() => onQuestPress(q)}
              />
            </Animated.View>
          ))}
        </View>
      </QueryState>

      {/* Roadmap path */}
      <SectionHeader title="Your journey" action="Achievements" onAction={() => nav.navigate('achievements')} />
      <QueryState
        status={milestonesL.status}
        error={milestonesL.error}
        hasData={milestones.length > 0}
        onRetry={milestonesL.reload}
        skeletonRows={2}
        skeletonHeight={96}
        empty={{ title: 'Your journey starts with one meetup', body: 'Milestones unlock as you complete verified plans.', pose: 'stride' }}
      >
        <View style={{ backgroundColor: GLASS, borderRadius: radius.card, paddingVertical: space.lg, paddingHorizontal: space.xs }}>
          <RoadmapPath milestones={milestones} onPressMilestone={() => nav.navigate('achievements')} />
        </View>
      </QueryState>

      {/* Achievements */}
      <SectionHeader title="Badges" action="See all" onAction={() => nav.navigate('achievements')} />
      <QueryState
        status={achievementsL.status}
        error={achievementsL.error}
        hasData={achievements.length > 0}
        onRetry={achievementsL.reload}
        skeletonRows={1}
        skeletonHeight={96}
        empty={{ title: 'No badges yet', body: 'Complete your first verified meetup to earn one.', pose: 'wave' }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.screenPadding }} contentContainerStyle={{ paddingHorizontal: layout.screenPadding - 10 }}>
          {achievements.map((a) => (
            <Badge key={a.id} a={a} onPress={() => nav.navigate('achievement_detail', { id: a.id })} />
          ))}
        </ScrollView>
      </QueryState>

      {/* Categories */}
      <SectionHeader title={`Explored ${explored.length} of ${categories.length} activities`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {explored.map((slug) => {
          const c = categories.find((x) => x.slug === slug);
          return c ? <Chip key={slug} label={c.short} pictogram={c.pictogram} selected count={counts[slug]} onPress={() => nav.navigate('category_results', { category: slug })} /> : null;
        })}
        {unexplored.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} tone="glass" onPress={() => nav.navigate('category_results', { category: c.slug })} />
        ))}
      </View>

      {/* Fair-play note */}
      <View style={{ flexDirection: 'row', backgroundColor: GLASS, borderRadius: radius.quest, padding: space.md, marginTop: space.xl }}>
        <Icon name="info" size={18} color={colors.ink} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          Only verified meetups earn XP — never swipes, likes or message counts. XP is capped daily and missing a week never limits what you can do in the app.
        </AppText>
      </View>
    </Screen>
  );
}
