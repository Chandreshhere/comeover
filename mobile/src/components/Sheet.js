import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durations, easeOut } from '@/theme/motion';
import AppText from './AppText';
import { IconButton } from './Button';

// sheet_present: rises 18dp with fade; background dims. Tap scrim to close.
export default function Sheet({ visible, onClose, title, children, footer }) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const p = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      p.value = withTiming(1, { duration: durations.sheet, easing: easeOut });
    } else if (mounted) {
      p.value = withTiming(0, { duration: durations.micro }, (done) => done && runOnJS(setMounted)(false));
    }
  }, [visible]);

  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  const sheet = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 18 }] }));

  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.scrim }, scrim]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close sheet" accessibilityRole="button" />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: '88%',
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingTop: space.xs,
            paddingBottom: insets.bottom + space.md,
          },
          sheet,
        ]}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.xs }} />
        {title ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, marginBottom: space.sm }}>
            <AppText variant="h2" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </AppText>
            <IconButton icon="x" size={40} onPress={onClose} accessibilityLabel="Close" />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: layout.screenPadding, flexShrink: 1 }}>{children}</View>
        {footer ? <View style={{ paddingHorizontal: layout.screenPadding, marginTop: space.md }}>{footer}</View> : null}
      </Animated.View>
    </Modal>
  );
}
