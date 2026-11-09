import React from 'react';
import { View } from 'react-native';
import { AppText, AvatarStack, HeroCard, Icon, JoinButton, Pictogram } from '@/components';
import { colors, glass, space } from '@/theme/tokens';
import { coarseDistance, whenLabel } from '@/utils/format';

function Meta({ icon, text }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Icon name={icon} size={14} color={colors.inkSoft} />
      <AppText variant="label" color={colors.inkSoft} style={{ marginLeft: 4 }} numberOfLines={1}>
        {text}
      </AppText>
    </View>
  );
}

// The one big plan on Home. Calm and scannable: what it is, when and how far,
// who's hosting and who's going, one button. Flat brand fill, no decoration
// competing with the text.
export default function FeaturedPlanCard({ activity: a, joinState = 'idle', onPress, onJoin }) {
  if (!a) return null;
  const dist = a.distanceM != null ? coarseDistance(a.distanceM) : null;
  const rel = a.host?.reliability != null ? `${Math.round(a.host.reliability * 100)}% show-up` : null;
  const spots = a.capacity ? `${a.joinedCount}/${a.capacity} going` : null;
  const eyebrow = [a.live ? 'Live now' : 'Featured near you', a.sponsored ? 'Sponsored' : null, a.venueType].filter(Boolean).join(' · ');
  return (
    <HeroCard onPress={onPress} accessibilityLabel={`Featured plan: ${a.title}, ${whenLabel(a.startsAt)}${dist ? `, ${dist} away` : ''}`}>
      {/* eyebrow: activity + context, spots on the right */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={a.pictogram} size={20} duotoneColor={colors.deep} duotoneOpacity={0.4} />
        </View>
        <AppText variant="label" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }} numberOfLines={1}>
          {eyebrow}
        </AppText>
        {spots && (
          <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: glass(0.6), flexDirection: 'row', alignItems: 'center', marginLeft: space.xs }}>
            <Icon name="users" size={13} color={colors.ink} />
            <AppText variant="label" style={{ marginLeft: 4 }}>
              {spots}
            </AppText>
          </View>
        )}
      </View>

      <AppText variant="h2" style={{ marginTop: space.md }} numberOfLines={2}>
        {a.title}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 4, marginTop: 6 }}>
        <Meta icon="clock" text={whenLabel(a.startsAt)} />
        {dist && <Meta icon="map-pin" text={dist} />}
      </View>

      {/* host + action */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.lg }}>
        <JoinButton state={joinState} onPress={onJoin} size="md" idleLabel={a.joinRule === 'approval' ? 'Request' : 'Join now'} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginLeft: space.sm }}>
          <View style={{ flexShrink: 1, alignItems: 'flex-end', marginRight: space.xs }}>
            <AppText variant="label" numberOfLines={1}>
              {a.host?.name || 'A member'}
            </AppText>
            {!!rel && (
              <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
                {rel}
              </AppText>
            )}
          </View>
          <AvatarStack seeds={a.participants || []} size={30} max={3} ringColor={colors.periwinkle} />
        </View>
      </View>
    </HeroCard>
  );
}
