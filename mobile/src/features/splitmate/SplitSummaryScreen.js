// split_summary — review shares (equal / custom / % / itemised), validate that
// they add up exactly, then record the expense in the ledger.
import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, HeroCard, Icon, ProgressBar, Screen, ScreenHeader, SectionHeader, Segmented } from '@/components';
import { colors, fonts, radius, space } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
import { inr } from '@/utils/format';
import haptics from '@/utils/haptics';
import { METHODS, METHOD_LABEL, computeShares, draftTotal, itemisedBreakdown, minorToInput, nameOf, newDraft, toMinor } from './lib/split';
import { LedgerNote, PersonAvatar, Steps } from './components/SplitBits';

function AmountInput({ value, onChange, suffix, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: 12, paddingHorizontal: 10, width: 112, borderWidth: 1, borderColor: colors.border }}>
      {!suffix && (
        <AppText variant="label" color={colors.muted}>
          ₹
        </AppText>
      )}
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, paddingVertical: 8, textAlign: 'right' }}
      />
      {suffix && (
        <AppText variant="label" color={colors.muted} style={{ marginLeft: 2 }}>
          {suffix}
        </AppText>
      )}
    </View>
  );
}

export default function SplitSummaryScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const addExpense = useAppStore((s) => s.addExpense);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const conversations = useAppStore((s) => s.conversations);
  const meName = useAppStore((s) => s.profile.name);

  const base = route.params?.draft || newDraft();
  const itemisedAvailable = (base.items || []).length > 0;
  const [method, setMethod] = useState(base.method);
  const [customText, setCustomText] = useState(() => Object.fromEntries(base.participants.map((id) => [id, minorToInput(base.custom?.[id])])));
  const [pctText, setPctText] = useState(() => {
    const even = Math.floor((100 / base.participants.length) * 100) / 100;
    return Object.fromEntries(base.participants.map((id, i) => [id, base.percent?.[id] != null ? String(base.percent[id]) : String(i === 0 ? Math.round((100 - even * (base.participants.length - 1)) * 100) / 100 : even)]));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const draft = useMemo(
    () => ({
      ...base,
      method,
      totalMinor: method === 'itemised' ? draftTotal({ ...base, method }) : base.totalMinor || draftTotal({ ...base, method: 'itemised' }),
      custom: Object.fromEntries(Object.entries(customText).map(([k, v]) => [k, toMinor(v)])),
      percent: Object.fromEntries(Object.entries(pctText).map(([k, v]) => [k, parseFloat(v) || 0])),
    }),
    [base, method, customText, pctText]
  );
  const result = useMemo(() => computeShares(draft), [draft]);
  const breakdown = useMemo(() => (method === 'itemised' ? Object.fromEntries(itemisedBreakdown(draft).map((b) => [b.userId, b])) : {}), [draft, method]);
  const methods = itemisedAvailable ? METHODS : METHODS.filter((m) => m.value !== 'itemised');

  const confirm = async () => {
    if (!result.valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const e = await addExpense({
        clientId: draft.clientId,
        activityId: draft.activityId || null,
        description: draft.description || 'Shared bill',
        totalMinor: result.total,
        splitMethod: method,
        payeeId: draft.payeeId,
        payeeUpi: draft.payeeUpi || '',
        items: method === 'itemised' ? draft.items.map(({ id, name, amountMinor, assignees }) => ({ id, name, amountMinor, assignees })) : undefined,
        receiptKey: draft.receiptKey || undefined,
        // The payer's own share is settled by definition (server validates).
        shares: result.shares.map((s) => ({ userId: s.userId, amountMinor: s.amountMinor, state: s.userId === draft.payeeId ? 'confirmed' : 'unsettled' })),
      });
      const conv = draft.activityId ? conversations.find((c) => c.activityId === draft.activityId) : null;
      if (conv) {
        // Best effort: the split is saved even if the chat note fails.
        sendMessage(conv.id, `🧾 Added “${e.description}” (${inr(e.totalMinor)}) to SplitMate — check your share in the plan's split.`).catch(() => null);
      }
      haptics.success();
      nav.reset({ index: 2, routes: [{ name: 'main' }, { name: 'splitmate_home' }, { name: 'split_settlement', params: { expenseId: e.id } }] });
    } catch (err) {
      setError(err?.status === 0 || err?.code === 'network' || err?.code === 'timeout' ? 'No connection — the split wasn’t saved. Try again.' : err?.message || 'Couldn’t save the split. Try again.');
      setSaving(false);
    }
  };

  const assignedRatio = result.total ? Math.min(1, result.assigned / result.total) : 0;

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Review split" subtitle="Step 3 of 3" />}
      footer={<Button title={`Save split · ${inr(result.total)}`} icon="check" onPress={confirm} disabled={!result.valid} loading={saving} />}
    >
      <Steps step={3} />
      <HeroCard>
        <AppText variant="caption" color={colors.inkSoft}>
          {draft.description || 'Shared bill'}
        </AppText>
        <AppText variant="display">{inr(result.total)}</AppText>
        <AppText variant="label" color={colors.inkSoft}>
          Paid by {nameOf(draft.payeeId, meName ? `You (${meName})` : 'You')} · {draft.participants.length} people · {METHOD_LABEL[method]}
        </AppText>
        {draft.payeeUpi ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
            <Icon name="at-sign" size={13} />
            <AppText variant="caption" style={{ marginLeft: 4 }}>
              Pay to {draft.payeeUpi}
            </AppText>
          </View>
        ) : null}
      </HeroCard>

      <SectionHeader title="Split method" />
      <Segmented options={methods} value={method} onChange={setMethod} />

      <SectionHeader title="Shares" right={<AppText variant="label" color={result.valid ? colors.success : colors.muted}>{inr(result.assigned)} / {inr(result.total)}</AppText>} />
      <ProgressBar value={assignedRatio} fill={result.valid ? colors.success : colors.ink} accessibilityLabel="Amount assigned" />
      {result.error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={14} color={colors.danger} />
          <AppText variant="caption" color={colors.danger} style={{ marginLeft: 6, flex: 1 }}>
            {result.error}
          </AppText>
        </View>
      ) : null}

      <Card style={{ marginTop: space.sm, paddingVertical: 4 }}>
        {draft.participants.map((id, i) => {
          const share = result.shares.find((s) => s.userId === id);
          const b = breakdown[id];
          return (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i === draft.participants.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <PersonAvatar id={id} size={38} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">
                  {nameOf(id)}
                  {id === draft.payeeId ? ' · paid' : ''}
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  {method === 'itemised' && b ? `${inr(b.itemsMinor)} items + ${inr(b.extrasMinor)} tax/tip` : method === 'percentage' ? `${inr(share?.amountMinor || 0)}` : id === draft.payeeId ? 'Already settled' : 'Owes the payer'}
                </AppText>
              </View>
              {method === 'custom' ? (
                <AmountInput label={`${nameOf(id)} amount`} value={customText[id]} onChange={(v) => setCustomText((c) => ({ ...c, [id]: v }))} />
              ) : method === 'percentage' ? (
                <AmountInput label={`${nameOf(id)} percent`} suffix="%" value={pctText[id]} onChange={(v) => setPctText((c) => ({ ...c, [id]: v }))} />
              ) : (
                <AppText variant="h3">{inr(share?.amountMinor || 0)}</AppText>
              )}
            </View>
          );
        })}
      </Card>

      {method === 'custom' && !result.valid && result.total > 0 && (
        <Button
          title="Fill the rest equally"
          size="sm"
          variant="secondary"
          full={false}
          style={{ marginTop: space.sm }}
          onPress={() => {
            const ids = draft.participants;
            const per = Math.floor(result.total / ids.length);
            const rem = result.total - per * ids.length;
            setCustomText(Object.fromEntries(ids.map((id, i) => [id, minorToInput(per + (i < rem ? 1 : 0))])));
          }}
        />
      )}

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.sm, marginTop: space.lg }}>
        <Icon name="users" size={15} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          Everyone in the split will see their share and can mark it paid. Only the payer can confirm a payment was received.
        </AppText>
      </View>
      <LedgerNote style={{ marginTop: space.sm }} />
    </Screen>
  );
}
