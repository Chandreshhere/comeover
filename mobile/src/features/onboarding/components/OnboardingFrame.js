// Shared layout for onboarding steps: back button, step progress, editorial
// title + subtitle, scrollable body and a sticky primary-CTA footer.
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, IconButton, ProgressBar, Screen } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';

export const STEPS = {
  phone_entry: 1,
  otp_verify: 2,
  age_gate: 3,
  profile_setup: 4,
  interest_picker: 5,
  intent_picker: 6,
  location_explainer: 7,
  location_permission: 7,
  notification_opt_in: 8,
  safety_intro: 9,
  first_plan_prompt: 10,
};
export const TOTAL_STEPS = 10;

export function StepHeader({ step, onBack, back = true, tone = 'surface', right }) {
  const nav = useNavigation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: space.xs, paddingBottom: space.xs, minHeight: 60 }}>
      <View style={{ width: 44 }}>
        {back && (
          <IconButton
            icon="arrow-left"
            variant={tone}
            accessibilityLabel="Go back"
            onPress={() => (onBack ? onBack() : nav.canGoBack() && nav.goBack())}
          />
        )}
      </View>
      <View style={{ flex: 1, paddingHorizontal: space.md }}>
        {step ? (
          <>
            <ProgressBar
              value={step / TOTAL_STEPS}
              height={6}
              track={tone === 'glass' ? 'rgba(255,255,255,0.55)' : colors.track}
              accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}
            />
            <AppText variant="caption" color={tone === 'glass' ? colors.inkSoft : colors.muted} align="center" style={{ marginTop: 4 }}>
              Step {step} of {TOTAL_STEPS}
            </AppText>
          </>
        ) : null}
      </View>
      <View style={{ width: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export default function OnboardingFrame({
  stepId,
  step,
  title,
  subtitle,
  children,
  footer,
  back = true,
  onBack,
  keyboard = false,
  bg = colors.canvas,
  hero,
  headerRight,
  scroll = true,
}) {
  const s = step ?? (stepId ? STEPS[stepId] : undefined);
  const tone = bg === colors.periwinkle ? 'glass' : 'surface';
  return (
    <Screen
      bg={bg}
      keyboard={keyboard}
      scroll={scroll}
      header={<StepHeader step={s} back={back} onBack={onBack} tone={tone} right={headerRight} />}
      footer={footer}
    >
      {hero ? <Animated.View entering={enter(0)}>{hero}</Animated.View> : null}
      {!!title && (
        <Animated.View entering={enter(1)}>
          <AppText variant="display" style={{ marginTop: hero ? space.lg : space.md }} accessibilityRole="header">
            {title}
          </AppText>
        </Animated.View>
      )}
      {!!subtitle && (
        <Animated.View entering={enter(2)}>
          <AppText color={colors.inkSoft} style={{ marginTop: space.xs }}>
            {subtitle}
          </AppText>
        </Animated.View>
      )}
      <Animated.View entering={enter(3)} style={{ marginTop: space.lg }}>
        {children}
      </Animated.View>
    </Screen>
  );
}

// Accessible checkbox row used for attestations and consent.
export function CheckRow({ checked, onToggle, label, sublabel, style }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: colors.surface,
          borderRadius: 20,
          borderWidth: 1.2,
          borderColor: checked ? colors.ink : colors.border,
          padding: space.md,
          marginBottom: space.xs,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: colors.ink,
          backgroundColor: checked ? colors.ink : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: space.sm,
          marginTop: 1,
        }}
      >
        {checked && <Icon name="check" size={16} color={colors.white} />}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {!!sublabel && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {sublabel}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

// White point row with icon bubble (value props, safety principles).
export function PointRow({ icon, title, body, bubble = colors.periwinkleWash, style }) {
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${body || ''}`}
      style={[{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, marginBottom: space.xs }, style]}
    >
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: bubble, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
        <Icon name={icon} size={19} color={colors.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {!!body && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {body}
          </AppText>
        )}
      </View>
    </View>
  );
}
