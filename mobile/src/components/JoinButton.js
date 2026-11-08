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
import { colors, radius } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import haptics from '@/utils/haptics';
import AppText from './AppText';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const LABELS = {
  idle: { text: 'Join', icon: null },
  requested: { text: 'Request sent', icon: 'clock' },
  accepted: { text: 'Joined', icon: 'check' },
  waitlisted: { text: 'Waitlisted', icon: 'list' },
  full: { text: 'Full', icon: null },
};

// activity_card_join motion: label morphs Join → Request sent → Joined with a
// spring scale. Never delays navigation; purely a state indicator.
export default function JoinButton({ state = 'idle', onPress, size = 'sm', idleLabel = 'Join', caps = true, style }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const c = useSharedValue(state === 'idle' ? 0 : 1);

  useEffect(() => {
    c.value = withTiming(state === 'idle' || state === 'full' ? 0 : 1, { duration: durations.join });
    if (!reduce && state !== 'idle') {
      s.value = withSequence(withTiming(0.94, { duration: durations.micro }), withSpring(1, spring));
    }
  }, [state]);

  const a = useAnimatedStyle(() => ({
    transform: [{ scale: s.value }],
    backgroundColor: interpolateColor(c.value, [0, 1], [colors.ink, colors.white]),
  }));

  const l = LABELS[state] || LABELS.idle;
  const text = state === 'idle' ? idleLabel : l.text;
  const fg = state === 'idle' || state === 'full' ? colors.white : colors.ink;
  const height = size === 'sm' ? 38 : 48;

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
      hitSlop={(44 - height) / 2 > 0 ? (44 - height) / 2 : 0}
      style={[
        {
          height,
          borderRadius: radius.pill,
          paddingHorizontal: size === 'sm' ? 18 : 26,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          borderWidth: 1.2,
          borderColor: colors.ink,
          opacity: state === 'full' ? 0.4 : 1,
        },
        a,
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {l.icon && state !== 'idle' && <Icon name={l.icon} size={14} color={fg} style={{ marginRight: 6 }} />}
        <AppText variant="button" color={fg} caps={caps}>
          {text}
        </AppText>
      </View>
    </AnimatedPressable>
  );
}
