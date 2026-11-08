// age_gate — 18+ attestation + terms acknowledgement. No date of birth collected.
// Also reachable mid-app via useQuickJoin with `returnTo: { screen, params }`.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Mascot, Sheet } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import OnboardingFrame, { CheckRow, PointRow } from './components/OnboardingFrame';
import { otpErrorMessage } from './authErrors';

export default function AgeGateScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const confirmAge = useAppStore((s) => s.confirmAge);
  const returnTo = route.params?.returnTo;

  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [under, setUnder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const proceed = async () => {
    if (!adult || !terms || saving) return;
    setSaving(true);
    setError(null);
    try {
      await confirmAge(); // recorded server-side (PATCH /me) with the attestation time
      if (returnTo?.screen) nav.replace(returnTo.screen, returnTo.params);
      else nav.navigate('profile_setup');
    } catch (e) {
      setError(otpErrorMessage(e, "We couldn't save that. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingFrame
      stepId={returnTo ? undefined : 'age_gate'}
      title="A quick check"
      subtitle="Project IRL is for adults meeting up in real life, so everyone here is 18+."
      footer={
        <View>
          {error && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          <Button title="Continue" onPress={proceed} disabled={!adult || !terms} loading={saving} />
          <Button title="I'm under 18" variant="ghost" style={{ marginTop: space.xs }} onPress={() => setUnder(true)} />
        </View>
      }
    >
      <CheckRow checked={adult} onToggle={() => setAdult((v) => !v)} label="I confirm I am 18 or older" sublabel="We don't ask for your date of birth. Misrepresenting your age breaks our Terms." />
      <CheckRow
        checked={terms}
        onToggle={() => setTerms((v) => !v)}
        label="I agree to the Terms and Community Guidelines"
        sublabel="Platonic, activity-first plans · public meetup spots · respect boundaries · no selling or paid companionship."
      />
      <View style={{ marginTop: space.md }}>
        <PointRow icon="eye-off" title="Your age isn't shown publicly" body="It only unlocks joining and hosting plans." />
      </View>

      <Sheet visible={under} onClose={() => setUnder(false)} title="Not yet — but soon">
        <View style={{ alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.periwinkleWash, borderRadius: radius.card, padding: space.md }}>
            <Mascot size={120} pose="wave" mood="still" />
          </View>
          <AppText align="center" color={colors.inkSoft} style={{ marginTop: space.md }}>
            Project IRL coordinates in-person meetups, so it's only open to people aged 18 and over. We'd love to see you when you're 18.
          </AppText>
          <Button
            title="Back to start"
            style={{ marginTop: space.lg }}
            onPress={() => {
              setUnder(false);
              nav.reset({ index: 0, routes: [{ name: 'welcome' }] });
            }}
          />
        </View>
      </Sheet>
    </OnboardingFrame>
  );
}
