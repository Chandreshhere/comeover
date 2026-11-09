import React from 'react';
import { View } from 'react-native';
import { accents, colors, layout, radius, space } from '@/theme/tokens';
import { coarseDistance, whenLabel } from '@/utils/format';
import AppText from './AppText';
import Card, { IconBubble } from './Card';
import Icon from './Icon';
import JoinButton from './JoinButton';
import { Tag } from './Chip';

// Plan card. Shows only what helps decide: title, time · distance, host, spots.
// `tile`: pastel card for horizontal rails — fixed footprint so every tile in a
//         rail lines up (title always reserves two lines).
// `row`:  white list card. Optional `badge` ({ label, bg, icon, glyph }) for a
//         status pill, and a footer with spots + one action: `onJoin` renders the
//         Join button, or pass your own `action` node.
const TILE_HEIGHT = 184;

export default function ActivityCard({ activity, variant = 'tile', index = 0, joinState = 'idle', onPress, onJoin, action, badge, width = 172, style }) {
  if (!activity) return null;
  const a = activity;
  const accent = accents[(a.accentIndex ?? index) % accents.length];
  const joined = a.joinedCount ?? a.participants?.length ?? 0;
  const capacity = a.capacity || 0;
  const full = capacity > 0 && joined >= capacity;
  const hostName = a.host?.id === 'me' ? 'you' : a.host?.name || 'a host';
  const when = whenLabel(a.startsAt);
  const dist = coarseDistance(a.distanceM);
  const spots = full ? 'Full' : `${joined}/${capacity} going`;
  const label = `${a.title}. ${when}. ${dist} away. ${joined} of ${capacity} joined. Hosted by ${hostName}.${a.sponsored ? ' Sponsored.' : ''}${badge?.label ? ` ${badge.label}.` : ''}`;

  if (variant === 'tile') {
    return (
      <Card onPress={onPress} bg={accent.bg} elevated={false} padding={space.md} style={[{ width, minHeight: TILE_HEIGHT }, style]} accessibilityLabel={label}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <IconBubble size={44} tone="surface" pictogram={a.pictogram} iconSize={24} duo={accent.bg} />
          <Tag label={full ? 'Full' : `${joined}/${capacity}`} icon="users" bg={colors.surface} fg={colors.ink} />
        </View>
        <View style={{ flex: 1, minHeight: space.sm }} />
        <AppText variant="h3" numberOfLines={2} style={{ minHeight: 44 }}>
          {a.title}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: space.xxs }}>
          {when} · {dist}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginTop: 2 }}>
          {a.sponsored ? 'Sponsored · ' : ''}by {hostName}
        </AppText>
      </Card>
    );
  }

  const trailing = onJoin ? <JoinButton state={full && joinState === 'idle' ? 'full' : joinState} onPress={onJoin} /> : action || null;
  return (
    <Card onPress={onPress} style={style} accessibilityLabel={label}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconBubble size={48} shape="squircle" bg={accent.bg} duo={colors.surface} pictogram={a.pictogram} iconSize={26} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {a.title}
            </AppText>
            {!!badge?.label && <Tag label={badge.label} bg={badge.bg} fg={badge.fg || colors.ink} icon={badge.icon} glyph={badge.glyph} style={{ marginLeft: space.xs, alignSelf: 'center' }} />}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
            {when} · {dist}
          </AppText>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }} numberOfLines={1}>
            {a.sponsored ? 'Sponsored · ' : ''}by {hostName}
            {trailing ? '' : ` · ${spots}`}
          </AppText>
        </View>
      </View>
      {!!trailing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: layout.minTouch, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Icon name="users" size={14} color={colors.muted} />
          <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: space.xxs, marginRight: space.xs }} numberOfLines={1}>
            {spots}
          </AppText>
          {trailing}
        </View>
      )}
    </Card>
  );
}

// Skeleton placeholder with the same footprint as a `row` card.
export function ActivityCardSkeleton() {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.track }} />
      <View style={{ flex: 1, marginLeft: space.sm, justifyContent: 'center' }}>
        <View style={{ height: 12, width: '70%', borderRadius: 6, backgroundColor: colors.track }} />
        <View style={{ height: 10, width: '45%', borderRadius: 6, backgroundColor: colors.track, marginTop: space.xs }} />
        <View style={{ height: 10, width: '35%', borderRadius: 6, backgroundColor: colors.track, marginTop: space.xxs }} />
      </View>
    </View>
  );
}
