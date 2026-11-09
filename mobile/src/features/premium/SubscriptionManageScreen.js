// subscription_manage — entitlement state (GET /me/subscription), renewal,
// restore (store purchases → POST /subscriptions/restore) and store management.
// One status card, one list of actions, what the plan includes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, HeroCard, Icon, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Tag } from '@/components';
import { colors, glass, radius, space } from '@/theme/tokens';
import { enter, fadeIn } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { manageSubscriptionsUrl, restore } from '@/services/billing';
import { shortDate, storeName, usePlans } from './plans';
import { BenefitRow, toneColors } from './PaywallParts';

// Entitlement states the server can report. A function so the colours follow
// the live (light/dark) palette.
const stateCopy = () => ({
  free: { label: 'Free', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Every core feature is yours, free.' },
  active: { label: 'Active', bg: colors.mint, fg: colors.ink, body: null },
  pending: { label: 'Pending', bg: colors.orangeSoft, fg: colors.ink, body: 'Features unlock once the store confirms payment.' },
  grace: { label: 'Payment issue', bg: colors.orangeSoft, fg: colors.ink, body: 'Renewal failed. Update your payment in store settings.' },
  expired: { label: 'Expired', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Paid features are paused. Free ones still work.' },
  refunded: { label: 'Refunded', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Refunded, so paid features are off.' },
  cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Auto-renew is off. Features stay on until then.' },
});
const STATES = ['free', 'active', 'pending', 'grace', 'expired', 'refunded', 'cancelled'];

function entitlementState(sub) {
  if (!sub || (!sub.status && (!sub.tier || sub.tier === 'free'))) return 'free';
  if (sub.status === 'revoked') return 'refunded';
  if (STATES.includes(sub.status) && sub.status !== 'active') return sub.status;
  if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return 'expired';
  if (sub.tier && sub.tier !== 'free') return 'active';
  return 'free';
}

const STORE_LABEL = { apple: 'App Store', google: 'Google Play', web: 'web' };

export default function SubscriptionManageScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const subscription = useAppStore((s) => s.subscription);
  const setSubscription = useAppStore((s) => s.setSubscription);
  const subL = useLoader('subscription', (s) => s.loadSubscription());
  const plans = usePlans();
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState(null);

  const state = entitlementState(subscription);
  const copy = stateCopy()[state];
  const paidFeaturesOn = ['active', 'grace', 'cancelled'].includes(state);
  const plan = useMemo(() => (paidFeaturesOn ? plans.byId(subscription.tier) : plans.byId('free')), [paidFeaturesOn, plans, subscription.tier]);
  const freePlan = plans.byId('free');

  const doRestore = async () => {
    setRestoring(true);
    setNotice(null);
    try {
      const res = await restore();
      const tier = res?.tier || res?.entitlement;
      if (tier && tier !== 'free') {
        setSubscription({ tier, status: res.status || 'active', expiresAt: res.expiresAt || null, store: res.store || null });
        await subL.reload();
        setNotice({ ok: true, text: `Restored ${plans.byId(tier)?.name || tier}.` });
      } else {
        setNotice({ ok: false, text: `No active purchases found for this ${storeName()} account.` });
      }
    } catch (e) {
      setNotice({ ok: false, text: e?.message || "Couldn't reach the store. Check your connection and try again." });
    } finally {
      setRestoring(false);
    }
  };

  const dateLine =
    state === 'active'
      ? subscription.expiresAt
        ? `Renews ${shortDate(subscription.expiresAt)}`
        : 'Renews monthly'
      : state === 'cancelled' && subscription.expiresAt
      ? `Access until ${shortDate(subscription.expiresAt)}`
      : state === 'grace'
      ? 'Grace period active'
      : state === 'expired' && subscription.expiresAt
      ? `Ended ${shortDate(subscription.expiresAt)}`
      : null;

  // "Restore purchases" from the plans page / checkout lands here and runs once.
  const autoRestored = useRef(false);
  useEffect(() => {
    if (params.restore && !autoRestored.current) {
      autoRestored.current = true;
      doRestore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.restore]);

  const features = (paidFeaturesOn ? plan?.featureItems : freePlan?.featureItems) || [];
  const tone = toneColors(plan?.tier === 'pro' ? 'orange' : plan?.tier === 'plus' ? 'periwinkle' : 'mint');
  const price = state === 'active' && plan?.productId ? plans.storePrice(plan) : null;

  const billedBy = subscription.store && state !== 'free' ? STORE_LABEL[subscription.store] || subscription.store : null;
  const meta = [dateLine, price ? `${price}/month` : null, billedBy].filter(Boolean).join(' · ');
  const isFree = state === 'free';

  return (
    <Screen
      header={<ScreenHeader title="Subscription" />}
      footer={isFree ? <Button title="See Plus & Pro" icon="star" onPress={() => nav.navigate('premium_compare')} /> : undefined}
      refreshControl={
        <RefreshControl
          refreshing={subL.refreshing || plans.refreshing}
          onRefresh={() => {
            subL.reload();
            plans.reload();
          }}
          tintColor={colors.ink}
        />
      }
    >
      {/* Status */}
      <QueryState status={subL.status} error={subL.error} hasData={subL.status === 'ready' || !!subscription.status || subscription.tier !== 'free'} onRetry={subL.reload} skeletonRows={1} skeletonHeight={120} style={{ marginTop: space.sm }}>
        <Animated.View entering={enter(0)}>
          <HeroCard style={{ marginTop: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: glass(0.7), alignItems: 'center', justifyContent: 'center' }}>
                <Pictogram name={plan?.pictogram || 'people'} size={28} color={colors.ink} duotoneColor={tone.duo} duotoneOpacity={0.7} />
              </View>
              <View style={{ flex: 1, marginHorizontal: space.sm }}>
                <AppText variant="h2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {paidFeaturesOn ? `Come Over ${plan?.name || subscription.tier}` : 'Free'}
                </AppText>
                {!!meta && (
                  <AppText variant="caption" color={colors.inkSoft} numberOfLines={2} style={{ marginTop: 2 }}>
                    {meta}
                  </AppText>
                )}
              </View>
              <Tag label={copy.label} bg={copy.bg} fg={copy.fg} style={{ alignSelf: 'center' }} />
            </View>
            {!!copy.body && (
              <AppText color={colors.inkSoft} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
                {copy.body}
              </AppText>
            )}
          </HeroCard>
        </Animated.View>
      </QueryState>

      {notice && (
        <Animated.View entering={fadeIn()} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: notice.ok ? colors.mint : colors.surface, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}>
          <Icon name={notice.ok ? 'check-circle' : 'info'} size={18} />
          <AppText variant="label" style={{ marginLeft: space.xs, flex: 1 }}>
            {notice.text}
          </AppText>
        </Animated.View>
      )}

      {/* Actions */}
      <SectionHeader title="Manage" />
      <ListGroup>
        {!isFree && (
          <ListRow
            icon="external-link"
            title={`Manage in ${storeName()}`}
            subtitle="Change plan, cancel or update payment"
            onPress={() => Linking.openURL(manageSubscriptionsUrl()).catch(() => setNotice({ ok: false, text: `Open ${storeName()} › Subscriptions to manage your plan.` }))}
          />
        )}
        <ListRow icon="refresh-cw" title={restoring ? 'Restoring…' : 'Restore purchases'} onPress={restoring ? undefined : doRestore} last={isFree} />
        {!isFree && <ListRow icon="layers" title="Compare plans" onPress={() => nav.navigate('premium_compare')} last />}
      </ListGroup>

      {/* What's included */}
      {features.length > 0 && (
        <>
          <SectionHeader title={paidFeaturesOn ? 'Included' : 'Included free'} />
          <Card>
            {features.map((f, i) => (
              <BenefitRow key={f.key} item={f} compact style={{ paddingVertical: space.xxs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }} />
            ))}
          </Card>
        </>
      )}

      {state === 'active' && (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.md }}>
          Cancelling keeps {plan?.name || 'your plan'} until the paid period ends. Refunds are handled by {storeName()}.
        </AppText>
      )}
    </Screen>
  );
}
