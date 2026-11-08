// Create step 4 — group size, join rules and audience.
import React, { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Chip, OptionCard, Pictogram } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import Stepper from './components/Stepper';
import { AGE_RANGES, LEVELS } from './createUtils';

const AUDIENCES = [
  { value: 'everyone', title: 'Everyone nearby', subtitle: 'Shown in Discover and the Live radar' },
  { value: 'circle', title: 'One of my circles', subtitle: 'Only members of a circle can see it' },
  { value: 'invite_only', title: 'Invite only', subtitle: 'Hidden — share the link yourself' },
];

export default function CreateGroupScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const circlesLoad = useLoader('circles', (s) => s.loadCircles({ tab: 'joined' }));
  const myCircles = useMemo(() => circles.filter((c) => joinedCircles.includes(c.id)), [circles, joinedCircles]);

  const needsCircle = draft.audience === 'circle' && !draft.circleId;

  return (
    <StepScaffold
      step={4}
      title="Who can join?"
      subtitle="Smaller groups feel easier for first-timers."
      onNext={() => nav.navigate('create_activity_details')}
      nextDisabled={needsCircle}
      error={needsCircle ? 'Choose which circle can see this plan.' : null}
    >
      <FieldLabel>Group size (including you)</FieldLabel>
      <Stepper value={draft.capacity} onChange={(v) => updateDraft({ capacity: v })} min={2} max={30} label="Group size" />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        {draft.capacity <= 6 ? 'Groups of 2–6 fill fastest and feel the most relaxed.' : 'Larger groups need a clear meeting point — add it in the details.'}
      </AppText>

      <FieldLabel>Joining</FieldLabel>
      <OptionCard
        title="I approve each request"
        subtitle="Recommended. You see a short intro before accepting."
        selected={draft.joinRule === 'approval'}
        onPress={() => updateDraft({ joinRule: 'approval' })}
      />
      <OptionCard
        title="Instant join"
        subtitle="Verified 18+ members join straight away. You can still remove people."
        selected={draft.joinRule === 'instant'}
        onPress={() => updateDraft({ joinRule: 'instant' })}
      />

      <FieldLabel>Who sees it</FieldLabel>
      {AUDIENCES.map((a) => (
        <OptionCard
          key={a.value}
          title={a.title}
          subtitle={a.subtitle}
          selected={draft.audience === a.value}
          onPress={() => updateDraft({ audience: a.value, circleId: a.value === 'circle' ? draft.circleId || myCircles[0]?.id || null : null })}
        />
      ))}
      {draft.audience === 'circle' && !myCircles.length && circlesLoad.loading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }} accessibilityLabel="Loading your circles">
          <ActivityIndicator color={colors.ink} size="small" />
          <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6 }}>
            Loading your circles…
          </AppText>
        </View>
      )}
      {draft.audience === 'circle' && !myCircles.length && circlesLoad.status === 'error' && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} onPress={circlesLoad.reload} accessibilityRole="button">
          Couldn't load your circles. Tap to retry.
        </AppText>
      )}
      {draft.audience === 'circle' &&
        (myCircles.length > 0 || (!circlesLoad.loading && circlesLoad.status !== 'error')) &&
        (myCircles.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
            {myCircles.map((c) => (
              <Chip key={c.id} label={c.name} pictogram={c.pictogram} selected={draft.circleId === c.id} onPress={() => updateDraft({ circleId: c.id })} />
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
            <Pictogram name="people" size={18} color={colors.muted} />
            <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6, flex: 1 }}>
              You haven't joined any circles yet.{' '}
              <AppText variant="caption" color={colors.deep} onPress={() => nav.navigate('circles_home')} accessibilityRole="link">
                Find one
              </AppText>
            </AppText>
          </View>
        ))}

      <FieldLabel>Level</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {LEVELS.map((l) => (
          <Chip key={l.value} label={l.label} selected={(draft.level || 'any') === l.value} onPress={() => updateDraft({ level: l.value })} />
        ))}
      </View>

      <FieldLabel>Age range (optional)</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {AGE_RANGES.map((r) => (
          <Chip key={r || 'any'} label={r || 'Any 18+'} selected={(draft.ageRange || null) === r} onPress={() => updateDraft({ ageRange: r })} />
        ))}
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        All members are verified 18+. Age preferences are a soft filter, never a public label.
      </AppText>
    </StepScaffold>
  );
}
