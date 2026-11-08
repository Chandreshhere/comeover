import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, IconButton, ProgressBar, Screen } from '@/components';
import { colors, layout, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { STEPS } from '../createUtils';

// Shared chrome for the 6-step create flow: back, "Step n of 6", progress,
// "Save & exit" (the draft is persisted in the store) and a sticky Next CTA.
export default function StepScaffold({ step, title, subtitle, children, onNext, nextLabel = 'Next', nextIcon = 'arrow-right', nextDisabled, loading, hint, error }) {
  const nav = useNavigation();
  const total = STEPS.length;
  return (
    <Screen
      keyboard
      bg={colors.canvas}
      header={
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}>
            <IconButton icon={step === 1 ? 'x' : 'arrow-left'} accessibilityLabel={step === 1 ? 'Close' : 'Previous step'} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('main'))} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <AppText variant="label" color={colors.muted}>
                Step {step} of {total}
              </AppText>
            </View>
            <Pressable onPress={() => nav.navigate('main')} accessibilityRole="button" accessibilityLabel="Save draft and exit" hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <AppText variant="label" color={colors.deep}>
                Save & exit
              </AppText>
            </Pressable>
          </View>
          <ProgressBar value={step / total} style={{ marginTop: space.xs }} accessibilityLabel={`Step ${step} of ${total}`} />
        </View>
      }
      footer={
        <View>
          {!!(error || hint) && (
            <AppText variant="caption" color={error ? colors.danger : colors.muted} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {error || hint}
            </AppText>
          )}
          <Button title={nextLabel} iconRight={nextIcon} onPress={onNext} disabled={nextDisabled} loading={loading} />
        </View>
      }
    >
      <Animated.View entering={enter(0)}>
        <AppText variant="h1" style={{ marginTop: space.lg }} accessibilityRole="header">
          {title}
        </AppText>
        {!!subtitle && (
          <AppText color={colors.muted} style={{ marginTop: space.xxs }}>
            {subtitle}
          </AppText>
        )}
      </Animated.View>
      {children}
    </Screen>
  );
}

export function FieldLabel({ children, style }) {
  return (
    <AppText variant="h3" style={[{ marginTop: space.xl, marginBottom: space.sm }, style]}>
      {children}
    </AppText>
  );
}
