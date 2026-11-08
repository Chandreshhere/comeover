// category_results — plans for one activity category. On open we narrow the
// shared feed query to this category (GET /activities?category=…) and restore
// the previous category filter when the screen is left.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  AvatarStack,
  Button,
  Card,
  Chip,
  HeroCard,
  IconButton,
  Pictogram,
  QueryState,
  Screen,
  ScreenHeader,
  Segmented,
} from '@/components';
import { categories, categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { accents, colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import useJoinAction from '@/features/plans/joinActions';
import { SORTS, applyFilters, countActiveFilters, joinUiState, sortActivities, visibleActivities } from './utils';

export default function CategoryResultsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const slug = route.params?.category;
  const cat = categoryBySlug[slug];
  const catIndex = Math.max(0, categories.findIndex((c) => c.slug === slug));

  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const filters = useAppStore((s) => s.filters);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const feedStatus = useAppStore((s) => s.status.feed || 'idle');
  const feedError = useAppStore((s) => s.errors.feed || null);
  const join = useJoinAction();
  useLoader('nearbyPeople', (s) => s.loadNearbyPeople());

  const [sort, setSort] = useState('soonest');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const prevCategories = useRef(null);
  const filterCount = countActiveFilters({ ...filters, categories: [] });

  // Narrow the feed to this category while the screen is mounted.
  useEffect(() => {
    const s = useAppStore.getState();
    prevCategories.current = s.filters.categories || [];
    if (slug) s.setFilters({ categories: [slug] });
    s.loadFeed().catch(() => null);
    return () => {
      const st = useAppStore.getState();
      st.setFilters({ categories: prevCategories.current || [] });
      st.loadFeed({ silent: true }).catch(() => null);
    };
  }, [slug]);

  const reload = async () => {
    setRefreshing(true);
    await useAppStore.getState().loadFeed({ silent: true }).catch(() => null);
    setRefreshing(false);
  };

  const list = useMemo(() => {
    let l = visibleActivities(activities, { blocked });
    if (slug) l = l.filter((a) => a.category === slug);
    l = applyFilters(l, { ...filters, categories: [] });
    if (onlyOpen) l = l.filter((a) => a.joinedCount < a.capacity);
    return sortActivities(l, sort);
  }, [activities, blocked, slug, filters, sort, onlyOpen]);

  const upFor = useMemo(
    () => nearbyPeopleIds.map((id) => users[id]).filter((p) => p && p.intent === slug && p.availability !== 'busy' && !blocked.includes(p.id)),
    [nearbyPeopleIds, users, slug, blocked]
  );

  return (
    <Screen
      bg={colors.canvas}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.ink} />}
      header={
        <ScreenHeader
          title={cat?.label || 'All plans'}
          right={<IconButton icon="sliders" variant={filterCount ? 'ink' : 'surface'} badge={filterCount > 0} accessibilityLabel={`Filters${filterCount ? `, ${filterCount} active` : ''}`} onPress={() => nav.navigate('filters_sheet')} />}
        />
      }
    >
      <Animated.View entering={enter(0)}>
        <HeroCard bg={accents[catIndex % accents.length].bg} style={{ marginTop: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <AppText variant="h1">{cat?.label || 'Everything nearby'}</AppText>
              <AppText variant="label" color={colors.inkSoft} style={{ marginTop: 4 }}>
                {feedStatus === 'loading' && !list.length ? 'Looking nearby…' : `${list.length} plan${list.length === 1 ? '' : 's'}`}
                {upFor.length ? ` · ${upFor.length} ${upFor.length === 1 ? 'person' : 'people'} up for it` : ''}
              </AppText>
              {upFor.length > 0 && (
                <View style={{ marginTop: space.sm }}>
                  <AvatarStack seeds={upFor.map((p) => p.id)} size={30} max={4} ringColor={accents[catIndex % accents.length].bg} />
                </View>
              )}
            </View>
            <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={cat?.pictogram || 'sparkle'} size={48} color={colors.white} />
            </View>
          </View>
        </HeroCard>
      </Animated.View>

      <Segmented options={SORTS} value={sort} onChange={setSort} style={{ marginTop: space.md }} />
      <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}>
        <Chip label="Has space" icon="user-plus" selected={onlyOpen} onPress={() => setOnlyOpen((v) => !v)} />
        {filterCount > 0 && (
          <Chip
            label={`${filterCount} filters`}
            icon="x"
            selected
            onPress={() => {
              const s = useAppStore.getState();
              s.resetFilters();
              if (slug) s.setFilters({ categories: [slug] });
              s.loadFeed().catch(() => null);
            }}
          />
        )}
      </View>

      <QueryState
        status={feedStatus}
        error={feedError}
        hasData={list.length > 0}
        onRetry={reload}
        style={{ marginTop: space.md }}
        empty={{
          title: `No ${cat?.short.toLowerCase() || ''} plans right now`,
          body: upFor.length ? `${upFor.length} people nearby are up for it — post a plan and they'll see it.` : 'Be the first. Short plans fill fastest.',
          cta: 'Start one',
          onCta: () => nav.navigate('create_activity_type', { category: slug }),
          secondary: 'Widen the search',
          onSecondary: () => nav.navigate('filters_sheet'),
        }}
      >
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {list.map((a, i) => (
            <Animated.View key={a.id} entering={enter(i)}>
              <ActivityCard
                activity={a}
                index={i}
                variant="row"
                joinState={joinUiState(joinStates[a.id])}
                onPress={() => nav.navigate('activity_detail', { id: a.id })}
                onJoin={() => join(a)}
              />
            </Animated.View>
          ))}
        </View>
      </QueryState>

      {list.length > 0 && (
        <Card bg={colors.ink} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" color={colors.white}>
              Don't see your time?
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.7)">
              Post your own {cat?.short.toLowerCase() || 'plan'} in under a minute.
            </AppText>
          </View>
          <Button title="Create" variant="light" size="sm" full={false} onPress={() => nav.navigate('create_activity_type', { category: slug })} />
        </Card>
      )}
    </Screen>
  );
}
