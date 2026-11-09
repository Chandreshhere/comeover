// profile_edit — avatar or photo, the basics, activities and a few detail rows.
// Avatar, area and languages open in sheets so the page stays short. Saves
// with PATCH /me.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, Chip, ChipGrid, ListGroup, ListRow, Screen, ScreenHeader, SectionHeader, Sheet, TextField } from '@/components';
import { CITY, categories } from '@/data/catalog';
import { normalizeAvatar } from '@/illustrations/avatarPresets';
import * as E from '@/api/endpoints';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import { STYLE_META } from '@/utils/socialMatch';
import AvatarPicker from './components/AvatarPicker';
import useAvatarPicker from './useAvatarPicker';

const LANGS = ['English', 'Hindi', 'Gujarati', 'Marathi', 'Tamil', 'Telugu', 'Bengali', 'Kannada', 'Malayalam', 'Punjabi'];

const listValue = (list) => (!list.length ? 'None' : list.length <= 2 ? list.join(', ') : `${list.length} picked`);

export default function ProfileEditScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [pronouns, setPronouns] = useState(profile.pronouns || '');
  const [boundaries, setBoundaries] = useState(profile.boundaries || '');
  const [area, setArea] = useState(profile.area);
  const [interests, setInterests] = useState(profile.interests);
  const [languages, setLanguages] = useState(profile.languages || []);
  const [avatarSeed, setAvatarSeed] = useState(profile.avatarSeed);
  const [draftSeed, setDraftSeed] = useState(avatarSeed); // the avatar sheet's working choice
  const avatar = useAvatarPicker({ uri: profile.avatarUri, key: profile.avatarKey });
  const styleMeta = profile.socialStyle ? STYLE_META[profile.socialStyle] : null;
  const [nameError, setNameError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sheet, setSheet] = useState(null); // photo | avatar | area | languages | discard
  const close = () => setSheet(null);

  const dirty = useMemo(
    () =>
      name !== profile.name ||
      bio !== profile.bio ||
      pronouns !== (profile.pronouns || '') ||
      boundaries !== (profile.boundaries || '') ||
      area !== profile.area ||
      avatarSeed !== profile.avatarSeed ||
      avatar.uri !== profile.avatarUri ||
      interests.join() !== profile.interests.join() ||
      languages.join() !== (profile.languages || []).join(),
    [name, bio, pronouns, boundaries, area, avatarSeed, avatar.uri, interests, languages, profile]
  );

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // Saves with an explicit PATCH /me so failures are visible here; the store is
  // updated with the same values (its own debounced sync then re-sends a no-op).
  const save = async () => {
    if (!name.trim()) {
      setNameError('Add the name people will see');
      return;
    }
    if (avatar.uploading || saving) return;
    const patch = {
      name: name.trim(),
      bio: bio.trim(),
      pronouns: pronouns.trim(),
      boundaries: boundaries.trim(),
      area,
      interests,
      languages,
      avatarSeed,
      avatarKey: avatar.key,
    };
    setSaving(true);
    setSaveError(null);
    try {
      await E.me.update(patch);
      setProfile({ ...patch, avatarUri: avatar.uri });
      haptics.success();
      nav.goBack();
    } catch (e) {
      setSaveError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Changes aren't saved yet." : e.message || "Couldn't save your profile. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => (dirty ? setSheet('discard') : nav.goBack());

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Edit profile" onBack={onBack} />}
      footer={
        <View>
          {saveError ? (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {saveError}
            </AppText>
          ) : null}
          <Button title={avatar.uploading ? 'Uploading photo…' : 'Save changes'} onPress={save} loading={saving} disabled={!dirty || avatar.uploading} />
        </View>
      }
    >
      {/* Avatar or photo */}
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <View>
          <Avatar seed={avatarSeed} uri={avatar.uri} size={104} ring ringColor={colors.periwinkle} animated label="Profile picture preview" />
          {avatar.uploading && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 52, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Uploading photo">
              <ActivityIndicator color={colors.pureWhite} />
            </View>
          )}
        </View>
        <Button title="Change avatar" icon="smiley" size="sm" variant="secondary" full={false} align="center" disabled={avatar.uploading} style={{ marginTop: space.md }} onPress={() => setSheet('photo')} />
        {avatar.error ? (
          <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
            {avatar.error}
          </AppText>
        ) : null}
      </View>

      {/* Basics */}
      <SectionHeader title="About you" />
      <TextField
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setNameError(null);
        }}
        maxLength={40}
        error={nameError}
        placeholder="First name is enough"
        autoCapitalize="words"
      />
      <TextField label="Pronouns (optional)" value={pronouns} onChangeText={setPronouns} maxLength={24} placeholder="e.g. she/her, they/them" />
      <TextField label="Short bio" value={bio} onChangeText={setBio} multiline maxLength={240} placeholder="New to the city, into early runs and cutting chai." />
      <TextField
        label="Boundaries (optional)"
        value={boundaries}
        onChangeText={setBoundaries}
        multiline
        maxLength={160}
        placeholder="e.g. Group plans only · daytime · no alcohol"
        helper="Shown on your profile for hosts"
        style={{ marginBottom: 0 }}
      />

      {/* Activities */}
      <SectionHeader title="Activities" right={<AppText variant="caption" color={colors.muted}>{interests.length} picked</AppText>} />
      <ChipGrid columns={2}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} fill selected={interests.includes(c.slug)} onPress={() => toggle(interests, setInterests, c.slug)} />
        ))}
      </ChipGrid>

      {/* Details */}
      <SectionHeader title="Details" />
      <ListGroup>
        <ListRow icon="smiley" title="Social style" value={styleMeta ? styleMeta.label : 'Not set'} onPress={() => nav.navigate('social_style', { mode: 'edit' })} />
        <ListRow icon="map-pin" title="Area" value={area || 'Not set'} onPress={() => setSheet('area')} />
        <ListRow icon="globe" title="Languages" value={listValue(languages)} onPress={() => setSheet('languages')} last />
      </ListGroup>

      {/* Avatar or photo */}
      <Sheet visible={sheet === 'photo'} onClose={close} title="Profile picture">
        <ListGroup>
          <ListRow
            icon="smiley"
            title="Choose an avatar"
            onPress={() => {
              setDraftSeed(normalizeAvatar(avatarSeed));
              close();
              // Let this sheet's modal finish closing before the next one presents.
              setTimeout(() => setSheet('avatar'), 350);
            }}
          />
          <ListRow
            icon="image"
            title={avatar.uri ? 'Choose another photo' : 'Use a photo'}
            onPress={() => {
              close();
              // Let the sheet's modal finish closing before the photo picker presents.
              setTimeout(avatar.pick, 400);
            }}
            last={!avatar.uri}
          />
          {avatar.uri ? (
            <ListRow
              icon="trash-2"
              title="Remove photo"
              danger
              onPress={() => {
                avatar.clear();
                close();
              }}
              last
            />
          ) : null}
        </ListGroup>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
          A clear photo of just you. Photos are reviewed for safety.
        </AppText>
      </Sheet>

      {/* Avatar picker: choosing one replaces any photo once you save. */}
      <Sheet
        visible={sheet === 'avatar'}
        onClose={close}
        title="Choose an avatar"
        footer={
          <Button
            title="Use this avatar"
            onPress={() => {
              setAvatarSeed(draftSeed);
              avatar.clear();
              close();
            }}
          />
        }
      >
        <AvatarPicker value={draftSeed} onChange={setDraftSeed} />
      </Sheet>

      {/* Area */}
      <Sheet visible={sheet === 'area'} onClose={close} title="Your area" footer={<Button title="Done" onPress={close} />}>
        <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.sm }}>
          Others only see this neighbourhood, never your exact spot.
        </AppText>
        <ChipGrid columns={2}>
          {CITY.areas.map((a) => (
            <Chip key={a} label={a} fill selected={area === a} onPress={() => setArea(a)} />
          ))}
        </ChipGrid>
      </Sheet>

      {/* Languages */}
      <Sheet visible={sheet === 'languages'} onClose={close} title="Languages" footer={<Button title="Done" onPress={close} />}>
        <ChipGrid columns={2}>
          {LANGS.map((l) => (
            <Chip key={l} label={l} fill selected={languages.includes(l)} onPress={() => toggle(languages, setLanguages, l)} />
          ))}
        </ChipGrid>
      </Sheet>

      {/* Unsaved changes */}
      <Sheet visible={sheet === 'discard'} onClose={close} title="Discard changes?">
        <AppText color={colors.inkSoft}>You have unsaved edits to your profile.</AppText>
        <Button
          title="Save changes"
          style={{ marginTop: space.lg }}
          onPress={() => {
            close();
            save();
          }}
        />
        <Button
          title="Discard"
          variant="ghost"
          style={{ marginTop: space.xs }}
          onPress={() => {
            close();
            nav.goBack();
          }}
        />
      </Sheet>
    </Screen>
  );
}
