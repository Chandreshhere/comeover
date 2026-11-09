// "Perks near you" on Discover home: one compact horizontal rail of partner
// venues that run a perk (GET /venues?hasOffer=true). It renders nothing while
// loading, when there are none, or on any error, so Home stays calm.
import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, IconBubble, Tag } from '@/components';
import { colors, layout, space } from '@/theme/tokens';
import { coarseDistance } from '@/utils/format';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import HomeSectionHeader from '@/features/discover/components/HomeSectionHeader';
import { fetchPerkVenues, nearParams } from '../businessShared';
import { venueTone } from './VenueCard';

const CARD_W = 176;

export default function PerksRail({ refreshKey }) {
  const nav = useNavigation();
  const coords = useAppStore((s) => s.prefs.coords);
  const area = useAppStore((s) => s.profile.area);
  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const q = useRemote(() => fetchPerkVenues(nearParams(lat != null ? { latitude: lat, longitude: lng } : null, area), 6), [lat, lng, area]);

  // Pull-to-refresh on Home bumps refreshKey.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const venues = q.data || [];
  if (q.status === 'error' || !venues.length) return null;

  return (
    <View>
      <HomeSectionHeader title="Perks near you" action="See all" onAction={() => nav.navigate('my_perks')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -layout.screenPadding }}
        contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.sm }}
      >
        {venues.map((v) => {
          const meta = [v.area, v.distanceM != null ? `~${coarseDistance(v.distanceM)}` : null].filter(Boolean).join(' · ') || v.kind;
          return (
            <Card
              key={v.id}
              onPress={() => nav.navigate('business_profile', { id: v.id })}
              elevated={false}
              padding={space.md}
              style={{ width: CARD_W, borderWidth: 1.2, borderColor: colors.border }}
              accessibilityLabel={`${v.name}, ${meta}. Perk: ${v.bestOfferLabel}`}
            >
              <IconBubble size={40} tone={venueTone(v)} pictogram={v.pictogram} iconSize={22} />
              <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: space.sm }}>
                {v.name}
              </AppText>
              <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
                {meta}
              </AppText>
              <Tag label={v.bestOfferLabel} icon="ticket" bg={colors.orangeSoft} fg={colors.ink} style={{ marginTop: space.sm }} />
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
