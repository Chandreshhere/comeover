// post_activity_feedback — private feedback only (no public ratings). Feeds
// reliability and safety signals; serious issues go through report_flow.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
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

function YesNo({ value, onChange, label }) {
  const opt = (v, text, icon) => {
    const sel = value === v;
    return (
      <Pressable
        onPress={() => {
          haptics.select();
          onChange(v);
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: sel }}
        accessibilityLabel={`${label}: ${text}`}
        style={{
          flex: 1,
          height: 48,
          borderRadius: radius.pill,
          backgroundColor: sel ? colors.ink : colors.surface,
          borderWidth: 1.2,
          borderColor: sel ? colors.ink : colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={16} color={sel ? colors.white : colors.ink} />
        <AppText variant="label" color={sel ? colors.white : colors.ink} style={{ marginLeft: 6 }}>
          {text}
        </AppText>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup">
      {opt(true, 'Yes', 'thumbs-up')}
      {opt(false, 'Not really', 'thumbs-down')}
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
      else setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection — your feedback wasn’t sent. Try again.' : e?.message || 'Couldn’t send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen bg={colors.canvas} header={<ScreenHeader title="Feedback" />} footer={<Button title="Back to discover" onPress={() => nav.navigate('main')} />}>
        <View style={{ alignItems: 'center', marginTop: space.xxl }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={36} />
          </View>
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
            Thanks — that’s private
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6, maxWidth: 300 }}>
            Your feedback shapes reliability and safety quietly. Nobody sees what you said.
          </AppText>
          <Button title="Something felt wrong? Report it" variant="ghost" full={false} icon="flag" style={{ marginTop: space.lg }} onPress={() => nav.navigate('report_flow', { activityId: a.id, userId: isHost ? undefined : hostId })} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      bg={colors.canvas}
      keyboard
      header={<ScreenHeader title="Private feedback" right={<AppText variant="label" color={colors.muted} onPress={() => nav.navigate('main')} accessibilityRole="button">Skip</AppText>} />}
      footer={<Button title="Send privately" icon="lock" disabled={!canSend} loading={busy} onPress={send} />}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <Avatar seed={hostId || a.id} uri={a.host?.avatarUrl} size={44} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {a.title}
          </AppText>
          <AppText variant="caption" color={colors.muted}>
            {isHost ? 'You hosted' : `Hosted by ${a.host?.name || 'the host'}`} · {a.joinedCount} people
          </AppText>
        </View>
      </Card>
      {!!error && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }} accessibilityLiveRegion="polite">
          <AppText variant="caption">{error}</AppText>
        </View>
      )}

      {qs.map((q) => (
        <View key={q.key}>
          <SectionHeader title={q.q} />
          <YesNo label={q.q} value={answers[q.key]} onChange={(v) => setAnswers((x) => ({ ...x, [q.key]: v }))} />
        </View>
      ))}

      {unsafe && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.md, marginTop: space.md }} accessibilityLiveRegion="assertive">
          <AppText variant="bodyStrong">We’re sorry. You can tell us what happened.</AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4 }}>
            A report goes to our safety team, not to the other person. If you’re in danger right now, call 112.
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}>
            <Button title="Report" icon="flag" size="sm" variant="danger" full={false} onPress={() => nav.navigate('report_flow', { activityId: a.id, userId: isHost ? undefined : hostId })} />
            <Button title="Safety center" size="sm" variant="secondary" full={false} onPress={() => nav.navigate('safety_center')} />
          </View>
        </View>
      )}

      <SectionHeader title="Anything else?" right={<AppText variant="caption" color={colors.muted}>Optional</AppText>} />
      <TextField value={note} onChangeText={setNote} multiline maxLength={300} placeholder="Private note for the IRL team" helper="Never shown to other members. No public star ratings here." />
    </Screen>
  );
}
