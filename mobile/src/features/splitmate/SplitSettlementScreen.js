// split_settlement — the bill, your share (pay via UPI / mark paid) and where
// everyone stands. One filled action: paying your share.
// No custody: we open the user's UPI app with a prefilled intent and record
// what people report. "Marked paid" is a claim until the payer confirms.
import React, { useMemo, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, EmptyState, HeroCard, Icon, IconButton, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Sheet, TextField } from '@/components';
import { colors, glass, radius, space } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { relativeDay } from '@/utils/format';
import haptics from '@/utils/haptics';
import { METHOD_LABEL, money, nameOf, settledCount, upiUrl } from './lib/split';
import { Hint, LedgerNote, PersonAvatar, StatusTag, useKnownPeople } from './components/SplitBits';

const shareErrorText = (err, kind) => {
  if (err?.status === 403) return kind === 'confirmed' ? 'Only the person who paid the bill can confirm a payment.' : 'You can only update your own share.';
  if (err?.status === 0 || err?.code === 'network' || err?.code === 'timeout') return 'No connection, nothing was changed. Try again.';
  return err?.message || 'Couldn’t update the split. Try again.';
};

export default function SplitSettlementScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const expenseId = route.params?.expenseId;
  const expenses = useAppStore((s) => s.expenses);
  const activities = useAppStore((s) => s.activities);
  const conversations = useAppStore((s) => s.conversations);
  const setShareState = useAppStore((s) => s.setShareState);
  const sendMessage = useAppStore((s) => s.sendMessage);
  useAppStore((s) => s.users); // re-render names as profiles arrive
  const expenseL = useLoader(`expense:${expenseId}`, (s) => s.loadExpense(expenseId), [expenseId]);

  const e = useMemo(() => expenses.find((x) => x.id === expenseId), [expenses, expenseId]);
  useKnownPeople(e ? [e.payeeId, ...(e.shares || []).map((sh) => sh.userId)] : []);
  const plan = useMemo(() => (e?.activityId ? activities.find((a) => a.id === e.activityId) : null), [e, activities]);
  const conv = useMemo(() => (e?.activityId ? conversations.find((c) => c.activityId === e.activityId) : null), [e, conversations]);

  const [sheet, setSheet] = useState(null); // { kind: 'paid' | 'dispute', userId }
  const [ref, setRef] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null); // userId whose share is being updated
  const [actionError, setActionError] = useState(null);

  if (!e) {
    return (
      <Screen header={<ScreenHeader title="Split" />}>
        <QueryState status={expenseL.status} error={expenseL.error} hasData={false} onRetry={expenseL.reload} skeletonRows={3} skeletonHeight={110}>
          <EmptyState title="Split not found" body="It may have been removed by the person who created it." cta="Back to SplitMate" onCta={() => nav.navigate('splitmate_home')} />
        </QueryState>
      </Screen>
    );
  }

  const updateShare = async (userId, state, paymentReference, successNotice) => {
    if (busy) return false;
    setBusy(userId);
    setActionError(null);
    try {
      await setShareState(e.id, userId, state, paymentReference);
      haptics.success();
      if (successNotice) setNotice(successNotice);
      return true;
    } catch (err) {
      setActionError(shareErrorText(err, state));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const iAmPayee = e.payeeId === 'me';
  const payeeName = nameOf(e.payeeId);
  const mine = e.shares.find((s) => s.userId === 'me');
  const done = settledCount(e);
  const outstanding = e.shares.filter((s) => s.state !== 'confirmed').reduce((n, s) => n + s.amountMinor, 0);

  const payViaUpi = async () => {
    if (!mine || !e.payeeUpi) return;
    const url = upiUrl({ payeeUpi: e.payeeUpi, payeeName, amountMinor: mine.amountMinor, note: e.description });
    try {
      await Linking.openURL(url);
      setNotice(`After paying in your UPI app, come back and tap “I've paid” so ${payeeName} can confirm.`);
    } catch (err) {
      setNotice(`No UPI app found on this device. Pay ${payeeName} at ${e.payeeUpi} any way you like, then tap “I've paid”.`);
    }
  };

  const remind = async () => {
    if (!conv) return;
    const pending = e.shares.filter((s) => s.state === 'unsettled' && s.userId !== e.payeeId).map((s) => nameOf(s.userId, 'me'));
    try {
      await sendMessage(conv.id, `Friendly nudge 🧾 “${e.description}”:${pending.join(', ')} still to settle. Shares are in SplitMate.`);
      setNotice('Reminder posted in the plan’s group chat.');
    } catch (err) {
      setActionError('Couldn’t post the reminder. Check your connection and try again.');
    }
  };

  const closeSheet = () => {
    setSheet(null);
    setRef('');
  };

  const submitSheet = async () => {
    if (!sheet) return;
    const ok =
      sheet.kind === 'paid'
        ? await updateShare(sheet.userId, 'marked_paid', ref.trim() || undefined, `Marked as paid. ${payeeName} will confirm once they see it.`)
        : await updateShare(sheet.userId, 'disputed', ref.trim() || undefined, 'Marked as disputed. Sort it out in chat, nothing is charged or reversed by Come Over.');
    if (ok) closeSheet();
  };

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={expenseL.refreshing} onRefresh={expenseL.reload} tintColor={colors.ink} />}
      header={
        <ScreenHeader
          title="Settle up"
          subtitle={relativeDay(e.createdAt)}
          right={plan ? <IconButton icon="calendar" accessibilityLabel={`Open plan: ${plan.title}`} onPress={() => nav.navigate('activity_detail', { id: plan.id })} /> : null}
        />
      }
    >
      {/* The bill */}
      <HeroCard style={{ marginTop: space.xs }}>
        <AppText variant="label" color={colors.inkSoft} numberOfLines={1}>
          {e.description}
        </AppText>
        <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {money(e.totalMinor)}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
          Paid by {iAmPayee ? 'you' : payeeName} · {METHOD_LABEL[e.splitMethod] || 'Split'}
        </AppText>
        <ProgressBar value={done / e.shares.length} style={{ marginTop: space.md }} track={glass(0.6)} fill={colors.ink} accessibilityLabel={`${done} of ${e.shares.length} settled`} />
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
          {done}/{e.shares.length} settled · {money(outstanding)} outstanding
        </AppText>
      </HeroCard>

      {/* Your share */}
      {!iAmPayee && mine && (
        <Card style={{ marginTop: space.md }} bg={mine.state === 'confirmed' ? colors.mint : colors.surface}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color={colors.muted}>
                Your share
              </AppText>
              <AppText variant="h1">{money(mine.amountMinor)}</AppText>
            </View>
            <StatusTag state={mine.state} style={{ alignSelf: 'center' }} />
          </View>
          {mine.state === 'unsettled' || mine.state === 'disputed' ? (
            <>
              {e.payeeUpi ? (
                <>
                  <Button title={`Pay ${money(mine.amountMinor)} via UPI`} icon="external-link" style={{ marginTop: space.md }} onPress={payViaUpi} />
                  <AppText variant="caption" color={colors.muted} selectable style={{ marginTop: space.xs }}>
                    Opens your UPI app with {e.payeeUpi} filled in.
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
                  {payeeName} hasn't added a UPI ID. Ask in chat, or pay in cash.
                </AppText>
              )}
              <Button title="I've paid" variant="secondary" icon="check" style={{ marginTop: space.sm }} disabled={busy === 'me'} onPress={() => setSheet({ kind: 'paid', userId: 'me' })} />
            </>
          ) : mine.state === 'marked_paid' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
              <Icon name="clock" size={14} color={colors.inkSoft} />
              <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: space.xs, flex: 1 }}>
                Waiting for {payeeName} to confirm{mine.paymentReference ? ` · ref ${mine.paymentReference}` : ''}.
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
              {payeeName} confirmed your payment. All square!
            </AppText>
          )}
        </Card>
      )}

      {notice ? <Hint tone="info" body={notice} style={{ marginTop: space.sm }} /> : null}
      {actionError && !sheet ? (
        <View style={{ flexDirection: 'row', backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }} accessibilityLiveRegion="assertive">
          <Icon name="alert-circle" size={15} color={colors.danger} style={{ marginTop: 1 }} />
          <AppText variant="caption" color={colors.ink} style={{ flex: 1, marginLeft: space.xs }}>
            {actionError}
          </AppText>
        </View>
      ) : null}

      {/* Everyone */}
      <SectionHeader title="Everyone" action={iAmPayee && conv ? 'Remind' : undefined} onAction={remind} />
      <Card style={{ paddingVertical: space.xxs }}>
        {e.shares.map((sh, i) => {
          const isPayee = sh.userId === e.payeeId;
          return (
            <View key={sh.userId} style={{ paddingVertical: space.sm, borderBottomWidth: i === e.shares.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
                <PersonAvatar id={sh.userId} size={40} />
                <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {nameOf(sh.userId)}
                  </AppText>
                  <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                    {isPayee ? 'Paid the bill · ' : ''}
                    {money(sh.amountMinor)}
                    {sh.paymentReference ? ` · ref ${sh.paymentReference}` : ''}
                  </AppText>
                </View>
                <StatusTag state={sh.state} style={{ alignSelf: 'center' }} />
              </View>
              {iAmPayee && !isPayee && sh.state !== 'confirmed' && (
                <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm, marginLeft: 40 + space.sm }}>
                  <Button
                    title={sh.state === 'marked_paid' ? 'Confirm received' : 'Mark received'}
                    size="xs"
                    variant="secondary"
                    icon="check"
                    full={false}
                    loading={busy === sh.userId}
                    disabled={!!busy}
                    onPress={() => updateShare(sh.userId, 'confirmed', undefined, `Confirmed ${nameOf(sh.userId)}'s payment.`)}
                  />
                  {sh.state === 'marked_paid' && <Button title="Not received" size="xs" variant="ghost" full={false} disabled={!!busy} onPress={() => setSheet({ kind: 'dispute', userId: sh.userId })} />}
                </View>
              )}
            </View>
          );
        })}
      </Card>

      {!iAmPayee && mine && mine.state !== 'disputed' && mine.state !== 'confirmed' && (
        <Button title="Something's wrong with my share" variant="ghost" size="sm" style={{ marginTop: space.sm }} onPress={() => setSheet({ kind: 'dispute', userId: 'me' })} />
      )}

      <LedgerNote style={{ marginTop: space.xl }} />

      <Sheet
        visible={!!sheet}
        onClose={closeSheet}
        title={sheet?.kind === 'paid' ? 'Mark as paid' : 'Flag a problem'}
        footer={<Button title={sheet?.kind === 'paid' ? 'Mark as paid' : 'Mark disputed'} variant={sheet?.kind === 'paid' ? 'primary' : 'danger'} loading={!!busy} disabled={!!busy} onPress={submitSheet} />}
      >
        {actionError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginBottom: space.sm }} accessibilityLiveRegion="assertive">
            {actionError}
          </AppText>
        ) : null}
        <AppText color={colors.inkSoft} style={{ marginBottom: space.md }}>
          {sheet?.kind === 'paid' ? `${payeeName} will be asked to confirm. Never share your UPI PIN.` : 'This only flags the share. Come Over never charges or refunds.'}
        </AppText>
        <TextField
          label={sheet?.kind === 'paid' ? 'UPI reference (optional)' : 'What’s wrong? (optional)'}
          value={ref}
          onChangeText={setRef}
          maxLength={sheet?.kind === 'paid' ? 40 : 120}
          autoCapitalize="none"
          placeholder={sheet?.kind === 'paid' ? 'e.g. 4321 0987 6543' : 'e.g. Amount should be ₹150'}
        />
      </Sheet>
    </Screen>
  );
}
