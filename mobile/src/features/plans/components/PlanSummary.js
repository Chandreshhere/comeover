import React from 'react';
import { View } from 'react-native';
import { AppText, Card } from '@/components';
import { IconBubble } from '@/components/Card';
import { accents, colors, space } from '@/theme/tokens';
import { coarseDistance, durationLabel, whenLabel } from '@/utils/format';

// Compact plan header reused by join / check-in / completion screens:
// what, when, where (area only unless the venue may be revealed).
export default function PlanSummary({ activity: a, revealVenue = false, style }) {
  if (!a) return null;
  const accent = accents[(a.accentIndex ?? 0) % accents.length];
  const where = revealVenue && a.venueName ? a.venueName : [a.area, a.distanceM != null ? coarseDistance(a.distanceM) : null].filter(Boolean).join(' · ') || 'Exact spot shared after you’re accepted';
  return (
    <Card style={[{ flexDirection: 'row', alignItems: 'center' }, style]} accessibilityLabel={`${a.title}, ${whenLabel(a.startsAt)}, ${where}`}>
      <IconBubble size={48} shape="squircle" bg={accent.bg} duo={colors.surface} pictogram={a.pictogram} iconSize={26} />
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {a.title}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
          {whenLabel(a.startsAt)} · {durationLabel(a.durationMin)}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }} numberOfLines={1}>
          {where}
        </AppText>
      </View>
    </Card>
  );
}
