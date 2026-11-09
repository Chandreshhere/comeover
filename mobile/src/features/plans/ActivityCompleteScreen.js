// activity_complete — mutual completion confirmation
// (POST /activities/{id}/completion-confirmations). XP is decided by the server:
// it is de-duplicated per activity and may only land once others confirm.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { CalendarX } from 'phosphor-react-native/src/icons/CalendarX';
import { Ghost } from 'phosphor-react-native/src/icons/Ghost';
import { SealCheck } from 'phosphor-react-native/src/icons/SealCheck';
import { Trophy } from 'phosphor-react-native/src/icons/Trophy';
import { AppText, Button, Mascot, OptionCard, Screen, ScreenHeader, Sheet } from '@/components';
import { IconBubble } from '@/components/Card';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { durations } from '@/theme/motion';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import usePlan from './usePlan';
import PlanSummary from './components/PlanSummary';
import Confetti from './components/Confetti';
import PlanGate from './components/PlanGate';

const NOT_HAPPENED = [
  { value: 'cancelled', title: 'It got cancelled', subtitle: 'Fair cancellations cost no one reliability', glyph: CalendarX },
  { value: 'i_missed', title: 'I couldn’t make it', subtitle: 'Thanks for being honest', icon: 'clock' },
  { value: 'no_show', title: 'Others didn’t show', subtitle: 'Reported privately', glyph: Ghost },
];

// XP counter roll-up (mascot_success). Instant under Reduce Motion.
function useCountUp(target, run) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    if (reduce || !target) {
      setV(target);
      return undefined;
    }
    let raf;
    const start = Date.now();
    const dur = durations.mascotSuccess;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, reduce]);
  return v;
}

export default function ActivityCompleteScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, isHost, loader } = usePlan();
  const confirmCompletion = useAppStore((s) => s.confirmCompletion);

  const [phase, setPhase] = useState(joinState === 'completed' ? 'already' : 'ask'); // ask | not | done | pending | already
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [levelSheet, setLevelSheet] = useState(false);
  const [reason, setReason] = useState(null);

  const shown = useCountUp(result?.xpAwarded || 0, phase === 'done');

  if (!a) return <PlanGate title="Wrap up" loader={loader} />;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmCompletion(id);
      setResult(r);
      if (r.duplicate) setPhase('already');
      else if (r.pendingOthers && !r.xpAwarded) setPhase('pending');
      else setPhase('done');
      if (!r.duplicate) {
        haptics.success();
        sfx.play('chime');
        if (r.leveledUp) setTimeout(() => setLevelSheet(true), durations.mascotSuccess + 200);
      }
    } catch (e) {
      if (e?.code === 'not_participant' || e?.code === 'http_403') setError('Only people who were accepted into this plan can confirm it.');
      else if (e?.code === 'too_early' || e?.code === 'not_started') setError('You can confirm once the plan has started.');
      else if (e?.code === 'network' || e?.code === 'timeout') setError('No connection. Your confirmation wasn’t sent. Try again.');
      else setError(e?.message || 'Couldn’t confirm. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toFeedback = () => nav.replace('post_activity_feedback', { id, outcome: reason || 'completed' });

  if (phase === 'done' || phase === 'already' || phase === 'pending') {
    const dup = phase === 'already';
    const pending = phase === 'pending';
    return (
      <Screen bg={colors.periwinkle} header={<ScreenHeader variant="glass" />} footer={<Button title={isHost ? 'Done' : 'Continue'} onPress={() => (isHost ? nav.navigate('my_activities', { tab: 'past' }) : toFeedback())} />}>
        <View style={{ alignItems: 'center', marginTop: space.xs }}>
          <View style={{ height: 200, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
            {!dup && !pending && <Confetti burstKey={1} style={{ top: 100 }} />}
            <Mascot size={180} mood={dup || pending ? 'idle' : 'celebrate'} celebrateKey={dup || pending ? null : 1} />
          </View>
          <AppText variant="display" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">
            {dup ? 'Already counted' : pending ? 'Almost there' : 'That’s a real-life win!'}
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
            {dup ? 'Each meetup only counts once.' : pending ? 'XP lands once the host or another attendee confirms.' : 'This one counts toward your quests and streak.'}
          </AppText>
          {!dup && !pending && (
            <View
              style={{ backgroundColor: colors.ink, borderRadius: radius.pill, paddingLeft: space.xs, paddingRight: space.lg, paddingVertical: space.xs, marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}
              accessible
              accessibilityLabel={`${result?.xpAwarded || 0} XP earned`}
            >
              <IconBubble size={40} tone="ink" bg={colors.orange} color={colors.ink} glyph={Trophy} iconSize={22} duo={colors.warning} />
              <AppText variant="h1" color={colors.white} style={{ marginLeft: space.sm }}>
                +{shown} XP
              </AppText>
            </View>
          )}
        </View>

        <Sheet
          visible={levelSheet}
          onClose={() => setLevelSheet(false)}
          footer={
            <View style={{ gap: space.xxs }}>
              <Button title="See my roadmap" onPress={() => { setLevelSheet(false); nav.navigate('social_roadmap'); }} />
              <Button title="Skip" variant="ghost" onPress={() => setLevelSheet(false)} />
            </View>
          }
        >
          <View style={{ alignItems: 'center' }}>
            <Mascot size={150} mood="celebrate" celebrateKey={levelSheet ? 2 : null} />
            <AppText variant="label" color={colors.deep} caps style={{ marginTop: space.sm }}>
              Level up
            </AppText>
            <AppText variant="h1" align="center">
              You’re now a {result?.level?.name}
            </AppText>
            <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xxs }}>
              Level {result?.level?.level} unlocked on your roadmap.
            </AppText>
          </View>
        </Sheet>
      </Screen>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="Wrap up" />}
      footer={
        phase === 'ask' ? (
          <View style={{ gap: space.xxs }}>
            <Button title="Yes, it happened" icon="check" loading={busy} onPress={confirm} />
            <Button title="It didn’t happen" variant="ghost" onPress={() => setPhase('not')} />
          </View>
        ) : (
          <View style={{ gap: space.xxs }}>
            <Button title="Continue" disabled={!reason} onPress={toFeedback} />
            <Button title="Back" variant="ghost" onPress={() => setPhase('ask')} />
          </View>
        )
      }
    >
      <PlanSummary activity={a} revealVenue={!!a.venueName} style={{ marginTop: space.xs }} />
      {!!error && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }} accessibilityLiveRegion="polite">
          <AppText variant="caption">{error}</AppText>
        </View>
      )}
      {phase === 'ask' ? (
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <IconBubble size={72} tone="mint" glyph={SealCheck} iconSize={36} />
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header">
            Did it happen?
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
            XP counts once the host or another attendee confirms too.
          </AppText>
        </View>
      ) : (
        <>
          <AppText variant="h2" style={{ marginTop: space.xl, marginBottom: space.sm }} accessibilityRole="header">
            What happened?
          </AppText>
          <View accessibilityRole="radiogroup">
            {NOT_HAPPENED.map((o) => (
              <OptionCard
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={reason === o.value}
                onPress={() => setReason(o.value)}
                left={<IconBubble size={40} shape="squircle" tone="periwinkle" bg={reason === o.value ? colors.periwinkle : undefined} glyph={o.glyph} icon={o.icon} iconSize={22} />}
              />
            ))}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            You can appeal any reliability change.
          </AppText>
        </>
      )}
    </Screen>
  );
}
