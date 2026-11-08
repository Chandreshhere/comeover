// phone_entry — Indian mobile number (+91), validated before OTP request.
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, fonts, space } from '@/theme/tokens';
import OnboardingFrame from './components/OnboardingFrame';
import { otpErrorMessage } from './authErrors';

const VALID = /^[6-9]\d{9}$/;

export default function PhoneEntryScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const requestOtp = useAppStore((s) => s.requestOtp);
  const savedPhone = useAppStore((s) => s.session.phone);
  const [digits, setDigits] = useState(savedPhone?.startsWith('+91') ? savedPhone.slice(3) : '');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rateLimited, setRateLimited] = useState(false);

  const valid = VALID.test(digits);
  const showInvalid = touched && digits.length > 0 && !valid;
  const isLogin = route.params?.mode === 'login';

  const submit = async () => {
    setTouched(true);
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    setRateLimited(false);
    try {
      const res = await requestOtp(`+91${digits}`);
      nav.navigate('otp_verify', { mode: route.params?.mode, retryAfterSec: res?.retryAfterSec, channel: res?.channel, maskedPhone: res?.maskedPhone, codeLength: res?.codeLength });
    } catch (e) {
      if (e?.code === 'otp_rate_limited') {
        setRateLimited(true);
        setError('A code was sent recently. Wait a minute before requesting another.');
      } else {
        setError(otpErrorMessage(e, "We couldn't send the code. Try again in a moment."));
      }
    } finally {
      setLoading(false);
    }
  };

  const formatted = digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

  return (
    <OnboardingFrame
      stepId="phone_entry"
      keyboard
      title={isLogin ? 'Welcome back' : "What's your number?"}
      subtitle="We'll text a 6-digit code to verify it's you. Your number is never shown to other members."
      footer={
        <View>
          <Button title="Send code" onPress={submit} loading={loading} disabled={!valid} iconRight="arrow-right" />
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.sm }}>
            By continuing you agree to our Terms and Privacy Notice. Standard SMS rates may apply.
          </AppText>
        </View>
      }
    >
      <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
        Mobile number
      </AppText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 60,
          borderRadius: 20,
          backgroundColor: colors.surface,
          borderWidth: 1.2,
          borderColor: showInvalid || error ? colors.danger : colors.border,
          paddingHorizontal: 6,
        }}
      >
        <View style={{ height: 46, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surfaceSubtle, flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel="Country code India plus 91">
          <AppText variant="bodyStrong">🇮🇳 +91</AppText>
        </View>
        <TextInput
          value={formatted}
          onChangeText={(t) => {
            setDigits(t.replace(/\D/g, '').slice(0, 10));
            setError(null);
          }}
          onBlur={() => setTouched(true)}
          onSubmitEditing={submit}
          placeholder="98765 43210"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          maxLength={11}
          returnKeyType="done"
          accessibilityLabel="Mobile number, 10 digits"
          style={{ flex: 1, marginLeft: space.sm, fontFamily: fonts.semibold, fontSize: 20, letterSpacing: 1, color: colors.ink, paddingVertical: 0 }}
        />
        {valid && <Icon name="check-circle" size={20} color={colors.success} style={{ marginRight: 10 }} />}
      </View>
      {(showInvalid || error) && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: 6 }} accessibilityLiveRegion="polite">
          {error || 'Enter a valid 10-digit Indian mobile number.'}
        </AppText>
      )}
      {rateLimited && savedPhone === `+91${digits}` && (
        <Button title="I already have a code" variant="secondary" size="sm" full={false} style={{ marginTop: space.sm }} onPress={() => nav.navigate('otp_verify', { mode: route.params?.mode })} />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.xl, backgroundColor: colors.surface, borderRadius: 20, padding: space.md }}>
        <Icon name="lock" size={16} color={colors.inkSoft} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          We use your number only to sign you in and stop fake accounts. No contact-book access, ever.
        </AppText>
      </View>
    </OnboardingFrame>
  );
}
