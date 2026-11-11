import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StatusBar, View } from 'react-native';
import { useNavigationBar } from '@/services/systemBars';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, isDark, layout, space } from '@/theme/tokens';
import AppText from './AppText';
import { IconButton } from './Button';
import MoRefresh from './MoRefresh';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';

// After a refresh finishes, keep the gap open a moment so Mo can cheer
// "Yay!" before the content (and Mo with it) slides back up.
function useRefreshYay(refreshing) {
  const [yay, setYay] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    let t;
    if (was.current && !refreshing) {
      setYay(true);
      sfx.play('pop');
      haptics.light();
      t = setTimeout(() => setYay(false), 850);
    }
    was.current = !!refreshing;
    return () => t && clearTimeout(t);
  }, [refreshing]);
  return yay;
}

// True while the software keyboard is on screen.
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return visible;
}

// Base screen container: safe areas, background, optional scroll, optional
// sticky footer (for primary CTAs) and room for the floating tab bar.
export default function Screen({
  children,
  bg: bgProp = colors.canvas,
  scroll = true,
  padded = true,
  header,
  footer,
  tabBarSpace = false,
  keyboard = false,
  statusBar,
  contentStyle,
  refreshControl,
  edges = ['top'],
}) {
  const insets = useSafeAreaInsets();
  const bg = isDark() && (bgProp === colors.surface || bgProp === colors.periwinkle) ? colors.canvas : bgProp;
  const keyboardUp = useKeyboardVisible();
  // The keyboard already covers the home-indicator area: drop that inset while
  // it is up so the CTA sits just above the keys instead of floating high.
  const footerBottom = keyboard && keyboardUp ? space.sm : insets.bottom + space.sm;
  const barStyle = statusBar || (isDark() ? 'light-content' : 'dark-content');
  // Android: the system navigation bar takes the screen colour, like iOS.
  useNavigationBar(bg);
  const bottomPad = (tabBarSpace ? layout.bottomNavHeight + space.md : 0) + (footer ? 0 : insets.bottom + space.xl);
  const refreshing = !!refreshControl?.props?.refreshing;
  const yay = useRefreshYay(refreshing);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const scrollView = (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl ? React.cloneElement(refreshControl, { refreshing: refreshing || yay, tintColor: 'transparent', colors: ['transparent'], progressBackgroundColor: 'transparent' }) : undefined}
      contentContainerStyle={[{ paddingHorizontal: padded ? layout.screenPadding : 0, paddingBottom: bottomPad }, contentStyle]}
    >
      {children}
    </Animated.ScrollView>
  );
  // Mo sits in the gap above the content and follows the pull.
  const body = scroll ? (
    refreshControl ? (
      <View style={{ flex: 1 }}>
        {scrollView}
        <MoRefresh scrollY={scrollY} refreshing={refreshing} yay={yay} />
      </View>
    ) : (
      scrollView
    )
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: padded ? layout.screenPadding : 0 }, contentStyle]}>{children}</View>
  );

  const content = (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: edges.includes('top') ? insets.top : 0 }}>
      <StatusBar barStyle={barStyle} backgroundColor={bg} />
      {header}
      {body}
      {footer && (
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: space.sm, paddingBottom: footerBottom, backgroundColor: bg }}>
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
