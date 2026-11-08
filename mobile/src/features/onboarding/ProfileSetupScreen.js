// profile_setup — name, short bio, illustrated avatar (or optional photo).
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Avatar, Button, TextField } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import useAvatarPicker from '../profile/useAvatarPicker';
import OnboardingFrame from './components/OnboardingFrame';

const randomSeed = () => `me-${Math.random().toString(36).slice(2, 8)}`;

export default function ProfileSetupScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [seed, setSeed] = useState(profile.avatarSeed);
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
      title="How should people know you?"
      subtitle="First name is enough. Keep it friendly — this shows on plans you host or join."
      footer={<Button title={avatar.uploading ? 'Uploading photo…' : 'Continue'} onPress={next} disabled={!trimmed || avatar.uploading} />}
    >
      <View style={{ alignItems: 'center' }}>
        <View>
          <Avatar seed={seed} uri={avatar.uri} size={116} ring ringColor={colors.surface} label="Your avatar preview" />
          {avatar.uploading && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 58, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Uploading photo">
              <ActivityIndicator color={colors.white} />
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md }}>
          <Button
            title="Shuffle avatar"
            icon="shuffle"
            size="sm"
            variant="secondary"
            full={false}
            disabled={avatar.uploading}
            onPress={() => {
              avatar.clear();
              setSeed(randomSeed());
            }}
          />
          <Button title={avatar.uri ? 'Change photo' : 'Add photo'} icon="image" size="sm" variant="secondary" full={false} disabled={avatar.uploading} onPress={avatar.pick} />
        </View>
        {avatar.error && (
          <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
            {avatar.error}
          </AppText>
        )}
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
          Photos are optional. Illustrated avatars are just as welcome.
        </AppText>
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
          placeholder="New in Ahmedabad, always up for chai and a walk."
          multiline
          maxLength={240}
          helper="No phone numbers or social handles — share those only when you're ready."
        />
      </View>
    </OnboardingFrame>
  );
}
