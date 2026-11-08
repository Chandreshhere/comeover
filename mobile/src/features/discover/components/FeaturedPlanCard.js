import React from 'react';
import { View } from 'react-native';
import { AppText, AvatarStack, HeroCard, JoinButton, Pictogram, ProgressRing, Tag } from '@/components';
import { colors, space } from '@/theme/tokens';
import { coarseDistance, whenLabel } from '@/utils/format';

// The periwinkle hero card from the reference's middle phone ("UX Lab" card),
// translated to a featured live plan near the user.
export default function FeaturedPlanCard({ activity: a, joinState = 'idle', onPress, onJoin }) {
  if (!a) return null;
  const dist = a.distanceM != null ? coarseDistance(a.distanceM) : null;
  const rel = a.host?.reliability != null ? `${Math.round(a.host.reliability * 100)}% show-up` : null;
  return (
    <HeroCard onPress={onPress} accessibilityLabel={`Featured plan: ${a.title}, ${whenLabel(a.startsAt)}${dist ? `, ${dist} away` : ''}`} style={{ minHeight: 200 }}>
      {/* decorative pictograms, bottom-right */}
      <View pointerEvents="none" style={{ position: 'absolute', right: 14, bottom: 14, opacity: 0.35, transform: [{ rotate: '-12deg' }] }}>
        <Pictogram name={a.pictogram} size={78} strokeWidth={1.4} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', right: 96, bottom: 62, opacity: 0.35 }}>
        <Pictogram name="sparkle" size={22} strokeWidth={1.6} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={a.pictogram} size={24} />
        </View>
        <ProgressRing value={a.capacity ? a.joinedCount / a.capacity : 0} size={46} label={`${a.joinedCount}/${a.capacity}`} track="rgba(9,10,14,0.18)" />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: 6 }}>
        {a.live && <Tag label="Live now" icon="radio" bg={colors.ink} fg={colors.white} />}
        {a.sponsored && <Tag label="Sponsored" bg={colors.white} />}
        {!!a.venueType && <Tag label={a.venueType} bg="rgba(255,255,255,0.55)" />}
      </View>
      <AppText variant="h2" style={{ marginTop: space.xs }} numberOfLines={2}>
        {a.title}
      </AppText>
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: 2 }}>
        {[whenLabel(a.startsAt), dist, `${a.joinedCount}/${a.capacity} joined`].filter(Boolean).join(' · ')}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
        {[`Hosted by ${a.host?.name || 'a member'}`, rel].filter(Boolean).join(' · ')}
      </AppText>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
        <JoinButton state={joinState} onPress={onJoin} size="md" idleLabel={a.joinRule === 'approval' ? 'Request' : 'Join now'} />
        <AvatarStack seeds={a.participants || []} size={30} max={3} ringColor={colors.periwinkle} />
      </View>
    </HeroCard>
  );
}
