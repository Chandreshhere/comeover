// One quiet status line for a partner-venue table hold on a plan
// (GET /activities/{id}/table-hold → { hold }). Shown to the host and accepted
// members; renders nothing on 404, on any error, or when there is no hold.
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { AppText, Icon } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { tableHolds } from '@/api/endpoints';
import useRemote from '@/features/premium/useRemote';

// A function so the colours follow the live light/dark palette.
const holdLine = (h) =>
  h &&
  ({
    requested: { icon: 'clock', bg: colors.orangeSoft, text: 'Table requested, waiting for the venue' },
    confirmed: { icon: 'check-circle', bg: colors.mint, text: h.partySize ? `Table confirmed for ${h.partySize}` : 'Table confirmed' },
    declined: { icon: 'info', bg: colors.surfaceSubtle, text: 'Venue couldn’t hold a table' },
  }[h?.status] || null);

export default function TableHoldStatus({ activityId, enabled = true, isHost = false, style }) {
  const q = useRemote(() => tableHolds.get(activityId), [activityId], { enabled: enabled && !!activityId });
  const [withdrawn, setWithdrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const hold = d && d.hold !== undefined ? d.hold : d?.status ? d : null;
  const line = enabled && !withdrawn ? holdLine(hold) : null;
  if (!line) return null;
  const canWithdraw = isHost && (hold.status === 'requested' || hold.status === 'confirmed');
  const withdraw = () =>
    Alert.alert('Cancel the table?', 'We will tell the venue you no longer need it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel table',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await tableHolds.cancel(activityId);
            setWithdrawn(true);
          } catch (e) {
            Alert.alert('Couldn’t cancel', e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Try again.' : 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', minHeight: layout.minTouch, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.quest, backgroundColor: line.bg, marginTop: space.sm }, style]}
      accessible
      accessibilityLabel={`${line.text}${hold.status === 'declined' && hold.declineReason ? `. ${hold.declineReason}` : ''}`}
    >
      <Icon name={line.icon} size={16} color={colors.ink} />
      <View style={{ flex: 1, marginLeft: space.xs }}>
        <AppText variant="label">{line.text}</AppText>
        {hold.status === 'declined' && !!hold.declineReason && (
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
            {hold.declineReason}
          </AppText>
        )}
      </View>
      {canWithdraw && (
        <Pressable onPress={withdraw} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel the table request" style={({ pressed }) => ({ marginLeft: space.sm, opacity: pressed || busy ? 0.5 : 1 })}>
          <AppText variant="label" color={colors.inkSoft}>
            Cancel
          </AppText>
        </Pressable>
      )}
    </View>
  );
}
