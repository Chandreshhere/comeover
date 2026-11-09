import GuideCharacter from '@/features/guide/GuideCharacter';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radius, space } from '@/theme/tokens';
import { MascotArt } from '@/illustrations/Mascot';
import AppText from './AppText';
import Button from './Button';
import { IconBubble } from './Card';
import Icon from './Icon';

// Friendly empty state with the mascot — never a dead end: always offer an action.
export function EmptyState({ title, body, cta, onCta, secondary, onSecondary, pose = 'wave', compact = false, style }) {
  const w = compact ? 120 : 170;
  const h = compact ? 110 : 150;
  return (
    <View style={[{ alignItems: 'center', paddingVertical: compact ? space.lg : space.xxl, paddingHorizontal: space.md }, style]}>
      {/* Mo stands on his own: no box behind him. */}
      <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
        {/* Two little sparkles in the empty corners — playful, never over the mascot. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: '8%', top: '9%' }}>
          <Icon name="sparkle" size={compact ? 12 : 16} color={colors.orange} weight="fill" />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: '6%', bottom: '8%' }}>
          <Icon name="sparkle" size={compact ? 9 : 12} color={colors.deep} weight="fill" />
        </View>
        <MascotArt size={compact ? 100 : 140} pose={pose} showMotionLines={false} />
      </View>
      <AppText variant="h2" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {!!body && (
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
          {body}
        </AppText>
      )}
      {!!cta && <Button title={cta} onPress={onCta} full={false} align="center" style={{ marginTop: space.lg }} />}
      {!!secondary && <Button title={secondary} onPress={onSecondary} variant="ghost" full={false} align="center" style={{ marginTop: space.xs }} />}
    </View>
  );
}

const ERROR_COPY = {
  offline: { icon: 'wifi-off', tone: 'periwinkle', title: "You're offline", body: "We'll reconnect automatically. Your drafts are saved on this device." },
  permission: { icon: 'map-pin', tone: 'mint', title: 'Location is off', body: 'Pick your area manually instead. Plans still work without GPS.' },
  api: { icon: 'cloud-off', tone: 'pink', title: 'Something went wrong', body: "That's on us. Try again in a moment." },
  restricted: { icon: 'shield-off', tone: 'orange', title: 'Account limited', body: 'Some actions are paused while a report is reviewed. You can still use safety tools and appeal.' },
  maintenance: { icon: 'tool', tone: 'lavender', title: 'Quick tune-up', body: "We're doing maintenance. Back shortly." },
};

const MO_MOOD = { offline: 'sad', api: 'sad', permission: 'think', maintenance: 'think' };

export function ErrorState({ kind = 'api', title, body, onRetry, retryLabel = 'Try again', secondary, onSecondary, style }) {
  const c = ERROR_COPY[kind] || ERROR_COPY.api;
  const mood = MO_MOOD[kind];
  return (
    <View style={[{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.md }, style]} accessibilityLiveRegion="polite">
      {mood ? (
        <GuideCharacter size={132} state={mood} decorative style={{ marginBottom: space.sm }} />
      ) : (
        <IconBubble size={80} tone={c.tone} icon={c.icon} iconSize={36} style={{ marginBottom: space.md }} />
      )}
      <AppText variant="h2" align="center" accessibilityRole="header">
        {title || c.title}
      </AppText>
      <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
        {body || c.body}
      </AppText>
      {!!onRetry && <Button title={retryLabel} onPress={onRetry} full={false} align="center" style={{ marginTop: space.lg }} icon="refresh-cw" />}
      {!!secondary && <Button title={secondary} onPress={onSecondary} variant="ghost" full={false} align="center" style={{ marginTop: space.xs }} />}
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
