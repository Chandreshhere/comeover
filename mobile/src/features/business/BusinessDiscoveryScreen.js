// business_discovery — partner places (GET /venues) and clearly labelled sponsored plans.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Card, Chip, ChipRow, HeroCard, Icon, MascotArt, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, layout, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { fetchVenues, plansForVenue } from './businessShared';
import VenueCard, { SponsoredLabel } from './components/VenueCard';
import SponsoredSheet from './components/SponsoredSheet';

export default function BusinessDiscoveryScreen() {
  const nav = useNavigation();
  const activities = useAppStore((s) => s.activities);
  const blocked = useAppStore((s) => s.blocked);
  const area = useAppStore((s) => s.profile.area);
  const [category, setCategory] = useState(null);
  const [why, setWhy] = useState(null);

  const venuesQ = useRemote(() => fetchVenues(category), [category]);
  const venues = venuesQ.data || [];

  const visibleActivities = useMemo(() => activities.filter((a) => !blocked.includes(a.host?.id)), [activities, blocked]);
  const sponsoredPlans = useMemo(() => {
    const out = [];
    const seen = new Set();
    venues.forEach((v) =>
      plansForVenue(v, visibleActivities)
        .filter((a) => a.sponsored && !blocked.includes(a.host?.id))
        .forEach((a) => {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            out.push({ a, venue: v });
          }
        })
    );
    return out;
  }, [venues, visibleActivities, blocked]);

  return (
    <Screen
      header={<ScreenHeader title="Partner places" right={<Icon name="briefcase" size={20} />} />}
      refreshControl={<RefreshControl refreshing={venuesQ.refreshing} onRefresh={venuesQ.reload} tintColor={colors.ink} />}
    >
      <Animated.View entering={enter(0)}>
        <HeroCard style={{ marginTop: space.xs, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <AppText variant="h2">Places that love plans</AppText>
            <AppText color={colors.inkSoft} style={{ marginTop: 4 }}>
              Verified cafés, courts and clubs with perks for IRL groups. Paid placements are always labelled.
            </AppText>
          </View>
          <MascotArt size={96} pose="wave" showMotionLines={false} />
        </HeroCard>
      </Animated.View>

      <View style={{ marginHorizontal: -layout.screenPadding, marginTop: space.md }}>
        <ChipRow>
          <Chip label="All" icon="grid" selected={!category} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={category === c.slug} onPress={() => setCategory(c.slug)} />
          ))}
        </ChipRow>
      </View>

      {sponsoredPlans.length > 0 && (
        <>
          <SectionHeader title="Sponsored plans" />
          <View style={{ gap: space.sm }}>
            {sponsoredPlans.map(({ a, venue }, i) => (
              <Animated.View key={a.id} entering={enter(i + 1)}>
                <SponsoredLabel onWhy={() => setWhy(venue)} style={{ marginBottom: 6 }} />
                <ActivityCard activity={a} variant="row" index={i} onPress={() => nav.navigate('activity_detail', { id: a.id })} style={{ borderWidth: 1.2, borderColor: colors.border }} />
              </Animated.View>
            ))}
          </View>
        </>
      )}

      <SectionHeader title={venuesQ.status === 'ready' ? `Partner places · ${venues.length}` : 'Partner places'} />
      <QueryState
        status={venuesQ.status}
        error={venuesQ.error}
        hasData={venues.length > 0}
        onRetry={venuesQ.reload}
        skeletonRows={3}
        skeletonHeight={130}
        empty={{ title: 'No partners here yet', body: category ? 'Try another category, or suggest a great spot to its owner.' : 'Know a great spot? Suggest it to the venue owner.' }}
      >
        <View style={{ gap: space.sm }}>
          {venues.map((v, i) => (
            <Animated.View key={v.id} entering={enter(i + 2)}>
              <VenueCard venue={v} planCount={v.planCount ?? plansForVenue(v, visibleActivities).length} onPress={() => nav.navigate('business_profile', { id: v.id })} onWhy={() => setWhy(v)} />
            </Animated.View>
          ))}
        </View>
      </QueryState>

      {/* For venue owners */}
      <Card onPress={() => nav.navigate('business_onboarding')} bg={colors.ink} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="List your venue or club">
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name="pin" size={24} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong" color={colors.white}>
            Own a venue or run a club?
          </AppText>
          <AppText variant="caption" color="rgba(255,255,255,0.7)">
            Get verified and reach people planning nearby
          </AppText>
        </View>
        <Icon name="arrow-right" color={colors.white} />
      </Card>
      <AppText variant="label" color={colors.deep} align="center" style={{ marginTop: space.md }} onPress={() => nav.navigate('business_analytics')} accessibilityRole="button" suppressHighlighting>
        Already a partner? Open business dashboard
      </AppText>

      <SponsoredSheet
        venue={why}
        area={area}
        onClose={() => setWhy(null)}
        onReport={() => {
          const v = why;
          setWhy(null);
          nav.navigate('report_flow', { venueId: v.id, context: 'sponsored' });
        }}
      />
    </Screen>
  );
}
