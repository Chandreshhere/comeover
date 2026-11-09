// business_discovery — partner places (GET /venues, optional hasOffer=true) and clearly labelled sponsored plans.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Chip, ChipRow, IconButton, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
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
  const [withPerks, setWithPerks] = useState(false);
  const [why, setWhy] = useState(null);

  const venuesQ = useRemote(() => fetchVenues(category, { hasOffer: withPerks }), [category, withPerks]);
  // Filter on the client too, so an API without hasOffer support still shows only venues with perks.
  const venues = useMemo(() => (venuesQ.data || []).filter((v) => !withPerks || v.hasOffer), [venuesQ.data, withPerks]);

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
      header={
        <ScreenHeader
          title="Partner places"
          subtitle="Verified spots with group perks"
          right={<IconButton icon="bar-chart-2" accessibilityLabel="Open business dashboard" onPress={() => nav.navigate('business_analytics')} />}
        />
      }
      refreshControl={<RefreshControl refreshing={venuesQ.refreshing} onRefresh={venuesQ.reload} tintColor={colors.ink} />}
    >
      {/* Your perks: what your level has unlocked */}
      <ListGroup style={{ marginTop: space.xs }}>
        <ListRow icon="ticket" iconBg={colors.orangeSoft} title="Your perks" subtitle="Unlock as you level up. XP is never spent." onPress={() => nav.navigate('my_perks')} last />
      </ListGroup>

      <View style={{ marginHorizontal: -layout.screenPadding, marginTop: space.md }}>
        <ChipRow>
          <Chip
            label="All"
            icon="grid"
            selected={!category && !withPerks}
            onPress={() => {
              setCategory(null);
              setWithPerks(false);
            }}
          />
          <Chip label="With perks" icon="ticket" selected={withPerks} onPress={() => setWithPerks((x) => !x)} />
          {categories.map((c) => (
            <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={category === c.slug} onPress={() => setCategory(c.slug)} />
          ))}
        </ChipRow>
      </View>

      {sponsoredPlans.length > 0 && (
        <>
          <SectionHeader title="Sponsored plans" />
          <View style={{ gap: space.md }}>
            {sponsoredPlans.map(({ a, venue }, i) => (
              <Animated.View key={a.id} entering={enter(i)}>
                <SponsoredLabel onWhy={() => setWhy(venue)} style={{ marginBottom: space.xs }} />
                <ActivityCard activity={a} variant="row" index={i} onPress={() => nav.navigate('activity_detail', { id: a.id })} style={{ borderWidth: 1.2, borderColor: colors.border }} />
              </Animated.View>
            ))}
          </View>
        </>
      )}

      <SectionHeader title={venuesQ.status === 'ready' && venues.length ? `Places · ${venues.length}` : 'Places'} />
      <QueryState
        status={venuesQ.status}
        error={venuesQ.error}
        hasData={venues.length > 0}
        onRetry={venuesQ.reload}
        skeletonRows={3}
        skeletonHeight={96}
        empty={
          withPerks
            ? {
                title: 'No perks here yet',
                body: 'Partner places add perks often. Check back soon.',
                cta: 'Show all places',
                onCta: () => {
                  setWithPerks(false);
                  setCategory(null);
                },
              }
            : category
            ? { title: 'No partners here yet', body: 'Try another category.', cta: 'Show all', onCta: () => setCategory(null) }
            : { title: 'No partners here yet', body: 'Know a great spot? Tell the owner about us.' }
        }
      >
        <View style={{ gap: space.sm }}>
          {venues.map((v, i) => (
            <Animated.View key={v.id} entering={enter(i + 1)}>
              <VenueCard venue={v} planCount={v.planCount ?? plansForVenue(v, visibleActivities).length} onPress={() => nav.navigate('business_profile', { id: v.id })} onWhy={() => setWhy(v)} />
            </Animated.View>
          ))}
        </View>
      </QueryState>

      {/* For venue owners */}
      <SectionHeader title="For owners" />
      <ListGroup>
        <ListRow icon="briefcase" iconBg={colors.orangeSoft} title="List your venue or club" subtitle="Get verified and reach people nearby" onPress={() => nav.navigate('business_onboarding')} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.md }}>
        Paid placements are always labelled “Sponsored”.
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
