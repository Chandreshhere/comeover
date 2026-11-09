// Create step 1 — choose an activity (or a custom plan) and micro-plan shortcuts.
import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Chip, ChipGrid, ChipRow, Icon, usePressScale } from '@/components';
import { IconBubble } from '@/components/Card';
import { categories, categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { MICRO_PLANS, computeStartsAt, defaultTitle } from './createUtils';

const CUSTOM = 'explore'; // custom plans use the generic "City explore" category
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Activity cell in the 3-column grid: glyph bubble over a one-line label.
// Fills its ChipGrid cell, so every row lines up. Selected = ink fill.
function TypeTile({ label, pictogram, selected, onPress, highlight = false, accessibilityLabel }) {
  const press = usePressScale(0.95);
  const idleBg = highlight ? colors.periwinkleWash : colors.surface;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel || label}
      style={[
        {
          height: 92,
          borderRadius: 20,
          backgroundColor: selected ? colors.ink : idleBg,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : highlight ? colors.periwinkle : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.xxs,
        },
        press.style,
      ]}
    >
      <IconBubble size={40} tone={highlight && !selected ? 'surface' : 'periwinkle'} bg={selected ? colors.periwinkle : undefined} pictogram={pictogram} iconSize={22} />
      <AppText variant="label" color={selected ? colors.white : colors.ink} align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ marginTop: space.xs, alignSelf: 'stretch' }}>
        {label}
      </AppText>
    </AnimatedPressable>
  );
}

export default function CreateTypeScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const resetDraft = useAppStore((s) => s.resetDraft);

  const prefill = route.params?.category;
  const prefillVenue = route.params?.venueName;
  const prefillArea = route.params?.area;
  const prefillTitle = route.params?.title;
  useEffect(() => {
    if (prefill && categoryBySlug[prefill] && draft.category !== prefill) {
      updateDraft({ category: prefill, custom: false, title: draft.title && !draft.autoTitle ? draft.title : defaultTitle(prefill), autoTitle: !(draft.title && !draft.autoTitle) });
    }
    // Venue/business entry points ("Host a plan here") and search ("Start one for …").
    const extra = {};
    if (prefillVenue) {
      extra.venueName = prefillVenue;
      extra.venueType = 'Partner venue';
    }
    if (prefillArea) extra.area = prefillArea;
    if (prefillTitle) {
      extra.title = prefillTitle;
      extra.autoTitle = false;
    }
    if (Object.keys(extra).length) updateDraft(extra);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, prefillVenue, prefillArea, prefillTitle]);

  const pick = (slug, custom = false) => {
    haptics.select();
    const keepTitle = draft.title && !draft.autoTitle;
    updateDraft({ category: slug, custom, title: keepTitle ? draft.title : custom ? '' : defaultTitle(slug), autoTitle: !keepTitle && !custom });
  };

  const micro = (m) => {
    haptics.medium();
    updateDraft({
      category: m.category,
      custom: false,
      when: m.when,
      durationMin: m.durationMin,
      startsAt: computeStartsAt(m.when),
      title: draft.title && !draft.autoTitle ? draft.title : defaultTitle(m.category),
      autoTitle: !(draft.title && !draft.autoTitle),
    });
    nav.navigate('create_activity_place');
  };

  const hasDraft = !!(draft.startsAt || draft.venueName || draft.description);

  return (
    <StepScaffold
      step={1}
      title="What's the plan?"
      subtitle="Small, public and soon works best."
      onNext={() => nav.navigate('create_activity_time')}
      nextDisabled={!draft.category}
      hint={!draft.category ? 'Choose an activity to continue' : null}
    >
      {hasDraft && (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, backgroundColor: colors.periwinkleWash, borderRadius: radius.card, paddingHorizontal: space.md, marginTop: space.lg }}>
          <Icon name="edit-3" size={18} color={colors.deep} />
          <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }} numberOfLines={1}>
            Draft in progress
          </AppText>
          <Pressable onPress={resetDraft} accessibilityRole="button" accessibilityLabel="Start over" hitSlop={8} style={{ minHeight: layout.minTouch, justifyContent: 'center', paddingHorizontal: space.xs }}>
            <AppText variant="label" color={colors.muted}>
              Start over
            </AppText>
          </Pressable>
          <Pressable onPress={() => nav.navigate('create_activity_preview')} accessibilityRole="button" accessibilityLabel="Review draft" hitSlop={8} style={{ minHeight: layout.minTouch, justifyContent: 'center', paddingLeft: space.xs }}>
            <AppText variant="label" color={colors.deep}>
              Review
            </AppText>
          </Pressable>
        </View>
      )}

      <FieldLabel>Quick start</FieldLabel>
      <ChipRow style={{ marginHorizontal: -layout.screenPadding }}>
        {MICRO_PLANS.map((m) => (
          <Chip key={m.key} label={m.label} pictogram={categoryBySlug[m.category]?.pictogram || 'sparkle'} accessibilityLabel={`${m.label}, ${m.sub}`} onPress={() => micro(m)} />
        ))}
      </ChipRow>

      <FieldLabel>Or pick an activity</FieldLabel>
      <ChipGrid columns={3}>
        {categories
          .filter((c) => c.slug !== CUSTOM)
          .map((c) => (
            <TypeTile key={c.slug} label={c.short} accessibilityLabel={c.label} pictogram={c.pictogram} selected={draft.category === c.slug && !draft.custom} onPress={() => pick(c.slug)} />
          ))}
        <TypeTile label="Custom" accessibilityLabel="Custom plan" pictogram="sparkle" highlight selected={!!draft.custom} onPress={() => pick(CUSTOM, true)} />
      </ChipGrid>

      <Pressable
        onPress={() => nav.navigate('plan_assistant')}
        accessibilityRole="link"
        accessibilityLabel="Not sure? Ask the Come Over Guide for ideas"
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: space.lg, minHeight: layout.minTouch }}
      >
        <Icon name="lightbulb" size={16} color={colors.deep} />
        <AppText variant="label" color={colors.deep} style={{ marginLeft: space.xs }}>
          Not sure? Ask the Guide
        </AppText>
      </Pressable>
    </StepScaffold>
  );
}
