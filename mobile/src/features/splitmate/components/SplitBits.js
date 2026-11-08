import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Avatar, Icon, Tag } from '@/components';
import { personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import { STATE_META } from '../lib/split';

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
export function PersonToggle({ id, name, selected, onPress, size = 'md', disabled }) {
  const small = size === 'sm';
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: small ? 34 : 42,
        paddingLeft: 4,
        paddingRight: small ? 10 : 14,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.ink : colors.surface,
        borderWidth: 1.2,
        borderColor: selected ? colors.ink : colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <PersonAvatar id={id} size={small ? 26 : 32} />
      <AppText variant="label" color={selected ? colors.white : colors.inkSoft} style={{ marginLeft: 6 }}>
        {name}
      </AppText>
      {selected && !small && <Icon name="check" size={13} color={colors.white} style={{ marginLeft: 4 }} />}
    </Pressable>
  );
}

export function StatusTag({ state }) {
  const m = STATE_META[state] || STATE_META.unsettled;
  return <Tag label={m.label} icon={m.icon} bg={m.bg} fg={m.fg} />;
}

// Always-visible custody disclaimer (RBI PA rules: no pooling / holding funds).
export function LedgerNote({ style, text }) {
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.surfaceSubtle, borderRadius: radius.quest, padding: space.sm, borderWidth: 1, borderColor: colors.border }, style]}>
      <Icon name="lock" size={15} color={colors.inkSoft} style={{ marginTop: 1 }} />
      <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
        {text || 'SplitMate is a shared ledger. Project IRL never holds or moves money — you pay each other directly in your UPI app, and “marked paid” is not a bank confirmation.'}
      </AppText>
    </View>
  );
}

// Step indicator for the create flow.
export function Steps({ step, total = 3 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignSelf: 'center', marginBottom: space.sm }} accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ width: i + 1 === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i + 1 <= step ? colors.ink : colors.track }} />
      ))}
    </View>
  );
}
