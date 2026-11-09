// my_activities — hosted, joined, past and cancelled plans (GET /me/activities?tab=…).
// One clean card per plan: a status pill and, when there's something to do,
// one action in the card footer.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { HourglassMedium } from 'phosphor-react-native/src/icons/HourglassMedium';
import { Queue } from 'phosphor-react-native/src/icons/Queue';
import { ActivityCard, Button, IconButton, QueryState, Screen, ScreenHeader, Segmented } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { inCheckinWindow, isEnded } from '@/features/discover/utils';

const TABS = [
  { value: 'joined', label: 'Joined' },
  { value: 'hosted', label: 'Hosted' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

// A function, not a constant: it reads the live (light/dark) palette.
// `icon` = app icon name, `glyph` = Phosphor component outside the icon map.
const statusMeta = () => ({
  requested: { label: 'Requested', bg: colors.orangeSoft, glyph: HourglassMedium },
  accepted: { label: 'Going', bg: colors.mint, icon: 'check' },
  checked_in: { label: 'Checked in', bg: colors.mint, icon: 'map-pin' },
  waitlisted: { label: 'Waitlisted', bg: colors.lavender, glyph: Queue },
  completed: { label: 'Done', bg: colors.periwinkleWash, icon: 'check-circle' },
  cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle, icon: 'x-circle' },
  declined: { label: 'Not accepted', bg: colors.surfaceSubtle },
  no_show: { label: 'No-show', bg: colors.surfaceSubtle },
  hosting: { label: 'Hosting', bg: colors.periwinkleWash },
  needs_confirm: { label: 'To confirm', bg: colors.orangeSoft, icon: 'alert-circle' },
});

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
    hosted: { title: 'Nothing hosted yet', body: 'A 30-minute plan is the quickest way to meet people.', cta: 'Host a plan', onCta: () => nav.navigate('create_activity_type') },
    joined: { title: 'No upcoming plans', body: 'Find something happening nearby today.', cta: 'Explore', onCta: () => nav.navigate('main') },
    past: { title: 'No past plans yet', body: 'Plans you’ve been to will show up here.', cta: 'Find a plan', onCta: () => nav.navigate('main') },
    cancelled: { title: 'Nothing cancelled', body: 'Plans you leave or that get cancelled land here.', cta: 'Explore', onCta: () => nav.navigate('main') },
  }[tab];

  const meta = statusMeta();

  // At most one action per card, in priority order.
  const actionFor = (a, status) => {
    const go = (route) => () => nav.navigate(route, { id: a.id });
    if (status === 'accepted' && inCheckinWindow(a)) return <Button title="Check in" icon="gps" size="sm" full={false} align="center" onPress={go('activity_checkin')} />;
    if (status === 'needs_confirm') return <Button title="Confirm" icon="check" size="sm" full={false} align="center" onPress={go('activity_complete')} />;
    if (status === 'completed' && !feedback[a.id] && a.host?.id !== 'me') return <Button title="Feedback" size="sm" variant="secondary" full={false} align="center" onPress={go('post_activity_feedback')} />;
    if (status === 'requested') return <Button title="View request" size="sm" variant="secondary" full={false} align="center" onPress={go('join_pending')} />;
    return null;
  };

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="My plans" right={<IconButton icon="plus" accessibilityLabel="Create a plan" onPress={() => nav.navigate('create_activity_type')} />} />}
      refreshControl={<RefreshControl refreshing={loader.refreshing} onRefresh={loader.reload} tintColor={colors.ink} />}
    >
      <Segmented options={TABS} value={tab} onChange={setTab} style={{ marginTop: space.xs }} />

      <QueryState status={loader.status} error={loader.error} hasData={list.length > 0} onRetry={loader.reload} empty={empty} style={{ marginTop: space.md }}>
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          {list.map(({ a, status }, i) => {
            const s = meta[status] || meta.accepted;
            return (
              <Animated.View key={a.id} entering={enter(i)}>
                <ActivityCard
                  activity={a}
                  index={i}
                  variant="row"
                  badge={{ label: s.label, bg: s.bg, icon: s.icon, glyph: s.glyph }}
                  action={actionFor(a, status)}
                  onPress={() => nav.navigate('activity_detail', { id: a.id })}
                />
              </Animated.View>
            );
          })}
        </View>
      </QueryState>
    </Screen>
  );
}
