// premium_checkout (modal) — StoreKit / Play Billing checkout via react-native-iap.
// The native store sheet takes payment; the backend verifies the receipt with
// Apple / Google and owns the entitlement. We never unlock from the client.
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, ErrorState, Icon, Mascot, Pictogram, QueryState, Screen, ScreenHeader } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter, fadeIn } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import { purchase } from '@/services/billing';
import haptics from '@/utils/haptics';
import { shortDate, storeName, usePlans } from './plans';
import { BenefitRow, PriceText, toneColors } from './PaywallParts';

// status: idle | purchasing | success | pending | pending_verification | cancelled | failed
export default function PremiumCheckoutScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const plans = usePlans();
  const plan = plans.byProductId(params.productId);
  const product = plan?.productId ? plans.products[plan.productId] : null;
  const currentTier = useAppStore((s) => s.subscription.tier);
  const subscription = useAppStore((s) => s.subscription);
  const setSubscription = useAppStore((s) => s.setSubscription);
  const loadSubscription = useAppStore((s) => s.loadSubscription);

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [celebrate, setCelebrate] = useState(null);

  if (!plan) {
    return (
      <Screen header={<ScreenHeader title="Checkout" />}>
        <QueryState status={plans.status} error={plans.error} hasData={false} onRetry={plans.reload} skeletonRows={3} skeletonHeight={120}>
          <ErrorState kind="api" title="We couldn't find that plan" body="It may no longer be offered." onRetry={() => nav.navigate('premium_compare')} retryLabel="See plans" />
        </QueryState>
      </Screen>
    );
  }

  if (plan.billing === 'invoice' || !plan.productId) {
    return (
      <Screen header={<ScreenHeader title="Checkout" />}>
        <ErrorState
          kind="api"
          title="This plan isn't sold in the app"
          body={plan.billing === 'invoice' ? 'Venue / Club plans are invoiced after verification.' : 'This plan is free, nothing to buy.'}
          onRetry={() => nav.navigate(plan.billing === 'invoice' ? 'business_onboarding' : 'premium_compare')}
          retryLabel={plan.billing === 'invoice' ? 'Set up a venue' : 'See plans'}
        />
      </Screen>
    );
  }

  const price = plans.storePrice(plan);
  const storeReady = !!product;
  const tone = toneColors(plan.tier === 'pro' ? 'orange' : 'periwinkle');

  const buy = async () => {
    if (status === 'purchasing') return;
    setStatus('purchasing');
    setError(null);
    const res = await purchase(plan.productId, product?.offerToken);
    if (res.status === 'success') {
      const ent = res.entitlement || {};
      // Server response is the source of truth: { entitlement|tier, status, expiresAt, store }.
      setSubscription({
        tier: ent.tier || ent.entitlement || plan.tier,
        status: ent.status || 'active',
        expiresAt: ent.expiresAt || null,
        store: ent.store || null,
      });
      loadSubscription().catch(() => null);
      haptics.success();
      setCelebrate(Date.now());
      setStatus('success');
      return;
    }
    if (res.status === 'failed') setError(res.error?.message || `${storeName()} couldn't complete the purchase. You haven't been charged.`);
    setStatus(res.status);
  };

  const recheck = async () => {
    setChecking(true);
    try {
      const sub = await loadSubscription();
      if (sub?.tier && sub.tier !== 'free' && sub.status !== 'pending') {
        setCelebrate(Date.now());
        setStatus('success');
      }
    } catch (e) {
      setError(e?.message || 'Couldn’t check right now. Try again in a minute.');
    } finally {
      setChecking(false);
    }
  };

  if (status === 'success') {
    return (
      <Screen header={<ScreenHeader title="" back={false} />} footer={<Button title="Done" onPress={() => nav.goBack()} />}>
        <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.lg }}>
          <Mascot size={160} mood="celebrate" celebrateKey={celebrate} />
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header" accessibilityLiveRegion="polite">
            You're on {plan.name}
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs }}>
            {subscription.expiresAt ? `Renews ${shortDate(subscription.expiresAt)}` : 'Renews monthly'} · manage in {storeName()}
          </AppText>
        </Animated.View>
        {plan.newItems?.length > 0 && (
          <Card style={{ marginTop: space.xl }}>
            <AppText variant="label" color={colors.muted} style={{ marginBottom: space.xxs }}>
              Unlocked for you
            </AppText>
            {plan.newItems.slice(0, 4).map((f) => (
              <BenefitRow key={f.key} item={f} compact style={{ paddingVertical: space.xxs }} />
            ))}
          </Card>
        )}
      </Screen>
    );
  }

  const store = storeName();
  const banner =
    status === 'pending'
      ? { icon: 'clock', bg: colors.orangeSoft, title: 'Payment pending', body: `${plan.name} unlocks as soon as ${store} confirms the payment.` }
      : status === 'pending_verification'
      ? { icon: 'refresh-cw', bg: colors.orangeSoft, title: 'Confirming your purchase', body: 'This usually takes under a minute.' }
      : status === 'cancelled'
      ? { icon: 'x-circle', bg: colors.surfaceSubtle, title: 'Purchase cancelled', body: 'No charge was made.' }
      : status === 'failed'
      ? { icon: 'alert-circle', bg: colors.pinkSoft, title: 'Purchase didn’t go through', body: error }
      : null;

  const waiting = status === 'pending' || status === 'pending_verification';
  const extra = (plan.newItems?.length || 0) - 3;

  return (
    <Screen
      header={<ScreenHeader title="Checkout" />}
      footer={
        waiting ? (
          <View>
            <Button title="Check status" icon="refresh-cw" loading={checking} disabled={checking} onPress={recheck} />
            <Button title="Back to plans" variant="ghost" style={{ marginTop: space.xs }} onPress={() => nav.goBack()} />
          </View>
        ) : (
          <Button
            title={currentTier === plan.tier ? 'You already have this plan' : price ? `Subscribe · ${price}/month` : 'Subscribe'}
            loading={status === 'purchasing'}
            disabled={currentTier === plan.tier || status === 'purchasing' || (!storeReady && plans.status === 'ready')}
            onPress={buy}
          />
        )
      }
    >
      {banner && (
        <Animated.View entering={fadeIn()} accessibilityLiveRegion="polite" style={{ backgroundColor: banner.bg, borderRadius: radius.quest, padding: space.md, flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
          <Icon name={banner.icon} size={20} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">{banner.title}</AppText>
            {!!banner.body && (
              <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
                {banner.body}
              </AppText>
            )}
          </View>
        </Animated.View>
      )}
      {!storeReady && plans.status === 'ready' && (
        <View style={{ backgroundColor: colors.surfaceSubtle, borderRadius: radius.quest, padding: space.md, flexDirection: 'row', alignItems: 'center', marginTop: space.xs }} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={18} />
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
            {store} isn't available on this device. Sign in to {store} and try again.
          </AppText>
        </View>
      )}

      {/* The plan: name, price and what it adds */}
      <Animated.View entering={enter(0)}>
        <Card style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name={plan.pictogram} size={26} color={colors.ink} duotoneColor={tone.duo} duotoneOpacity={0.7} />
            </View>
            <View style={{ flex: 1, marginHorizontal: space.sm }}>
              <AppText variant="h2" numberOfLines={1}>
                Come Over {plan.name}
              </AppText>
              {!!plan.target && (
                <AppText variant="caption" color={colors.muted} numberOfLines={2}>
                  {/^for\b/i.test(plan.target) ? plan.target : `For ${plan.target}`}
                </AppText>
              )}
            </View>
            <PriceText price={price} loading={plans.status === 'loading' && !product} />
          </View>
          {plan.newItems?.length > 0 && (
            <View style={{ marginTop: space.sm, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
              {plan.newItems.slice(0, 3).map((f) => (
                <BenefitRow key={f.key} item={f} compact style={{ paddingVertical: space.xxs }} />
              ))}
              {extra > 0 && (
                <AppText variant="caption" color={colors.muted} style={{ marginLeft: 32 + space.sm, marginTop: space.xxs }}>
                  + {extra} more
                </AppText>
              )}
            </View>
          )}
        </Card>
      </Animated.View>

      {/* Order summary */}
      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.md }} padding={0}>
          {[
            ['Billed', 'Monthly, until you cancel'],
            ['Paid through', store],
            ['Taxes', `Shown by ${store} before you confirm`],
          ].map(([k, v], i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <AppText color={colors.muted}>{k}</AppText>
              <AppText variant="bodyStrong" align="right" style={{ flex: 1, marginLeft: space.md }}>
                {v}
              </AppText>
            </View>
          ))}
        </Card>
      </Animated.View>

      {/* Store billing terms */}
      <Animated.View entering={enter(2)} style={{ marginTop: space.lg }}>
        <AppText variant="caption" color={colors.muted}>
          We never see your card, UPI or bank details. Renews monthly until you cancel in {store} settings at least 24 hours before renewal.
        </AppText>
        <AppText variant="label" color={colors.deep} style={{ marginTop: space.xxs, paddingVertical: space.sm, alignSelf: 'flex-start' }} onPress={() => nav.navigate('subscription_manage', { restore: true })} accessibilityRole="button" suppressHighlighting>
          Restore purchases
        </AppText>
      </Animated.View>
    </Screen>
  );
}
