// Profile (bottom tab). Own profile by default; pass { userId } to view
// another member's PUBLIC profile (coarse area only, report/block always on).
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Crown } from 'phosphor-react-native/src/icons/Crown';
import {
  ActivityCard,
  AppText,
  Avatar,
  Button,
  Card,
  Chip,
  ChipGrid,
  EmptyState,
  HeroCard,
  Icon,
  IconButton,
  Mascot,
  Pictogram,
  QueryState,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Tag,
} from '@/components';
import { accents, colors, glass, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { categoryBySlug } from '@/data/catalog';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { coarseDistance } from '@/utils/format';
import { shortDate, usePlanSummary } from '@/features/premium/plans';
import { BenefitRow, toneColors } from '@/features/premium/PaywallParts';
import { goTab } from './navHelpers';

const TIER_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', venue: 'Venue / Club' };

// One equal-width column of the stats strip.
function Stat({ value, label, first }) {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderLeftWidth: first ? 0 : 1, borderLeftColor: colors.border }}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <AppText variant="h2" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.muted} align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ marginTop: 2 }}>
        {label}
      </AppText>
    </View>
  );
}

// Hub tile: fills its ChipGrid cell, so every tile in a row is the same size.
function HubTile({ label, sub, icon, tone, onPress }) {
  const t = toneColors(tone);
  return (
    <Card onPress={onPress} bg={t.bg} elevated={false} padding={space.md} style={{ flex: 1, minHeight: 112 }} accessibilityLabel={sub ? `${label}, ${sub}` : label}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={colors.ink} weight="duotone" duotoneColor={t.duo} duotoneOpacity={0.6} />
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

// One navigating row: icon bubble, title, one-line status, chevron.
function MenuRow({ icon, tone, title, sub, onPress, last }) {
  const t = toneColors(tone);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={colors.ink} weight="duotone" duotoneColor={t.duo} duotoneOpacity={0.6} />
      </View>
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        {!!sub && (
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {sub}
          </AppText>
        )}
      </View>
      <Icon name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

// Bottom-of-profile membership section: an upsell for free members, the
// current plan for subscribers. Benefits come from GET /plans (no store call).
// Flat brand fill, no decoration behind the text.
function PremiumUpsell({ onPress }) {
  const summary = usePlanSummary();
  const plus = summary.byId('plus');
  const perks = (plus?.newItems || []).slice(0, 3);
  return (
    <Card onPress={onPress} bg={colors.periwinkle} padding={space.md} elevated={false} r={radius.hero} accessibilityLabel={`Come Over ${plus?.name || 'Plus'}. ${perks.map((p) => p.label).join(', ')}. See plans`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Crown size={22} color={colors.ink} weight="duotone" duotoneColor={colors.orange} duotoneOpacity={0.9} />
        </View>
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <AppText variant="h3">Come Over {plus?.name || 'Plus'}</AppText>
          <AppText variant="caption" color={colors.inkSoft}>
            Get more out of every plan
          </AppText>
        </View>
        <Mascot size={56} pose="wave" />
      </View>
      {perks.length > 0 ? (
        <View style={{ marginTop: space.sm }}>
          {perks.map((f) => (
            <BenefitRow key={f.key} item={f} compact bubbleBg={colors.surface} style={{ paddingVertical: 2 }} />
          ))}
        </View>
      ) : summary.status === 'loading' ? (
        <View style={{ marginTop: space.sm, gap: space.xs }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={32} r={radius.sm} />
          ))}
        </View>
      ) : (
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
          Saved searches, smarter filters and tools for hosts.
        </AppText>
      )}
      <View pointerEvents="none" style={{ marginTop: space.md }}>
        <Button title="See Plus & Pro" iconRight="arrow-right" onPress={onPress} />
      </View>
      <AppText variant="caption" color={colors.inkSoft} align="center" style={{ marginTop: space.xs }}>
        Finding people, joining plans and safety stay free.
      </AppText>
    </Card>
  );
}

const PLAN_STATUS = (status) =>
  ({
    active: { label: 'Active', bg: colors.mint },
    cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle },
    grace: { label: 'Payment issue', bg: colors.orangeSoft },
    pending: { label: 'Pending', bg: colors.orangeSoft },
  }[status] || { label: 'Active', bg: colors.mint });

function PlanCard({ subscription, onPress }) {
  const tier = subscription.tier;
  const name = TIER_LABEL[tier] || tier;
  const st = PLAN_STATUS(subscription.status);
  const t = toneColors(tier === 'pro' ? 'orange' : 'periwinkle');
  const when = subscription.expiresAt ? shortDate(subscription.expiresAt) : '';
  const line =
    subscription.status === 'cancelled' && when
      ? `Access until ${when}`
      : subscription.status === 'grace'
      ? 'Update your payment in store settings'
      : when
      ? `Renews ${when}`
      : 'Renews monthly';
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Your plan: Come Over ${name}, ${st.label}. ${line}. Manage subscription`}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Crown size={28} color={colors.ink} weight="duotone" duotoneColor={t.duo} duotoneOpacity={0.7} />
      </View>
      <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <AppText variant="bodyStrong">Come Over {name}</AppText>
          <Tag label={st.label} bg={st.bg} fg={colors.ink} style={{ alignSelf: 'center' }} />
        </View>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          {line}
        </AppText>
      </View>
      <Icon name="chevron-right" size={18} color={colors.muted} />
    </Card>
  );
}

function OwnProfile() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const progress = useAppStore((s) => s.progress);
  const achievements = useAppStore((s) => s.achievements);
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const subscription = useAppStore((s) => s.subscription);
  const tier = subscription.tier || 'free';
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
  const earned = useMemo(() => achievements.filter((a) => a.earned).length, [achievements]);
  const owed = useMemo(
    () => expenses.reduce((n, e) => n + (e.shares || []).filter((sh) => sh.userId === 'me' && sh.state === 'unsettled' && e.payeeId !== 'me').length, 0),
    [expenses]
  );

  const plansLine = plansQ.loading && !upcoming.length ? 'Loading…' : upcoming.length ? `${upcoming.length} upcoming` : 'Nothing planned yet';
  const badgesLine = achievements.length
    ? `${earned} of ${achievements.length} earned`
    : badgesQ.loading
    ? 'Loading…'
    : badgesQ.status === 'error'
    ? "Couldn't load. Tap to open"
    : 'Complete a plan to earn one';
  // Privacy and settings live behind the header's settings button.
  const tools = [
    { key: 'split', label: 'SplitMate', sub: owed ? `${owed} to settle` : 'Split bills fairly', icon: 'divide-circle', tone: 'orange', go: () => nav.navigate('splitmate_home') },
    { key: 'circles', label: 'Circles', sub: `${joinedCircles.length} joined`, icon: 'users', tone: 'pink', go: () => goTab(nav, 'circles_home') },
    { key: 'safety', label: 'Safety center', sub: 'Toolkit & contacts', icon: 'shield', tone: 'mint', go: () => nav.navigate('safety_center') },
    { key: 'business', label: 'Business hub', sub: 'Venues & clubs', icon: 'briefcase', tone: 'lavender', go: () => nav.navigate('business_discovery') },
  ];
  const paidActive = tier !== 'free' && ['plus', 'pro'].includes(tier);

  return (
    <Screen tabBarSpace refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <AppText variant="h1" style={{ flex: 1 }} accessibilityRole="header">
          Profile
        </AppText>
        <IconButton icon="edit-2" accessibilityLabel="Edit profile" onPress={() => nav.navigate('profile_edit')} style={{ marginRight: space.xs }} />
        <IconButton icon="settings" accessibilityLabel="Settings" onPress={() => nav.navigate('account_settings')} />
      </View>

      {/* Identity: who you are, where, your level */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.md }}>
        <HeroCard>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar seed={profile.avatarSeed} uri={profile.avatarUri} size={72} ring animated label="Your profile photo" />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <AppText variant="h2" numberOfLines={1}>
                {profile.name || 'Add your name'}
              </AppText>
              <AppText variant="label" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: 2 }}>
                Level {lvl.level} · {lvl.name}
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Icon name="map-pin" size={13} color={colors.inkSoft} />
                <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4, flexShrink: 1 }} numberOfLines={1}>
                  {[location || 'Area not set', profile.pronouns].filter(Boolean).join(' · ')}
                </AppText>
              </View>
              <Tag label="Phone verified" icon="check-circle" bg={glass(0.6)} fg={colors.ink} style={{ marginTop: space.xs }} />
            </View>
          </View>
          {profile.bio ? (
            <AppText style={{ marginTop: space.md }} numberOfLines={4}>
              {profile.bio}
            </AppText>
          ) : (
            <AppText variant="label" color={colors.deep} style={{ marginTop: space.sm, paddingVertical: space.xs }} onPress={() => nav.navigate('profile_edit')} accessibilityRole="button" suppressHighlighting>
              + Add a short bio
            </AppText>
          )}
        </HeroCard>
      </Animated.View>

      {/* Stats: four equal columns */}
      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.sm }} padding={space.md}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            <Stat first value={progress.completedActivities} label="Meetups" />
            <Stat value={progress.peopleMet} label="People met" />
            <Stat value={hosted} label="Hosted" />
            <Stat value={progress.showUpRate != null ? `${Math.round(progress.showUpRate * 100)}%` : '–'} label="Show-up" />
          </View>
          {progressQ.status === 'error' && progressQ.error && !progress.xp ? (
            <View style={{ marginTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }} accessibilityLiveRegion="polite">
              <Icon name="cloud-off" size={14} color={colors.muted} />
              <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6 }}>
                Couldn't load your stats.
              </AppText>
              <AppText variant="label" color={colors.deep} style={{ marginLeft: space.xs, paddingVertical: space.xxs }} onPress={progressQ.reload} accessibilityRole="button" suppressHighlighting>
                Retry
              </AppText>
            </View>
          ) : null}
        </Card>
      </Animated.View>

      {/* Interests */}
      <SectionHeader title="Into" action="Edit" onAction={() => nav.navigate('profile_edit')} />
      {profile.interests.length ? (
        <ChipGrid columns={2}>
          {profile.interests.map((s) => {
            const c = categoryBySlug[s];
            return c ? <Chip key={s} label={c.short} pictogram={c.pictogram} fill onPress={() => nav.navigate('category_results', { category: s })} /> : null;
          })}
        </ChipGrid>
      ) : (
        <Button title="Pick your activities" icon="plus" variant="secondary" full={false} onPress={() => nav.navigate('profile_edit')} />
      )}
      {!!profile.boundaries && (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ marginTop: space.sm, flexDirection: 'row', alignItems: 'flex-start' }} padding={space.sm}>
          <Icon name="shield" size={16} color={colors.deep} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, marginLeft: space.xs }}>
            <AppText variant="label">My boundaries</AppText>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
              {profile.boundaries}
            </AppText>
          </View>
        </Card>
      )}

      {/* Your activity: plans and progress, one row each */}
      <SectionHeader title="Your activity" />
      <Card padding={0} style={{ paddingHorizontal: space.md }}>
        <MenuRow icon="calendar" tone="periwinkle" title="My plans" sub={plansLine} onPress={() => nav.navigate('my_activities')} />
        <MenuRow icon="map-trifold" tone="lavender" title="Social roadmap" sub={lvl.next ? `${lvl.next.xp - progress.xp} XP to ${lvl.next.name}` : 'Top level reached'} onPress={() => nav.navigate('social_roadmap')} />
        <MenuRow icon="ticket" tone="pink" title="Your perks" sub="Partner perks unlock as you level up" onPress={() => nav.navigate('my_perks')} />
        <MenuRow icon="fire" tone="orange" title="Quests & streak" sub={`${progress.streakWeeks}-week streak · ${progress.weeklyDone}/${progress.weeklyGoal} this week`} onPress={() => nav.navigate('quest_home')} />
        <MenuRow icon="award" tone="mint" title="Badges" sub={badgesLine} onPress={() => nav.navigate('achievements')} last />
      </Card>

      {/* Tools */}
      <SectionHeader title="Tools" />
      <ChipGrid columns={2} gap={space.sm}>
        {tools.map((h) => (
          <HubTile key={h.key} label={h.label} sub={h.sub} icon={h.icon} tone={h.tone} onPress={h.go} />
        ))}
      </ChipGrid>

      {/* Membership (bottom of the page, by design) */}
      <SectionHeader title="Membership" action={paidActive ? 'Compare plans' : undefined} onAction={() => nav.navigate('premium_compare')} />
      {paidActive ? (
        <PlanCard subscription={subscription} onPress={() => nav.navigate('subscription_manage')} />
      ) : (
        <PremiumUpsell onPress={() => nav.navigate('premium_compare')} />
      )}
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
          <EmptyState title="Profile unavailable" body="This member may have hidden their profile or left Come Over." cta="Back" onCta={back} />
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
            <Avatar seed={person.avatarSeed || person.id} uri={person.avatarUrl} size={72} ring label={`${person.name}'s avatar`} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <AppText variant="h2" numberOfLines={1}>
                {person.name}
              </AppText>
              <AppText variant="label" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: 2 }}>
                {person.level ? `Level ${person.level}` : 'New member'}
                {person.completed != null ? ` · ${person.completed} meetups` : ''}
              </AppText>
              {(person.area || person.distanceM != null) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Icon name="map-pin" size={13} color={colors.inkSoft} />
                  <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4, flexShrink: 1 }} numberOfLines={1}>
                    {[person.area ? `Around ${person.area}` : null, person.distanceM != null ? `~${coarseDistance(person.distanceM)}` : null].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
            <Tag label="Phone verified" icon="check-circle" bg={glass(0.6)} fg={colors.ink} />
            {person.reliability != null && <Tag label={`${Math.round(person.reliability * 100)}% show-up`} icon="shield" bg={glass(0.6)} fg={colors.ink} />}
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
          {interests.length > 0 && (
            <>
              <SectionHeader title="Into" />
              <ChipGrid columns={2}>
                {interests.map((s) => {
                  const c = categoryBySlug[s];
                  return c ? <Chip key={s} label={c.short} pictogram={c.pictogram} fill onPress={() => nav.navigate('category_results', { category: s })} /> : null;
                })}
              </ChipGrid>
            </>
          )}

          <SectionHeader title="Upcoming plans" />
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
              <SectionHeader title="Shared circles" />
              <View style={{ gap: space.xs }}>
                {shared.map((c) => (
                  <Card key={c.id} onPress={() => nav.navigate('circle_detail', { id: c.id })} padding={12} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={c.name}>
                    <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: accents[c.accentIndex % accents.length].bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Pictogram name={c.pictogram} size={22} />
                    </View>
                    <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }} numberOfLines={1}>
                      {c.name}
                    </AppText>
                    {joinedCircles.includes(c.id) && <Tag label="Joined" bg={colors.mint} style={{ alignSelf: 'center', marginLeft: space.xs }} />}
                  </Card>
                ))}
              </View>
            </>
          )}

          <View style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="message-circle" size={16} color={colors.muted} />
            <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: space.xs }}>
              Chat opens once you're both in an accepted plan.
            </AppText>
          </View>
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
