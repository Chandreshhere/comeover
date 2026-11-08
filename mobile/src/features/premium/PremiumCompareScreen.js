// premium_compare — Free / Plus / Pro with clear features and prices.
// Plans come from GET /plans; prices are the store-localised prices from
// StoreKit / Play Billing when available. Core discovery, joining, chat and
// safety stay free.
import React from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, HeroCard, Icon, Mascot, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { NEVER_GATED, TIER_RANK, rupees, storeName, usePlans } from './plans';

const ACCENT_BG = { surface: colors.surface, periwinkle: colors.periwinkleWash, orange: colors.orangeSoft, ink: colors.ink };

function PlanCard({ plan, price, currentTier, index, onChoose, onManage }) {
  const isCurrent = currentTier === plan.tier;
  const isLower = (TIER_RANK[plan.tier] ?? 0) < (TIER_RANK[currentTier] ?? 0);
  const isFree = plan.tier === 'free' || !plan.productId;
  const dark = plan.accent === 'ink';
  const fg = dark ? colors.white : colors.ink;
  return (
    <Animated.View entering={enter(index + 1)}>
      <Card
        bg={ACCENT_BG[plan.accent] || colors.surface}
        style={{ borderWidth: isCurrent ? 2 : 1.2, borderColor: isCurrent ? colors.ink : colors.border, marginBottom: space.sm }}
        accessibilityLabel={`${plan.name} plan, ${isFree ? 'free' : `${price} per month`}${isCurrent ? ', your current plan' : ''}`}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: dark ? colors.white : colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={plan.pictogram} size={22} color={dark ? colors.ink : colors.white} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="h2" color={fg}>
                {plan.name}
              </AppText>
              {isCurrent && <Tag label="Current plan" bg={colors.ink} fg={colors.white} icon="check" />}
            </View>
            {!!plan.target && (
              <AppText variant="caption" color={dark ? 'rgba(255,255,255,0.7)' : colors.muted}>
                {plan.target}
              </AppText>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="h2" color={fg}>
              {isFree ? '₹0' : price}
            </AppText>
            <AppText variant="caption" color={dark ? 'rgba(255,255,255,0.7)' : colors.muted}>
              {isFree ? 'forever' : 'per month'}
            </AppText>
          </View>
        </View>

        {!!plan.tagline && (
          <AppText color={dark ? 'rgba(255,255,255,0.8)' : colors.inkSoft} style={{ marginTop: space.sm }}>
            {plan.tagline}
          </AppText>
        )}
        {plan.includes ? (
          <AppText variant="label" color={fg} style={{ marginTop: space.xs }}>
            Everything in {plan.includes.charAt(0).toUpperCase() + plan.includes.slice(1)}, and:
          </AppText>
        ) : null}
        <View style={{ marginTop: space.xs, gap: 6 }}>
          {plan.features.map((f) => (
            <View key={f} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Icon name="check" size={16} color={dark ? colors.periwinkle : colors.success} style={{ marginTop: 3 }} />
              <AppText color={fg} style={{ flex: 1, marginLeft: 8 }}>
                {f}
              </AppText>
            </View>
          ))}
        </View>

        {!isFree && (
          <View style={{ marginTop: space.md }}>
            {isCurrent ? (
              <Button title="Manage subscription" variant="secondary" onPress={onManage} />
            ) : isLower ? (
              <Button title={`Switch to ${plan.name}`} variant="secondary" onPress={onManage} accessibilityLabel={`Switch to ${plan.name} in store settings`} />
            ) : (
              <Button title={`Choose ${plan.name} · ${price}/mo`} onPress={() => onChoose(plan)} />
            )}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

function Mark({ on }) {
  return (
    <View style={{ width: 56, alignItems: 'center' }}>
      {on ? <Icon name="check" size={16} color={colors.ink} /> : <AppText color={colors.muted}>—</AppText>}
    </View>
  );
}

export default function PremiumCompareScreen() {
  const nav = useNavigation();
  const tier = useAppStore((s) => s.subscription.tier) || 'free';
  useLoader('subscription', (s) => s.loadSubscription());
  const plans = usePlans();
  const { consumer, venue, matrix, products } = plans;

  return (
    <Screen header={<ScreenHeader title="Plans" />} refreshControl={<RefreshControl refreshing={plans.refreshing} onRefresh={plans.reload} tintColor={colors.ink} />}>
      <Animated.View entering={enter(0)}>
        <HeroCard style={{ marginTop: space.xs, alignItems: 'center', paddingBottom: space.lg }}>
          <Mascot size={150} pose="cheer" />
          <AppText variant="h1" align="center" style={{ marginTop: space.xs }} accessibilityRole="header">
            Do more with your plans
          </AppText>
          <AppText color={colors.inkSoft} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
            Upgrade only if it helps. Finding people, joining plans and staying safe are free — forever.
          </AppText>
        </HeroCard>
      </Animated.View>

      <SectionHeader title="Choose what fits" />
      <QueryState status={plans.status} error={plans.error} hasData={consumer.length > 0} onRetry={plans.reload} skeletonRows={3} skeletonHeight={200} empty={{ title: 'Plans aren’t available right now', body: 'Everything core in Project IRL is free. Check back later for extras.' }}>
        <View>
          {consumer.map((p, i) => (
            <PlanCard
              key={p.id}
              plan={p}
              price={plans.priceLabel(p)}
              index={i}
              currentTier={tier}
              onChoose={(plan) => nav.navigate('premium_checkout', { productId: plan.productId })}
              onManage={() => nav.navigate('subscription_manage')}
            />
          ))}
          {plans.status === 'ready' && consumer.some((p) => p.productId) && !Object.keys(products).length ? (
            <AppText variant="caption" color={colors.muted} style={{ marginBottom: space.sm }}>
              Prices shown are list prices — {storeName()} shows the final local price before you confirm.
            </AppText>
          ) : null}
        </View>
      </QueryState>

      {/* Always free */}
      <Card bg={colors.mint} elevated={false} style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="unlock" size={18} />
          <AppText variant="h3" style={{ marginLeft: space.xs }}>
            Never behind a paywall
          </AppText>
        </View>
        <View style={{ marginTop: space.sm, gap: 8 }}>
          {NEVER_GATED.map((g) => (
            <View key={g.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={g.icon} size={16} color={colors.inkSoft} />
              <AppText style={{ marginLeft: 10, flex: 1 }}>{g.label}</AppText>
            </View>
          ))}
        </View>
      </Card>

      {/* Matrix (server-provided) */}
      {matrix?.length ? (
        <>
          <SectionHeader title="Side by side" />
          <Card elevated={false} padding={0} style={{ borderWidth: 1.2, borderColor: colors.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: space.md, backgroundColor: colors.surfaceSubtle }}>
              <AppText variant="label" color={colors.muted} style={{ flex: 1 }}>
                Feature
              </AppText>
              {['Free', 'Plus', 'Pro'].map((h) => (
                <AppText key={h} variant="label" align="center" style={{ width: 56 }}>
                  {h}
                </AppText>
              ))}
            </View>
            {matrix.map((row, i) => (
              <View
                key={row.label}
                accessible
                accessibilityLabel={`${row.label}: Free ${row.free ? 'yes' : 'no'}, Plus ${row.plus ? 'yes' : 'no'}, Pro ${row.pro ? 'yes' : 'no'}`}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
              >
                <AppText variant="caption" style={{ flex: 1, fontSize: 12 }}>
                  {row.label}
                </AppText>
                <Mark on={row.free} />
                <Mark on={row.plus} />
                <Mark on={row.pro} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* Venue / club */}
      {venue && (
        <Card onPress={() => nav.navigate('business_onboarding')} bg={colors.ink} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`${venue.name} plan from ${rupees(venue.priceMonthly)} per month. Set up a venue profile.`}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="pin" size={24} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong" color={colors.white}>
              Run a café, court or club?
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.7)">
              {venue.name} from {rupees(venue.priceMonthly)}/mo · verified profile & labelled sponsorships
            </AppText>
          </View>
          <Icon name="arrow-right" color={colors.white} />
        </Card>
      )}

      {/* Disclosures */}
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md, marginTop: space.xl }}>
        <AppText variant="label">How billing works</AppText>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
          Prices are monthly as shown by {storeName()}, which may add applicable taxes. Subscriptions are billed to your {storeName()} account and renew automatically each month until cancelled. Cancel anytime in your {storeName()} subscription settings at least 24 hours before renewal; you keep access until the end of the paid period.
        </AppText>
        <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.sm }}>
          <AppText variant="label" color={colors.deep} onPress={() => nav.navigate('subscription_manage')} accessibilityRole="button" suppressHighlighting>
            Restore purchases
          </AppText>
          <AppText variant="label" color={colors.deep} onPress={() => nav.navigate('subscription_manage')} accessibilityRole="button" suppressHighlighting>
            Manage subscription
          </AppText>
        </View>
      </View>
    </Screen>
  );
}
