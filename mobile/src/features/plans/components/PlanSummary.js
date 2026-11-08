import React from 'react';
import { View } from 'react-native';
import { AppText, Card, Pictogram } from '@/components';
import { accents, colors, space } from '@/theme/tokens';
import { coarseDistance, durationLabel, whenLabel } from '@/utils/format';

// Compact plan header reused by join / check-in / completion screens.
export default function PlanSummary({ activity: a, revealVenue = false, style }) {
  if (!a) return null;
  const accent = accents[(a.accentIndex ?? 0) % accents.length];
  return (
    <Card style={[{ flexDirection: 'row', alignItems: 'center' }, style]} accessibilityLabel={`${a.title}, ${whenLabel(a.startsAt)}`}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Pictogram name={a.pictogram} size={28} />
      </View>
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {a.title}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          {whenLabel(a.startsAt)} · {durationLabel(a.durationMin)}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
          {revealVenue && a.venueName ? a.venueName : [a.area, a.distanceM != null ? coarseDistance(a.distanceM) : null].filter(Boolean).join(' · ') || 'Exact spot shared after you’re accepted'}
        </AppText>
      </View>
    </Card>
  );
}
