// splitmate_home — expense groups and recent splits (ledger only).
import React, { useMemo } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, AvatarStack, Button, Card, HeroCard, Icon, Pictogram, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { accents, colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { inr, relativeDay } from '@/utils/format';
import { ledgerTotals, nameOf, settledCount } from './lib/split';
import { LedgerNote, StatusTag } from './components/SplitBits';

function Total({ label, value, tone }) {
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={`${label} ${inr(value)}`}>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
      <AppText variant="h1" color={tone}>
        {inr(value)}
      </AppText>
    </View>
  );
}

export default function SplitMateHomeScreen() {
  const nav = useNavigation();
  const expenses = useAppStore((s) => s.expenses);
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  useAppStore((s) => s.users); // re-render names as profiles arrive
  const expensesL = useLoader('expenses', (s) => s.loadExpenses());
  const pastL = useLoader('my:past', (s) => s.loadMyActivities('past'));

  const totals = useMemo(() => ledgerTotals(expenses), [expenses]);
  const sorted = useMemo(() => [...expenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [expenses]);
  const activityById = useMemo(() => Object.fromEntries(activities.map((a) => [a.id, a])), [activities]);
  const unsplitPlans = useMemo(
    () =>
      activities
        .filter((a) => ['accepted', 'checked_in', 'completed'].includes(joinStates[a.id]) && a.status !== 'cancelled' && !expenses.some((e) => e.activityId === a.id))
        .slice(0, 3),
    [activities, joinStates, expenses]
  );

  return (
    <Screen
      bg={colors.canvas}
      refreshControl={
        <RefreshControl
          refreshing={expensesL.refreshing || pastL.refreshing}
          onRefresh={() => {
            expensesL.reload();
            pastL.reload();
          }}
          tintColor={colors.ink}
        />
      }
      header={<ScreenHeader title="SplitMate" subtitle="Split costs, not friendships" right={<Button title="New" icon="plus" size="xs" full={false} onPress={() => nav.navigate('split_create')} />} />}
      footer={<Button title="Split a new bill" icon="plus" onPress={() => nav.navigate('split_create')} />}
    >
      <Animated.View entering={enter(0)}>
        <HeroCard>
          <View pointerEvents="none" style={{ position: 'absolute', right: 12, top: 10, opacity: 0.3, transform: [{ rotate: '10deg' }] }}>
            <Pictogram name="food" size={70} strokeWidth={1.4} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Total label="You owe" value={totals.youOwe} />
            <Total label="You're owed" value={totals.owedToYou} />
          </View>
          {totals.awaiting > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
              <Icon name="clock" size={13} />
              <AppText variant="caption" style={{ marginLeft: 6 }}>
                {inr(totals.awaiting)} marked paid, waiting for confirmation
              </AppText>
            </View>
          )}
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
            Settle directly via any UPI app. Amounts here are what your group agreed, not bank balances.
          </AppText>
        </HeroCard>
      </Animated.View>

      {unsplitPlans.length > 0 && (
        <>
          <SectionHeader title="Split a recent plan" />
          <View style={{ gap: space.xs }}>
            {unsplitPlans.map((a, i) => (
              <Card key={a.id} onPress={() => nav.navigate('split_create', { activityId: a.id })} padding={12} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Split costs for ${a.title}`}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: accents[(a.accentIndex ?? i) % accents.length].bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Pictogram name={a.pictogram} size={24} />
                </View>
                <View style={{ flex: 1, marginLeft: space.sm }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {a.title}
                  </AppText>
                  <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                    {a.cost || 'Shared costs'} · {a.joinedCount} people
                  </AppText>
                </View>
                <AvatarStack seeds={(a.participants || []).map((p) => (p === 'me' ? 'me-irl' : p))} size={24} max={3} />
              </Card>
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Recent splits" />
      <QueryState
        status={expensesL.status}
        error={expensesL.error}
        hasData={sorted.length > 0}
        onRetry={expensesL.reload}
        skeletonRows={3}
        skeletonHeight={110}
        empty={{ title: 'No splits yet', body: 'After a plan, add the bill once and everyone sees their share.', cta: 'Split a bill', onCta: () => nav.navigate('split_create') }}
      >
        <View style={{ gap: space.sm }}>
          {sorted.map((e, i) => {
            const shares = e.shares || [];
            const mine = shares.find((s) => s.userId === 'me');
            const done = settledCount(e);
            const plan = e.activityId ? activityById[e.activityId] : null;
            const iPaid = e.payeeId === 'me';
            return (
              <Animated.View key={e.id} entering={enter(i + 1)}>
                <Card onPress={() => nav.navigate('split_settlement', { expenseId: e.id })} accessibilityLabel={`${e.description}, ${inr(e.totalMinor)}, ${done} of ${shares.length} settled`}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {e.description}
                      </AppText>
                      <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                        {relativeDay(e.createdAt)} · paid by {nameOf(e.payeeId)}
                        {plan ? ` · ${plan.title}` : ''}
                      </AppText>
                    </View>
                    <AppText variant="h3">{inr(e.totalMinor)}</AppText>
                  </View>
                  <ProgressBar value={shares.length ? done / shares.length : 0} height={6} style={{ marginTop: space.sm }} fill={colors.success} accessibilityLabel="Settled share" />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs }}>
                    <AppText variant="caption" color={colors.inkSoft}>
                      {done}/{shares.length} settled
                      {iPaid ? ' · you paid' : mine ? ` · your share ${inr(mine.amountMinor)}` : ''}
                    </AppText>
                    {!iPaid && mine ? <StatusTag state={mine.state} /> : null}
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </View>
      </QueryState>

      <LedgerNote style={{ marginTop: space.xl }} />
    </Screen>
  );
}
