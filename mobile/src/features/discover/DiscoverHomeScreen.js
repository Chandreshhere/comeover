// SCREEN B — Discover / Home (reference: middle phone).
// Greeting + avatar, bell, search, periwinkle featured live plan, pill
// category filters, pastel plan tiles, then nearby people, groups and a
// compact "Perks near you" rail (hidden when there are none).
// Data: GET /activities (+ /activities/featured), /availability/nearby,
// /circles and /quests — loaded on focus, refreshed with pull-to-refresh.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Avatar,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  IconButton,
  Icon,
  Pictogram,
  ProgressBar,
  QueryState,
  Screen,
  SearchBar,
  Sheet,
  Skeleton,
  Tag,
} from '@/components';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { categories, categoryBySlug } from '@/data/catalog';
import { levelFor, selectUnreadCount, selectUnreadMessages, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { coarseDistance, greeting } from '@/utils/format';
import useJoinAction from '@/features/plans/joinActions';
import GuideCharacter from '@/features/guide/GuideCharacter';
import TourTarget from '@/features/guide/tourTargets';
import { STYLE_META, matchLabel } from '@/utils/socialMatch';
import FeaturedPlanCard from './components/FeaturedPlanCard';
import HomeSectionHeader, { homeTone } from './components/HomeSectionHeader';
import PersonChip from './components/PersonChip';
import PerksRail from '@/features/business/components/PerksRail';
import { isFull, joinUiState, visibleActivities } from './utils';

// Status dot that gently pulses while you're available.
function StatusDot({ color, live }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!live || reduce) {
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1);
  }, [live, reduce]);
  const halo = useAnimatedStyle(() => ({
    opacity: live ? 0.45 * (1 - p.value) : 0,
    transform: [{ scale: 1 + p.value * 1.4 }],
  }));
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: color }, halo]}
      />
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
    </View>
  );
}

export default function DiscoverHomeScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const activities = useAppStore((s) => s.activities);
  const feedIds = useAppStore((s) => s.feedIds);
  const featuredId = useAppStore((s) => s.featuredId);
  const joinStates = useAppStore((s) => s.joinStates);
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const joinCircle = useAppStore((s) => s.joinCircle);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const xp = useAppStore((s) => s.progress.xp);
  const availability = useAppStore((s) => s.availability);
  const offline = useAppStore((s) => s.boot.offline);
  const unreadNotifs = useAppStore(selectUnreadCount);
  const unreadMsgs = useAppStore(selectUnreadMessages);
  const join = useJoinAction();

  const feed = useLoader('feed', (s) => s.loadFeed());

  useLoader('my:hosted', (st) => st.loadMyActivities('hosted')); // your own plans always show on Home
  const ppl = useLoader('nearbyPeople', (s) => s.loadNearbyPeople());
  const circlesLoader = useLoader('circles', (s) => s.loadCircles());

  const [cat, setCat] = useState('for_you');
  const [person, setPerson] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningCircle, setJoiningCircle] = useState(null);
  const [perksKey, setPerksKey] = useState(0);

  const lvl = levelFor(xp);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const feedList = useMemo(
    () => visibleActivities(feedIds.map((id) => byId.get(id)).filter(Boolean), { blocked }),
    [feedIds, byId, blocked]
  );
  const featured = useMemo(() => {
    const f = featuredId ? byId.get(featuredId) : null;
    if (f && visibleActivities([f], { blocked }).length) return f;
    return feedList.find((a) => a.live && !isFull(a)) || null;
  }, [featuredId, byId, blocked, feedList]);
  // Your own upcoming plans always show on Home (the server feed may leave them out).
  const myUpcoming = useMemo(
    () =>
      visibleActivities(
        activities.filter((a) => a.host?.id === 'me'),
        { blocked }
      ),
    [activities, blocked]
  );
  const tiles = useMemo(() => {
    const seen = new Set();
    const pool = [...myUpcoming, ...feedList].filter((a) => a.id !== featured?.id && !seen.has(a.id) && seen.add(a.id));
    if (cat === 'for_you') {
      const own = pool.filter((a) => a.host?.id === 'me');
      const rest = pool.filter((a) => a.host?.id !== 'me');
      const liked = profile.interests.length ? rest.filter((a) => profile.interests.includes(a.category)) : [];
      return [...own, ...(liked.length >= 2 ? liked : rest)].slice(0, 8);
    }
    if (cat === 'now') return pool.filter((a) => a.live || new Date(a.startsAt) - Date.now() < 90 * 60000).slice(0, 8);
    return pool.filter((a) => a.category === cat).slice(0, 8);
  }, [feedList, myUpcoming, featured, cat, profile.interests]);
  const nearbyPeople = useMemo(
    () =>
      nearbyPeopleIds
        .map((id) => users[id])
        .filter((p) => p && p.availability !== 'busy' && !blocked.includes(p.id))
        .sort(
          (a, b) =>
            (a.availability === 'now' ? 0 : 1) - (b.availability === 'now' ? 0 : 1) ||
            (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)
        )
        .slice(0, 8),
    [nearbyPeopleIds, users, blocked]
  );
  const railCats = useMemo(() => {
    const preferred = profile.interests.map((s) => categoryBySlug[s]).filter(Boolean);
    const rest = categories.filter((c) => !profile.interests.includes(c.slug));
    return [...preferred, ...rest].slice(0, 8);
    // categories is updated in place by the server taxonomy; feedIds changes after bootstrap/loads.
  }, [profile.interests, feedIds]);
  const shownCircles = useMemo(() => circles.slice(0, 3), [circles]);

  const onRefresh = async () => {
    setRefreshing(true);
    setPerksKey((k) => k + 1);
    const s = useAppStore.getState();
    await Promise.all(
      [s.loadFeed({ silent: true }), s.loadMyActivities('hosted'), s.loadNearbyPeople(), s.loadCircles()].map((p) =>
        p.catch(() => null)
      )
    );
    setRefreshing(false);
  };

  const onJoinCircle = async (c) => {
    setJoiningCircle(c.id);
    try {
      await joinCircle(c.id);
    } catch (e) {
      Alert.alert(
        'Couldn’t join circle',
        e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Try again.' : e?.message || 'Please try again.'
      );
    } finally {
      setJoiningCircle(null);
    }
  };

  const name = profile.name || 'there';
  const hasFeed = feedList.length > 0 || !!featured;

  return (
    <Screen
      bg={colors.surface}
      tabBarSpace
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
    >
      {/* Greeting row */}
      <Animated.View entering={enter(0)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <Avatar seed={profile.avatarSeed} uri={profile.avatarUri} size={44} label="Your profile" />
        <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
          <AppText variant="h3" numberOfLines={1}>
            {greeting()}, {name}
          </AppText>
          <Pressable
            onPress={() => nav.navigate('social_roadmap')}
            accessibilityRole="button"
            accessibilityLabel={`Level ${lvl.level}${lvl.name ? `, ${lvl.name}` : ''}. Open your roadmap`}
            hitSlop={8}
            style={{ alignSelf: 'flex-start', marginTop: 2 }}
          >
            <AppText variant="caption" color={colors.muted} numberOfLines={1}>
              {[profile.area, `Level ${lvl.level}${lvl.name ? ` · ${lvl.name}` : ''}`].filter(Boolean).join('  ·  ')}
            </AppText>
          </Pressable>
        </View>
        <TourTarget id="discover:inbox" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="message-circle"
            variant="plain"
            size={40}
            accessibilityLabel={`Inbox${unreadMsgs ? `, ${unreadMsgs} unread` : ''}`}
            badge={unreadMsgs > 0}
            onPress={() => nav.navigate('inbox')}
          />
          <IconButton
            icon="bell"
            variant="plain"
            size={40}
            accessibilityLabel={`Notifications${unreadNotifs ? `, ${unreadNotifs} unread` : ''}`}
            badge={unreadNotifs > 0}
            onPress={() => nav.navigate('notifications_center')}
          />
        </TourTarget>
      </Animated.View>

      {offline && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.orangeSoft,
            borderRadius: radius.quest,
            padding: space.sm,
            marginTop: space.sm,
          }}
        >
          <Icon name="wifi-off" size={16} color={colors.ink} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: space.xs }}>
            You’re offline. Showing what we had. Pull down to retry.
          </AppText>
        </View>
      )}

      {/* Search + plan assistant (an app-tour stop) */}
      <Animated.View entering={enter(1)} style={{ marginTop: space.md }}>
        <TourTarget id="discover:search">
          <SearchBar
            placeholder="Search chai, badminton, people…"
            onPress={() => nav.navigate('discover_search')}
            onFilter={() => nav.navigate('filters_sheet')}
          />
        </TourTarget>
      </Animated.View>

      {/* Availability status */}
      <Animated.View entering={enter(2)}>
        <TourTarget id="discover:status">
          <Pressable
            onPress={() => nav.navigate('availability_setup')}
            accessibilityRole="button"
            accessibilityLabel="Set your availability"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: layout.minTouch,
              marginTop: space.sm,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: availability.status === 'now' ? colors.mint : colors.surfaceSubtle,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <StatusDot
              live={availability.status === 'now'}
              color={
                availability.status === 'now'
                  ? colors.success
                  : availability.status === 'later'
                  ? colors.warning
                  : colors.muted
              }
            />
            <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }} numberOfLines={1}>
              {availability.status === 'now'
                ? `You're free now${
                    availability.activities?.length
                      ? ` for ${availability.activities
                          .map((s) => categoryBySlug[s]?.short.toLowerCase())
                          .filter(Boolean)
                          .join(', ')}`
                      : ''
                  }`
                : availability.status === 'later'
                ? 'Free later today'
                : 'Free right now? Let plans find you'}
            </AppText>
            <Icon name="chevron-right" size={16} color={colors.muted} />
          </Pressable>
        </TourTarget>
      </Animated.View>

      {/* Featured plan + tiles: one data source (the feed) */}
      <View style={{ marginTop: space.md }}>
        <QueryState
          status={feed.status}
          error={feed.error}
          hasData={hasFeed}
          onRetry={feed.reload}
          skeletonRows={2}
          skeletonHeight={180}
          empty={{
            title: 'Quiet around here',
            body: 'No plans nearby yet. Start one and people can join you.',
            cta: 'Create a plan',
            onCta: () => nav.navigate('create_activity_type'),
            secondary: 'Widen the search',
            onSecondary: () => nav.navigate('filters_sheet'),
          }}
        >
          <Animated.View entering={enter(3)}>
            {featured && (
              <TourTarget id="discover:featured">
                <FeaturedPlanCard
                  activity={featured}
                  joinState={joinUiState(joinStates[featured.id])}
                  onPress={() => nav.navigate('activity_detail', { id: featured.id })}
                  onJoin={() => join(featured)}
                />
              </TourTarget>
            )}
          </Animated.View>

          {/* Category filters + tiles */}
          <View style={{ marginTop: space.lg, marginHorizontal: -layout.screenPadding }}>
            <ChipRow>
              <Chip label="For you" icon="star" selected={cat === 'for_you'} onPress={() => setCat('for_you')} />
              <Chip label="Starting soon" icon="clock" selected={cat === 'now'} onPress={() => setCat('now')} />
              {railCats.map((c) => (
                <Chip
                  key={c.slug}
                  label={c.short}
                  pictogram={c.pictogram}
                  selected={cat === c.slug}
                  onPress={() => setCat(c.slug)}
                />
              ))}
            </ChipRow>
            {tiles.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.sm, paddingTop: space.md }}
              >
                {tiles.map((a, i) => (
                  <ActivityCard
                    key={a.id}
                    activity={a}
                    index={i}
                    variant="tile"
                    onPress={() => nav.navigate('activity_detail', { id: a.id })}
                  />
                ))}
                <Card
                  onPress={() =>
                    nav.navigate(categoryBySlug[cat] ? 'category_results' : 'discover_search', {
                      category: categoryBySlug[cat] ? cat : undefined,
                    })
                  }
                  bg={colors.surfaceSubtle}
                  elevated={false}
                  style={{ width: 172, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}
                  accessibilityLabel="See all plans"
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: colors.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="arrow-right" color={colors.white} />
                  </View>
                  <AppText variant="label" style={{ marginTop: space.xs }}>
                    See all
                  </AppText>
                </Card>
              </ScrollView>
            ) : (
              <View style={{ paddingHorizontal: layout.screenPadding }}>
                <EmptyState
                  compact
                  title={
                    cat === 'for_you'
                      ? 'No plans for you yet'
                      : cat === 'now'
                      ? 'Nothing starting soon'
                      : `No ${categoryBySlug[cat]?.short.toLowerCase() || ''} plans yet`
                  }
                  body="Be the first. Others nearby are probably thinking the same."
                  cta="Start one"
                  onCta={() =>
                    nav.navigate('create_activity_type', { category: categoryBySlug[cat] ? cat : undefined })
                  }
                />
              </View>
            )}
          </View>
        </QueryState>
      </View>

      {/* Nearby people */}
      <HomeSectionHeader title="People up for something" action="Live" onAction={() => nav.navigate('live_radar')} />
      <QueryState
        status={ppl.status}
        error={ppl.error}
        hasData={nearbyPeople.length > 0}
        onRetry={ppl.reload}
        skeletonRows={1}
        skeletonHeight={150}
        empty={{
          title: 'Nobody’s flagged free nearby',
          body: 'Set yourself available. You might be the spark.',
          cta: 'Go available',
          onCta: () => nav.navigate('availability_setup'),
          pose: 'stride',
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -layout.screenPadding }}
          contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.xs }}
        >
          {nearbyPeople.map((p) => (
            <PersonChip
              key={p.id}
              person={p}
              match={matchLabel(profile.socialStyle, p.socialStyle)}
              onPress={() => setPerson(p)}
            />
          ))}
        </ScrollView>
      </QueryState>

      {/* Groups */}
      <HomeSectionHeader title="Circles near you" action="All" onAction={() => nav.navigate('circles_home')} />
      {shownCircles.length ? (
        <View style={{ gap: space.xs }}>
          {shownCircles.map((c) => {
            const joined = joinedCircles.includes(c.id);
            return (
              <Card
                key={c.id}
                onPress={() => nav.navigate('circle_detail', { id: c.id })}
                elevated={false}
                style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: colors.border }}
                padding={12}
                accessibilityLabel={`${c.name}, ${c.members ?? 0} members`}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 16,
                    backgroundColor: accents[(c.accentIndex ?? 0) % accents.length].bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Pictogram name={c.pictogram || 'people'} size={26} color={colors.ink} />
                </View>
                <View style={{ flex: 1, marginLeft: space.sm }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {c.name}
                  </AppText>
                  <AppText variant="caption" color={colors.muted}>
                    {[`${c.members ?? 0} members`, c.area].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
                <Button
                  title={joined ? 'Joined' : 'Join'}
                  size="xs"
                  variant={joined ? 'secondary' : 'primary'}
                  full={false}
                  icon={joined ? 'check' : undefined}
                  loading={joiningCircle === c.id}
                  disabled={joined}
                  onPress={() => onJoinCircle(c)}
                />
              </Card>
            );
          })}
        </View>
      ) : circlesLoader.status === 'loading' || circlesLoader.status === 'idle' ? (
        <Skeleton height={72} r={radius.card} />
      ) : (
        <Card
          elevated={false}
          style={{ borderWidth: 1.2, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' }}
        >
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1 }}>
            {circlesLoader.status === 'error'
              ? 'Couldn’t load circles.'
              : 'No circles around here yet. Start a recurring group.'}
          </AppText>
          <Button
            title={circlesLoader.status === 'error' ? 'Retry' : 'Start one'}
            size="xs"
            full={false}
            onPress={() => (circlesLoader.status === 'error' ? circlesLoader.reload() : nav.navigate('circle_create'))}
          />
        </Card>
      )}

      {/* Partner perks: one compact rail, hidden when empty or unavailable */}
      <PerksRail refreshKey={perksKey} />

      {/* Guide entry */}
      <Card
        onPress={() => nav.navigate('plan_assistant')}
        bg={colors.periwinkleWash}
        elevated={false}
        padding={space.md}
        style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }}
        accessibilityLabel="Not sure what to do? Ask Mo"
      >
        <GuideCharacter size={60} state="wave" decorative />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">Not sure what to do?</AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
            Tell Mo “I have 20 minutes free” and get ideas nearby.
          </AppText>
        </View>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: space.xs,
          }}
        >
          <Icon name="arrow-right" size={18} color={colors.ink} />
        </View>
      </Card>

      {/* Person sheet: public card only. Chat opens after an accepted plan. */}
      <Sheet visible={!!person} onClose={() => setPerson(null)} title={person?.name}>
        {person && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar seed={person.id} uri={person.avatarUrl} size={64} />
              <View style={{ marginLeft: space.md, flex: 1 }}>
                <AppText variant="bodyStrong">
                  {[
                    person.level != null && `Level ${person.level}`,
                    person.completed != null && `${person.completed} meetups`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'New member'}
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  {[
                    person.area && `Around ${person.area}`,
                    person.distanceM != null && `~${coarseDistance(person.distanceM)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
                {(() => {
                  const m = matchLabel(profile.socialStyle, person.socialStyle);
                  const style = STYLE_META[person.socialStyle];
                  if (!m && !style) return null;
                  return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {!!m && (
                        <Tag
                          label={m}
                          icon="sparkle"
                          bg={m === 'Great match' ? colors.mint : colors.lavender}
                          fg={colors.ink}
                        />
                      )}
                      {!!style && <Tag label={style.label} bg={homeTone('blue').bg} fg={colors.ink} />}
                    </View>
                  );
                })()}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <Icon name="check-circle" size={13} color={colors.success} />
                  <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
                    {person.reliability != null ? `${Math.round(person.reliability * 100)}% show-up · ` : ''}phone
                    verified
                  </AppText>
                </View>
              </View>
            </View>
            {(person.interests || []).length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md }}>
                {person.interests.map((s) => (
                  <Tag key={s} label={categoryBySlug[s]?.short || s} bg={colors.surface} />
                ))}
              </View>
            )}
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.quest,
                padding: space.sm,
                marginTop: space.md,
              }}
            >
              <AppText variant="caption" color={colors.inkSoft}>
                {person.name} is {person.availability === 'now' ? 'free now' : 'free later today'}
                {categoryBySlug[person.intent] ? ` for ${categoryBySlug[person.intent].label.toLowerCase()}` : ''}.
                Start a plan and invite the area. Chat opens once someone is accepted.
              </AppText>
            </View>
            {person.reliability != null && (
              <ProgressBar
                value={person.reliability}
                style={{ marginTop: space.md }}
                fill={colors.success}
                accessibilityLabel="Reliability"
              />
            )}
            <Button
              title={
                categoryBySlug[person.intent]
                  ? `Start a ${categoryBySlug[person.intent].short.toLowerCase()} plan`
                  : 'Start a plan'
              }
              style={{ marginTop: space.lg }}
              onPress={() => {
                setPerson(null);
                nav.navigate('create_activity_type', {
                  category: categoryBySlug[person.intent] ? person.intent : undefined,
                });
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.xs }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Report ${person.name}`}
                style={{
                  minHeight: layout.minTouch,
                  paddingHorizontal: space.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                onPress={() => {
                  setPerson(null);
                  nav.navigate('report_flow', { userId: person.id });
                }}
              >
                <Icon name="flag" size={14} color={colors.muted} />
                <AppText variant="label" color={colors.muted} style={{ marginLeft: 4 }}>
                  Report
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Block ${person.name}`}
                style={{
                  minHeight: layout.minTouch,
                  paddingHorizontal: space.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                onPress={() => {
                  setPerson(null);
                  nav.navigate('block_confirm', { userId: person.id });
                }}
              >
                <Icon name="slash" size={14} color={colors.muted} />
                <AppText variant="label" color={colors.muted} style={{ marginLeft: 4 }}>
                  Block
                </AppText>
              </Pressable>
            </View>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
