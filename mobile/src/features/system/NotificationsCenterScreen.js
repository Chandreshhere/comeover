import React, { useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { relativeDay, timeLabel } from '@/utils/format';

const TYPE = {
  join: { icon: 'user-check', bg: colors.periwinkle, label: 'Plan update' },
  message: { icon: 'message-circle', bg: colors.lavender, label: 'Message' },
  nearby: { icon: 'map-pin', bg: colors.orange, label: 'Nearby' },
  quest: { icon: 'award', bg: colors.pink, label: 'Quest' },
  safety: { icon: 'shield', bg: colors.mint, label: 'Safety' },
};

const TAB_SCREENS = ['discover_home', 'live_radar', 'circles_home', 'profile_home'];

function Row({ n, index, onPress }) {
  const t = TYPE[n.type] || TYPE.join;
  const when = relativeDay(n.createdAt) === 'Today' ? timeLabel(n.createdAt) : relativeDay(n.createdAt);
  return (
    <Animated.View entering={enter(index)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${n.read ? '' : 'Unread. '}${t.label}: ${n.title}. ${n.body}. ${when}`}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          padding: space.sm,
          borderRadius: radius.card,
          backgroundColor: n.read ? 'transparent' : colors.surface,
          borderWidth: n.read ? 0 : 1.2,
          borderColor: colors.border,
          marginBottom: space.xs,
        }}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={t.icon} size={18} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant={n.read ? 'body' : 'bodyStrong'} style={{ flex: 1 }} numberOfLines={2}>
              {n.title}
            </AppText>
            {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.deep, marginLeft: 6 }} />}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }} numberOfLines={2}>
            {n.body}
          </AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4 }}>
            {t.label} · {when}
          </AppText>
        </View>
      </Pressable>
    </Animated.View>
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
              <AppText variant="label" color={colors.deep} onPress={markAll} accessibilityRole="button" suppressHighlighting>
                Read all
              </AppText>
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
          body: 'Join requests, plan updates and nearby plans will show up here.',
          cta: 'Find a plan',
          onCta: () => nav.navigate('main', { screen: 'discover_home' }),
          pose: 'wave',
        }}
      >
        <>
          {today.length > 0 && (
            <>
              <SectionHeader title="Today" style={{ marginTop: space.sm }} />
              {today.map((n, i) => (
                <Row key={n.id} n={n} index={i} onPress={() => open(n)} />
              ))}
            </>
          )}
          {earlier.length > 0 && (
            <>
              <SectionHeader title="Earlier" style={{ marginTop: today.length ? space.lg : space.sm }} />
              {earlier.map((n, i) => (
                <Row key={n.id} n={n} index={today.length + i} onPress={() => open(n)} />
              ))}
            </>
          )}
          {q.status === 'error' && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite" onPress={q.reload}>
              Couldn't refresh — showing what we had. Tap to retry.
            </AppText>
          )}
        </>
      </QueryState>

      <ListGroup style={{ marginTop: space.xl }}>
        <ListRow icon="sliders" title="Notification settings" subtitle="Categories, quiet hours, frequency" onPress={() => nav.navigate('privacy_controls')} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.sm }}>
        Nearby-plan alerts are capped at 2 a day. Safety alerts always come through.
      </AppText>
    </Screen>
  );
}
