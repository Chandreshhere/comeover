// my_perks: "Your perks". GET /me/perks: your level, show-up rate, what the
// next level unlocks, then perks Unlocked and Locked. Rows open the venue.
// Perks unlock as you level up; XP is never spent. If the API isn't there yet
// (404) or nothing runs nearby, Mo explains that perks are on the way.
import React from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, EmptyState, ErrorState, HeroCard, Icon, IconBubble, Screen, ScreenHeader, SectionHeader, Skeleton, Tag } from '@/components';
import { colors, inkAlpha, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { coarseDistance } from '@/utils/format';
import { levelFor, useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { fetchMyPerks } from './businessShared';
import { isLocked, isMissing, isOffline, lockReason, XP_NOTE } from './perks';
import { venueTone } from './components/VenueCard';

function PerkRow({ item, onPress }) {
  const { offer: o, venue: v } = item;
  const locked = isLocked(o);
  const reason = lockReason(o);
  const ready = !!o.eligibility?.activeRedemptionId;
  const where = [v.name, v.area, v.distanceM != null ? `~${coarseDistance(v.distanceM)}` : null].filter(Boolean).join(' · ');
  const status = reason || (o.window && o.window !== 'Any time' ? o.window : 'Ready to use');
  return (
    <Card
      onPress={onPress}
      elevated={false}
      padding={space.sm}
      style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: colors.border }}
      accessibilityLabel={`${o.label} at ${where}. ${status}${ready ? '. Code ready' : ''}`}
    >
      <IconBubble size={44} tone={locked ? 'subtle' : venueTone(v)} pictogram={v.pictogram} iconSize={24} />
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={1} color={locked ? colors.inkSoft : colors.ink}>
          {o.label}
        </AppText>
        <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
          {where}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xxs }}>
          <Icon name={locked ? 'lock' : reason ? 'clock' : 'unlock'} size={12} color={locked || reason ? colors.inkSoft : colors.success} />
          <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginLeft: space.xxs, flex: 1 }}>
            {status}
          </AppText>
        </View>
      </View>
      {ready ? <Tag label="Code ready" icon="qr-code" bg={colors.mint} fg={colors.ink} /> : <Icon name="chevron-right" size={18} color={colors.muted} />}
    </Card>
  );
}

function Summary({ data, fallbackLevel }) {
  const lvl = data.level?.level ? data.level : fallbackLevel;
  const rate = data.showUpRate;
  const next = data.nextUnlock;
  const nextCount = next ? (Array.isArray(next.offers) ? next.offers.length : Number(next.offers) || 0) : 0;
  let nextTitle;
  let nextSub = null;
  if (next && nextCount > 0) {
    nextTitle = `Level ${next.level} unlocks ${nextCount} more perk${nextCount === 1 ? '' : 's'}`;
    nextSub = next.xpNeeded > 0 ? `${next.xpNeeded} XP to ${next.name || `Level ${next.level}`}` : null;
  } else if (data.locked.length) {
    nextTitle = 'Keep showing up to unlock the rest';
  } else {
    nextTitle = 'Every perk near you is unlocked';
  }
  return (
    <HeroCard>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, marginRight: space.sm }}>
          <AppText variant="caption" color={colors.inkSoft}>
            Level {lvl.level}
          </AppText>
          <AppText variant="h2" numberOfLines={1}>
            {lvl.name || 'Member'}
          </AppText>
        </View>
        {rate != null && (
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`${Math.round(rate * 100)} percent show-up rate`}>
            <AppText variant="h2">{Math.round(rate * 100)}%</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              show-up
            </AppText>
          </View>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: inkAlpha(0.1), marginVertical: space.sm }} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconBubble size={36} tone="surface" icon="unlock" iconSize={18} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">{nextTitle}</AppText>
          {!!nextSub && (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
              {nextSub}
            </AppText>
          )}
        </View>
      </View>
      <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
        {XP_NOTE}
      </AppText>
    </HeroCard>
  );
}

export default function MyPerksScreen() {
  const nav = useNavigation();
  const coords = useAppStore((s) => s.prefs.coords);
  const xp = useAppStore((s) => s.progress.xp);
  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const q = useRemote(() => fetchMyPerks(lat != null ? { latitude: lat, longitude: lng } : null), [lat, lng]);
  const data = q.data;
  const openVenue = (item) => nav.navigate('business_profile', { id: item.venue.id });

  const coming = (
    <EmptyState
      title="Perks are on the way"
      body="Partner places near you will add perks soon. They unlock as you level up, and your XP is never spent."
      cta="See partner places"
      onCta={() => nav.navigate('business_discovery')}
    />
  );

  let body;
  if (!data && (q.status === 'loading' || q.status === 'idle')) {
    body = (
      <View style={{ gap: space.sm, marginTop: space.xs }} accessibilityLabel="Loading">
        <Skeleton height={150} r={radius.hero} />
        <Skeleton height={76} r={radius.card} />
        <Skeleton height={76} r={radius.card} />
      </View>
    );
  } else if (!data && q.status === 'error') {
    if (isOffline(q.errorObj)) body = <ErrorState kind="offline" onRetry={q.reload} />;
    else if (isMissing(q.errorObj)) body = coming;
    else body = <ErrorState kind="api" onRetry={q.reload} />;
  } else if (data && !data.unlocked.length && !data.locked.length) {
    body = coming;
  } else if (data) {
    body = (
      <>
        <Animated.View entering={enter(0)} style={{ marginTop: space.xs }}>
          <Summary data={data} fallbackLevel={levelFor(xp || 0)} />
        </Animated.View>

        <SectionHeader title={data.unlocked.length ? `Unlocked · ${data.unlocked.length}` : 'Unlocked'} />
        {data.unlocked.length ? (
          <View style={{ gap: space.xs }}>
            {data.unlocked.map((item, i) => (
              <Animated.View key={item.offer.id} entering={enter(i + 1)}>
                <PerkRow item={item} onPress={() => openVenue(item)} />
              </Animated.View>
            ))}
          </View>
        ) : (
          <Card elevated={false} bg={colors.surfaceSubtle}>
            <AppText color={colors.inkSoft}>Nothing unlocked yet. Join a plan or two and your first perks open up.</AppText>
          </Card>
        )}

        {data.locked.length > 0 && (
          <>
            <SectionHeader title={`Locked · ${data.locked.length}`} />
            <View style={{ gap: space.xs }}>
              {data.locked.map((item) => (
                <PerkRow key={item.offer.id} item={item} onPress={() => openVenue(item)} />
              ))}
            </View>
          </>
        )}
      </>
    );
  }

  return (
    <Screen header={<ScreenHeader title="Your perks" />} refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.reload} tintColor={colors.ink} />}>
      {body}
    </Screen>
  );
}
