// Block confirmation (modal) — consequences explained before acting.
// One primary (danger) action; "Block and report" is the quiet alternative.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ChatCircleSlash } from 'phosphor-react-native/src/icons/ChatCircleSlash';
import { AppText, Avatar, Button, EmptyState, ListGroup, Screen, ScreenHeader } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import IconBubble from '@/features/system/IconBubble';
import usePerson from './usePerson';

// [icon, text, bubble tone]
const CONSEQUENCES = [
  ['eye-off', "They can't see your profile or plans", 'lavender'],
  [ChatCircleSlash, "They can't message you", 'pink'],
  ['bell-off', "They aren't notified", 'orange'],
  ['log-out', 'Leave shared plans with no penalty', 'periwinkle'],
  ['rotate-ccw', 'Unblock anytime in Settings', 'mint'],
];

export default function BlockConfirmScreen() {
  const nav = useNavigation();
  const userId = useRoute().params?.userId;
  const blocked = useAppStore((s) => s.blocked);
  const blockUser = useAppStore((s) => s.blockUser);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const { person: cached, name } = usePerson(userId);
  const person = userId ? { ...(cached || {}), id: userId, name } : null;
  const isBlocked = userId ? blocked.includes(userId) : false;

  if (!person) {
    return (
      <Screen header={<ScreenHeader title="Block" />}>
        <EmptyState title="Nobody selected" body="Open a profile, plan or chat to block someone." cta="Close" onCta={() => nav.goBack()} />
      </Screen>
    );
  }

  const run = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'unblock') {
        await unblockUser(userId);
        nav.goBack();
        return;
      }
      await blockUser(userId);
      haptics.success();
      if (kind === 'block_report') nav.replace('report_flow', { userId });
      else nav.goBack();
    } catch (e) {
      setError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || 'Something went wrong. Please try again.');
      setBusy(null);
    }
  };

  return (
    <Screen
      header={<ScreenHeader title={isBlocked ? 'Blocked' : 'Block'} />}
      footer={
        isBlocked ? (
          <Button title={`Unblock ${person.name}`} variant="secondary" loading={busy === 'unblock'} disabled={!!busy} onPress={() => run('unblock')} />
        ) : (
          <View style={{ gap: space.xs }}>
            <Button title={`Block ${person.name}`} variant="danger" icon="slash" loading={busy === 'block'} disabled={!!busy} onPress={() => run('block')} />
            <Button title="Block and report" variant="ghost" icon="flag" loading={busy === 'block_report'} disabled={!!busy} onPress={() => run('block_report')} />
          </View>
        )
      }
    >
      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <Avatar seed={person.avatarSeed || person.id} uri={person.avatarUrl} size={88} ring ringColor={colors.border} />
        <AppText variant="h1" align="center" style={{ marginTop: space.md }}>
          {isBlocked ? `${person.name} is blocked` : `Block ${person.name}?`}
        </AppText>
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
          {isBlocked ? "You won't see each other anywhere in Come Over." : 'Blocking is private and takes effect immediately.'}
        </AppText>
      </View>
      {!isBlocked && (
        <ListGroup style={{ marginTop: space.xl }}>
          {CONSEQUENCES.map(([icon, text, tone], i) => (
            <View key={text} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space.xs, borderBottomWidth: i === CONSEQUENCES.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <IconBubble icon={icon} tone={tone} size={36} iconSize={18} />
              <AppText color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
                {text}
              </AppText>
            </View>
          ))}
        </ListGroup>
      )}
      {error ? (
        <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}
