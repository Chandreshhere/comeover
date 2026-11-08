// waitlist — position (from the server), promotion rules, join/leave, similar plans.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Button, HeroCard, Icon, Screen, ScreenHeader, SectionHeader } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { isFull, sortActivities, visibleActivities } from '@/features/discover/utils';
import usePlan from './usePlan';
import { joinErrorCopy } from './joinActions';
import PlanSummary from './components/PlanSummary';
import PlanGate from './components/PlanGate';

const RULES = [
  'If someone drops out, the first person on the waitlist is offered the spot.',
  'You get a short window to confirm before it passes to the next person.',
  'Hosts who approve requests still review you before you’re in.',
  'Leaving the waitlist never affects your reliability.',
];

export default function WaitlistScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, loader } = usePlan();
  const activities = useAppStore((s) => s.activities);
  const blocked = useAppStore((s) => s.blocked);
  const cancelJoin = useAppStore((s) => s.cancelJoin);
  const requestJoin = useAppStore((s) => s.requestJoin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const similar = useMemo(
    () => (a ? sortActivities(visibleActivities(activities, { blocked }).filter((x) => x.id !== a.id && x.category === a.category && !isFull(x)), 'soonest').slice(0, 3) : []),
    [activities, blocked, a]
  );

  if (!a) return <PlanGate title="Waitlist" loader={loader} />;

  const onList = joinState === 'waitlisted';
  const position = a.myWaitlistPosition ?? a.waitlistPosition ?? null;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(joinErrorCopy(e).body);
    } finally {
      setBusy(false);
    }
  };

  const join = () =>
    run(async () => {
      const r = await requestJoin(id);
      if (r === 'accepted') nav.replace('join_accepted', { id });
      else if (r === 'requested') nav.replace('join_pending', { id });
    });

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="Waitlist" />}
      footer={
        onList ? (
          <Button title="Leave waitlist" variant="secondary" loading={busy} onPress={() => run(() => cancelJoin(id))} />
        ) : isFull(a) && a.status !== 'cancelled' ? (
          <Button title="Join the waitlist" icon="list" loading={busy} onPress={join} />
        ) : (
          <Button title="Back to plan" onPress={() => nav.navigate('activity_detail', { id })} />
        )
      }
    >
      <HeroCard style={{ marginTop: space.xs, alignItems: 'center' }}>
        <AppText variant="label" color={colors.inkSoft}>
          {onList ? 'Your position' : 'Not on the waitlist'}
        </AppText>
        <AppText variant="display" style={{ fontSize: 64, lineHeight: 72 }} accessibilityLabel={onList && position ? `Position ${position}` : undefined}>
          {onList ? (position ? `#${position}` : 'On the list') : '—'}
        </AppText>
        <AppText color={colors.inkSoft} align="center">
          {onList
            ? `${a.joinedCount}/${a.capacity} spots taken. We’ll notify you the moment one opens.`
            : isFull(a)
              ? `${a.joinedCount}/${a.capacity} spots taken. Join the waitlist to be next in line.`
              : 'There’s space on this plan right now.'}
        </AppText>
      </HeroCard>

      {!!error && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}

      <PlanSummary activity={a} style={{ marginTop: space.md }} />

      <SectionHeader title="How promotion works" />
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, gap: space.sm }}>
        {RULES.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <AppText variant="caption" color={colors.white}>
                {i + 1}
              </AppText>
            </View>
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
              {r}
            </AppText>
          </View>
        ))}
      </View>

      {similar.length > 0 && (
        <>
          <SectionHeader title="Similar plans with space" />
          <View style={{ gap: space.sm }}>
            {similar.map((x, i) => (
              <ActivityCard key={x.id} activity={x} index={i} variant="row" onPress={() => nav.navigate('activity_detail', { id: x.id })} />
            ))}
          </View>
        </>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.lg }}>
        <Icon name="plus-circle" size={16} color={colors.deep} />
        <AppText variant="label" color={colors.deep} style={{ marginLeft: 6 }} onPress={() => nav.navigate('create_activity_type', { category: a.category })} accessibilityRole="button">
          Or host your own plan like this
        </AppText>
      </View>
    </Screen>
  );
}
