// Profile (bottom tab). Own profile by default; pass { userId } to view
// another member's PUBLIC profile (coarse area only, report/block always on).
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  HeroCard,
  Icon,
  IconButton,
  Pictogram,
  ProgressBar,
  QueryState,
  QuestRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Tag,
} from '@/components';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { categoryBySlug } from '@/data/catalog';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { coarseDistance } from '@/utils/format';
import { goTab } from './navHelpers';

const BADGE_BG = { orange: colors.orange, periwinkle: colors.periwinkle, mint: colors.mint, pink: colors.pink, lavender: colors.lavender };
const TIER_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', venue: 'Venue / Club' };

function Stat({ value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${value} ${label}`}>
      <AppText variant="h2">{value}</AppText>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
    </View>
  );
}

function HubTile({ label, sub, icon, bg, onPress, width }) {
  return (
    <Card onPress={onPress} bg={bg} elevated={false} padding={14} style={{ width, minHeight: 104 }} accessibilityLabel={sub ? `${label}, ${sub}` : label}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={colors.white} />
      </View>
      <AppText variant="bodyStrong" style={{ marginTop: space.sm }} numberOfLines={1}>
        {label}
      </AppText>
      {!!sub && (
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
          {sub}
        </AppText>
      )}
    </Card>
  );
}

function OwnProfile() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const profile = useAppStore((s) => s.profile);
  const progress = useAppStore((s) => s.progress);
  const achievements = useAppStore((s) => s.achievements);
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const tier = useAppStore((s) => s.subscription.tier) || 'free';
  const expenses = useAppStore((s) => s.expenses);

  // Live data for this tab (each re-fetches on focus).
  const progressQ = useLoader('progress', (s) => s.loadProgress());
  const badgesQ = useLoader('achievements', (s) => s.loadAchievements());
  const plansQ = useLoader('my:joined', (s) => s.loadMyActivities('joined'));
  const subQ = useLoader('subscription', (s) => s.loadSubscription());
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([progressQ.reload(), badgesQ.reload(), plansQ.reload(), subQ.reload()]);
    setRefreshing(false);
  };

  const lvl = levelFor(progress.xp);
  const upcoming = useMemo(
    () => activities.filter((a) => ['accepted', 'requested', 'checked_in'].includes(joinStates[a.id]) && a.status !== 'cancelled' && new Date(a.startsAt).getTime() > Date.now() - 2 * 3600e3),
    [activities, joinStates]
  );
  const hostedLocal = useMemo(() => activities.filter((a) => a.host?.id === 'me' && a.status !== 'cancelled').length, [activities]);
  const hosted = Math.max(progress.hosted || 0, hostedLocal);
  const location = [profile.area, profile.city].filter(Boolean).join(', ');
  const badges = useMemo(() => [...achievements].sort((a, b) => Number(b.earned) - Number(a.earned)).slice(0, 6), [achievements]);
  const owed = useMemo(
    () => expenses.reduce((n, e) => n + (e.shares || []).filter((sh) => sh.userId === 'me' && sh.state === 'unsettled' && e.payeeId !== 'me').length, 0),
    [expenses]
  );
  const tileW = (width - layout.screenPadding * 2 - space.sm) / 2;

  const hub = [
    { key: 'split', label: 'SplitMate', sub: owed ? `${owed} to settle` : 'Split bills fairly', icon: 'percent', bg: colors.orangeSoft, go: () => nav.navigate('splitmate_home') },
    { key: 'circles', label: 'Circles', sub: `${joinedCircles.length} joined`, icon: 'users', bg: colors.pinkSoft, go: () => goTab(nav, 'circles_home') },
    { key: 'safety', label: 'Safety center', sub: 'Toolkit & contacts', icon: 'shield', bg: colors.mint, go: () => nav.navigate('safety_center') },
    { key: 'premium', label: tier === 'free' ? 'Try Plus' : 'Premium', sub: `Current: ${TIER_LABEL[tier] || tier}`, icon: 'star', bg: colors.periwinkleSoft, go: () => nav.navigate('premium_compare') },
    { key: 'business', label: 'Business hub', sub: 'Venues & clubs', icon: 'briefcase', bg: colors.lavender, go: () => nav.navigate('business_discovery') },
    { key: 'privacy', label: 'Privacy', sub: 'Visibility & data', icon: 'lock', bg: colors.surface, go: () => nav.navigate('privacy_controls') },
    { key: 'settings', label: 'Settings', sub: 'Account & app', icon: 'settings', bg: colors.surface, go: () => nav.navigate('account_settings') },
    { key: 'edit', label: 'Edit profile', sub: 'Photo, bio, interests', icon: 'edit-2', bg: colors.surface, go: () => nav.navigate('profile_edit') },
  ];

  return (
    <Screen tabBarSpace refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <AppText variant="h1" style={{ flex: 1 }} accessibilityRole="header">
          Profile
        </AppText>
        <IconButton icon="edit-2" accessibilityLabel="Edit profile" onPress={() => nav.navigate('profile_edit')} style={{ marginRight: space.xs }} />
        <IconButton icon="settings" accessibilityLabel="Settings" onPress={() => nav.navigate('account_settings')} />
      </View>

      {/* Identity hero */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.md }}>
        <HeroCard>
          <View pointerEvents="none" style={{ position: 'absolute', right: 12, top: 12, opacity: 0.3, transform: [{ rotate: '10deg' }] }}>
            <Pictogram name="sparkle" size={56} strokeWidth={1.4} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar seed={profile.avatarSeed} uri={profile.avatarUri} size={76} ring label="Your profile photo" />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <AppText variant="h2" numberOfLines={1}>
                {profile.name || 'Add your name'}
              </AppText>
              {!!profile.pronouns && (
                <AppText variant="caption" color={colors.inkSoft}>
                  {profile.pronouns}
                </AppText>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Icon name="map-pin" size={13} color={colors.inkSoft} />
                <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
                  {location || 'Area not set'}
                </AppText>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                <Tag label="Phone verified" icon="check-circle" bg="rgba(255,255,255,0.6)" />
                {tier !== 'free' && <Tag label={TIER_LABEL[tier]} icon="star" bg={colors.ink} fg={colors.white} />}
              </View>
            </View>
          </View>
          {profile.bio ? (
            <AppText style={{ marginTop: space.md }}>{profile.bio}</AppText>
          ) : (
            <AppText variant="label" color={colors.deep} style={{ marginTop: space.md }} onPress={() => nav.navigate('profile_edit')} suppressHighlighting>
              + Add a short bio so hosts know you a little
            </AppText>
          )}
          {progressQ.status === 'error' && progressQ.error && !progress.xp ? (
            <View style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }} accessibilityLiveRegion="polite">
              <Icon name="cloud-off" size={14} color={colors.inkSoft} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: 6 }}>
                Couldn't load your progress.
              </AppText>
              <AppText variant="label" color={colors.deep} onPress={progressQ.reload} accessibilityRole="button" suppressHighlighting>
                Retry
              </AppText>
            </View>
          ) : null}
          <Pressable onPress={() => nav.navigate('social_roadmap')} accessibilityRole="button" accessibilityLabel={`Level ${lvl.level}, ${lvl.name}. Open social roadmap`} style={{ marginTop: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="label">
                Level {lvl.level} · {lvl.name}
              </AppText>
              <AppText variant="label">{progress.xp} XP</AppText>
            </View>
            <ProgressBar value={lvl.ratio} style={{ marginTop: 6 }} track="rgba(255,255,255,0.7)" />
          </Pressable>
          <View style={{ flexDirection: 'row', marginTop: space.md }}>
            <Stat value={progress.completedActivities} label="Meetups" />
            <Stat value={progress.peopleMet} label="People met" />
            <Stat value={hosted} label="Hosted" />
          </View>
        </HeroCard>
      </Animated.View>

      {/* Reliability */}
      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="shield" size={26} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">{Math.round(progress.showUpRate * 100)}% show-up</AppText>
            <AppText variant="caption" color={colors.muted}>
              {progress.completedActivities
                ? `Across ${progress.completedActivities} completed plans. Hosts see this when you request to join.`
                : 'Builds as you attend plans. Hosts see this when you request to join.'}
            </AppText>
          </View>
        </Card>
      </Animated.View>

      {/* Interests */}
      <SectionHeader title="Into" action="Edit" onAction={() => nav.navigate('profile_edit')} />
      {profile.interests.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {profile.interests.map((s) => {
            const c = categoryBySlug[s];
            return c ? <Chip key={s} label={c.short} pictogram={c.pictogram} selected onPress={() => nav.navigate('category_results', { category: s })} /> : null;
          })}
        </View>
      ) : (
        <Button title="Pick your activities" icon="plus" variant="secondary" full={false} onPress={() => nav.navigate('profile_edit')} />
      )}
      {!!profile.boundaries && (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ marginTop: space.sm }} padding={12}>
          <AppText variant="label">My boundaries</AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
            {profile.boundaries}
          </AppText>
        </Card>
      )}

      {/* Progress */}
      <SectionHeader title="Progress" />
      <View style={{ gap: space.xs }}>
        <QuestRow title="Social roadmap" subtitle={lvl.next ? `${lvl.next.xp - progress.xp} XP to ${lvl.next.name}` : 'Top level reached'} pictogram="pin" onPress={() => nav.navigate('social_roadmap')} />
        <QuestRow title="Quests & streak" subtitle={`${progress.streakWeeks}-week streak · ${progress.weeklyDone}/${progress.weeklyGoal} this week`} pictogram="calendar" tone="light" onPress={() => nav.navigate('quest_home')} />
      </View>

      {/* Achievements */}
      <SectionHeader title="Badges" action="See all" onAction={() => nav.navigate('achievements')} />
      <QueryState
        status={badgesQ.status}
        error={badgesQ.error}
        hasData={badges.length > 0}
        onRetry={badgesQ.reload}
        skeletonRows={1}
        skeletonHeight={84}
        empty={{ title: 'No badges yet', body: 'Complete your first plan to start earning them.', pose: 'wave' }}
      >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.screenPadding }} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.sm }}>
        {badges.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => nav.navigate('achievement_detail', { id: a.id })}
            accessibilityRole="button"
            accessibilityLabel={`${a.title}, ${a.earned ? 'earned' : 'locked'}`}
            style={{ alignItems: 'center', width: 76 }}
          >
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: a.earned ? BADGE_BG[a.color] || colors.lavender : colors.surface,
                borderWidth: 3,
                borderColor: a.earned ? colors.ink : colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pictogram name={a.pictogram} size={28} color={a.earned ? colors.ink : colors.muted} />
            </View>
            <AppText variant="caption" align="center" numberOfLines={1} style={{ marginTop: 6 }}>
              {a.title}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
      </QueryState>

      {/* Plans */}
      <SectionHeader title="My plans" action="View all" onAction={() => nav.navigate('my_activities')} />
      <Card onPress={() => nav.navigate('my_activities')} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`${upcoming.length} upcoming plans, ${hosted} hosted`}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name="calendar" size={26} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">{plansQ.loading && !upcoming.length ? 'Loading plans…' : upcoming.length ? `${upcoming.length} upcoming` : 'Nothing planned yet'}</AppText>
          <AppText variant="caption" color={colors.muted}>
            {hosted} hosted · {progress.completedActivities} completed
          </AppText>
        </View>
        <Icon name="chevron-right" color={colors.muted} />
      </Card>

      {/* Utility hub */}
      <SectionHeader title="Hub" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {hub.map((h) => (
          <HubTile key={h.key} label={h.label} sub={h.sub} icon={h.icon} bg={h.bg} onPress={h.go} width={tileW} />
        ))}
      </View>

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xl }}>
        Project IRL is platonic and activity-first. Nobody is paid to show up — everyone's a participant.
      </AppText>
    </Screen>
  );
}

function PublicProfile({ userId }) {
  const nav = useNavigation();
  // GET /users/{id}/public-profile → store.users[userId] (+ upcoming plans upserted).
  const q = useLoader(`user:${userId}`, (s) => s.loadPublicProfile(userId), [userId]);
  const person = useAppStore((s) => s.users[userId]);
  const activities = useAppStore((s) => s.activities);
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const blocked = useAppStore((s) => s.blocked);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const [unblocking, setUnblocking] = useState(false);
  const [unblockError, setUnblockError] = useState(null);

  const isBlocked = blocked.includes(userId);
  const plans = useMemo(
    () => activities.filter((a) => a.host?.id === userId && a.status !== 'cancelled' && new Date(a.startsAt).getTime() > Date.now() - 30 * 60000),
    [activities, userId]
  );
  const shared = useMemo(() => {
    const ids = person?.sharedCircleIds;
    return circles.filter((c) => (ids ? ids.includes(c.id) : c.memberSeeds?.includes(userId)));
  }, [circles, userId, person]);
  const interests = person?.interests || [];
  const name = person?.name || 'this person';

  const back = () => {
    if (nav.canGoBack()) nav.goBack();
    else nav.setParams({ userId: undefined });
  };

  const unblock = async () => {
    setUnblocking(true);
    setUnblockError(null);
    try {
      await unblockUser(userId);
    } catch (e) {
      setUnblockError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || "Couldn't unblock. Try again.");
    } finally {
      setUnblocking(false);
    }
  };

  const header = (
    <ScreenHeader
      title={person?.name || 'Profile'}
      onBack={back}
      right={<IconButton icon="flag" accessibilityLabel={`Report ${name}`} onPress={() => nav.navigate('report_flow', { userId })} />}
    />
  );

  if (!person) {
    const notFound = q.status === 'error' && /not.?found|404|hidden/i.test(q.error || '');
    return (
      <Screen header={header} tabBarSpace>
        {notFound ? (
          <EmptyState title="Profile unavailable" body="This member may have hidden their profile or left Project IRL." cta="Back" onCta={back} />
        ) : (
          <QueryState status={q.status} error={q.error} hasData={false} onRetry={q.reload} skeletonRows={3} skeletonHeight={110}>
            {null}
          </QueryState>
        )}
        {/* Safety actions stay reachable even if the profile can't load. */}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
          <Button title="Report" icon="flag" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('report_flow', { userId })} />
          {!isBlocked && <Button title="Block" icon="slash" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('block_confirm', { userId })} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={header} tabBarSpace refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.reload} tintColor={colors.ink} />}>
      <Animated.View entering={enter(0)}>
        <HeroCard>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar seed={person.avatarSeed || person.id} uri={person.avatarUrl} size={76} ring label={`${person.name}'s avatar`} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <AppText variant="h2">{person.name}</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {person.level ? `Level ${person.level}` : 'New member'}
                {person.completed != null ? ` · ${person.completed} meetups` : ''}
              </AppText>
              {(person.area || person.distanceM != null) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <Icon name="map-pin" size={13} color={colors.inkSoft} />
                  <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
                    {[person.area ? `Around ${person.area}` : null, person.distanceM != null ? `~${coarseDistance(person.distanceM)}` : null].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md }}>
            <Tag label="Phone verified" icon="check-circle" bg="rgba(255,255,255,0.6)" />
            {person.reliability != null && <Tag label={`${Math.round(person.reliability * 100)}% show-up`} icon="shield" bg="rgba(255,255,255,0.6)" />}
          </View>
        </HeroCard>
      </Animated.View>
      {q.status === 'loading' && <Skeleton height={6} style={{ marginTop: space.xs }} />}

      {isBlocked ? (
        <Card style={{ marginTop: space.md }} bg={colors.surfaceSubtle} elevated={false}>
          <AppText variant="bodyStrong">You blocked {person.name}</AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            They can't see your plans or message you. They haven't been notified.
          </AppText>
          {unblockError && (
            <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
              {unblockError}
            </AppText>
          )}
          <Button title="Unblock" variant="secondary" size="sm" full={false} style={{ marginTop: space.sm }} loading={unblocking} onPress={unblock} />
        </Card>
      ) : (
        <>
          {interests.length > 0 && <SectionHeader title="Into" />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {interests.map((s) => {
              const c = categoryBySlug[s];
              return c ? <Chip key={s} label={c.short} pictogram={c.pictogram} onPress={() => nav.navigate('category_results', { category: s })} /> : null;
            })}
          </View>

          <SectionHeader title={`${person.name}'s upcoming plans`} />
          {plans.length ? (
            <View style={{ gap: space.sm }}>
              {plans.map((a, i) => (
                <ActivityCard key={a.id} activity={a} index={i} variant="row" onPress={() => nav.navigate('activity_detail', { id: a.id })} />
              ))}
            </View>
          ) : (
            <Card elevated={false} bg={colors.surfaceSubtle}>
              <AppText variant="caption" color={colors.muted}>
                No public plans right now.
              </AppText>
            </Card>
          )}

          {shared.length > 0 && (
            <>
              <SectionHeader title="Circles" />
              <View style={{ gap: space.xs }}>
                {shared.map((c) => (
                  <Card key={c.id} onPress={() => nav.navigate('circle_detail', { id: c.id })} padding={12} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={c.name}>
                    <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: accents[c.accentIndex % accents.length].bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Pictogram name={c.pictogram} size={22} />
                    </View>
                    <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }} numberOfLines={1}>
                      {c.name}
                    </AppText>
                    {joinedCircles.includes(c.id) && <Tag label="You're in this" bg={colors.mint} />}
                  </Card>
                ))}
              </View>
            </>
          )}

          <Card elevated={false} bg={colors.periwinkleWash} style={{ marginTop: space.lg, flexDirection: 'row' }} padding={12}>
            <Icon name="message-circle" size={16} color={colors.deep} />
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
              Chat opens once you're both in an accepted plan. Exact locations are only shared inside a plan's group.
            </AppText>
          </Card>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
        <Button title="Report" icon="flag" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('report_flow', { userId })} />
        {!isBlocked && <Button title="Block" icon="slash" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('block_confirm', { userId })} />}
      </View>
      <View style={{ height: radius.sm }} />
    </Screen>
  );
}

export default function ProfileHomeScreen() {
  const route = useRoute();
  const userId = route.params?.userId;
  if (userId && userId !== 'me') return <PublicProfile userId={userId} />;
  return <OwnProfile />;
}
