// Shared layout for onboarding steps: back button, step progress, one title
// (the step's single question) + one subtitle line, a scrollable body and a
// sticky footer holding the step's one primary action.
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, IconButton, ProgressBar, Screen, usePressScale } from '@/components';
import { colors, glass, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import IconBubble from '@/features/system/IconBubble';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  social_style: 11,
};
export const TOTAL_STEPS = 11;

// The brand hero background (flat periwinkle) gets the frosted "glass" header
// treatment. Read at render time so it matches the live light/dark value.
const isHeroBg = (bg) => bg === colors.periwinkle;

export function StepHeader({ step, onBack, back = true, tone = 'surface', right }) {
  const nav = useNavigation();
  const onGlass = tone === 'glass';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.xs, minHeight: 60 }}>
      <View style={{ width: layout.iconButton }}>
        {back && (
          <IconButton
            icon="arrow-left"
            variant={tone}
            accessibilityLabel="Go back"
            onPress={() => (onBack ? onBack() : nav.canGoBack() && nav.goBack())}
          />
        )}
      </View>
      {/* A thin progress bar centred on the back button's axis; the step count
          is announced to screen readers instead of printed. */}
      <View style={{ flex: 1, paddingHorizontal: space.md }}>
        {step ? (
          <ProgressBar
            value={step / TOTAL_STEPS}
            height={6}
            track={onGlass ? glass(0.55) : colors.track}
            accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}
          />
        ) : null}
      </View>
      <View style={{ width: layout.iconButton, alignItems: 'flex-end' }}>{right}</View>
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
  const tone = isHeroBg(bg) ? 'glass' : 'surface';
  return (
    <Screen
      bg={bg}
      keyboard={keyboard}
      scroll={scroll}
      header={<StepHeader step={s} back={back} onBack={onBack} tone={tone} right={headerRight} />}
      footer={footer}
    >
      {hero ? <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>{hero}</Animated.View> : null}
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
      <Animated.View entering={enter(3)} style={{ marginTop: space.xl }}>
        {children}
      </Animated.View>
    </Screen>
  );
}

// Accessible checkbox row used for attestations and consent. Springs on press.
export function CheckRow({ checked, onToggle, label, sublabel, style }) {
  const press = usePressScale(0.98);
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.select();
        onToggle?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint={sublabel}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: checked ? colors.periwinkleWash : colors.surface,
          borderRadius: radius.card,
          borderWidth: 1.2,
          borderColor: checked ? colors.ink : colors.border,
          padding: space.md,
          marginBottom: space.xs,
        },
        press.style,
        style,
      ]}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: colors.ink,
          backgroundColor: checked ? colors.ink : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: space.sm,
          marginTop: -2, // centre on the first 22pt line of the label
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
    </AnimatedPressable>
  );
}

// Point row with a duotone icon in a pastel bubble (value props, safety
// principles). `tone` picks a bubble palette (periwinkle | mint | lavender |
// orange | pink); `bubble` (a colour) is still honoured for older call sites.
// `icon` takes an icon name or a Phosphor component.
export function PointRow({ icon, title, body, bubble, tone = 'periwinkle', style }) {
  return (
    <View
      accessible
      accessibilityLabel={body ? `${title}. ${body}` : title}
      style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, marginBottom: space.xs }, style]}
    >
      <IconBubble icon={icon} tone={tone} size={44} iconSize={22} style={[{ marginRight: space.sm }, bubble ? { backgroundColor: bubble } : null]} />
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
