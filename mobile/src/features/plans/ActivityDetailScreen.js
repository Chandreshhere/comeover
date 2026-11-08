// activity_detail — plan details, host, venue area, audience, join rules, safety.
// Data: GET /activities/{id} on focus. The exact venue is revealed server-side
// only to accepted participants and the host (venueName is null otherwise).
import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  AppText,
  Avatar,
  AvatarStack,
  Button,
  Card,
  HeroCard,
  Icon,
  IconButton,
  ListRow,
  Pictogram,
  ProgressRing,
  Screen,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Skeleton,
  Tag,
} from '@/components';
import { categoryBySlug, personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useQuickJoin from '@/hooks/useQuickJoin';
import { accents, colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { coarseDistance, durationLabel, timeLabel, whenLabel } from '@/utils/format';
import { endsAt, hasStarted, inCheckinWindow, isEnded, isFull } from '@/features/discover/utils';
import usePlan, { openGroupChat } from './usePlan';
import { handleJoinError } from './joinActions';
import PlanGate from './components/PlanGate';

const pct = (r) => (r == null ? null : `${Math.round(r * 100)}%`);

function InfoRow({ icon, title, subtitle, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }} accessible accessibilityLabel={`${title}. ${subtitle || ''}`}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} />
      </View>
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {!!subtitle && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        )}
      </View>
    </View>
  );
}

// Host-only: pending join requests with accept / decline.
function JoinRequests({ activityId, full }) {
  const loadJoinRequests = useAppStore((s) => s.loadJoinRequests);
  const decideJoinRequest = useAppStore((s) => s.decideJoinRequest);
  const users = useAppStore((s) => s.users);
  const status = useAppStore((s) => s.status[`joinRequests:${activityId}`] || 'idle');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [deciding, setDeciding] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await loadJoinRequests(activityId);
      setItems((list || []).filter((r) => !r.state || r.state === 'requested' || r.state === 'pending'));
    } catch (e) {
      setError(e?.message || 'Couldn’t load requests');
    }
  }, [activityId, loadJoinRequests]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const decide = async (r, accept) => {
    setDeciding(r.id + (accept ? ':a' : ':d'));
    try {
      await decideJoinRequest(activityId, r.id, accept);
      setItems((list) => (list || []).filter((x) => x.id !== r.id));
    } catch (e) {
      Alert.alert(accept ? 'Couldn’t accept' : 'Couldn’t decline', e?.code === 'capacity_full' ? 'The plan is already full.' : e?.message || 'Please try again.');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <>
      <SectionHeader title={`Join requests${items?.length ? ` · ${items.length}` : ''}`} action={error ? 'Retry' : undefined} onAction={load} />
      {items === null && status !== 'error' ? (
        <Skeleton height={72} r={radius.card} />
      ) : error && !items ? (
        <Card>
          <AppText variant="caption" color={colors.danger}>
            {error}
          </AppText>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <AppText variant="caption" color={colors.muted}>
            No pending requests. You’ll get a notification when someone asks to join.
          </AppText>
        </Card>
      ) : (
        <View style={{ gap: space.xs }}>
          {items.map((r) => {
            const u = r.user || users[r.userId] || {};
            const name = u.name || 'Member';
            return (
              <Card key={r.id} accessibilityLabel={`${name} wants to join`}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar seed={u.id || r.userId || r.id} uri={u.avatarUrl} size={44} />
                  <View style={{ flex: 1, marginLeft: space.sm }}>
                    <AppText variant="bodyStrong">
                      {name} {u.level ? <AppText variant="caption" color={colors.muted}>· Lvl {u.level}</AppText> : null}
                    </AppText>
                    <AppText variant="caption" color={colors.inkSoft}>
                      {[pct(u.reliability) && `${pct(u.reliability)} show-up`, u.completed != null && `${u.completed} meetups`].filter(Boolean).join(' · ') || 'New member'}
                    </AppText>
                  </View>
                </View>
                {!!r.intro && (
                  <AppText variant="caption" color={colors.ink} style={{ marginTop: space.xs, backgroundColor: colors.surfaceSubtle, borderRadius: radius.sm, padding: space.xs }}>
                    “{r.intro}”
                  </AppText>
                )}
                <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}>
                  <Button title="Accept" size="sm" icon="check" full={false} disabled={full || !!deciding} loading={deciding === `${r.id}:a`} onPress={() => decide(r, true)} />
                  <Button title="Decline" size="sm" variant="secondary" full={false} disabled={!!deciding} loading={deciding === `${r.id}:d`} onPress={() => decide(r, false)} />
                </View>
              </Card>
            );
          })}
          {full && (
            <AppText variant="caption" color={colors.muted}>
              The plan is full — raise capacity or wait for someone to leave before accepting more.
            </AppText>
          )}
        </View>
      )}
    </>
  );
}

export default function ActivityDetailScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, isHost, loader } = usePlan();
  const cancelJoin = useAppStore((s) => s.cancelJoin);
  const requestJoin = useAppStore((s) => s.requestJoin);
  const cancelHostedActivity = useAppStore((s) => s.cancelHostedActivity);
  const ageConfirmed = useAppStore((s) => s.session.ageConfirmed);
  const hasFeedback = useAppStore((s) => !!s.feedback[id]);
  const quickJoin = useQuickJoin();

  const [menu, setMenu] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  if (!a) return <PlanGate title="Plan" loader={loader} />;

  const accent = accents[(a.accentIndex ?? 0) % accents.length];
  const cat = categoryBySlug[a.category];
  const inGroup = ['accepted', 'checked_in', 'completed'].includes(joinState);
  const reveal = isHost || inGroup;
  const full = isFull(a);
  const ended = isEnded(a);
  const started = hasStarted(a);
  const cancelled = a.status === 'cancelled';
  const participants = a.participants || [];
  const others = participants.filter((p) => p !== a.host?.id);
  const hostRel = pct(a.host?.reliability);

  const goChat = () => openGroupChat(nav, a);

  const withdraw = async () => {
    setBusy(true);
    try {
      await cancelJoin(id);
    } catch (e) {
      Alert.alert('Couldn’t update', e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Try again.' : e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const startJoin = async () => {
    if (!ageConfirmed) return nav.navigate('age_gate', { returnTo: { screen: 'activity_detail', params: { id } } });
    if (a.joinRule === 'approval' && !full) return nav.navigate('join_request', { id });
    setBusy(true);
    try {
      const r = full ? await requestJoin(id) : await quickJoin(a);
      if (r === 'accepted') nav.navigate('join_accepted', { id });
      else if (r === 'requested') nav.navigate('join_pending', { id });
      else if (r === 'waitlisted') nav.navigate('waitlist', { id });
    } catch (e) {
      handleJoinError(e, nav, id);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const doCancelPlan = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelHostedActivity(a.id);
      setConfirmCancel(false);
      nav.goBack();
    } catch (e) {
      setCancelError(e?.message || 'Couldn’t cancel. Try again.');
    } finally {
      setCancelling(false);
    }
  };

  let footer;
  if (cancelled) {
    footer = <Button title="Find a similar plan" variant="secondary" onPress={() => nav.navigate('category_results', { category: a.category })} />;
  } else if (isHost) {
    footer = (
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Button title="Group chat" icon="message-circle" onPress={goChat} style={{ flex: 1 }} />
        {!ended && <Button title="Cancel" variant="secondary" full={false} onPress={() => setConfirmCancel(true)} />}
        {ended && <Button title="Confirm" variant="secondary" full={false} onPress={() => nav.navigate('activity_complete', { id })} />}
      </View>
    );
  } else if (joinState === 'completed') {
    footer = hasFeedback ? (
      <Button title="Thanks for your feedback" variant="secondary" icon="check" disabled />
    ) : (
      <Button title="Leave private feedback" onPress={() => nav.navigate('post_activity_feedback', { id })} />
    );
  } else if (joinState === 'accepted' || joinState === 'checked_in') {
    const canCheckIn = joinState === 'accepted' && inCheckinWindow(a);
    footer = (
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Button title="Group chat" icon="message-circle" onPress={goChat} style={{ flex: 1 }} />
        {canCheckIn && <Button title="Check in" icon="map-pin" variant="periwinkle" full={false} onPress={() => nav.navigate('activity_checkin', { id })} />}
        {!canCheckIn && started && <Button title="It happened" variant="periwinkle" full={false} onPress={() => nav.navigate('activity_complete', { id })} />}
      </View>
    );
  } else if (joinState === 'requested') {
    footer = (
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Button title="Request sent" icon="clock" variant="secondary" onPress={() => nav.navigate('join_pending', { id })} style={{ flex: 1 }} />
        <Button title="Withdraw" variant="ghost" full={false} loading={busy} onPress={withdraw} />
      </View>
    );
  } else if (joinState === 'waitlisted') {
    footer = <Button title="You're on the waitlist" icon="list" variant="secondary" onPress={() => nav.navigate('waitlist', { id })} />;
  } else if (ended) {
    footer = <Button title="This plan has ended" variant="secondary" disabled />;
  } else {
    footer = (
      <Button
        title={full ? 'Join the waitlist' : a.joinRule === 'approval' ? 'Request to join' : 'Join now'}
        icon={full ? 'list' : a.joinRule === 'approval' ? 'send' : 'user-plus'}
        loading={busy}
        onPress={startJoin}
      />
    );
  }

  const venueTitle = reveal && a.venueName ? a.venueName : `${a.area || 'Nearby'}${a.distanceM != null ? ` · ~${coarseDistance(a.distanceM)}` : ''}`;
  const venueSub = reveal
    ? a.venueName
      ? `${a.venueType || 'Public place'} · ${a.area || ''}`
      : 'Exact spot is shared in the group chat.'
    : `${a.venueType || 'Public place'}. Exact spot shared after you're accepted.`;

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title={cat?.label || 'Plan'} right={<IconButton icon="more-horizontal" accessibilityLabel="More actions" onPress={() => setMenu(true)} />} />}
      footer={footer}
    >
      {loader.status === 'error' && (
        <View style={{ backgroundColor: colors.orangeSoft, borderRadius: radius.quest, padding: space.sm, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="wifi-off" size={16} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: 6 }}>
            Showing saved details — couldn’t refresh.
          </AppText>
          <AppText variant="label" color={colors.deep} onPress={loader.reload} accessibilityRole="button">
            Retry
          </AppText>
        </View>
      )}
      {cancelled && (
        <View style={{ backgroundColor: colors.danger, borderRadius: radius.quest, padding: space.sm, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="x-circle" size={16} color={colors.white} />
          <AppText variant="label" color={colors.white} style={{ marginLeft: 6 }}>
            This plan was cancelled
          </AppText>
        </View>
      )}

      {/* Hero */}
      <Animated.View entering={enter(0)}>
        <HeroCard bg={accent.bg}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -6, bottom: -6, opacity: 0.25, transform: [{ rotate: '-14deg' }] }}>
            <Pictogram name={a.pictogram} size={130} strokeWidth={1.2} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={a.pictogram} size={32} color={colors.white} />
            </View>
            <ProgressRing value={a.capacity ? a.joinedCount / a.capacity : 0} size={52} label={`${a.joinedCount}/${a.capacity}`} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md }}>
            {a.live && !ended && <Tag label="Live now" icon="radio" bg={colors.ink} fg={colors.white} />}
            {!!a.venueType && <Tag label={a.venueType} icon="shield" bg="rgba(255,255,255,0.6)" />}
            {a.sponsored && <Tag label="Sponsored · partner venue" bg={colors.white} />}
            {full && !inGroup && <Tag label="Full" bg={colors.white} />}
          </View>
          <AppText variant="h1" style={{ marginTop: space.xs }}>
            {a.title}
          </AppText>
          <AppText variant="label" color={colors.inkSoft} style={{ marginTop: 4 }}>
            {whenLabel(a.startsAt)} · {durationLabel(a.durationMin)}
          </AppText>
        </HeroCard>
      </Animated.View>

      {/* Key info */}
      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.md, paddingVertical: 4 }}>
          <InfoRow icon="clock" title={`${timeLabel(a.startsAt)} – ${timeLabel(endsAt(a))}`} subtitle={`${whenLabel(a.startsAt)} · ${durationLabel(a.durationMin)}`} />
          <InfoRow icon="map-pin" title={venueTitle} subtitle={venueSub} />
          <InfoRow
            icon="users"
            title={`${a.joinedCount} of ${a.capacity} going`}
            subtitle={a.joinRule === 'approval' ? 'Host approves each request' : 'Instant join — host can still remove people'}
          />
          <InfoRow icon="tag" title={a.cost || 'Free'} subtitle="Cost expectation set by the host. Settle up with SplitMate after." last={!a.accessibility} />
          {!!a.accessibility && <InfoRow icon="navigation" title="Accessibility" subtitle={a.accessibility} last />}
        </Card>
      </Animated.View>

      {/* Host */}
      <SectionHeader title="Host" />
      <Card style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Hosted by ${a.host?.name || 'a member'}${hostRel ? `, ${hostRel} show-up` : ''}`}>
        <Avatar seed={a.host?.id || a.id} uri={a.host?.avatarUrl} size={52} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">
            {isHost ? 'You' : a.host?.name || 'Host'} <AppText variant="caption" color={colors.muted}>· Level {a.host?.level ?? 1}</AppText>
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Icon name="check-circle" size={13} color={colors.success} />
            <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
              {[hostRel && `${hostRel} show-up`, `${a.host?.completed ?? 0} meetups`].filter(Boolean).join(' · ')}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.muted}>
            Phone verified
          </AppText>
        </View>
      </Card>

      {/* Host tools */}
      {isHost && !cancelled && !ended && a.joinRule === 'approval' && <JoinRequests activityId={a.id} full={full} />}

      {/* About */}
      {!!a.description && (
        <>
          <SectionHeader title="About this plan" />
          <Card>
            <AppText>{a.description}</AppText>
            {a.tags?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
                {a.tags.map((t) => (
                  <Tag key={t} label={`#${t}`} />
                ))}
              </View>
            ) : null}
          </Card>
        </>
      )}

      {/* Who's going */}
      <SectionHeader title="Who's going" />
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AvatarStack seeds={participants.length ? participants : [a.host?.id].filter(Boolean)} size={36} max={5} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }} numberOfLines={2}>
          {[a.host?.id, ...others]
            .filter(Boolean)
            .map((pid) => (pid === 'me' ? 'You' : pid === a.host?.id ? a.host?.name : personById[pid]?.name))
            .filter(Boolean)
            .join(', ') || `${a.joinedCount} going`}
        </AppText>
      </Card>

      {/* Safety */}
      <Card bg={colors.periwinkleWash} elevated={false} style={{ marginTop: space.xl }} onPress={() => nav.navigate('safety_center')} accessibilityLabel="Safety tips. Open safety center.">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pictogram name="shield" size={26} color={colors.deep} />
          <AppText variant="bodyStrong" style={{ marginLeft: space.xs, flex: 1 }}>
            Meet in public, on your terms
          </AppText>
          <Icon name="chevron-right" size={18} color={colors.muted} />
        </View>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
          {a.venueType ? `${a.venueType} · ` : ''}Share the plan with someone you trust, leave whenever you want, and report or block from the ••• menu.
        </AppText>
      </Card>

      {/* Overflow */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Plan options">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
          <ListRow icon="share-2" title="Share with a trusted contact" subtitle="Time, area and host — not other people's details" onPress={() => { setMenu(false); nav.navigate('emergency_share', { activityId: a.id }); }} />
          {(inGroup || isHost) && <ListRow icon="divide-circle" title="Split expenses" subtitle="SplitMate ledger + UPI handoff" onPress={() => { setMenu(false); nav.navigate('split_create', { activityId: a.id }); }} />}
          <ListRow icon="list" title="My plans" onPress={() => { setMenu(false); nav.navigate('my_activities'); }} />
          {!isHost && <ListRow icon="flag" title="Report this plan" danger onPress={() => { setMenu(false); nav.navigate('report_flow', { activityId: a.id, userId: a.host?.id }); }} />}
          {!isHost && a.host?.id && <ListRow icon="slash" title={`Block ${a.host.name || 'host'}`} danger onPress={() => { setMenu(false); nav.navigate('block_confirm', { userId: a.host.id }); }} />}
          {isHost && !cancelled && !ended && <ListRow icon="x-circle" title="Cancel plan" danger onPress={() => { setMenu(false); setConfirmCancel(true); }} />}
          {joinState === 'accepted' && !started && (
            <ListRow
              icon="log-out"
              title="Leave this plan"
              danger
              onPress={() => {
                setMenu(false);
                withdraw();
              }}
              last
            />
          )}
        </View>
      </Sheet>

      <Sheet
        visible={confirmCancel}
        onClose={() => !cancelling && setConfirmCancel(false)}
        title="Cancel this plan?"
        footer={
          <View style={{ gap: space.xs }}>
            <Button title="Cancel plan" variant="danger" loading={cancelling} onPress={doCancelPlan} />
            <Button title="Keep it" variant="ghost" disabled={cancelling} onPress={() => setConfirmCancel(false)} />
          </View>
        }
      >
        <AppText color={colors.inkSoft}>
          Everyone who joined gets notified. Cancelling well before the start doesn't affect your reliability; repeated last-minute cancellations do.
        </AppText>
        {!!cancelError && (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }}>
            {cancelError}
          </AppText>
        )}
      </Sheet>
    </Screen>
  );
}
