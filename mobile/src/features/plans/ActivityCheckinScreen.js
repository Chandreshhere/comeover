// activity_checkin — optional proximity check-in with a manual fallback.
// Location is read once (getPrecisePosition), sent with the check-in for the
// server to verify, and never stored on the device or shown to anyone.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ClockCountdown } from 'phosphor-react-native/src/icons/ClockCountdown';
import { AppText, Button, ListGroup, ListRow, Mascot, Screen, ScreenHeader } from '@/components';
import { IconBubble } from '@/components/Card';
import { useAppStore } from '@/store/useAppStore';
import { getPrecisePosition } from '@/services/location';
import { colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import { inCheckinWindow } from '@/features/discover/utils';
import usePlan, { openGroupChat } from './usePlan';
import PlanSummary from './components/PlanSummary';
import PlanGate from './components/PlanGate';

const NEAR_M = 1000; // pre-check only; the server makes the final call

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const FAR_CODES = ['too_far', 'not_nearby', 'out_of_range'];
const WINDOW_CODES = ['checkin_window_closed', 'checkin_not_open', 'too_early'];

export default function ActivityCheckinScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, loader } = usePlan();
  const checkIn = useAppStore((s) => s.checkIn);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const [phase, setPhase] = useState(joinState === 'checked_in' ? 'done' : 'intro'); // intro | locating | far | denied | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!a) return <PlanGate title="Check in" loader={loader} />;

  const submit = async (method, coords) => {
    setError(null);
    try {
      await checkIn(id, method, coords);
      haptics.success();
      setPhase('done');
    } catch (e) {
      if (FAR_CODES.includes(e?.code)) setPhase('far');
      else if (WINDOW_CODES.includes(e?.code)) setError('Check-in is only open from 30 minutes before the start until the plan ends.');
      else if (e?.code === 'network' || e?.code === 'timeout') setError('No connection. Try again, or check in manually once you’re online.');
      else setError(e?.message || 'Couldn’t check in. Try again.');
      if (phase === 'locating') setPhase('intro');
    }
  };

  const manual = async () => {
    setBusy(true);
    await submit('manual');
    setBusy(false);
  };

  const tryProximity = async () => {
    setPhase('locating');
    setError(null);
    const here = await getPrecisePosition();
    if (!here) {
      setPhase('denied');
      return;
    }
    setPrefs({ location: 'granted' });
    if (a.latitude != null && a.longitude != null && metersBetween(here, { latitude: a.latitude, longitude: a.longitude }) > NEAR_M) {
      setPhase('far');
      return;
    }
    await submit('proximity', here);
  };

  const tooEarly = !inCheckinWindow(a) && phase !== 'done';

  // One status line under the intro; the most relevant state wins.
  let note = null;
  if (error) note = { bg: colors.pinkSoft, title: error };
  else if (phase === 'far') note = { bg: colors.lavender, title: `You don’t seem to be near ${a.area || 'the plan'} yet.`, body: 'Location can be off indoors. If you’re there, check in without it.' };
  else if (phase === 'denied') note = { bg: colors.lavender, title: 'Couldn’t read your location', body: 'Permission is off or GPS timed out. Check in without it instead.' };
  else if (tooEarly) note = { bg: colors.orangeSoft, title: 'Check-in opens 30 minutes before the start.', glyph: ClockCountdown };

  if (phase === 'done') {
    return (
      <Screen
        bg={colors.periwinkle}
        header={<ScreenHeader title="Check in" variant="glass" />}
        footer={
          <View style={{ gap: space.xxs }}>
            <Button title="Open group chat" icon="message-circle" onPress={() => openGroupChat(nav, a)} />
            <Button title="We’re done, wrap up" variant="ghost" onPress={() => nav.navigate('activity_complete', { id })} />
          </View>
        }
      >
        <View style={{ alignItems: 'center', marginTop: space.md }}>
          <Mascot size={170} mood="celebrate" celebrateKey={1} />
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header" accessibilityLiveRegion="polite">
            Checked in. Have fun!
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
            Confirm it happened when you wrap up.
          </AppText>
        </View>
        <ListGroup style={{ marginTop: space.xl }}>
          <ListRow icon="share-2" title="Share with a trusted contact" onPress={() => nav.navigate('emergency_share', { activityId: a.id })} last />
        </ListGroup>
      </Screen>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="Check in" />}
      footer={
        <View style={{ gap: space.xxs }}>
          <Button title={phase === 'locating' ? 'Checking…' : 'Check in with location'} icon="gps" loading={phase === 'locating'} disabled={tooEarly || busy} onPress={tryProximity} />
          <Button title="Check in without location" variant="ghost" loading={busy} disabled={tooEarly || phase === 'locating'} onPress={manual} />
        </View>
      }
    >
      <PlanSummary activity={a} revealVenue={!!a.venueName} style={{ marginTop: space.xs }} />

      <View style={{ alignItems: 'center', marginTop: space.xl }}>
        <IconBubble size={72} tone="periwinkle" icon="gps" iconSize={36} />
        <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header">
          Made it?
        </AppText>
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
          Optional. It lets the group know you’ve arrived.
        </AppText>
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.sm, maxWidth: 300 }}>
          Location is read once for this check-in and never shown to others.
        </AppText>
      </View>

      {!!note && (
        <View style={{ backgroundColor: note.bg, borderRadius: radius.quest, padding: space.sm, marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }} accessibilityLiveRegion="polite">
          {!!note.glyph && <note.glyph size={18} color={colors.ink} weight="bold" style={{ marginRight: space.xs }} />}
          <View style={{ flex: 1 }}>
            <AppText variant="label">{note.title}</AppText>
            {!!note.body && (
              <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
                {note.body}
              </AppText>
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}
