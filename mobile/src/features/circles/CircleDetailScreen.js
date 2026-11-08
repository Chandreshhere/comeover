// circle_detail — description, rules, upcoming plans, members and challenge.
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  AvatarStack,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Pictogram,
  QueryState,
  QuestRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Tag,
} from '@/components';
import { personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import { circleAccent } from './components/CircleCard';
import { normalizeChallenge } from './circleUtils';

export default function CircleDetailScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const id = route.params?.id;
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const rawChallenge = useAppStore((s) => s.circleChallenges[id]);
  const joinCircle = useAppStore((s) => s.joinCircle);
  const leaveCircle = useAppStore((s) => s.leaveCircle);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const resetDraft = useAppStore((s) => s.resetDraft);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useLoader(`circle:${id}`, (s) => s.loadCircle(id), [id]);
  useLoader(`circleChallenge:${id}`, (s) => s.loadCircleChallenge(id), [id]);

  const c = useMemo(() => circles.find((x) => x.id === id), [circles, id]);
  const joined = joinedCircles.includes(id);
  const isOwner = c?.ownerId === 'me' || c?.myRole === 'owner';
  const planIds = useMemo(() => c?.nextPlanIds || (c?.upcomingPlans || []).map((p) => p.id), [c]);
  const plans = useMemo(
    () =>
      planIds
        .map((pid) => activities.find((a) => a.id === pid))
        .filter((a) => a && a.status !== 'cancelled' && !blocked.includes(a.host?.id))
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
    [planIds, activities, blocked]
  );
  const challenge = useMemo(() => normalizeChallenge(rawChallenge), [rawChallenge]);
  const ownerName = c?.ownerName || (c?.ownerId === 'me' ? 'You' : personById[c?.ownerId]?.name);

  if (!c) {
    return (
      <Screen header={<ScreenHeader title="Circle" />}>
        <QueryState
          status={load.status}
          error={load.error}
          hasData={false}
          onRetry={load.reload}
          skeletonRows={3}
          skeletonHeight={140}
          empty={{ title: 'Circle not found', body: 'It may have been closed or made private.', cta: 'Browse circles', onCta: () => nav.navigate('main', { screen: 'circles_home' }) }}
          style={{ marginTop: space.md }}
        />
      </Screen>
    );
  }

  const toggleJoin = () => {
    setActionError(null);
    const doIt = async (fn) => {
      setBusy(true);
      try {
        await fn(c.id);
        haptics.success();
      } catch (e) {
        setActionError(e?.message || 'Something went wrong. Try again.');
      } finally {
        setBusy(false);
      }
    };
    if (!joined) {
      doIt(joinCircle);
      return;
    }
    Alert.alert(`Leave ${c.name}?`, "You'll stop seeing circle-only plans. You can rejoin any time.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => doIt(leaveCircle) },
    ]);
  };

  const planForCircle = () => {
    resetDraft();
    updateDraft({ audience: 'circle', circleId: c.id });
    nav.navigate('create_activity_type');
  };

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="" right={<IconButton icon="more-horizontal" accessibilityLabel="Circle options" onPress={() => setMenu(true)} />} />}
    >
      {/* Hero */}
      <Animated.View entering={enter(0)} style={{ backgroundColor: circleAccent(c), borderRadius: radius.hero, padding: space.lg, overflow: 'hidden' }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -10, top: -6, opacity: 0.25, transform: [{ rotate: '-10deg' }] }}>
          <Pictogram name={c.pictogram} size={140} strokeWidth={1.2} />
        </View>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={c.pictogram} size={32} color={colors.white} />
        </View>
        <AppText variant="h1" style={{ marginTop: space.md }} accessibilityRole="header">
          {c.name}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.xs }}>
          <Tag label={`${c.members ?? 0} members`} icon="users" bg="rgba(255,255,255,0.6)" />
          {!!c.area && <Tag label={c.area} icon="map-pin" bg="rgba(255,255,255,0.6)" />}
          <Tag label={c.visibility === 'private' ? 'Private' : 'Public'} icon={c.visibility === 'private' ? 'lock' : 'globe'} bg="rgba(255,255,255,0.6)" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg }}>
          <AvatarStack seeds={c.memberSeeds || []} size={32} max={4} extra={Math.max(0, (c.members || 0) - (c.memberSeeds?.length || 0))} />
          <Button title={joined ? 'Joined' : 'Join circle'} icon={joined ? 'check' : 'plus'} variant={joined ? 'light' : 'primary'} size="sm" full={false} loading={busy} onPress={toggleJoin} />
        </View>
        {!!actionError && (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {actionError}
          </AppText>
        )}
        {c.visibility === 'private' && !joined && (
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
            Private circle — the owner approves new members.
          </AppText>
        )}
      </Animated.View>

      {/* About */}
      <SectionHeader title="About" />
      <Card>
        <AppText>{c.description || 'No description yet.'}</AppText>
      </Card>

      {!!c.rules?.length && (
        <>
          <SectionHeader title="Circle rules" />
          <Card>
            {c.rules.map((r, i) => (
              <View key={r} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: i ? space.sm : 0 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' }}>
                  <AppText variant="caption">{i + 1}</AppText>
                </View>
                <AppText style={{ flex: 1, marginLeft: space.sm }}>{r}</AppText>
              </View>
            ))}
            <View style={{ flexDirection: 'row', marginTop: space.md }}>
              <Icon name="shield" size={14} color={colors.muted} style={{ marginTop: 2 }} />
              <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: 6 }}>
                IRL community guidelines always apply on top of circle rules.
              </AppText>
            </View>
          </Card>
        </>
      )}

      {/* Challenge */}
      {challenge && (
        <>
          <SectionHeader title="Group challenge" />
          <QuestRow
            title={challenge.title}
            subtitle={[challenge.daysLeft != null ? `${challenge.daysLeft} days left` : null, challenge.rewardXp ? `+${challenge.rewardXp} XP each` : null].filter(Boolean).join(' · ') || challenge.subtitle}
            pictogram="star"
            progress={challenge.progress}
            total={challenge.goal}
            onPress={() => nav.navigate('circle_challenge', { id: c.id })}
          />
        </>
      )}

      {/* Plans */}
      <SectionHeader title="Upcoming plans" action={joined ? 'Plan something' : undefined} onAction={planForCircle} />
      {plans.length ? (
        <View style={{ gap: space.sm }}>
          {plans.map((a, i) => (
            <ActivityCard
              key={a.id}
              activity={a}
              index={i}
              variant="row"
              joinState={joinStates[a.id] === 'requested' ? 'requested' : ['accepted', 'checked_in'].includes(joinStates[a.id]) ? 'accepted' : 'idle'}
              onPress={() => nav.navigate('activity_detail', { id: a.id })}
            />
          ))}
        </View>
      ) : (
        <EmptyState compact title="Nothing scheduled" body={joined ? 'Be the one who gets the next meetup going.' : 'Join to see circle-only plans and start your own.'} cta={joined ? 'Create a circle plan' : undefined} onCta={planForCircle} />
      )}

      {/* Members */}
      <SectionHeader title="Members" action="See all" onAction={() => nav.navigate('circle_members', { id: c.id })} />
      <Card onPress={() => nav.navigate('circle_members', { id: c.id })} accessibilityLabel={`${c.members ?? 0} members. See all.`} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AvatarStack seeds={(c.memberSeeds || []).filter((m) => !blocked.includes(m))} size={36} max={5} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">{ownerName ? `${ownerName} runs this circle` : 'Circle members'}</AppText>
          <AppText variant="caption" color={colors.muted}>
            {c.members ?? 0} members · roles, report and block
          </AppText>
        </View>
        <Icon name="chevron-right" color={colors.muted} />
      </Card>

      <Sheet visible={menu} onClose={() => setMenu(false)} title={c.name}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
          {joined && <ListRow icon="calendar" title="Create a circle plan" onPress={() => { setMenu(false); planForCircle(); }} />}
          <ListRow icon="users" title="Members" onPress={() => { setMenu(false); nav.navigate('circle_members', { id: c.id }); }} />
          <ListRow icon="star" title="Group challenge" onPress={() => { setMenu(false); nav.navigate('circle_challenge', { id: c.id }); }} />
          {joined && !isOwner && <ListRow icon="log-out" title="Leave circle" onPress={() => { setMenu(false); toggleJoin(); }} />}
          <ListRow icon="flag" title="Report circle" danger onPress={() => { setMenu(false); nav.navigate('report_flow', { circleId: c.id, userId: c.ownerId && c.ownerId !== 'me' ? c.ownerId : undefined }); }} last />
        </View>
      </Sheet>
    </Screen>
  );
}
