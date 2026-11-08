import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import { Pictogram } from '@/illustrations/Pictograms';
import AppText from './AppText';
import Icon from './Icon';

// state: done | today | today_done | rest | freeze | future | missed
function Dot({ state, pulseKey }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (reduce || state !== 'today_done') return;
    s.value = withSequence(withTiming(1.25, { duration: durations.streak / 2 }), withSpring(1, spring));
  }, [pulseKey, state, reduce]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  const base = { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' };
  let content = null;
  let style = {};
  switch (state) {
    case 'done':
      style = { backgroundColor: colors.ink };
      content = <Pictogram name="check" size={16} color={colors.white} strokeWidth={3} />;
      break;
    case 'today_done':
      style = { backgroundColor: colors.orange, borderWidth: 2, borderColor: colors.ink };
      content = <Pictogram name="check" size={16} color={colors.ink} strokeWidth={3} />;
      break;
    case 'today':
      style = { backgroundColor: colors.orange };
      content = <Pictogram name="sparkle" size={14} color={colors.ink} />;
      break;
    case 'rest':
      style = { backgroundColor: colors.lavender };
      content = <AppText variant="caption" color={colors.inkSoft}>z</AppText>;
      break;
    case 'freeze':
      style = { backgroundColor: colors.periwinkleWash, borderWidth: 1.5, borderColor: colors.deep };
      content = <Icon name="shield" size={13} color={colors.deep} />;
      break;
    case 'missed':
      style = { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border };
      break;
    default:
      style = { backgroundColor: colors.surfaceSubtle, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' };
  }
  return <Animated.View style={[base, style, a]}>{content}</Animated.View>;
}

const LABEL = {
  done: 'activity done',
  today_done: 'today, activity done',
  today: 'today',
  rest: 'rest day',
  freeze: 'streak freeze used',
  missed: 'no activity',
  future: 'upcoming',
};

// The white pill week strip from the reference roadmap screen.
export default function WeekStrip({ days = [], pulseKey, style }) {
  return (
    <View
      accessible
      accessibilityLabel={`This week: ${days.map((d) => `${d.label} ${LABEL[d.state] || ''}`).join(', ')}`}
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: space.sm, paddingHorizontal: space.xs, flexDirection: 'row', justifyContent: 'space-between' },
        style,
      ]}
    >
      {days.map((d) => (
        <View key={d.label} style={{ alignItems: 'center', flex: 1 }}>
          <AppText variant="caption" color={d.state?.startsWith('today') ? colors.ink : colors.muted} style={{ marginBottom: 6, fontFamily: d.state?.startsWith('today') ? 'Poppins-Bold' : undefined }}>
            {d.label}
          </AppText>
          <Dot state={d.state} pulseKey={pulseKey} />
        </View>
      ))}
    </View>
  );
}
