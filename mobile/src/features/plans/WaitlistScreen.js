// waitlist — position (from the server), join/leave, similar plans with space.
// How promotion works is one tap away in a collapsed card.
import React, { useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Button, HeroCard, Icon, Screen, ScreenHeader, SectionHeader } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, space } from '@/theme/tokens';
import { isFull, sortActivities, visibleActivities } from '@/features/discover/utils';
import usePlan from './usePlan';
import { joinErrorCopy } from './joinActions';
import PlanSummary from './components/PlanSummary';
import PlanGate from './components/PlanGate';
import Disclosure, { FactLine } from './components/Disclosure';

const RULES = [
  { icon: 'user-plus', text: 'If someone drops out, the first person in line is offered the spot.' },
  { icon: 'clock', text: 'You get a short window to confirm before it passes on.' },
  { icon: 'user-check', text: 'Hosts who approve requests still review you.' },
  { icon: 'log-out', text: 'Leaving the waitlist never affects your reliability.' },
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
  const full = isFull(a);

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
        ) : full && a.status !== 'cancelled' ? (
          <Button title="Join the waitlist" icon="list" loading={busy} onPress={join} />
        ) : (
          <Button title="Back to plan" onPress={() => nav.navigate('activity_detail', { id })} />
        )
      }
    >
      {/* Position */}
      <HeroCard style={{ marginTop: space.xs, alignItems: 'center', paddingVertical: space.xl }}>
        <AppText variant="label" color={colors.inkSoft}>
          {onList ? 'Your position' : 'Waitlist'}
        </AppText>
        <AppText variant="display" style={{ fontSize: 56, lineHeight: 64, marginTop: space.xxs }} accessibilityLabel={onList && position ? `Position ${position}` : undefined}>
          {onList ? (position ? `#${position}` : 'On the list') : full ? 'Full' : 'Open'}
        </AppText>
        <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
          {onList ? 'We’ll notify you the moment a spot opens.' : full ? 'Join the waitlist to be next in line.' : 'There’s space on this plan right now.'}
        </AppText>
      </HeroCard>

      {!!error && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}

      <PlanSummary activity={a} style={{ marginTop: space.md }} />

      <Disclosure icon="info" title="How the waitlist works" subtitle="Promotion, timing and leaving" style={{ marginTop: space.md }}>
        {RULES.map((r, i) => (
          <FactLine key={r.icon} icon={r.icon} text={r.text} last={i === RULES.length - 1} />
        ))}
      </Disclosure>

      {similar.length > 0 && (
        <>
          <SectionHeader title="Plans with space" />
          {similar.map((x, i) => (
            <ActivityCard key={x.id} activity={x} index={i} variant="row" style={{ marginTop: i ? space.sm : 0 }} onPress={() => nav.navigate('activity_detail', { id: x.id })} />
          ))}
        </>
      )}

      <Pressable
        onPress={() => nav.navigate('create_activity_type', { category: a.category })}
        accessibilityRole="button"
        accessibilityLabel="Host your own plan like this"
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: space.lg, minHeight: layout.minTouch }}
      >
        <Icon name="plus-circle" size={18} color={colors.deep} />
        <AppText variant="label" color={colors.deep} style={{ marginLeft: space.xs }}>
          Host your own instead
        </AppText>
      </Pressable>
    </Screen>
  );
}
