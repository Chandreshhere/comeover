// discover_search — typeahead across plans, people (coarse info only) and
// places via GET /search (debounced 300 ms). Recent searches stay on-device.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ClockCounterClockwise } from 'phosphor-react-native/src/icons/ClockCounterClockwise';
import { MapPinArea } from 'phosphor-react-native/src/icons/MapPinArea';
import { Storefront } from 'phosphor-react-native/src/icons/Storefront';
import {
  ActivityCard,
  AppText,
  Avatar,
  Chip,
  ChipGrid,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Screen,
  SearchBar,
  SectionHeader,
  Skeleton,
  Tag,
  usePressScale,
} from '@/components';
import { IconBubble } from '@/components/Card';
import { categories, categoryBySlug, CITY } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { coarseDistance } from '@/utils/format';
import useJoinAction from '@/features/plans/joinActions';
import { applyFilters, countActiveFilters, joinUiState, visibleActivities } from './utils';

const DEBOUNCE_MS = 300;

const norm = (s = '') => s.toLowerCase().trim();
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// "Browse by activity" tile: white card, pastel icon bubble, springy press.
function CategoryTile({ c, i, onPress }) {
  const press = usePressScale(0.96);
  const accent = accents[i % accents.length];
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={c.label}
      style={[{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.sm, flexDirection: 'row', alignItems: 'center', minHeight: 64 }, press.style]}
    >
      <IconBubble size={40} bg={accent.bg} pictogram={c.pictogram} iconSize={22} />
      <AppText variant="label" style={{ marginLeft: space.xs, flex: 1 }} numberOfLines={2}>
        {c.label}
      </AppText>
    </AnimatedPressable>
  );
}

// One row inside a white grouped list (people / places).
const rowStyle = (last) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 64, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border });

export default function SearchScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const filters = useAppStore((s) => s.filters);
  const search = useAppStore((s) => s.search);
  const join = useJoinAction();

  const [q, setQ] = useState(route.params?.q || '');
  const [recents, setRecents] = useState([]);
  const [state, setState] = useState({ status: 'idle', term: '', result: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const reqId = useRef(0);

  const filterCount = countActiveFilters(filters);
  const term = norm(q);

  // Debounced server search; stale responses are ignored.
  useEffect(() => {
    if (term.length < 2) {
      setState({ status: 'idle', term, result: null, error: null });
      return undefined;
    }
    const my = ++reqId.current;
    setState((s) => ({ ...s, status: 'loading', term }));
    const t = setTimeout(async () => {
      try {
        const r = await search(term);
        if (my === reqId.current) setState({ status: 'ready', term, result: r, error: null });
      } catch (e) {
        if (my === reqId.current) setState({ status: 'error', term, result: null, error: e });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, attempt, search]);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const results = useMemo(() => {
    const r = state.result;
    if (!r) return { plans: [], people: [], places: [] };
    const plans = applyFilters(visibleActivities((r.activities || []).map((a) => byId.get(a.id) || a), { blocked }), filters).slice(0, 12);
    const people = (r.people || []).filter((p) => !blocked.includes(p.id) && p.availability !== 'busy').slice(0, 6);
    const venues = (r.venues || []).map((v) => ({ kind: 'venue', id: v.id, title: v.name, subtitle: [v.verified ? 'Verified partner' : 'Venue', v.area].filter(Boolean).join(' · '), sponsored: v.sponsored }));
    const areas = CITY.areas.filter((a) => norm(a).includes(state.term)).map((a) => ({ kind: 'area', id: a, title: a, subtitle: 'Area' }));
    return { plans, people, places: [...venues, ...areas].slice(0, 6) };
  }, [state.result, state.term, byId, blocked, filters]);

  const commit = (value) => {
    const v = (value ?? q).trim();
    if (!v) return;
    setQ(v);
    setRecents((r) => [v, ...r.filter((x) => x !== v)].slice(0, 6));
  };

  const total = results.plans.length + results.people.length + results.places.length;
  const searching = term.length >= 2 && (state.status === 'loading' || state.term !== term);
  const offline = state.error?.code === 'network' || state.error?.code === 'timeout';

  let body;
  if (term.length < 2) {
    body = (
      <>
        {recents.length > 0 && (
          <>
            <SectionHeader title="Recent" action="Clear" onAction={() => setRecents([])} />
            {recents.map((r) => (
              <Pressable key={r} onPress={() => commit(r)} accessibilityRole="button" accessibilityLabel={`Search ${r}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: space.xs }}>
                <ClockCounterClockwise size={18} color={colors.muted} weight="bold" />
                <AppText style={{ flex: 1, marginHorizontal: space.sm }} numberOfLines={1}>
                  {r}
                </AppText>
                <Icon name="arrow-up-left" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </>
        )}
        <SectionHeader title="Browse by activity" style={recents.length ? null : { marginTop: space.md }} />
        <ChipGrid columns={2}>
          {categories.map((c, i) => (
            <Animated.View key={c.slug} entering={enter(Math.min(i, 8))} style={{ flex: 1 }}>
              <CategoryTile c={c} i={i} onPress={() => nav.navigate('category_results', { category: c.slug })} />
            </Animated.View>
          ))}
        </ChipGrid>
      </>
    );
  } else if (state.status === 'error' && !searching) {
    body = <ErrorState kind={offline ? 'offline' : 'api'} title={offline ? 'You’re offline' : 'Search didn’t work'} body={offline ? 'Reconnect and try again.' : state.error?.message} onRetry={() => setAttempt((n) => n + 1)} />;
  } else if (searching && !state.result) {
    body = (
      <View style={{ gap: space.sm, marginTop: space.md }} accessibilityLabel="Searching">
        <Skeleton height={84} r={radius.card} />
        <Skeleton height={84} r={radius.card} />
        <Skeleton height={56} r={radius.card} />
      </View>
    );
  } else if (total === 0 && !searching) {
    body = (
      <EmptyState
        title={`Nothing for “${q.trim()}” yet`}
        body="Start it and others nearby can join."
        cta="Create this plan"
        onCta={() => nav.navigate('create_activity_type', { title: q.trim() })}
        secondary={filterCount ? 'Clear filters' : undefined}
        onSecondary={() => useAppStore.getState().resetFilters()}
      />
    );
  } else {
    body = (
      <>
        {results.plans.length > 0 && (
          <>
            <SectionHeader title="Plans" right={<AppText variant="caption" color={colors.muted}>{results.plans.length}</AppText>} />
            <View style={{ gap: space.sm }}>
              {results.plans.map((a, i) => (
                <ActivityCard
                  key={a.id}
                  activity={a}
                  index={i}
                  variant="row"
                  joinState={joinUiState(joinStates[a.id])}
                  onPress={() => {
                    commit();
                    nav.navigate('activity_detail', { id: a.id });
                  }}
                  onJoin={() => join(a)}
                />
              ))}
            </View>
          </>
        )}
        {results.people.length > 0 && (
          <>
            <SectionHeader title="People up for it" />
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
              {results.people.map((p, i) => {
                const cat = categoryBySlug[p.intent];
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => (cat ? nav.navigate('category_results', { category: p.intent }) : nav.navigate('create_activity_type'))}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}${cat ? `, up for ${cat.label}` : ''}${p.area ? `, around ${p.area}` : ''}`}
                    style={rowStyle(i === results.people.length - 1)}
                  >
                    <Avatar seed={p.id} uri={p.avatarUrl} size={40} />
                    <View style={{ flex: 1, marginHorizontal: space.sm }}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {p.name}
                      </AppText>
                      <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                        {[cat && `Up for ${cat.short.toLowerCase()}`, p.availability === 'now' ? 'free now' : 'later today', p.distanceM != null && `~${coarseDistance(p.distanceM)}`].filter(Boolean).join(' · ')}
                      </AppText>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
        {results.places.length > 0 && (
          <>
            <SectionHeader title="Places & areas" />
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
              {results.places.map((p, i) => (
                <Pressable
                  key={p.kind + p.id}
                  onPress={() => (p.kind === 'venue' ? nav.navigate('business_profile', { id: p.id }) : setQ(p.title))}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}. ${p.subtitle}`}
                  style={rowStyle(i === results.places.length - 1)}
                >
                  <IconBubble size={40} shape="squircle" tone={p.kind === 'venue' ? 'orange' : 'periwinkle'} glyph={p.kind === 'venue' ? Storefront : MapPinArea} iconSize={22} />
                  <View style={{ flex: 1, marginHorizontal: space.sm }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {p.title}
                    </AppText>
                    <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                      {p.subtitle}
                    </AppText>
                  </View>
                  {p.sponsored ? <Tag label="Sponsored" bg={colors.orangeSoft} /> : <Icon name="chevron-right" size={18} color={colors.muted} />}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      keyboard
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.xs, gap: space.xs }}>
          <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => nav.goBack()} />
          <View style={{ flex: 1 }}>
            <SearchBar value={q} onChangeText={setQ} autoFocus placeholder="Plans, people, places" onSubmitEditing={() => commit()} onFilter={() => nav.navigate('filters_sheet')} />
          </View>
        </View>
      }
    >
      {(filterCount > 0 || (searching && state.result)) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
          {filterCount > 0 && (
            <Chip
              label={`${filterCount} filter${filterCount > 1 ? 's' : ''} on`}
              icon="sliders"
              selected
              accessibilityLabel={`${filterCount} filter${filterCount > 1 ? 's' : ''} on. Edit filters`}
              onPress={() => nav.navigate('filters_sheet')}
            />
          )}
          <View style={{ flex: 1 }} />
          {searching && state.result && <ActivityIndicator size="small" color={colors.deep} accessibilityLabel="Updating results" />}
        </View>
      )}
      {body}
    </Screen>
  );
}
