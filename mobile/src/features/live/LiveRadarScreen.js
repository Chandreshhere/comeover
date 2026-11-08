// live_radar (tab) — what's happening around you right now.
// Shows plans (GET /activities feed) and people's *intent* from
// GET /availability/nearby (activity + coarse distance band only).
import React, { useMemo, useState } from 'react';
import { RefreshControl, Switch, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Avatar,
  Button,
  Card,
  Chip,
  HeroCard,
  Icon,
  IconButton,
  QueryState,
  Screen,
  SectionHeader,
  Segmented,
  Skeleton,
  Tag,
} from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { coarseDistance, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import { joinUiState, sortActivities, visibleActivities } from '@/features/discover/utils';
import useJoinAction from '@/features/plans/joinActions';
import Radar, { BANDS, bandFor } from './components/Radar';

const SOON_MS = 3 * 3600000;

export default function LiveRadarScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const activities = useAppStore((s) => s.activities);
  const feedIds = useAppStore((s) => s.feedIds);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const availability = useAppStore((s) => s.availability);
  const setAvailability = useAppStore((s) => s.setAvailability);
  const showOnRadar = useAppStore((s) => s.prefs.showOnRadar);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const area = useAppStore((s) => s.profile.area);
  const join = useJoinAction();

  const feed = useLoader('feed', (s) => s.loadFeed());
  const ppl = useLoader('nearbyPeople', (s) => s.loadNearbyPeople());

  const [mode, setMode] = useState('radar');
  const [band, setBand] = useState('all');
  const [pulseKey, setPulseKey] = useState(1);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  // `updatedAt` is a dependency on purpose: "starting soon" is time-based.
  const soon = useMemo(() => {
    const now = updatedAt.getTime();
    const ok = (m) => band === 'all' || bandFor(m).id === band;
    const feedList = feedIds.map((id) => byId.get(id)).filter(Boolean);
    return sortActivities(
      visibleActivities(feedList, { blocked, now }).filter((a) => new Date(a.startsAt).getTime() - now < SOON_MS && ok(a.distanceM)),
      'soonest'
    );
  }, [feedIds, byId, blocked, band, updatedAt]);
  const intents = useMemo(() => {
    const ok = (m) => band === 'all' || bandFor(m).id === band;
    return nearbyPeopleIds
      .map((id) => users[id])
      .filter((p) => p && p.availability !== 'busy' && !blocked.includes(p.id) && ok(p.distanceM))
      .sort((a, b) => (a.availability === 'now' ? 0 : 1) - (b.availability === 'now' ? 0 : 1) || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
  }, [nearbyPeopleIds, users, blocked, band]);
  const plansByCat = useMemo(() => soon.reduce((m, a) => ({ ...m, [a.category]: (m[a.category] || 0) + 1 }), {}), [soon]);

  // Re-query plans + nearby availability; one radar pulse per successful refresh.
  const refresh = async () => {
    haptics.light();
    setRefreshing(true);
    setRefreshError(null);
    const s = useAppStore.getState();
    const results = await Promise.allSettled([s.loadFeed({ silent: true }), s.loadNearbyPeople()]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      const e = failed.reason;
      setRefreshError(e?.code === 'network' || e?.code === 'timeout' ? 'You’re offline — showing the last results.' : e?.message || 'Couldn’t refresh.');
    } else {
      setPulseKey((k) => k + 1);
    }
    setUpdatedAt(new Date());
    setRefreshing(false);
  };

  const available = availability.status !== 'busy';
  const visibleToOthers = available && showOnRadar;
  const radarSize = Math.min(width - layout.screenPadding * 2 - 36, 360);

  return (
    <Screen bg={colors.canvas} tabBarSpace refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="h1" accessibilityRole="header">
            Live now
          </AppText>
          <AppText variant="caption" color={colors.muted}>
            Around {area} · updated {timeLabel(updatedAt)}
          </AppText>
        </View>
        <IconButton icon="refresh-cw" accessibilityLabel="Refresh live plans" onPress={refresh} style={{ marginRight: space.xs }} />
        <IconButton icon="map" accessibilityLabel="Open map" onPress={() => nav.navigate('map_discovery')} />
      </View>
      {!!refreshError && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.orangeSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }} accessibilityLiveRegion="polite">
          <Icon name="wifi-off" size={15} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: 6 }}>
            {refreshError}
          </AppText>
          <AppText variant="label" color={colors.deep} onPress={refresh} accessibilityRole="button">
            Retry
          </AppText>
        </View>
      )}

      {/* My availability */}
      <Animated.View entering={enter(0)}>
        <Card bg={available ? colors.mint : colors.surface} style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: available ? colors.success : colors.muted }} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong">{availability.status === 'now' ? 'You’re available now' : availability.status === 'later' ? 'Available later today' : 'You’re set to busy'}</AppText>
              <AppText variant="caption" color={colors.inkSoft} numberOfLines={2}>
                {available
                  ? availability.activities?.length
                    ? `Up for ${availability.activities.map((s) => categoryBySlug[s]?.short.toLowerCase()).filter(Boolean).join(', ')}`
                    : 'Open to anything nearby'
                  : 'Go available so nearby plans can find you'}
              </AppText>
            </View>
            <Switch
              value={available}
              onValueChange={(v) => (v ? nav.navigate('availability_setup') : setAvailability({ status: 'busy', until: null }).catch(() => {}) /* store rolls the switch back */)}
              trackColor={{ false: colors.track, true: colors.ink }}
              thumbColor={colors.white}
              accessibilityLabel="Available now"
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: 'rgba(9,10,14,0.08)' }}>
            <Icon name={visibleToOthers ? 'eye' : 'eye-off'} size={15} color={colors.inkSoft} />
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: 6 }}>
              {visibleToOthers ? 'Others see your intent and a ~1 km area — never your exact location.' : 'You’re hidden from the radar.'}
            </AppText>
            <Switch value={showOnRadar} onValueChange={(v) => setPrefs({ showOnRadar: v })} trackColor={{ false: colors.track, true: colors.ink }} thumbColor={colors.white} accessibilityLabel="Show me on radar" />
          </View>
          {available && (
            <AppText variant="label" color={colors.deep} style={{ marginTop: space.xs }} onPress={() => nav.navigate('availability_setup')} accessibilityRole="button">
              Edit availability
            </AppText>
          )}
        </Card>
      </Animated.View>

      {/* Mode + band filters */}
      <Segmented
        options={[{ value: 'radar', label: 'Radar' }, { value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]}
        value={mode}
        onChange={(v) => (v === 'map' ? nav.navigate('map_discovery') : setMode(v))}
        style={{ marginTop: space.lg }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }}>
        <Chip label="All" selected={band === 'all'} onPress={() => setBand('all')} />
        {BANDS.map((b) => (
          <Chip key={b.id} label={b.label} selected={band === b.id} onPress={() => setBand(b.id)} />
        ))}
      </View>

      {mode === 'radar' && !soon.length && (feed.status === 'idle' || (feed.status === 'loading' && !feedIds.length)) ? (
        <Skeleton height={radarSize + 80} r={radius.hero} style={{ marginTop: space.md }} />
      ) : mode === 'radar' && !soon.length && feed.status === 'error' ? (
        <QueryState status="error" error={feed.error} hasData={false} onRetry={feed.reload} style={{ marginTop: space.md }} />
      ) : mode === 'radar' ? (
        <HeroCard style={{ marginTop: space.md, alignItems: 'center' }}>
          <Radar size={radarSize} items={soon.slice(0, 14)} pulseKey={pulseKey} onPressItem={(a) => nav.navigate('activity_detail', { id: a.id })} />
          {!soon.length && (
            <AppText variant="caption" color={colors.inkSoft} align="center" style={{ marginTop: space.xs }}>
              Nothing starting in the next 3 hours here.{' '}
              <AppText variant="label" color={colors.deep} onPress={() => nav.navigate('create_activity_type')} accessibilityRole="button">
                Start something
              </AppText>
            </AppText>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.orange, borderWidth: 1.5, borderColor: colors.ink }} />
              <AppText variant="caption" style={{ marginLeft: 4 }}>
                Starting within 30 min
              </AppText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink }} />
              <AppText variant="caption" style={{ marginLeft: 4 }}>
                Later
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color={colors.inkSoft} align="center" style={{ marginTop: 6 }}>
            Plans, not people. Positions show distance bands, not real locations.
          </AppText>
        </HeroCard>
      ) : (
        <QueryState
          status={feed.status}
          error={feed.error}
          hasData={soon.length > 0}
          onRetry={feed.reload}
          style={{ marginTop: space.md }}
          empty={{ title: 'Quiet in this band', body: 'Try a wider distance, or start something — short plans fill fastest.', cta: 'Create a plan', onCta: () => nav.navigate('create_activity_type') }}
        >
          <View style={{ gap: space.sm, marginTop: space.md }}>
            {soon.map((a, i) => (
              <ActivityCard
                key={a.id}
                activity={a}
                index={i}
                variant="row"
                joinState={joinUiState(joinStates[a.id])}
                onPress={() => nav.navigate('activity_detail', { id: a.id })}
                onJoin={() => join(a)}
              />
            ))}
          </View>
        </QueryState>
      )}

      {/* Available-now intent cards */}
      <SectionHeader title={`Up for something${intents.length ? ` · ${intents.length}` : ''}`} />
      <QueryState
        status={ppl.status}
        error={ppl.error}
        hasData={intents.length > 0}
        onRetry={ppl.reload}
        skeletonRows={2}
        empty={{ title: band === 'all' ? "No one's flagged free here" : 'No one in this band', body: 'Set yourself available — you might be the spark.', cta: 'Go available', onCta: () => nav.navigate('availability_setup') }}
      >
        <View style={{ gap: space.xs }}>
          {intents.map((p, i) => {
            const cat = categoryBySlug[p.intent];
            const matching = plansByCat[p.intent] || 0;
            return (
              <Animated.View key={p.id} entering={enter(i)}>
                <Card padding={12} accessibilityLabel={`${p.name} is up for ${cat?.label || 'something'}, ${p.availability === 'now' ? 'now' : 'later today'}${p.distanceM != null ? `, about ${coarseDistance(p.distanceM)} away` : ''}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View>
                      <Avatar seed={p.id} uri={p.avatarUrl} size={46} />
                      <View style={{ position: 'absolute', right: -1, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: p.availability === 'now' ? colors.success : colors.warning, borderWidth: 2, borderColor: colors.white }} />
                    </View>
                    <View style={{ flex: 1, marginLeft: space.sm }}>
                      <AppText variant="bodyStrong">
                        {p.name} {p.level != null && <AppText variant="caption" color={colors.muted}>· Lvl {p.level}</AppText>}
                      </AppText>
                      <AppText variant="caption" color={colors.inkSoft}>
                        {[cat ? `Up for ${cat.short.toLowerCase()}` : 'Open to anything', p.availability === 'now' ? 'now' : 'later today', p.distanceM != null ? bandFor(p.distanceM).label : p.area].filter(Boolean).join(' · ')}
                      </AppText>
                    </View>
                    {p.reliability != null && <Tag label={`${Math.round(p.reliability * 100)}%`} icon="check-circle" bg={colors.surfaceSubtle} />}
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}>
                    {matching > 0 && <Button title={`${matching} matching plan${matching > 1 ? 's' : ''}`} size="xs" variant="secondary" full={false} onPress={() => nav.navigate('category_results', { category: p.intent })} />}
                    <Button
                      title={cat ? `Start ${cat.short.toLowerCase()}` : 'Start a plan'}
                      size="xs"
                      full={false}
                      icon="plus"
                      onPress={() => nav.navigate('create_activity_type', { category: cat ? p.intent : undefined })}
                    />
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </View>
      </QueryState>
    </Screen>
  );
}
