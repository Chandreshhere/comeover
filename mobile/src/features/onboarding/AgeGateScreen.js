// age_gate — 18+ attestation + terms acknowledgement. No date of birth collected.
// Also reachable mid-app via useQuickJoin with `returnTo: { screen, params }`.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Mascot, Sheet } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import OnboardingFrame, { CheckRow } from './components/OnboardingFrame';
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
      title="Are you 18+?"
      subtitle="Come Over is for adults meeting up in real life."
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
      <CheckRow
        checked={adult}
        onToggle={() => setAdult((v) => !v)}
        label="I confirm I am 18 or older"
        sublabel="Never shown publicly. No date of birth needed. Lying about age breaks our Terms."
      />
      <CheckRow
        checked={terms}
        onToggle={() => setTerms((v) => !v)}
        label="I agree to the Terms and Community Guidelines"
        sublabel="Platonic plans, public spots, respect boundaries, no paid companionship."
      />

      <Sheet visible={under} onClose={() => setUnder(false)} title="Not yet, but soon">
        <View style={{ alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.periwinkleWash, borderRadius: radius.card, padding: space.md }}>
            <Mascot size={120} pose="wave" mood="still" />
          </View>
          <AppText align="center" color={colors.inkSoft} style={{ marginTop: space.md }}>
            Come Over is for in-person meetups, so it's 18+ only. We'd love to see you when you're 18.
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
