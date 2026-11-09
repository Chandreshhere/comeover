// First-run app tour (coach marks) over the main tabs.
//
// Shows once, when all of these hold: prefs.tourDone !== true, the session is
// verified and onboarded, and the `main` route itself is focused (nothing
// pushed or presented on top — so it waits for onboarding steps such as
// social_style to finish). Finishing or skipping sets prefs.tourDone = true.
//
// Replay: setPrefs({ tourDone: false }) and navigate to
// main → discover_home; the tour starts again from the first step.
//
// Mounted once inside MainTabs (navigation/RootNavigator.js). Targets register
// themselves with <TourTarget id="…"> (see tourTargets.js); the tab bar
// registers `tab:<route name>`.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  runOnJS,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useNavigationState } from '@react-navigation/native';
import { useSplashDone } from '@/features/splash/splashSignal';
import { AppText, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, isDark, layout, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import voice from '@/services/voice';
import GuideCharacter from './GuideCharacter';
import GuideBubble from './GuideBubble';
import VoiceToggle from './VoiceToggle';
import { measureTarget, subscribeTargets } from './tourTargets';


// The backdrop is near-black in both schemes, so anything drawn on it uses
// white at an alpha (never the scheme-flipping colors.white).
const onScrim = (a) => `rgba(255,255,255,${a})`;

export const TOUR_STEPS = [
  {
    id: 'tab:discover_home',
    title: 'Discover',
    text: 'This is Discover: real plans happening near you, today and this week.',
    during: 'wave',
  },
  {
    id: 'discover:search',
    title: 'Search & ask',
    text: 'Search chai, badminton or people. Not sure what to do? Ask the plan assistant.',
    after: 'think',
    tab: 'discover_home',
  },
  {
    id: 'discover:status',
    title: 'Your status',
    text: 'Free right now? Tap here, and plans nearby can find you.',
    tab: 'discover_home',
    pad: 4,
  },
  {
    id: 'discover:featured',
    title: 'A plan',
    text: 'This is a plan. Tap it for the details, then tap Request to join in!',
    tab: 'discover_home',
    during: 'talk',
    after: 'happy',
  },
  {
    id: 'discover:inbox',
    title: 'Chats & updates',
    text: 'Your chats open here once you join a plan. The bell keeps you posted.',
    tab: 'discover_home',
    pad: 6,
  },
  {
    id: 'tab:live_radar',
    title: 'Live',
    text: "Live shows who's free right now nearby. Perfect for last-minute plans.",
    pad: 4,
  },
  {
    id: 'tab:create_tab',
    title: 'Create',
    text: 'Tap the plus to host a plan in about 30 seconds. You approve who joins.',
    round: true,
    pad: 6,
  },
  {
    id: 'tab:circles_home',
    title: 'Circles',
    text: 'Circles are recurring groups, like a Sunday run club or a weekly board-game night.',
    pad: 4,
  },
  {
    id: 'tab:profile_home',
    title: 'Profile',
    text: 'Your progress, quests, settings and premium live in Profile. Have fun out there!',
    after: 'happy',
    pad: 4,
  },
];

const GAP = 16;
const CHAR = 92;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function PillButton({ label, onPress, primary, icon, iconRight, accessibilityLabel, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: layout.minTouch,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.periwinkle : 'transparent',
        borderWidth: primary ? 0 : 1.2,
        borderColor: onScrim(0.35),
        opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {icon && (
        <Icon name={icon} size={16} color={primary ? colors.ink : colors.pureWhite} style={{ marginRight: 6 }} />
      )}
      <AppText variant="bodyStrong" color={primary ? colors.ink : colors.pureWhite} maxScale={1.2} numberOfLines={1}>
        {label}
      </AppText>
      {iconRight && (
        <Icon name={iconRight} size={16} color={primary ? colors.ink : colors.pureWhite} style={{ marginLeft: 6 }} />
      )}
    </Pressable>
  );
}

function Dots({ count, index }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      accessibilityLabel={`Step ${index + 1} of ${count}`}
      accessible
    >
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === index ? 18 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: i === index ? colors.pureWhite : onScrim(0.35),
          }}
        />
      ))}
    </View>
  );
}

export default function AppTour() {
  const nav = useNavigation();
  const splashDone = useSplashDone();
  const focused = useIsFocused() && splashDone; // never start under the splash
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const tourDone = useAppStore((s) => s.prefs.tourDone === true);
  const verified = useAppStore((s) => s.session.verified);
  const onboarded = useAppStore((s) => s.session.onboarded);
  const setPrefs = useAppStore((s) => s.setPrefs);
  // Name of the focused tab (the `main` route's nested state).
  const tab = useNavigationState((s) => {
    const main = s?.routes?.find((r) => r.name === 'main');
    const st = main?.state;
    return st?.routes?.[st.index ?? 0]?.name || 'discover_home';
  });

  const eligible = !tourDone && verified && onboarded && focused;
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null); // target in overlay coordinates (unpadded)
  const [hole, setHole] = useState(null); // padded spotlight hole {x,y,w,h,r}
  const dimIn = useSharedValue(0);
  const [measured, setMeasured] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [panelH, setPanelH] = useState(0);
  const [talking, setTalking] = useState(false);
  const rootRef = useRef(null);
  const token = useRef(0);
  const shownOnce = useRef(false);

  // Spotlight geometry (overlay coordinates).
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);
  const sr = useSharedValue(0);
  const panelTop = useSharedValue(0);
  // Mo swaps sides at every stop and dashes across: dashX goes from the old
  // side's offset to 0 (his new spot), with lean, stretch and speed lines.
  const [rowW, setRowW] = useState(0);
  const [dashing, setDashing] = useState(false);
  const moX = useSharedValue(0); // Mo's x in the panel: 0 = left spot, span = right spot
  const moTarget = useSharedValue(0);
  const crouch = useSharedValue(0); // anticipation squash before launching
  const dust = useSharedValue(0); // launch puffs 0→1
  const moSide = step % 2 === 0 ? 'left' : 'right';

  // Replay contract: tourDone flipping back to false restarts from step 0.
  useEffect(() => {
    if (!tourDone) {
      setStep(0);
      shownOnce.current = false;
    }
  }, [tourDone]);

  // Start (or resume) once main has been focused for a moment.
  useEffect(() => {
    if (!eligible) {
      token.current += 1; // drop any in-flight measurement
      setRunning(false);
      setMeasured(false);
      return undefined;
    }
    const t = setTimeout(() => setRunning(true), 900);
    return () => clearTimeout(t);
  }, [eligible]);

  // Steps that point inside a tab need that tab on screen.
  useEffect(() => {
    if (!running) return;
    const want = TOUR_STEPS[step]?.tab;
    if (want && tab !== want) nav.navigate('main', { screen: want });
  }, [running, step]);

  // The overlay's own window offset (it can sit below a translucent status
  // bar on Android). Never waits more than 400 ms.
  const measureRoot = () =>
    new Promise((resolve) => {
      const node = rootRef.current;
      const t = setTimeout(() => resolve({ x: 0, y: 0 }), 400);
      const done = (v) => {
        clearTimeout(t);
        resolve(v);
      };
      if (!node || typeof node.measureInWindow !== 'function') return done({ x: 0, y: 0 });
      try {
        node.measureInWindow((x, y) => done({ x: x || 0, y: y || 0 }));
      } catch (e) {
        done({ x: 0, y: 0 });
      }
      return undefined;
    });

  const place = useCallback(
    async (i, { first = false } = {}) => {
      const my = ++token.current;
      const s = TOUR_STEPS[i];
      let r = null;
      for (let attempt = 0; attempt < 10 && !r; attempt++) {
        r = await measureTarget(s.id);
        if (!r) await wait(160);
        if (my !== token.current) return;
      }
      const o = await measureRoot();
      if (my !== token.current) return;
      let target = r ? { x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height } : null;
      // Scrolled out of view (e.g. Discover was scrolled before a replay):
      // explain it without a spotlight rather than pointing off-screen.
      if (
        target &&
        (target.y < 0 || target.y + target.height > size.h || target.x + target.width < 0 || target.x > size.w)
      )
        target = null;
      const pad = s.pad ?? 8;
      const next = target
        ? {
            x: target.x - pad,
            y: target.y - pad,
            w: target.width + pad * 2,
            h: target.height + pad * 2,
            r: s.round
              ? (Math.max(target.width, target.height) + pad * 2) / 2
              : Math.min(radius.card, (target.height + pad * 2) / 2),
          }
        : { x: size.w / 2, y: size.h / 2, w: 0, h: 0, r: 0 };
      // The hole jumps to the new spot (no per-frame layout); the dim layer
      // does a quick fade instead, which costs almost nothing.
      const go = (sv, v) => {
        cancelAnimation(sv);
        sv.value = v;
      };
      setHole(next);
      cancelAnimation(dimIn);
      dimIn.value = reduce ? 1 : first ? withTiming(1, { duration: 260 }) : withSequence(withTiming(0.55, { duration: 70 }), withTiming(1, { duration: 200 }));
      go(sx, next.x);
      go(sy, next.y);
      go(sw, next.w);
      go(sh, next.h);
      go(sr, next.r);
      setRect(target);
      setMeasured(true);
    },
    [size.w, size.h, reduce]
  );

  // Measure the current step whenever it (or visibility) changes.
  useEffect(() => {
    if (!running || !size.w) return;
    const first = !shownOnce.current;
    shownOnce.current = true;
    place(step, { first });
  }, [running, step, size.w, size.h]);

  // Re-measure when the current target re-lays out.
  useEffect(() => {
    if (!running) return undefined;
    return subscribeTargets((id) => {
      if (id === TOUR_STEPS[step]?.id) place(step);
    });
  }, [running, step, place]);


  // Panel position: above targets in the lower half, below the others.
  const above = rect ? rect.y + rect.height / 2 > size.h / 2 : false;
  useEffect(() => {
    if (!measured || !panelH) return;
    const minTop = insets.top + 64;
    const maxTop = size.h - insets.bottom - panelH - space.xs;
    let top;
    if (!rect) top = (size.h - panelH) / 2;
    else if (above) top = rect.y - (TOUR_STEPS[step]?.pad ?? 8) - GAP - panelH;
    else top = rect.y + rect.height + (TOUR_STEPS[step]?.pad ?? 8) + GAP;
    top = Math.max(minTop, Math.min(maxTop, top));
    panelTop.value = reduce || panelTop.value === 0 ? top : withTiming(top, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [measured, panelH, rect, above, size.h, step]);

  const finish = useCallback(() => {
    voice.stop();
    haptics.success();
    sfx.play('chime');
    setRunning(false);
    setMeasured(false);
    panelTop.value = 0;
    setPrefs({ tourDone: true });
  }, [setPrefs]);

  useEffect(() => {
    if (!span) return undefined;
    const target = moSide === 'left' ? 0 : span;
    moTarget.value = target;
    if (step === 0 || reduce) {
      moX.value = target;
      return undefined;
    }
    setDashing(true);
    cancelAnimation(moX);
    crouch.value = withSequence(withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 160 }));
    dust.value = 0;
    dust.value = withDelay(100, withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }));
    moX.value = withDelay(110, withTiming(target, { duration: 560, easing: Easing.bezier(0.3, 0.0, 0.2, 1.12) })); // slight skid past, then settle
    const t = setTimeout(() => setDashing(false), 700);
    return () => clearTimeout(t);
  }, [step, span]);

  // "Let's go": Mo pops into the middle of the screen, then dashes up and away.
  const [exiting, setExiting] = useState(false);
  const exitIn = useSharedValue(0);
  const exitY = useSharedValue(0);
  const exitTour = useCallback(() => {
    const finishExit = () => {
      setExiting(false);
      finish();
    };
    voice.stop();
    setExiting(true);
    exitY.value = 0;
    exitIn.value = 0;
    exitIn.value = withSpring(1, { damping: 10, stiffness: 160 });
    sfx.play('pop');
    haptics.light();
    setTimeout(() => {
      sfx.play('whoosh');
      exitY.value = withTiming(-(size.h || 900) * 1.1, { duration: 560, easing: Easing.in(Easing.cubic) }, (fin) => {
        if (fin) runOnJS(finishExit)();
      });
    }, 700);
  }, [finish, size.h]);
  const EXIT = Math.round(CHAR * 1.5);
  const exitMoStyle = useAnimatedStyle(() => {
    const speed = Math.min(1, -exitY.value / ((size.h || 900) * 0.25));
    return { opacity: exitIn.value, transform: [{ translateY: exitY.value }, { scale: 0.5 + 0.5 * exitIn.value }, { scaleY: 1 + speed * 0.28 }, { scaleX: 1 - speed * 0.14 }] };
  });

  const next = useCallback(() => {
    haptics.select();
    if (step >= TOUR_STEPS.length - 1) exitTour();
    else {
      sfx.play('ping');
      setStep(step + 1);
    }
  }, [step, exitTour]);

  const back = useCallback(() => {
    if (step === 0) return;
    haptics.select();
    sfx.play('pong');
    setStep(step - 1);
  }, [step]);

  useEffect(() => {
    if (!running) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) back();
      else finish();
      return true;
    });
    return () => sub.remove();
  }, [running, step, back, finish]);

  // Stop the voice if the tour unmounts mid-line.
  useEffect(() => () => voice.stop(), []);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dimIn.value }));
  const holeTapStyle = useAnimatedStyle(() => ({
    left: sx.value,
    top: sy.value,
    width: Math.max(0, sw.value),
    height: Math.max(0, sh.value),
    borderRadius: Math.max(0, sr.value),
  }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: panelTop.value }] }));
  const span = Math.max(0, rowW - CHAR);
  const runOf = () => {
    'worklet';
    const dist = span ? Math.abs(moTarget.value - moX.value) / span : 0;
    return { dist, run: Math.min(1, dist * 3), dir: moTarget.value >= moX.value ? 1 : -1 };
  };
  const moDashStyle = useAnimatedStyle(() => {
    const { dist, run, dir } = runOf();
    const bounce = -Math.abs(Math.sin(dist * Math.PI * 7)) * 5 * run;
    const c = crouch.value;
    return {
      transform: [
        { translateX: moX.value },
        { translateY: bounce + c * 6 },
        { rotate: `${dir * run * 13}deg` },
        { scaleX: (1 + run * 0.14) * (1 + c * 0.12) },
        { scaleY: (1 - run * 0.09) * (1 - c * 0.14) },
      ],
    };
  });
  // Afterimages: soft Mo-shaped silhouettes trailing behind while he runs.
  const ghost = (k) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => {
      const { run, dir } = runOf();
      return { opacity: run * (0.42 - k * 0.12), transform: [{ translateX: moX.value - dir * (k + 1) * CHAR * 0.3 }, { rotate: `${dir * run * 13}deg` }] };
    });
  const ghost1 = ghost(0);
  const ghost2 = ghost(1);
  const ghost3 = ghost(2);
  // Dust puffs at his feet on launch.
  const puff = (k) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => {
      const d = dust.value;
      const side = moTarget.value > 0 ? -1 : 1; // puffs fly opposite to the run
      return {
        opacity: d > 0 && d < 1 ? (1 - d) * 0.8 : 0,
        transform: [{ translateX: (moTarget.value > 0 ? 0 : span) + CHAR * 0.5 + side * (10 + d * (24 + k * 14)) }, { translateY: CHAR - 10 - d * (8 + k * 6) }, { scale: 0.5 + d * (0.8 + k * 0.2) }],
      };
    });
  const puff1 = puff(0);
  const puff2 = puff(1);
  const puff3 = puff(2);

  if (!running) return null;

  const s = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const charState = talking ? s.during || 'talk' : s.after || 'idle';
  const scrimOpacity = isDark() ? 0.74 : 0.64;

  return (
    <Animated.View
      ref={rootRef}
      entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(200).reduceMotion(ReduceMotion.System)}
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      onStartShouldSetResponder={() => true}
      accessibilityViewIsModal
      collapsable={false}
    >
      {size.w > 0 && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dimStyle]}>
          <Svg width={size.w} height={size.h}>
            <Defs>
              <Mask id="tourHole" x="0" y="0" width={size.w} height={size.h} maskUnits="userSpaceOnUse">
                <Rect x="0" y="0" width={size.w} height={size.h} fill="#FFFFFF" />
                {hole && hole.w > 0 ? <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={hole.r} ry={hole.r} fill="#000000" /> : null}
              </Mask>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} fill="#000000" opacity={scrimOpacity} mask="url(#tourHole)" />
          </Svg>
        </Animated.View>
      )}

      {/* tap the highlighted spot to advance */}
      {measured && rect && (
        <>
          <Animated.View style={[{ position: 'absolute' }, holeTapStyle]}>
            <Pressable
              onPress={next}
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel={`${s.title}. Next step`}
            />
          </Animated.View>
        </>
      )}


      {/* exit: Mo in the centre, then up and away with speed lines below him */}
      {exiting && size.w > 0 && (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: size.w / 2 - EXIT / 2, top: size.h / 2 - EXIT / 2, width: EXIT, height: EXIT }, exitMoStyle]}>
          <GuideCharacter size={EXIT} state="happy" autoHop={false} decorative />
        </Animated.View>
      )}

      {/* guide panel */}
      {measured && !exiting && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: layout.screenPadding,
              right: layout.screenPadding,
              top: 0,
              opacity: panelH ? 1 : 0,
            },
            panelStyle,
          ]}
          onLayout={(e) => setPanelH(Math.round(e.nativeEvent.layout.height))}
        >
          <View style={{ minHeight: CHAR, justifyContent: 'flex-end' }} onLayout={(e) => setRowW(Math.round(e.nativeEvent.layout.width))}>
            <GuideBubble
              key={step}
              title={s.title}
              text={s.text}
              active={running && measured && !dashing}
              tail={moSide}
              tailAlign="end"
              tailOffset={Math.max(10, Math.round(CHAR * 0.36 - space.md - 6))}
              onTalkingChange={setTalking}
              style={{ marginBottom: space.md, [moSide === 'left' ? 'marginLeft' : 'marginRight']: CHAR + space.xs, opacity: dashing ? 0 : 1 }}
              maxScale={1.2}
            />
            {[puff1, puff2, puff3].map((st, k) => (
              <Animated.View key={`p${k}`} pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.pureWhite }, st]} />
            ))}
            {[ghost3, ghost2, ghost1].map((st, k) => (
              <Animated.View key={`g${k}`} pointerEvents="none" style={[{ position: 'absolute', left: CHAR * 0.18, bottom: CHAR * 0.06, width: CHAR * 0.64, height: CHAR * 0.72, borderRadius: CHAR * 0.34, backgroundColor: colors.pureWhite }, st]} />
            ))}
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, bottom: 0, width: CHAR, height: CHAR }, moDashStyle]}>
              <GuideCharacter size={CHAR} state={dashing ? 'happy' : charState} talking={talking && !dashing} autoHop={false} decorative />
            </Animated.View>
          </View>
          <View style={{ alignItems: 'center', marginTop: space.xs }}>
            <Dots count={TOUR_STEPS.length} index={step} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, gap: space.xs }}>
            <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Skip tour" hitSlop={8} style={({ pressed }) => ({ minHeight: layout.minTouch, justifyContent: 'center', paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}>
              <AppText variant="bodyStrong" color={colors.pureWhite} maxScale={1.2}>
                Skip
              </AppText>
            </Pressable>
            <VoiceToggle tone="scrim" />
            <View style={{ flex: 1 }} />
            {step > 0 && <PillButton label="Back" onPress={back} />}
            <PillButton
              label={last ? "Let's go" : 'Next'}
              iconRight={last ? 'check' : 'arrow-right'}
              onPress={next}
              primary
            />
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
