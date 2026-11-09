// daily_challenges — Daily / Weekly quests with available → started →
// completed → claimed (or expired) states and claim celebration. The rules
// for what earns XP sit behind one "How XP works" row.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, EmptyState, Icon, IconBubble, ProgressBar, QueryState, Screen, ScreenHeader, Segmented } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import AnimatedQuestCard from './components/AnimatedQuestCard';
import { ActionError, BurstHeader, Disclosure, dailyCapOf } from './components/progressShared';

const COUNTS = [
  { pictogram: 'check', tone: 'mint', text: 'A plan confirmed by the host and one guest' },
  { pictogram: 'people', tone: 'periwinkle', text: 'A verified group check-in at the venue' },
  { pictogram: 'sparkle', tone: 'orange', text: 'Trying a new kind of activity' },
  { pictogram: 'star', tone: 'pink', text: 'Hosting a plan with no late cancellation' },
];
const NEVER = ['Swipes or likes', 'Message volume', 'Joining without going', 'Duplicate plans'];

const STATE_ORDER = { completed: 0, started: 1, available: 2, claimed: 3, expired: 4 };

function HowXpWorks({ cap }) {
  return (
    <Disclosure title="How XP works" style={{ marginTop: space.xl }}>
      <View style={{ gap: space.xs }}>
        {COUNTS.map((c) => (
          <View key={c.text} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconBubble size={36} tone={c.tone} pictogram={c.pictogram} iconSize={18} />
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
              {c.text}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="label" color={colors.muted} style={{ marginTop: space.md, marginBottom: space.xs }}>
        Never counts
      </AppText>
      <View style={{ gap: space.xs }}>
        {[0, 2].map((r) => (
          <View key={r} style={{ flexDirection: 'row', gap: space.xs }}>
            {NEVER.slice(r, r + 2).map((n) => (
              <View key={n} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="x" size={12} color={colors.muted} />
                <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ flex: 1, marginLeft: space.xxs }}>
                  {n}
                </AppText>
              </View>
            ))}
          </View>
        ))}
      </View>
      <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.md }}>
        Up to {cap} XP a day. Repeat actions on the same plan count once.
      </AppText>
    </Disclosure>
  );
}

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
      <Segmented options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} value={tab} onChange={setTab} style={{ marginTop: space.xs }} />

      <Card style={{ marginTop: space.md }} elevated={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="h3" style={{ flex: 1 }}>
            {doneCount}/{list.length} done
          </AppText>
          {tab === 'daily' ? (
            <AppText variant="label" color={colors.inkSoft}>
              {claimedDailyXp}/{cap} XP today
            </AppText>
          ) : null}
        </View>
        <ProgressBar value={list.length ? doneCount / list.length : 0} style={{ marginTop: space.sm }} accessibilityLabel="Challenges done" />
      </Card>

      <ActionError message={actionError} onDismiss={() => setActionError(null)} style={{ marginTop: space.md }} />
      <QueryState status={questsL.status} error={questsL.error} hasData={quests.length > 0} onRetry={questsL.reload} skeletonRows={3} skeletonHeight={66} style={{ marginTop: space.md }}>
        {list.length ? (
          <View style={{ gap: space.xs, marginTop: space.md }}>
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
          <EmptyState compact title="No quests right now" body="New quests show up as you join plans." cta="Find a plan" onCta={() => nav.navigate('main', { screen: 'discover_home' })} />
        )}
      </QueryState>

      <HowXpWorks cap={cap} />
    </Screen>
  );
}
