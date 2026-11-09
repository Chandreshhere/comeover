// splitmate_home — balances at a glance, plans waiting for a split and the
// list of splits (ledger only). One action: "New split".
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { Receipt } from 'phosphor-react-native/src/icons/Receipt';
import { AppText, Button, HeroCard, Icon, IconBubble, ListGroup, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { relativeDay } from '@/utils/format';
import { ledgerTotals, money, nameOf, settledCount } from './lib/split';
import { LedgerNote, StatusTag, useKnownPeople } from './components/SplitBits';

function Total({ label, value }) {
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={`${label} ${money(value)}`}>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
      <AppText variant="h1" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {money(value)}
      </AppText>
    </View>
  );
}

// Plan pictogram when there is one, otherwise a receipt.
const bubble = (pictogram) => (pictogram ? <IconBubble size={40} tone="periwinkle" pictogram={pictogram} /> : <IconBubble size={40} tone="orange" glyph={Receipt} />);

// List row inside a ListGroup: 40pt bubble, two lines of text, a right-hand
// value column and a chevron (every row navigates). Min height 64.
function Row({ left, title, subtitle, right, onPress, last, accessibilityLabel }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} android_ripple={{ color: colors.track }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
        {left}
        <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        </View>
        {right}
        <Icon name="chevron-right" size={18} color={colors.muted} style={{ marginLeft: space.xs }} />
      </View>
    </Pressable>
  );
}

// One split: what it was, who paid, the total and where you stand.
function SplitRow({ e, plan, last, onPress }) {
  const shares = e.shares || [];
  const mine = shares.find((s) => s.userId === 'me');
  const done = settledCount(e);
  const iPaid = e.payeeId === 'me';
  return (
    <Row
      last={last}
      onPress={onPress}
      accessibilityLabel={`${e.description}, ${money(e.totalMinor)}, ${done} of ${shares.length} settled`}
      left={bubble(plan?.pictogram)}
      title={e.description}
      subtitle={`${relativeDay(e.createdAt)} · ${iPaid ? 'you paid' : `${nameOf(e.payeeId)} paid`}`}
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="bodyStrong">{money(e.totalMinor)}</AppText>
          {!iPaid && mine ? (
            <StatusTag state={mine.state} style={{ marginTop: 2, alignSelf: 'flex-end' }} />
          ) : (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
              {done}/{shares.length} settled
            </AppText>
          )}
        </View>
      }
    />
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
  useKnownPeople(useMemo(() => Array.from(new Set(expenses.map((e) => e.payeeId))), [expenses]));
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
      header={<ScreenHeader title="SplitMate" />}
      footer={<Button title="New split" icon="plus" onPress={() => nav.navigate('split_create')} />}
    >
      {/* Balances */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
        <HeroCard>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Total label="You owe" value={totals.youOwe} />
            <Total label="You're owed" value={totals.owedToYou} />
          </View>
          {totals.awaiting > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
              <Icon name="clock" size={14} color={colors.inkSoft} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                {money(totals.awaiting)} marked paid, waiting to be confirmed
              </AppText>
            </View>
          )}
        </HeroCard>
      </Animated.View>

      {/* Plans without a split yet */}
      {unsplitPlans.length > 0 && (
        <>
          <SectionHeader title="Split a recent plan" />
          <ListGroup>
            {unsplitPlans.map((a, i) => (
              <Row
                key={a.id}
                last={i === unsplitPlans.length - 1}
                accessibilityLabel={`Split costs for ${a.title}`}
                left={bubble(a.pictogram)}
                title={a.title}
                subtitle={`${a.cost || 'Shared costs'} · ${a.joinedCount} people`}
                onPress={() => nav.navigate('split_create', { activityId: a.id })}
              />
            ))}
          </ListGroup>
        </>
      )}

      {/* Splits */}
      <SectionHeader title="Splits" />
      <QueryState
        status={expensesL.status}
        error={expensesL.error}
        hasData={sorted.length > 0}
        onRetry={expensesL.reload}
        skeletonRows={3}
        skeletonHeight={64}
        empty={{ title: 'No splits yet', body: 'Add a bill once and everyone sees their share.', cta: 'New split', onCta: () => nav.navigate('split_create') }}
      >
        <ListGroup>
          {sorted.map((e, i) => (
            <SplitRow key={e.id} e={e} plan={e.activityId ? activityById[e.activityId] : null} last={i === sorted.length - 1} onPress={() => nav.navigate('split_settlement', { expenseId: e.id })} />
          ))}
        </ListGroup>
      </QueryState>

      <LedgerNote style={{ marginTop: space.xl }} />
    </Screen>
  );
}
