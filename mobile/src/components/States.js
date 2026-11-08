import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radius, space } from '@/theme/tokens';
import { MascotArt } from '@/illustrations/Mascot';
import AppText from './AppText';
import Button from './Button';
import Icon from './Icon';

// Friendly empty state with the mascot — never a dead end: always offer an action.
export function EmptyState({ title, body, cta, onCta, secondary, onSecondary, pose = 'wave', compact = false, style }) {
  return (
    <View style={[{ alignItems: 'center', paddingVertical: compact ? space.lg : space.xxl, paddingHorizontal: space.md }, style]}>
      <View style={{ width: compact ? 120 : 170, height: compact ? 110 : 150, borderRadius: radius.card, backgroundColor: colors.periwinkleWash, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg }}>
        <MascotArt size={compact ? 100 : 140} pose={pose} showMotionLines={false} />
      </View>
      <AppText variant="h2" align="center">
        {title}
      </AppText>
      {!!body && (
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
          {body}
        </AppText>
      )}
      {cta && <Button title={cta} onPress={onCta} full={false} style={{ marginTop: space.lg }} />}
      {secondary && <Button title={secondary} onPress={onSecondary} variant="ghost" full={false} style={{ marginTop: space.xs }} />}
    </View>
  );
}

const ERROR_COPY = {
  offline: { icon: 'wifi-off', title: "You're offline", body: "We'll reconnect automatically. Your drafts are saved on this device." },
  permission: { icon: 'map-pin', title: 'Location is off', body: 'Pick your area manually instead — plans still work without GPS.' },
  api: { icon: 'cloud-off', title: 'Something went wrong', body: "That's on us. Try again in a moment." },
  restricted: { icon: 'shield-off', title: 'Account limited', body: 'Some actions are paused while a report is reviewed. You can still use safety tools and appeal.' },
  maintenance: { icon: 'tool', title: 'Quick tune-up', body: "We're doing maintenance. Back shortly." },
};

export function ErrorState({ kind = 'api', title, body, onRetry, retryLabel = 'Try again', secondary, onSecondary, style }) {
  const c = ERROR_COPY[kind] || ERROR_COPY.api;
  return (
    <View style={[{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.md }, style]} accessibilityLiveRegion="polite">
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
        <Icon name={c.icon} size={28} color={colors.ink} />
      </View>
      <AppText variant="h2" align="center">
        {title || c.title}
      </AppText>
      <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
        {body || c.body}
      </AppText>
      {onRetry && <Button title={retryLabel} onPress={onRetry} full={false} style={{ marginTop: space.lg }} icon="refresh-cw" />}
      {secondary && <Button title={secondary} onPress={onSecondary} variant="ghost" full={false} style={{ marginTop: space.xs }} />}
    </View>
  );
}

// Standard data-state wrapper for API-backed sections:
// first load → skeleton rows; error with nothing cached → ErrorState + retry;
// loaded but empty → EmptyState (pass `empty` props); otherwise children.
export function QueryState({ status, error, hasData, onRetry, empty, skeletonRows = 3, skeletonHeight = 84, children, style }) {
  if (!hasData && (status === 'loading' || status === 'idle')) {
    return (
      <View style={[{ gap: space.sm }, style]} accessibilityLabel="Loading">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} height={skeletonHeight} r={radius.card} />
        ))}
      </View>
    );
  }
  if (!hasData && status === 'error') {
    const kind = /connection|network|timeout/i.test(error || '') ? 'offline' : 'api';
    return <ErrorState kind={kind} body={error || undefined} onRetry={onRetry} style={style} />;
  }
  if (!hasData && empty) return <EmptyState compact {...empty} style={style} />;
  return children;
}

// Loading skeleton block with a soft opacity pulse (static under Reduce Motion).
export function Skeleton({ width = '100%', height = 16, r = 8, style }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(0.6);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [reduce]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View accessibilityLabel="Loading" style={[{ width, height, borderRadius: r, backgroundColor: colors.track }, a, style]} />;
}
