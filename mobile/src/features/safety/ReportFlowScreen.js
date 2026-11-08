// Report flow (modal): reason → details → confirmation. Free for everyone.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, ListGroup, ListRow, OptionCard, Pictogram, ProgressBar, Screen, ScreenHeader, TextField } from '@/components';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import { REPORT_REASONS, callEmergency, reasonTitle } from './shared';
import usePerson from './usePerson';

export default function ReportFlowScreen() {
  const nav = useNavigation();
  const { userId, activityId, messageId, circleId } = useRoute().params || {};
  const activities = useAppStore((s) => s.activities);
  const circles = useAppStore((s) => s.circles);
  const blocked = useAppStore((s) => s.blocked);
  const submitReport = useAppStore((s) => s.submitReport);
  const blockUser = useAppStore((s) => s.blockUser);

  const [step, setStep] = useState('reason'); // reason | details | done
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [evidence, setEvidence] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [caseId, setCaseId] = useState(null);
  const [blockFailed, setBlockFailed] = useState(false);

  const { person, name: personName } = usePerson(userId);
  const activity = useMemo(() => (activityId ? activities.find((a) => a.id === activityId) : null), [activities, activityId]);
  const circle = useMemo(() => (circleId ? circles.find((c) => c.id === circleId) : null), [circles, circleId]);
  const subject = userId ? personName : activity ? activity.title : circle ? circle.name : messageId ? 'A message' : activityId ? 'A plan' : circleId ? 'A circle' : null;
  const subjectKind = userId ? 'Person' : activityId ? 'Plan' : circleId ? 'Circle' : messageId ? 'Message' : null;
  const isBlocked = userId ? blocked.includes(userId) : false;

  // Fetch plan context if we arrived via a deep link / notification.
  useEffect(() => {
    if (activityId && !activity) useAppStore.getState().loadActivity(activityId, { silent: true }).catch(() => {});
  }, [activityId, activity]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setBlockFailed(false);
    let res;
    try {
      // POST /reports (or /messages/{id}/report server-side when messageId is set).
      res = await submitReport({
        reasonCode: reason,
        details: details.trim(),
        evidence: evidence.trim() || undefined,
        reportedUserId: userId,
        activityId,
        messageId,
        circleId,
      });
    } catch (e) {
      setError(
        e.code === 'network' || e.code === 'timeout'
          ? "You're offline, so the report wasn't sent. Your text is still here — try again when connected."
          : e.message || "Couldn't send your report. Your text is still here — try again."
      );
      setSubmitting(false);
      return;
    }
    if (alsoBlock && userId && !isBlocked) {
      try {
        await blockUser(userId);
      } catch (e) {
        setBlockFailed(true); // report is in; offer block again on the done screen
      }
    }
    haptics.success();
    setCaseId(res?.id || null);
    setStep('done');
    setSubmitting(false);
  };

  const onBack = () => {
    if (step === 'details') setStep('reason');
    else nav.goBack();
  };

  if (step === 'done') {
    return (
      <Screen
        header={<ScreenHeader title="Report sent" back={false} right={null} />}
        footer={
          <View style={{ gap: space.xs }}>
            {userId && !isBlocked && (!alsoBlock || blockFailed) ? <Button title={`Block ${personName}`} variant="secondary" icon="slash" onPress={() => nav.replace('block_confirm', { userId })} /> : null}
            <Button title="Done" onPress={() => nav.goBack()} />
          </View>
        }
      >
        <View style={{ alignItems: 'center', marginTop: space.lg }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="shield" size={44} />
          </View>
          <AppText variant="h1" align="center" style={{ marginTop: space.md }}>
            Thanks — we've got it
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs }}>
            {caseId ? `Case ${String(caseId).slice(-6).toUpperCase()} · ` : ''}
            {reasonTitle(reason)}
          </AppText>
          {alsoBlock && userId && !blockFailed ? (
            <AppText variant="label" color={colors.success} style={{ marginTop: space.xs }}>
              {person?.name || 'They'} {person ? 'is' : 'are'} also blocked.
            </AppText>
          ) : null}
          {blockFailed ? (
            <AppText variant="label" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
              Report sent, but blocking didn't go through. Tap Block below to try again.
            </AppText>
          ) : null}
        </View>
        <Card style={{ marginTop: space.xl }}>
          {[
            ['check-circle', 'Received', "Your report is logged. The other person isn't told who reported them."],
            ['eye', 'Reviewed by a person', reason === 'underage' || reason === 'safety_threat' ? 'Prioritised — we aim to act within hours.' : 'Usually within 24–48 hours. We may limit the account while we look.'],
            ['bell', 'Outcome', 'You’ll get a notification and can see the status in Safety center.'],
          ].map(([icon, title, body], i) => (
            <View key={title} style={{ flexDirection: 'row', marginBottom: i === 2 ? 0 : space.md }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: i === 0 ? colors.ink : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={16} color={i === 0 ? colors.white : colors.ink} />
              </View>
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{title}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  {body}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
        <Card elevated={false} bg={colors.ink} style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="caption" color={colors.white} style={{ flex: 1 }}>
            If you're in danger right now, call {config.EMERGENCY_NUMBER_IN}.
          </AppText>
          <Button title="Call" size="xs" variant="light" full={false} onPress={callEmergency} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Report" subtitle={`Step ${step === 'reason' ? 1 : 2} of 2`} onBack={onBack} />}
      footer={
        step === 'reason' ? (
          <Button title="Continue" disabled={!reason} onPress={() => setStep('details')} />
        ) : (
          <Button title="Send report" icon="send" loading={submitting} disabled={reason === 'other' && !details.trim()} onPress={submit} />
        )
      }
    >
      <ProgressBar value={step === 'reason' ? 0.5 : 1} style={{ marginTop: space.xs }} accessibilityLabel="Report progress" />

      {subject ? (
        <Card style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }} padding={12}>
          {userId ? (
            <Avatar seed={person?.avatarSeed || userId} uri={person?.avatarUrl} size={40} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={activity?.pictogram || circle?.pictogram || 'chat'} size={22} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="caption" color={colors.muted}>
              Reporting {subjectKind?.toLowerCase()}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {subject}
            </AppText>
          </View>
        </Card>
      ) : null}

      {step === 'reason' ? (
        <>
          <AppText variant="h2" style={{ marginTop: space.lg, marginBottom: space.sm }}>
            What's going on?
          </AppText>
          {REPORT_REASONS.map((r) => (
            <OptionCard key={r.code} title={r.title} subtitle={r.subtitle} selected={reason === r.code} onPress={() => setReason(r.code)} />
          ))}
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            Reports are confidential. False reports to harm someone can lead to action on your account.
          </AppText>
        </>
      ) : (
        <>
          <AppText variant="h2" style={{ marginTop: space.lg }}>
            {reasonTitle(reason)}
          </AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, marginBottom: space.md }}>
            A few details help our team act quickly. Only the safety team sees this.
          </AppText>
          <TextField
            label={reason === 'other' ? 'What happened? (required)' : 'What happened? (optional)'}
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={1000}
            placeholder="When, where, and what was said or done."
          />
          <TextField
            label="Evidence (optional)"
            value={evidence}
            onChangeText={setEvidence}
            multiline
            maxLength={500}
            placeholder="e.g. messages in the plan's group chat on Tuesday"
            helper="Our team can view the relevant in-app chat context for this case. Never send us passwords or payment PINs."
          />
          {userId && !isBlocked ? (
            <ListGroup>
              <ListRow icon="slash" title={`Also block ${personName}`} subtitle="They won't be notified" toggle={alsoBlock} onToggle={setAlsoBlock} last />
            </ListGroup>
          ) : null}
          {error ? (
            <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          ) : null}
        </>
      )}
    </Screen>
  );
}
