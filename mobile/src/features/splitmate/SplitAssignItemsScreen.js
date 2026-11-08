// split_assign_items — tap who had what; tax/tip split in proportion.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, EmptyState, IconButton, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
import { colors, space } from '@/theme/tokens';
import { inr } from '@/utils/format';
import { itemisedBreakdown, itemsSubtotal, localId, nameOf, newDraft, toMinor } from './lib/split';
import { LedgerNote, PersonAvatar, PersonToggle, Steps } from './components/SplitBits';

export default function SplitAssignItemsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const base = route.params?.draft || newDraft({ method: 'itemised' });
  const [items, setItems] = useState(base.items || []);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);

  const draft = useMemo(() => ({ ...base, method: 'itemised', items }), [base, items]);
  const breakdown = useMemo(() => itemisedBreakdown(draft), [draft]);
  const subtotal = itemsSubtotal(items);
  const extras = (base.taxMinor || 0) + (base.tipMinor || 0);
  const total = subtotal + extras;
  const unassigned = items.filter((it) => !(it.assignees || []).some((a) => base.participants.includes(a)));

  const toggle = (itemId, userId) =>
    setItems((list) =>
      list.map((it) => {
        if (it.id !== itemId) return it;
        const has = it.assignees.includes(userId);
        return { ...it, assignees: has ? it.assignees.filter((a) => a !== userId) : [...it.assignees, userId] };
      })
    );
  const everyone = (itemId) => setItems((list) => list.map((it) => (it.id === itemId ? { ...it, assignees: [...base.participants] } : it)));
  const remove = (itemId) => setItems((list) => list.filter((it) => it.id !== itemId));
  const add = () => {
    const m = toMinor(amount);
    if (!m) return;
    setItems((list) => [...list, { id: localId(), name: name.trim() || `Item ${list.length + 1}`, amountMinor: m, assignees: [...base.participants] }]);
    setName('');
    setAmount('');
  };

  const next = () => {
    setTouched(true);
    if (!items.length || unassigned.length) return;
    nav.navigate('split_summary', { draft: { ...draft, totalMinor: total } });
  };

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Who had what?" subtitle="Step 2 of 3" right={<IconButton icon="camera" accessibilityLabel="Scan or edit bill" onPress={() => nav.navigate('split_bill_scan', { draft })} />} />}
      footer={<Button title={`Review ${inr(total)}`} iconRight="arrow-right" onPress={next} disabled={touched && (!items.length || unassigned.length > 0)} />}
    >
      <Steps step={2} />

      {/* Live per-person totals */}
      <Card bg={colors.periwinkle} elevated={false}>
        <AppText variant="label" color={colors.inkSoft}>
          Running totals · {inr(total)}
          {extras ? ` incl. ${inr(extras)} tax/tip` : ''}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs }}>
          {breakdown.map((b) => (
            <View key={b.userId} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }} accessible accessibilityLabel={`${nameOf(b.userId)} ${inr(b.amountMinor)}`}>
              <PersonAvatar id={b.userId} size={28} />
              <View style={{ marginLeft: 8 }}>
                <AppText variant="caption" color={colors.inkSoft}>
                  {nameOf(b.userId)}
                </AppText>
                <AppText variant="bodyStrong">{inr(b.amountMinor)}</AppText>
              </View>
            </View>
          ))}
        </View>
      </Card>

      <SectionHeader title={`Items (${items.length})`} right={<AppText variant="label" color={colors.muted}>{inr(subtotal)}</AppText>} />
      {items.length === 0 ? (
        <EmptyState compact title="No items yet" body="Add what was ordered below, or scan the bill for reference." cta="Scan bill" onCta={() => nav.navigate('split_bill_scan', { draft })} />
      ) : (
        <View style={{ gap: space.sm }}>
          {items.map((it) => {
            const missing = !it.assignees.some((a) => base.participants.includes(a));
            return (
              <Card key={it.id} style={missing && touched ? { borderWidth: 1.5, borderColor: colors.danger } : null}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {it.name}
                    </AppText>
                    <AppText variant="caption" color={missing ? colors.danger : colors.muted}>
                      {missing ? 'Tap at least one person' : it.assignees.length === base.participants.length ? 'Shared by everyone' : `Split ${it.assignees.length} way${it.assignees.length > 1 ? 's' : ''}`}
                    </AppText>
                  </View>
                  <AppText variant="h3">{inr(it.amountMinor)}</AppText>
                  <IconButton icon="trash-2" variant="plain" size={36} accessibilityLabel={`Remove ${it.name}`} onPress={() => remove(it.id)} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
                  {base.participants.map((id) => (
                    <PersonToggle key={id} id={id} size="sm" name={nameOf(id)} selected={it.assignees.includes(id)} onPress={() => toggle(it.id, id)} />
                  ))}
                  {it.assignees.length !== base.participants.length && (
                    <Button title="Everyone" size="xs" variant="ghost" full={false} onPress={() => everyone(it.id)} />
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <SectionHeader title="Add an item" />
      <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
        <TextField style={{ flex: 1.6 }} value={name} onChangeText={setName} placeholder="e.g. Pav bhaji" />
        <TextField style={{ flex: 1 }} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))} placeholder="₹ 0" keyboardType="decimal-pad" onSubmitEditing={add} />
        <IconButton icon="plus" variant="ink" size={52} accessibilityLabel="Add item" onPress={add} />
      </View>

      <LedgerNote style={{ marginTop: space.md }} text="Tax and tip are shared in proportion to what each person had, rounded to the paisa so it always adds up." />
    </Screen>
  );
}
