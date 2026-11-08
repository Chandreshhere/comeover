// Create step 5 — title, description, tags, cost expectation, accessibility.
import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Chip, TextField } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { COST_OPTIONS, TAG_OPTIONS } from './createUtils';

const MAX_TAGS = 4;

export default function CreateDetailsScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);

  const tags = draft.tags || [];
  const toggleTag = (t) => {
    if (tags.includes(t)) updateDraft({ tags: tags.filter((x) => x !== t) });
    else if (tags.length < MAX_TAGS) updateDraft({ tags: [...tags, t] });
  };
  const titleOk = (draft.title || '').trim().length >= 3;
  const costPreset = COST_OPTIONS.includes(draft.cost) ? draft.cost : null;

  return (
    <StepScaffold
      step={5}
      title="Add the details"
      subtitle="A clear title and vibe help the right people say yes."
      onNext={() => nav.navigate('create_activity_preview')}
      nextLabel="Preview"
      nextIcon="eye"
      nextDisabled={!titleOk}
      hint={!titleOk ? 'Give your plan a title (3+ characters)' : null}
    >
      <View style={{ marginTop: space.lg }}>
        <TextField
          label="Title"
          value={draft.title}
          onChangeText={(t) => updateDraft({ title: t, autoTitle: false })}
          placeholder="e.g. Chai break near CG Road"
          maxLength={60}
        />
        <TextField
          label="Description"
          value={draft.description}
          onChangeText={(t) => updateDraft({ description: t })}
          placeholder="What will you do? Who is it for? Anything to bring?"
          multiline
          maxLength={280}
        />
      </View>

      <FieldLabel style={{ marginTop: space.xs }}>Vibe tags</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {TAG_OPTIONS.map((t) => (
          <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => toggleTag(t)} />
        ))}
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        {tags.length}/{MAX_TAGS} selected
      </AppText>

      <FieldLabel>Cost expectation</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm }}>
        {COST_OPTIONS.map((c) => (
          <Chip key={c} label={c} selected={costPreset === c} onPress={() => updateDraft({ cost: c })} />
        ))}
      </View>
      <TextField
        value={costPreset ? '' : draft.cost}
        onChangeText={(t) => updateDraft({ cost: t })}
        placeholder="Or describe it, e.g. Court split ~₹200 each"
        icon="credit-card"
        maxLength={60}
        helper="Plans are free to join. Costs are settled between people (SplitMate can help)."
      />

      <TextField
        label="Accessibility notes (optional)"
        value={draft.accessibility}
        onChangeText={(t) => updateDraft({ accessibility: t })}
        placeholder="e.g. Step-free entrance, seating available"
        icon="info"
        maxLength={120}
      />
    </StepScaffold>
  );
}
