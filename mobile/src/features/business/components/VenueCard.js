import React from 'react';
import { View } from 'react-native';
import { AppText, Card, Icon, IconBubble, Tag } from '@/components';
import { colors, glass, space } from '@/theme/tokens';

// Bubble tone per venue, rotating like the activity accents.
const TONES = ['pink', 'orange', 'periwinkle', 'lavender', 'mint'];
export const venueTone = (v) => TONES[(v?.accentIndex || 0) % TONES.length];

export function SponsoredLabel({ onWhy, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs }, style]}>
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
    <Tag label="Verified venue" icon="check-circle" bg={light ? glass(0.6) : colors.mint} fg={colors.ink} />
  ) : (
    <Tag label="Verification pending" icon="clock" bg={light ? glass(0.6) : colors.surfaceSubtle} fg={light ? colors.inkSoft : colors.muted} />
  );
}

// Partner venue row: bubble · name + meta · chevron, with the best perk as a
// chip underneath (or the legacy member offer line). Details live on the venue page.
export default function VenueCard({ venue: v, onPress, onWhy, planCount = 0 }) {
  const meta = [v.kind, v.area, planCount > 0 ? `${planCount} plan${planCount > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
  return (
    <Card
      onPress={onPress}
      elevated={false}
      style={{ borderWidth: 1.2, borderColor: colors.border }}
      accessibilityLabel={`${v.name}, ${v.kind}${v.area ? ` in ${v.area}` : ''}${v.verified ? ', verified' : ''}${v.sponsored ? ', sponsored' : ''}${planCount > 0 ? `, ${planCount} upcoming plans` : ''}${v.bestOfferLabel || v.offer ? `. Offer: ${v.bestOfferLabel || v.offer}` : ''}`}
    >
      {v.sponsored && <SponsoredLabel onWhy={onWhy} style={{ marginBottom: space.sm }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconBubble size={44} tone={venueTone(v)} pictogram={v.pictogram} iconSize={24} />
        <View style={{ flex: 1, marginLeft: space.sm, marginRight: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {v.name}
            </AppText>
            {v.verified && <Icon name="check-circle" size={14} color={colors.success} style={{ marginLeft: space.xxs }} />}
          </View>
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {meta}
          </AppText>
        </View>
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </View>
      {v.bestOfferLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Tag label={v.bestOfferLabel} icon="ticket" bg={colors.orangeSoft} fg={colors.ink} />
          {(v.perks?.length || 0) > 1 && (
            <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs }} numberOfLines={1}>
              +{v.perks.length - 1} more
            </AppText>
          )}
        </View>
      ) : !!v.offer && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Icon name="gift" size={16} weight="duotone" color={colors.ink} duotoneColor={colors.orange} />
          <AppText variant="label" color={colors.inkSoft} style={{ marginLeft: space.xs, flex: 1 }} numberOfLines={1}>
            {v.offer}
          </AppText>
        </View>
      )}
    </Card>
  );
}
