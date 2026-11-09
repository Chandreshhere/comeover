// Someone nearby who flagged themselves free: intent + coarse distance band
// only (never a location). Used in the "Free nearby" list and as the callout
// under the radar when a person blip is tapped. Everything below the avatar
// row lines up on the text column's left edge.
import React from 'react';
import { View } from 'react-native';
import { AppText, Avatar, Button, Card, IconButton, Pictogram, Skeleton, Tag } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { colors, radius, space } from '@/theme/tokens';
import { coarseDistance } from '@/utils/format';
import { matchLabel } from '@/utils/socialMatch';
import { bandFor } from './Radar';

const AVATAR = 48;
const DOT = 14;
const INDENT = AVATAR + space.sm;

export default function PersonCard({
  person: p,
  myStyle,
  matching = 0,
  onSeePlans,
  onStart,
  onClose,
  bg,
  elevated = true,
}) {
  const cat = categoryBySlug[p.intent];
  const now = p.availability === 'now';
  const where = p.distanceM != null ? bandFor(p.distanceM).label : p.area;
  const match = matchLabel(myStyle, p.socialStyle);
  const reliability = p.reliability != null ? Math.round(p.reliability * 100) : null;
  const upFor = cat ? `Up for ${cat.short.toLowerCase()}` : 'Open to anything';
  const a11y = `${p.name || 'Someone'} is up for ${cat?.label || 'something'}, ${now ? 'now' : 'later today'}${
    p.distanceM != null ? `, about ${coarseDistance(p.distanceM)} away` : ''
  }${match ? `. ${match}` : ''}${reliability != null ? `. ${reliability}% show-up rate` : ''}`;

  return (
    <Card padding={space.md} bg={bg || colors.surface} elevated={elevated}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={a11y}>
          <View>
            <Avatar seed={p.id} uri={p.avatarUrl} size={AVATAR} />
            <View
              style={{
                position: 'absolute',
                right: -1,
                bottom: -1,
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                backgroundColor: now ? colors.success : colors.warning,
                borderWidth: 2.5,
                borderColor: bg || colors.surface,
              }}
            />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {p.name || 'Someone'}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Pictogram name={cat?.pictogram || 'sparkle'} size={14} color={colors.inkSoft} />
              <AppText
                variant="caption"
                color={colors.inkSoft}
                numberOfLines={1}
                style={{ flex: 1, marginLeft: space.xxs }}
              >
                {[upFor, now ? 'now' : 'later today', where].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
        </View>
        {onClose && (
          <IconButton
            icon="x"
            size={32}
            variant="plain"
            accessibilityLabel={`Close ${p.name || 'person'}`}
            onPress={onClose}
            style={{ marginLeft: space.xs }}
          />
        )}
      </View>

      <View style={{ marginLeft: INDENT }}>
        {(!!match || reliability != null) && (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {!!match && (
              <Tag
                label={match}
                icon={match === 'Great match' ? 'sparkle' : 'handshake'}
                bg={match === 'Great match' ? colors.pinkSoft : colors.mint}
                fg={colors.ink}
                style={{ flexShrink: 1 }}
              />
            )}
            {reliability != null && (
              <AppText
                variant="caption"
                color={colors.muted}
                numberOfLines={1}
                style={{ marginLeft: match ? space.xs : 0, flexShrink: 0 }}
              >
                {reliability}% show-up
              </AppText>
            )}
          </View>
        )}

        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: space.sm }}
        >
          <Button
            title={cat ? `Start ${cat.short.toLowerCase()}` : 'Start a plan'}
            size="xs"
            variant="secondary"
            full={false}
            icon="plus"
            onPress={onStart}
          />
          {matching > 0 && (
            <Button
              title={`${matching} matching plan${matching > 1 ? 's' : ''}`}
              size="xs"
              variant="ghost"
              full={false}
              iconRight="chevron-right"
              onPress={onSeePlans}
            />
          )}
        </View>
      </View>
    </Card>
  );
}

// Loading placeholder with the same footprint as a PersonCard.
export function PersonCardSkeleton() {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Skeleton width={AVATAR} height={AVATAR} r={AVATAR / 2} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <Skeleton width="45%" height={12} r={6} />
          <Skeleton width="70%" height={10} r={5} style={{ marginTop: space.xs }} />
        </View>
      </View>
      <Skeleton width={120} height={32} r={16} style={{ marginTop: space.sm, marginLeft: INDENT }} />
    </View>
  );
}
