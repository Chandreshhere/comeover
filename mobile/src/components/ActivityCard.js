import React from 'react';
import { View } from 'react-native';
import { accents, colors, radius, space } from '@/theme/tokens';
import { Pictogram } from '@/illustrations/Pictograms';
import Avatar, { AvatarStack } from '@/illustrations/Avatar';
import { coarseDistance, durationLabel, whenLabel } from '@/utils/format';
import AppText from './AppText';
import Card from './Card';
import Icon from './Icon';
import JoinButton from './JoinButton';
import { ProgressRing } from './Progress';
import { Tag } from './Chip';

// `tile`: pastel square card (reference middle screen, Logic/Focus cards).
// `row`:  white list card with metadata + quick join.
export default function ActivityCard({ activity, variant = 'tile', index = 0, joinState = 'idle', onPress, onJoin, width = 172, style }) {
  if (!activity) return null;
  const a = activity;
  const accent = accents[(a.accentIndex ?? index) % accents.length];
  const joined = a.joinedCount ?? a.participants?.length ?? 0;
  const label = `${a.title}. ${whenLabel(a.startsAt)}. ${coarseDistance(a.distanceM)} away. ${joined} of ${a.capacity} joined. Hosted by ${a.host?.name}.`;

  if (variant === 'tile') {
    return (
      <Card onPress={onPress} bg={accent.bg} elevated={false} padding={14} style={[{ width, minHeight: 196 }, style]} accessibilityLabel={label}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={a.pictogram} size={26} color={colors.white} />
          </View>
          <ProgressRing value={joined / a.capacity} size={40} label={`${joined}/${a.capacity}`} />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
          <Avatar seed={a.host?.id} size={20} />
          <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 6 }} numberOfLines={1}>
            by {a.host?.name}
          </AppText>
        </View>
        <AppText variant="h3" style={{ marginTop: 6 }} numberOfLines={2}>
          {a.title}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Icon name="clock" size={12} color={colors.inkSoft} />
          <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }} numberOfLines={1}>
            {whenLabel(a.startsAt)} · {coarseDistance(a.distanceM)}
          </AppText>
        </View>
      </Card>
    );
  }

  return (
    <Card onPress={onPress} style={style} accessibilityLabel={label}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={a.pictogram} size={28} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {a.title}
            </AppText>
            {a.sponsored && <Tag label="Sponsored" bg={colors.orangeSoft} />}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
            {whenLabel(a.startsAt)} · {durationLabel(a.durationMin)} · {coarseDistance(a.distanceM)} · {a.area}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <Icon name="star" size={11} color={colors.warning} />
            <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 3 }}>
              {[a.host?.name || 'Host', a.host?.reliability != null ? `${Math.round(a.host.reliability * 100)}% show-up` : 'New host'].join(' · ')}
            </AppText>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AvatarStack seeds={(a.participants || []).slice(0, 3)} size={24} />
          <AppText variant="caption" color={colors.muted} style={{ marginLeft: 8 }}>
            {joined}/{a.capacity} going
          </AppText>
        </View>
        {onJoin && <JoinButton state={joined >= a.capacity && joinState === 'idle' ? 'full' : joinState} onPress={onJoin} />}
      </View>
    </Card>
  );
}

// Skeleton placeholder with the same footprint as a `row` card.
export function ActivityCardSkeleton() {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, flexDirection: 'row' }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.track }} />
      <View style={{ flex: 1, marginLeft: space.sm, justifyContent: 'center' }}>
        <View style={{ height: 12, width: '70%', borderRadius: 6, backgroundColor: colors.track }} />
        <View style={{ height: 10, width: '45%', borderRadius: 6, backgroundColor: colors.track, marginTop: 8 }} />
      </View>
    </View>
  );
}
