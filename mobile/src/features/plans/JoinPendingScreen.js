// join_pending — waiting for the host's decision. The join state is updated by
// realtime `join.updated` events; while focused we also re-fetch the plan every
// 20 s as a fallback. Nothing here assumes the host will accept.
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Mascot, Screen, ScreenHeader } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import usePlan from './usePlan';
import PlanSummary from './components/PlanSummary';
import PlanGate from './components/PlanGate';

const POLL_MS = 20000;

function TypingDots() {
  const reduce = useReducedMotion();
  const d0 = useSharedValue(0.3);
  const d1 = useSharedValue(0.3);
  const d2 = useSharedValue(0.3);
  useEffect(() => {
    if (reduce) return;
    [d0, d1, d2].forEach((d, i) => {
      d.value = withDelay(i * 160, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1));
    });
  }, [reduce]);
  const s0 = useAnimatedStyle(() => ({ opacity: d0.value }));
  const s1 = useAnimatedStyle(() => ({ opacity: d1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: d2.value }));
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel="Waiting">
      {[s0, s1, s2].map((s, i) => (
        <Animated.View key={i} style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ink }, s]} />
      ))}
    </View>
  );
}

function Step({ done, active, title, subtitle, last }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ alignItems: 'center', width: 28 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: done ? colors.ink : active ? colors.orange : colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          {done ? <Icon name="check" size={14} color={colors.white} /> : active ? <TypingDots /> : null}
        </View>
        {!last && <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: done ? colors.ink : colors.border }} />}
      </View>
      <View style={{ flex: 1, marginLeft: space.sm, paddingBottom: last ? 0 : space.md }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color={colors.muted}>
          {subtitle}
        </AppText>
      </View>
    </View>
  );
}

export default function JoinPendingScreen() {
  const nav = useNavigation();
  const { id, activity: a, joinState, loader } = usePlan();
  const cancelJoin = useAppStore((s) => s.cancelJoin);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState(null);

  // Fallback poll while visible (realtime is the primary signal).
  useFocusEffect(
    useCallback(() => {
      if (!id) return undefined;
      const t = setInterval(() => {
        loadActivity(id, { silent: true }).catch(() => null);
      }, POLL_MS);
      return () => clearInterval(t);
    }, [id, loadActivity])
  );

  useEffect(() => {
    if (joinState === 'accepted') {
      const t = setTimeout(() => nav.replace('join_accepted', { id }), 500);
      return () => clearTimeout(t);
    }
    if (joinState === 'waitlisted') nav.replace('waitlist', { id });
    return undefined;
  }, [joinState]);

  if (!a) return <PlanGate title="Request" loader={loader} />;

  const accepted = joinState === 'accepted';
  const declined = joinState === 'declined';
  const withdrawn = joinState === 'cancelled';
  const closed = declined || withdrawn;
  const hostName = a.host?.name || 'the host';

  const withdraw = async () => {
    setWithdrawing(true);
    setError(null);
    try {
      await cancelJoin(id);
    } catch (e) {
      setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection — your request is still active. Try again.' : e?.message || 'Couldn’t withdraw. Try again.');
    } finally {
      setWithdrawing(false);
    }
  };

  let headline = `Waiting for ${hostName}`;
  let body = `${hostName} decides who joins. Most hosts reply within a few minutes — we’ll notify you either way.`;
  if (accepted) {
    headline = 'You’re in!';
    body = 'Opening your plan…';
  } else if (declined) {
    headline = 'Not this time';
    body = 'The host went with a smaller group. It’s not personal — there’s plenty more nearby.';
  } else if (withdrawn) {
    headline = 'Request withdrawn';
    body = 'No worries — there’s plenty more nearby.';
  }

  return (
    <Screen
      bg={colors.periwinkle}
      header={<ScreenHeader title="Request sent" variant="glass" onBack={() => nav.navigate('main')} />}
      footer={
        closed ? (
          <Button title="Browse other plans" onPress={() => nav.navigate('category_results', { category: a.category })} />
        ) : (
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Button title="Keep browsing" variant="light" onPress={() => nav.navigate('main')} style={{ flex: 1 }} />
            <Button title="Withdraw" variant="ghost" full={false} disabled={accepted} loading={withdrawing} onPress={withdraw} />
          </View>
        )
      }
    >
      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <Mascot size={190} pose="wave" mood={accepted ? 'celebrate' : 'idle'} celebrateKey={accepted ? 1 : null} />
        <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
          {headline}
        </AppText>
        <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6, maxWidth: 300 }}>
          {body}
        </AppText>
        {!!error && (
          <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.xs }}>
            {error}
          </AppText>
        )}
      </View>

      <PlanSummary activity={a} style={{ marginTop: space.xl }} />

      {!closed && (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: radius.card, padding: space.md, marginTop: space.md }}>
          <Step done title="Request sent" subtitle="Your intro and show-up rate went to the host" />
          <Step done={accepted} active={!accepted} title="Host reviewing" subtitle={`${hostName} decides who joins`} />
          <Step active={accepted} title="Group chat unlocks" subtitle="Exact meeting spot is shared there" last />
        </View>
      )}
    </Screen>
  );
}
