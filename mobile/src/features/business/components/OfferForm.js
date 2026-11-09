// Create / edit form for a venue offer (controlled: the parent owns `form`).
// Ranges follow the contract: percent 5 to 50, flat ₹10 to ₹5,000, group 1 to
// 20, level 1 to 10, show-up 0 to 100%, IST days and times, 1 to 7 uses a week.
import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Chip, ChipGrid, IconButton, ListGroup, ListRow, Segmented, TextField } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import Stepper from '@/features/create/components/Stepper';
import { FieldLabel } from '@/features/create/components/StepScaffold';
import { ALL_DAYS, clockLabel, DAY_LONG, DAY_SHORT, levelName, OFFER_KINDS, SHOW_UP_OPTIONS, WEEK_ORDER, windowLabel } from '../perks';

const STEP = 30;
const DAY_PRESETS = [
  { key: 'all', label: 'Every day', days: ALL_DAYS },
  { key: 'weekdays', label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { key: 'weekends', label: 'Weekends', days: [0, 6] },
];
const sameDays = (a, b) => a.length === b.length && a.every((d) => b.includes(d));
const timeText = (m) => (m >= 1440 ? 'Midnight' : clockLabel(m));

function TimeRow({ label, value, min, max, onChange, last }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: timeText(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + STEP));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - STEP));
      }}
    >
      <AppText variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </AppText>
      <IconButton icon="minus" size={40} accessibilityLabel={`Earlier ${label.toLowerCase()} time`} onPress={() => onChange(Math.max(min, value - STEP))} style={{ opacity: value <= min ? 0.4 : 1 }} />
      <AppText variant="bodyStrong" align="center" style={{ width: 92 }}>
        {timeText(value)}
      </AppText>
      <IconButton icon="plus" size={40} accessibilityLabel={`Later ${label.toLowerCase()} time`} onPress={() => onChange(Math.min(max, value + STEP))} style={{ opacity: value >= max ? 0.4 : 1 }} />
    </View>
  );
}

function DayToggle({ day, selected, onPress }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={DAY_LONG[day]}
      hitSlop={4}
      style={{
        flex: 1,
        height: layout.minTouch,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? colors.ink : colors.surface,
        borderWidth: 1.2,
        borderColor: selected ? colors.ink : colors.border,
      }}
    >
      <AppText variant="label" color={selected ? colors.white : colors.inkSoft} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {DAY_SHORT[day].slice(0, 2)}
      </AppText>
    </Pressable>
  );
}

export default function OfferForm({ form, onChange, errors = {}, showErrors }) {
  const set = (patch) => onChange({ ...form, ...patch });
  const err = (k) => (showErrors ? errors[k] : null);
  const allDay = form.startMinute === 0 && form.endMinute === 1440;
  const toggleDay = (d) => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] });
  const lvName = levelName(form.minLevel);

  return (
    <View>
      <FieldLabel>The offer</FieldLabel>
      <TextField label="Title" value={form.title} onChangeText={(t) => set({ title: t })} placeholder="e.g. 15% off the bill" maxLength={60} error={err('title')} />
      <TextField
        label="Details (optional)"
        value={form.description}
        onChangeText={(t) => set({ description: t })}
        placeholder="Anything members should know"
        multiline
        maxLength={240}
        error={err('description')}
      />
      <Segmented options={OFFER_KINDS} value={form.kind} onChange={(k) => set({ kind: k, value: k === 'freebie' ? '' : k === form.kind ? form.value : k === 'percent' ? '15' : '100' })} />
      {form.kind === 'freebie' ? (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
          Say what is free in the title, like “Free chai for the group”.
        </AppText>
      ) : (
        <TextField
          label={form.kind === 'percent' ? 'Discount (%)' : 'Amount off (₹)'}
          value={form.value}
          onChangeText={(t) => set({ value: t.replace(/[^0-9]/g, '').slice(0, 4) })}
          placeholder={form.kind === 'percent' ? '15' : '100'}
          keyboardType="number-pad"
          helper={form.kind === 'percent' ? '5 to 50 percent' : '₹10 to ₹5,000, whole rupees'}
          error={err('value')}
          style={{ marginTop: space.md }}
        />
      )}

      <FieldLabel>Who can use it</FieldLabel>
      <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
        Smallest group
      </AppText>
      <Stepper value={form.minGroup} onChange={(v) => set({ minGroup: v })} min={1} max={20} label="Smallest group" suffix={form.minGroup === 1 ? 'person' : 'people'} />
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: 6 }}>
        Lowest level
      </AppText>
      <Stepper value={form.minLevel} onChange={(v) => set({ minLevel: v })} min={1} max={10} label="Lowest level" suffix={lvName || 'level'} />
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: 6 }}>
        Show-up rate
      </AppText>
      <ChipGrid columns={3}>
        {SHOW_UP_OPTIONS.map((o) => (
          <Chip key={o.label} label={o.label} fill selected={form.minShowUpRate === o.value} onPress={() => set({ minShowUpRate: o.value })} />
        ))}
      </ChipGrid>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        Members who keep their plans. New members count as 100% until they have 3 plans.
      </AppText>

      <FieldLabel>When</FieldLabel>
      <ChipGrid columns={3}>
        {DAY_PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} fill selected={sameDays(form.days, p.days)} onPress={() => set({ days: [...p.days] })} />
        ))}
      </ChipGrid>
      <View style={{ flexDirection: 'row', gap: space.xxs, marginTop: space.sm }}>
        {WEEK_ORDER.map((d) => (
          <DayToggle key={d} day={d} selected={form.days.includes(d)} onPress={() => toggleDay(d)} />
        ))}
      </View>
      {!!err('days') && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: 6 }}>
          {err('days')}
        </AppText>
      )}
      <ListGroup style={{ marginTop: space.md }}>
        <ListRow title="All day" toggle={allDay} onToggle={(on) => set(on ? { startMinute: 0, endMinute: 1440 } : { startMinute: 960, endMinute: 1140 })} last={allDay} />
        {!allDay && (
          <>
            <TimeRow label="From" value={form.startMinute} min={0} max={Math.min(1410, form.endMinute - STEP)} onChange={(v) => set({ startMinute: v })} />
            <TimeRow label="Until" value={form.endMinute} min={Math.max(STEP, form.startMinute + STEP)} max={1440} onChange={(v) => set({ endMinute: v })} last />
          </>
        )}
      </ListGroup>
      {!!err('time') && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: 6 }}>
          {err('time')}
        </AppText>
      )}
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        Members see: {windowLabel(form)} (India time)
      </AppText>

      <FieldLabel>Limit</FieldLabel>
      <Stepper value={form.perUserPerWeek} onChange={(v) => set({ perUserPerWeek: v })} min={1} max={7} label="Uses per member each week" suffix={form.perUserPerWeek === 1 ? 'use a week' : 'uses a week'} />
    </View>
  );
}
