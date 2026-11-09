// Create step 3 — public venue / public area picker.
// Plans must be in public places; the exact spot is only revealed to accepted people.
import React, { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Chip, ChipGrid, TextField } from '@/components';
import { CITY } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { VENUE_TYPES, looksPrivate } from './createUtils';

export default function CreatePlaceScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const homeArea = useAppStore((s) => s.profile.area);

  // Areas come from the server's city taxonomy (bootstrap). Default to the user's area.
  const areas = CITY.areas;
  useEffect(() => {
    if (!draft.area && homeArea) updateDraft({ area: homeArea });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeArea]);

  const privateError = looksPrivate(draft.venueName) ? 'Plans can’t be at homes or private addresses. Pick a public place.' : null;
  const canNext = !!draft.area && !!draft.venueType && !privateError;

  return (
    <StepScaffold
      step={3}
      title="Where will you meet?"
      subtitle="Public places only. Others see just the area at first."
      onNext={() => nav.navigate('create_activity_group')}
      nextDisabled={!canNext}
      error={privateError}
      hint={!draft.area ? 'Choose an area to continue' : `Others see: ~${draft.area} · ${draft.venueType || 'Public place'}`}
    >
      <FieldLabel>Area{CITY.name ? ` in ${CITY.name}` : ''}</FieldLabel>
      {areas.length ? (
        <ChipGrid columns={2}>
          {(draft.area && !areas.includes(draft.area) ? [draft.area, ...areas] : areas).map((a) => (
            <Chip key={a} label={a} fill selected={draft.area === a} onPress={() => updateDraft({ area: a })} />
          ))}
        </ChipGrid>
      ) : (
        <TextField value={draft.area} onChangeText={(t) => updateDraft({ area: t })} placeholder="Neighbourhood or area" icon="map-pin" maxLength={40} helper="Shown to others as an approximate area." />
      )}

      <FieldLabel>Type of place</FieldLabel>
      <ChipGrid columns={2}>
        {VENUE_TYPES.map((v) => (
          <Chip key={v.value} label={v.value} pictogram={v.pictogram} accessibilityLabel={`${v.value}. ${v.hint}`} fill selected={draft.venueType === v.value} onPress={() => updateDraft({ venueType: v.value })} />
        ))}
      </ChipGrid>

      <FieldLabel right="Optional">Venue name</FieldLabel>
      <TextField
        value={draft.venueName}
        onChangeText={(t) => updateDraft({ venueName: t })}
        placeholder={draft.area ? `e.g. Café near ${draft.area} main gate` : 'e.g. Café near the main gate'}
        icon="map-pin"
        maxLength={60}
        error={privateError}
        helper="Only shared with people you accept."
      />
    </StepScaffold>
  );
}
