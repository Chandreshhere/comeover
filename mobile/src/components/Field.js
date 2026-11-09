import React from 'react';
import { Platform, Pressable, Switch, TextInput, View } from 'react-native';

const SWITCH_OVERHANG = Platform.OS === 'ios' && (parseInt(String(Platform.Version), 10) || 0) >= 26 ? 12 : 0;
import { colors, fonts, isDark, onInkAlpha, radius, space } from '@/theme/tokens';
import AppText from './AppText';
import Icon from './Icon';

export function TextField({ label, value, onChangeText, placeholder, helper, error, multiline, maxLength, keyboardType, icon, right, style, inputStyle, autoFocus, secureTextEntry, ...rest }) {
  return (
    <View style={[{ marginBottom: space.md }, style]}>
      {!!label && (
        <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
          {label}
        </AppText>
      )}
      <View
        style={{
          minHeight: multiline ? 104 : 52,
          borderRadius: 18,
          backgroundColor: colors.surface,
          borderWidth: 1.2,
          borderColor: error ? colors.danger : colors.border,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          paddingHorizontal: 16,
          paddingVertical: multiline ? 12 : 0,
        }}
      >
        {icon && <Icon name={icon} size={18} color={colors.muted} style={{ marginRight: 10, marginTop: multiline ? 2 : 0 }} />}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          multiline={multiline}
          maxLength={maxLength}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          secureTextEntry={secureTextEntry}
          keyboardAppearance={isDark() ? 'dark' : 'light'}
          accessibilityLabel={label || placeholder}
          style={[{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: multiline ? 0 : 12, textAlignVertical: multiline ? 'top' : 'center' }, inputStyle]}
          {...rest}
        />
        {right}
      </View>
      {(error || helper || maxLength) && (
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          <AppText variant="caption" color={error ? colors.danger : colors.muted} style={{ flex: 1 }}>
            {error || helper || ''}
          </AppText>
          {maxLength ? (
            <AppText variant="caption" color={colors.muted}>
              {(value || '').length}/{maxLength}
            </AppText>
          ) : null}
        </View>
      )}
    </View>
  );
}

// Settings / menu row. `right` can be 'chevron', a boolean (switch) or a node.
export function ListRow({ icon, iconBg = colors.surfaceSubtle, title, subtitle, value, onPress, toggle, onToggle, danger, right, style, last }) {
  const isSwitch = typeof toggle === 'boolean';
  const body = (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, minHeight: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border },
        style,
      ]}
    >
      {icon && (
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
          <Icon name={icon} size={18} color={danger ? colors.danger : colors.ink} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" color={danger ? colors.danger : colors.ink}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        )}
      </View>
      {value != null && (
        <AppText variant="label" color={colors.muted} style={{ marginRight: 6 }}>
          {value}
        </AppText>
      )}
      {isSwitch ? (
        // iOS 26 draws UISwitch 63pt wide in a 51pt box: reserve the overhang
        // so the switch never touches the card edge.
        <View style={{ marginRight: SWITCH_OVERHANG }}>
          <Switch
            value={toggle}
            onValueChange={onToggle}
            trackColor={{ false: colors.track, true: isDark() ? '#5B78D6' : colors.ink }}
            thumbColor={colors.pureWhite}
            ios_backgroundColor={colors.track}
            accessibilityLabel={title}
          />
        </View>
      ) : (
        right || (onPress ? <Icon name="chevron-right" size={18} color={colors.muted} /> : null)
      )}
    </View>
  );
  if (!onPress || isSwitch) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} android_ripple={{ color: colors.track }}>
      {body}
    </Pressable>
  );
}

// White grouped container for ListRows.
export function ListGroup({ children, style }) {
  return <View style={[{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }, style]}>{children}</View>;
}

// Large selectable option card (onboarding pickers, create flow).
export function OptionCard({ title, subtitle, selected, onPress, left, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          padding: space.md,
          borderRadius: 20,
          backgroundColor: selected ? colors.ink : colors.surface,
          borderWidth: 1.2,
          borderColor: selected ? colors.ink : colors.border,
          marginBottom: space.xs,
        },
        style,
      ]}
    >
      {left}
      <View style={{ flex: 1, marginLeft: left ? space.sm : 0 }}>
        <AppText variant="bodyStrong" color={selected ? colors.white : colors.ink}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" color={selected ? onInkAlpha(0.7) : colors.muted} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        )}
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: selected ? colors.white : colors.border,
          backgroundColor: selected ? colors.white : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <Icon name="check" size={14} color={colors.ink} />}
      </View>
    </Pressable>
  );
}
