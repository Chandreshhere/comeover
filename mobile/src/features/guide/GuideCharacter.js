// Mo — Come Over's guide character.
//
// A chubby periwinkle bean with a sprout, big blinking eyes and stubby arms.
// Drawn with react-native-svg and animated with Reanimated: every motion
// (breathing, blinking, glancing, talking, waving, hopping, tilting) runs on
// the UI thread. Each moving part is its own full-size layer so plain View
// transforms do the animating — no SVG transform props to fight with.
//
//   <GuideCharacter state="idle" | "talk" | "wave" | "happy" | "think"
//                   size={160} talking={bool} hopKey={any} still={bool} />
//
//   state    the pose / mood.
//   talking  mouth chatter on top of any state (e.g. wave while speaking).
//            state="talk" is the same as state="idle" + talking.
//   hopKey   change it to make Mo hop (celebrations). When set, entering
//            'happy' no longer hops on its own — the key drives the hops.
//   autoHop  false = never hop on entering 'happy' (only on hopKey changes).
//   still    render a static pose: no loops, no timers (lists, empty states).
//
// ─────────────────────────────────────────────────────────────────────────
// Swapping in the Rive character
// ─────────────────────────────────────────────────────────────────────────
// The props above are the whole contract, so a Rive file can replace the SVG
// body without touching any call site (Mascot, the intro, the app tour):
//
//   1. npm i rive-react-native && cd ios && pod install. Put the file in
//      android/app/src/main/res/raw/mo.riv and add mo.riv to the iOS app
//      target (Copy Bundle Resources).
//   2. In the .riv, build one state machine (e.g. "Guide") with inputs:
//        number  state   0 idle · 1 talk · 2 wave · 3 happy · 4 think
//        boolean talking mouth flaps while true
//        trigger hop     one celebratory hop
//      Blinking, glancing and breathing belong inside the Rive idle states.
//   3. Replace the body of GuideCharacter with:
//
//        import Rive, { Fit } from 'rive-react-native';
//        const STATE_INDEX = { idle: 0, talk: 1, wave: 2, happy: 3, think: 4 };
//        const ref = useRef(null);
//        useEffect(() => { ref.current?.setInputState('Guide', 'state', STATE_INDEX[state] ?? 0); }, [state]);
//        useEffect(() => { ref.current?.setInputState('Guide', 'talking', !!(talking || state === 'talk')); }, [talking, state]);
//        useEffect(() => { if (hopKey != null) ref.current?.fireState('Guide', 'hop'); }, [hopKey]);
//        return (
//          <View style={[{ width: size, height: size }, style]} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
//            <Rive ref={ref} resourceName="mo" stateMachineName="Guide" fit={Fit.Contain} style={{ width: size, height: size }} autoplay={!still} />
//          </View>
//        );
//
//   Keep this SVG version as the fallback for `still` renders (long lists)
//   if Rive instances get heavy. The voice (services/voice.js) already drives
//   `talking`, so lip-flap timing carries over unchanged.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { colors } from '@/theme/tokens';
import { lipLevel, lipOn } from '@/services/voice';

export const GUIDE_NAME = 'Mo';
export const GUIDE_STATES = ['idle', 'talk', 'wave', 'happy', 'think', 'sad'];

// Mo's own palette. Deliberately the same in light and dark mode (a character
// keeps its identity) and flat: solid fills only, no gradients. Only the ground shadow follows the
// scheme. Read at render time like every other colour.
const palette = (leaf) => ({
  body: '#FFFFFF', // Mo is white: one flat colour, no gradients anywhere in the app
  line: '#C9D2FF', // soft lavender outline so he still reads on white cards
  belly: '#F1F3FF',
  arm: '#FFFFFF',
  hand: '#FFFFFF',
  foot: '#C9D2FF',
  eyeWhite: colors.pureWhite,
  pupil: '#1D2142',
  mouth: '#E25A82',
  tongue: '#FFC2D3',
  cheek: '#FFA9C6',
  leaf: leaf || '#63CF95',
  leafDark: '#3FAF76',
  stem: '#3FAF76',
  shadow: colors.pureBlack,
});

// A tapered limb from (x1,y1) to (x2,y2) ending in a round mitten hand with a
// small thumb on the body side. thumb = +1 / -1 picks which side.
function limbPath(x1, y1, x2, y2, r1, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const P = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M${P(x1 + nx * r1, y1 + ny * r1)} L${P(x2 + nx * r2, y2 + ny * r2)} A${r2} ${r2} 0 0 0 ${P(
    x2 - nx * r2,
    y2 - ny * r2
  )} L${P(x1 - nx * r1, y1 - ny * r1)} A${r1} ${r1} 0 0 0 ${P(x1 + nx * r1, y1 + ny * r1)} Z`;
}
function handGeom(x1, y1, x2, y2, thumb) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * thumb;
  const ny = ux * thumb;
  const hx = x2 + ux * 3;
  const hy = y2 + uy * 3;
  return { hx, hy, tx: hx + nx * 8.5 - ux * 3.5, ty: hy + ny * 8.5 - uy * 3.5 };
}

const POSES = {
  idle: { armL: 0, armR: 0, tilt: 0, happy: 0, brow: 0, smile: 1, lookX: 0, lookY: 0 },
  talk: { armL: 0, armR: 0, tilt: 0, happy: 0, brow: -1, smile: 1, lookX: 0, lookY: 0 },
  wave: { armL: 0, armR: -102, tilt: 3, happy: 0, brow: -2, smile: 1, lookX: 0, lookY: 0 },
  happy: { armL: 105, armR: -105, tilt: 0, happy: 1, brow: -3, smile: 1, lookX: 0, lookY: 0 },
  think: { armL: 0, armR: 0, tilt: -6, happy: 0, brow: -4, smile: 0.5, lookX: 3, lookY: -4 },
  // Offline / something went wrong: droopy arms, head down, frown and a tear.
  sad: { armL: 14, armR: -14, tilt: -4, happy: 0, brow: 3, smile: 0, lookX: 0, lookY: 3.5 },
};

const SOFT = { damping: 14, stiffness: 170, mass: 0.8 };
const BOUNCY = { damping: 9, stiffness: 170, mass: 0.7 };
const sine = Easing.inOut(Easing.sin);

// Static geometry (viewBox 0 0 200 200).
const BODY = 'M100 44 C140 44 162 80 163 120 C164 158 138 181 100 181 C62 181 36 158 37 120 C38 80 60 44 100 44 Z';
// Small, high and pink: a big dark mouth read as a hole in Mo's tummy.
const OPEN_MOUTH = 'M91.5 116 Q100 115 108.5 116 Q107.5 127.5 100 128.5 Q92.5 127.5 91.5 116 Z';

const fill = StyleSheet.absoluteFillObject;

export default function GuideCharacter({
  state = 'idle',
  size = 160,
  talking = false,
  hopKey,
  autoHop = true,
  still = false,
  leaf,
  outline = false,
  style,
  accessibilityLabel = `${GUIDE_NAME}, the Come Over guide`,
  decorative = false,
}) {
  const reduce = useReducedMotion();
  const k = size / 200;
  const pose = POSES[state] || POSES.idle;
  const animate = !still && !reduce;
  const talkingNow = !!talking || state === 'talk';

  // ── shared values (start in the pose so `still` renders are correct) ──
  const breathe = useSharedValue(0);
  const hopY = useSharedValue(0);
  const squash = useSharedValue(0);
  const tilt = useSharedValue(pose.tilt);
  const armL = useSharedValue(pose.armL);
  const armR = useSharedValue(pose.armR);
  const blink = useSharedValue(1);
  const lookX = useSharedValue(pose.lookX);
  const lookY = useSharedValue(pose.lookY);
  const happyEyes = useSharedValue(pose.happy);
  const brow = useSharedValue(pose.brow);
  const smileX = useSharedValue(pose.smile);
  const talkMix = useSharedValue(talkingNow || state === 'happy' ? 1 : 0);
  const sadMix = useSharedValue(state === 'sad' ? 1 : 0);
  const talkPhase = useSharedValue(0); // 0→1 loop while talking: head bob + tilt rhythm
  const gesture = useSharedValue(0); // explaining-hand gesture while talking
  const tear = useSharedValue(0);
  const mouth = useSharedValue(state === 'happy' ? 0.8 : talkingNow ? 0.6 : 0.3);
  const sprout = useSharedValue(0);

  const hop = (times = 1) => {
    const ups = [];
    const squ = [];
    for (let i = 0; i < times; i++) {
      ups.push(
        withTiming(0, { duration: 100 }),
        withTiming(-28, { duration: 230, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) })
      );
      squ.push(
        withTiming(0.12, { duration: 100 }),
        withTiming(-0.08, { duration: 120 }),
        withTiming(0, { duration: 240 }),
        withTiming(0.14, { duration: 80 })
      );
    }
    hopY.value = withSequence(...ups, withSpring(0, SOFT));
    squash.value = withSequence(...squ, withSpring(0, { damping: 7, stiffness: 240 }));
  };

  // Pose: arms, tilt, eyes, brows, breathing.
  useEffect(() => {
    const p = POSES[state] || POSES.idle;
    const set = (sv, v, cfg = SOFT) => {
      cancelAnimation(sv);
      sv.value = animate ? withSpring(v, cfg) : v;
    };
    set(tilt, p.tilt);
    set(brow, p.brow);
    set(smileX, p.smile);
    set(lookX, p.lookX);
    set(lookY, p.lookY);
    cancelAnimation(happyEyes);
    happyEyes.value = animate ? withTiming(p.happy, { duration: 160 }) : p.happy;
    cancelAnimation(sadMix);
    cancelAnimation(tear);
    sadMix.value = animate ? withTiming(state === 'sad' ? 1 : 0, { duration: 220 }) : state === 'sad' ? 1 : 0;
    // A single tear that rolls down and fades, now and then.
    tear.value = animate && state === 'sad' ? withRepeat(withSequence(withTiming(0, { duration: 900 }), withTiming(1, { duration: 1100, easing: Easing.in(Easing.quad) })), -1) : state === 'sad' ? 0.3 : 0;

    cancelAnimation(armL);
    cancelAnimation(armR);
    if (animate && state === 'wave') {
      const wave = [withTiming(-124, { duration: 180 }), withTiming(-88, { duration: 180 })];
      armR.value = withSequence(
        withSpring(-102, BOUNCY),
        withRepeat(
          withSequence(
            ...wave,
            ...wave,
            ...wave,
            withTiming(-102, { duration: 200 }),
            withDelay(1800, withTiming(-102, { duration: 1 }))
          ),
          -1
        )
      );
      armL.value = withSpring(0, SOFT);
    } else if (animate && state === 'happy') {
      armR.value = withSequence(
        withSpring(-105, BOUNCY),
        withRepeat(
          withSequence(
            withTiming(-122, { duration: 280, easing: sine }),
            withTiming(-96, { duration: 280, easing: sine })
          ),
          -1,
          true
        )
      );
      armL.value = withSequence(
        withSpring(105, BOUNCY),
        withRepeat(
          withSequence(
            withTiming(122, { duration: 280, easing: sine }),
            withTiming(96, { duration: 280, easing: sine })
          ),
          -1,
          true
        )
      );
    } else {
      armL.value = animate ? withSpring(p.armL, BOUNCY) : p.armL;
      armR.value = animate ? withSpring(p.armR, BOUNCY) : p.armR;
    }

    cancelAnimation(breathe);
    cancelAnimation(sprout);
    if (animate) {
      breathe.value = withRepeat(withTiming(1, { duration: state === 'happy' ? 700 : 1500, easing: sine }), -1, true);
      sprout.value = withRepeat(
        withSequence(withTiming(7, { duration: 1500, easing: sine }), withTiming(-7, { duration: 1500, easing: sine })),
        -1,
        true
      );
    } else {
      breathe.value = 0;
      sprout.value = 0;
    }
    if (animate && state === 'happy' && autoHop && hopKey == null) hop(2);
  }, [state, animate]);

  // Talking body language: head bobs and tilts with the words, eyebrows lift,
  // and the free hand gestures now and then, so Mo talks like a character.
  useEffect(() => {
    cancelAnimation(talkPhase);
    cancelAnimation(gesture);
    if (talkingNow && animate) {
      talkPhase.value = 0;
      talkPhase.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1);
      if (state !== 'wave' && state !== 'happy') {
        gesture.value = withRepeat(withSequence(withDelay(500, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) })), withTiming(0.55, { duration: 220 }), withTiming(1, { duration: 220 }), withDelay(700, withTiming(0, { duration: 320 }))), -1);
      }
    } else {
      talkPhase.value = withTiming(0, { duration: 200 });
      gesture.value = withTiming(0, { duration: 220 });
    }
  }, [talkingNow, state, animate]);

  // Mouth: chatter while talking, a big grin when happy, a smile otherwise.
  useEffect(() => {
    cancelAnimation(mouth);
    cancelAnimation(talkMix);
    if (talkingNow) {
      talkMix.value = withTiming(1, { duration: 110 });
      mouth.value = still
        ? 0.6
        : withRepeat(
            withSequence(
              withTiming(1, { duration: 90 }),
              withTiming(0.3, { duration: 110 }),
              withTiming(0.85, { duration: 90 }),
              withTiming(0.15, { duration: 120 }),
              withTiming(0.7, { duration: 100 }),
              withTiming(0.35, { duration: 110 })
            ),
            -1
          );
    } else if (state === 'happy') {
      talkMix.value = still ? 1 : withTiming(1, { duration: 160 });
      mouth.value = still ? 0.8 : withSpring(0.8, SOFT);
    } else {
      talkMix.value = still ? 0 : withTiming(0, { duration: 140 });
      mouth.value = still ? 0.3 : withTiming(0.3, { duration: 140 });
    }
  }, [talkingNow, state, still]);

  // Random blinks and glances (timers only schedule; the motion runs on the UI thread).
  useEffect(() => {
    if (still) return undefined;
    let alive = true;
    let tBlink;
    let tGlance;
    const close = () => withTiming(0.08, { duration: 70 });
    const open = () => withTiming(1, { duration: 110 });
    const blinkLoop = () => {
      tBlink = setTimeout(() => {
        if (!alive) return;
        blink.value =
          Math.random() < 0.22
            ? withSequence(close(), open(), withDelay(70, close()), open())
            : withSequence(close(), open());
        blinkLoop();
      }, 1800 + Math.random() * 3400);
    };
    blinkLoop();
    if (!reduce && state !== 'think') {
      const glanceLoop = () => {
        tGlance = setTimeout(() => {
          if (!alive) return;
          const centre = Math.random() < 0.4;
          lookX.value = withTiming(centre ? 0 : (Math.random() * 2 - 1) * 3.6, {
            duration: 200,
            easing: Easing.out(Easing.quad),
          });
          lookY.value = withTiming(centre ? 0 : (Math.random() * 2 - 1) * 2.6, {
            duration: 200,
            easing: Easing.out(Easing.quad),
          });
          glanceLoop();
        }, 1400 + Math.random() * 2600);
      };
      glanceLoop();
    }
    return () => {
      alive = false;
      clearTimeout(tBlink);
      clearTimeout(tGlance);
    };
  }, [still, state, reduce]);

  // Celebration hops on demand.
  useEffect(() => {
    if (hopKey == null || !animate) return;
    hop(2);
  }, [hopKey]);

  // ── animated styles ──
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: 1 + hopY.value / 70,
    transform: [{ scaleX: 1 + hopY.value / 90 + squash.value * 0.5 }],
  }));
  const bodyStyle = useAnimatedStyle(() => {
    const sq = squash.value;
    const b = breathe.value;
    const ph = talkPhase.value * Math.PI * 2;
    const talkTilt = Math.sin(ph) * 4 * talkMix.value;
    const talkBob = -Math.abs(Math.sin(ph * 2)) * 3 * talkMix.value;
    return {
      transform: [
        { translateY: (hopY.value + talkBob) * k },
        { rotate: `${tilt.value + talkTilt}deg` },
        { scaleX: (1 + sq * 0.8) * (1 - b * 0.012) },
        { scaleY: (1 - sq) * (1 + b * 0.025) },
      ],
    };
  });
  const armLStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${armL.value + breathe.value * 4}deg` }] }));
  const armRStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${armR.value - breathe.value * 4 - gesture.value * 42}deg` }] }));
  const sproutStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sprout.value}deg` }] }));
  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lookX.value * 0.45 * k }, { translateY: lookY.value * 0.35 * k }],
  }));
  const eyesStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  const openEyesStyle = useAnimatedStyle(() => ({ opacity: 1 - happyEyes.value }));
  const happyEyesStyle = useAnimatedStyle(() => ({ opacity: happyEyes.value }));
  const pupilStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lookX.value * k }, { translateY: lookY.value * k }],
  }));
  const browStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (brow.value - (lipOn.value > 0 ? lipLevel.value : mouth.value) * talkMix.value * 3.2) * k }],
  }));
  const smileStyle = useAnimatedStyle(() => ({ opacity: (1 - talkMix.value) * (1 - sadMix.value), transform: [{ scaleX: smileX.value }] }));
  const frownStyle = useAnimatedStyle(() => ({ opacity: sadMix.value * (1 - talkMix.value) }));
  const tearStyle = useAnimatedStyle(() => ({ opacity: sadMix.value * (tear.value < 0.85 ? 1 : (1 - tear.value) / 0.15), transform: [{ translateY: tear.value * 16 * k }] }));
  // Real lip sync while a recorded line plays (lipOn), otherwise the chatter loop.
  const mouthStyle = useAnimatedStyle(() => {
    const m = lipOn.value > 0 ? lipLevel.value : mouth.value;
    return { opacity: talkMix.value, transform: [{ scaleY: 0.12 + m * 0.88 }] };
  });

  const c = palette(leaf);
  const o = (x, y) => [x * k, y * k, 0]; // transform origin in px
  const svg = (children) => (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {children}
    </Svg>
  );
  const arm = (x1, y1, x2, y2, thumb) => {
    const h = handGeom(x1, y1, x2, y2, thumb);
    return svg(
      <>
        <Path d={limbPath(x1, y1, x2, y2, 8.5, 6.5)} fill={c.arm} stroke={c.line} strokeWidth={3} strokeLinejoin="round" />
        <Circle cx={h.tx} cy={h.ty} r={4.6} fill={c.hand} stroke={c.line} strokeWidth={3} />
        <Circle cx={h.hx} cy={h.hy} r={9.5} fill={c.hand} stroke={c.line} strokeWidth={3} />
        <Circle cx={h.hx} cy={h.hy} r={8} fill={c.hand} />
      </>
    );
  };

  return (
    <View
      style={[{ width: size, height: size }, style]}
      pointerEvents="none"
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
    >
      {/* ground shadow */}
      <Animated.View style={[fill, { transformOrigin: o(100, 189) }, shadowStyle]}>
        {svg(<Ellipse cx={100} cy={189} rx={48} ry={6.5} fill={c.shadow} opacity={0.12} />)}
      </Animated.View>

      <Animated.View style={[fill, { transformOrigin: o(100, 186) }, bodyStyle]}>
        {/* sprout */}
        <Animated.View style={[fill, { transformOrigin: o(100, 48) }, sproutStyle]}>
          {svg(
            <>
              <Path
                d="M100 50 C99 40 101 32 104 26"
                stroke={c.stem}
                strokeWidth={4.5}
                strokeLinecap="round"
                fill="none"
              />
              <Path d="M103 28 C93 17 80 20 77 29 C87 36 97 35 103 28 Z" fill={c.leafDark} />
              <Path d="M104 27 C110 13 124 11 131 17 C125 28 113 32 104 27 Z" fill={c.leaf} />
              <Path
                d="M108 25 C114 21 120 19 125 18"
                stroke="#A8E8C6"
                strokeWidth={1.8}
                strokeLinecap="round"
                fill="none"
              />
            </>
          )}
        </Animated.View>

        {/* arms (behind the body) */}
        <Animated.View style={[fill, { transformOrigin: o(52, 116) }, armLStyle]}>
          {arm(52, 116, 31, 143, -1)}
        </Animated.View>
        <Animated.View style={[fill, { transformOrigin: o(148, 116) }, armRStyle]}>
          {arm(148, 116, 169, 143, 1)}
        </Animated.View>

        {/* feet + body (absolute like every other layer, so nothing stacks in flow) */}
        <View style={fill}>
          {svg(
            <>
              <Ellipse cx={76} cy={179} rx={15} ry={8.5} fill={c.foot} />
              <Ellipse cx={124} cy={179} rx={15} ry={8.5} fill={c.foot} />
              <Path d={BODY} fill={c.body} stroke={c.line} strokeWidth={3.5} strokeLinejoin="round" />
              {/* cheeks */}
              <Ellipse cx={63} cy={121} rx={9} ry={5.5} fill={c.cheek} />
              <Ellipse cx={137} cy={121} rx={9} ry={5.5} fill={c.cheek} />
            </>
          )}
        </View>

        {/* face — drifts a touch toward where Mo is looking */}
        <Animated.View style={[fill, faceStyle]}>
          <Animated.View style={[fill, browStyle]}>
            {svg(
              <>
                <Path
                  d="M71 79 Q79 74.5 87 78"
                  stroke={c.pupil}
                  strokeWidth={3.6}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.85}
                />
                <Path
                  d="M113 78 Q121 74.5 129 79"
                  stroke={c.pupil}
                  strokeWidth={3.6}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.85}
                />
              </>
            )}
          </Animated.View>

          <Animated.View style={[fill, { transformOrigin: o(100, 100) }, eyesStyle]}>
            <Animated.View style={[fill, openEyesStyle]}>
              {svg(
                <>
                  <Ellipse cx={80} cy={100} rx={14} ry={16} fill={c.eyeWhite} />
                  <Ellipse cx={120} cy={100} rx={14} ry={16} fill={c.eyeWhite} />
                </>
              )}
              <Animated.View style={[fill, pupilStyle]}>
                {svg(
                  <>
                    <Ellipse cx={80} cy={101} rx={9} ry={9.5} fill={c.pupil} />
                    <Ellipse cx={120} cy={101} rx={9} ry={9.5} fill={c.pupil} />
                    <Ellipse cx={76.5} cy={96.5} rx={3.4} ry={3.4} fill={c.eyeWhite} />
                    <Ellipse cx={116.5} cy={96.5} rx={3.4} ry={3.4} fill={c.eyeWhite} />
                    <Ellipse cx={83.5} cy={104.5} rx={1.6} ry={1.6} fill={c.eyeWhite} opacity={0.8} />
                    <Ellipse cx={123.5} cy={104.5} rx={1.6} ry={1.6} fill={c.eyeWhite} opacity={0.8} />
                  </>
                )}
              </Animated.View>
            </Animated.View>
          </Animated.View>

          <Animated.View style={[fill, happyEyesStyle]}>
            {svg(
              <>
                <Path d="M68 104 Q80 89 92 104" stroke={c.pupil} strokeWidth={5} strokeLinecap="round" fill="none" />
                <Path d="M108 104 Q120 89 132 104" stroke={c.pupil} strokeWidth={5} strokeLinecap="round" fill="none" />
              </>
            )}
          </Animated.View>

          <Animated.View style={[fill, { transformOrigin: o(100, 124) }, smileStyle]}>
            {svg(
              <Path d="M89 121 Q100 132 111 121" stroke={c.pupil} strokeWidth={4} strokeLinecap="round" fill="none" />
            )}
          </Animated.View>
          <Animated.View style={[fill, frownStyle]}>
            {svg(<Path d="M90 128 Q100 119.5 110 128" stroke={c.pupil} strokeWidth={4} strokeLinecap="round" fill="none" />)}
          </Animated.View>
          <Animated.View style={[fill, tearStyle]}>
            {svg(<Path d="M127 108 C127 108 122.5 114 122.5 117 C122.5 119.6 124.6 121.5 127 121.5 C129.4 121.5 131.5 119.6 131.5 117 C131.5 114 127 108 127 108 Z" fill="#7DB6FF" />)}
          </Animated.View>
          <Animated.View style={[fill, { transformOrigin: o(100, 116) }, mouthStyle]}>
            {svg(
              <>
                <Path d={OPEN_MOUTH} fill={c.mouth} />
                <Ellipse cx={100} cy={125} rx={4.5} ry={2.6} fill={c.tongue} />
              </>
            )}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
