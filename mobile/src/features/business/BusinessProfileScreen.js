// business_profile — venue profile (GET /venues/{id}): member offers, public location, plans, booking.
import React, { useMemo, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Card, EmptyState, ErrorState, Icon, IconButton, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { accents, colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { fetchVenue, plansForVenue } from './businessShared';
import { SponsoredLabel, VerifiedBadge } from './components/VenueCard';
import SponsoredSheet from './components/SponsoredSheet';

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
    return (
      <Screen header={<ScreenHeader title="Venue" />}>
        {notFound || !params.id ? (
          <ErrorState kind="api" title="Venue not found" body="It may have been removed or is no longer a partner." onRetry={() => nav.navigate('business_discovery')} retryLabel="See partner places" />
        ) : (
          <QueryState status={venueQ.status} error={venueQ.error} hasData={false} onRetry={venueQ.reload} skeletonRows={3} skeletonHeight={140}>
            <ErrorState kind="api" title="Venue not found" body="It may have been removed or is no longer a partner." onRetry={() => nav.navigate('business_discovery')} retryLabel="See partner places" />
          </QueryState>
        )}
      </Screen>
    );
  }

  const accent = accents[(venue.accentIndex || 0) % accents.length];
  const hostHere = () => nav.navigate('create_activity_type', { category: venue.categories[0], venueName: venue.name, area: venue.area });
  const openBooking = () => (venue.bookingUrl ? Linking.openURL(venue.bookingUrl).catch(() => setLinkError(true)) : setLinkError(true));

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={venueQ.refreshing} onRefresh={venueQ.reload} tintColor={colors.ink} />}
      header={
        <ScreenHeader
          title={venue.name}
          right={<IconButton icon="flag" accessibilityLabel="Report this venue" onPress={() => nav.navigate('report_flow', { venueId: venue.id, context: 'venue' })} />}
        />
      }
      footer={
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {venue.bookingUrl ? <Button title="Book with venue" icon="external-link" variant="secondary" style={{ flex: 1 }} onPress={openBooking} /> : null}
          <Button title="Host a plan here" style={{ flex: 1 }} onPress={hostHere} />
        </View>
      }
    >
      <Animated.View entering={enter(0)}>
        <View style={{ backgroundColor: accent.bg, borderRadius: radius.hero, padding: space.lg, marginTop: space.xs, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -10, bottom: -10, opacity: 0.3, transform: [{ rotate: '-12deg' }] }}>
            <Pictogram name={venue.pictogram} size={140} strokeWidth={1.2} />
          </View>
          {venue.sponsored && <SponsoredLabel onWhy={() => setWhy(venue)} style={{ marginBottom: space.sm }} />}
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={venue.pictogram} size={32} color={colors.white} />
          </View>
          <AppText variant="h1" style={{ marginTop: space.md }} accessibilityRole="header">
            {venue.name}
          </AppText>
          <AppText variant="label" color={colors.inkSoft}>
            {[venue.kind, venue.area].filter(Boolean).join(' · ')}
          </AppText>
          <View style={{ marginTop: space.sm }}>
            <VerifiedBadge verified={venue.verified} light />
          </View>
          {!!venue.about && (
            <AppText color={colors.inkSoft} style={{ marginTop: space.sm, maxWidth: '85%' }}>
              {venue.about}
            </AppText>
          )}
        </View>
      </Animated.View>

      {/* Offer */}
      {!!venue.offer && (
        <Animated.View entering={enter(1)}>
          <Card bg={colors.ink} style={{ marginTop: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="gift" size={18} />
              </View>
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="caption" color="rgba(255,255,255,0.7)">
                  For IRL plan members
                </AppText>
                <AppText variant="bodyStrong" color={colors.white}>
                  {venue.offer}
                </AppText>
              </View>
            </View>
            {!!venue.offerTerms && (
              <AppText variant="caption" color="rgba(255,255,255,0.7)" style={{ marginTop: space.sm }}>
                {venue.offerTerms}
              </AppText>
            )}
          </Card>
        </Animated.View>
      )}

      {/* Info */}
      <SectionHeader title="Visit" />
      <ListGroup>
        <ListRow icon="map-pin" title="Public location" subtitle={venue.publicLocation || venue.area || 'Shared by the venue'} last={!venue.hours && !venue.bookingUrl} />
        {!!venue.hours && <ListRow icon="clock" title="Hours" subtitle={venue.hours} last={!venue.bookingUrl} />}
        {!!venue.bookingUrl && <ListRow icon="external-link" title="Booking & menu" subtitle="Opens the venue's own page" onPress={openBooking} last />}
      </ListGroup>
      {linkError && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          Couldn't open the booking link. Try again later.
        </AppText>
      )}

      {/* Plans */}
      <SectionHeader title={`Plans here · ${plans.length}`} />
      {plans.length ? (
        <View style={{ gap: space.sm }}>
          {plans.map((a, i) => (
            <ActivityCard key={a.id} activity={a} index={i} variant="row" onPress={() => nav.navigate('activity_detail', { id: a.id })} style={{ borderWidth: 1.2, borderColor: colors.border }} />
          ))}
        </View>
      ) : (
        <EmptyState compact title="No plans here yet" body={venue.offer ? "Start one — the venue's offer applies to your group." : 'Start one and invite people nearby.'} cta="Host a plan here" onCta={hostHere} />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.xl }}>
        <Icon name="info" size={14} color={colors.muted} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6, flex: 1 }}>
          Bookings and payments happen directly with the venue. Project IRL doesn't take payments for venues or guarantee availability.
        </AppText>
      </View>

      <SponsoredSheet venue={why} area={area} onClose={() => setWhy(null)} />
    </Screen>
  );
}
