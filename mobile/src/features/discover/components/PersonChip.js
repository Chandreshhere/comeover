import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText, Avatar, Icon, usePressScale } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { colors, radius, space } from '@/theme/tokens';
import { coarseDistance } from '@/utils/format';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// "Nearby people" card: shows intent + coarse area only. Never a live position.
// `match` is matchLabel(myStyle, theirStyle) — 'Great match' | 'Good match' | null.
export default function PersonChip({ person: p, match, onPress }) {
  const press = usePressScale(0.96);
  const cat = categoryBySlug[p.intent];
  const now = p.availability === 'now';
  const statusColor = now ? colors.success : p.availability === 'later' ? colors.warning : colors.muted;
  const great = match === 'Great match';
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, up for ${cat?.label || 'plans'}, ${now ? 'available now' : 'available later'}${p.area ? `, around ${p.area}` : ''}${match ? `, ${match.toLowerCase()}` : ''}`}
      style={[
        { width: 124, backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: space.sm, paddingHorizontal: space.xs, alignItems: 'center', borderWidth: 1.2, borderColor: colors.border },
        press.style,
      ]}
    >
      <View>
        <Avatar seed={p.id} uri={p.avatarUrl} size={56} />
        <View style={{ position: 'absolute', right: 0, bottom: 2, width: 15, height: 15, borderRadius: 8, backgroundColor: statusColor, borderWidth: 2.5, borderColor: colors.surface }} />
      </View>
      <AppText variant="bodyStrong" style={{ marginTop: 6, maxWidth: '100%' }} numberOfLines={1} align="center">
        {p.name}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} align="center" style={{ maxWidth: '100%' }}>
        Up for {cat?.short?.toLowerCase() || 'plans'}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, maxWidth: '100%' }}>
        <Icon name="map-pin" size={11} color={colors.muted} weight="fill" />
        <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginLeft: 2, flexShrink: 1 }}>
          {p.distanceM != null ? `~${coarseDistance(p.distanceM)}` : p.area || 'Nearby'}
        </AppText>
      </View>
      {!!match && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: space.xs,
            backgroundColor: great ? colors.mint : colors.lavender,
            borderRadius: radius.pill,
            paddingHorizontal: 8,
            paddingVertical: 3,
            maxWidth: '100%',
          }}
        >
          <Icon name="sparkle" size={11} color={colors.ink} weight="fill" />
          <AppText variant="caption" numberOfLines={1} style={{ marginLeft: 3, flexShrink: 1 }}>
            {match}
          </AppText>
        </View>
      )}
    </AnimatedPressable>
  );
}
