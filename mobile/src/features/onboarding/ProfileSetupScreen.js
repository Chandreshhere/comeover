// profile_setup — name, short bio and an avatar: a personality vibe + skin tone
// (a warm default is preselected), or an optional photo.
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, TextField } from '@/components';
import { shuffleAvatar, starterAvatar } from '@/illustrations/avatarPresets';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import AvatarPicker from '../profile/components/AvatarPicker';
import useAvatarPicker from '../profile/useAvatarPicker';
import OnboardingFrame from './components/OnboardingFrame';

export default function ProfileSetupScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [seed, setSeed] = useState(() => starterAvatar(profile.avatarSeed));
  const avatar = useAvatarPicker({ uri: profile.avatarUri, key: profile.avatarKey });
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const nameValid = trimmed.length >= 2 && trimmed.length <= 30;

  const next = () => {
    setTouched(true);
    if (!nameValid || avatar.uploading) return;
    // Saved to the server via PATCH /me (debounced in the store).
    setProfile({ name: trimmed, bio: bio.trim(), avatarSeed: seed, avatarKey: avatar.key, avatarUri: avatar.uri });
    nav.navigate('interest_picker');
  };

  return (
    <OnboardingFrame
      stepId="profile_setup"
      keyboard
      title="What's your name?"
      subtitle="First name is enough. It shows on plans you host or join."
      footer={<Button title={avatar.uploading ? 'Uploading photo…' : 'Continue'} onPress={next} disabled={!trimmed || avatar.uploading} />}
    >
      <View style={{ alignItems: 'center' }}>
        <View>
          <Avatar seed={seed} uri={avatar.uri} size={104} ring ringColor={colors.surface} animated label="Your avatar preview" />
          {avatar.uploading && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 52, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Uploading photo">
              <ActivityIndicator color={colors.pureWhite} />
            </View>
          )}
        </View>
        {/* Photos are optional: a vibe avatar is the default. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs, marginTop: space.md }}>
          <Button
            title="Shuffle look"
            icon="shuffle"
            size="sm"
            variant="secondary"
            full={false}
            disabled={avatar.uploading}
            onPress={() => {
              avatar.clear();
              setSeed(shuffleAvatar(seed));
            }}
          />
          <Button title={avatar.uri ? 'Change photo' : 'Add photo'} icon="image" size="sm" variant="secondary" full={false} disabled={avatar.uploading} onPress={avatar.pick} />
        </View>
        {avatar.error && (
          <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
            {avatar.error}
          </AppText>
        )}
      </View>

      <View style={{ marginTop: space.xl }}>
        <TextField
          label="First name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Aanya"
          maxLength={30}
          autoCapitalize="words"
          textContentType="givenName"
          onBlur={() => setTouched(true)}
          error={touched && !nameValid ? 'Use 2–30 characters.' : null}
        />
        <TextField
          label="Short bio (optional)"
          value={bio}
          onChangeText={setBio}
          placeholder="New in town, always up for chai and a walk."
          multiline
          maxLength={240}
          helper="No phone numbers or social handles."
        />
      </View>

      {/* Pick a vibe (a warm default is already chosen); picking clears a photo. */}
      <AvatarPicker
        compact
        value={seed}
        onChange={(picked) => {
          if (avatar.uploading) return;
          avatar.clear();
          setSeed(picked);
        }}
        style={{ marginTop: space.md }}
      />
    </OnboardingFrame>
  );
}
