import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { HourglassMedium } from 'phosphor-react-native/src/icons/HourglassMedium';
import { Queue } from 'phosphor-react-native/src/icons/Queue';
import { colors, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import haptics from '@/utils/haptics';
import AppText from './AppText';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// `icon` is an app icon name, `glyph` a Phosphor component (outside the map).
const LABELS = {
  idle: { text: 'Join' },
  requested: { text: 'Request sent', glyph: HourglassMedium },
  accepted: { text: 'Joined', icon: 'check' },
  waitlisted: { text: 'Waitlisted', glyph: Queue },
  full: { text: 'Full' },
};

// activity_card_join motion: label morphs Join → Request sent → Joined with a
// spring scale. Never delays navigation; purely a state indicator.
export default function JoinButton({ state = 'idle', onPress, size = 'sm', idleLabel = 'Join', caps = true, style }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const c = useSharedValue(state === 'idle' || state === 'full' ? 0 : 1);

  useEffect(() => {
    c.value = withTiming(state === 'idle' || state === 'full' ? 0 : 1, { duration: durations.join });
    if (!reduce && state !== 'idle') {
      s.value = withSequence(withTiming(0.94, { duration: durations.micro }), withSpring(1, spring));
    }
  }, [state]);

  // Read the live palette on the JS side; the worklet only sees plain strings.
  const from = colors.ink;
  const to = colors.white;
  const a = useAnimatedStyle(
    () => ({
      transform: [{ scale: s.value }],
      backgroundColor: interpolateColor(c.value, [0, 1], [from, to]),
    }),
    [from, to]
  );

  const l = LABELS[state] || LABELS.idle;
  const text = state === 'idle' ? idleLabel : l.text;
  const fg = state === 'idle' || state === 'full' ? colors.white : colors.ink;
  const height = size === 'sm' ? 38 : 48;
  const Glyph = l.glyph;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: state !== 'idle' }}
      disabled={state === 'full'}
      onPress={() => {
        haptics.medium();
        onPress?.();
      }}
      onPressIn={() => {
        s.value = withTiming(0.94, { duration: durations.micro });
      }}
      onPressOut={() => {
        s.value = withSpring(1, spring);
      }}
      hitSlop={(44 - height) / 2 > 0 ? (44 - height) / 2 : 0}
      style={[
        {
          height,
          borderRadius: radius.pill,
          paddingHorizontal: size === 'sm' ? space.md : space.xl,
          alignItems: 'center',
          justifyContent: 'center',
          // Always used inside rows: centre on the row's cross axis so the
          // button lines up with the text beside it (flex-start sat it high).
          alignSelf: 'center',
          flexShrink: 0,
          borderWidth: 1.2,
          borderColor: colors.ink,
          opacity: state === 'full' ? 0.4 : 1,
        },
        a,
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {state !== 'idle' && Glyph ? <Glyph size={14} color={fg} weight="bold" style={{ marginRight: space.xxs + 2 }} /> : null}
        {state !== 'idle' && !Glyph && l.icon ? <Icon name={l.icon} size={14} color={fg} style={{ marginRight: space.xxs + 2 }} /> : null}
        <AppText variant="button" color={fg} caps={caps} numberOfLines={1}>
          {text}
        </AppText>
      </View>
    </AnimatedPressable>
  );
}
