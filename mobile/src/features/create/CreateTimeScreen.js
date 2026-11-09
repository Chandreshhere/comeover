// Create step 2 — when and how long.
import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { CalendarDots } from 'phosphor-react-native/src/icons/CalendarDots';
import { Lightning } from 'phosphor-react-native/src/icons/Lightning';
import { MoonStars } from 'phosphor-react-native/src/icons/MoonStars';
import { Sun } from 'phosphor-react-native/src/icons/Sun';
import { SunHorizon } from 'phosphor-react-native/src/icons/SunHorizon';
import { Timer } from 'phosphor-react-native/src/icons/Timer';
import { AppText, Chip, ChipGrid, ChipRow, usePressScale } from '@/components';
import { IconBubble } from '@/components/Card';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, onInkAlpha, space } from '@/theme/tokens';
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
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Glyphs that say what each window means (components, not colours — safe at module scope).
const WHEN_GLYPHS = { now: Lightning, in15: Timer, tonight: MoonStars, tomorrow: SunHorizon, weekend: Sun, custom: CalendarDots };

function WhenTile({ o, selected, onPress }) {
  const press = usePressScale(0.96);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${o.label}, ${o.hint}`}
      style={[
        {
          flex: 1,
          minHeight: 64,
          borderRadius: 20,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
          backgroundColor: selected ? colors.ink : colors.surface,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : colors.border,
          flexDirection: 'row',
          alignItems: 'center',
        },
        press.style,
      ]}
    >
      <IconBubble size={40} shape="squircle" tone="periwinkle" bg={selected ? colors.periwinkle : undefined} glyph={WHEN_GLYPHS[o.value] || CalendarDots} iconSize={22} />
      <View style={{ marginLeft: space.sm, flex: 1 }}>
        <AppText variant="bodyStrong" color={selected ? colors.white : colors.ink} numberOfLines={1}>
          {o.label}
        </AppText>
        <AppText variant="caption" color={selected ? onInkAlpha(0.7) : colors.muted} numberOfLines={1}>
          {o.hint}
        </AppText>
      </View>
    </AnimatedPressable>
  );
}

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
  // The resulting window is echoed above the Next button instead of in a card.
  const summary = startsAt ? `${relativeDay(startsAt)} · ${timeLabel(startsAt)} – ${timeLabel(end)}` : null;

  return (
    <StepScaffold
      step={2}
      title="When is it?"
      subtitle="Plans starting within a few hours fill fastest."
      onNext={() => nav.navigate('create_activity_place')}
      nextDisabled={!startsAt}
      error={!startsAt && draft.when ? 'That time has passed. Pick another slot.' : null}
      hint={summary}
    >
      <ChipGrid columns={2} style={{ marginTop: space.lg }}>
        {WHEN_OPTIONS.map((o) => {
          const selected = when === o.value && !!draft.when;
          return (
            <WhenTile
              key={o.value}
              o={o}
              selected={selected}
              onPress={() => {
                haptics.select();
                apply({ when: o.value, dayOffset: o.value === 'custom' ? dayOffset : 0 });
              }}
            />
          );
        })}
      </ChipGrid>

      {when === 'custom' && (
        <>
          <FieldLabel>Day</FieldLabel>
          <ChipRow style={{ marginHorizontal: -layout.screenPadding }}>
            {days.map((d) => (
              <Chip key={d.offset} label={relativeDay(d.date)} selected={dayOffset === d.offset} onPress={() => apply({ dayOffset: d.offset })} />
            ))}
          </ChipRow>
        </>
      )}

      {NEEDS_SLOT.includes(when) && (
        <>
          <FieldLabel>Start time</FieldLabel>
          {slots.length ? (
            <ChipGrid columns={3}>
              {slots.map((s) => (
                <Chip key={s} label={slotLabel(s)} fill selected={slot === s} onPress={() => apply({ timeSlot: s })} />
              ))}
            </ChipGrid>
          ) : (
            <AppText variant="caption" color={colors.muted}>
              No slots left today. Try Tomorrow or pick a day.
            </AppText>
          )}
        </>
      )}

      <FieldLabel>How long?</FieldLabel>
      <ChipGrid columns={3}>
        {DURATIONS.map((m) => (
          <Chip key={m} label={durationLabel(m)} fill selected={draft.durationMin === m} onPress={() => updateDraft({ durationMin: m })} />
        ))}
      </ChipGrid>
    </StepScaffold>
  );
}
