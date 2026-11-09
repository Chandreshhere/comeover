// live_radar (tab) — what's happening around you right now.
// Shows plans (GET /activities feed) and people's *intent* from
// GET /availability/nearby (activity + coarse distance band only).
// Layout, top to bottom: header (+ Map), my status row, the radar with its
// distance filter, then the people and plans lists. Pull to refresh (or tap
// the "updated" line) re-queries both.
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityCard,
  ActivityCardSkeleton,
  AppText,
  Button,
  Icon,
  IconButton,
  Screen,
  SectionHeader,
  Segmented,
} from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import { SOCIAL_STYLES, rankPeople } from '@/utils/socialMatch';
import { joinUiState, sortActivities, visibleActivities } from '@/features/discover/utils';
import useJoinAction from '@/features/plans/joinActions';
import Radar, { BANDS, bandFor, radarColors } from './components/Radar';
import StatusCard from './components/StatusCard';
import PersonCard, { PersonCardSkeleton } from './components/PersonCard';
import LiveDot from './components/LiveDot';

const SOON_MS = 3 * 3600000;
const RADAR_PLANS = 12;
const RADAR_PEOPLE = 8;
const RADAR_MAX = 360;

const BAND_OPTIONS = [{ value: 'all', label: 'All' }, ...BANDS.map((b) => ({ value: b.id, label: b.label }))];

// Key for the radar: one line, then the one privacy fact that matters here.
function LegendItem({ label, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {children}
      <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 6 }}>
        {label}
      </AppText>
    </View>
  );
}

const DOT = 10;
const dot = { width: DOT, height: DOT, borderRadius: DOT / 2 };

function Legend() {
  const rc = radarColors();
  return (
    <View style={{ marginTop: space.sm, alignItems: 'center' }}>
      <View
        accessible
        accessibilityLabel="Key: green ring, free now. Pink ring, free later. Bubbles are plans, orange ones start within 30 minutes."
        style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xxs }}
      >
        <LegendItem label="Free now">
          <View style={[dot, { borderWidth: 2, borderColor: rc.now }]} />
        </LegendItem>
        <LegendItem label="Free later">
          <View style={[dot, { borderWidth: 2, borderColor: rc.later }]} />
        </LegendItem>
        <LegendItem label="Plans">
          {/* half orange (starts soon), half periwinkle (later) */}
          <View style={[dot, { flexDirection: 'row', overflow: 'hidden' }]}>
            <View style={{ flex: 1, backgroundColor: rc.planSoon.stroke }} />
            <View style={{ flex: 1, backgroundColor: rc.planLater.stroke }} />
          </View>
        </LegendItem>
      </View>
      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xxs }}>
        Rough distance only · directions scrambled
      </AppText>
    </View>
  );
}

// Inline problem banner (offline refresh, a list that failed to load).
function Notice({ text, onRetry, style }) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.orangeSoft,
          borderRadius: radius.quest,
          paddingLeft: space.sm,
          paddingRight: space.xxs,
          minHeight: 48,
        },
        style,
      ]}
      accessibilityLiveRegion="polite"
    >
      <Icon name="wifi-off" size={16} color={colors.ink} />
      <AppText variant="caption" style={{ flex: 1, marginHorizontal: space.xs }}>
        {text}
      </AppText>
      <Button title="Retry" size="xs" variant="ghost" full={false} onPress={onRetry} />
    </View>
  );
}

// Empty list: one friendly line + one centred action.
function EmptyLine({ text, cta, onPress }) {
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        paddingVertical: space.lg,
        paddingHorizontal: space.md,
      }}
    >
      <AppText color={colors.muted} align="center">
        {text}
      </AppText>
      {!!cta && (
        <Button
          title={cta}
          size="sm"
          variant="secondary"
          full={false}
          align="center"
          onPress={onPress}
          style={{ marginTop: space.sm }}
        />
      )}
    </View>
  );
}

const loadingFirst = (status, hasData) => !hasData && (status === 'idle' || status === 'loading');

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
  const showOnRadar = useAppStore((s) => s.prefs.showOnRadar);
  const area = useAppStore((s) => s.profile.area);
  // Optional: older profiles (and servers) may not carry a social style yet.
  const myStyle = useAppStore((s) => s.profile.socialStyle);
  const join = useJoinAction();

  const feed = useLoader('feed', (s) => s.loadFeed());
  const ppl = useLoader('nearbyPeople', (s) => s.loadNearbyPeople());

  const [band, setBand] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [pulseKey, setPulseKey] = useState(1);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  // `updatedAt` is a dependency on purpose: "starting soon" is time-based.
  const soonAll = useMemo(() => {
    const now = updatedAt.getTime();
    const feedList = feedIds.map((id) => byId.get(id)).filter(Boolean);
    return sortActivities(
      visibleActivities(feedList, { blocked, now }).filter((a) => new Date(a.startsAt).getTime() - now < SOON_MS),
      'soonest'
    );
  }, [feedIds, byId, blocked, updatedAt]);
  // Free now before free later, then nearest; best social-energy matches first
  // when both sides picked a style (stable, so the order above is kept).
  const intentsAll = useMemo(() => {
    const list = nearbyPeopleIds
      .map((id) => users[id])
      .filter((p) => p && p.availability !== 'busy' && !blocked.includes(p.id))
      .sort(
        (a, b) =>
          (a.availability === 'now' ? 0 : 1) - (b.availability === 'now' ? 0 : 1) ||
          (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)
      );
    return rankPeople(list, myStyle);
  }, [nearbyPeopleIds, users, blocked, myStyle]);

  const soon = useMemo(
    () => (band === 'all' ? soonAll : soonAll.filter((a) => bandFor(a.distanceM).id === band)),
    [soonAll, band]
  );
  const intents = useMemo(
    () => (band === 'all' ? intentsAll : intentsAll.filter((p) => bandFor(p.distanceM).id === band)),
    [intentsAll, band]
  );
  // Only people with a (server-coarsened) distance go on the scope.
  const radarPeople = useMemo(() => intents.filter((p) => p.distanceM != null).slice(0, RADAR_PEOPLE), [intents]);
  const radarPlans = useMemo(() => soon.slice(0, RADAR_PLANS), [soon]);
  const plansByCat = useMemo(
    () => soon.reduce((m, a) => ({ ...m, [a.category]: (m[a.category] || 0) + 1 }), {}),
    [soon]
  );
  const selected = selectedId ? intents.find((p) => p.id === selectedId) : null;

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
      setRefreshError(
        e?.code === 'network' || e?.code === 'timeout'
          ? 'You’re offline. Showing the last results.'
          : e?.message || 'Couldn’t refresh.'
      );
    } else {
      setPulseKey((k) => k + 1);
    }
    setUpdatedAt(new Date());
    setRefreshing(false);
  };

  const openPlan = (a) => nav.navigate('activity_detail', { id: a.id });
  const seePlans = (p) => nav.navigate('category_results', { category: p.intent });
  const startFor = (p) =>
    nav.navigate('create_activity_type', { category: categoryBySlug[p.intent] ? p.intent : undefined });
  const togglePerson = (p) => {
    haptics.select();
    setSelectedId((id) => (id === p.id ? null : p.id));
  };
  const showAll = () => setBand('all');

  const radarSize = Math.min(width - layout.screenPadding * 2, RADAR_MAX);
  const available = availability.status === 'now' || availability.status === 'later';
  const showStyleHint = SOCIAL_STYLES.includes(myStyle) && intents.some((p) => SOCIAL_STYLES.includes(p.socialStyle));
  const updated = `${area ? `Around ${area}` : 'Near you'} · updated ${timeLabel(updatedAt)}`;

  // People list body: skeletons → error → empty line → cards.
  let people;
  if (loadingFirst(ppl.status, intents.length > 0)) {
    people = (
      <View style={{ gap: space.sm }}>
        <PersonCardSkeleton />
        <PersonCardSkeleton />
      </View>
    );
  } else if (!intents.length && ppl.status === 'error') {
    people = <Notice text={ppl.error || 'Couldn’t load people nearby.'} onRetry={ppl.reload} />;
  } else if (!intents.length) {
    people =
      band !== 'all' ? (
        <EmptyLine text="No one free in this range." cta="Show all distances" onPress={showAll} />
      ) : available ? (
        <EmptyLine text="No one else nearby is free yet." />
      ) : (
        <EmptyLine
          text="No one nearby is free right now."
          cta="Go available"
          onPress={() => nav.navigate('availability_setup')}
        />
      );
  } else {
    people = (
      <View style={{ gap: space.sm }}>
        {intents.map((p, i) => (
          <Animated.View key={p.id} entering={enter(i)}>
            <PersonCard
              person={p}
              myStyle={myStyle}
              matching={plansByCat[p.intent] || 0}
              onSeePlans={() => seePlans(p)}
              onStart={() => startFor(p)}
            />
          </Animated.View>
        ))}
      </View>
    );
  }

  // Plans list body, same states.
  let plans;
  if (loadingFirst(feed.status, feedIds.length > 0)) {
    plans = (
      <View style={{ gap: space.sm }}>
        <ActivityCardSkeleton />
        <ActivityCardSkeleton />
      </View>
    );
  } else if (!feedIds.length && feed.status === 'error') {
    plans = <Notice text={feed.error || 'Couldn’t load plans.'} onRetry={feed.reload} />;
  } else if (!soon.length) {
    plans =
      band !== 'all' ? (
        <EmptyLine text="No plans in this range soon." cta="Show all distances" onPress={showAll} />
      ) : (
        <EmptyLine
          text="Nothing starting in the next 3 hours."
          cta="Start something"
          onPress={() => nav.navigate('create_activity_type')}
        />
      );
  } else {
    plans = (
      <View style={{ gap: space.sm }}>
        {soon.map((a, i) => (
          <ActivityCard
            key={a.id}
            activity={a}
            index={i}
            variant="row"
            joinState={joinUiState(joinStates[a.id])}
            onPress={() => openPlan(a)}
            onJoin={() => join(a)}
          />
        ))}
      </View>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      tabBarSpace
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.ink}
          colors={[colors.ink]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      {/* Header: title, area + freshness (tap to refresh), Map */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <View style={{ flex: 1, marginRight: space.sm }}>
          <AppText variant="h1" accessibilityRole="header">
            Live now
          </AppText>
          <Pressable
            onPress={refresh}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel={`${updated}. Refresh`}
            hitSlop={{ top: 15, bottom: 15 }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              maxWidth: '100%',
              marginTop: 2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <LiveDot />
            <AppText
              variant="caption"
              color={colors.muted}
              numberOfLines={1}
              style={{ flexShrink: 1, marginLeft: space.xs }}
            >
              {updated}
            </AppText>
          </Pressable>
        </View>
        <IconButton icon="map" accessibilityLabel="Open map" onPress={() => nav.navigate('map_discovery')} />
      </View>

      {!!refreshError && <Notice text={refreshError} onRetry={refresh} style={{ marginTop: space.sm }} />}

      {/* My availability: one row, opens availability_setup */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.md }}>
        <StatusCard
          availability={availability}
          showOnRadar={showOnRadar}
          onPress={() => nav.navigate('availability_setup')}
        />
      </Animated.View>

      {/* The radar, with its distance filter */}
      <Animated.View entering={enter(1)} style={{ marginTop: space.lg }}>
        <Segmented compact options={BAND_OPTIONS} value={band} onChange={setBand} />
        <View style={{ alignItems: 'center', marginTop: space.md }}>
          <Radar
            size={radarSize}
            items={radarPlans}
            people={radarPeople}
            band={band}
            pulseKey={pulseKey}
            onPressItem={openPlan}
            onPressPerson={togglePerson}
            selectedPersonId={selected?.id}
          />
        </View>

        {!!selected && (
          <Animated.View entering={enter(0)} style={{ marginTop: space.md }}>
            <PersonCard
              person={selected}
              myStyle={myStyle}
              matching={plansByCat[selected.intent] || 0}
              onSeePlans={() => seePlans(selected)}
              onStart={() => startFor(selected)}
              onClose={() => setSelectedId(null)}
              bg={colors.periwinkleWash}
              elevated={false}
            />
          </Animated.View>
        )}

        <Legend />
      </Animated.View>

      {/* People who flagged themselves free */}
      <SectionHeader
        title={`Free nearby${intents.length ? ` · ${intents.length}` : ''}`}
        right={
          showStyleHint ? (
            <AppText variant="caption" color={colors.muted}>
              Best matches first
            </AppText>
          ) : null
        }
      />
      {people}

      {/* Plans starting in the next 3 hours */}
      <SectionHeader title={`Starting soon${soon.length ? ` · ${soon.length}` : ''}`} />
      {plans}
    </Screen>
  );
}
