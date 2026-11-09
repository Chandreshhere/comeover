// Create step 5 — title, description and cost. Vibe tags and accessibility
// notes are optional and tucked under "More options".
import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Chip, ChipGrid, TextField } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { space } from '@/theme/tokens';
import StepScaffold, { FieldLabel, MoreOptions } from './components/StepScaffold';
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
  const extras = [tags.length ? `${tags.length} tag${tags.length > 1 ? 's' : ''}` : null, draft.accessibility ? 'Accessibility' : null].filter(Boolean);

  return (
    <StepScaffold
      step={5}
      title="Add the details"
      subtitle="A clear title helps the right people say yes."
      onNext={() => nav.navigate('create_activity_preview')}
      nextLabel="Preview"
      nextIcon="eye"
      nextDisabled={!titleOk}
      hint={!titleOk ? 'Give your plan a title (3+ characters)' : null}
    >
      <View style={{ marginTop: space.lg }}>
        <TextField label="Title" value={draft.title} onChangeText={(t) => updateDraft({ title: t, autoTitle: false })} placeholder="e.g. Chai break near CG Road" maxLength={60} />
        <TextField
          label="Description"
          value={draft.description}
          onChangeText={(t) => updateDraft({ description: t })}
          placeholder="What will you do? Anything to bring?"
          multiline
          maxLength={280}
          style={{ marginBottom: 0 }}
        />
      </View>

      <FieldLabel>Cost</FieldLabel>
      <ChipGrid columns={2}>
        {COST_OPTIONS.map((c) => (
          <Chip key={c} label={c} fill selected={costPreset === c} onPress={() => updateDraft({ cost: c })} />
        ))}
      </ChipGrid>
      <TextField
        value={costPreset ? '' : draft.cost}
        onChangeText={(t) => updateDraft({ cost: t })}
        placeholder="Or describe it, e.g. Court split ~₹200 each"
        icon="dollar-sign"
        maxLength={60}
        helper="Joining is free. People settle costs between them."
        style={{ marginTop: space.sm, marginBottom: 0 }}
      />

      <MoreOptions title="Tags & accessibility" subtitle={extras.length ? extras.join(' · ') : 'Optional'} initiallyOpen={extras.length > 0}>
        <FieldLabel right={`${tags.length}/${MAX_TAGS}`} style={{ marginTop: space.xs }}>
          Vibe tags
        </FieldLabel>
        <ChipGrid columns={2}>
          {TAG_OPTIONS.map((t) => (
            <Chip key={t} label={t} fill selected={tags.includes(t)} onPress={() => toggleTag(t)} />
          ))}
        </ChipGrid>
        <TextField
          label="Accessibility notes"
          value={draft.accessibility}
          onChangeText={(t) => updateDraft({ accessibility: t })}
          placeholder="e.g. Step-free entrance, seating"
          icon="info"
          maxLength={120}
          style={{ marginTop: space.lg, marginBottom: 0 }}
        />
      </MoreOptions>
    </StepScaffold>
  );
}
