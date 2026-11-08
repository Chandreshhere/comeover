import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { AppText, Icon, Pictogram, ProgressBar } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';

const ROW = 96;
const NODE = 60;

function Node({ m, onPress }) {
  const reduce = useReducedMotion();
  const bloom = useSharedValue(m.state === 'current' && !reduce ? 0.6 : 1);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (m.state !== 'current' || reduce) return;
    // roadmap_unlock: node blooms in, then a soft ring keeps signalling "you are here".
    bloom.value = withDelay(200, withSpring(1, spring));
    ring.value = withDelay(durations.roadmapUnlock, withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 0 })), -1));
  }, [m.state, reduce]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: bloom.value }] }));
  const r = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - ring.value), transform: [{ scale: 1 + ring.value * 0.5 }] }));

  const done = m.state === 'done';
  const current = m.state === 'current';
  const bg = done ? colors.ink : current ? colors.orange : colors.surface;
  const fg = done ? colors.white : colors.ink;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${m.title}. ${m.subtitle}. ${done ? 'Completed' : current ? 'In progress' : 'Locked'}`}>
      {current && <Animated.View style={[{ position: 'absolute', width: NODE, height: NODE, borderRadius: NODE / 2, backgroundColor: colors.orange }, r]} />}
      <Animated.View
        style={[
          {
            width: NODE,
            height: NODE,
            borderRadius: NODE / 2,
            backgroundColor: bg,
            borderWidth: 3,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: m.state === 'locked' ? 0.7 : 1,
          },
          a,
        ]}
      >
        {m.state === 'locked' ? <Icon name="lock" size={20} color={colors.ink} /> : <Pictogram name={done ? 'check' : m.pictogram} size={28} color={fg} strokeWidth={done ? 3 : 2} />}
      </Animated.View>
    </Pressable>
  );
}

// Multi-stage illustrated journey path. Nodes swing left/right along an S-curve;
// the completed part of the path is solid ink, the rest dashed.
export default function RoadmapPath({ milestones, onPressMilestone }) {
  const [w, setW] = useState(0);
  const xs = milestones.map((_, i) => (i % 2 === 0 ? 0.28 : 0.72) * w);
  const ys = milestones.map((_, i) => i * ROW + NODE / 2);
  const lastDone = milestones.reduce((acc, m, i) => (m.state === 'done' || m.state === 'current' ? i : acc), 0);

  const seg = (i) => {
    const x1 = xs[i];
    const y1 = ys[i];
    const x2 = xs[i + 1];
    const y2 = ys[i + 1];
    return `M${x1} ${y1} C${x1} ${y1 + ROW * 0.55} ${x2} ${y2 - ROW * 0.55} ${x2} ${y2}`;
  };

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: milestones.length * ROW }}>
      {w > 0 && (
        <>
          <Svg width={w} height={milestones.length * ROW} style={{ position: 'absolute' }}>
            {milestones.slice(0, -1).map((_, i) => (
              <Path
                key={i}
                d={seg(i)}
                stroke={colors.ink}
                strokeWidth={i < lastDone ? 4 : 3}
                strokeDasharray={i < lastDone ? undefined : '2 9'}
                strokeLinecap="round"
                fill="none"
                opacity={i < lastDone ? 1 : 0.6}
              />
            ))}
          </Svg>
          {milestones.map((m, i) => {
            const left = i % 2 === 0;
            return (
              <View key={m.id} style={{ position: 'absolute', top: i * ROW, left: xs[i] - NODE / 2 }}>
                <Node m={m} onPress={() => onPressMilestone?.(m)} />
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    width: w * 0.42,
                    ...(left ? { left: NODE + space.sm } : { right: NODE + space.sm }),
                    alignItems: left ? 'flex-start' : 'flex-end',
                  }}
                >
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {m.title}
                  </AppText>
                  <AppText variant="caption" color={colors.inkSoft} numberOfLines={2} align={left ? 'left' : 'right'}>
                    {m.subtitle}
                  </AppText>
                  {m.state === 'current' && m.total ? (
                    <View style={{ width: '90%', marginTop: 6 }}>
                      <ProgressBar value={m.progress / m.total} height={6} track="rgba(255,255,255,0.6)" accessibilityLabel={`${m.progress} of ${m.total}`} />
                      <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 3 }}>
                        {m.progress}/{m.total}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

export const badgeColor = (c) => ({ orange: colors.orange, periwinkle: colors.periwinkle, mint: colors.mint, pink: colors.pink, lavender: colors.lavender }[c] || colors.lavender);

export function Badge({ a, size = 64, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${a.title}. ${a.earned ? 'Earned' : `Locked, ${a.progress || 0} of ${a.total}`}`} style={{ alignItems: 'center', width: size + 20 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: a.earned ? badgeColor(a.color) : colors.surfaceSubtle,
          borderWidth: 3,
          borderColor: a.earned ? colors.ink : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pictogram name={a.pictogram} size={size * 0.46} color={a.earned ? colors.ink : colors.muted} />
      </View>
      <AppText variant="caption" align="center" numberOfLines={1} style={{ marginTop: 6 }}>
        {a.title}
      </AppText>
      {!a.earned && a.total ? (
        <AppText variant="caption" color={colors.muted}>
          {a.progress || 0}/{a.total}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export const roadmapStyles = { radius };
