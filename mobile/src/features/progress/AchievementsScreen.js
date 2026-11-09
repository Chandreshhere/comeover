// achievements — badges first, then the level ladder, plus the level-up
// celebration. The level + XP summary itself lives on the journey screen.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, ChipGrid, Icon, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { levels } from '@/data/catalog';
import { Badge } from './components/RoadmapPath';
import LevelUpOverlay from './components/LevelUpOverlay';

const LEVEL_CARD_W = 128;
const LEVEL_GAP = space.xs;
const BADGE_SIZE = 56;

// One stop on the level ladder: number, name and its state.
function LevelCard({ l, xp, reached, current, next }) {
  const span = next ? next.xp - l.xp : 0;
  const into = Math.max(0, xp - l.xp);
  const ratio = current && span > 0 ? Math.min(1, into / span) : current ? 1 : 0;
  const locked = !reached;
  const status = current ? (next ? `${next.xp - xp} XP to go` : 'Top level') : reached ? 'Reached' : `At ${l.xp} XP`;
  return (
    <View
      accessible
      accessibilityLabel={`Level ${l.level}, ${l.name}. ${l.xp} XP. ${current ? `Your level. ${status}` : status}`}
      style={{
        width: LEVEL_CARD_W,
        borderRadius: radius.quest,
        padding: space.sm,
        backgroundColor: current ? colors.periwinkle : colors.surface,
        borderWidth: current ? 2 : 1.2,
        borderColor: current ? colors.ink : colors.border,
        borderStyle: locked ? 'dashed' : 'solid',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: reached ? colors.ink : 'transparent',
            borderWidth: locked ? 1.5 : 0,
            borderColor: colors.border,
          }}
        >
          <AppText variant="label" color={reached ? colors.white : colors.muted}>
            {l.level}
          </AppText>
        </View>
        {current ? null : reached ? <Icon name="check-circle" size={18} color={colors.success} weight="fill" /> : <Icon name="lock" size={16} color={colors.muted} weight="duotone" />}
      </View>
      <AppText variant="bodyStrong" numberOfLines={2} color={locked ? colors.inkSoft : colors.ink} style={{ marginTop: space.xs, minHeight: 44 }}>
        {l.name}
      </AppText>
      <View style={{ minHeight: 26, justifyContent: 'flex-end' }}>
        {current && next ? <ProgressBar value={ratio} height={6} accessibilityLabel={`${into} of ${span} XP into this level`} style={{ marginBottom: space.xxs }} /> : null}
        <AppText variant="caption" color={current ? colors.ink : colors.muted} numberOfLines={1}>
          {status}
        </AppText>
      </View>
    </View>
  );
}

export default function AchievementsScreen() {
  const nav = useNavigation();
  const achievements = useAppStore((s) => s.achievements);
  const xp = useAppStore((s) => s.progress.xp) || 0;
  const lastLevelSeen = useAppStore((s) => s.progress.lastLevelSeen);
  const markLevelSeen = useAppStore((s) => s.markLevelSeen);
  const achievementsL = useLoader('achievements', (s) => s.loadAchievements());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const [celebrating, setCelebrating] = useState(false);
  const ladderRef = useRef(null);

  const lvl = levelFor(xp);
  const earned = useMemo(() => achievements.filter((a) => a.earned), [achievements]);
  const locked = useMemo(() => achievements.filter((a) => !a.earned), [achievements]);
  const progressReady = progressL.status === 'ready';
  const currentIndex = Math.max(0, levels.findIndex((l) => l.level === lvl.level));

  // Show the level-up moment once per new level, based on server XP. First
  // visit just records the current level so nobody gets a stale celebration.
  useEffect(() => {
    if (!progressReady) return;
    if (lastLevelSeen == null) markLevelSeen(lvl.level);
    else if (lvl.level > lastLevelSeen) setCelebrating(true);
  }, [progressReady, lvl.level, lastLevelSeen, markLevelSeen]);

  // Keep the current level in view on the ladder.
  useEffect(() => {
    const x = Math.max(0, currentIndex * (LEVEL_CARD_W + LEVEL_GAP) - layout.screenPadding * 2);
    const t = setTimeout(() => ladderRef.current?.scrollTo({ x, animated: false }), 0);
    return () => clearTimeout(t);
  }, [currentIndex]);

  const closeCelebration = () => {
    setCelebrating(false);
    markLevelSeen(lvl.level);
  };

  const grid = (list) => (
    <ChipGrid columns={3} gap={space.sm}>
      {list.map((a, i) => (
        <Animated.View key={a.id} entering={enter(i)} style={{ alignItems: 'center' }}>
          <Badge a={a} size={BADGE_SIZE} width="100%" onPress={() => nav.navigate('achievement_detail', { id: a.id })} />
        </Animated.View>
      ))}
    </ChipGrid>
  );

  return (
    <Screen
      header={<ScreenHeader title="Achievements" subtitle={achievements.length ? `${earned.length} of ${achievements.length} earned` : undefined} />}
      refreshControl={
        <RefreshControl
          refreshing={achievementsL.refreshing || progressL.refreshing}
          onRefresh={() => {
            achievementsL.reload();
            progressL.reload();
          }}
          tintColor={colors.ink}
        />
      }
    >
      <QueryState
        status={achievementsL.status}
        error={achievementsL.error}
        hasData={achievements.length > 0}
        onRetry={achievementsL.reload}
        skeletonRows={2}
        skeletonHeight={110}
        style={{ marginTop: space.xs }}
        empty={{ title: 'No badges yet', body: 'Your first verified meetup earns one.', cta: 'Find a plan', onCta: () => nav.navigate('main', { screen: 'discover_home' }) }}
      >
        <>
          <SectionHeader title={`Earned (${earned.length})`} style={{ marginTop: space.xs }} />
          {earned.length ? (
            grid(earned)
          ) : (
            <AppText variant="caption" color={colors.muted}>
              Your first verified meetup earns a badge.
            </AppText>
          )}

          {locked.length > 0 && (
            <>
              <SectionHeader title={`In progress (${locked.length})`} />
              {grid(locked)}
            </>
          )}
        </>
      </QueryState>

      {/* Level ladder: every level with its name and XP threshold. */}
      <SectionHeader
        title="Levels"
        right={
          <AppText variant="label" color={colors.muted}>
            {lvl.level} of {levels.length}
          </AppText>
        }
      />
      <ScrollView
        ref={ladderRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -layout.screenPadding }}
        contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: LEVEL_GAP }}
        snapToInterval={LEVEL_CARD_W + LEVEL_GAP}
        decelerationRate="fast"
        accessibilityLabel="Levels"
      >
        {levels.map((l, i) => (
          <LevelCard key={l.level} l={l} xp={xp} reached={xp >= l.xp} current={l.level === lvl.level} next={levels[i + 1]} />
        ))}
      </ScrollView>

      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xl }}>
        Badges show on your profile. You can hide them in Privacy.
      </AppText>

      <LevelUpOverlay visible={celebrating} level={lvl} onClose={closeCelebration} />
    </Screen>
  );
}
