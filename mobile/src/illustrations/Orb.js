// Plan Assistant focal visual: an original wireframe "globe" of light that
// slowly turns and breathes. When `listening` it pulses faster.
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, RadialGradient, Stop } from 'react-native-svg';

const RINGS = [0, 30, 60, 90, 120, 150];

function Layer({ size, tilt, opacity }) {
  const r = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G opacity={opacity} transform={`rotate(${tilt} ${r} ${r})`}>
        {RINGS.map((deg) => (
          <Ellipse
            key={deg}
            cx={r}
            cy={r}
            rx={r * 0.86}
            ry={r * 0.32}
            stroke="#FFFFFF"
            strokeWidth={1.4}
            fill="none"
            transform={`rotate(${deg} ${r} ${r})`}
          />
        ))}
      </G>
    </Svg>
  );
}

export default function Orb({ size = 180, listening = false }) {
  const reduce = useReducedMotion();
  const spin = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (reduce) return;
    spin.value = 0;
    spin.value = withRepeat(withTiming(360, { duration: listening ? 6000 : 16000, easing: Easing.linear }), -1);
    breathe.value = withRepeat(
      withSequence(
        withTiming(listening ? 1.08 : 1.04, { duration: listening ? 500 : 1300 }),
        withTiming(1, { duration: listening ? 500 : 1300 })
      ),
      -1
    );
  }, [listening, reduce]);

  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }, { scale: breathe.value }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 0.6}deg` }, { scale: breathe.value }] }));

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={listening ? 'Assistant is listening' : 'Assistant'}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size * 0.42} fill="url(#orbGlow)" />
      </Svg>
      <Animated.View style={[{ position: 'absolute' }, a]}>
        <Layer size={size * 0.9} tilt={-20} opacity={0.85} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute' }, b]}>
        <Layer size={size * 0.72} tilt={35} opacity={0.6} />
      </Animated.View>
      {/* sparkle dots */}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {[
          [0.12, 0.2, 2],
          [0.85, 0.18, 2.5],
          [0.9, 0.7, 1.6],
          [0.2, 0.82, 2.2],
          [0.7, 0.9, 1.4],
        ].map(([x, y, r], i) => (
          <Circle key={i} cx={x * size} cy={y * size} r={r} fill="#FFFFFF" opacity={0.85} />
        ))}
      </Svg>
    </View>
  );
}
