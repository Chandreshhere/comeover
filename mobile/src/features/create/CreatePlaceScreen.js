// Create step 3 — public venue / public area picker.
// Plans must be in public places; the exact spot is only revealed to accepted people.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, Chip, Icon, OptionCard, Pictogram, TextField } from '@/components';
import { CITY } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
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
      subtitle="Public places only. Others see the area until you accept them."
      onNext={() => nav.navigate('create_activity_group')}
      nextDisabled={!canNext}
      error={privateError}
      hint={!draft.area ? 'Choose an area to continue' : null}
    >
      <FieldLabel>Area{CITY.name ? ` in ${CITY.name}` : ''}</FieldLabel>
      {areas.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {(draft.area && !areas.includes(draft.area) ? [draft.area, ...areas] : areas).map((a) => (
            <Chip key={a} label={a} icon="map-pin" selected={draft.area === a} onPress={() => updateDraft({ area: a })} />
          ))}
        </View>
      ) : (
        <TextField value={draft.area} onChangeText={(t) => updateDraft({ area: t })} placeholder="Neighbourhood or area" icon="map-pin" maxLength={40} helper="Shown to others as an approximate area." />
      )}

      <FieldLabel>Type of place</FieldLabel>
      {VENUE_TYPES.map((v) => (
        <OptionCard
          key={v.value}
          title={v.value}
          subtitle={v.hint}
          selected={draft.venueType === v.value}
          onPress={() => updateDraft({ venueType: v.value })}
          left={
            <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: draft.venueType === v.value ? colors.periwinkle : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={v.pictogram} size={22} />
            </View>
          }
        />
      ))}

      <FieldLabel>Venue name (optional)</FieldLabel>
      <TextField
        value={draft.venueName}
        onChangeText={(t) => updateDraft({ venueName: t })}
        placeholder={draft.area ? `e.g. Café near ${draft.area} main gate` : 'e.g. Café near the main gate'}
        icon="map-pin"
        maxLength={60}
        error={privateError}
        helper="Shared with accepted people in the group chat."
      />

      <Card bg={colors.periwinkle} elevated={false} style={{ borderRadius: radius.hero, marginTop: space.xs }} accessibilityLabel={`Others will see ${draft.area}, ${draft.venueType}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="pin" size={22} />
          </View>
          <View style={{ marginLeft: space.sm, flex: 1 }}>
            <AppText variant="caption" color={colors.inkSoft}>
              Before accepting, others see
            </AppText>
            <AppText variant="bodyStrong">
              {draft.area ? `~${draft.area} · ` : ''}
              {draft.venueType}
            </AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: space.sm }}>
          <Icon name="lock" size={14} color={colors.inkSoft} style={{ marginTop: 2 }} />
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: 6 }}>
            The exact spot is revealed only to people you accept. Your live location is never shown to anyone.
          </AppText>
        </View>
      </Card>
    </StepScaffold>
  );
}
