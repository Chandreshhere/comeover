// circles_home (tab) — joined, suggested and local circles from GET /circles?tab=…
// One job: find a circle. Header holds the single "Create" action.
import React, { useMemo, useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, QueryState, Screen, SearchBar, Segmented } from '@/components';
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

// One helper line under the tabs so each tab explains itself.
const tabHint = (tab, area) =>
  ({
    joined: 'Circles you’re part of',
    suggested: 'Picked for your interests',
    local: `Meeting around ${area || 'you'}`,
  }[tab]);

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

  const create = () => nav.navigate('circle_create');
  const emptyProps = q
    ? { title: 'No circles match', body: `Nothing for “${q}” yet. Start one?`, cta: 'Create a circle', onCta: create }
    : tab === 'joined'
    ? { title: 'No circles yet', body: 'Join one and it shows up here.', cta: 'See suggestions', onCta: () => setTab('suggested') }
    : { title: tab === 'local' ? `None in ${area || 'your area'} yet` : 'No suggestions right now', body: 'Start one for something you love.', cta: 'Create a circle', onCta: create };

  return (
    <Screen bg={colors.canvas} tabBarSpace keyboard refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={load.reload} tintColor={colors.ink} />}>
      {/* Tab-root header: large title left, the one Create action right */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, minHeight: 56 }}>
        <View style={{ flex: 1, marginRight: space.sm }}>
          <AppText variant="h1" accessibilityRole="header" numberOfLines={1}>
            Circles
          </AppText>
          <AppText variant="caption" color={colors.muted} numberOfLines={1}>
            Groups that meet again and again
          </AppText>
        </View>
        <Button title="New circle" icon="plus" size="sm" full={false} onPress={create} accessibilityLabel="Create a circle" />
      </View>

      <Segmented options={TABS} value={tab} onChange={setTab} style={{ marginTop: space.md }} />
      <SearchBar placeholder="Search circles" value={q} onChangeText={setQ} style={{ marginTop: space.sm }} />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.md }} numberOfLines={1}>
        {tabHint(tab, area)}
      </AppText>

      <QueryState status={load.status} error={load.error} hasData={list.length > 0} onRetry={load.reload} empty={emptyProps} style={{ marginTop: space.xs }}>
        <View style={{ gap: space.sm, marginTop: space.xs }}>
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
    </Screen>
  );
}
