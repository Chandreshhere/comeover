import React, { useEffect } from 'react';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming, withDelay } from 'react-native-reanimated';
import { AppText } from '@/components';
import { colors, radius } from '@/theme/tokens';
import { durations } from '@/theme/motion';

// quest_complete / mascot_success: an XP chip pops and floats up toward the level meter.
export default function XpBurst({ amount, burstKey, onDone, style }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  const o = useSharedValue(0);
  const s = useSharedValue(0.6);

  useEffect(() => {
    if (!burstKey) return;
    if (reduce) {
      o.value = withSequence(withTiming(1, { duration: 1 }), withDelay(900, withTiming(0, { duration: 150 }, (f) => f && onDone && runOnJS(onDone)())));
      return;
    }
    y.value = 0;
    s.value = 0.6;
    o.value = withSequence(withTiming(1, { duration: durations.micro }), withDelay(durations.questComplete, withTiming(0, { duration: durations.standard }, (f) => f && onDone && runOnJS(onDone)())));
    s.value = withTiming(1, { duration: durations.standard });
    y.value = withTiming(-70, { duration: durations.questComplete + durations.standard });
  }, [burstKey]);

  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }, { scale: s.value }] }));
  if (!burstKey) return null;
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[{ position: 'absolute', alignSelf: 'center', backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 }, a, style]}>
      <AppText variant="bodyStrong" color={colors.white}>
        +{amount} XP
      </AppText>
    </Animated.View>
  );
}
