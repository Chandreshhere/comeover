// Shared constants/helpers for progress screens.
import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Icon } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import XpBurst from './XpBurst';

// Fallback for the server-side anti-gaming daily XP cap when the progress
// payload doesn't include `dailyXpCap`. Display only — the server enforces it.
export const DAILY_XP_CAP = 200;
export const dailyCapOf = (progress) => progress?.dailyXpCap ?? DAILY_XP_CAP;

export function FairPlayNote({ style, cap = DAILY_XP_CAP }) {
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.surfaceSubtle, borderRadius: radius.quest, padding: space.md, borderWidth: 1, borderColor: colors.border }, style]}>
      <Icon name="info" size={16} color={colors.inkSoft} style={{ marginTop: 1 }} />
      <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
        Quests only count verified meetups — confirmed by the host and at least one attendee, or a group check-in. Swipes, likes and message counts never earn XP. XP is capped at {cap} a day and repeat actions on the same plan only count once.
      </AppText>
    </View>
  );
}

// Header wrapper that lets an XpBurst float above the scroll content.
export function BurstHeader({ children, burst, onDone, top = 120 }) {
  return (
    <View style={{ zIndex: 20, elevation: 20 }}>
      {children}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height: 1, alignItems: 'center', overflow: 'visible' }}>
        <XpBurst amount={burst.amount} burstKey={burst.key} onDone={onDone} />
      </View>
    </View>
  );
}

// Inline, dismissable error for failed actions (claim, freeze…).
export function ActionError({ message, onDismiss, onRetry, retryLabel = 'Retry', style }) {
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.sm }, style]}
    >
      <Icon name="alert-circle" size={16} color={colors.danger} />
      <AppText variant="caption" color={colors.ink} style={{ flex: 1, marginLeft: space.xs }}>
        {message}
      </AppText>
      {onRetry ? (
        <AppText variant="label" color={colors.deep} onPress={onRetry} accessibilityRole="button" suppressHighlighting style={{ marginLeft: space.xs }}>
          {retryLabel}
        </AppText>
      ) : null}
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} style={{ marginLeft: space.xs }}>
          <Icon name="x" size={16} color={colors.inkSoft} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const errorText = (e, fallback = 'Something went wrong. Try again.') => (e && e.message) || fallback;
