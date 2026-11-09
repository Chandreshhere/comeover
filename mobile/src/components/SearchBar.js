import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, fonts, isDark, radius, space } from '@/theme/tokens';
import AppText from './AppText';
import { IconButton, usePressScale } from './Button';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Pill search field. Pass `onPress` to use it as a launcher (navigates to the
// search screen) or `value/onChangeText` for a live input.
export default function SearchBar({ placeholder = 'Search plans, people, places', value, onChangeText, onPress, onFilter, autoFocus, style, onSubmitEditing }) {
  const press = usePressScale(0.98);
  const canClear = !onPress && !!value && !!onChangeText;
  const inner = (
    <View
      style={[
        {
          height: 52,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          borderWidth: 1.2,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 18,
          paddingRight: onFilter ? 4 : canClear ? 6 : 18,
        },
        style,
      ]}
    >
      <Icon name="search" size={18} color={colors.inkSoft} />
      {onPress ? (
        <AppText color={colors.muted} style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>
          {placeholder}
        </AppText>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          selectionColor={colors.deep}
          keyboardAppearance={isDark() ? 'dark' : 'light'}
          autoFocus={autoFocus}
          returnKeyType="search"
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel="Search"
          style={{ flex: 1, marginLeft: 10, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 }}
        />
      )}
      {canClear && (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: onFilter ? space.xxs : 0 }}
        >
          <Icon name="x-circle" size={18} color={colors.muted} weight="fill" />
        </Pressable>
      )}
      {onFilter && <IconButton icon="sliders" variant="ink" size={42} onPress={onFilter} accessibilityLabel="Open filters" />}
    </View>
  );
  if (!onPress) return inner;
  return (
    <AnimatedPressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole="search" accessibilityLabel={placeholder} style={press.style}>
      {inner}
    </AnimatedPressable>
  );
}
