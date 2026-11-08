import React, { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, Chip, Screen, ScreenHeader, SectionHeader, Sheet, TextField } from '@/components';
import { CITY, categories } from '@/data/catalog';
import * as E from '@/api/endpoints';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import useAvatarPicker from './useAvatarPicker';

const LANGS = ['English', 'Hindi', 'Gujarati', 'Marathi', 'Tamil', 'Telugu', 'Bengali', 'Kannada', 'Malayalam', 'Punjabi'];

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
  const avatar = useAvatarPicker({ uri: profile.avatarUri, key: profile.avatarKey });
  const [nameError, setNameError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

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
      setSaveError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Your changes aren't saved yet — try again when connected." : e.message || "Couldn't save your profile. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => (dirty ? setConfirmDiscard(true) : nav.goBack());

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
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <View>
          <Avatar seed={avatarSeed} uri={avatar.uri} size={104} ring ringColor={colors.periwinkle} label="Profile picture preview" />
          {avatar.uploading && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 52, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Uploading photo">
              <ActivityIndicator color={colors.white} />
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            title="Shuffle illustration"
            icon="shuffle"
            size="sm"
            variant="secondary"
            full={false}
            disabled={avatar.uploading}
            onPress={() => {
              setAvatarSeed(`me-${Math.random().toString(36).slice(2, 8)}`);
              avatar.clear();
            }}
          />
          <Button title={avatar.uri ? 'Change photo' : 'Use a photo'} icon="image" size="sm" variant="secondary" full={false} disabled={avatar.uploading} onPress={avatar.pick} />
        </View>
        {avatar.uri && !avatar.uploading ? (
          <AppText variant="label" color={colors.danger} style={{ marginTop: space.xs }} onPress={avatar.clear} accessibilityRole="button">
            Remove photo
          </AppText>
        ) : null}
        {avatar.error ? (
          <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
            {avatar.error}
          </AppText>
        ) : null}
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
          Photos are reviewed for safety. Use a clear photo of yourself — no logos or other people.
        </AppText>
      </View>

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
        placeholder="e.g. Group plans only · prefer daytime · no alcohol"
        helper="Shown on your profile so hosts know what you're comfortable with."
      />

      <SectionHeader title="Your area" />
      <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.xs }}>
        Others only ever see this neighbourhood, never your exact location.
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {CITY.areas.map((a) => (
          <Chip key={a} label={a} selected={area === a} onPress={() => setArea(a)} />
        ))}
      </View>

      <SectionHeader title="Activities you're into" right={<AppText variant="caption" color={colors.muted}>{interests.length} picked</AppText>} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={interests.includes(c.slug)} onPress={() => toggle(interests, setInterests, c.slug)} />
        ))}
      </View>

      <SectionHeader title="Languages" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {LANGS.map((l) => (
          <Chip key={l} label={l} selected={languages.includes(l)} onPress={() => toggle(languages, setLanguages, l)} />
        ))}
      </View>

      <Sheet visible={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard changes?">
        <AppText color={colors.inkSoft}>You have unsaved edits to your profile.</AppText>
        <Button title="Save changes" style={{ marginTop: space.lg }} onPress={() => { setConfirmDiscard(false); save(); }} />
        <Button title="Discard" variant="ghost" style={{ marginTop: space.xs }} onPress={() => { setConfirmDiscard(false); nav.goBack(); }} />
      </Sheet>
    </Screen>
  );
}
