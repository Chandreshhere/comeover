// otp_verify — 6-box OTP with resend countdown and error/locked states.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, fonts, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import OnboardingFrame from './components/OnboardingFrame';
import { otpErrorMessage } from './authErrors';

const LEN = 6;
const RESEND_SEC = 30;

export default function OtpVerifyScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const phone = useAppStore((s) => s.session.phone);
  const verifyOtp = useAppStore((s) => s.verifyOtp);
  const requestOtp = useAppStore((s) => s.requestOtp);

  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(route.params?.retryAfterSec || RESEND_SEC);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  const reduce = useReducedMotion();
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async (value) => {
    if (value.length !== LEN || loading || locked) return;
    setLoading(true);
    setError(null);
    try {
      await verifyOtp(value);
      haptics.success();
      // verifyOtp loads /me/bootstrap, so session flags reflect the server.
      const { session } = useAppStore.getState();
      if (session.onboarded) nav.reset({ index: 0, routes: [{ name: 'main' }] });
      else if (session.ageConfirmed) nav.reset({ index: 0, routes: [{ name: 'profile_setup' }] });
      else nav.reset({ index: 0, routes: [{ name: 'age_gate' }] });
    } catch (e) {
      haptics.warning();
      if (!reduce) shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-5, { duration: 50 }), withTiming(0, { duration: 50 }));
      if (e?.code === 'otp_locked') setLocked(true);
      setError(otpErrorMessage(e, "That code didn't match. Check the SMS and try again."));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (seconds > 0) return;
    setError(null);
    setResending(true);
    try {
      const res = await requestOtp(phone);
      setLocked(false);
      setResent(true);
      setSeconds(res?.retryAfterSec || RESEND_SEC);
      setCode('');
      inputRef.current?.focus();
    } catch (e) {
      setError(otpErrorMessage(e, "Couldn't resend. Try again shortly."));
      setSeconds(RESEND_SEC);
    } finally {
      setResending(false);
    }
  };

  const masked = phone ? `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}` : 'your phone';

  return (
    <OnboardingFrame
      stepId="otp_verify"
      keyboard
      title="Enter the code"
      subtitle={`Sent to ${masked}.`}
      footer={<Button title="Verify" onPress={() => verify(code)} loading={loading} disabled={code.length !== LEN || locked} />}
    >
      <Pressable onPress={() => inputRef.current?.focus()} accessibilityRole="none" accessibilityLabel="One-time code input">
        <Animated.View style={[{ flexDirection: 'row', justifyContent: 'space-between' }, shakeStyle]}>
          {Array.from({ length: LEN }).map((_, i) => {
            const ch = code[i];
            const active = i === code.length && !locked;
            return (
              <View
                key={i}
                style={{
                  width: 48,
                  height: 60,
                  borderRadius: 16,
                  backgroundColor: locked ? colors.surfaceSubtle : colors.surface,
                  borderWidth: active ? 2 : 1.2,
                  borderColor: error ? colors.danger : active ? colors.ink : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="h1">{ch || ''}</AppText>
              </View>
            );
          })}
        </Animated.View>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => {
            const v = t.replace(/\D/g, '').slice(0, LEN);
            setCode(v);
            setError(null);
            if (v.length === LEN) verify(v);
          }}
          editable={!locked}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LEN}
          accessibilityLabel="Enter the 6-digit code"
          caretHidden
          style={{ position: 'absolute', width: '100%', height: 60, opacity: 0.01, fontFamily: fonts.regular }}
        />
      </Pressable>

      {error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={15} color={colors.danger} />
          <AppText variant="caption" color={colors.danger} style={{ marginLeft: 6, flex: 1 }}>
            {error}
          </AppText>
        </View>
      )}
      {resent && !error && (
        <AppText variant="caption" color={colors.success} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          New code sent.
        </AppText>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl }}>
        <AppText variant="label" color={colors.muted}>
          Didn't get it?
        </AppText>
        <Button
          title={seconds > 0 ? `Resend in 0:${String(seconds).padStart(2, '0')}` : 'Resend code'}
          size="sm"
          variant={seconds > 0 ? 'secondary' : 'primary'}
          full={false}
          disabled={seconds > 0 || resending}
          loading={resending}
          onPress={resend}
        />
      </View>
      <Button title="Change number" variant="ghost" size="sm" full={false} style={{ marginTop: space.xs }} onPress={() => nav.goBack()} />
    </OnboardingFrame>
  );
}
