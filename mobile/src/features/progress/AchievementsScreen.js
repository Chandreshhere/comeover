// achievements — badges, milestones and the level-up celebration.
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, Icon, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, layout, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { levels } from '@/data/catalog';
import { Badge } from './components/RoadmapPath';
import LevelUpOverlay from './components/LevelUpOverlay';

export default function AchievementsScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const achievements = useAppStore((s) => s.achievements);
  const xp = useAppStore((s) => s.progress.xp);
  const lastLevelSeen = useAppStore((s) => s.progress.lastLevelSeen);
  const markLevelSeen = useAppStore((s) => s.markLevelSeen);
  const achievementsL = useLoader('achievements', (s) => s.loadAchievements());
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const [celebrating, setCelebrating] = useState(false);

  const lvl = levelFor(xp);
  const earned = useMemo(() => achievements.filter((a) => a.earned), [achievements]);
  const locked = useMemo(() => achievements.filter((a) => !a.earned), [achievements]);
  const badgeSize = Math.min(76, Math.floor((width - layout.screenPadding * 2) / 3) - 28);
  const progressReady = progressL.status === 'ready';

  // Show the level-up moment once per new level, based on server XP. First
  // visit just records the current level so nobody gets a stale celebration.
  useEffect(() => {
    if (!progressReady) return;
    if (lastLevelSeen == null) markLevelSeen(lvl.level);
    else if (lvl.level > lastLevelSeen) setCelebrating(true);
  }, [progressReady, lvl.level, lastLevelSeen, markLevelSeen]);

  const closeCelebration = () => {
    setCelebrating(false);
    markLevelSeen(lvl.level);
  };

  const grid = (list) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: space.md }}>
      {list.map((a, i) => (
        <Animated.View key={a.id} entering={enter(i)} style={{ width: '33.33%', alignItems: 'center' }}>
          <Badge a={a} size={badgeSize} onPress={() => nav.navigate('achievement_detail', { id: a.id })} />
        </Animated.View>
      ))}
    </View>
  );

  return (
    <Screen
      header={<ScreenHeader title="Achievements" subtitle={achievements.length ? `${earned.length} of ${achievements.length} earned` : 'Badges & levels'} />}
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
      <Animated.View entering={enter(0)}>
        <Card bg={colors.ink} elevated={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
              <AppText variant="h1">{lvl.level}</AppText>
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <AppText variant="caption" color="rgba(255,255,255,0.65)">
                Current level
              </AppText>
              <AppText variant="h2" color={colors.white}>
                {lvl.name}
              </AppText>
            </View>
            <AppText variant="bodyStrong" color={colors.white}>
              {xp} XP
            </AppText>
          </View>
          <ProgressBar value={lvl.ratio} style={{ marginTop: space.md }} track="rgba(255,255,255,0.2)" fill={colors.periwinkle} accessibilityLabel="Progress to next level" />
          <AppText variant="caption" color="rgba(255,255,255,0.65)" style={{ marginTop: 6 }}>
            {lvl.next ? `${lvl.next.xp - xp} XP to Level ${lvl.next.level} · ${lvl.next.name}` : 'Top level — legend status'}
          </AppText>
        </Card>
      </Animated.View>

      {/* Level ladder */}
      <SectionHeader title="Levels" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {levels.map((l) => {
          const reached = xp >= l.xp;
          const current = l.level === lvl.level;
          return (
            <View key={l.level} style={{ alignItems: 'center', flex: 1 }} accessible accessibilityLabel={`Level ${l.level} ${l.name}${reached ? ', reached' : ''}`}>
              <View
                style={{
                  width: current ? 34 : 26,
                  height: current ? 34 : 26,
                  borderRadius: 17,
                  backgroundColor: reached ? colors.ink : colors.surface,
                  borderWidth: 2,
                  borderColor: current ? colors.orange : reached ? colors.ink : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="caption" color={reached ? colors.white : colors.muted}>
                  {l.level}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>

      <QueryState status={achievementsL.status} error={achievementsL.error} hasData={achievements.length > 0} onRetry={achievementsL.reload} skeletonRows={2} skeletonHeight={110} style={{ marginTop: space.lg }}>
        <>
          <SectionHeader title={`Earned (${earned.length})`} />
          {earned.length ? grid(earned) : <AppText color={colors.muted}>Complete your first verified meetup to earn a badge.</AppText>}

          {locked.length > 0 && (
            <>
              <SectionHeader title={`In progress (${locked.length})`} />
              {grid(locked)}
            </>
          )}
        </>
      </QueryState>
      {achievementsL.status === 'ready' && achievements.length === 0 ? (
        <AppText color={colors.muted} style={{ marginTop: space.lg }}>
          Badges appear here as soon as you complete your first verified meetup.
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xl }}>
        <Icon name="info" size={14} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: 6 }}>
          Badges come from verified meetups only and are visible on your profile unless you hide them in Privacy.
        </AppText>
      </View>

      <LevelUpOverlay visible={celebrating} level={lvl} onClose={closeCelebration} />
    </Screen>
  );
}
