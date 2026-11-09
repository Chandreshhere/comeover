// notification_opt_in — one question: turn on notifications? The category
// toggles show exactly what you'd get before the OS asks. Marketing is off by
// default and "Not now" is always available.
import React, { useState } from 'react';
import { View } from 'react-native';
import { RESULTS, requestNotifications } from 'react-native-permissions';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, ListGroup, ListRow } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import OnboardingFrame from './components/OnboardingFrame';

// Inline status line shown after the OS prompt (info or "turned off").
function Note({ icon, bg, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: bg, borderRadius: radius.quest, padding: space.sm, marginBottom: space.md }} accessibilityLiveRegion="polite">
      <Icon name={icon} size={18} color={colors.ink} />
      <AppText variant="caption" style={{ flex: 1, marginLeft: space.xs }}>
        {children}
      </AppText>
    </View>
  );
}

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
        setNotice("Notifications aren't set up on this build yet. Your choices are saved.");
      } else if (r?.reason === 'offline') {
        setNotice("You're offline. We'll register this phone next time you open the app.");
      } else if (r?.reason === 'denied') {
        setDenied(true);
      } else {
        setNotice("Couldn't register this phone right now. Retry later from Settings.");
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
      subtitle="Only the useful stuff. Pick what you want to hear about."
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
        <Note icon="info" bg={colors.periwinkleWash}>
          {notice}
        </Note>
      )}
      {denied && (
        <Note icon="bell-off" bg={colors.orangeSoft}>
          Notifications are off. Turn them on later in Settings.
        </Note>
      )}
      <ListGroup>
        <ListRow icon="user-check" title="Join requests & decisions" toggle={n.joinRequests} onToggle={(v) => setNotificationPrefs({ joinRequests: v })} />
        <ListRow icon="message-circle" title="Group messages" toggle={n.messages} onToggle={(v) => setNotificationPrefs({ messages: v })} />
        <ListRow icon="map-pin" title="Plans starting nearby" subtitle="Max 2 a day" toggle={n.nearby} onToggle={(v) => setNotificationPrefs({ nearby: v })} />
        <ListRow icon="trophy" title="Quest reminders" toggle={n.questReminders} onToggle={(v) => setNotificationPrefs({ questReminders: v })} />
        <ListRow icon="gift" title="News & offers" toggle={n.productUpdates} onToggle={(v) => setNotificationPrefs({ productUpdates: v })} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Quiet 10 PM – 8 AM. Safety alerts always come through.
      </AppText>
    </OnboardingFrame>
  );
}
