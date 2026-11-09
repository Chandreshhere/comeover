// Share plan details with a trusted contact (no live location tracking).
// Plan → who to send it to → the exact message. One primary: Share via….
import React, { useMemo, useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, ListGroup, ListRow, Pictogram, Screen, ScreenHeader, SectionHeader, Skeleton } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { durationLabel, relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import { EmergencyRow } from './shared';

const smsUrl = (phone, body) => `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;

export default function EmergencyShareScreen() {
  const nav = useNavigation();
  const activityId = useRoute().params?.activityId;
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const trustedContacts = useAppStore((s) => s.trustedContacts);
  const profile = useAppStore((s) => s.profile);
  const [sent, setSent] = useState({});
  const [shareError, setShareError] = useState(null);

  // The specific plan (GET /activities/{id}) or, if none given, my joined plans.
  const planQ = useLoader(
    activityId ? `activity:${activityId}` : 'my:joined',
    (s) => (activityId ? s.loadActivity(activityId) : s.loadMyActivities('joined')),
    [activityId]
  );
  // Trusted contacts come with the safety bundle.
  const contactsQ = useLoader('safety', (s) => s.loadSafety());

  const activity = useMemo(() => {
    if (activityId) return activities.find((a) => a.id === activityId) || null;
    return (
      activities
        .filter((a) => ['accepted', 'checked_in'].includes(joinStates[a.id]) && a.status !== 'cancelled' && new Date(a.startsAt).getTime() > Date.now() - 3 * 3600e3)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null
    );
  }, [activities, joinStates, activityId]);

  const message = useMemo(() => {
    const me = profile.name || 'I';
    if (!activity) {
      return `Hi, it's ${me}. Heads up. I'm heading out to meet people from Come Over${profile.area ? ` around ${profile.area}` : ''}. I'll message you when I'm done.`;
    }
    const d = new Date(activity.startsAt);
    const place = [activity.venueName || activity.venueType, activity.area].filter(Boolean).join(', ');
    return [
      `Hi, it's ${me}. Sharing my plan in case you need it:`,
      `• ${activity.title}`,
      `• ${relativeDay(d)} at ${timeLabel(d)}${activity.durationMin ? ` (${durationLabel(activity.durationMin)})` : ''}`,
      place ? `• ${place}` : null,
      `• Host: ${activity.host?.id === 'me' ? 'me' : (activity.host?.name || '').split(' ')[0] || 'another member'} · ${activity.joinedCount ?? 0} people`,
      "I'll check in when I'm done.",
    ]
      .filter(Boolean)
      .join('\n');
  }, [activity, profile.name, profile.area]);

  const shareAny = async () => {
    setShareError(null);
    try {
      await Share.share({ message });
      haptics.success();
    } catch (e) {
      setShareError("Couldn't open the share sheet.");
    }
  };

  const text = async (c) => {
    setShareError(null);
    try {
      await Linking.openURL(smsUrl(c.phone, message));
      setSent((s) => ({ ...s, [c.id]: true }));
    } catch (e) {
      setShareError("Couldn't open Messages. Use “Share via…” instead.");
    }
  };

  return (
    <Screen header={<ScreenHeader title="Share my plan" />} footer={<Button title="Share via…" icon="share-2" onPress={shareAny} accessibilityLabel="Share via another app" />}>
      {/* 1. The plan being shared */}
      {activity ? (
        <Card bg={colors.periwinkle} elevated={false} style={{ marginTop: space.xs, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={activity.pictogram} size={26} color={colors.ink} duotoneColor={colors.deep} duotoneOpacity={0.4} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h3" numberOfLines={2}>
              {activity.title}
            </AppText>
            <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: 2 }}>
              {[relativeDay(activity.startsAt), timeLabel(activity.startsAt), activity.area].filter(Boolean).join(' · ')}
            </AppText>
          </View>
        </Card>
      ) : planQ.loading ? (
        <Skeleton height={80} r={radius.card} style={{ marginTop: space.xs }} />
      ) : (
        <ListGroup style={{ marginTop: space.xs }}>
          {planQ.status === 'error' ? (
            <ListRow icon="cloud-off" title="Couldn't load your plan" subtitle="You can still send a heads-up" onPress={planQ.reload} right={<AppText variant="label" color={colors.deep}>Retry</AppText>} last />
          ) : (
            <ListRow icon="calendar" title="No upcoming plan" subtitle="You can still send a heads-up" last />
          )}
        </ListGroup>
      )}

      {/* 2. Who to send it to */}
      <SectionHeader title="Send to" action={trustedContacts.length ? 'Manage' : undefined} onAction={() => nav.navigate('safety_center')} />
      {trustedContacts.length ? (
        <ListGroup>
          {trustedContacts.map((c, i) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 64, borderBottomWidth: i === trustedContacts.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <Avatar seed={c.phone || c.id} size={40} />
              <View style={{ flex: 1, marginHorizontal: space.sm }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {c.name}
                </AppText>
                <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                  {c.phone}
                </AppText>
              </View>
              <Button title={sent[c.id] ? 'Sent' : 'Text'} icon={sent[c.id] ? 'check' : 'message-square'} size="xs" variant="secondary" full={false} onPress={() => text(c)} accessibilityLabel={sent[c.id] ? `Sent to ${c.name}. Text again` : `Text ${c.name}`} />
            </View>
          ))}
        </ListGroup>
      ) : contactsQ.loading ? (
        <Skeleton height={64} r={radius.card} />
      ) : (
        <ListGroup>
          <ListRow
            icon="user-plus"
            title="Add a trusted contact"
            subtitle={contactsQ.status === 'error' ? "Couldn't load contacts. Use Share below." : 'Next time, sharing is one tap'}
            onPress={() => nav.navigate('safety_center')}
            last
          />
        </ListGroup>
      )}
      {shareError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          {shareError}
        </AppText>
      ) : null}

      {/* 3. Exactly what they'll get */}
      <SectionHeader title="Message" />
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderBottomLeftRadius: space.xs, padding: space.md, borderWidth: 1.2, borderColor: colors.border }}>
        <AppText variant="caption" color={colors.inkSoft} selectable>
          {message}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs, paddingHorizontal: space.xxs }}>
        <Icon name="eye-off" size={14} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs, flex: 1 }}>
          Plan details only. We never share your live location.
        </AppText>
      </View>

      <EmergencyRow body="Move somewhere busy and call for help." style={{ marginTop: space.xl }} />
    </Screen>
  );
}
