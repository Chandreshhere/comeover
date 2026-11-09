// Personality avatar picker: a vibe (Nerd, Cool, Glam…), a skin tone and a
// hair colour; "Shuffle look" steps through the vibe's curated looks. Controlled:
// `value` is any avatar seed, `onChange` receives the encoded seed
// ("v1.<vibe>.<skin>.<hair>.<look>", see illustrations/avatarPresets.js).
//
//   full (default): live animated preview + vibe grid + skin + hair rows. The
//     preview stays put while the options scroll (fits inside a Sheet).
//   compact: one scrolling row of vibes + skin tones, for onboarding where the
//     screen shows its own preview.
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText, Avatar, Button, ChipGrid, usePressScale } from '@/components';
import { HAIR_COLORS, SKIN_TONES, VIBES, avatarParts, encodeAvatar, hairHidden, shuffleAvatar, vibeById } from '@/illustrations/avatarPresets';
import { colors, inkAlpha, layout, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SWATCH = 44; // full tap target; the colour dot sits inside the ring
const DOT = 32;
const ROW_TILE = 84; // compact row tile width

function Label({ children, right, first }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: first ? 0 : space.lg, marginBottom: space.xs }}>
      <AppText variant="label" color={colors.muted} accessibilityRole="header">
        {children}
      </AppText>
      {right}
    </View>
  );
}

function VibeTile({ vibe, seed, selected, onPress, width }) {
  const press = usePressScale(0.96);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${vibe.label}. ${vibe.blurb}`}
      accessibilityHint={selected ? 'Tap again for another look' : undefined}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        {
          width,
          alignItems: 'center',
          paddingTop: space.sm,
          paddingBottom: space.xs,
          paddingHorizontal: space.xxs,
          borderRadius: radius.quest,
          backgroundColor: colors.surface,
          borderWidth: 2,
          borderColor: selected ? colors.ink : colors.border,
        },
        press.style,
      ]}
    >
      <Avatar seed={seed} size={52} />
      <AppText variant="label" color={selected ? colors.ink : colors.inkSoft} numberOfLines={1} maxScale={1.2} style={{ marginTop: 6 }}>
        {vibe.label}
      </AppText>
    </AnimatedPressable>
  );
}

function SwatchRow({ items, selected, onSelect, kind, disabled = false }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -layout.screenPadding, flexGrow: 0, opacity: disabled ? 0.4 : 1 }}
      contentContainerStyle={{ paddingHorizontal: layout.screenPadding - (SWATCH - DOT) / 2, gap: space.xxs }}
    >
      {items.map((it, i) => {
        const on = i === selected;
        return (
          <Pressable
            key={it.hex}
            accessibilityRole="button"
            accessibilityLabel={`${kind}: ${it.label}`}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => {
              haptics.select();
              onSelect(i);
            }}
            style={{
              width: SWATCH,
              height: SWATCH,
              borderRadius: SWATCH / 2,
              borderWidth: 2,
              borderColor: on ? colors.ink : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Literal skin / hair colours: the same in both themes. */}
            <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: `#${it.hex}`, borderWidth: 1, borderColor: inkAlpha(0.12) }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function AvatarPicker({ value, onChange, compact = false, style }) {
  const parts = useMemo(() => avatarParts(value), [value]);
  const seed = encodeAvatar(parts);
  const vibe = vibeById(parts.vibe);
  const hidden = hairHidden(parts);
  const rowRef = useRef(null);

  const emit = (patch) => onChange?.(encodeAvatar({ ...parts, ...patch }));
  // Tapping the current vibe again moves to its next look.
  const pickVibe = (id) => (id === parts.vibe ? onChange?.(shuffleAvatar(seed)) : emit({ vibe: id, variant: 0 }));
  // Tiles wear your skin and hair, so each vibe previews as you.
  const tileSeed = (v) => encodeAvatar({ ...parts, vibe: v.id, variant: v.id === parts.vibe ? parts.variant : 0 });

  // Compact row: bring the chosen vibe into view on first render.
  useEffect(() => {
    if (!compact) return;
    const i = VIBES.findIndex((v) => v.id === parts.vibe);
    if (i > 2) rowRef.current?.scrollTo({ x: (i - 1) * (ROW_TILE + space.xs), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  if (compact) {
    return (
      <View style={style}>
        <Label first>Your vibe</Label>
        <ScrollView
          ref={rowRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -layout.screenPadding, flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.xs }}
        >
          {VIBES.map((v) => (
            <VibeTile key={v.id} vibe={v} seed={tileSeed(v)} width={ROW_TILE} selected={v.id === parts.vibe} onPress={() => pickVibe(v.id)} />
          ))}
        </ScrollView>
        <Label>Skin tone</Label>
        <SwatchRow kind="Skin tone" items={SKIN_TONES} selected={parts.skin} onSelect={(skin) => emit({ skin })} />
      </View>
    );
  }

  return (
    <View style={[{ flexShrink: 1 }, style]}>
      {/* Live preview stays visible while the options below scroll. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
        <Avatar seed={seed} size={104} animated label={`${vibe.label} avatar preview`} />
        <View style={{ flex: 1, marginLeft: space.md }}>
          <AppText variant="h2" numberOfLines={1}>
            {vibe.label}
          </AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {vibe.blurb}
          </AppText>
          <Button
            title="Shuffle look"
            icon="shuffle"
            size="sm"
            variant="secondary"
            full={false}
            style={{ marginTop: space.sm }}
            onPress={() => onChange?.(shuffleAvatar(seed))}
          />
        </View>
      </View>

      {/* Bleeds to the sheet edges so the swatch rows can scroll edge to edge. */}
      <ScrollView
        style={{ flexShrink: 1, marginHorizontal: -layout.screenPadding }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: space.xs }}
      >
        <Label first>Vibe</Label>
        <ChipGrid columns={3}>
          {VIBES.map((v) => (
            <VibeTile key={v.id} vibe={v} seed={tileSeed(v)} selected={v.id === parts.vibe} onPress={() => pickVibe(v.id)} />
          ))}
        </ChipGrid>

        <Label>Skin tone</Label>
        <SwatchRow kind="Skin tone" items={SKIN_TONES} selected={parts.skin} onSelect={(skin) => emit({ skin })} />

        <Label
          right={
            hidden ? (
              <AppText variant="caption" color={colors.muted}>
                Covered by this look
              </AppText>
            ) : null
          }
        >
          Hair
        </Label>
        <SwatchRow kind="Hair colour" items={HAIR_COLORS} selected={parts.hair} onSelect={(hair) => emit({ hair })} disabled={hidden} />
      </ScrollView>
    </View>
  );
}
