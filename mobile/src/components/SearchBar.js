import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { colors, fonts, radius } from '@/theme/tokens';
import AppText from './AppText';
import { IconButton } from './Button';
import Icon from './Icon';

// Pill search field. Pass `onPress` to use it as a launcher (navigates to the
// search screen) or `value/onChangeText` for a live input.
export default function SearchBar({ placeholder = 'Search plans, people, places', value, onChangeText, onPress, onFilter, autoFocus, style, onSubmitEditing }) {
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
          paddingRight: onFilter ? 4 : 18,
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
          autoFocus={autoFocus}
          returnKeyType="search"
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel="Search"
          style={{ flex: 1, marginLeft: 10, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 }}
        />
      )}
      {onFilter && <IconButton icon="sliders" variant="ink" size={42} onPress={onFilter} accessibilityLabel="Open filters" />}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="search" accessibilityLabel={placeholder}>
      {inner}
    </Pressable>
  );
}
