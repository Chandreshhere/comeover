// activity_detail — what, when, where, who, then one clear action.
// Data: GET /activities/{id} on focus. The exact venue is revealed server-side
// only to accepted participants and the host (venueName is null otherwise).
// Rules, accessibility and safety notes sit in one collapsed card at the
// bottom; share / split / report / block / leave / cancel live in the ••• menu.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { CalendarCheck } from 'phosphor-react-native/src/icons/CalendarCheck';
import { Coins } from 'phosphor-react-native/src/icons/Coins';
import { SealCheck } from 'phosphor-react-native/src/icons/SealCheck';
import { Wheelchair } from 'phosphor-react-native/src/icons/Wheelchair';
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
import { IconBubble } from '@/components/Card';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { coarseDistance, durationLabel, relativeDay, timeLabel, whenLabel } from '@/utils/format';
import { endsAt, hasStarted, inCheckinWindow, isEnded, isFull } from '@/features/discover/utils';
import usePlan, { openGroupChat } from './usePlan';
import { handleJoinError } from './joinActions';
import PlanGate from './components/PlanGate';
import Disclosure, { FactLine } from './components/Disclosure';

const pct = (r) => (r == null ? null : `${Math.round(r * 100)}%`);

// Key-fact row: pastel squircle + title/subtitle, vertically centred.
function InfoRow({ icon, glyph, title, subtitle, last }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 64, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}
      accessible
      accessibilityLabel={`${title}. ${subtitle || ''}`}
    >
      <IconBubble size={40} shape="squircle" tone="periwinkle" icon={icon} glyph={glyph} iconSize={22} />
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

// Host-only: pending join requests, one aligned row each with decline / accept.
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
    if (deciding || (accept && full)) return;
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

  let body;
  if (items === null && status !== 'error' && !error) {
    body = <Skeleton height={72} r={radius.card} />;
  } else if (error && !items) {
    body = (
      <Card>
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      </Card>
    );
  } else if (!items?.length) {
    body = (
      <Card>
        <AppText variant="caption" color={colors.muted}>
          No requests yet. We’ll notify you when someone asks.
        </AppText>
      </Card>
    );
  } else {
    body = (
      <Card padding={0} style={{ paddingHorizontal: space.md }}>
        {items.map((r, i) => {
          const u = r.user || users[r.userId] || {};
          const name = u.name || 'Member';
          const stats = [pct(u.reliability) && `${pct(u.reliability)} show-up`, u.completed != null && `${u.completed} meetups`].filter(Boolean).join(' · ') || 'New member';
          const accepting = deciding === `${r.id}:a`;
          const declining = deciding === `${r.id}:d`;
          return (
            <View key={r.id} style={{ paddingVertical: space.sm, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: layout.minTouch }}>
                <Avatar seed={u.id || r.userId || r.id} uri={u.avatarUrl} size={40} />
                <View style={{ flex: 1, marginLeft: space.sm }} accessible accessibilityLabel={`${name} wants to join. ${stats}`}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                    {stats}
                  </AppText>
                </View>
                <IconButton icon="x" accessibilityLabel={`Decline ${name}`} onPress={() => decide(r, false)} style={{ marginLeft: space.xs, opacity: deciding && !declining ? 0.4 : 1 }}>
                  {declining ? <ActivityIndicator color={colors.ink} /> : null}
                </IconButton>
                <IconButton icon="check" variant="ink" accessibilityLabel={`Accept ${name}`} onPress={() => decide(r, true)} style={{ marginLeft: space.xs, opacity: full || (deciding && !accepting) ? 0.4 : 1 }}>
                  {accepting ? <ActivityIndicator color={colors.white} /> : null}
                </IconButton>
              </View>
              {!!r.intro && (
                <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs, marginLeft: 40 + space.sm }}>
                  “{r.intro}”
                </AppText>
              )}
            </View>
          );
        })}
      </Card>
    );
  }

  return (
    <>
      <SectionHeader title={`Requests${items?.length ? ` · ${items.length}` : ''}`} action={error ? 'Retry' : undefined} onAction={load} />
      {body}
      {full && !!items?.length && (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
          The plan is full. Raise capacity or wait for a spot to open.
        </AppText>
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
  const approval = a.joinRule === 'approval';
  const participants = a.participants || [];
  const others = participants.filter((p) => p !== a.host?.id);
  const hostRel = pct(a.host?.reliability);
  const hostName = isHost ? 'You' : a.host?.name || 'Host';

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
    if (approval && !full) return nav.navigate('join_request', { id });
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

  // Footer: exactly one main action for the current state. When that action
  // isn't the chat, the chat stays one tap away as a round icon button.
  const withChat = (btn) => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconButton icon="message-circle" size={layout.buttonHeight} iconSize={22} accessibilityLabel="Open group chat" onPress={goChat} style={{ marginRight: space.xs }} />
      <View style={{ flex: 1 }}>{btn}</View>
    </View>
  );
  const wrapUp = <Button title="Wrap up" icon="check" onPress={() => nav.navigate('activity_complete', { id })} />;
  const chatCta = <Button title="Group chat" icon="message-circle" onPress={goChat} />;

  let footer;
  if (cancelled) {
    footer = <Button title="Find a similar plan" onPress={() => nav.navigate('category_results', { category: a.category })} />;
  } else if (isHost) {
    footer = ended ? withChat(wrapUp) : chatCta;
  } else if (joinState === 'completed') {
    footer = hasFeedback ? (
      <Button title="Thanks for your feedback" variant="secondary" icon="check" disabled />
    ) : (
      <Button title="Leave private feedback" icon="lock" onPress={() => nav.navigate('post_activity_feedback', { id })} />
    );
  } else if (joinState === 'accepted' || joinState === 'checked_in') {
    const canCheckIn = joinState === 'accepted' && inCheckinWindow(a);
    if (canCheckIn) footer = withChat(<Button title="Check in" icon="gps" onPress={() => nav.navigate('activity_checkin', { id })} />);
    else if (started) footer = withChat(wrapUp);
    else footer = chatCta;
  } else if (joinState === 'requested') {
    footer = <Button title="Request sent · View" icon="clock" variant="secondary" loading={busy} onPress={() => nav.navigate('join_pending', { id })} />;
  } else if (joinState === 'waitlisted') {
    footer = <Button title="You're on the waitlist" icon="list" variant="secondary" onPress={() => nav.navigate('waitlist', { id })} />;
  } else if (ended) {
    footer = <Button title="This plan has ended" variant="secondary" disabled />;
  } else {
    footer = <Button title={full ? 'Join the waitlist' : approval ? 'Request to join' : 'Join now'} icon={full ? 'list' : approval ? 'send' : 'user-plus'} loading={busy} onPress={startJoin} />;
  }

  // When: absolute time up top, relative hint ("Starts in 12 min") underneath.
  const rel = whenLabel(a.startsAt);
  const relHint = rel.includes('·') ? null : rel.startsWith('in ') ? `Starts ${rel}` : rel;
  const whenTitle = `${relativeDay(a.startsAt)} · ${timeLabel(a.startsAt)} – ${timeLabel(endsAt(a))}`;
  const whenSub = [relHint, durationLabel(a.durationMin)].filter(Boolean).join(' · ');

  // Where: area only until accepted; the exact venue after.
  const venueTitle = reveal && a.venueName ? a.venueName : `${a.area || 'Nearby'}${a.distanceM != null ? ` · ~${coarseDistance(a.distanceM)}` : ''}`;
  const venueSub = reveal
    ? a.venueName
      ? [a.venueType || 'Public place', a.area].filter(Boolean).join(' · ')
      : 'Exact spot is in the group chat'
    : `${a.venueType || 'Public place'} · exact spot once you’re accepted`;

  const freeCost = !a.cost || /^free$/i.test(a.cost);

  const status = cancelled ? null : a.live && !ended ? { label: 'Live now', icon: 'radio', bg: colors.ink, fg: colors.white } : full && !inGroup && !isHost ? { label: 'Full', bg: colors.surface } : ended ? { label: 'Ended', bg: colors.surface } : null;

  const knownNames = others.map((pid) => (pid === 'me' ? 'You' : personById[pid]?.name)).filter(Boolean);
  const unnamed = others.length - knownNames.length;
  const goingLine = others.length
    ? knownNames.length
      ? `${knownNames.join(', ')}${unnamed ? ` +${unnamed}` : ''}`
      : `${others.length} going`
    : isHost || inGroup
      ? 'No one else yet'
      : 'Be the first to join';

  // ••• menu: rows built as a list so the last one never draws a divider.
  const close = (fn) => () => {
    setMenu(false);
    fn();
  };
  const menuRows = [
    { key: 'share', icon: 'share-2', title: 'Share with a trusted contact', subtitle: 'Time, area and host only', onPress: close(() => nav.navigate('emergency_share', { activityId: a.id })) },
    (inGroup || isHost) && { key: 'split', icon: 'divide-circle', title: 'Split expenses', onPress: close(() => nav.navigate('split_create', { activityId: a.id })) },
    { key: 'mine', icon: 'list', title: 'My plans', onPress: close(() => nav.navigate('my_activities')) },
    joinState === 'requested' && { key: 'withdraw', icon: 'log-out', title: 'Withdraw request', danger: true, onPress: close(withdraw) },
    joinState === 'accepted' && !started && { key: 'leave', icon: 'log-out', title: 'Leave this plan', danger: true, onPress: close(withdraw) },
    isHost && !cancelled && !ended && { key: 'cancel', icon: 'x-circle', title: 'Cancel plan', danger: true, onPress: close(() => setConfirmCancel(true)) },
    !isHost && { key: 'report', icon: 'flag', title: 'Report this plan', danger: true, onPress: close(() => nav.navigate('report_flow', { activityId: a.id, userId: a.host?.id })) },
    !isHost && a.host?.id && { key: 'block', icon: 'slash', title: `Block ${a.host.name || 'host'}`, danger: true, onPress: close(() => nav.navigate('block_confirm', { userId: a.host.id })) },
  ].filter(Boolean);

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title={cat?.label || 'Plan'} right={<IconButton icon="more-horizontal" accessibilityLabel="More actions" onPress={() => setMenu(true)} />} />}
      footer={footer}
    >
      {loader.status === 'error' && (
        <View style={{ backgroundColor: colors.orangeSoft, borderRadius: radius.quest, minHeight: layout.minTouch, paddingLeft: space.sm, paddingRight: space.xs, marginTop: space.xs, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="wifi-off" size={16} />
          <AppText variant="caption" style={{ flex: 1, marginHorizontal: space.xs }}>
            Showing saved details. Couldn’t refresh.
          </AppText>
          <Pressable onPress={loader.reload} accessibilityRole="button" accessibilityLabel="Retry loading the plan" hitSlop={6} style={{ minHeight: layout.minTouch, paddingHorizontal: space.xs, justifyContent: 'center' }}>
            <AppText variant="label" color={colors.deep}>
              Retry
            </AppText>
          </Pressable>
        </View>
      )}
      {cancelled && (
        <View style={{ backgroundColor: colors.danger, borderRadius: radius.quest, minHeight: layout.minTouch, paddingHorizontal: space.sm, marginTop: space.xs, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="x-circle" size={16} color={colors.pureWhite} />
          <AppText variant="label" color={colors.pureWhite} style={{ marginLeft: space.xs, flex: 1 }}>
            This plan was cancelled
          </AppText>
        </View>
      )}

      {/* What */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
        <HeroCard bg={accent.bg} style={{ padding: space.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <IconBubble size={56} tone="surface" pictogram={a.pictogram} iconSize={30} duo={accent.bg} />
            {!!status && <Tag label={status.label} icon={status.icon} bg={status.bg} fg={status.fg || colors.ink} />}
          </View>
          <AppText variant="h1" style={{ marginTop: space.md }} accessibilityRole="header">
            {a.title}
          </AppText>
          {a.sponsored && (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
              Sponsored · partner venue
            </AppText>
          )}
        </HeroCard>
      </Animated.View>

      {/* When · where · cost */}
      <Animated.View entering={enter(1)}>
        <Card padding={0} style={{ marginTop: space.md, paddingHorizontal: space.md }}>
          <InfoRow glyph={CalendarCheck} title={whenTitle} subtitle={whenSub} />
          <InfoRow icon="map-pin" title={venueTitle} subtitle={venueSub} />
          <InfoRow glyph={Coins} title={freeCost ? 'Free' : a.cost} subtitle={freeCost ? null : 'Settle up after with SplitMate'} last />
        </Card>
      </Animated.View>

      {/* Host tools */}
      {isHost && !cancelled && !ended && approval && <JoinRequests activityId={a.id} full={full} />}

      {/* Who */}
      <SectionHeader title="Who's going" right={<AppText variant="label" color={colors.muted}>{`${a.joinedCount} of ${a.capacity}`}</AppText>} />
      <Card padding={0} style={{ paddingHorizontal: space.md }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
          accessible
          accessibilityLabel={`Hosted by ${isHost ? 'you' : a.host?.name || 'a member'}. Phone verified${hostRel ? `, ${hostRel} show-up` : ''}`}
        >
          <Avatar seed={a.host?.id || a.id} uri={a.host?.avatarUrl} size={40} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {hostName}
              </AppText>
              <Tag label="Host" bg={colors.periwinkleWash} fg={colors.deep} style={{ marginLeft: space.xs }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <SealCheck size={13} color={colors.success} weight="fill" />
              <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xxs, flexShrink: 1 }} numberOfLines={1}>
                {['Verified', hostRel && `${hostRel} show-up`, a.host?.completed ? `${a.host.completed} meetups` : null].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm }} accessible accessibilityLabel={`${a.joinedCount} of ${a.capacity} going. ${goingLine}`}>
          {others.length ? (
            <AvatarStack seeds={others} size={32} max={4} />
          ) : (
            <IconBubble size={40} shape="squircle" tone="periwinkle" icon="users" iconSize={22} />
          )}
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }} numberOfLines={2}>
            {goingLine}
          </AppText>
        </View>
      </Card>

      {/* About */}
      {!!a.description && (
        <>
          <SectionHeader title="About" />
          <Card>
            <AppText>{a.description}</AppText>
            {a.tags?.length ? (
              <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
                {a.tags.map((t) => `#${t}`).join('   ')}
              </AppText>
            ) : null}
          </Card>
        </>
      )}

      {/* Fine print, collapsed */}
      <Disclosure
        icon="shield"
        title="Rules & safety"
        subtitle={[approval ? 'Host approves requests' : 'Instant join', a.accessibility ? 'Accessibility' : null, 'Safety tips'].filter(Boolean).join(' · ')}
        style={{ marginTop: space.xl }}
      >
        <FactLine
          icon={approval ? 'user-check' : 'zap'}
          title={approval ? 'Host approves each request' : 'Instant join'}
          text={approval ? 'The host sees your name, level and show-up rate.' : 'The host can still remove people.'}
        />
        {!!a.accessibility && <FactLine glyph={Wheelchair} title="Accessibility" text={a.accessibility} />}
        <FactLine icon="shield" title="Meet on your terms" text="Tell someone you trust, leave whenever you like, and report or block from the ••• menu." />
        <Pressable
          onPress={() => nav.navigate('safety_center')}
          accessibilityRole="button"
          accessibilityLabel="Open safety center"
          style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: layout.minTouch, marginLeft: 24 + space.sm }}
        >
          <AppText variant="label" color={colors.deep}>
            Safety center
          </AppText>
          <Icon name="chevron-right" size={14} color={colors.deep} style={{ marginLeft: space.xxs }} />
        </Pressable>
      </Disclosure>

      {/* Overflow */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Plan options">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
          {menuRows.map((r, i) => (
            <ListRow key={r.key} icon={r.icon} title={r.title} subtitle={r.subtitle} danger={r.danger} onPress={r.onPress} last={i === menuRows.length - 1} />
          ))}
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
        <AppText color={colors.inkSoft}>Everyone who joined gets notified. Cancelling early doesn’t affect your reliability; last-minute cancellations do.</AppText>
        {!!cancelError && (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }}>
            {cancelError}
          </AppText>
        )}
      </Sheet>
    </Screen>
  );
}
