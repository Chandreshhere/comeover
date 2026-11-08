// "Mo" — Project IRL's original mascot: a pebble-shaped character with a
// sprout antenna, always mid-stride (life happens outside the screen).
// Pure SVG so it ships without binary assets. A Rive version can replace the
// inner <Svg> later without changing call sites (see docs/MOTION.md).
import React, { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';
import { durations, spring } from '../theme/motion';

const STROKE = 4;

const ARMS = {
  stride: {
    front: { d: 'M156 100 C176 92 186 76 192 62', hand: [194, 58] },
    back: { d: 'M78 104 C62 112 50 124 40 128', hand: [36, 130] },
  },
  cheer: {
    front: { d: 'M156 96 C170 82 176 64 178 46', hand: [179, 41] },
    back: { d: 'M80 96 C66 82 60 66 58 50', hand: [57, 45] },
  },
  wave: {
    front: { d: 'M156 100 C176 92 186 76 192 62', hand: [194, 58] },
    back: { d: 'M80 108 C74 122 76 134 82 142', hand: [84, 146] },
  },
};

export function MascotArt({ size = 200, pose = 'stride', accent = colors.orange, showMotionLines = true }) {
  const arms = ARMS[pose] || ARMS.stride;
  return (
    <Svg width={size} height={size * (200 / 220)} viewBox="0 0 220 200" accessibilityElementsHidden>
      {showMotionLines && (
        <G stroke={colors.ink} strokeWidth={3} strokeLinecap="round" opacity={0.55}>
          <Path d="M22 78 L36 78" />
          <Path d="M12 94 L32 94" />
          <Path d="M18 110 L30 110" />
        </G>
      )}
      {/* back leg + shoe */}
      <Path d="M96 142 C84 158 66 166 46 164" stroke={colors.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <Path d="M30 158 C40 152 52 156 54 164 C54 170 46 172 38 172 L28 172 C24 172 22 166 26 162 Z" fill={colors.ink} />
      {/* back arm */}
      <Path d={arms.back.d} stroke={colors.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <Circle cx={arms.back.hand[0]} cy={arms.back.hand[1]} r={7} fill={colors.white} stroke={colors.ink} strokeWidth={STROKE} />
      {/* body */}
      <Path
        d="M70 92 C66 52 98 30 128 36 C160 42 172 74 166 104 C160 134 132 150 104 146 C80 142 72 120 70 92 Z"
        fill={colors.white}
        stroke={colors.ink}
        strokeWidth={STROKE}
      />
      {/* belly patch */}
      <Path d="M92 118 C100 132 124 136 140 126" stroke={colors.ink} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.35} />
      {/* sprout antenna */}
      <Path d="M122 37 C120 24 126 14 136 10" stroke={colors.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M136 10 C146 2 160 6 162 15 C151 21 142 19 136 10 Z" fill={accent} stroke={colors.ink} strokeWidth={2.5} />
      {/* face */}
      <Circle cx={112} cy={96} r={6} fill={colors.pink} opacity={0.9} />
      <Circle cx={158} cy={98} r={6} fill={colors.pink} opacity={0.9} />
      <Ellipse cx={126} cy={80} rx={5} ry={7} fill={colors.ink} />
      <Ellipse cx={148} cy={82} rx={5} ry={7} fill={colors.ink} />
      <Circle cx={127.5} cy={77.5} r={1.6} fill={colors.white} />
      <Circle cx={149.5} cy={79.5} r={1.6} fill={colors.white} />
      <Path d="M126 99 C132 108 143 108 149 100" stroke={colors.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
      {/* front leg + shoe */}
      <Path d="M134 142 C142 160 156 172 172 175" stroke={colors.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <Path d="M168 166 C180 162 196 166 198 177 C198 184 190 186 180 186 L168 186 C163 186 161 180 164 173 Z" fill={colors.ink} />
      <Path d="M172 178 L190 178" stroke={colors.white} strokeWidth={2} strokeLinecap="round" />
      {/* front arm */}
      <Path d={arms.front.d} stroke={colors.ink} strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <Circle cx={arms.front.hand[0]} cy={arms.front.hand[1]} r={7} fill={colors.white} stroke={colors.ink} strokeWidth={STROKE} />
    </Svg>
  );
}

// Animated wrapper. `mood="idle"` floats gently; `mood="celebrate"` jumps once
// (mascot_success pattern). Reduce Motion => static.
export default function Mascot({ size = 200, pose, mood = 'idle', accent, style, celebrateKey }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  const rot = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    if (mood === 'idle') {
      const half = durations.mascotIdle / 2;
      y.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: half, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: half, easing: Easing.inOut(Easing.sin) })
        ),
        -1
      );
      rot.value = withRepeat(
        withSequence(withTiming(-1.5, { duration: half }), withTiming(1.5, { duration: half })),
        -1,
        true
      );
    }
  }, [mood, reduce]);

  useEffect(() => {
    if (reduce || celebrateKey == null) return;
    y.value = withSequence(withTiming(-28, { duration: 220, easing: Easing.out(Easing.quad) }), withSpring(0, spring));
  }, [celebrateKey, reduce]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { rotate: `${rot.value}deg` }],
  }));

  return (
    <Animated.View style={[animStyle, style]} accessible accessibilityRole="image" accessibilityLabel="Mo, the Project IRL mascot">
      <MascotArt size={size} pose={mood === 'celebrate' ? 'cheer' : pose} accent={accent} />
    </Animated.View>
  );
}
