// daily_challenges — Daily / Weekly quests with available → started →
// completed → claimed (or expired) states and claim celebration.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, EmptyState, Icon, Pictogram, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Segmented } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import AnimatedQuestCard from './components/AnimatedQuestCard';
import { ActionError, BurstHeader, FairPlayNote, dailyCapOf } from './components/progressShared';

const COUNTS = [
  { pictogram: 'check', text: 'A plan completed and confirmed by the host + one attendee' },
  { pictogram: 'people', text: 'A verified group check-in at the venue' },
  { pictogram: 'sparkle', text: 'Trying a category you haven’t done before' },
  { pictogram: 'star', text: 'Hosting a plan that happens without late cancellation' },
];
const NEVER = ['Swipes or likes', 'Message volume', 'Joining without attending', 'Duplicate plans'];

const STATE_ORDER = { completed: 0, started: 1, available: 2, claimed: 3, expired: 4 };

export default function DailyChallengesScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const quests = useAppStore((s) => s.quests);
  const progress = useAppStore((s) => s.progress);
  const questsL = useLoader('quests', (s) => s.loadQuests());
  const focus = route.params?.focus;
  const focusKind = quests.find((q) => q.id === focus)?.kind;
  const [tab, setTab] = useState(route.params?.tab || focusKind || 'daily');
  const [burst, setBurst] = useState({ key: 0, amount: 0 });
  const [actionError, setActionError] = useState(null);

  const list = useMemo(() => quests.filter((q) => q.kind === tab).sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9)), [quests, tab]);
  const claimedDailyXp = useMemo(
    () => progress.xpToday ?? quests.filter((q) => q.kind === 'daily' && q.state === 'claimed').reduce((n, q) => n + (q.xp || 0), 0),
    [quests, progress.xpToday]
  );
  const cap = dailyCapOf(progress);
  const doneCount = list.filter((q) => q.state === 'claimed' || q.state === 'completed').length;

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={questsL.refreshing} onRefresh={questsL.reload} tintColor={colors.ink} />}
      header={
        <BurstHeader burst={burst} top={130}>
          <ScreenHeader title="Challenges" subtitle={tab === 'daily' ? 'Resets at midnight' : 'Resets Monday'} />
        </BurstHeader>
      }
    >
      <Segmented options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} value={tab} onChange={setTab} />

      <Card style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.muted}>
              {tab === 'daily' ? 'Today' : 'This week'}
            </AppText>
            <AppText variant="h2">
              {doneCount}/{list.length} done
            </AppText>
          </View>
          {tab === 'daily' ? (
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="caption" color={colors.muted}>
                XP claimed today
              </AppText>
              <AppText variant="bodyStrong">
                {claimedDailyXp}/{cap}
              </AppText>
            </View>
          ) : null}
        </View>
        <ProgressBar value={list.length ? doneCount / list.length : 0} style={{ marginTop: space.sm }} accessibilityLabel="Challenges done" />
      </Card>

      <SectionHeader title={tab === 'daily' ? 'Daily quests' : 'Weekly quests'} />
      <ActionError message={actionError} onDismiss={() => setActionError(null)} style={{ marginTop: 0, marginBottom: space.sm }} />
      <QueryState status={questsL.status} error={questsL.error} hasData={quests.length > 0} onRetry={questsL.reload} skeletonRows={3} skeletonHeight={66}>
        {list.length ? (
          <View style={{ gap: space.xs }}>
            {list.map((q, i) => (
              <Animated.View key={q.id} entering={enter(i)}>
                <AnimatedQuestCard
                  quest={q}
                  tone={q.state === 'completed' ? 'dark' : 'light'}
                  highlighted={q.id === focus}
                  onClaimed={(xp) => {
                    setActionError(null);
                    if (xp) setBurst({ key: Date.now(), amount: xp });
                  }}
                  onError={setActionError}
                  onOpen={() => nav.navigate('main', { screen: 'discover_home' })}
                />
              </Animated.View>
            ))}
          </View>
        ) : (
          <EmptyState compact title="No quests right now" body="New quests show up as you join plans. Rest days are part of the game." cta="Find a plan" onCta={() => nav.navigate('main', { screen: 'discover_home' })} />
        )}
      </QueryState>

      <SectionHeader title="What counts" />
      <Card>
        {COUNTS.map((c) => (
          <View key={c.text} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.periwinkleWash, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={c.pictogram} size={18} />
            </View>
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
              {c.text}
            </AppText>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
        <AppText variant="label" color={colors.muted}>
          Never counts
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {NEVER.map((n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Icon name="x" size={11} color={colors.muted} />
              <AppText variant="caption" color={colors.muted} style={{ marginLeft: 4 }}>
                {n}
              </AppText>
            </View>
          ))}
        </View>
      </Card>

      <FairPlayNote style={{ marginTop: space.md }} cap={cap} />
    </Screen>
  );
}
