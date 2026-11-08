// subscription_manage — entitlement state (GET /me/subscription), renewal,
// restore (store purchases → POST /subscriptions/restore) and store management.
import React, { useMemo, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, HeroCard, Icon, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter, fadeIn } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { manageSubscriptionsUrl, restore } from '@/services/billing';
import { NEVER_GATED, shortDate, storeName, usePlans } from './plans';

// Entitlement states the server can report.
const STATE_COPY = {
  free: { label: 'Free', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'You have every core feature. Upgrade only if a paid tool helps you.' },
  active: { label: 'Active', bg: colors.mint, fg: colors.ink, body: 'Renews automatically through your store account.' },
  pending: { label: 'Pending', bg: colors.orangeSoft, fg: colors.ink, body: 'Waiting for the store to confirm payment. Features unlock as soon as it clears.' },
  grace: { label: 'Payment issue', bg: colors.orangeSoft, fg: colors.ink, body: 'Your store couldn’t renew the subscription. Features stay on during the grace period — update your payment method in store settings.' },
  expired: { label: 'Expired', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Paid features are paused. Everything free keeps working, and your data is kept.' },
  refunded: { label: 'Refunded', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'This purchase was refunded, so paid features are off. Free features are unaffected.' },
  cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle, fg: colors.inkSoft, body: 'Auto-renew is off. Paid features stay on until the end of the period you paid for.' },
};

function entitlementState(sub) {
  if (!sub || (!sub.status && (!sub.tier || sub.tier === 'free'))) return 'free';
  if (STATE_COPY[sub.status] && sub.status !== 'active') return sub.status;
  if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return 'expired';
  if (sub.tier && sub.tier !== 'free') return 'active';
  return 'free';
}

const STORE_LABEL = { apple: 'App Store', google: 'Google Play', web: 'web' };

export default function SubscriptionManageScreen() {
  const nav = useNavigation();
  const subscription = useAppStore((s) => s.subscription);
  const setSubscription = useAppStore((s) => s.setSubscription);
  const subL = useLoader('subscription', (s) => s.loadSubscription());
  const plans = usePlans();
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState(null);

  const state = entitlementState(subscription);
  const copy = STATE_COPY[state];
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

  const features = (paidFeaturesOn ? plan?.features : freePlan?.features) || [];

  return (
    <Screen
      header={<ScreenHeader title="Subscription" />}
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
      <QueryState status={subL.status} error={subL.error} hasData={subL.status === 'ready' || !!subscription.status || subscription.tier !== 'free'} onRetry={subL.reload} skeletonRows={1} skeletonHeight={170} style={{ marginTop: space.md }}>
        <Animated.View entering={enter(0)}>
          <HeroCard style={{ marginTop: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Pictogram name={plan?.pictogram || 'people'} size={28} color={colors.white} />
              </View>
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="caption" color={colors.inkSoft}>
                  Current plan
                </AppText>
                <AppText variant="h1">{paidFeaturesOn ? `IRL ${plan?.name || subscription.tier}` : 'Free'}</AppText>
              </View>
              <Tag label={copy.label} bg={copy.bg} fg={copy.fg} />
            </View>
            {dateLine && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
                <Icon name="calendar" size={14} />
                <AppText variant="label" style={{ marginLeft: 6 }}>
                  {dateLine}
                  {state === 'active' && plan?.productId ? ` · ${plans.priceLabel(plan)}/month` : ''}
                </AppText>
              </View>
            )}
            <AppText color={colors.inkSoft} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
              {copy.body}
            </AppText>
            {subscription.store && state !== 'free' && (
              <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
                Billed by {STORE_LABEL[subscription.store] || subscription.store}
              </AppText>
            )}
          </HeroCard>
        </Animated.View>
      </QueryState>

      {notice && (
        <Animated.View entering={fadeIn()} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: notice.ok ? colors.mint : colors.surface, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}>
          <Icon name={notice.ok ? 'check-circle' : 'info'} size={18} />
          <AppText variant="label" style={{ marginLeft: 8, flex: 1 }}>
            {notice.text}
          </AppText>
        </Animated.View>
      )}

      <SectionHeader title="Manage" />
      <ListGroup>
        {state !== 'free' && (
          <ListRow
            icon="external-link"
            title={`Manage in ${storeName()}`}
            subtitle="Change plan, cancel or update payment"
            onPress={() => Linking.openURL(manageSubscriptionsUrl()).catch(() => setNotice({ ok: false, text: `Open ${storeName()} › Subscriptions to manage your plan.` }))}
          />
        )}
        <ListRow icon="refresh-cw" title={restoring ? 'Restoring…' : 'Restore purchases'} subtitle={`Re-link a purchase made with this ${storeName()} account`} onPress={restoring ? undefined : doRestore} />
        <ListRow icon="layers" title="Compare plans" onPress={() => nav.navigate('premium_compare')} last />
      </ListGroup>

      {features.length > 0 && (
        <>
          <SectionHeader title={paidFeaturesOn ? `What ${plan?.name || 'your plan'} includes` : 'What you have now'} />
          <Card>
            {features.map((f) => (
              <View key={f} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 }}>
                <Icon name="check" size={16} color={colors.success} style={{ marginTop: 3 }} />
                <AppText style={{ marginLeft: 8, flex: 1 }}>{f}</AppText>
              </View>
            ))}
          </Card>
        </>
      )}

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md, marginTop: space.md }}>
        <AppText variant="label">Always free</AppText>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4 }}>
          {NEVER_GATED.map((g) => g.label).join(' · ')}
        </AppText>
      </View>

      {state === 'active' && (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.md }}>
          Cancelling in {storeName()} keeps {plan?.name || 'your plan'} until the end of the paid period. Refunds are handled by {storeName()} under its policies.
        </AppText>
      )}
      {state === 'free' && <Button title="See paid plans" variant="secondary" style={{ marginTop: space.lg }} onPress={() => nav.navigate('premium_compare')} />}
    </Screen>
  );
}
