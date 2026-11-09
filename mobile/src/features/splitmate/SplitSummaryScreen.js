// split_summary — step 3: the bill, how to split it (equal / custom / % /
// itemised) and each share. Validates that shares add up exactly, then records
// the expense in the ledger.
// Custom and % start prefilled with a valid split (the current equal split /
// an even percentage that totals exactly 100), and guidance only appears once
// the person has edited a value — never a red error before they touch anything.
import React, { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, HeroCard, Icon, ProgressBar, Screen, ScreenHeader, SectionHeader, Segmented } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import haptics from '@/utils/haptics';
import {
  METHODS,
  computeShares,
  draftTotal,
  equalAmounts,
  evenPercents,
  fillBlanks,
  itemisedBreakdown,
  minorToInput,
  money,
  nameOf,
  newDraft,
  toMinor,
} from './lib/split';
import { Hint, MoneyInput, PersonAvatar, useKnownPeople } from './components/SplitBits';

const pctOf = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);
const pctLabel = (n) => `${Math.round(n * 100) / 100}%`;

// One line under the method picker.
const METHOD_HELP = {
  equal: 'Everyone pays the same, exact to the paisa.',
  custom: 'Type each amount. They must add up to the total.',
  percentage: 'Set each share in %. They must total 100%.',
  itemised: 'From your items. Tax and tip shared in proportion.',
};

export default function SplitSummaryScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const narrow = useWindowDimensions().width < 360;
  const addExpense = useAppStore((s) => s.addExpense);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const conversations = useAppStore((s) => s.conversations);

  const base = useMemo(() => route.params?.draft || newDraft(), [route.params?.draft]);
  const ids = base.participants;
  useKnownPeople(ids); // real names instead of a placeholder
  const baseTotal = base.totalMinor || draftTotal({ ...base, method: 'itemised' });
  const itemisedAvailable = (base.items || []).length > 0;

  const [method, setMethod] = useState(base.method);
  const [customText, setCustomText] = useState(() => {
    const given = ids.some((id) => base.custom?.[id]);
    const amounts = given ? base.custom : equalAmounts(baseTotal, ids);
    return Object.fromEntries(ids.map((id) => [id, minorToInput(amounts[id])]));
  });
  const [pctText, setPctText] = useState(() => {
    const given = ids.some((id) => base.percent?.[id] != null);
    const pct = given ? base.percent : evenPercents(ids);
    return Object.fromEntries(ids.map((id) => [id, pct[id] != null ? String(pct[id]) : '']));
  });
  // Validation guidance shows only after the person edits that method.
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const draft = useMemo(
    () => ({
      ...base,
      method,
      totalMinor: method === 'itemised' ? draftTotal({ ...base, method }) : baseTotal,
      custom: Object.fromEntries(Object.entries(customText).map(([k, v]) => [k, toMinor(v)])),
      percent: Object.fromEntries(Object.entries(pctText).map(([k, v]) => [k, parseFloat(v) || 0])),
    }),
    [base, baseTotal, method, customText, pctText]
  );
  const result = useMemo(() => computeShares(draft), [draft]);
  const breakdown = useMemo(() => (method === 'itemised' ? Object.fromEntries(itemisedBreakdown(draft).map((b) => [b.userId, b])) : {}), [draft, method]);
  const methods = itemisedAvailable ? METHODS : METHODS.filter((m) => m.value !== 'itemised');
  const pctSum = useMemo(() => Math.round(ids.reduce((s, id) => s + (parseFloat(pctText[id]) || 0), 0) * 100) / 100, [ids, pctText]);
  const remaining = result.total - result.assigned;

  const setAll = (amounts) => setCustomText(Object.fromEntries(ids.map((id) => [id, minorToInput(amounts[id])])));
  const resetEqual = () => {
    haptics.select();
    setAll(equalAmounts(result.total, ids));
    setDirty((d) => ({ ...d, custom: false }));
  };
  const resetPercents = () => {
    haptics.select();
    const even = evenPercents(ids);
    setPctText(Object.fromEntries(ids.map((id) => [id, String(even[id])])));
    setDirty((d) => ({ ...d, percentage: false }));
  };
  const blanksFill = method === 'custom' ? fillBlanks(draft.custom, ids, result.total) : null;

  // Switching to Custom keeps the split you were looking at (equal, % or
  // items) as the starting amounts, unless you've already typed your own.
  const changeMethod = (next) => {
    if (next === method) return;
    if (next === 'custom' && !dirty.custom) {
      const keep = result.valid && result.total === baseTotal;
      const shares = keep ? Object.fromEntries(result.shares.map((s) => [s.userId, s.amountMinor])) : equalAmounts(baseTotal, ids);
      setAll(shares);
    }
    setError(null);
    setMethod(next);
  };

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
        sendMessage(conv.id, `🧾 Added “${e.description}” (${money(e.totalMinor)}) to SplitMate. Check your share in the plan's split.`).catch(() => null);
      }
      haptics.success();
      nav.reset({ index: 2, routes: [{ name: 'main' }, { name: 'splitmate_home' }, { name: 'split_settlement', params: { expenseId: e.id } }] });
    } catch (err) {
      setError(err?.status === 0 || err?.code === 'network' || err?.code === 'timeout' ? 'No connection. The split wasn’t saved. Try again.' : err?.message || 'Couldn’t save the split. Try again.');
      setSaving(false);
    }
  };

  const assignedRatio = result.total ? Math.min(1, result.assigned / result.total) : 0;
  const payerName = nameOf(draft.payeeId, 'You');
  const editing = method === 'custom' || method === 'percentage';
  let guide = null;
  if (!result.valid) {
    if (result.total <= 0) {
      guide = <Hint tone="warn" title="No bill total yet" body="Go back one step and enter the total (or add items) to split it." />;
    } else if (editing && !dirty[method]) {
      // Untouched but not adding up (e.g. amounts carried over from an edit): guide, don't scold.
      guide = (
        <Hint tone="info" title={method === 'custom' ? `Amounts need to add up to ${money(result.total)}` : 'Percentages need to add up to 100%'} body="Adjust the values below, or start from an even split.">
          <View style={{ flexDirection: 'row', marginTop: space.xs }}>
            <Button title="Use an even split" icon="rotate-ccw" size="xs" variant="secondary" full={false} onPress={method === 'custom' ? resetEqual : resetPercents} />
          </View>
        </Hint>
      );
    } else if (method === 'custom') {
      guide = (
        <Hint
          tone="warn"
          icon="lightbulb"
          title={remaining > 0 ? `${money(remaining)} left to assign` : `${money(-remaining)} more than the bill`}
          body={remaining > 0 ? `Add it to someone's share so everything adds up to ${money(result.total)}.` : `Lower someone's share so it adds up to ${money(result.total)}.`}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
            {blanksFill ? (
              <Button
                title={`Spread ${money(remaining)} over blank rows`}
                size="xs"
                variant="secondary"
                full={false}
                onPress={() => {
                  haptics.select();
                  setAll(blanksFill);
                }}
              />
            ) : null}
            <Button title="Reset to equal" icon="rotate-ccw" size="xs" variant="secondary" full={false} onPress={resetEqual} />
          </View>
        </Hint>
      );
    } else if (method === 'percentage') {
      const off = Math.round((100 - pctSum) * 100) / 100;
      guide = (
        <Hint tone="warn" icon="lightbulb" title={off > 0 ? `${pctLabel(off)} left to share` : `${pctLabel(-off)} too much`} body={`Percentages add up to ${pctLabel(pctSum)}. They need to total 100%.`}>
          <View style={{ flexDirection: 'row', marginTop: space.xs }}>
            <Button title="Reset to even split" icon="rotate-ccw" size="xs" variant="secondary" full={false} onPress={resetPercents} />
          </View>
        </Hint>
      );
    } else {
      guide = <Hint tone="warn" title="Almost there" body={result.error} />;
    }
  }

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Review split" subtitle="Step 3 of 3" />}
      footer={<Button title={result.total > 0 ? `Save split · ${money(result.total)}` : 'Save split'} icon="check" onPress={confirm} disabled={!result.valid} loading={saving} />}
    >
      {/* The bill */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
        <HeroCard>
          <AppText variant="label" color={colors.inkSoft} numberOfLines={1}>
            {draft.description || 'Shared bill'}
          </AppText>
          <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {money(result.total)}
          </AppText>
          <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
            {draft.payeeId === 'me' ? 'You paid' : `${payerName} paid`} · {ids.length} people
            {draft.payeeUpi ? ` · ${draft.payeeUpi}` : ''}
          </AppText>
        </HeroCard>
      </Animated.View>

      {/* Method */}
      <SectionHeader title="How to split" />
      <Segmented options={methods} value={method} onChange={changeMethod} />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        {METHOD_HELP[method]}
      </AppText>

      {/* Shares */}
      <SectionHeader
        title="Shares"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {result.valid ? <Icon name="check-circle" size={15} color={colors.success} weight="fill" style={{ marginRight: space.xxs }} /> : null}
            <AppText variant="label" color={result.valid ? colors.success : colors.inkSoft}>
              {money(result.assigned)} of {money(result.total)}
            </AppText>
          </View>
        }
      />
      {editing ? <ProgressBar value={assignedRatio} fill={result.valid ? colors.success : colors.warning} style={{ marginBottom: space.sm }} accessibilityLabel={`${money(result.assigned)} of ${money(result.total)} assigned`} /> : null}
      {guide ? <View style={{ marginBottom: space.sm }}>{guide}</View> : null}

      <Card style={{ paddingVertical: space.xxs }}>
        {ids.map((id, i) => {
          const share = result.shares.find((s) => s.userId === id)?.amountMinor || 0;
          const b = breakdown[id];
          const isPayer = id === draft.payeeId;
          const detail =
            method === 'itemised' && b
              ? `${money(b.itemsMinor)} items + ${money(b.extrasMinor)} tax/tip`
              : method === 'percentage'
              ? money(share)
              : method === 'custom'
              ? `${pctLabel(pctOf(draft.custom[id] || 0, result.total))} of the bill`
              : isPayer
              ? null
              : `Owes ${draft.payeeId === 'me' ? 'you' : payerName}`;
          const caption = isPayer ? ['Paid the bill', detail].filter(Boolean).join(' · ') : detail;
          return (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.xs, borderBottomWidth: i === ids.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <PersonAvatar id={id} size={40} />
              <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {nameOf(id)}
                </AppText>
                {caption ? (
                  <AppText variant="caption" color={colors.muted} numberOfLines={2}>
                    {caption}
                  </AppText>
                ) : null}
              </View>
              {method === 'custom' ? (
                <MoneyInput
                  width={narrow ? 104 : 116}
                  label={`${nameOf(id)}'s amount in rupees`}
                  value={customText[id]}
                  onChange={(v) => {
                    setCustomText((c) => ({ ...c, [id]: v }));
                    setDirty((d) => ({ ...d, custom: true }));
                  }}
                />
              ) : method === 'percentage' ? (
                <MoneyInput
                  label={`${nameOf(id)}'s percent`}
                  suffix="%"
                  width={narrow ? 104 : 116}
                  value={pctText[id]}
                  onChange={(v) => {
                    setPctText((c) => ({ ...c, [id]: v }));
                    setDirty((d) => ({ ...d, percentage: true }));
                  }}
                />
              ) : (
                <AppText variant="h3" style={{ textAlign: 'right' }}>
                  {money(share)}
                </AppText>
              )}
            </View>
          );
        })}
      </Card>

      {editing && dirty[method] && result.valid ? (
        <AppText variant="label" color={colors.deep} onPress={method === 'custom' ? resetEqual : resetPercents} accessibilityRole="button" suppressHighlighting style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
          {method === 'custom' ? 'Reset to equal' : 'Reset to even split'}
        </AppText>
      ) : null}

      {error ? <Hint tone="warn" icon="wifi-off" title="Not saved yet" body={error} style={{ marginTop: space.sm, backgroundColor: colors.pinkSoft }} /> : null}
    </Screen>
  );
}
