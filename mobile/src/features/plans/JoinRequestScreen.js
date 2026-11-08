// join_request (modal) — request to join with an optional short intro.
// POST /activities/{id}/join-requests; the server checks capacity, age and blocks.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { MODAL_EDGES } from '@/features/discover/utils';
import usePlan from './usePlan';
import { joinErrorCopy } from './joinActions';
import PlanSummary from './components/PlanSummary';
import PlanGate from './components/PlanGate';

const TIPS = [
  { icon: 'map-pin', text: 'Meet at the listed public spot — the exact place unlocks after you’re accepted.' },
  { icon: 'share-2', text: 'Share the plan with someone you trust.' },
  { icon: 'log-out', text: 'You can leave any time. No explanation needed.' },
  { icon: 'flag', text: 'Report or block from the plan or chat, whenever you need.' },
];

export default function JoinRequestScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, loader } = usePlan();
  const requestJoin = useAppStore((s) => s.requestJoin);
  const ageConfirmed = useAppStore((s) => s.session.ageConfirmed);
  const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { code, title, body }

  if (!a) return <PlanGate title="Request to join" loader={loader} edges={MODAL_EDGES} />;

  const submit = async () => {
    if (!ageConfirmed) {
      nav.navigate('age_gate', { returnTo: { screen: 'join_request', params: { id } } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await requestJoin(id, intro.trim());
      const next = r === 'accepted' ? 'join_accepted' : r === 'waitlisted' ? 'waitlist' : 'join_pending';
      nav.replace(next, { id });
    } catch (e) {
      if (e?.code === 'age_gate_required') {
        nav.navigate('age_gate', { returnTo: { screen: 'join_request', params: { id } } });
      } else {
        setError({ code: e?.code, ...joinErrorCopy(e) });
      }
      setBusy(false);
    }
  };

  const already = ['requested', 'accepted', 'checked_in'].includes(joinState);
  const hostName = a.host?.name || 'the host';

  return (
    <Screen
      bg={colors.canvas}
      keyboard
      edges={MODAL_EDGES}
      header={<ScreenHeader title="Request to join" onBack={() => nav.goBack()} />}
      footer={
        error?.code === 'capacity_full' ? (
          <View style={{ gap: space.xs }}>
            <Button title="Go to the waitlist" icon="list" onPress={() => nav.replace('waitlist', { id })} />
            <Button title="Find a similar plan" variant="ghost" onPress={() => nav.replace('category_results', { category: a.category })} />
          </View>
        ) : (
          <Button
            title={already ? 'Request already sent' : a.joinRule === 'approval' ? 'Send request' : 'Join plan'}
            icon="send"
            loading={busy}
            disabled={already || error?.code === 'account_restricted'}
            onPress={submit}
          />
        )
      }
    >
      <PlanSummary activity={a} style={{ marginTop: space.xs }} />

      {error && (
        <View style={{ backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.md, marginTop: space.md }} accessibilityLiveRegion="polite">
          <AppText variant="bodyStrong">{error.title}</AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
            {error.body}
          </AppText>
        </View>
      )}

      <SectionHeader title={`Say hi to ${hostName}`} right={<AppText variant="caption" color={colors.muted}>Optional</AppText>} />
      <TextField
        value={intro}
        onChangeText={setIntro}
        multiline
        maxLength={140}
        placeholder="e.g. Hey! I'm nearby and up for this — happy to join."
        helper="Keep it short and friendly. No contact details — chat opens after you're accepted."
      />

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name={a.joinRule === 'approval' ? 'user-check' : 'zap'} size={18} />
          <AppText variant="bodyStrong" style={{ marginLeft: space.xs }}>
            {a.joinRule === 'approval' ? 'Host approves each request' : 'Instant join'}
          </AppText>
        </View>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
          {a.joinRule === 'approval'
            ? `${hostName} sees your first name, level, show-up rate and intro. If accepted, the group chat and exact meeting spot unlock.`
            : 'You’ll get the group chat and exact meeting spot straight away.'}
          {a.cost ? ` Cost: ${a.cost}.` : ''}
        </AppText>
      </View>

      <SectionHeader title="Before you go" />
      <View style={{ backgroundColor: colors.periwinkleWash, borderRadius: radius.card, padding: space.md, gap: space.sm }}>
        {TIPS.map((t) => (
          <View key={t.icon} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Icon name={t.icon} size={16} color={colors.deep} style={{ marginTop: 2 }} />
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
              {t.text}
            </AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}
