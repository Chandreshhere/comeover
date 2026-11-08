// activity_checkin — optional proximity check-in with a manual fallback.
// Location is read once (getPrecisePosition), sent with the check-in for the
// server to verify, and never stored on the device or shown to anyone.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, Icon, Mascot, Screen, ScreenHeader } from '@/components';
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
      else if (e?.code === 'network' || e?.code === 'timeout') setError('No connection. Try again — or check in manually once you’re online.');
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

  return (
    <Screen
      bg={phase === 'done' ? colors.periwinkle : colors.canvas}
      header={<ScreenHeader title="Check in" variant={phase === 'done' ? 'glass' : 'surface'} />}
      footer={
        phase === 'done' ? (
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Button title="Group chat" icon="message-circle" variant="light" onPress={() => openGroupChat(nav, a)} style={{ flex: 1 }} />
            <Button title="We're done" full={false} onPress={() => nav.navigate('activity_complete', { id })} />
          </View>
        ) : (
          <View style={{ gap: space.xs }}>
            <Button title={phase === 'locating' ? 'Checking…' : 'Check in with location'} icon="crosshair" loading={phase === 'locating'} disabled={tooEarly || busy} onPress={tryProximity} />
            <Button title="I’m here — check in manually" variant="secondary" loading={busy} disabled={tooEarly || phase === 'locating'} onPress={manual} />
          </View>
        )
      }
    >
      {phase === 'done' ? (
        <View style={{ alignItems: 'center', marginTop: space.lg }}>
          <Mascot size={190} mood="celebrate" celebrateKey={1} />
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
            Checked in. Have fun!
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6, maxWidth: 300 }}>
            When it wraps up, confirm it happened — XP is awarded once the host or another attendee confirms too.
          </AppText>
          <Card style={{ marginTop: space.xl, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }} onPress={() => nav.navigate('emergency_share', { activityId: a.id })} accessibilityLabel="Share with a trusted contact">
            <Icon name="share-2" size={18} />
            <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }}>
              Share with a trusted contact
            </AppText>
            <Icon name="chevron-right" size={18} color={colors.muted} />
          </Card>
        </View>
      ) : (
        <>
          <PlanSummary activity={a} revealVenue={!!a.venueName} style={{ marginTop: space.xs }} />
          <AppText variant="h2" style={{ marginTop: space.xl }}>
            Made it?
          </AppText>
          <AppText color={colors.muted} style={{ marginTop: 4 }}>
            Checking in is optional. It helps the group know who’s arrived and builds your show-up record.
          </AppText>

          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, marginTop: space.md, gap: space.sm }}>
            <View style={{ flexDirection: 'row' }}>
              <Icon name="crosshair" size={16} color={colors.deep} style={{ marginTop: 2 }} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                Location check reads your position once and sends it with this check-in only. Nothing is tracked in the background or shown to others.
              </AppText>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Icon name="user-check" size={16} color={colors.deep} style={{ marginTop: 2 }} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                Prefer not to share location? Manual check-in works just as well — the group confirms afterwards.
              </AppText>
            </View>
          </View>

          {tooEarly && (
            <View style={{ backgroundColor: colors.orangeSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.md, flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="clock" size={16} />
              <AppText variant="caption" style={{ flex: 1, marginLeft: space.xs }}>
                Check-in opens 30 minutes before the start time.
              </AppText>
            </View>
          )}
          {phase === 'far' && (
            <View style={{ backgroundColor: colors.lavender, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }} accessibilityLiveRegion="polite">
              <AppText variant="label">You don’t seem to be near {a.area || 'the plan'} yet.</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                Location can be off indoors. If you’re there, use manual check-in.
              </AppText>
            </View>
          )}
          {phase === 'denied' && (
            <View style={{ backgroundColor: colors.lavender, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }} accessibilityLiveRegion="polite">
              <AppText variant="label">Couldn’t read your location</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                Permission is off or GPS timed out. Manual check-in works fine.
              </AppText>
            </View>
          )}
          {!!error && (
            <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }} accessibilityLiveRegion="polite">
              <AppText variant="caption">{error}</AppText>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
