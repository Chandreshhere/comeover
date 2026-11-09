// business_profile — venue profile (GET /venues/{id}): partner perks, public location, plans, booking.
import React, { useMemo, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Card, ErrorState, Icon, IconBubble, IconButton, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { fetchVenue, plansForVenue } from './businessShared';
import { SponsoredLabel, VerifiedBadge, venueTone } from './components/VenueCard';
import SponsoredSheet from './components/SponsoredSheet';
import OfferCard from './components/OfferCard';

export default function BusinessProfileScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const activities = useAppStore((s) => s.activities);
  const blocked = useAppStore((s) => s.blocked);
  const area = useAppStore((s) => s.profile.area);
  const venueQ = useRemote(() => fetchVenue(params.id), [params.id], { enabled: !!params.id });
  const venue = venueQ.data;
  const [why, setWhy] = useState(null);
  const [linkError, setLinkError] = useState(false);

  const plans = useMemo(() => plansForVenue(venue, activities).filter((a) => !blocked.includes(a.host?.id)), [venue, activities, blocked]);

  if (!venue) {
    const notFound = venueQ.status === 'error' && (venueQ.errorObj?.status === 404 || !params.id);
    const missing = <ErrorState kind="api" title="Venue not found" body="It may have been removed or is no longer a partner." onRetry={() => nav.navigate('business_discovery')} retryLabel="See partner places" />;
    return (
      <Screen header={<ScreenHeader title="Venue" />}>
        {notFound || !params.id ? (
          missing
        ) : (
          <QueryState status={venueQ.status} error={venueQ.error} hasData={false} onRetry={venueQ.reload} skeletonRows={3} skeletonHeight={120} style={{ marginTop: space.xs }}>
            {missing}
          </QueryState>
        )}
      </Screen>
    );
  }

  // Preselects this partner venue in the create flow (venueId is checked server-side).
  const hostHere = () => nav.navigate('create_activity_type', { category: venue.categories[0], venueName: venue.name, area: venue.area, venueId: venue.id });
  const openOffer = (o) => nav.navigate('offer_redeem', { offerId: o.id, venueId: venue.id });
  const showCode = (redemptionId) => nav.navigate('offer_redeem', { redemptionId });
  const openBooking = () => (venue.bookingUrl ? Linking.openURL(venue.bookingUrl).catch(() => setLinkError(true)) : setLinkError(true));
  const visitRows = [
    { key: 'loc', icon: 'map-pin', title: 'Public location', subtitle: venue.publicLocation || venue.area || 'Shared by the venue' },
    venue.hours ? { key: 'hours', icon: 'clock', title: 'Hours', subtitle: venue.hours } : null,
    venue.bookingUrl ? { key: 'book', icon: 'external-link', title: 'Booking & menu', subtitle: 'Opens the venue’s own page', onPress: openBooking } : null,
  ].filter(Boolean);

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={venueQ.refreshing} onRefresh={venueQ.reload} tintColor={colors.ink} />}
      header={
        <ScreenHeader
          title="Venue"
          right={<IconButton icon="flag" accessibilityLabel="Report this venue" onPress={() => nav.navigate('report_flow', { venueId: venue.id, context: 'venue' })} />}
        />
      }
      footer={<Button title="Host a plan here" icon="plus" onPress={hostHere} />}
    >
      {/* Identity */}
      <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
        {venue.sponsored && <SponsoredLabel onWhy={() => setWhy(venue)} style={{ marginBottom: space.sm }} />}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconBubble size={56} tone={venueTone(venue)} pictogram={venue.pictogram} iconSize={30} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h1" numberOfLines={2} accessibilityRole="header">
              {venue.name}
            </AppText>
            <AppText variant="label" color={colors.muted} numberOfLines={1}>
              {[venue.kind, venue.area].filter(Boolean).join(' · ')}
            </AppText>
          </View>
        </View>
        <View style={{ marginTop: space.sm }}>
          <VerifiedBadge verified={venue.verified} />
        </View>
        {!!venue.about && (
          <AppText color={colors.inkSoft} style={{ marginTop: space.sm }}>
            {venue.about}
          </AppText>
        )}
      </Animated.View>

      {/* Member offer */}
      {!!venue.offer && (
        <Animated.View entering={enter(1)}>
          <Card bg={colors.orangeSoft} elevated={false} style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}>
            <IconBubble size={44} tone="surface" icon="gift" iconSize={22} duo={colors.orange} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="caption" color={colors.inkSoft}>
                Offer for Come Over plans
              </AppText>
              <AppText variant="bodyStrong">{venue.offer}</AppText>
              {!!venue.offerTerms && (
                <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
                  {venue.offerTerms}
                </AppText>
              )}
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Partner perks: unlocked by level, funded by the venue */}
      {venue.perks.length > 0 && (
        <Animated.View entering={enter(1)}>
          <SectionHeader title="Offers" />
          <View style={{ gap: space.sm }}>
            {venue.perks.map((o) => (
              <OfferCard key={o.id} offer={o} onUse={openOffer} onShowCode={showCode} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
            <Icon name="sparkle" size={14} color={colors.muted} />
            <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs, flex: 1 }}>
              The venue funds these perks. Your XP is never spent.
            </AppText>
          </View>
        </Animated.View>
      )}

      {/* Visit */}
      <SectionHeader title="Visit" />
      <ListGroup>
        {visitRows.map(({ key, ...row }, i) => (
          <ListRow key={key} {...row} last={i === visitRows.length - 1} />
        ))}
      </ListGroup>
      {linkError && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          Couldn't open the booking link. Try again later.
        </AppText>
      )}

      {/* Plans */}
      <SectionHeader title={plans.length ? `Plans here · ${plans.length}` : 'Plans here'} />
      {plans.length ? (
        <View style={{ gap: space.sm }}>
          {plans.map((a, i) => (
            <ActivityCard key={a.id} activity={a} index={i} variant="row" onPress={() => nav.navigate('activity_detail', { id: a.id })} style={{ borderWidth: 1.2, borderColor: colors.border }} />
          ))}
        </View>
      ) : (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ alignItems: 'center' }}>
          <AppText color={colors.muted} align="center">
            No plans here yet. Be the first to host one.
          </AppText>
        </Card>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xl }}>
        <Icon name="info" size={14} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs, flex: 1 }}>
          Booking, payment and availability are handled by the venue.
        </AppText>
      </View>

      <SponsoredSheet venue={why} area={area} onClose={() => setWhy(null)} />
    </Screen>
  );
}
