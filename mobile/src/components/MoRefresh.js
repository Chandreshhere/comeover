// Pull-to-refresh with Mo. He lives in the gap that opens above the content:
// pulling reveals him (following the finger, on the UI thread), he thinks
// while it refreshes, cheers "Yay!" when it's done, then rides back up with
// the content. No text: Mo's happy hop says it. Screen wires this up for any
// screen with a refreshControl.
import React from 'react';
import { View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import GuideCharacter from '@/features/guide/GuideCharacter';

export const MO_SIZE = 56;

export default function MoRefresh({ scrollY, refreshing, yay }) {
  // d = how far the content is pulled down (scrollY goes negative).
  const style = useAnimatedStyle(() => {
    const d = Math.max(0, -scrollY.value);
    return {
      opacity: interpolate(d, [8, 40], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: d - MO_SIZE - 6 }, { scale: interpolate(d, [0, 72], [0.55, 1], Extrapolation.CLAMP) }],
    };
  });
  const state = yay ? 'happy' : refreshing ? 'think' : 'idle';
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: MO_SIZE, alignItems: 'center' }, style]} accessibilityLiveRegion="polite" accessibilityLabel={yay ? 'Updated' : refreshing ? 'Refreshing' : undefined}>
      <View style={{ width: MO_SIZE, height: MO_SIZE }}>
        <GuideCharacter size={MO_SIZE} state={state} decorative />
      </View>
    </Animated.View>
  );
}
