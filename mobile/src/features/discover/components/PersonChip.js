import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Avatar } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { colors, radius, space } from '@/theme/tokens';
import { coarseDistance } from '@/utils/format';

// "Nearby people" card: shows intent + coarse area only. Never a live position.
export default function PersonChip({ person: p, onPress }) {
  const cat = categoryBySlug[p.intent];
  const statusColor = p.availability === 'now' ? colors.success : p.availability === 'later' ? colors.warning : colors.muted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, up for ${cat?.label || 'plans'}, ${p.availability === 'now' ? 'available now' : 'available later'}${p.area ? `, around ${p.area}` : ''}`}
      style={{ width: 118, backgroundColor: colors.surface, borderRadius: radius.card, padding: space.sm, alignItems: 'center', borderWidth: 1.2, borderColor: colors.border }}
    >
      <View>
        <Avatar seed={p.id} uri={p.avatarUrl} size={56} />
        <View style={{ position: 'absolute', right: 0, bottom: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: statusColor, borderWidth: 2, borderColor: colors.white }} />
      </View>
      <AppText variant="bodyStrong" style={{ marginTop: 6 }} numberOfLines={1}>
        {p.name}
      </AppText>
      <AppText variant="caption" color={colors.muted} numberOfLines={1}>
        Up for {cat?.short?.toLowerCase() || 'plans'}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: 2 }}>
        {p.distanceM != null ? `~${coarseDistance(p.distanceM)}` : p.area || 'Nearby'}
      </AppText>
    </Pressable>
  );
}
