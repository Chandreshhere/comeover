// Cold-start splash: "the invitation".
//
// Solid colour panels only (no gradients, no logo). Each panel slides up over
// the last and asks one question in big type: "chai?", "badminton?",
// "sunset walk?"; the last one answers: "come over." Letters rise into place,
// every panel lands with a little pop, the answer gets a chime. The splash
// holds on the answer until the app has booted underneath, then the panel
// lifts away to reveal it. Tap to skip once the app is ready.
//
// The palette is fixed (it starts from the same ink as the native launch
// screen). Reduce Motion: just the answer, then a fade.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming, runOnJS } from 'react-native-reanimated';
import { fonts, layout, type } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import { markSplashDone } from './splashSignal';

export const SPLASH_INK = '#0B0C12'; // keep in sync with LaunchScreen.storyboard and android colors.xml
const PAPER = '#F4F5FA';

const PANELS = [
  { bg: '#FF9A52', fg: SPLASH_INK, text: 'chai?', sound: 'pop' },
  { bg: '#8FB0FF', fg: SPLASH_INK, text: 'badminton?', sound: 'pop' },
  { bg: '#7FD8A8', fg: SPLASH_INK, text: 'sunset walk?', sound: 'pop' },
  { bg: SPLASH_INK, fg: PAPER, text: 'come over.', accent: '#FF9A52', sound: 'chime', final: true },
];
const STEP = 430; // ms between panels
const SLIDE = 520; // ms for a panel to land
const LETTER = 34; // ms stagger between letters
const PAD = layout.screenPadding; // same side margin as every screen
const EASE = Easing.bezier(0.76, 0, 0.24, 1);

let played = false; // once per cold start, never on theme remounts

// ONE size for every panel (consistent rhythm), small enough that the longest
// whole phrase ("sunset walk?") stays on a single line.
const LONGEST = Math.max(...PANELS.map((p) => p.text.length));
const fit = (W) => Math.round(Math.min(64, (W - PAD * 2) / (LONGEST * 0.62)));

function Letter({ ch, size, color, start, reduce }) {
  const y = useSharedValue(reduce ? 0 : 1);
  useEffect(() => {
    if (!reduce) y.value = withDelay(start, withTiming(0, { duration: 560, easing: Easing.bezier(0.2, 0.9, 0.2, 1) }));
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * size * 1.15 }, { rotate: `${y.value * 10}deg` }] }));
  return (
    <View style={{ height: size * 1.16, overflow: 'hidden' }}>
      <Animated.Text allowFontScaling={false} style={[{ fontFamily: fonts.bold, fontSize: size, lineHeight: size * 1.16, color, letterSpacing: -size * 0.035, includeFontPadding: false }, style]}>
        {ch}
      </Animated.Text>
    </View>
  );
}

function Panel({ p, index, W, H, reduce, exit }) {
  const delay = 120 + index * STEP;
  const y = useSharedValue(reduce ? (p.final ? 0 : H) : H);
  useEffect(() => {
    if (!reduce) y.value = withDelay(delay, withTiming(0, { duration: SLIDE, easing: EASE }));
  }, []);
  // On exit the whole stack lifts together, revealing the app underneath.
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value - exit.value * H }] }));
  const size = fit(W);
  const words = p.text.split(' ');
  let n = 0;
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: p.bg }, style]}>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: PAD, paddingBottom: H * 0.2 }}>
        <AnimatedCaption text={p.final ? 'less scrolling. more living.' : `0${index + 1} / 0${PANELS.length - 1}`} color={p.fg} start={delay + 260} reduce={reduce} />
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          {words.map((w, wi) => (
            <View key={`${w}${wi}`} style={{ flexDirection: 'row', marginRight: wi < words.length - 1 ? size * 0.24 : 0 }}>
              {w.split('').map((ch, ci) => {
                const isAccent = p.accent && (ch === '.' || ch === '?') && wi === words.length - 1 && ci === w.length - 1;
                const start = delay + 140 + n * LETTER;
                n += 1;
                return <Letter key={`${ch}${ci}`} ch={ch} size={size} color={isAccent ? p.accent : p.fg} start={start} reduce={reduce} />;
              })}
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function AnimatedCaption({ text, color, start, reduce }) {
  const o = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) o.value = withDelay(start, withTiming(1, { duration: 380 }));
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: o.value * 0.62, transform: [{ translateY: (1 - o.value) * 8 }] }));
  return (
    <Animated.Text allowFontScaling={false} style={[{ ...type.label, letterSpacing: 1.6, color, textTransform: 'uppercase' }, style]}>
      {text}
    </Animated.Text>
  );
}

export default function AnimatedSplash({ ready, onDone }) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(played ? 'done' : 'intro'); // intro → hold → exit → done
  const statusEntry = useRef(null);
  const exit = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (played) {
      markSplashDone();
      onDone?.();
      return undefined;
    }
    played = true;
    statusEntry.current = StatusBar.pushStackEntry({ hidden: true, animated: true });
    sfx.preload(['pop', 'chime', 'whoosh']);
    if (reduce) {
      setPhase('hold');
      return undefined;
    }
    // Sounds + haptics land with each panel.
    const timers = PANELS.map((p, i) =>
      setTimeout(() => {
        sfx.play(p.sound);
        if (p.final) haptics.medium();
        else haptics.light();
      }, 120 + i * STEP + SLIDE * 0.72)
    );
    timers.push(setTimeout(() => setPhase('hold'), 120 + (PANELS.length - 1) * STEP + SLIDE + 520));
    return () => timers.forEach(clearTimeout);
  }, []);

  // Hold on the answer until the app is ready (8 s ceiling), then lift away.
  useEffect(() => {
    if (phase !== 'hold') return undefined;
    const t = setTimeout(() => setPhase('exit'), ready ? (reduce ? 500 : 180) : 8000);
    return () => clearTimeout(t);
  }, [phase, ready]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const finish = () => {
      if (statusEntry.current) StatusBar.popStackEntry(statusEntry.current);
      statusEntry.current = null;
      setPhase('done');
      markSplashDone();
      onDone?.();
    };
    if (reduce) {
      fade.value = withTiming(0, { duration: 320 }, (fin) => fin && runOnJS(finish)());
      return;
    }
    sfx.play('whoosh');
    exit.value = withTiming(1, { duration: 640, easing: EASE }, (fin) => fin && runOnJS(finish)());
  }, [phase]);

  const skip = () => {
    if (phase === 'hold' && ready) setPhase('exit');
  };

  // The ink behind the panels lifts with the last panel so the app shows through.
  const base = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: -exit.value * H }] }));
  const whole = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (phase === 'done') return null;

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, whole]} accessible accessibilityRole="image" accessibilityLabel="Come Over">
      <Pressable style={{ flex: 1 }} onPress={skip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: SPLASH_INK }, base]} />
        {PANELS.map((p, i) => (
          <Panel key={p.text} p={p} index={i} W={W} H={H} reduce={reduce} exit={exit} />
        ))}
      </Pressable>
    </Animated.View>
  );
}
