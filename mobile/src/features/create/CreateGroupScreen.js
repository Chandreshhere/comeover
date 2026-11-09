// Create step 4 — group size, join rules and audience. Level and age range
// are optional and tucked under "More options".
import React, { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinkSimple } from 'phosphor-react-native/src/icons/LinkSimple';
import { AppText, Chip, ChipGrid } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import StepScaffold, { FieldLabel, MoreOptions } from './components/StepScaffold';
import Stepper from './components/Stepper';
import { AGE_RANGES, LEVELS } from './createUtils';

// `icon` = app icon name, `glyph` = Phosphor component (no colours here).
const JOIN_RULES = [
  { value: 'approval', label: 'I approve', icon: 'user-check', help: 'Recommended. You see a short intro before accepting.' },
  { value: 'instant', label: 'Instant join', icon: 'zap', help: 'Verified 18+ members join right away. You can still remove people.' },
];

const AUDIENCES = [
  { value: 'everyone', label: 'Everyone', icon: 'globe', help: 'Shown in Discover and the Live radar.' },
  { value: 'circle', label: 'A circle', icon: 'users-four', help: 'Only members of the circle can see it.' },
  { value: 'invite_only', label: 'Invite only', glyph: LinkSimple, help: 'Hidden. Share the link yourself.' },
];

function Helper({ children }) {
  return (
    <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
      {children}
    </AppText>
  );
}

export default function CreateGroupScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const circlesLoad = useLoader('circles', (s) => s.loadCircles({ tab: 'joined' }));
  const myCircles = useMemo(() => circles.filter((c) => joinedCircles.includes(c.id)), [circles, joinedCircles]);

  const needsCircle = draft.audience === 'circle' && !draft.circleId;
  const rule = JOIN_RULES.find((r) => r.value === draft.joinRule);
  const audience = AUDIENCES.find((a) => a.value === draft.audience);
  const extrasSet = (draft.level && draft.level !== 'any') || !!draft.ageRange;

  return (
    <StepScaffold
      step={4}
      title="Who can join?"
      subtitle="Small groups of 2–6 fill fastest and feel relaxed."
      onNext={() => nav.navigate('create_activity_details')}
      nextDisabled={needsCircle}
      error={needsCircle ? 'Choose which circle can see this plan.' : null}
    >
      <FieldLabel>Group size</FieldLabel>
      <Stepper value={draft.capacity} onChange={(v) => updateDraft({ capacity: v })} min={2} max={30} label="Group size, including you" suffix="people incl. you" />

      <FieldLabel>Joining</FieldLabel>
      <ChipGrid columns={2}>
        {JOIN_RULES.map((r) => (
          <Chip key={r.value} label={r.label} icon={r.icon} fill selected={draft.joinRule === r.value} accessibilityLabel={`${r.label}. ${r.help}`} onPress={() => updateDraft({ joinRule: r.value })} />
        ))}
      </ChipGrid>
      {!!rule && <Helper>{rule.help}</Helper>}

      <FieldLabel>Who sees it</FieldLabel>
      <ChipGrid columns={2}>
        {AUDIENCES.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            icon={a.icon}
            glyph={a.glyph}
            fill
            selected={draft.audience === a.value}
            accessibilityLabel={`${a.label}. ${a.help}`}
            onPress={() => updateDraft({ audience: a.value, circleId: a.value === 'circle' ? draft.circleId || myCircles[0]?.id || null : null })}
          />
        ))}
      </ChipGrid>
      {!!audience && draft.audience !== 'circle' && <Helper>{audience.help}</Helper>}

      {draft.audience === 'circle' && !myCircles.length && circlesLoad.loading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }} accessibilityLabel="Loading your circles">
          <ActivityIndicator color={colors.ink} size="small" />
          <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs }}>
            Loading your circles…
          </AppText>
        </View>
      )}
      {draft.audience === 'circle' && !myCircles.length && circlesLoad.status === 'error' && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} onPress={circlesLoad.reload} accessibilityRole="button">
          Couldn't load your circles. Tap to retry.
        </AppText>
      )}
      {draft.audience === 'circle' &&
        (myCircles.length > 0 || (!circlesLoad.loading && circlesLoad.status !== 'error')) &&
        (myCircles.length ? (
          <>
            <FieldLabel style={{ marginTop: space.lg }}>Which circle?</FieldLabel>
            <ChipGrid columns={2}>
              {myCircles.map((c) => (
                <Chip key={c.id} label={c.name} pictogram={c.pictogram} fill selected={draft.circleId === c.id} onPress={() => updateDraft({ circleId: c.id })} />
              ))}
            </ChipGrid>
          </>
        ) : (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
            You haven't joined any circles yet.{' '}
            <AppText variant="caption" color={colors.deep} onPress={() => nav.navigate('circles_home')} accessibilityRole="link">
              Find one
            </AppText>
          </AppText>
        ))}

      <MoreOptions title="Level & age" subtitle={extrasSet ? [LEVELS.find((l) => l.value === draft.level)?.label, draft.ageRange].filter(Boolean).join(' · ') : 'Optional · Any level, any 18+'} initiallyOpen={extrasSet}>
        <FieldLabel style={{ marginTop: space.xs }}>Level</FieldLabel>
        <ChipGrid columns={2}>
          {LEVELS.map((l) => (
            <Chip key={l.value} label={l.label} fill selected={(draft.level || 'any') === l.value} onPress={() => updateDraft({ level: l.value })} />
          ))}
        </ChipGrid>
        <FieldLabel style={{ marginTop: space.lg }}>Age range</FieldLabel>
        <ChipGrid columns={3}>
          {AGE_RANGES.map((r) => (
            <Chip key={r || 'any'} label={r || 'Any 18+'} fill selected={(draft.ageRange || null) === r} onPress={() => updateDraft({ ageRange: r })} />
          ))}
        </ChipGrid>
        <Helper>A soft filter, never shown as a public label.</Helper>
      </MoreOptions>
    </StepScaffold>
  );
}
