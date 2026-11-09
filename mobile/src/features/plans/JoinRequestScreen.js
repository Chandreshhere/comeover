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

// Safety notes appear once, here, right before someone commits to meeting.
const TIPS = [
  { icon: 'map-pin', text: 'The exact spot unlocks once you’re accepted.' },
  { icon: 'log-out', text: 'You can leave any time. No explanation needed.' },
  { icon: 'flag', text: 'Report or block from the plan or chat menu.' },
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
  const approval = a.joinRule === 'approval';
  const hostName = a.host?.name || 'the host';

  return (
    <Screen
      bg={colors.canvas}
      keyboard
      edges={MODAL_EDGES}
      header={<ScreenHeader title="Request to join" onBack={() => nav.goBack()} />}
      footer={
        error?.code === 'capacity_full' ? (
          <View style={{ gap: space.xxs }}>
            <Button title="Go to the waitlist" icon="list" onPress={() => nav.replace('waitlist', { id })} />
            <Button title="Find a similar plan" variant="ghost" onPress={() => nav.replace('category_results', { category: a.category })} />
          </View>
        ) : (
          <Button
            title={already ? 'Request already sent' : approval ? 'Send request' : 'Join plan'}
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
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
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
        placeholder="e.g. Hey! I’m nearby and up for this."
        helper={approval ? `${hostName} also sees your name, level and show-up rate.` : 'No contact details, please.'}
      />

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.xs }}>
        {TIPS.map((t, i) => (
          <View key={t.icon} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, borderBottomWidth: i === TIPS.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <Icon name={t.icon} size={16} color={colors.deep} />
            <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
              {t.text}
            </AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}
