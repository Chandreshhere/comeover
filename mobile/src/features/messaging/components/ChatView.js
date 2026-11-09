// Shared chat surface for chat_thread (direct) and group_chat (activity group).
// Chat only exists after an accepted join; moderation is always one tap away.
// Messages: GET /conversations/{id}/messages + realtime `message.created`.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, Icon, IconButton, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, Sheet } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { accents, colors, fonts, isDark, layout, onInkAlpha, radius, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';
import { timeLabel, whenLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import IconBubble from '@/features/system/IconBubble';
import { nameOf, otherMember, personOf } from '../chatUtils';

// "Mine" bubbles: ink in light mode; in dark mode a soft periwinkle bubble
// with dark text, so it never blends into the grey "theirs" bubbles or reads
// as a near-white slab. Read at render time.
const mineTheme = () =>
  isDark() ? { bg: colors.deep, fg: colors.white, sub: onInkAlpha(0.62) } : { bg: colors.ink, fg: colors.white, sub: onInkAlpha(0.62) };

function Bubble({ m, mine, showName, group, sender, avatarUrl, onLongPress, onRetry }) {
  if (m.senderId === 'system') {
    return (
      <View style={{ alignSelf: 'center', maxWidth: '86%', backgroundColor: colors.periwinkleWash, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, marginVertical: space.xs }}>
        <AppText variant="caption" color={colors.inkSoft} align="center">
          {m.body}
        </AppText>
      </View>
    );
  }
  const status = m.failed ? 'Not sent. Tap to retry.' : m.pending ? 'Sending…' : timeLabel(m.createdAt);
  const me = mineTheme();
  return (
    <Animated.View entering={fadeIn()} style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', marginTop: showName ? space.sm : 4 }}>
      {!mine && <View style={{ width: 28, marginRight: space.xs }}>{showName ? <Avatar seed={m.senderId} uri={avatarUrl} size={28} /> : null}</View>}
      <Pressable
        onPress={m.failed ? () => onRetry(m) : undefined}
        onLongPress={mine ? undefined : () => onLongPress(m)}
        delayLongPress={350}
        accessibilityRole={m.failed ? 'button' : 'text'}
        accessibilityLabel={`${mine ? 'You' : sender}: ${m.body}. ${status}`}
        accessibilityHint={m.failed ? 'Double tap to send again' : mine ? undefined : 'Long press for report or block'}
        style={{
          maxWidth: '78%',
          backgroundColor: mine ? me.bg : colors.surface,
          borderRadius: 20,
          borderBottomRightRadius: mine ? 6 : 20,
          borderBottomLeftRadius: mine ? 20 : 6,
          borderWidth: mine ? (m.failed ? 1.5 : 0) : 1.2,
          borderColor: m.failed ? colors.danger : colors.border,
          paddingHorizontal: 14,
          paddingVertical: space.xs,
          opacity: m.pending ? 0.6 : 1,
        }}
      >
        {group && showName && !mine && (
          <AppText variant="caption" color={colors.deep} style={{ marginBottom: 2 }}>
            {sender}
          </AppText>
        )}
        <AppText color={mine ? me.fg : colors.ink}>{m.body}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 }}>
          {m.failed && <Icon name="alert-circle" size={11} color={colors.danger} style={{ marginRight: 4 }} />}
          {m.pending && <Icon name="clock" size={10} color={me.sub} style={{ marginRight: 4 }} />}
          <AppText variant="caption" color={m.failed ? colors.danger : mine ? me.sub : colors.muted} style={{ fontSize: 10 }}>
            {status}
          </AppText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// One compact row: when + where. Tap opens the plan; "Check in" is the only
// inline action (split bill, sharing and reporting live in the ⋯ menu).
function PlanContext({ activity, onNavigate }) {
  const accent = accents[(activity.accentIndex ?? 0) % accents.length].bg;
  const venue = activity.venueName || `${activity.venueType || 'Public place'}${activity.area ? ` · ${activity.area}` : ''}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.card, paddingLeft: space.sm, paddingRight: space.sm, paddingVertical: space.sm, marginHorizontal: layout.screenPadding, marginBottom: space.xs }}>
      <Pressable
        onPress={() => onNavigate('activity_detail', { id: activity.id })}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title}, ${whenLabel(activity.startsAt)} at ${venue}. Open plan details`}
      >
        <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={activity.pictogram} size={22} color={colors.ink} />
        </View>
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {whenLabel(activity.startsAt)}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Icon name={activity.venueName ? 'unlock' : 'lock'} size={12} color={activity.venueName ? colors.success : colors.muted} />
            <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginLeft: space.xxs, flex: 1 }}>
              {venue}
            </AppText>
          </View>
        </View>
      </Pressable>
      <Button title="Check in" icon="map-pin" size="xs" variant="secondary" full={false} onPress={() => onNavigate('activity_checkin', { id: activity.id })} />
    </View>
  );
}

export default function ChatView({ conversationId }) {
  const nav = useNavigation();
  const conversations = useAppStore((s) => s.conversations);
  const raw = useAppStore((s) => s.messages[conversationId]);
  const activities = useAppStore((s) => s.activities);
  const users = useAppStore((s) => s.users);
  const blocked = useAppStore((s) => s.blocked);
  const profileName = useAppStore((s) => s.profile.name);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const markConversationRead = useAppStore((s) => s.markConversationRead);
  const toggleMute = useAppStore((s) => s.toggleMute);
  const cancelJoin = useAppStore((s) => s.cancelJoin);
  const removeConversation = useAppStore((s) => s.removeConversation);

  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [msgMenu, setMsgMenu] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [retried, setRetried] = useState({}); // failed temp ids already re-sent (hidden locally)

  const conv = useMemo(() => conversations.find((c) => c.id === conversationId), [conversations, conversationId]);
  const activityId = conv?.activityId;

  // Conversation list (if opened from a deep link / push), messages and plan context.
  const convLoad = useLoader('conversations', (s) => (s.conversations.some((c) => c.id === conversationId) ? null : s.loadConversations({ silent: false })), [conversationId]);
  const msgLoad = useLoader(`messages:${conversationId}`, (s) => (conversationId ? s.loadMessages(conversationId) : null), [conversationId]);
  useLoader(`activity:${activityId}`, (s) => (activityId && !s.activities.some((a) => a.id === activityId) ? s.loadActivity(activityId, { silent: true }) : null), [activityId]);

  const isGroup = conv && conv.kind !== 'direct';
  const activity = useMemo(() => (activityId ? activities.find((a) => a.id === activityId) : null), [activityId, activities]);
  const other = !isGroup ? otherMember(conv) : null;
  const otherBlocked = !!other && blocked.includes(other);
  const data = useMemo(() => (raw || []).filter((m) => !blocked.includes(m.senderId) && !retried[m.id]).slice().reverse(), [raw, blocked, retried]);

  const unread = conv?.unread || 0;
  useFocusEffect(
    useCallback(() => {
      if (unread > 0) markConversationRead(conversationId);
    }, [unread, conversationId, markConversationRead])
  );

  if (!conv) {
    return (
      <Screen header={<ScreenHeader title="Chat" />}>
        <QueryState
          status={convLoad.status}
          error={convLoad.error}
          hasData={false}
          onRetry={convLoad.reload}
          skeletonRows={4}
          skeletonHeight={56}
          empty={{ title: 'Chat not available', body: 'You may have left this plan, or the conversation was closed.', cta: 'Back to inbox', onCta: () => nav.navigate('inbox') }}
          style={{ marginTop: space.md }}
        />
      </Screen>
    );
  }

  const deliver = (body) => {
    sendMessage(conversationId, body).catch(() => {
      // The store marks the bubble as failed; tapping it retries.
      haptics.warning();
    });
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    haptics.light();
    setText('');
    deliver(body);
  };

  const retry = (m) => {
    useAppStore.getState().dropMessage(conversationId, m.id);
    setRetried((r) => ({ ...r, [m.id]: true }));
    deliver(m.body);
  };

  const go = (screen, params) => {
    setMenu(false);
    setMsgMenu(null);
    nav.navigate(screen, params);
  };

  const runLeave = async (fn) => {
    setLeaving(true);
    try {
      await fn();
      nav.goBack();
    } catch (e) {
      setLeaving(false);
      Alert.alert('Something went wrong', e?.message || 'Check your connection and try again.');
    }
  };

  const leave = () => {
    setMenu(false);
    if (isGroup) {
      const hosting = activity?.host?.id === 'me';
      Alert.alert(hosting ? 'Hide this chat?' : 'Leave this plan?', hosting ? 'The chat stays open for your group. You can find it again from the plan.' : 'You’ll leave the group chat and free up your spot. The host is notified.', [
        { text: 'Stay', style: 'cancel' },
        {
          text: hosting ? 'Hide chat' : 'Leave plan',
          style: 'destructive',
          onPress: () =>
            runLeave(async () => {
              if (activity && !hosting) await cancelJoin(activity.id);
              await removeConversation(conversationId);
            }),
        },
      ]);
    } else {
      Alert.alert('Delete this chat?', 'This removes the conversation from your inbox.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runLeave(() => removeConversation(conversationId)) },
      ]);
    }
  };

  const otherPerson = other ? personOf(other, users) : null;
  const title = isGroup ? activity?.title || conv.title : conv.title || nameOf(other, null, users);
  const memberCount = conv.memberIds?.length || conv.memberCount || 0;
  const subtitle = isGroup
    ? `${memberCount ? `${memberCount} in group` : 'Plan group'}${conv.muted ? ' · muted' : ''}`
    : `${otherPerson?.reliability != null ? `${Math.round(otherPerson.reliability * 100)}% show-up · ` : ''}phone verified${conv.muted ? ' · muted' : ''}`;

  return (
    <Screen
      keyboard
      scroll={false}
      padded={false}
      bg={colors.canvas}
      header={
        <View>
          <ScreenHeader title={title} subtitle={subtitle} right={leaving ? <ActivityIndicator color={colors.ink} /> : <IconButton icon="more-horizontal" accessibilityLabel="Chat options" onPress={() => setMenu(true)} />} />
          {isGroup && activity && <PlanContext activity={activity} onNavigate={go} />}
        </View>
      }
      footer={
        otherBlocked ? (
          <AppText variant="caption" color={colors.muted} align="center">
            You blocked this person. Unblock from Settings to message again.
          </AppText>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1.2, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48, justifyContent: 'center' }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={isGroup ? 'Message the group…' : 'Message…'}
                placeholderTextColor={colors.muted}
                keyboardAppearance={isDark() ? 'dark' : 'light'}
                selectionColor={colors.deep}
                multiline
                maxLength={1000}
                accessibilityLabel="Message"
                style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.ink, maxHeight: 120, paddingTop: 0, paddingBottom: 0 }}
              />
            </View>
            <IconButton icon="send" variant={text.trim() ? 'ink' : 'surface'} size={48} iconSize={20} accessibilityLabel="Send message" onPress={send} style={{ marginLeft: space.xs }} />
          </View>
        )
      }
    >
      {!raw && msgLoad.status !== 'ready' ? (
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: space.md }}>
          <QueryState status={msgLoad.status} error={msgLoad.error} hasData={false} onRetry={msgLoad.reload} skeletonRows={4} skeletonHeight={48} />
        </View>
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingVertical: space.sm }}
          renderItem={({ item, index }) => {
            const older = data[index + 1];
            const mine = item.senderId === 'me';
            const showName = !mine && (!older || older.senderId !== item.senderId);
            return (
              <Bubble
                m={item}
                mine={mine}
                showName={showName}
                group={isGroup}
                sender={nameOf(item.senderId, profileName, users)}
                avatarUrl={personOf(item.senderId, users)?.avatarUrl}
                onLongPress={setMsgMenu}
                onRetry={retry}
              />
            );
          }}
          ListFooterComponent={
            <View>
              {msgLoad.status === 'error' && (
                <Pressable onPress={msgLoad.reload} accessibilityRole="button" style={{ alignSelf: 'center', marginBottom: space.sm }}>
                  <AppText variant="caption" color={colors.danger}>
                    Couldn't load older messages. Tap to retry.
                  </AppText>
                </Pressable>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: space.md, paddingHorizontal: space.md }}>
                <Icon name="shield" size={14} color={colors.muted} />
                <AppText variant="caption" color={colors.muted} align="center" style={{ marginLeft: space.xxs, flexShrink: 1 }}>
                  Never share OTPs or PINs. Long-press a message to report it.
                </AppText>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginVertical: space.xl }}>
              <IconBubble icon="hand-waving" tone="orange" size={56} iconSize={28} />
              <AppText variant="bodyStrong" align="center" style={{ marginTop: space.sm }}>
                Say hi!
              </AppText>
              <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: 2 }}>
                Break the ice and confirm the meeting point.
              </AppText>
            </View>
          }
        />
      )}

      {/* Conversation menu */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title={isGroup ? 'Group options' : 'Chat options'}>
        <ListGroup>
          <ListRow icon={conv.muted ? 'bell-off' : 'bell'} title="Mute notifications" toggle={!!conv.muted} onToggle={() => toggleMute(conversationId)} />
          {isGroup && activity && (
            <>
              <ListRow icon="info" title="Plan details" onPress={() => go('activity_detail', { id: activity.id })} />
              <ListRow icon="divide-circle" title="Split the bill" onPress={() => go('split_create', { activityId: activity.id })} />
              <ListRow icon="share-2" title="Share plan with a trusted contact" onPress={() => go('emergency_share', { activityId: activity.id })} />
              <ListRow icon="flag" title="Report a problem with this plan" onPress={() => go('report_flow', { activityId: activity.id })} />
            </>
          )}
          {!isGroup && other && (
            <>
              <ListRow icon="flag" title={`Report ${nameOf(other, null, users)}`} onPress={() => go('report_flow', { userId: other })} />
              <ListRow icon="slash" title={`Block ${nameOf(other, null, users)}`} danger onPress={() => go('block_confirm', { userId: other })} />
            </>
          )}
          <ListRow icon="log-out" title={isGroup ? (activity?.host?.id === 'me' ? 'Hide chat' : 'Leave plan') : 'Delete chat'} danger onPress={leave} last />
        </ListGroup>
      </Sheet>

      {/* Message menu (others' messages) */}
      <Sheet visible={!!msgMenu} onClose={() => setMsgMenu(null)} title="Message">
        {msgMenu && (
          <View>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.sm, marginBottom: space.md }}>
              <AppText variant="caption" color={colors.muted}>
                {nameOf(msgMenu.senderId, null, users)} · {timeLabel(msgMenu.createdAt)}
              </AppText>
              <AppText numberOfLines={3}>{msgMenu.body}</AppText>
            </View>
            <ListGroup>
              <ListRow
                icon="flag"
                title="Report message"
                subtitle="Sent to our safety team with this context"
                onPress={() => go('report_flow', { messageId: msgMenu.id, userId: msgMenu.senderId, activityId: activity?.id, conversationId })}
              />
              <ListRow icon="slash" title={`Block ${nameOf(msgMenu.senderId, null, users)}`} danger onPress={() => go('block_confirm', { userId: msgMenu.senderId })} last />
            </ListGroup>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
