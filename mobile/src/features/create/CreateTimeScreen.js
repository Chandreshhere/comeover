// Create step 2 — when and how long.
import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, Chip, ChipRow, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durationLabel, relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import {
  DAY_SLOTS,
  DURATIONS,
  TONIGHT_SLOTS,
  WHEN_OPTIONS,
  availableSlots,
  computeStartsAt,
  defaultSlotFor,
  nextDays,
  slotLabel,
} from './createUtils';

const NEEDS_SLOT = ['tonight', 'tomorrow', 'weekend', 'custom'];

export default function CreateTimeScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);

  const when = draft.when || 'now';
  const dayOffset = draft.dayOffset ?? 0;
  const slot = draft.timeSlot || defaultSlotFor(when);

  const days = useMemo(() => nextDays(7), []);
  const slots = useMemo(() => {
    if (when === 'tonight') return availableSlots(TONIGHT_SLOTS, 0);
    if (when === 'custom') return availableSlots(DAY_SLOTS, dayOffset);
    return DAY_SLOTS;
  }, [when, dayOffset]);

  const apply = (patch) => {
    const next = { when, dayOffset, timeSlot: slot, ...patch };
    // keep the chosen slot valid for the new window
    let nextSlot = next.timeSlot;
    const valid = next.when === 'tonight' ? availableSlots(TONIGHT_SLOTS, 0) : next.when === 'custom' ? availableSlots(DAY_SLOTS, next.dayOffset) : DAY_SLOTS;
    if (NEEDS_SLOT.includes(next.when) && !valid.includes(nextSlot)) nextSlot = valid[0] || defaultSlotFor(next.when);
    const startsAt = computeStartsAt(next.when, { dayOffset: next.dayOffset, time: nextSlot });
    updateDraft({ when: next.when, dayOffset: next.dayOffset, timeSlot: nextSlot, startsAt });
  };

  // First visit: materialise a start time for the default window.
  useEffect(() => {
    if (!draft.startsAt) apply({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startsAt = draft.startsAt;
  const end = startsAt ? new Date(new Date(startsAt).getTime() + draft.durationMin * 60000) : null;

  return (
    <StepScaffold
      step={2}
      title="When are you going?"
      subtitle="Plans starting within a few hours fill fastest."
      onNext={() => nav.navigate('create_activity_place')}
      nextDisabled={!startsAt}
      error={!startsAt && draft.when ? 'That time has passed — pick another slot.' : null}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.lg }}>
        {WHEN_OPTIONS.map((o) => {
          const selected = when === o.value && !!draft.when;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                haptics.select();
                apply({ when: o.value, dayOffset: o.value === 'custom' ? dayOffset : 0 });
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${o.label}, ${o.hint}`}
              style={{
                width: '48.5%',
                borderRadius: 20,
                padding: space.sm,
                backgroundColor: selected ? colors.ink : colors.surface,
                borderWidth: 1.2,
                borderColor: selected ? colors.ink : colors.border,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: selected ? colors.periwinkle : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={o.icon} size={16} color={colors.ink} />
              </View>
              <View style={{ marginLeft: space.xs, flex: 1 }}>
                <AppText variant="bodyStrong" color={selected ? colors.white : colors.ink} numberOfLines={1}>
                  {o.label}
                </AppText>
                <AppText variant="caption" color={selected ? 'rgba(255,255,255,0.7)' : colors.muted} numberOfLines={1}>
                  {o.hint}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {when === 'custom' && (
        <>
          <FieldLabel>Day</FieldLabel>
          <View style={{ marginHorizontal: -layout.screenPadding }}>
            <ChipRow>
              {days.map((d) => (
                <Chip key={d.offset} label={relativeDay(d.date)} selected={dayOffset === d.offset} onPress={() => apply({ dayOffset: d.offset })} />
              ))}
            </ChipRow>
          </View>
        </>
      )}

      {NEEDS_SLOT.includes(when) && (
        <>
          <FieldLabel>Start time</FieldLabel>
          {slots.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {slots.map((s) => (
                <Chip key={s} label={slotLabel(s)} selected={slot === s} onPress={() => apply({ timeSlot: s })} />
              ))}
            </View>
          ) : (
            <AppText variant="caption" color={colors.muted}>
              No slots left today — try Tomorrow or pick a day.
            </AppText>
          )}
        </>
      )}

      <FieldLabel>How long?</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {DURATIONS.map((m) => (
          <Chip key={m} label={durationLabel(m)} selected={draft.durationMin === m} onPress={() => updateDraft({ durationMin: m })} />
        ))}
      </View>

      {startsAt && (
        <Card bg={colors.periwinkle} elevated={false} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center', borderRadius: radius.hero }} accessibilityLabel={`Starts ${relativeDay(startsAt)} at ${timeLabel(startsAt)}, ends ${timeLabel(end)}`}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={20} />
          </View>
          <View style={{ marginLeft: space.sm, flex: 1 }}>
            <AppText variant="bodyStrong">
              {relativeDay(startsAt)} · {timeLabel(startsAt)} – {timeLabel(end)}
            </AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {when === 'now' || when === 'in15' ? 'Start time refreshes when you publish' : `${durationLabel(draft.durationMin)} plan`}
            </AppText>
          </View>
        </Card>
      )}
    </StepScaffold>
  );
}
