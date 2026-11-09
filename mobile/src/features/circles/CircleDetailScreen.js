// circle_detail — who the circle is, its upcoming plans and a short list of
// "more" rows (members, challenge, rules). One primary action in the footer:
// Join (not a member) or Plan a meetup (member). Leave/Report live in ⋯.
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Icon, IconButton, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Sheet } from '@/components';
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
  const [rulesOpen, setRulesOpen] = useState(false);
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

  const run = async (fn) => {
    setActionError(null);
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

  const leave = () =>
    Alert.alert(`Leave ${c.name}?`, "You'll stop seeing circle-only plans. You can rejoin any time.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => run(leaveCircle) },
    ]);

  const planForCircle = () => {
    resetDraft();
    updateDraft({ audience: 'circle', circleId: c.id });
    nav.navigate('create_activity_type');
  };

  const fromMenu = (fn) => () => {
    setMenu(false);
    fn();
  };

  const isPrivate = c.visibility === 'private';
  const meta = [`${c.members ?? 0} members`, c.area, isPrivate ? 'Private' : 'Public'].filter(Boolean).join(' · ');
  const rules = c.rules || [];

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="Circle" right={<IconButton icon="more-horizontal" accessibilityLabel="Circle options" onPress={() => setMenu(true)} />} />}
      footer={
        <View>
          {!!actionError && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {actionError}
            </AppText>
          )}
          {joined ? (
            <Button title="Plan a meetup" icon="plus" onPress={planForCircle} />
          ) : (
            <Button title="Join circle" icon="plus" loading={busy} onPress={() => run(joinCircle)} />
          )}
        </View>
      }
    >
      {/* Identity: tile, name, one meta line, the description */}
      <Animated.View entering={enter(0)} style={{ backgroundColor: circleAccent(c), borderRadius: radius.hero, padding: space.lg, marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={c.pictogram} size={28} color={colors.white} duotoneColor={colors.periwinkle} duotoneOpacity={0.9} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h2" accessibilityRole="header" numberOfLines={2}>
              {c.name}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              {isPrivate && <Icon name="lock" size={12} color={colors.inkSoft} style={{ marginRight: space.xxs }} />}
              <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ flexShrink: 1 }}>
                {meta}
              </AppText>
            </View>
          </View>
          {joined ? (
            <View accessible accessibilityLabel="You're a member" style={{ flexDirection: 'row', alignItems: 'center', marginLeft: space.xs }}>
              <Icon name="check-circle" size={16} color={colors.ink} weight="fill" />
              <AppText variant="label" style={{ marginLeft: space.xxs }}>
                Joined
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText color={c.description ? colors.ink : colors.inkSoft} style={{ marginTop: space.md }}>
          {c.description || 'No description yet.'}
        </AppText>
        {isPrivate && !joined && (
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
            The owner approves new members.
          </AppText>
        )}
      </Animated.View>

      {/* Upcoming plans */}
      <SectionHeader title="Upcoming plans" />
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
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, flexDirection: 'row', alignItems: 'center', minHeight: 64 }}>
          <Icon name="calendar" size={20} color={colors.muted} />
          <AppText color={colors.muted} style={{ flex: 1, marginLeft: space.sm }}>
            {joined ? 'Nothing scheduled. Plan the next one.' : 'Join to see circle-only plans.'}
          </AppText>
        </View>
      )}

      {/* More: members, challenge, rules (details live one tap away) */}
      <SectionHeader title="About this circle" />
      <ListGroup>
        <ListRow
          icon="users"
          title="Members"
          subtitle={ownerName ? `Run by ${ownerName}` : undefined}
          value={String(c.members ?? 0)}
          onPress={() => nav.navigate('circle_members', { id: c.id })}
          last={!challenge && !rules.length}
        />
        {challenge ? (
          <ListRow
            icon="target"
            title="Group challenge"
            subtitle={challenge.title}
            value={`${challenge.progress}/${challenge.goal}`}
            onPress={() => nav.navigate('circle_challenge', { id: c.id })}
            last={!rules.length}
          />
        ) : null}
        {rules.length ? <ListRow icon="list" title="Circle rules" value={String(rules.length)} onPress={() => setRulesOpen(true)} last /> : null}
      </ListGroup>

      <Sheet visible={menu} onClose={() => setMenu(false)} title={c.name}>
        <ListGroup>
          {joined && !isOwner && <ListRow icon="log-out" title="Leave circle" onPress={fromMenu(leave)} />}
          <ListRow
            icon="flag"
            title="Report circle"
            danger
            onPress={fromMenu(() => nav.navigate('report_flow', { circleId: c.id, userId: c.ownerId && c.ownerId !== 'me' ? c.ownerId : undefined }))}
            last
          />
        </ListGroup>
      </Sheet>

      <Sheet visible={rulesOpen} onClose={() => setRulesOpen(false)} title="Circle rules">
        <ListGroup>
          {rules.map((r, i) => (
            <View key={`${r}${i}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space.sm, borderBottomWidth: i === rules.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' }}>
                <AppText variant="label" maxScale={1.1}>
                  {i + 1}
                </AppText>
              </View>
              <AppText style={{ flex: 1, marginLeft: space.sm }}>{r}</AppText>
            </View>
          ))}
        </ListGroup>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
          Come Over community guidelines apply too.
        </AppText>
      </Sheet>
    </Screen>
  );
}
