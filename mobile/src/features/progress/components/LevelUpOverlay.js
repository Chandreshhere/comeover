// level_up: full-screen milestone moment. Skippable at any time, motion
// finishes in ~1.1s, and Reduce Motion shows the same content statically.
import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, Mascot } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';

const DOT_COLORS = [colors.ink, colors.orange, colors.white, colors.pink, colors.mint];
const DOTS = Array.from({ length: 14 }, (_, i) => ({ angle: (i / 14) * Math.PI * 2, dist: 110 + (i % 3) * 30, size: 8 + (i % 3) * 3, color: DOT_COLORS[i % DOT_COLORS.length] }));

function Dot({ d, play }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (play) p.value = withTiming(1, { duration: durations.celebration, easing: Easing.out(Easing.cubic) });
  }, [play]);
  const a = useAnimatedStyle(() => ({
    opacity: 1 - p.value * 0.9,
    transform: [{ translateX: Math.cos(d.angle) * d.dist * p.value }, { translateY: Math.sin(d.angle) * d.dist * p.value }, { scale: 0.6 + p.value * 0.6 }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: d.size, height: d.size, borderRadius: d.size / 2, backgroundColor: d.color }, a]} />;
}

export default function LevelUpOverlay({ visible, level, onClose }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const badge = useSharedValue(reduce ? 1 : 0.4);
  const [key, setKey] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setKey(Date.now());
    if (!reduce) {
      badge.value = 0.4;
      badge.value = withDelay(250, withSpring(1, spring));
    }
  }, [visible, reduce]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  if (!level) return null;
  return (
    <Modal visible={visible} animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.periwinkle, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg, paddingHorizontal: layout.screenPadding }} accessibilityViewIsModal>
        <View style={{ alignItems: 'flex-end' }}>
          <Button title="Skip" variant="ghost" size="sm" full={false} onPress={onClose} accessibilityLabel="Skip celebration" />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {!reduce && DOTS.map((d, i) => <Dot key={i} d={d} play={!!key} />)}
            <Mascot size={210} mood="celebrate" celebrateKey={key} />
          </View>
          <Animated.View style={[{ marginTop: space.lg, width: 88, height: 88, borderRadius: 44, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white }, badgeStyle]}>
            <AppText variant="display" color={colors.white}>
              {level.level}
            </AppText>
          </Animated.View>
          <AppText variant="display" align="center" style={{ marginTop: space.md }} accessibilityRole="header" accessibilityLiveRegion="polite">
            Level up!
          </AppText>
          <AppText variant="h2" align="center">
            You're now a {level.name}
          </AppText>
          <View style={{ backgroundColor: colors.glass, borderRadius: radius.card, padding: space.md, marginTop: space.lg, maxWidth: 340 }}>
            <AppText align="center" color={colors.inkSoft}>
              Earned through real meetups — not screen time. A new stop on your roadmap is unlocked.
            </AppText>
          </View>
        </View>
        <Button title="Keep going" onPress={onClose} />
      </View>
    </Modal>
  );
}
