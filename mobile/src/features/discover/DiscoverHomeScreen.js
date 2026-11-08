// SCREEN B — Discover / Home (reference: middle phone).
// Greeting + avatar, bell, search, periwinkle featured live plan, pill
// category filters, pastel plan tiles, then nearby people, groups and trending.
// Data: GET /activities (+ /activities/featured), /availability/nearby,
// /circles and /quests — loaded on focus, refreshed with pull-to-refresh.
import React, { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
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
  QuestRow,
  Screen,
  SearchBar,
  SectionHeader,
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
import FeaturedPlanCard from './components/FeaturedPlanCard';
import PersonChip from './components/PersonChip';
import { isFull, joinUiState, visibleActivities } from './utils';

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
  const quests = useAppStore((s) => s.quests);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const xp = useAppStore((s) => s.progress.xp);
  const availability = useAppStore((s) => s.availability);
  const offline = useAppStore((s) => s.boot.offline);
  const unreadNotifs = useAppStore(selectUnreadCount);
  const unreadMsgs = useAppStore(selectUnreadMessages);
  const join = useJoinAction();

  const feed = useLoader('feed', (s) => s.loadFeed());
  const ppl = useLoader('nearbyPeople', (s) => s.loadNearbyPeople());
  const circlesLoader = useLoader('circles', (s) => s.loadCircles());
  useLoader('quests', (s) => s.loadQuests());

  const [cat, setCat] = useState('for_you');
  const [person, setPerson] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningCircle, setJoiningCircle] = useState(null);

  const lvl = levelFor(xp);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const feedList = useMemo(() => visibleActivities(feedIds.map((id) => byId.get(id)).filter(Boolean), { blocked }), [feedIds, byId, blocked]);
  const featured = useMemo(() => {
    const f = featuredId ? byId.get(featuredId) : null;
    if (f && visibleActivities([f], { blocked }).length) return f;
    return feedList.find((a) => a.live && !isFull(a)) || null;
  }, [featuredId, byId, blocked, feedList]);
  const tiles = useMemo(() => {
    const pool = feedList.filter((a) => a.id !== featured?.id);
    if (cat === 'for_you') {
      const mine = profile.interests.length ? pool.filter((a) => profile.interests.includes(a.category)) : [];
      return (mine.length >= 2 ? mine : pool).slice(0, 8);
    }
    if (cat === 'now') return pool.filter((a) => a.live || new Date(a.startsAt) - Date.now() < 90 * 60000).slice(0, 8);
    return pool.filter((a) => a.category === cat).slice(0, 8);
  }, [feedList, featured, cat, profile.interests]);
  const trending = useMemo(
    () => [...feedList].filter((a) => a.id !== featured?.id).sort((a, b) => b.joinedCount / (b.capacity || 1) - a.joinedCount / (a.capacity || 1)).slice(0, 4),
    [feedList, featured]
  );
  const nearbyPeople = useMemo(
    () =>
      nearbyPeopleIds
        .map((id) => users[id])
        .filter((p) => p && p.availability !== 'busy' && !blocked.includes(p.id))
        .sort((a, b) => (a.availability === 'now' ? 0 : 1) - (b.availability === 'now' ? 0 : 1) || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))
        .slice(0, 8),
    [nearbyPeopleIds, users, blocked]
  );
  const topQuest = useMemo(() => quests.find((q) => q.state === 'started' || q.state === 'completed') || quests.find((q) => q.state === 'available'), [quests]);
  const railCats = useMemo(() => {
    const preferred = profile.interests.map((s) => categoryBySlug[s]).filter(Boolean);
    const rest = categories.filter((c) => !profile.interests.includes(c.slug));
    return [...preferred, ...rest].slice(0, 8);
    // categories is updated in place by the server taxonomy; feedIds changes after bootstrap/loads.
  }, [profile.interests, feedIds]);
  const shownCircles = useMemo(() => circles.slice(0, 3), [circles]);

  const onRefresh = async () => {
    setRefreshing(true);
    const s = useAppStore.getState();
    await Promise.all([s.loadFeed({ silent: true }), s.loadNearbyPeople(), s.loadCircles(), s.loadQuests()].map((p) => p.catch(() => null)));
    setRefreshing(false);
  };

  const onJoinCircle = async (c) => {
    setJoiningCircle(c.id);
    try {
      await joinCircle(c.id);
    } catch (e) {
      Alert.alert('Couldn’t join circle', e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Try again.' : e?.message || 'Please try again.');
    } finally {
      setJoiningCircle(null);
    }
  };

  const name = profile.name || 'there';
  const hasFeed = feedList.length > 0 || !!featured;

  return (
    <Screen bg={colors.surface} tabBarSpace refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}>
      {/* Greeting row */}
      <Animated.View entering={enter(0)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <Avatar seed={profile.avatarSeed} uri={profile.avatarUri} size={50} label="Your profile" />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="h3" numberOfLines={1}>
            {greeting()}, {name}
          </AppText>
          <AppText variant="caption" color={colors.muted} onPress={() => nav.navigate('social_roadmap')} suppressHighlighting>
            {[`Level ${lvl.level}`, lvl.name, profile.area].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <IconButton icon="message-circle" accessibilityLabel={`Inbox${unreadMsgs ? `, ${unreadMsgs} unread` : ''}`} badge={unreadMsgs > 0} onPress={() => nav.navigate('inbox')} style={{ marginRight: space.xs }} />
        <IconButton icon="bell" accessibilityLabel={`Notifications${unreadNotifs ? `, ${unreadNotifs} unread` : ''}`} badge={unreadNotifs > 0} onPress={() => nav.navigate('notifications_center')} />
      </Animated.View>

      {offline && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.orangeSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }}>
          <Icon name="wifi-off" size={15} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: 6 }}>
            You’re offline — showing what we had. Pull down to retry.
          </AppText>
        </View>
      )}

      {/* Search */}
      <Animated.View entering={enter(1)} style={{ marginTop: space.md }}>
        <SearchBar placeholder="Search chai, badminton, people…" onPress={() => nav.navigate('discover_search')} onFilter={() => nav.navigate('filters_sheet')} />
      </Animated.View>

      {/* Availability status */}
      <Animated.View entering={enter(2)}>
        <Card
          onPress={() => nav.navigate('availability_setup')}
          bg={availability.status === 'now' ? colors.mint : colors.surfaceSubtle}
          elevated={false}
          padding={12}
          style={{ marginTop: space.sm, flexDirection: 'row', alignItems: 'center' }}
          accessibilityLabel="Set your availability"
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: availability.status === 'now' ? colors.success : availability.status === 'later' ? colors.warning : colors.muted, marginHorizontal: 6 }} />
          <AppText variant="label" style={{ flex: 1, marginLeft: 4 }}>
            {availability.status === 'now'
              ? `You're available now${availability.activities?.length ? ` for ${availability.activities.map((s) => categoryBySlug[s]?.short.toLowerCase()).filter(Boolean).join(', ')}` : ''}`
              : availability.status === 'later'
                ? 'Available later today'
                : 'Free right now? Let nearby plans find you'}
          </AppText>
          <AppText variant="label" color={colors.deep}>
            {availability.status === 'busy' ? 'Go available' : 'Edit'}
          </AppText>
        </Card>
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
          empty={{ title: 'Quiet around here', body: 'No plans nearby yet — start one and people can join you.', cta: 'Create a plan', onCta: () => nav.navigate('create_activity_type'), secondary: 'Widen the search', onSecondary: () => nav.navigate('filters_sheet') }}
        >
          <Animated.View entering={enter(3)}>
            {featured && (
              <FeaturedPlanCard activity={featured} joinState={joinUiState(joinStates[featured.id])} onPress={() => nav.navigate('activity_detail', { id: featured.id })} onJoin={() => join(featured)} />
            )}
          </Animated.View>

          {/* Category filters + tiles */}
          <View style={{ marginTop: space.lg, marginHorizontal: -layout.screenPadding }}>
            <ChipRow>
              <Chip label="For you" icon="star" selected={cat === 'for_you'} onPress={() => setCat('for_you')} />
              <Chip label="Starting soon" icon="clock" selected={cat === 'now'} onPress={() => setCat('now')} />
              {railCats.map((c) => (
                <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={cat === c.slug} onPress={() => setCat(c.slug)} />
              ))}
            </ChipRow>
            {tiles.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.sm, paddingTop: space.md }}>
                {tiles.map((a, i) => (
                  <ActivityCard key={a.id} activity={a} index={i} variant="tile" onPress={() => nav.navigate('activity_detail', { id: a.id })} />
                ))}
                <Card
                  onPress={() => nav.navigate(categoryBySlug[cat] ? 'category_results' : 'discover_search', { category: categoryBySlug[cat] ? cat : undefined })}
                  bg={colors.surfaceSubtle}
                  elevated={false}
                  style={{ width: 120, minHeight: 196, alignItems: 'center', justifyContent: 'center' }}
                  accessibilityLabel="See all plans"
                >
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
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
                  title={`No ${categoryBySlug[cat]?.short.toLowerCase() || ''} plans yet`}
                  body="Be the first — others nearby are probably thinking the same."
                  cta="Start one"
                  onCta={() => nav.navigate('create_activity_type', { category: categoryBySlug[cat] ? cat : undefined })}
                />
              </View>
            )}
          </View>
        </QueryState>
      </View>

      {/* Quest nudge */}
      {topQuest && (
        <>
          <SectionHeader title="Your quest" action="Roadmap" onAction={() => nav.navigate('social_roadmap')} />
          <QuestRow title={topQuest.title} subtitle={topQuest.subtitle} pictogram={topQuest.pictogram} progress={topQuest.progress} total={topQuest.total} onPress={() => nav.navigate('social_roadmap')} />
        </>
      )}

      {/* Nearby people */}
      <SectionHeader title="People up for something" action="Live radar" onAction={() => nav.navigate('live_radar')} />
      <QueryState
        status={ppl.status}
        error={ppl.error}
        hasData={nearbyPeople.length > 0}
        onRetry={ppl.reload}
        skeletonRows={1}
        skeletonHeight={150}
        empty={{ title: 'Nobody’s flagged free nearby', body: 'Set yourself available — you might be the spark.', cta: 'Go available', onCta: () => nav.navigate('availability_setup'), pose: 'stride' }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.screenPadding }} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.xs }}>
          {nearbyPeople.map((p) => (
            <PersonChip key={p.id} person={p} onPress={() => setPerson(p)} />
          ))}
        </ScrollView>
      </QueryState>

      {/* Groups */}
      <SectionHeader title="Circles near you" action="All circles" onAction={() => nav.navigate('circles_home')} />
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
                <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: accents[(c.accentIndex ?? 0) % accents.length].bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Pictogram name={c.pictogram || 'people'} size={26} />
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
        <Card elevated={false} style={{ borderWidth: 1.2, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1 }}>
            {circlesLoader.status === 'error' ? 'Couldn’t load circles.' : 'No circles around here yet — start a recurring group.'}
          </AppText>
          <Button
            title={circlesLoader.status === 'error' ? 'Retry' : 'Start one'}
            size="xs"
            full={false}
            onPress={() => (circlesLoader.status === 'error' ? circlesLoader.reload() : nav.navigate('circle_create'))}
          />
        </Card>
      )}

      {/* Trending */}
      {trending.length > 0 && (
        <>
          <SectionHeader title="Trending nearby" action="Map" onAction={() => nav.navigate('map_discovery')} />
          <View style={{ gap: space.sm }}>
            {trending.map((a, i) => (
              <ActivityCard
                key={a.id}
                activity={a}
                index={i}
                variant="row"
                joinState={joinUiState(joinStates[a.id])}
                onPress={() => nav.navigate('activity_detail', { id: a.id })}
                onJoin={() => join(a)}
                style={{ borderWidth: 1.2, borderColor: colors.border }}
              />
            ))}
          </View>
        </>
      )}

      {/* Guide entry */}
      <Card onPress={() => nav.navigate('plan_assistant')} bg={colors.ink} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="Ask the IRL Guide">
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name="sparkle" size={28} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong" color={colors.white}>
            Not sure what to do?
          </AppText>
          <AppText variant="caption" color="rgba(255,255,255,0.7)">
            “I have 20 minutes free” — ask the IRL Guide
          </AppText>
        </View>
        <Icon name="arrow-up-right" color={colors.white} />
      </Card>

      {/* Person sheet: public card only. Chat opens after an accepted plan. */}
      <Sheet visible={!!person} onClose={() => setPerson(null)} title={person?.name}>
        {person && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar seed={person.id} uri={person.avatarUrl} size={64} />
              <View style={{ marginLeft: space.md, flex: 1 }}>
                <AppText variant="bodyStrong">{[person.level != null && `Level ${person.level}`, person.completed != null && `${person.completed} meetups`].filter(Boolean).join(' · ') || 'New member'}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  {[person.area && `Around ${person.area}`, person.distanceM != null && `~${coarseDistance(person.distanceM)}`].filter(Boolean).join(' · ')}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <Icon name="check-circle" size={13} color={colors.success} />
                  <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
                    {person.reliability != null ? `${Math.round(person.reliability * 100)}% show-up · ` : ''}phone verified
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
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}>
              <AppText variant="caption" color={colors.inkSoft}>
                {person.name} is {person.availability === 'now' ? 'free now' : 'free later today'}
                {categoryBySlug[person.intent] ? ` for ${categoryBySlug[person.intent].label.toLowerCase()}` : ''}. Start a plan and invite the area — chat opens once someone is accepted.
              </AppText>
            </View>
            {person.reliability != null && <ProgressBar value={person.reliability} style={{ marginTop: space.md }} fill={colors.success} accessibilityLabel="Reliability" />}
            <Button
              title={categoryBySlug[person.intent] ? `Start a ${categoryBySlug[person.intent].short.toLowerCase()} plan` : 'Start a plan'}
              style={{ marginTop: space.lg }}
              onPress={() => {
                setPerson(null);
                nav.navigate('create_activity_type', { category: categoryBySlug[person.intent] ? person.intent : undefined });
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.sm }}>
              <AppText
                variant="label"
                color={colors.muted}
                onPress={() => {
                  setPerson(null);
                  nav.navigate('report_flow', { userId: person.id });
                }}
              >
                Report
              </AppText>
              <AppText
                variant="label"
                color={colors.muted}
                onPress={() => {
                  setPerson(null);
                  nav.navigate('block_confirm', { userId: person.id });
                }}
              >
                Block
              </AppText>
            </View>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
