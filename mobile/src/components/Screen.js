import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, layout, space } from '@/theme/tokens';
import AppText from './AppText';
import { IconButton } from './Button';

// Base screen container: safe areas, background, optional scroll, optional
// sticky footer (for primary CTAs) and room for the floating tab bar.
export default function Screen({
  children,
  bg = colors.canvas,
  scroll = true,
  padded = true,
  header,
  footer,
  tabBarSpace = false,
  keyboard = false,
  statusBar = 'dark-content',
  contentStyle,
  refreshControl,
  edges = ['top'],
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = (tabBarSpace ? layout.bottomNavHeight + space.md : 0) + (footer ? 0 : insets.bottom + space.xl);
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      contentContainerStyle={[{ paddingHorizontal: padded ? layout.screenPadding : 0, paddingBottom: bottomPad }, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: padded ? layout.screenPadding : 0 }, contentStyle]}>{children}</View>
  );

  const content = (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: edges.includes('top') ? insets.top : 0 }}>
      <StatusBar barStyle={statusBar} backgroundColor={bg} />
      {header}
      {body}
      {footer && (
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, backgroundColor: bg }}>
          {footer}
        </View>
      )}
    </View>
  );

  if (!keyboard) return content;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {content}
    </KeyboardAvoidingView>
  );
}

// Back button + centred title + optional right slot (matches reference headers).
export function ScreenHeader({ title, subtitle, right, onBack, back = true, variant = 'surface', style }) {
  const nav = useNavigation();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.xs, minHeight: 60 },
        style,
      ]}
    >
      <View style={{ width: 44 }}>
        {back && (
          <IconButton
            icon="arrow-left"
            variant={variant}
            accessibilityLabel="Go back"
            onPress={() => (onBack ? onBack() : nav.canGoBack() && nav.goBack())}
          />
        )}
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: space.xs }}>
        {!!title && (
          <AppText variant="h3" numberOfLines={1} accessibilityRole="header">
            {title}
          </AppText>
        )}
        {!!subtitle && (
          <AppText variant="caption" color={colors.muted} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function SectionHeader({ title, action, onAction, right, style, color = colors.ink }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm }, style]}>
      <AppText variant="h3" color={color} accessibilityRole="header">
        {title}
      </AppText>
      {right ||
        (action ? (
          <AppText variant="label" color={colors.deep} onPress={onAction} accessibilityRole="button" suppressHighlighting>
            {action}
          </AppText>
        ) : null)}
    </View>
  );
}
