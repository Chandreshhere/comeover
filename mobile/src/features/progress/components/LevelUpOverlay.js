// level_up: full-screen milestone moment. Skippable at any time, motion
// finishes in ~1.1s, and Reduce Motion shows the same content statically.
import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, Mascot } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import sfx from '@/services/sfx';

// Confetti geometry only — colours are read from the live palette at render.
const dotColors = () => [colors.ink, colors.orange, colors.pureWhite, colors.pink, colors.mint];
const DOTS = Array.from({ length: 14 }, (_, i) => ({ angle: (i / 14) * Math.PI * 2, dist: 110 + (i % 3) * 30, size: 8 + (i % 3) * 3 }));

function Dot({ d, color, play }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (play) p.value = withTiming(1, { duration: durations.celebration, easing: Easing.out(Easing.cubic) });
  }, [play]);
  const a = useAnimatedStyle(() => ({
    opacity: 1 - p.value * 0.9,
    transform: [{ translateX: Math.cos(d.angle) * d.dist * p.value }, { translateY: Math.sin(d.angle) * d.dist * p.value }, { scale: 0.6 + p.value * 0.6 }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: d.size, height: d.size, borderRadius: d.size / 2, backgroundColor: color }, a]} />;
}

export default function LevelUpOverlay({ visible, level, onClose }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const badge = useSharedValue(reduce ? 1 : 0.4);
  const [key, setKey] = useState(null);

  useEffect(() => {
    if (!visible) return;
    sfx.play('chime');
    setKey(Date.now());
    if (!reduce) {
      badge.value = 0.4;
      badge.value = withDelay(250, withSpring(1, spring));
    }
  }, [visible, reduce]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  if (!level) return null;
  const palette = dotColors();
  return (
    <Modal visible={visible} animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.periwinkle, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg, paddingHorizontal: layout.screenPadding }} accessibilityViewIsModal>
        <Button title="Skip" variant="ghost" size="sm" full={false} align="end" onPress={onClose} accessibilityLabel="Skip celebration" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {!reduce && DOTS.map((d, i) => <Dot key={i} d={d} color={palette[i % palette.length]} play={!!key} />)}
            <Mascot size={190} mood="celebrate" celebrateKey={key} />
          </View>
          <Animated.View style={[{ marginTop: space.lg, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xxs }, badgeStyle]}>
            <AppText variant="label" color={colors.white}>
              Level {level.level}
            </AppText>
          </Animated.View>
          <AppText variant="display" align="center" style={{ marginTop: space.sm }} accessibilityRole="header" accessibilityLiveRegion="polite">
            Level up!
          </AppText>
          <AppText variant="h3" align="center" style={{ marginTop: space.xxs }}>
            You've reached {level.name}
          </AppText>
          <AppText align="center" color={colors.inkSoft} style={{ marginTop: space.xs, maxWidth: 300 }}>
            Earned through real meetups.
          </AppText>
        </View>
        <Button title="Keep going" onPress={onClose} />
      </View>
    </Modal>
  );
}
