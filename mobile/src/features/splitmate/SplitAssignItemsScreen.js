// split_assign_items — live per-person totals, then tap who had what on each
// item; tax/tip split in proportion.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, ChipGrid, IconButton, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
import { colors, space } from '@/theme/tokens';
import { itemisedBreakdown, itemsSubtotal, localId, money, nameOf, newDraft, toMinor } from './lib/split';
import { Hint, PersonAvatar, PersonToggle, useKnownPeople } from './components/SplitBits';

export default function SplitAssignItemsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const base = route.params?.draft || newDraft({ method: 'itemised' });
  const [items, setItems] = useState(base.items || []);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  useKnownPeople(base.participants);

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
      footer={<Button title={items.length ? `Review ${money(total)}` : 'Review split'} iconRight="arrow-right" onPress={next} disabled={touched && (!items.length || unassigned.length > 0)} />}
    >
      {/* Live per-person totals */}
      <Card style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="h3" style={{ flex: 1 }}>
            Per person
          </AppText>
          <AppText variant="h3">{money(total)}</AppText>
        </View>
        {extras ? (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            Includes {money(extras)} tax and tip, shared in proportion
          </AppText>
        ) : null}
        <ChipGrid columns={2} gap={space.sm} style={{ marginTop: space.sm }}>
          {breakdown.map((b) => (
            <View key={b.userId} style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={`${nameOf(b.userId)} ${money(b.amountMinor)}`}>
              <PersonAvatar id={b.userId} size={32} />
              <View style={{ marginLeft: space.xs, flex: 1 }}>
                <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
                  {nameOf(b.userId)}
                </AppText>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {money(b.amountMinor)}
                </AppText>
              </View>
            </View>
          ))}
        </ChipGrid>
      </Card>

      {/* Items */}
      <SectionHeader title={`Items (${items.length})`} right={<AppText variant="label" color={colors.muted}>{money(subtotal)}</AppText>} />
      {items.length === 0 ? (
        <AppText color={colors.muted}>No items yet. Add one below.</AppText>
      ) : (
        <View style={{ gap: space.sm }}>
          {items.map((it) => {
            const missing = !it.assignees.some((a) => base.participants.includes(a));
            const all = it.assignees.length === base.participants.length;
            return (
              <Card key={it.id} style={missing ? { borderWidth: 1.5, borderColor: touched ? colors.danger : colors.warning } : null}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {it.name}
                    </AppText>
                    <AppText variant="caption" color={missing && touched ? colors.danger : colors.muted}>
                      {missing ? 'Tap at least one person' : all ? 'Shared by everyone' : `Split ${it.assignees.length} way${it.assignees.length > 1 ? 's' : ''}`}
                    </AppText>
                  </View>
                  <AppText variant="h3" style={{ marginLeft: space.xs }}>
                    {money(it.amountMinor)}
                  </AppText>
                  <IconButton icon="trash-2" variant="plain" size={40} accessibilityLabel={`Remove ${it.name}`} onPress={() => remove(it.id)} style={{ marginLeft: space.xxs, marginRight: -space.xs }} />
                </View>
                <ChipGrid columns={2} style={{ marginTop: space.sm }}>
                  {base.participants.map((id) => (
                    <PersonToggle key={id} id={id} size="sm" name={nameOf(id)} fill selected={it.assignees.includes(id)} onPress={() => toggle(it.id, id)} />
                  ))}
                </ChipGrid>
                {!all && (
                  <AppText variant="label" color={colors.deep} onPress={() => everyone(it.id)} accessibilityRole="button" suppressHighlighting style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
                    Select everyone
                  </AppText>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {touched && unassigned.length > 0 ? (
        <Hint tone="warn" style={{ marginTop: space.sm }} title={`${unassigned.length} item${unassigned.length > 1 ? 's need' : ' needs'} someone`} body="Tap at least one person on each highlighted item." />
      ) : null}

      {/* Add */}
      <SectionHeader title="Add an item" />
      <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
        <TextField style={{ flex: 1.5, marginBottom: 0 }} value={name} onChangeText={setName} placeholder="e.g. Pav bhaji" accessibilityLabel="Item name" />
        <TextField style={{ flex: 1, marginBottom: 0 }} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))} placeholder="₹ 0" keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={add} accessibilityLabel="Item price in rupees" />
        <IconButton icon="plus" variant="ink" size={52} accessibilityLabel="Add item" onPress={add} />
      </View>
    </Screen>
  );
}
