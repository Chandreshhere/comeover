// my_activities — hosted, joined, past and cancelled plans (GET /me/activities?tab=…).
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, Button, IconButton, QueryState, Screen, ScreenHeader, Segmented, Tag } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { inCheckinWindow, isEnded } from '@/features/discover/utils';

const TABS = [
  { value: 'hosted', label: 'Hosted' },
  { value: 'joined', label: 'Joined' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS = {
  requested: { label: 'Request sent', bg: colors.orangeSoft },
  accepted: { label: 'Going', bg: colors.mint },
  checked_in: { label: 'Checked in', bg: colors.mint },
  waitlisted: { label: 'Waitlisted', bg: colors.lavender },
  completed: { label: 'Completed', bg: colors.periwinkleWash },
  cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle },
  declined: { label: 'Not accepted', bg: colors.surfaceSubtle },
  no_show: { label: 'Marked no-show', bg: colors.surfaceSubtle },
  hosting: { label: 'Hosting', bg: colors.periwinkle },
  needs_confirm: { label: 'Confirm it happened', bg: colors.orange },
};

function statusFor(a, st, tab) {
  const mine = a.host?.id === 'me';
  if (tab === 'cancelled') return st === 'declined' ? 'declined' : 'cancelled';
  if (tab === 'past') {
    if (st === 'completed') return 'completed';
    if (st === 'no_show') return 'no_show';
    return mine || ['accepted', 'checked_in'].includes(st) ? 'needs_confirm' : 'completed';
  }
  if (tab === 'hosted' || mine) return 'hosting';
  return st || 'accepted';
}

export default function MyActivitiesScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const [tab, setTab] = useState(route.params?.tab || 'joined');
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const feedback = useAppStore((s) => s.feedback);
  const myActivities = useAppStore((s) => s.myActivities);
  const loader = useLoader(`my:${tab}`, (s) => s.loadMyActivities(tab), [tab]);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const list = useMemo(() => {
    const ids = myActivities[tab] || [];
    const items = ids.map((id) => byId.get(id)).filter(Boolean);
    const now = Date.now();
    return items
      .map((a) => {
        let status = statusFor(a, joinStates[a.id], tab);
        // A plan can end while the tab is open: nudge confirmation.
        if ((tab === 'joined' || tab === 'hosted') && isEnded(a, now) && joinStates[a.id] !== 'completed') status = 'needs_confirm';
        return { a, status };
      })
      .sort((x, y) => (tab === 'past' || tab === 'cancelled' ? new Date(y.a.startsAt) - new Date(x.a.startsAt) : new Date(x.a.startsAt) - new Date(y.a.startsAt)));
  }, [myActivities, tab, byId, joinStates]);

  const empty = {
    hosted: { title: 'You haven’t hosted yet', body: 'Hosting a 30-minute plan is the fastest way to meet people.', cta: 'Host a plan', onCta: () => nav.navigate('create_activity_type') },
    joined: { title: 'No upcoming plans', body: 'Find something happening nearby today.', cta: 'Explore', onCta: () => nav.navigate('main') },
    past: { title: 'No past plans yet', body: 'Completed meetups show up here and count toward your roadmap.', cta: 'Find a plan', onCta: () => nav.navigate('main') },
    cancelled: { title: 'Nothing cancelled', body: 'Plans you leave or that get cancelled appear here.', cta: 'Explore', onCta: () => nav.navigate('main') },
  }[tab];

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="My plans" right={<IconButton icon="plus" variant="ink" accessibilityLabel="Create a plan" onPress={() => nav.navigate('create_activity_type')} />} />}
      refreshControl={<RefreshControl refreshing={loader.refreshing} onRefresh={loader.reload} tintColor={colors.ink} />}
    >
      <Segmented
        options={TABS.map((t) => ({ ...t, label: `${t.label}${myActivities[t.value]?.length ? ` ${myActivities[t.value].length}` : ''}` }))}
        value={tab}
        onChange={setTab}
        compact
        style={{ marginTop: space.xs }}
      />

      <QueryState status={loader.status} error={loader.error} hasData={list.length > 0} onRetry={loader.reload} empty={empty} style={{ marginTop: space.md }}>
        <View style={{ gap: space.md, marginTop: space.md }}>
          {list.map(({ a, status }, i) => {
            const s = STATUS[status] || STATUS.accepted;
            const canCheckIn = status === 'accepted' && inCheckinWindow(a);
            const canFeedback = status === 'completed' && !feedback[a.id] && a.host?.id !== 'me';
            return (
              <Animated.View key={a.id} entering={enter(i)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 }}>
                  <Tag label={s.label} bg={s.bg} fg={colors.ink} />
                  {a.joinRule === 'approval' && status === 'hosting' && <Tag label="Approval on" icon="user-check" />}
                </View>
                <ActivityCard activity={a} index={i} variant="row" onPress={() => nav.navigate('activity_detail', { id: a.id })} />
                {(canCheckIn || status === 'needs_confirm' || canFeedback || status === 'requested') && (
                  <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xs }}>
                    {canCheckIn && <Button title="Check in" icon="map-pin" size="sm" full={false} onPress={() => nav.navigate('activity_checkin', { id: a.id })} />}
                    {status === 'needs_confirm' && <Button title="Confirm completion" icon="check" size="sm" full={false} onPress={() => nav.navigate('activity_complete', { id: a.id })} />}
                    {canFeedback && <Button title="Give private feedback" size="sm" variant="secondary" full={false} onPress={() => nav.navigate('post_activity_feedback', { id: a.id })} />}
                    {status === 'requested' && <Button title="View request" size="sm" variant="secondary" full={false} onPress={() => nav.navigate('join_pending', { id: a.id })} />}
                  </View>
                )}
              </Animated.View>
            );
          })}
        </View>
      </QueryState>
    </Screen>
  );
}
