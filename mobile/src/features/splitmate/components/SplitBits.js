import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText, Avatar, Icon, Tag } from '@/components';
import { personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, fonts, isDark, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import { stateMeta } from '../lib/split';

// Fetches public profiles for split participants we have no name for yet, so
// rows show real names instead of a placeholder. Returns how many are known
// (the component re-renders as each profile arrives).
const inFlight = new Set();
export function useKnownPeople(ids) {
  const list = (ids || []).filter((id) => id && id !== 'me');
  const key = list.join(',');
  const known = useAppStore(useCallback((s) => list.filter((id) => s.users[id]?.name).length, [key])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = useAppStore.getState();
    list.forEach((id) => {
      if (s.users[id]?.name || inFlight.has(id)) return;
      inFlight.add(id);
      s.loadPublicProfile(id)
        .catch(() => null)
        .finally(() => inFlight.delete(id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return known;
}

// Avatar for a ledger participant: real photo when the API provides one,
// otherwise the illustrated avatar seeded by user id.
export function PersonAvatar({ id, size = 38 }) {
  const myUri = useAppStore((s) => s.profile.avatarUri);
  const mySeed = useAppStore((s) => s.profile.avatarSeed);
  useAppStore((s) => s.users[id]); // re-render when this user's profile arrives
  if (id === 'me') return <Avatar seed={mySeed || 'me-irl'} uri={myUri} size={size} />;
  const p = personById[id];
  return <Avatar seed={p?.avatarSeed || id} uri={p?.avatarUrl} size={size} />;
}

// Avatar + name toggle chip used for choosing participants / assignees / payer.
// `fill`: stretch to the parent's width (inside a ChipGrid cell).
export function PersonToggle({ id, name, selected, onPress, size = 'md', disabled, fill = false }) {
  const small = size === 'sm';
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      disabled={disabled}
      hitSlop={small ? 5 : 1}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: small ? 34 : 42,
        maxWidth: fill ? '100%' : 200,
        alignSelf: fill ? 'stretch' : 'auto',
        paddingLeft: 4,
        paddingRight: small ? 10 : 14,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.ink : colors.surface,
        borderWidth: 1.2,
        borderColor: selected ? colors.ink : colors.border,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <PersonAvatar id={id} size={small ? 26 : 32} />
      <AppText variant="label" numberOfLines={1} color={selected ? colors.white : colors.inkSoft} style={{ marginLeft: 6, flexShrink: 1, flexGrow: fill ? 1 : 0 }}>
        {name}
      </AppText>
      {selected && !small && <Icon name="check" size={13} color={colors.white} style={{ marginLeft: 4 }} />}
    </Pressable>
  );
}

export function StatusTag({ state, style }) {
  const all = stateMeta();
  const m = all[state] || all.unsettled;
  return <Tag label={m.label} icon={m.icon} bg={m.bg} fg={m.fg} style={style} />;
}

// Rupee / percent input used on the review and bill screens. 44pt tall, the
// value is right-aligned next to a fixed ₹ prefix (or % suffix) so columns of
// amounts line up.
export function MoneyInput({ value, onChange, suffix, label, width = 116, onBlur }) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width,
        height: 44,
        backgroundColor: colors.surfaceSubtle,
        borderRadius: 14,
        paddingHorizontal: 12,
        borderWidth: 1.5,
        borderColor: focused ? colors.ink : colors.border,
      }}
    >
      {!suffix && (
        <AppText variant="bodyStrong" color={colors.muted}>
          ₹
        </AppText>
      )}
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        keyboardType="decimal-pad"
        keyboardAppearance={isDark() ? 'dark' : 'light'}
        selectTextOnFocus
        maxLength={10}
        placeholder="0"
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={{ flex: 1, minWidth: 0, height: 44, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, paddingVertical: 0, marginLeft: suffix ? 0 : 4, textAlign: 'right', includeFontPadding: false }}
      />
      {suffix && (
        <AppText variant="bodyStrong" color={colors.muted} style={{ marginLeft: 3 }}>
          {suffix}
        </AppText>
      )}
    </View>
  );
}

// Friendly inline guidance (not an alarm): soft tinted bubble with an icon,
// a short headline, an optional line of help and optional actions.
export function Hint({ tone = 'info', icon, title, body, children, style }) {
  const t = {
    info: { bg: colors.periwinkleWash, fg: colors.deep, icon: 'info' },
    warn: { bg: colors.orangeSoft, fg: colors.ink, icon: 'lightbulb' },
    ok: { bg: colors.mint, fg: colors.ink, icon: 'check-circle' },
  }[tone];
  return (
    <View accessibilityLiveRegion="polite" style={[{ flexDirection: 'row', backgroundColor: t.bg, borderRadius: radius.quest, padding: space.sm }, style]}>
      <Icon name={icon || t.icon} size={18} color={t.fg} weight="duotone" style={{ marginTop: 1 }} />
      <View style={{ flex: 1, marginLeft: space.xs }}>
        {!!title && <AppText variant="label">{title}</AppText>}
        {!!body && (
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: title ? 2 : 0 }}>
            {body}
          </AppText>
        )}
        {children}
      </View>
    </View>
  );
}

// Custody disclaimer (RBI PA rules: no pooling / holding funds). Shown where
// money matters: SplitMate home and the settle-up screen.
export function LedgerNote({ style, text }) {
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.surfaceSubtle, borderRadius: radius.quest, padding: space.sm, borderWidth: 1, borderColor: colors.border }, style]}>
      <Icon name="shield" size={16} color={colors.inkSoft} weight="duotone" style={{ marginTop: 1 }} />
      <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
        {text || 'Come Over never holds or moves money. You pay each other in your UPI app, and “marked paid” isn’t a bank confirmation.'}
      </AppText>
    </View>
  );
}
