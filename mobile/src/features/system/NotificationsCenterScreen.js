import React, { useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { Checks } from 'phosphor-react-native/src/icons/Checks';
import { AppText, IconButton, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SectionHeader, usePressScale } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { relativeDay, timeLabel } from '@/utils/format';
import IconBubble from './IconBubble';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Bubble tones are palette names resolved at render, so dark mode applies.
const TYPE = {
  join: { icon: 'user-check', tone: 'periwinkle', label: 'Plan update' },
  message: { icon: 'chats', tone: 'lavender', label: 'Message' },
  nearby: { icon: 'map-pin', tone: 'orange', label: 'Nearby' },
  quest: { icon: 'trophy', tone: 'pink', label: 'Quest' },
  safety: { icon: 'shield', tone: 'mint', label: 'Safety' },
};

const TAB_SCREENS = ['discover_home', 'live_radar', 'circles_home', 'profile_home'];

// One aligned row inside a grouped list: icon bubble, title + time, one body
// line. Unread rows are bold with a dot; read rows are plain.
function Row({ n, last, onPress }) {
  const t = TYPE[n.type] || TYPE.join;
  const when = relativeDay(n.createdAt) === 'Today' ? timeLabel(n.createdAt) : relativeDay(n.createdAt);
  const press = usePressScale(0.98);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`${n.read ? '' : 'Unread. '}${t.label}: ${n.title}. ${n.body || ''}. ${when}`}
      style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }, press.style]}
    >
      <IconBubble icon={t.icon} tone={t.tone} size={40} iconSize={20} />
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant={n.read ? 'body' : 'bodyStrong'} style={{ flex: 1 }} numberOfLines={1}>
            {n.title}
          </AppText>
          <AppText variant="caption" color={n.read ? colors.muted : colors.deep} style={{ marginLeft: space.xs }}>
            {when}
          </AppText>
          {/* Fixed slot so read and unread rows share the same right edge. */}
          <View style={{ width: space.sm, alignItems: 'flex-end' }}>{!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.deep }} />}</View>
        </View>
        {!!n.body && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, marginRight: space.sm }} numberOfLines={2}>
            {n.body}
          </AppText>
        )}
      </View>
    </AnimatedPressable>
  );
}

function Group({ title, items, onOpen, first }) {
  if (!items.length) return null;
  return (
    <>
      <SectionHeader title={title} style={{ marginTop: first ? space.sm : space.xl }} />
      <Animated.View entering={enter(first ? 0 : 1)}>
        <ListGroup>
          {items.map((n, i) => (
            <Row key={n.id} n={n} last={i === items.length - 1} onPress={() => onOpen(n)} />
          ))}
        </ListGroup>
      </Animated.View>
    </>
  );
}

export default function NotificationsCenterScreen() {
  const nav = useNavigation();
  const notifications = useAppStore((s) => s.notifications);
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAll = useAppStore((s) => s.markAllNotificationsRead);
  // GET /notifications on focus; new ones also arrive via the realtime channel.
  const q = useLoader('notifications', (s) => s.loadNotifications());

  const { today, earlier, unread } = useMemo(() => {
    const sorted = [...notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return {
      today: sorted.filter((n) => relativeDay(n.createdAt) === 'Today'),
      earlier: sorted.filter((n) => relativeDay(n.createdAt) !== 'Today'),
      unread: sorted.filter((n) => !n.read).length,
    };
  }, [notifications]);

  const open = (n) => {
    markRead(n.id);
    const target = n.target;
    if (!target?.screen) return;
    if (TAB_SCREENS.includes(target.screen)) nav.navigate('main', { screen: target.screen, params: target.params });
    else nav.navigate(target.screen, target.params);
  };

  const subtitle = q.status === 'loading' && !notifications.length ? 'Loading…' : unread ? `${unread} unread` : 'All caught up';

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.reload} tintColor={colors.ink} />}
      header={
        <ScreenHeader
          title="Notifications"
          subtitle={subtitle}
          right={
            unread ? (
              // Icon button keeps the header slots balanced so the title stays centred.
              <IconButton accessibilityLabel="Mark all as read" onPress={markAll}>
                <Checks size={20} color={colors.ink} weight="bold" />
              </IconButton>
            ) : null
          }
        />
      }
    >
      <QueryState
        status={q.status}
        error={q.error}
        hasData={notifications.length > 0}
        onRetry={q.reload}
        skeletonRows={4}
        skeletonHeight={76}
        style={{ marginTop: space.sm }}
        empty={{
          title: 'Nothing yet',
          body: 'Join requests and plan updates show up here.',
          cta: 'Find a plan',
          onCta: () => nav.navigate('main', { screen: 'discover_home' }),
          pose: 'wave',
        }}
      >
        <>
          <Group title="Today" items={today} onOpen={open} first />
          <Group title="Earlier" items={earlier} onOpen={open} first={!today.length} />
          {q.status === 'error' && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite" onPress={q.reload}>
              Couldn't refresh. Showing what we had. Tap to retry.
            </AppText>
          )}
        </>
      </QueryState>

      <ListGroup style={{ marginTop: space.xl }}>
        <ListRow icon="sliders" title="Notification settings" subtitle="Safety alerts always come through" onPress={() => nav.navigate('account_settings')} last />
      </ListGroup>
    </Screen>
  );
}
