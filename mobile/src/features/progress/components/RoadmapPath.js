// Social roadmap journey. A winding trail of milestone nodes runs down a
// left-hand lane and every milestone's text sits in its own card to the right
// (white cards on the canvas),
// so the trail never crosses a label — for any number of milestones, any text
// length and on 320pt-wide phones.
//   done    → filled node with a check, solid trail leading into it
//   current → bigger node with a pulsing ring, "You're here" tag + progress
//   locked  → muted node with a lock, dotted trail
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
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
import { AppText, Icon, Pictogram, ProgressBar, ProgressRing, usePressScale } from '@/components';
import { colors, inkAlpha, radius, shadow, space } from '@/theme/tokens';
import { durations, enter, fadeIn, spring } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const NODE = 48;
const NODE_CURRENT = 60;
const ROW_GAP = space.sm;
// Lane offsets per row: centre, left, centre, right… a gentle winding trail.
const WAVE = [0, -1, 0, 1];

const nodeSize = (m) => (m.state === 'current' ? NODE_CURRENT : NODE);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function TrailNode({ m, size }) {
  const reduce = useReducedMotion();
  const current = m.state === 'current';
  const done = m.state === 'done';
  const pop = useSharedValue(current && !reduce ? 0.6 : 1);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!current || reduce) return;
    // roadmap_unlock: the node blooms in, then a soft ring keeps pulsing "you are here".
    pop.value = withDelay(200, withSpring(1, spring));
    ring.value = withDelay(
      durations.roadmapUnlock,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 })
        ),
        -1
      )
    );
  }, [current, reduce]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduce ? 0.3 : 0.5 * (1 - ring.value),
    transform: [{ scale: reduce ? 1.16 : 1 + ring.value * 0.32 }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {current && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: colors.orange },
            ringStyle,
          ]}
        />
      )}
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: done ? colors.ink : current ? colors.orange : colors.surface,
            // Done nodes get a "sticker" rim so they read apart from the solid trail.
            borderWidth: current ? 3 : done ? 3 : 2,
            borderColor: current ? colors.ink : done ? colors.surface : colors.border,
          },
          current && shadow.card,
          popStyle,
        ]}
      >
        {done ? (
          <Icon name="check" size={22} color={colors.white} weight="bold" />
        ) : current ? (
          <Pictogram name={m.pictogram || 'sparkle'} size={28} color={colors.ink} />
        ) : (
          <Icon name="lock" size={18} color={colors.muted} weight="duotone" />
        )}
      </Animated.View>
    </View>
  );
}

function MilestoneRow({ m, index, x, lane, onPress, onLayout }) {
  const press = usePressScale(0.98);
  const size = nodeSize(m);
  const done = m.state === 'done';
  const current = m.state === 'current';
  const locked = !done && !current;
  const total = Number(m.total) || 0;
  const prog = Math.min(Number(m.progress) || 0, total);
  const unit = m.xp != null ? ' XP' : '';
  const showProgress = current && total > 0;
  const a11y = `${m.title}. ${m.subtitle ? `${m.subtitle}. ` : ''}${
    done ? 'Completed' : current ? `You're here${showProgress ? `, ${prog} of ${total}${unit}` : ''}` : 'Locked'
  }`;

  return (
    <Animated.View entering={enter(index)} onLayout={onLayout}>
      <AnimatedPressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={[{ flexDirection: 'row', alignItems: 'center' }, press.style]}
      >
        {/* Trail lane: the node sits on the winding line. */}
        <View style={{ width: lane, height: size }}>
          <View style={{ position: 'absolute', left: x - size / 2 }}>
            <TrailNode m={m} size={size} />
          </View>
        </View>

        {/* Text card, always clear of the trail. */}
        <View
          style={[
            {
              flex: 1,
              minHeight: size,
              marginLeft: space.xs,
              borderRadius: radius.quest,
              paddingHorizontal: space.sm,
              paddingVertical: 10,
              justifyContent: 'center',
            },
            current
              ? [{ backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink }, shadow.card]
              : done
              ? { backgroundColor: colors.surface }
              : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: inkAlpha(0.18) },
          ]}
        >
          {current ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'flex-start',
                backgroundColor: colors.ink,
                borderRadius: radius.pill,
                paddingHorizontal: 8,
                paddingVertical: 3,
                marginBottom: 6,
              }}
            >
              <Icon name="map-pin" size={11} color={colors.white} weight="fill" />
              <AppText variant="caption" color={colors.white} style={{ marginLeft: 4 }}>
                You're here
              </AppText>
            </View>
          ) : null}
          <AppText variant="bodyStrong" numberOfLines={2} color={locked ? colors.inkSoft : colors.ink}>
            {m.title}
          </AppText>
          {m.subtitle ? (
            <AppText variant="caption" numberOfLines={2} color={locked ? colors.muted : colors.inkSoft} style={{ marginTop: 2 }}>
              {m.subtitle}
            </AppText>
          ) : null}
          {showProgress ? (
            <View style={{ marginTop: space.xs }}>
              <ProgressBar value={prog / total} height={6} accessibilityLabel={`${prog} of ${total}${unit}`} />
              <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
                {prog}/{total}
                {unit}
              </AppText>
            </View>
          ) : null}
          {locked && total > 0 && m.xp != null ? (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xxs }}>
              Unlocks at {total} XP
            </AppText>
          ) : null}
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function RoadmapPath({ milestones, onPressMilestone }) {
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [rows, setRows] = useState({}); // id -> { y, h } of each measured row

  const lane = clamp(Math.round(w * 0.27), 76, 100);
  const amp = (lane - NODE) / 2;
  const xs = milestones.map((m, i) => {
    const size = nodeSize(m);
    return clamp(lane / 2 + WAVE[i % WAVE.length] * amp, size / 2, lane - size / 2);
  });

  const measure = useCallback((id, e) => {
    const { y, height } = e.nativeEvent.layout;
    setRows((r) => (r[id] && r[id].y === y && r[id].h === height ? r : { ...r, [id]: { y, h: height } }));
  }, []);

  // Trail segments run centre-to-centre between consecutive nodes, inside the
  // lane only (vertical tangents keep the curve between the two node x's).
  const segments = [];
  for (let i = 0; i < milestones.length - 1; i++) {
    const a = rows[milestones[i].id];
    const b = rows[milestones[i + 1].id];
    if (!a || !b) continue;
    const y1 = a.y + a.h / 2;
    const y2 = b.y + b.h / 2;
    const ym = (y1 + y2) / 2;
    segments.push({
      key: milestones[i].id,
      d: `M${xs[i]} ${y1} C${xs[i]} ${ym} ${xs[i + 1]} ${ym} ${xs[i + 1]} ${y2}`,
      reached: milestones[i + 1].state !== 'locked',
    });
  }

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={{ gap: ROW_GAP }}>
          {h > 0 && segments.length > 0 && (
            <Animated.View
              entering={fadeIn(150)}
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, top: 0 }}
            >
              <Svg width={lane} height={h}>
                {/* soft "road" under the whole trail */}
                {segments.map((s) => (
                  <Path
                    key={`road-${s.key}`}
                    d={s.d}
                    stroke={inkAlpha(0.07)}
                    strokeWidth={16}
                    strokeLinecap="round"
                    fill="none"
                  />
                ))}
                {segments.map((s) =>
                  s.reached ? (
                    <Path key={s.key} d={s.d} stroke={colors.ink} strokeWidth={5} strokeLinecap="round" fill="none" />
                  ) : (
                    <Path
                      key={s.key}
                      d={s.d}
                      stroke={inkAlpha(0.32)}
                      strokeWidth={4}
                      strokeDasharray="0.1 10"
                      strokeLinecap="round"
                      fill="none"
                    />
                  )
                )}
              </Svg>
            </Animated.View>
          )}
          {milestones.map((m, i) => (
            <MilestoneRow
              key={m.id}
              m={m}
              index={i}
              x={xs[i]}
              lane={lane}
              onPress={() => onPressMilestone?.(m)}
              onLayout={(e) => measure(m.id, e)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// Function so badge colours follow the live light/dark palette.
export const badgeColor = (c) =>
  ({
    orange: colors.orange,
    periwinkle: colors.periwinkle,
    mint: colors.mint,
    pink: colors.pink,
    lavender: colors.lavender,
  }[c] || colors.lavender);

// Achievement badge: pastel medallion when earned, muted with a progress ring
// while in progress. Title is held to two lines so rows of badges stay
// aligned; `width` defaults to the medallion, pass '100%' to fill a grid cell.
export function Badge({ a, size = 64, width, onPress }) {
  const earned = !!a.earned;
  const total = Number(a.total) || 0;
  const prog = Math.min(Number(a.progress) || 0, total);
  const ringSize = size + 12;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a.title}. ${earned ? 'Earned' : total ? `In progress, ${prog} of ${total}` : 'Locked'}`}
      style={{ alignItems: 'center', width: width || ringSize + 16 }}
    >
      <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
        {!earned && total > 0 ? (
          <View style={{ position: 'absolute' }}>
            <ProgressRing value={prog / total} size={ringSize} stroke={4} color={colors.deep} track={colors.track} />
          </View>
        ) : null}
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: earned ? badgeColor(a.color) : colors.surfaceSubtle,
            borderWidth: earned ? 2.5 : 1.5,
            borderColor: earned ? colors.ink : colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Pictogram name={a.pictogram} size={Math.round(size * 0.46)} color={earned ? colors.ink : colors.muted} />
        </View>
      </View>
      <AppText variant="label" align="center" numberOfLines={2} style={{ marginTop: 6, minHeight: 32 }}>
        {a.title}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
        {earned ? 'Earned' : total ? `${prog}/${total}` : 'Locked'}
      </AppText>
    </Pressable>
  );
}
