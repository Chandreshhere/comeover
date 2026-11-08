// notification_opt_in — show the value first, let users pick categories, then
// ask the OS. Marketing is off by default; "Not now" is always available.
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { RESULTS, requestNotifications } from 'react-native-permissions';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, ListGroup, ListRow } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import OnboardingFrame from './components/OnboardingFrame';

const PREVIEW = [
  { icon: 'user-check', title: 'Your join request was accepted', body: 'The group chat is open', tilt: '-2deg' },
  { icon: 'map-pin', title: 'Plans starting soon near you', body: 'Matched to your interests', tilt: '1.5deg' },
  { icon: 'moon', title: 'Quiet hours 10 PM – 8 AM', body: "We'll hold non-urgent alerts", tilt: '-1deg' },
];

export default function NotificationOptInScreen() {
  const nav = useNavigation();
  const n = useAppStore((s) => s.prefs.notifications);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPrefs);
  const enablePush = useAppStore((s) => s.enablePush);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState(null); // non-blocking info after OS grant

  const next = () => nav.navigate('safety_intro');

  const enable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { status } = await requestNotifications(['alert', 'sound', 'badge']);
      const ok = status === RESULTS.GRANTED || status === RESULTS.LIMITED;
      setNotificationPrefs({ enabled: ok });
      if (!ok) {
        setDenied(true);
        return;
      }
      // Register this device with FCM/APNs and POST /devices.
      let r = null;
      try {
        r = await enablePush();
      } catch (e) {
        r = { enabled: false, reason: e.code === 'network' || e.code === 'timeout' ? 'offline' : 'error' };
      }
      if (r?.enabled) {
        next();
      } else if (r?.reason === 'not_configured') {
        setNotice("Notifications aren't set up on this build yet. Your choices are saved and will apply once they are.");
      } else if (r?.reason === 'offline') {
        setNotice("You're offline, so we couldn't register this phone. We'll try again next time you open the app.");
      } else if (r?.reason === 'denied') {
        setDenied(true);
      } else {
        setNotice("We couldn't register this phone for notifications right now. You can retry from Settings later.");
      }
    } catch (e) {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingFrame
      stepId="notification_opt_in"
      title="Don't miss your plans"
      subtitle="Only the useful stuff: join decisions, messages from your groups and plans starting near you."
      hero={
        <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.md, paddingVertical: space.lg, gap: space.xs }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {PREVIEW.map((p, i) => (
            <Animated.View
              key={p.title}
              entering={enter(i)}
              style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, padding: space.sm, transform: [{ rotate: p.tilt }] }, shadow.card]}
            >
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={p.icon} size={16} color={colors.white} />
              </View>
              <View style={{ marginLeft: space.sm, flex: 1 }}>
                <AppText variant="label" numberOfLines={1}>
                  {p.title}
                </AppText>
                <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                  {p.body}
                </AppText>
              </View>
            </Animated.View>
          ))}
        </View>
      }
      footer={
        <View>
          {notice ? (
            <Button title="Continue" onPress={next} />
          ) : (
            <Button title="Turn on notifications" icon="bell" onPress={enable} loading={busy} />
          )}
          {!notice && <Button title="Not now" variant="ghost" style={{ marginTop: space.xs }} onPress={next} />}
        </View>
      }
    >
      {notice && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.periwinkleWash, borderRadius: radius.quest, padding: space.sm, marginBottom: space.sm }} accessibilityLiveRegion="polite">
          <Icon name="info" size={16} color={colors.deep} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: space.xs }}>
            {notice}
          </AppText>
        </View>
      )}
      {denied && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.orangeSoft, borderRadius: radius.quest, padding: space.sm, marginBottom: space.sm }} accessibilityLiveRegion="polite">
          <Icon name="bell-off" size={16} />
          <AppText variant="caption" style={{ flex: 1, marginLeft: space.xs }}>
            Notifications are off. You can turn them on later in Settings — your choices below are saved.
          </AppText>
        </View>
      )}
      <AppText variant="h3" style={{ marginBottom: space.xs }} accessibilityRole="header">
        Choose what you get
      </AppText>
      <ListGroup>
        <ListRow icon="user-check" title="Join requests & decisions" toggle={n.joinRequests} onToggle={(v) => setNotificationPrefs({ joinRequests: v })} />
        <ListRow icon="message-circle" title="Group messages" toggle={n.messages} onToggle={(v) => setNotificationPrefs({ messages: v })} />
        <ListRow icon="map-pin" title="Plans starting nearby" subtitle="Max 2 a day" toggle={n.nearby} onToggle={(v) => setNotificationPrefs({ nearby: v })} />
        <ListRow icon="award" title="Quest reminders" toggle={n.questReminders} onToggle={(v) => setNotificationPrefs({ questReminders: v })} />
        <ListRow icon="gift" title="News & offers" subtitle="Off unless you opt in" toggle={n.productUpdates} onToggle={(v) => setNotificationPrefs({ productUpdates: v })} />
        <ListRow icon="moon" title="Quiet hours" value="10 PM – 8 AM" last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Safety alerts about your own plans always come through.
      </AppText>
    </OnboardingFrame>
  );
}
