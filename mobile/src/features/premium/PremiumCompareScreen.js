// premium_compare — the plans page / paywall. Hero, plan cards with real store
// prices (StoreKit / Play Billing via react-native-iap), what the selected plan
// adds, an optional full comparison and one sticky CTA. Plans come from
// GET /plans; feature codes become human copy in featureCatalog.js. Core
// discovery, joining, chat and safety stay free. Purchase happens on premium_checkout.
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, RefreshControl, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, Icon, Mascot, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Skeleton, Tag, usePressScale } from '@/components';
import config from '@/config';
import { colors, radius, space } from '@/theme/tokens';
import { enter, fadeIn, spring } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import haptics from '@/utils/haptics';
import { TIER_RANK, rupees, storeName, usePlans } from './plans';
import { BenefitRow, PriceText, toneColors } from './PaywallParts';

const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const forWho = (t) => (!t ? '' : /^for\b/i.test(t) ? t : `For ${t}`);

function defaultPick(paid, tier) {
  if (!paid.length) return null;
  const rank = TIER_RANK[tier] ?? 0;
  return paid.find((p) => (TIER_RANK[p.tier] ?? 0) > rank) || paid.find((p) => p.tier === tier) || paid[0];
}

// Flat brand hero: Mo, one headline, one honest line.
function Hero() {
  return (
    <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, paddingHorizontal: space.lg, paddingVertical: space.lg, alignItems: 'center', marginTop: space.xs }}>
      <Mascot size={104} pose="cheer" />
      <AppText variant="h1" align="center" style={{ marginTop: space.sm }} accessibilityRole="header">
        Plan smarter.{'\n'}Host bigger.
      </AppText>
      <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xs }}>
        Joining, chat and safety always stay free.
      </AppText>
    </View>
  );
}

// Plan option (radio card): radio, icon, name + badge, who it's for, price.
function PlanOption({ plan, price, loading, selected, current, onPress }) {
  const press = usePressScale(0.98);
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(selected ? 1 : 0, spring) }] }), [selected]);
  const t = toneColors(plan.tier === 'pro' ? 'orange' : 'periwinkle');
  const badge = current ? 'Your plan' : plan.badge;
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${plan.name}. ${forWho(plan.target)}. ${price ? `${price} per month` : 'Price shown at checkout'}.${badge ? ` ${badge}.` : ''}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 84,
          padding: space.md,
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          borderWidth: 2,
          borderColor: selected ? colors.ink : colors.border,
        }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selected ? colors.ink : colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ink }, dot]} />
        </View>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', marginLeft: space.sm }}>
          <Pictogram name={plan.pictogram} size={24} color={colors.ink} duotoneColor={t.duo} duotoneOpacity={0.6} />
        </View>
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs }}>
            <AppText variant="h2" numberOfLines={1}>
              {plan.name}
            </AppText>
            {!!badge && <Tag label={badge} bg={current ? colors.mint : colors.periwinkleWash} fg={colors.ink} style={{ alignSelf: 'center' }} />}
          </View>
          {!!plan.target && (
            <AppText variant="caption" color={colors.muted} numberOfLines={2} style={{ marginTop: 2 }}>
              {forWho(plan.target)}
            </AppText>
          )}
        </View>
        <PriceText price={price} loading={loading} />
      </Pressable>
    </Animated.View>
  );
}

// Full feature × plan table, behind a "Compare all plans" row.
function Mark({ on, highlight, label }) {
  return (
    <View style={{ width: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: highlight ? colors.periwinkleWash : 'transparent' }} accessibilityLabel={`${label}: ${on ? 'included' : 'not included'}`}>
      {on ? <Icon name="check" size={16} color={colors.success} /> : <Icon name="minus" size={14} color={colors.muted} />}
    </View>
  );
}

function CompareTable({ consumer, rows, selectedTier }) {
  const [open, setOpen] = useState(false);
  return (
    <Card elevated={false} padding={0} style={{ borderWidth: 1.2, borderColor: colors.border, overflow: 'hidden', marginTop: space.sm }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Compare all plans"
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.md }}
      >
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          Compare all plans
        </AppText>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <Animated.View entering={fadeIn()}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surfaceSubtle, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1 }} />
            {consumer.map((p) => (
              <View key={p.tier} style={{ width: 56, paddingVertical: space.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: p.tier === selectedTier ? colors.periwinkleWash : 'transparent' }}>
                <AppText variant="label" align="center" numberOfLines={1}>
                  {p.name}
                </AppText>
              </View>
            ))}
          </View>
          {rows.map((row) => (
            <View
              key={row.key}
              accessible
              accessibilityLabel={`${row.label}: ${consumer.map((p) => `${p.name} ${row.cells[p.tier] ? 'yes' : 'no'}`).join(', ')}`}
              style={{ flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <AppText variant="caption" style={{ flex: 1, fontSize: 13, lineHeight: 18, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.xs }}>
                {row.label}
              </AppText>
              {consumer.map((p) => (
                <Mark key={p.tier} on={!!row.cells[p.tier]} highlight={p.tier === selectedTier} label={p.name} />
              ))}
            </View>
          ))}
        </Animated.View>
      )}
    </Card>
  );
}

// Small text link with a 44pt tap target.
function TextLink({ label, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
      <AppText variant="label" color={colors.deep}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function PremiumCompareScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const tier = useAppStore((s) => s.subscription.tier) || 'free';
  useLoader('subscription', (s) => s.loadSubscription());
  const plans = usePlans();
  const { consumer, paid, venue, matrix } = plans;
  const [picked, setPicked] = useState(params.tier || null);
  const loading = plans.status === 'loading' && !plans.data;

  const selected = paid.find((p) => p.tier === picked) || defaultPick(paid, tier);
  useEffect(() => {
    if (!picked && selected) setPicked(selected.tier);
  }, [picked, selected]);

  const choose = (p) => {
    if (p.tier !== picked) haptics.select();
    setPicked(p.tier);
  };

  const price = selected ? plans.storePrice(selected) : null;
  const isCurrent = selected && selected.tier === tier;
  const isLower = selected && (TIER_RANK[selected.tier] ?? 0) < (TIER_RANK[tier] ?? 0);
  const below = (p) => consumer[consumer.findIndex((c) => c.tier === p.tier) - 1] || null;
  const termsUrl = config.TERMS_URL || (Platform.OS === 'ios' ? APPLE_EULA : null);
  const privacyUrl = config.PRIVACY_URL || null;
  const store = storeName();

  const footer = selected ? (
    <View>
      {isCurrent ? (
        <Button title="Manage subscription" variant="secondary" icon="settings" onPress={() => nav.navigate('subscription_manage')} />
      ) : isLower ? (
        <Button title={`Switch plans in ${store}`} variant="secondary" icon="external-link" onPress={() => nav.navigate('subscription_manage')} accessibilityLabel={`Switch to ${selected.name} in ${store} settings`} />
      ) : (
        <Button
          title={price ? `Get ${selected.name} · ${price}/mo` : `Continue with ${selected.name}`}
          accessibilityLabel={`Continue with ${selected.name}${price ? `, ${price} per month` : ''}`}
          iconRight="arrow-right"
          onPress={() => nav.navigate('premium_checkout', { productId: selected.productId })}
        />
      )}
      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
        {isCurrent ? `Billed by ${store}` : `Renews monthly · cancel anytime in ${store}`}
      </AppText>
    </View>
  ) : loading ? (
    <Skeleton height={52} r={radius.pill} />
  ) : null;

  return (
    <Screen
      header={
        <ScreenHeader
          title="Plans"
          right={
            <Pressable onPress={() => nav.navigate('subscription_manage', { restore: true })} accessibilityRole="button" accessibilityLabel="Restore purchases" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <AppText variant="label" color={colors.deep}>
                Restore
              </AppText>
            </Pressable>
          }
        />
      }
      footer={footer}
      refreshControl={<RefreshControl refreshing={plans.refreshing} onRefresh={plans.reload} tintColor={colors.ink} />}
    >
      <Animated.View entering={enter(0)}>
        <Hero />
      </Animated.View>

      <SectionHeader title="Choose a plan" />
      <QueryState
        status={plans.status}
        error={plans.error}
        hasData={paid.length > 0}
        onRetry={plans.reload}
        skeletonRows={2}
        skeletonHeight={84}
        empty={{ title: 'Plans aren’t available right now', body: 'Everything core in Come Over is free.', pose: 'wave' }}
      >
        <View style={{ gap: space.sm }}>
          {paid.map((p, i) => (
            <Animated.View key={p.id} entering={enter(i + 1)}>
              <PlanOption plan={p} price={plans.storePrice(p)} loading={loading} selected={selected?.tier === p.tier} current={p.tier === tier} onPress={() => choose(p)} />
            </Animated.View>
          ))}
        </View>
        {plans.status === 'ready' && paid.some((p) => !plans.storePrice(p)) ? (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
            {store} shows the exact local price before you pay.
          </AppText>
        ) : null}

        {/* What the selected plan adds */}
        {selected && (
          <>
            <SectionHeader title={`With ${selected.name}`} />
            <Animated.View key={selected.tier} entering={fadeIn()}>
              <Card>
                {selected.includes && below(selected) ? (
                  <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.xs }}>
                    Everything in {below(selected).name}, plus:
                  </AppText>
                ) : null}
                {selected.newItems.map((f, i) => (
                  <BenefitRow key={f.key} item={f} style={{ paddingVertical: space.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }} />
                ))}
              </Card>
            </Animated.View>
            {matrix.length > 0 && consumer.length > 1 ? <CompareTable consumer={consumer} rows={matrix} selectedTier={selected.tier} /> : null}
          </>
        )}
      </QueryState>

      {venue && (
        <Button
          title="Run a venue or club?"
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          full={false}
          align="center"
          style={{ marginTop: space.lg }}
          accessibilityLabel={`${venue.name} plan${venue.priceMonthly ? ` from ${rupees(venue.priceMonthly)} per month` : ''}. Set up a venue profile.`}
          onPress={() => nav.navigate('business_onboarding')}
        />
      )}

      {/* Subscription terms (required next to the purchase) */}
      <View style={{ marginTop: venue ? space.sm : space.xl }}>
        <AppText variant="caption" color={colors.muted}>
          Charged to your {store} account. Renews monthly at the same price unless cancelled at least 24 hours before the period ends. Cancel anytime in {store} settings and keep access until then. Taxes may apply.
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg }}>
          {termsUrl ? <TextLink label="Terms of Use" onPress={() => Linking.openURL(termsUrl).catch(() => {})} /> : null}
          {privacyUrl ? <TextLink label="Privacy Policy" onPress={() => Linking.openURL(privacyUrl).catch(() => {})} /> : null}
        </View>
      </View>
    </Screen>
  );
}
