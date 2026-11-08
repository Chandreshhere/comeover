import React from 'react';
import { View } from 'react-native';
import { AppText, Card, Icon, Pictogram, Tag } from '@/components';
import { accents, colors, space } from '@/theme/tokens';

export function SponsoredLabel({ onWhy, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
      <Tag label="Sponsored" bg={colors.orangeSoft} fg={colors.ink} icon="info" />
      {onWhy && (
        <AppText variant="caption" color={colors.deep} onPress={onWhy} accessibilityRole="button" accessibilityLabel="Why am I seeing this sponsored item?" suppressHighlighting>
          Why am I seeing this?
        </AppText>
      )}
    </View>
  );
}

export function VerifiedBadge({ verified, light }) {
  return verified ? (
    <Tag label="Verified venue" icon="check-circle" bg={light ? 'rgba(255,255,255,0.6)' : colors.mint} />
  ) : (
    <Tag label="Verification pending" icon="clock" bg={light ? 'rgba(255,255,255,0.6)' : colors.surfaceSubtle} fg={colors.muted} />
  );
}

export default function VenueCard({ venue: v, onPress, onWhy, planCount = 0 }) {
  const accent = accents[(v.accentIndex || 0) % accents.length];
  return (
    <Card
      onPress={onPress}
      elevated={false}
      style={{ borderWidth: 1.2, borderColor: colors.border }}
      accessibilityLabel={`${v.name}, ${v.kind}${v.area ? ` in ${v.area}` : ''}${v.verified ? ', verified' : ''}${v.sponsored ? ', sponsored' : ''}${v.offer ? `. Offer: ${v.offer}` : ''}`}
    >
      {v.sponsored && <SponsoredLabel onWhy={onWhy} style={{ marginBottom: space.sm }} />}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={v.pictogram} size={30} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {v.name}
            </AppText>
            {v.verified && <Icon name="check-circle" size={14} color={colors.success} style={{ marginLeft: 6 }} />}
          </View>
          <AppText variant="caption" color={colors.muted}>
            {[v.kind, v.area].filter(Boolean).join(' · ')}
          </AppText>
          {!!v.hours && (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
              {v.hours}
            </AppText>
          )}
        </View>
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </View>
      {(v.offer || planCount > 0) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: 14, padding: 10, marginTop: space.sm }}>
          <Icon name={v.offer ? 'gift' : 'calendar'} size={15} />
          <AppText variant="label" style={{ marginLeft: 8, flex: 1 }} numberOfLines={2}>
            {v.offer || 'Plans happening here'}
          </AppText>
          {planCount > 0 && (
            <AppText variant="caption" color={colors.muted}>
              {planCount} plan{planCount > 1 ? 's' : ''}
            </AppText>
          )}
        </View>
      )}
    </Card>
  );
}
