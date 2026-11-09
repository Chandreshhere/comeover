// inbox — activity group chats and direct conversations (GET /conversations).
// Chats only open after a host accepts a join request; mute/report/block live
// in each chat's ⋯ menu, and the thread shows the safety tip where it matters.
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Icon, Pictogram, QueryState, Screen, ScreenHeader, Segmented, usePressScale } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { accents, colors, fonts, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { latestMessage, nameOf, otherMember, personOf, stampLabel } from './chatUtils';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'plans', label: 'Plans' },
  { value: 'direct', label: 'Direct' },
];

const LEAD = 48;

// Two-line row: title + time, then the latest message + unread count.
function ConversationRow({ conv, activity, last, users, onPress, isLast }) {
  const isGroup = conv.kind !== 'direct';
  const other = otherMember(conv);
  const title = isGroup ? activity?.title || conv.title : conv.title || nameOf(other, null, users);
  const sender = last ? (last.senderId === 'system' ? '' : last.senderId === 'me' ? 'You: ' : isGroup ? `${nameOf(last.senderId, null, users)}: ` : '') : '';
  const preview = last ? `${sender}${last.body || 'Attachment'}` : isGroup ? 'Group chat is open' : 'Say hi!';
  const accent = accents[(activity?.accentIndex ?? 0) % accents.length].bg;
  const stamp = stampLabel(last?.createdAt) || (activity ? stampLabel(activity.startsAt) : '');
  const press = usePressScale(0.98);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`${isGroup ? 'Plan chat' : 'Direct chat'}: ${title}. ${preview}.${conv.unread ? ` ${conv.unread} unread.` : ''}${conv.muted ? ' Muted.' : ''}`}
      style={[{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border, minHeight: 72 }, press.style]}
    >
      {isGroup ? (
        <View style={{ width: LEAD, height: LEAD, borderRadius: 16, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={activity?.pictogram || 'people'} size={24} color={colors.ink} />
        </View>
      ) : (
        <Avatar seed={other} uri={personOf(other, users)?.avatarUrl} size={LEAD} />
      )}
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </AppText>
          {!!stamp && (
            <AppText variant="caption" color={conv.unread ? colors.deep : colors.muted} numberOfLines={1} style={{ marginLeft: space.xs }}>
              {stamp}
            </AppText>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, minHeight: 20 }}>
          {conv.muted && <Icon name="bell-off" size={12} color={colors.muted} style={{ marginRight: space.xxs }} />}
          <AppText variant="caption" color={conv.unread ? colors.ink : colors.muted} numberOfLines={1} style={{ flex: 1, fontFamily: conv.unread ? fonts.semibold : undefined }}>
            {preview}
          </AppText>
          {conv.unread > 0 && (
            <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: conv.muted ? colors.muted : colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: space.xs }}>
              <AppText variant="caption" color={colors.white} maxScale={1.1}>
                {conv.unread > 99 ? '99+' : conv.unread}
              </AppText>
            </View>
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
}

export default function InboxScreen() {
  const nav = useNavigation();
  const conversations = useAppStore((s) => s.conversations);
  const messages = useAppStore((s) => s.messages);
  const activities = useAppStore((s) => s.activities);
  const users = useAppStore((s) => s.users);
  const blocked = useAppStore((s) => s.blocked);
  const [filter, setFilter] = useState('all');

  const load = useLoader('conversations', (s) => s.loadConversations());

  const all = useMemo(() => conversations.filter((c) => !(c.kind === 'direct' && (c.memberIds || []).some((m) => blocked.includes(m)))), [conversations, blocked]);
  const rows = useMemo(() => {
    const byId = Object.fromEntries(activities.map((a) => [a.id, a]));
    return all
      .filter((c) => (filter === 'all' ? true : filter === 'direct' ? c.kind === 'direct' : c.kind !== 'direct'))
      .map((c) => ({ conv: c, activity: c.activityId ? byId[c.activityId] : null, last: latestMessage(c, messages[c.id], blocked) }))
      .sort((a, b) => new Date(b.last?.createdAt || b.conv.createdAt || 0) - new Date(a.last?.createdAt || a.conv.createdAt || 0));
  }, [all, messages, activities, blocked, filter]);

  const open = (c) => nav.navigate(c.kind === 'direct' ? 'chat_thread' : 'group_chat', { conversationId: c.id });

  const empty = {
    title: filter === 'direct' ? 'No direct chats yet' : 'No chats yet',
    body: filter === 'direct' ? 'They open with people you’ve shared a plan with.' : 'A plan’s group chat appears once the host accepts you.',
    cta: 'Find a plan',
    onCta: () => nav.navigate('main', { screen: 'discover_home' }),
  };

  return (
    <Screen header={<ScreenHeader title="Inbox" />} bg={colors.canvas} refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={load.reload} tintColor={colors.ink} />}>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} style={{ marginTop: space.xs }} />

      <QueryState status={load.status} error={load.error} hasData={all.length > 0} onRetry={load.reload} skeletonRows={4} skeletonHeight={72} empty={empty} style={{ marginTop: space.md }}>
        {rows.length > 0 ? (
          <Animated.View entering={enter(0)} style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, marginTop: space.md }}>
            {rows.map((r, i) => (
              <ConversationRow key={r.conv.id} conv={r.conv} activity={r.activity} last={r.last} users={users} isLast={i === rows.length - 1} onPress={() => open(r.conv)} />
            ))}
          </Animated.View>
        ) : (
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xl }}>
            {filter === 'direct' ? 'No direct chats yet.' : 'No plan chats yet.'}
          </AppText>
        )}
      </QueryState>
      {load.status === 'error' && all.length > 0 && (
        <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          Couldn't refresh your chats. Pull down to try again.
        </AppText>
      )}
    </Screen>
  );
}
