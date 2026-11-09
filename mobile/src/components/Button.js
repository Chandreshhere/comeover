import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { colors, inkAlpha, layout, radius, shadow } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import haptics from '@/utils/haptics';
import AppText from './AppText';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Functions, not constants: they read the live (light/dark) palette.
const variants = () => ({
  primary: { bg: colors.ink, fg: colors.white, border: colors.ink },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.border },
  light: { bg: colors.white, fg: colors.ink, border: colors.white },
  periwinkle: { bg: colors.periwinkle, fg: colors.ink, border: colors.periwinkle },
  ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
  danger: { bg: colors.danger, fg: colors.pureWhite, border: colors.danger },
});

// Scale-on-press helper shared by every tappable surface (pressed_scale_0.98).
export function usePressScale(to = 0.98) {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return {
    style,
    onPressIn: () => {
      s.value = withTiming(to, { duration: durations.micro });
    },
    onPressOut: () => {
      s.value = withSpring(1, spring);
    },
  };
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  caps = false,
  full = true,
  align = 'start', // when not full width: 'start' | 'center' | 'end'
  style,
  accessibilityLabel,
}) {
  const all = variants();
  const v = all[variant] || all.primary;
  const press = usePressScale();
  const height = size === 'sm' ? 40 : size === 'xs' ? 32 : layout.buttonHeight;
  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={(e) => {
        haptics.light();
        onPress?.(e);
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={height < 44 ? (44 - height) / 2 : 0}
      style={[
        styles.base,
        {
          height,
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingHorizontal: size === 'md' ? 24 : 16,
          alignSelf: full ? 'stretch' : align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start',
          opacity: disabled ? 0.4 : 1,
        },
        variant === 'light' && shadow.card,
        press.style,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={size === 'md' ? 18 : 15} color={v.fg} style={{ marginRight: 8 }} />}
          <AppText variant={size === 'md' ? 'bodyStrong' : 'button'} color={v.fg} caps={caps} numberOfLines={1}>
            {title}
          </AppText>
          {iconRight && <Icon name={iconRight} size={size === 'md' ? 18 : 15} color={v.fg} style={{ marginLeft: 8 }} />}
        </View>
      )}
    </AnimatedPressable>
  );
}

const iconVariants = () => ({
  surface: { bg: colors.surface, fg: colors.ink, border: colors.border },
  glass: { bg: colors.glass, fg: colors.ink, border: inkAlpha(0.18) },
  ink: { bg: colors.ink, fg: colors.white, border: colors.ink },
  periwinkle: { bg: colors.periwinkle, fg: colors.ink, border: colors.periwinkle },
  plain: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
});

export function IconButton({ icon, onPress, variant = 'surface', size = layout.iconButton, badge, accessibilityLabel, style, iconSize, children }) {
  const all = iconVariants();
  const v = all[variant] || all.surface;
  const press = usePressScale(0.94);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={(e) => {
        haptics.select();
        onPress?.(e);
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: v.bg,
          borderWidth: 1.2,
          borderColor: v.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        press.style,
        style,
      ]}
    >
      {children || <Icon name={icon} size={iconSize || Math.round(size * 0.42)} color={v.fg} />}
      {badge ? <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.surface }]} /> : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
});
