// circles_home (tab) — joined, suggested and local circles from GET /circles?tab=…
import React, { useMemo, useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, HeroCard, IconButton, Pictogram, QueryState, Screen, SearchBar, Segmented } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import CircleCard from './components/CircleCard';

const TABS = [
  { value: 'joined', label: 'Joined' },
  { value: 'suggested', label: 'Suggested' },
  { value: 'local', label: 'Local' },
];

export default function CirclesHomeScreen() {
  const nav = useNavigation();
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const activities = useAppStore((s) => s.activities);
  const area = useAppStore((s) => s.profile.area);
  const joinCircle = useAppStore((s) => s.joinCircle);

  const [tab, setTab] = useState(joinedCircles.length ? 'joined' : 'suggested');
  const [q, setQ] = useState('');
  const [tabIds, setTabIds] = useState({}); // server order per tab
  const [joining, setJoining] = useState(null);

  const load = useLoader('circles', (s) => s.loadCircles({ tab }).then((items) => setTabIds((prev) => ({ ...prev, [tab]: items.map((c) => c.id) }))), [tab]);

  const byId = useMemo(() => Object.fromEntries(activities.map((a) => [a.id, a])), [activities]);
  const nextPlanOf = (c) =>
    (c.nextPlanIds || [])
      .map((id) => byId[id])
      .filter((a) => a && a.status !== 'cancelled' && new Date(a.startsAt).getTime() > Date.now() - 30 * 60000)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];

  const list = useMemo(() => {
    const circleById = Object.fromEntries(circles.map((c) => [c.id, c]));
    let pool;
    if (tab === 'joined') pool = circles.filter((c) => joinedCircles.includes(c.id));
    else pool = (tabIds[tab] || []).map((id) => circleById[id]).filter(Boolean);
    const needle = q.trim().toLowerCase();
    if (needle) pool = pool.filter((c) => `${c.name} ${c.area} ${c.description || ''}`.toLowerCase().includes(needle));
    return pool;
  }, [circles, joinedCircles, tabIds, tab, q]);

  const join = async (c) => {
    setJoining(c.id);
    try {
      await joinCircle(c.id);
      haptics.success();
    } catch (e) {
      Alert.alert(`Couldn't join ${c.name}`, e?.message || 'Check your connection and try again.');
    } finally {
      setJoining(null);
    }
  };

  const emptyProps = q
    ? { title: 'No circles match', body: `Nothing for “${q}” yet. Start it — someone nearby is looking for the same thing.`, cta: 'Create a circle', onCta: () => nav.navigate('circle_create') }
    : tab === 'joined'
    ? { title: 'No circles yet', body: 'Circles are recurring groups — runners, chai regulars, board-game nights.', cta: 'See suggestions', onCta: () => setTab('suggested') }
    : { title: tab === 'local' ? `No circles in ${area || 'your area'} yet` : 'No suggestions right now', body: 'Start one for something you love — others nearby can join.', cta: 'Create a circle', onCta: () => nav.navigate('circle_create') };

  return (
    <Screen bg={colors.canvas} tabBarSpace keyboard refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={load.reload} tintColor={colors.ink} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="h1" accessibilityRole="header">
            Circles
          </AppText>
          <AppText variant="caption" color={colors.muted}>
            Recurring groups{area ? ` around ${area}` : ' near you'}
          </AppText>
        </View>
        <IconButton icon="message-circle" accessibilityLabel="Inbox" onPress={() => nav.navigate('inbox')} style={{ marginRight: space.xs }} />
        <IconButton icon="plus" variant="ink" accessibilityLabel="Create a circle" onPress={() => nav.navigate('circle_create')} />
      </View>

      <SearchBar placeholder="Search circles" value={q} onChangeText={setQ} style={{ marginTop: space.md }} />
      <Segmented options={TABS} value={tab} onChange={setTab} style={{ marginTop: space.sm }} />

      <QueryState status={load.status} error={load.error} hasData={list.length > 0} onRetry={load.reload} empty={emptyProps} style={{ marginTop: space.md }}>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {list.map((c, i) => {
            const joined = joinedCircles.includes(c.id);
            return (
              <Animated.View key={c.id} entering={enter(i)}>
                <CircleCard
                  circle={c}
                  nextPlan={nextPlanOf(c)}
                  joined={joined}
                  joining={joining === c.id}
                  onPress={() => nav.navigate('circle_detail', { id: c.id })}
                  onJoin={joined ? undefined : () => join(c)}
                />
              </Animated.View>
            );
          })}
        </View>
      </QueryState>
      {load.status === 'error' && list.length > 0 && (
        <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          Couldn't refresh circles. Pull down to try again.
        </AppText>
      )}

      <HeroCard style={{ marginTop: space.xl }} onPress={() => nav.navigate('circle_create')} accessibilityLabel="Start your own circle">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="h2">Start your own circle</AppText>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4 }}>
              Turn a one-off plan into a weekly thing. You set the rules.
            </AppText>
            <Button title="Create circle" size="sm" full={false} style={{ marginTop: space.md }} onPress={() => nav.navigate('circle_create')} />
          </View>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginLeft: space.sm }}>
            <Pictogram name="people" size={44} />
          </View>
        </View>
      </HeroCard>
    </Screen>
  );
}
