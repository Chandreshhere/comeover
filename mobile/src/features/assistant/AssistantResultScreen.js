// assistant_result — the IRL Guide's suggestions, made editable.
// Existing plans come first (joining beats creating); the draft card can be
// tweaked and handed to the normal create flow. The guide only suggests.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  HeroCard,
  Icon,
  Pictogram,
  Screen,
  ScreenHeader,
  SectionHeader,
  TextField,
} from '@/components';
import { categories, categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { durationLabel } from '@/utils/format';
import Stepper from '@/features/create/components/Stepper';
import { DURATIONS, computeStartsAt, defaultTitle, nearestDuration, whenFromAssistant } from '@/features/create/createUtils';

const WHEN_LABEL = { now: 'Now', in15: 'In 15 min', tonight: 'Tonight', tomorrow: 'Tomorrow', weekend: 'This weekend' };

export default function AssistantResultScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const suggested = route.params?.draft || null;
  const activityIds = route.params?.activityIds || [];

  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const resetDraft = useAppStore((s) => s.resetDraft);

  const plans = useMemo(
    () => activityIds.map((id) => activities.find((a) => a.id === id)).filter((a) => a && a.status !== 'cancelled' && !blocked.includes(a.host?.id)),
    [activityIds, activities, blocked]
  );

  // Suggested plans are upserted by askGuide; fetch any that aren't cached (e.g. after a restart).
  useEffect(() => {
    const s = useAppStore.getState();
    activityIds.filter((id) => !s.activities.some((a) => a.id === id)).forEach((id) => s.loadActivity(id, { silent: true }).catch(() => null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityIds.join(',')]);

  const initialCategory = categoryBySlug[suggested?.category] ? suggested.category : categories[0]?.slug;
  const [category, setCategory] = useState(initialCategory);
  const [title, setTitle] = useState(suggested?.title || defaultTitle(initialCategory));
  const [titleTouched, setTitleTouched] = useState(false);
  const [duration, setDuration] = useState(nearestDuration(suggested?.durationMin || 60));
  const [capacity, setCapacity] = useState(Math.max(2, Math.min(30, suggested?.capacity || 4)));
  const [when, setWhen] = useState(whenFromAssistant(suggested?.when));

  const toDraft = () => {
    resetDraft();
    updateDraft({
      category,
      custom: false,
      title: title.trim() || defaultTitle(category),
      autoTitle: !titleTouched,
      durationMin: duration,
      capacity,
      when,
      dayOffset: 0,
      startsAt: computeStartsAt(when),
      source: 'assistant',
    });
  };

  const titleOk = title.trim().length >= 3;

  return (
    <Screen keyboard bg={colors.surface} header={<ScreenHeader title="Guide suggestions" />}>
      <Animated.View entering={enter(0)} style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.periwinkleWash, borderRadius: radius.quest, padding: space.sm, marginTop: space.xs }}>
        <Icon name="info" size={16} color={colors.deep} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          These are suggestions only. You choose what to join or publish — the guide never contacts anyone for you.
        </AppText>
      </Animated.View>

      {plans.length > 0 && (
        <>
          <SectionHeader title="Already happening" right={<AppText variant="caption" color={colors.muted}>Joining is quickest</AppText>} />
          <View style={{ gap: space.sm }}>
            {plans.map((a, i) => (
              <ActivityCard
                key={a.id}
                activity={a}
                index={i}
                variant="row"
                joinState={joinStates[a.id] === 'requested' ? 'requested' : ['accepted', 'checked_in'].includes(joinStates[a.id]) ? 'accepted' : 'idle'}
                onPress={() => nav.navigate('activity_detail', { id: a.id })}
                style={{ borderWidth: 1.2, borderColor: colors.border }}
              />
            ))}
          </View>
        </>
      )}

      <SectionHeader title={plans.length ? 'Or start your own' : 'Start your own'} />
      <Animated.View entering={enter(1)}>
        <HeroCard>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={categoryBySlug[category]?.pictogram} size={24} />
            </View>
            <View style={{ marginLeft: space.sm, flex: 1 }}>
              <AppText variant="caption" color={colors.inkSoft}>
                Draft from the guide · {WHEN_LABEL[when]}
              </AppText>
              <AppText variant="h3" numberOfLines={1}>
                {title || defaultTitle(category)}
              </AppText>
            </View>
          </View>

          <TextField
            label="Title"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              setTitleTouched(true);
            }}
            maxLength={60}
            style={{ marginTop: space.md, marginBottom: space.sm }}
            error={!titleOk ? 'Add a short title' : null}
          />

          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.xs }}>
            Activity
          </AppText>
          <View style={{ marginHorizontal: -18 }}>
            <ChipRow contentStyle={{ paddingHorizontal: 18 }}>
              {categories.map((c) => (
                <Chip
                  key={c.slug}
                  label={c.short}
                  pictogram={c.pictogram}
                  selected={category === c.slug}
                  onPress={() => {
                    setCategory(c.slug);
                    if (!titleTouched) setTitle(defaultTitle(c.slug));
                  }}
                />
              ))}
            </ChipRow>
          </View>

          <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: space.xs }}>
            When
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {Object.entries(WHEN_LABEL).map(([v, l]) => (
              <Chip key={v} label={l} selected={when === v} onPress={() => setWhen(v)} />
            ))}
          </View>

          <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: space.xs }}>
            Duration
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {DURATIONS.map((m) => (
              <Chip key={m} label={durationLabel(m)} selected={duration === m} onPress={() => setDuration(m)} />
            ))}
          </View>

          <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: space.xs }}>
            Group size
          </AppText>
          <Stepper value={capacity} onChange={setCapacity} min={2} max={30} label="Group size" />
        </HeroCard>
      </Animated.View>

      <View style={{ gap: space.xs, marginTop: space.lg }}>
        <Button
          title="Continue in create flow"
          iconRight="arrow-right"
          disabled={!titleOk}
          onPress={() => {
            toDraft();
            nav.navigate('create_activity_time');
          }}
        />
        <Button
          title="Review & publish"
          variant="secondary"
          disabled={!titleOk}
          onPress={() => {
            toDraft();
            nav.navigate('create_activity_preview');
          }}
        />
      </View>

      {!suggested && plans.length === 0 && (
        <EmptyState compact title="No suggestion to show" body="Ask the guide again, or create a plan yourself." cta="Back to the guide" onCta={() => nav.goBack()} style={{ marginTop: space.lg }} />
      )}

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.lg, paddingHorizontal: layout.screenPadding }}>
        You'll still pick the public place and review the safety checklist before anything is published.
      </AppText>
    </Screen>
  );
}
