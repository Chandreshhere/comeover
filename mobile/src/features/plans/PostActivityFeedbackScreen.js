// post_activity_feedback — private feedback only (no public ratings). Feeds
// reliability and safety signals; serious issues go through report_flow.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { ReduceMotion, ZoomIn } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { HandHeart } from 'phosphor-react-native/src/icons/HandHeart';
import { AppText, Avatar, Button, Card, Icon, Screen, ScreenHeader, SectionHeader, TextField, usePressScale } from '@/components';
import { IconBubble } from '@/components/Card';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import usePlan from './usePlan';
import PlanGate from './components/PlanGate';

const QUESTIONS = [
  { key: 'wentWell', q: 'Did it go well?' },
  { key: 'hostReliable', q: 'Was the host reliable?', hostOnly: false },
  { key: 'feltSafe', q: 'Did you feel safe?' },
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const thanksPop = ZoomIn.springify().damping(12).stiffness(200).reduceMotion(ReduceMotion.System);

function YesNoOption({ selected, text, icon, label, onPress }) {
  const press = usePressScale(0.95);
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}: ${text}`}
      style={[
        {
          flex: 1,
          height: 48,
          borderRadius: radius.pill,
          paddingHorizontal: space.sm,
          backgroundColor: selected ? colors.ink : colors.surface,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        },
        press.style,
      ]}
    >
      <Icon name={icon} size={18} color={selected ? colors.white : colors.ink} weight={selected ? 'fill' : 'bold'} />
      <AppText variant="label" color={selected ? colors.white : colors.ink} numberOfLines={1} style={{ marginLeft: space.xs, flexShrink: 1 }}>
        {text}
      </AppText>
    </AnimatedPressable>
  );
}

function YesNo({ value, onChange, label }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup">
      <YesNoOption selected={value === true} text="Yes" icon="thumbs-up" label={label} onPress={() => onChange(true)} />
      <YesNoOption selected={value === false} text="Not really" icon="thumbs-down" label={label} onPress={() => onChange(false)} />
    </View>
  );
}

export default function PostActivityFeedbackScreen() {
  const nav = useNavigation();
  const { id, activity: a, isHost, params, loader } = usePlan();
  const submitFeedback = useAppStore((s) => s.submitFeedback);
  const existing = useAppStore((s) => s.feedback[id]);

  const [answers, setAnswers] = useState({ wentWell: null, hostReliable: null, feltSafe: null });
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!a) return <PlanGate title="Feedback" loader={loader} />;

  const qs = QUESTIONS.filter((q) => !(q.key === 'hostReliable' && isHost));
  const unsafe = answers.feltSafe === false;
  const canSend = qs.some((q) => answers[q.key] !== null) || note.trim().length > 0;
  const hostId = a.host?.id;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitFeedback(id, { ...answers, note: note.trim(), outcome: params.outcome || 'completed' });
      haptics.success();
      setSent(true);
    } catch (e) {
      if (e?.code === 'already_submitted') setSent(true);
      else setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Your feedback wasn’t sent. Try again.' : e?.message || 'Couldn’t send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen bg={colors.canvas} header={<ScreenHeader title="Feedback" />} footer={<Button title="Back to discover" onPress={() => nav.navigate('main')} />}>
        <View style={{ alignItems: 'center', marginTop: space.xxl }}>
          <Animated.View entering={thanksPop}>
            <IconBubble size={96} tone="mint" glyph={HandHeart} iconSize={50} />
          </Animated.View>
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header" accessibilityLiveRegion="polite">
            Thanks. That’s private
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xxs, maxWidth: 300 }}>
            Nobody sees what you said. It quietly shapes reliability and safety.
          </AppText>
          <Button title="Something felt wrong? Report it" variant="ghost" full={false} align="center" icon="flag" style={{ marginTop: space.lg }} onPress={() => nav.navigate('report_flow', { activityId: a.id, userId: isHost ? undefined : hostId })} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      keyboard
      header={
        <ScreenHeader
          title="Private feedback"
          right={
            <Pressable onPress={() => nav.navigate('main')} accessibilityRole="button" accessibilityLabel="Skip feedback" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <AppText variant="label" color={colors.muted}>
                Skip
              </AppText>
            </Pressable>
          }
        />
      }
      footer={<Button title="Send privately" icon="lock" disabled={!canSend} loading={busy} onPress={send} />}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <Avatar seed={hostId || a.id} uri={a.host?.avatarUrl} size={44} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {a.title}
          </AppText>
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {isHost ? 'You hosted' : `Hosted by ${a.host?.name || 'the host'}`} · {a.joinedCount} people
          </AppText>
        </View>
      </Card>
      {!!error && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }} accessibilityLiveRegion="polite">
          <AppText variant="caption">{error}</AppText>
        </View>
      )}

      <SectionHeader title="How was it?" right={<AppText variant="caption" color={colors.muted}>Only we see this</AppText>} />
      <Card>
        {qs.map((q, i) => (
          <View key={q.key} style={{ marginTop: i ? space.md : 0 }}>
            <AppText variant="bodyStrong" style={{ marginBottom: space.xs }}>
              {q.q}
            </AppText>
            <YesNo label={q.q} value={answers[q.key]} onChange={(v) => setAnswers((x) => ({ ...x, [q.key]: v }))} />
          </View>
        ))}
      </Card>

      {unsafe && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.card, padding: space.md, marginTop: space.md }} accessibilityLiveRegion="assertive">
          <AppText variant="bodyStrong">We’re sorry. Tell us what happened.</AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
            Reports go to our safety team, not the other person. In danger now? Call 112.
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm }}>
            <Button title="Report" icon="flag" size="sm" variant="danger" full={false} align="center" onPress={() => nav.navigate('report_flow', { activityId: a.id, userId: isHost ? undefined : hostId })} />
            <Button title="Safety center" size="sm" variant="ghost" full={false} align="center" onPress={() => nav.navigate('safety_center')} />
          </View>
        </View>
      )}

      <SectionHeader title="Anything else?" right={<AppText variant="caption" color={colors.muted}>Optional</AppText>} />
      <TextField value={note} onChangeText={setNote} multiline maxLength={300} placeholder="A private note for the Come Over team" helper="Never shown to other members." />
    </Screen>
  );
}
