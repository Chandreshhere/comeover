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
          body={plan.billing === 'invoice' ? 'Venue / Club plans are invoiced after verification.' : 'This plan is free — nothing to buy.'}
          onRetry={() => nav.navigate(plan.billing === 'invoice' ? 'business_onboarding' : 'premium_compare')}
          retryLabel={plan.billing === 'invoice' ? 'Set up a venue' : 'See plans'}
        />
      </Screen>
    );
  }

  const price = plans.priceLabel(plan);
  const storeReady = !!product;

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
        <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.xl }}>
          <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.lg, alignItems: 'center', width: '100%' }}>
            <Mascot size={170} mood="celebrate" celebrateKey={celebrate} />
          </View>
          <AppText variant="h1" align="center" style={{ marginTop: space.lg }} accessibilityRole="header" accessibilityLiveRegion="polite">
            You're on {plan.name}
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
            {subscription.expiresAt ? `Renews ${shortDate(subscription.expiresAt)}` : 'Renews monthly'} through {storeName()}. Manage or cancel anytime in your store settings.
          </AppText>
          {plan.features.length > 0 && (
            <Card style={{ marginTop: space.lg, alignSelf: 'stretch' }}>
              {plan.features.slice(0, 4).map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                  <Icon name="check" size={16} color={colors.success} />
                  <AppText style={{ marginLeft: 8, flex: 1 }}>{f}</AppText>
                </View>
              ))}
            </Card>
          )}
        </Animated.View>
      </Screen>
    );
  }

  const banner =
    status === 'pending'
      ? { icon: 'clock', bg: colors.orangeSoft, title: 'Payment pending', body: `${storeName()} is waiting for your payment to clear. ${plan.name} unlocks as soon as it's confirmed — nothing to do here.` }
      : status === 'pending_verification'
      ? { icon: 'refresh-cw', bg: colors.orangeSoft, title: 'Confirming your purchase', body: `${storeName()} took the payment and we're verifying it. This usually takes under a minute.` }
      : status === 'cancelled'
      ? { icon: 'x-circle', bg: colors.surfaceSubtle, title: 'Purchase cancelled', body: 'No charge was made. You can try again whenever you like.' }
      : status === 'failed'
      ? { icon: 'alert-circle', bg: colors.pinkSoft, title: 'Purchase didn’t go through', body: error }
      : null;

  const waiting = status === 'pending' || status === 'pending_verification';

  return (
    <Screen
      header={<ScreenHeader title="Checkout" />}
      footer={
        waiting ? (
          <View style={{ gap: space.xs }}>
            <Button title="Check status" icon="refresh-cw" loading={checking} disabled={checking} onPress={recheck} />
            <Button title="Back to plans" variant="secondary" onPress={() => nav.goBack()} />
          </View>
        ) : (
          <Button
            title={currentTier === plan.tier ? 'You already have this plan' : `Subscribe · ${price}/month`}
            loading={status === 'purchasing'}
            disabled={currentTier === plan.tier || status === 'purchasing' || (!storeReady && plans.status === 'ready')}
            onPress={buy}
          />
        )
      }
    >
      {banner && (
        <Animated.View entering={fadeIn()} accessibilityLiveRegion="polite" style={{ backgroundColor: banner.bg, borderRadius: radius.quest, padding: space.md, flexDirection: 'row', marginTop: space.xs }}>
          <Icon name={banner.icon} size={20} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">{banner.title}</AppText>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 2 }}>
              {banner.body}
            </AppText>
          </View>
        </Animated.View>
      )}
      {!storeReady && plans.status === 'ready' && (
        <View style={{ backgroundColor: colors.surfaceSubtle, borderRadius: radius.quest, padding: space.md, flexDirection: 'row', marginTop: space.xs }} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={18} />
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
            {storeName()} isn't available on this device right now, so this plan can't be bought here. Make sure you're signed in to {storeName()} and try again.
          </AppText>
        </View>
      )}

      <Animated.View entering={enter(0)}>
        <Card bg={colors.periwinkle} elevated={false} style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }} r={radius.hero}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={plan.pictogram} size={28} color={colors.white} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h2">IRL {plan.name}</AppText>
            {!!plan.target && (
              <AppText variant="caption" color={colors.inkSoft}>
                {plan.target}
              </AppText>
            )}
          </View>
        </Card>
      </Animated.View>

      {/* Order summary */}
      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.md }}>
          <AppText variant="h3">Order summary</AppText>
          {[
            ['Plan', `${plan.name} (monthly)`],
            ['Price', `${price} / month`],
            ['Billed by', storeName()],
            ['Renews', 'Every month until cancelled'],
          ].map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <AppText color={colors.muted}>{k}</AppText>
              <AppText variant="bodyStrong">{v}</AppText>
            </View>
          ))}
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
            Taxes, if any, are shown by {storeName()} before you confirm.
          </AppText>
        </Card>
      </Animated.View>

      {/* Store billing explainer */}
      <Animated.View entering={enter(2)}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md, marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="lock" size={16} />
            <AppText variant="label" style={{ marginLeft: 6 }}>
              Paid securely through {storeName()}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
            In-app features are sold through {storeName()} billing as the store requires. We never see or store your card, UPI PIN or bank details. The subscription renews monthly until you cancel in {storeName()} settings at least 24 hours before the renewal date.
          </AppText>
          <AppText variant="label" color={colors.deep} style={{ marginTop: space.sm }} onPress={() => nav.navigate('subscription_manage')} accessibilityRole="button" suppressHighlighting>
            Restore purchases
          </AppText>
        </View>
      </Animated.View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, paddingHorizontal: 4 }}>
        <Icon name="shield" size={14} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6, flex: 1 }}>
          Safety, reporting, blocking, joining and accepted-plan chat stay free whatever you choose.
        </AppText>
      </View>
    </Screen>
  );
}
