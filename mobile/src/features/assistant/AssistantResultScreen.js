// assistant_result — Mo's suggestions, made editable. Plans already happening
// come first (joining beats creating); the draft below can be tweaked and
// handed to the normal create flow. The guide only suggests.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Card, Chip, ChipGrid, ChipRow, EmptyState, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
import { categories, categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { durationLabel } from '@/utils/format';
import Stepper from '@/features/create/components/Stepper';
import { DURATIONS, computeStartsAt, defaultTitle, nearestDuration, whenFromAssistant } from '@/features/create/createUtils';

const WHEN_LABEL = { now: 'Now', in15: 'In 15 min', tonight: 'Tonight', tomorrow: 'Tomorrow', weekend: 'This weekend' };

function FieldLabel({ children, first }) {
  return (
    <AppText variant="label" color={colors.inkSoft} style={{ marginTop: first ? 0 : space.lg, marginBottom: space.xs }}>
      {children}
    </AppText>
  );
}

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
  // Mo's pick leads the activity row so it's visible without scrolling.
  const categoryOrder = useMemo(() => [...categories].sort((a, b) => (b.slug === initialCategory) - (a.slug === initialCategory)), [initialCategory]);

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
  const nothing = !suggested && plans.length === 0;

  if (nothing) {
    return (
      <Screen header={<ScreenHeader title="Mo's ideas" />}>
        <EmptyState title="No suggestion to show" body="Ask Mo again, or create a plan yourself." cta="Back to Mo" onCta={() => nav.goBack()} secondary="Create a plan" onSecondary={() => nav.navigate('create_activity_type')} />
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Mo's ideas" />}
      footer={
        <View style={{ gap: space.xxs }}>
          <Button
            title="Continue"
            iconRight="arrow-right"
            disabled={!titleOk}
            onPress={() => {
              toDraft();
              nav.navigate('create_activity_time');
            }}
          />
          <Button
            title="Skip to review"
            variant="ghost"
            size="sm"
            disabled={!titleOk}
            onPress={() => {
              toDraft();
              nav.navigate('create_activity_preview');
            }}
          />
        </View>
      }
    >
      {plans.length > 0 && (
        <>
          <SectionHeader title="Already happening" style={{ marginTop: space.xs }} />
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

      <SectionHeader title={plans.length ? 'Or start your own' : 'Your draft'} style={plans.length ? undefined : { marginTop: space.xs }} />
      <Animated.View entering={enter(1)}>
        <Card>
          <TextField
            label="Title"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              setTitleTouched(true);
            }}
            maxLength={60}
            style={{ marginBottom: 0 }}
            error={!titleOk ? 'Add a short title' : null}
          />

          <FieldLabel>Activity</FieldLabel>
          <View style={{ marginHorizontal: -space.md }}>
            <ChipRow contentStyle={{ paddingHorizontal: space.md }}>
              {categoryOrder.map((c) => (
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

          <FieldLabel>When</FieldLabel>
          <ChipGrid columns={2}>
            {Object.entries(WHEN_LABEL).map(([v, l]) => (
              <Chip key={v} label={l} fill selected={when === v} onPress={() => setWhen(v)} />
            ))}
          </ChipGrid>

          <FieldLabel>Duration</FieldLabel>
          <ChipGrid columns={3}>
            {DURATIONS.map((m) => (
              <Chip key={m} label={durationLabel(m)} fill selected={duration === m} onPress={() => setDuration(m)} />
            ))}
          </ChipGrid>

          <FieldLabel>Group size</FieldLabel>
          <Stepper value={capacity} onChange={setCapacity} min={2} max={30} label="Group size" />
        </Card>
      </Animated.View>

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.md }}>
        You'll pick a public place and check safety before publishing.
      </AppText>
    </Screen>
  );
}
