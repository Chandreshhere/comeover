// Create step 1 — choose an activity (or a custom plan) and micro-plan shortcuts.
import React, { useEffect } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, Icon, Pictogram } from '@/components';
import { categories, categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { MICRO_PLANS, computeStartsAt, defaultTitle } from './createUtils';

const CUSTOM = 'explore'; // custom plans use the generic "City explore" category

export default function CreateTypeScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const { width } = useWindowDimensions();
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

  const cols = 3;
  const gap = space.xs;
  const tileW = (width - layout.screenPadding * 2 - gap * (cols - 1)) / cols;
  const hasDraft = !!(draft.startsAt || draft.venueName || draft.description);

  return (
    <StepScaffold
      step={1}
      title="What's the plan?"
      subtitle="Pick an activity. Small, public, happening soon works best."
      onNext={() => nav.navigate('create_activity_time')}
      nextDisabled={!draft.category}
      hint={!draft.category ? 'Choose an activity to continue' : null}
    >
      {hasDraft && (
        <Card bg={colors.periwinkleWash} elevated={false} padding={12} style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
          <Icon name="edit-3" size={16} />
          <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }}>
            You have a draft in progress
          </AppText>
          <AppText variant="label" color={colors.deep} onPress={() => nav.navigate('create_activity_preview')} accessibilityRole="button" style={{ marginRight: space.md }}>
            Review
          </AppText>
          <AppText variant="label" color={colors.danger} onPress={resetDraft} accessibilityRole="button">
            Start over
          </AppText>
        </Card>
      )}

      <FieldLabel>Micro-plans</FieldLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.screenPadding }} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.xs }}>
        {MICRO_PLANS.map((m, i) => (
          <Pressable
            key={m.key}
            onPress={() => micro(m)}
            accessibilityRole="button"
            accessibilityLabel={`${m.label}, ${m.sub}`}
            style={{ width: 132, borderRadius: radius.card, backgroundColor: accents[(i + 1) % accents.length].bg, padding: space.sm }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={categoryBySlug[m.category]?.pictogram} size={20} color={colors.white} />
            </View>
            <AppText variant="bodyStrong" style={{ marginTop: space.sm }} numberOfLines={1}>
              {m.label}
            </AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {m.sub}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <FieldLabel>All activities</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {categories
          .filter((c) => c.slug !== CUSTOM)
          .map((c, i) => {
            const selected = draft.category === c.slug && !draft.custom;
            return (
              <Animated.View key={c.slug} entering={enter(Math.min(i, 8))}>
                <Pressable
                  onPress={() => pick(c.slug)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={c.label}
                  style={{
                    width: tileW,
                    height: tileW * 0.92,
                    borderRadius: 20,
                    backgroundColor: selected ? colors.ink : colors.surface,
                    borderWidth: 1.2,
                    borderColor: selected ? colors.ink : colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: space.xs,
                  }}
                >
                  <Pictogram name={c.pictogram} size={30} color={selected ? colors.white : colors.ink} />
                  <AppText variant="label" color={selected ? colors.white : colors.ink} align="center" numberOfLines={1} style={{ marginTop: space.xs }}>
                    {c.short}
                  </AppText>
                </Pressable>
              </Animated.View>
            );
          })}
        <Pressable
          onPress={() => pick(CUSTOM, true)}
          accessibilityRole="radio"
          accessibilityState={{ selected: !!draft.custom }}
          accessibilityLabel="Custom plan"
          style={{
            width: tileW,
            height: tileW * 0.92,
            borderRadius: 20,
            backgroundColor: draft.custom ? colors.ink : colors.periwinkle,
            alignItems: 'center',
            justifyContent: 'center',
            padding: space.xs,
          }}
        >
          <Pictogram name="sparkle" size={30} color={draft.custom ? colors.white : colors.ink} />
          <AppText variant="label" color={draft.custom ? colors.white : colors.ink} align="center" style={{ marginTop: space.xs }}>
            Custom plan
          </AppText>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xl }}>
        <AppText variant="caption" color={colors.muted} style={{ flex: 1 }}>
          Not sure?{' '}
          <AppText variant="caption" color={colors.deep} onPress={() => nav.navigate('plan_assistant')} accessibilityRole="link">
            Ask the IRL Guide for ideas
          </AppText>
        </AppText>
      </View>
    </StepScaffold>
  );
}
