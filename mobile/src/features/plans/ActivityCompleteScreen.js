// activity_complete — mutual completion confirmation
// (POST /activities/{id}/completion-confirmations). XP is decided by the server:
// it is de-duplicated per activity and may only land once others confirm.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Mascot, OptionCard, ProgressBar, Screen, ScreenHeader, Sheet } from '@/components';
import { levelFor, useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { durations } from '@/theme/motion';
import haptics from '@/utils/haptics';
import usePlan from './usePlan';
import PlanSummary from './components/PlanSummary';
import Confetti from './components/Confetti';
import PlanGate from './components/PlanGate';

const NOT_HAPPENED = [
  { value: 'cancelled', title: 'It got cancelled', subtitle: 'Nobody loses reliability for a fair cancellation' },
  { value: 'i_missed', title: 'I couldn’t make it', subtitle: 'Thanks for being honest — it helps the group' },
  { value: 'no_show', title: 'Others didn’t show', subtitle: 'Reported privately; mutual confirmation protects you' },
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
  const xp = useAppStore((s) => s.progress.xp);

  const [phase, setPhase] = useState(joinState === 'completed' ? 'already' : 'ask'); // ask | not | done | pending | already
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [levelSheet, setLevelSheet] = useState(false);
  const [reason, setReason] = useState(null);

  const shown = useCountUp(result?.xpAwarded || 0, phase === 'done');
  const lvl = levelFor(xp);

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
        if (r.leveledUp) setTimeout(() => setLevelSheet(true), durations.mascotSuccess + 200);
      }
    } catch (e) {
      if (e?.code === 'not_participant' || e?.code === 'http_403') setError('Only people who were accepted into this plan can confirm it.');
      else if (e?.code === 'too_early' || e?.code === 'not_started') setError('You can confirm once the plan has started.');
      else if (e?.code === 'network' || e?.code === 'timeout') setError('No connection. Your confirmation wasn’t sent — try again.');
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
        <View style={{ alignItems: 'center', marginTop: space.md }}>
          <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}>
            {!dup && !pending && <Confetti burstKey={1} style={{ top: 100 }} />}
            <Mascot size={200} mood={dup || pending ? 'idle' : 'celebrate'} celebrateKey={dup || pending ? null : 1} />
          </View>
          <AppText variant="display" align="center" accessibilityLiveRegion="polite">
            {dup ? 'Already confirmed' : pending ? 'Waiting for the others to confirm' : 'That’s a real-life win!'}
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6, maxWidth: 310 }}>
            {dup
              ? 'XP for this plan was already counted — each meetup only counts once.'
              : pending
                ? 'Your confirmation is in. XP lands as soon as the host or another attendee confirms too — we’ll let you know.'
                : 'Confirmed by the group. This one counts toward your quests and streak.'}
          </AppText>
          {!dup && !pending && (
            <View style={{ backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 10, marginTop: space.lg }} accessible accessibilityLabel={`${result?.xpAwarded || 0} XP earned`}>
              <AppText variant="h1" color={colors.white}>
                +{shown} XP
              </AppText>
            </View>
          )}
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: radius.card, padding: space.md, marginTop: space.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText variant="bodyStrong">
              Level {lvl.level} · {lvl.name}
            </AppText>
            <AppText variant="label">{xp} XP</AppText>
          </View>
          <ProgressBar value={lvl.ratio} style={{ marginTop: space.xs }} track="rgba(255,255,255,0.75)" accessibilityLabel="Progress to next level" />
          {lvl.next && (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
              {lvl.next.xp - xp} XP to {lvl.next.name}
            </AppText>
          )}
        </View>

        <Sheet
          visible={levelSheet}
          onClose={() => setLevelSheet(false)}
          footer={
            <View style={{ gap: space.xs }}>
              <Button title="See my roadmap" onPress={() => { setLevelSheet(false); nav.navigate('social_roadmap'); }} />
              <Button title="Skip" variant="ghost" onPress={() => setLevelSheet(false)} />
            </View>
          }
        >
          <View style={{ alignItems: 'center' }}>
            <Mascot size={150} mood="celebrate" celebrateKey={levelSheet ? 2 : null} />
            <AppText variant="label" color={colors.deep} style={{ marginTop: space.sm }}>
              LEVEL UP
            </AppText>
            <AppText variant="h1" align="center">
              You’re now a {result?.level?.name}
            </AppText>
            <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6 }}>
              Level {result?.level?.level} unlocked on your social roadmap.
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
          <View style={{ gap: space.xs }}>
            <Button title="Yes, it happened" icon="check" loading={busy} onPress={confirm} />
            <Button title="It didn’t happen" variant="secondary" onPress={() => setPhase('not')} />
          </View>
        ) : (
          <View style={{ gap: space.xs }}>
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
        <>
          <AppText variant="h1" style={{ marginTop: space.xl }}>
            Did it happen?
          </AppText>
          <AppText color={colors.muted} style={{ marginTop: 4 }}>
            Completion is mutual: the host and at least one other attendee confirm. That’s what keeps XP and reliability honest.
          </AppText>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, marginTop: space.lg, gap: space.sm }}>
            {[
              ['check-circle', 'Only verified meetups count toward quests and streaks'],
              ['repeat', 'Each plan can only award XP once'],
              ['lock', 'Your answer is private — no public ratings'],
            ].map(([icon, text]) => (
              <View key={icon} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name={icon} size={16} color={colors.deep} />
                <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                  {text}
                </AppText>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <AppText variant="h2" style={{ marginTop: space.xl, marginBottom: space.sm }}>
            What happened?
          </AppText>
          <View accessibilityRole="radiogroup">
            {NOT_HAPPENED.map((o) => (
              <OptionCard key={o.value} title={o.title} subtitle={o.subtitle} selected={reason === o.value} onPress={() => setReason(o.value)} />
            ))}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            Disputes are reviewed fairly, and you can appeal any reliability change.
          </AppText>
        </>
      )}
    </Screen>
  );
}
