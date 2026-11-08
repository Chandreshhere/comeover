// Share plan details with a trusted contact (no live location tracking).
import React, { useMemo, useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, ListGroup, Pictogram, Screen, ScreenHeader, SectionHeader, Skeleton } from '@/components';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { durationLabel, relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import { callEmergency } from './shared';

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
      return `Hi, it's ${me}. Heads up — I'm heading out to meet people from Project IRL${profile.area ? ` around ${profile.area}` : ''}. I'll message you when I'm done.`;
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
      setShareError("Couldn't open your messages app. Use “Share via…” instead.");
    }
  };

  return (
    <Screen header={<ScreenHeader title="Share my plan" />} footer={<Button title="Share via…" icon="share-2" onPress={shareAny} />}>
      {/* Plan summary */}
      {activity ? (
        <Card bg={colors.periwinkle} elevated={false} style={{ marginTop: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={activity.pictogram} size={24} />
            </View>
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="h3" numberOfLines={2}>
                {activity.title}
              </AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {[relativeDay(activity.startsAt), timeLabel(activity.startsAt), activity.area].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
        </Card>
      ) : planQ.loading ? (
        <Skeleton height={80} r={radius.card} style={{ marginTop: space.xs }} />
      ) : (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ marginTop: space.xs }}>
          <AppText variant="bodyStrong">{planQ.status === 'error' ? "Couldn't load your plan" : 'No upcoming plan found'}</AppText>
          <AppText variant="caption" color={colors.muted}>
            {planQ.status === 'error' ? 'You can still share a heads-up message below.' : "You can still let someone know you're heading out."}
          </AppText>
          {planQ.status === 'error' && <Button title="Retry" icon="refresh-cw" size="xs" variant="secondary" full={false} style={{ marginTop: space.xs }} onPress={planQ.reload} />}
        </Card>
      )}

      {/* Preview */}
      <SectionHeader title="What they'll get" />
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderBottomLeftRadius: 8, padding: space.md, borderWidth: 1.2, borderColor: colors.border }}>
        <AppText variant="caption" color={colors.inkSoft} selectable>
          {message}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <Icon name="eye-off" size={13} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6, flex: 1 }}>
          Plan details only — we never share your live location.
        </AppText>
      </View>

      {/* Contacts */}
      <SectionHeader title="Trusted contacts" action={trustedContacts.length ? 'Manage' : undefined} onAction={() => nav.navigate('safety_center')} />
      {trustedContacts.length ? (
        <ListGroup>
          {trustedContacts.map((c, i) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: i === trustedContacts.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <Avatar seed={c.phone || c.id} size={40} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{c.name}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  {c.phone}
                </AppText>
              </View>
              <Button title={sent[c.id] ? 'Sent' : 'Text'} icon={sent[c.id] ? 'check' : 'message-square'} size="xs" variant={sent[c.id] ? 'secondary' : 'primary'} full={false} onPress={() => text(c)} />
            </View>
          ))}
        </ListGroup>
      ) : contactsQ.loading ? (
        <Skeleton height={56} r={radius.card} />
      ) : (
        <Card elevated={false}>
          <AppText variant="caption" color={colors.muted}>
            {contactsQ.status === 'error' ? "Couldn't load your trusted contacts. You can still use “Share via…” below." : 'No trusted contacts yet. Add one so sharing is a single tap next time.'}
          </AppText>
          <Button title="Add a trusted contact" icon="user-plus" size="sm" variant="secondary" full={false} style={{ marginTop: space.sm }} onPress={() => nav.navigate('safety_center')} />
        </Card>
      )}
      {shareError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          {shareError}
        </AppText>
      ) : null}

      {/* Check-in reminder */}
      {activity ? (
        <Card elevated={false} bg={colors.periwinkleWash} style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="clock" size={18} color={colors.deep} />
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
            We'll nudge you to check in when the plan starts. Checking in is optional.
          </AppText>
          <Button title="Check in" size="xs" variant="secondary" full={false} onPress={() => nav.navigate('activity_checkin', { id: activity.id })} />
        </Card>
      ) : null}

      {/* Emergency */}
      <Card elevated={false} bg={colors.ink} style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="alert-triangle" color={colors.orange} />
          <AppText variant="bodyStrong" color={colors.white} style={{ marginLeft: space.xs }}>
            Feel unsafe right now?
          </AppText>
        </View>
        <AppText variant="caption" color="rgba(255,255,255,0.75)" style={{ marginTop: 4 }}>
          Move to a busy public place and call emergency services. You can report the account afterwards.
        </AppText>
        <Button title={`Call ${config.EMERGENCY_NUMBER_IN}`} icon="phone" variant="danger" style={{ marginTop: space.sm }} onPress={callEmergency} />
      </Card>
    </Screen>
  );
}
