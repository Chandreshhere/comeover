// welcome — 3-page intro with Mo, the guide.
// 1. What Come Over is · 2. How it works · 3. Safe & rewarding.
// Mo stays put while the pages slide underneath; each page has a line Mo
// types (and says, when the voice is on). Skip is always visible.
//   Skip / Get started → phone_entry · "I already have an account" → phone_entry { mode: 'login' }
//   Both mark prefs.introSeen.
import React, { useEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarCheck } from 'phosphor-react-native/src/icons/CalendarCheck';
import { HandHeart } from 'phosphor-react-native/src/icons/HandHeart';
import { LockKey } from 'phosphor-react-native/src/icons/LockKey';
import { MapPinArea } from 'phosphor-react-native/src/icons/MapPinArea';
import { AppText, Button, Icon } from '@/components';
import GuideCharacter from '@/features/guide/GuideCharacter';
import { useSplashDone } from '@/features/splash/splashSignal';
import GuideBubble from '@/features/guide/GuideBubble';
import VoiceToggle from '@/features/guide/VoiceToggle';
import voice from '@/services/voice';
import sfx from '@/services/sfx';
import { useAppStore } from '@/store/useAppStore';
import { colors, glass, isDark, layout, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';

const TOPBAR = 56;
// Which side of the hero Mo stands on for each page (he hops between them).
const MO_SIDES = ['left', 'right', 'left'];
// Speed trail behind Mo's dash: solid lines in the app's accent colours that
// stream out behind him while he runs and pull back into him when he stops.
const TRAIL = [
  { color: '#F0A34B', y: 0.46, len: 1, h: 7 },
  { color: '#E6A2F2', y: 0.6, len: 0.78, h: 6 },
  { color: '#7FD8A8', y: 0.74, len: 0.55, h: 5 },
];

function TrailLine({ line, scrollX, pageW, seg, fade, xL, xR, top, size }) {
  const style = useAnimatedStyle(() => {
    const fromLeft = MO_SIDES[seg.value] === 'left';
    const x0 = fromLeft ? xL : xR;
    const x1 = fromLeft ? xR : xL;
    const p = Math.max(0, Math.min(1, (pageW ? scrollX.value / pageW : 0) - seg.value));
    const xm = x0 + (x1 - x0) * p; // Mo's centre right now
    const dir = x1 >= x0 ? 1 : -1;
    const len = Math.abs(xm - x0) * line.len * fade.value;
    const back = xm - dir * size * 0.26; // starts at Mo's back
    return { opacity: len > 2 ? 1 : 0, width: len, transform: [{ translateX: dir > 0 ? back - len : back }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          top: top + size * line.y - line.h / 2,
          height: line.h,
          borderRadius: line.h / 2,
          backgroundColor: line.color,
        },
        style,
      ]}
    />
  );
}

// Icons not in the shared map are imported directly (Phosphor, MIT).
const GLYPHS = { CalendarCheck, HandHeart, LockKey, MapPinArea };
function Glyph({ name, size, color, duotoneColor }) {
  const C = GLYPHS[name];
  if (C) return <C size={size} color={color} weight="duotone" duotoneColor={duotoneColor} duotoneOpacity={0.45} />;
  return (
    <Icon name={name} size={size} color={color} weight="duotone" duotoneColor={duotoneColor} duotoneOpacity={0.45} />
  );
}

// Pastel bubble + strong duotone tone, read at render time (dark-mode safe).
const tone = (t) =>
  ({
    orange: { bg: colors.orangeSoft, fg: colors.orange },
    mint: { bg: colors.mint, fg: colors.success },
    pink: { bg: colors.pinkSoft, fg: colors.pink },
    lavender: { bg: colors.lavender, fg: colors.deep },
    blue: { bg: colors.periwinkleWash, fg: colors.deep },
  }[t] || { bg: colors.surface, fg: colors.deep });

const PAGES = [
  {
    key: 'what',
    line: "Hi, I'm Mo! Come Over helps you find people for real plans nearby.",
    during: 'wave',
    after: 'idle',
    title: 'Less scrolling.\nMore living.',
    body: 'Find people nearby for chai, badminton or a sunset walk.',
    rows: [
      { icon: 'HandHeart', tone: 'pink', title: 'Platonic, not dating', sub: 'Make friends through real plans.' },
      {
        icon: 'CalendarCheck',
        tone: 'orange',
        title: 'Real plans, not a feed',
        sub: 'Chai, walks, badminton and more.',
      },
      { icon: 'map-pin', tone: 'mint', title: 'Nearby and soon', sub: 'Around you, today or this week.' },
    ],
  },
  {
    key: 'how',
    line: "Pick a plan, host it or ask to join. Once you're in, chat opens. Then meet up!",
    during: 'talk',
    after: 'idle',
    title: 'Plan it. Meet up.',
    body: 'Small plans with people nearby, in three steps.',
    rows: [
      { icon: 'sparkle', tone: 'orange', title: 'Pick or host a plan', sub: 'Chai, a walk, badminton, board games.' },
      { icon: 'user-check', tone: 'mint', title: 'Host approves, chat opens', sub: 'Sort out the details together.' },
      {
        icon: 'MapPinArea',
        tone: 'blue',
        title: 'Meet at a public place',
        sub: 'Cafés, parks and courts. Never at home.',
      },
    ],
  },
  {
    key: 'safe',
    line: "Exact spots stay private until you're in. And real meetups earn you XP!",
    during: 'talk',
    after: 'happy',
    title: 'Safe by design.\nFun by default.',
    body: 'Built for showing up, safely.',
    rows: [
      {
        icon: 'LockKey',
        tone: 'lavender',
        title: 'Exact spot once you’re in',
        sub: 'Until then you only see the area.',
      },
      { icon: 'shield', tone: 'mint', title: 'Report or block, anywhere', sub: 'On every profile, plan and chat.' },
      { icon: 'trophy', tone: 'orange', title: 'Real meetups earn XP', sub: 'They power quests and streaks.' },
    ],
  },
];

function IconBubble({ icon, t, size = 40 }) {
  const c = tone(t);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Glyph name={icon} size={Math.round(size * 0.52)} color={colors.ink} duotoneColor={c.fg} />
    </View>
  );
}

// Same rhythm as every onboarding step (OnboardingFrame): title → 8 → one
// subtitle line → 20 → content. Content is always three aligned rows.
function PageBody({ p }) {
  return (
    <>
      <AppText variant="body" color={colors.inkSoft} style={{ marginTop: space.xs }}>
        {p.body}
      </AppText>
      <View style={{ marginTop: space.lg, gap: space.xs }}>
        {p.rows.map((r) => (
          <View key={r.title} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}>
            <IconBubble icon={r.icon} t={r.tone} size={40} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {r.title}
              </AppText>
              <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
                {r.sub}
              </AppText>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function Page({ p, i, width, heroH, charSize, scrollX }) {
  const reduce = useReducedMotion();
  const parallax = useAnimatedStyle(() => {
    if (reduce) return {};
    const input = [(i - 1) * width, i * width, (i + 1) * width];
    return {
      opacity: interpolate(scrollX.value, input, [0.2, 1, 0.2], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(scrollX.value, input, [width * 0.18, 0, -width * 0.18], Extrapolation.CLAMP) },
      ],
    };
  });
  const zoneW = charSize + space.md;
  const zoneH = Math.max(36, heroH - charSize * 0.92);
  return (
    <View style={{ width }}>
      {/* hero strip: Mo and the bubble float above it (fixed overlay) */}
      <View style={{ height: heroH }} pointerEvents="none">
        {/* inset from the top so the bob (-5pt) and the 2pt border never get clipped */}
        <View
          style={{
            position: 'absolute',
            left: layout.screenPadding - 4,
            top: space.sm,
            width: zoneW,
            height: Math.max(30, zoneH - space.sm),
          }}
        ></View>
      </View>
      <ScrollView
        nestedScrollEnabled
        contentContainerStyle={{
          paddingHorizontal: layout.screenPadding,
          paddingTop: space.xs,
          paddingBottom: space.md,
        }}
      >
        <Animated.View style={parallax}>
          <Animated.View entering={i === 0 ? enter(1) : undefined}>
            <AppText variant="display" accessibilityRole="header">
              {p.title}
            </AppText>
          </Animated.View>
          <Animated.View entering={i === 0 ? enter(2) : undefined}>
            <PageBody p={p} />
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Dot({ i, width, scrollX, onPress }) {
  const style = useAnimatedStyle(() => {
    const input = [(i - 1) * width, i * width, (i + 1) * width];
    return {
      width: interpolate(scrollX.value, input, [8, 26, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, input, [0.28, 1, 0.28], Extrapolation.CLAMP),
    };
  });
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Go to page ${i + 1} of ${PAGES.length}`}
      style={{ height: 24, justifyContent: 'center' }}
    >
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: colors.ink }, style]} />
    </Pressable>
  );
}

export default function WelcomeScreen() {
  const nav = useNavigation();
  // Mo only starts once the screen is visible: focused AND the splash is over.
  const splashDone = useSplashDone();
  const focused = useIsFocused() && splashDone;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const setPrefs = useAppStore((s) => s.setPrefs);
  const voiceOn = useAppStore((s) => s.prefs.guideVoice !== false);
  const scrollRef = useRef(null);
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  // True while Mo is running between pages: he wears his excited face.
  const [dashing, setDashing] = useState(false);
  const dashTimer = useRef(null);
  const startDash = () => {
    setDashing(true);
    clearTimeout(dashTimer.current);
    dashTimer.current = setTimeout(() => setDashing(false), 1400); // safety net
  };
  const endDash = () => {
    clearTimeout(dashTimer.current);
    setDashing(false);
  };
  useEffect(() => () => clearTimeout(dashTimer.current), []);
  const [talking, setTalking] = useState(false);
  const [settled, setSettled] = useState(false); // bubble line finished for this page
  const [playKey, setPlayKey] = useState(0);
  const [forceSpeak, setForceSpeak] = useState(-1);
  const spoken = useRef(new Set());

  // Sizes adapt to short phones and larger text.
  const fontBoost = Math.max(0, Math.min(PixelRatio.getFontScale(), 1.25) - 1) * 120;
  const heroH = Math.round(Math.max(184, Math.min(280, height * 0.29)) + fontBoost);
  const charSize = Math.round(Math.max(112, Math.min(172, (heroH - fontBoost) * 0.66, width * 0.36)));
  const mouthY = heroH - charSize + charSize * 0.62;
  const bubbleLeft = layout.screenPadding + charSize * 0.84;
  // Mo hops across the hero as the pages change: left, right, left.
  const moLeftX = layout.screenPadding - charSize * 0.06;
  const moRightX = width - layout.screenPadding - charSize * 0.94;
  const moSide = MO_SIDES[page] || 'left';
  const bubbleBottom = Math.max(space.xs, Math.round(heroH - mouthY - 20));

  useEffect(() => {
    voice.prepare();
  }, []);

  // Speak each page's line the first time it shows (not again on return from
  // the phone screen); unmuting replays the current line with voice.
  const speakNow = voiceOn && (forceSpeak === page || !spoken.current.has(page));
  useEffect(() => {
    if (!focused) return;
    spoken.current.add(page);
    setForceSpeak(-1);
  }, [page, focused, playKey]);

  const firstPage = useRef(true);
  useEffect(() => {
    setSettled(false);
    if (firstPage.current) firstPage.current = false;
    else sfx.play('whoosh');
  }, [page]);

  // Follows the swipe: slides between sides on an arc, leaning into the jump.
  const moStyle = useAnimatedStyle(() => {
    const pos = width ? scrollX.value / width : 0;
    const xs = MO_SIDES.map((sd) => (sd === 'left' ? moLeftX : moRightX));
    const x = interpolate(
      pos,
      xs.map((_, k) => k),
      xs,
      Extrapolation.CLAMP
    );
    const lo = Math.max(0, Math.min(xs.length - 1, Math.floor(pos)));
    const hi = Math.max(0, Math.min(xs.length - 1, Math.ceil(pos)));
    const frac = pos - Math.floor(pos);
    const dir = Math.sign(xs[hi] - xs[lo]);
    const run = lo === hi ? 0 : Math.min(1, Math.sin(Math.PI * frac) * 2.2); // full speed quickly
    const bounce = -Math.abs(Math.sin(frac * Math.PI * 6)) * 4 * run; // little running steps
    return {
      transform: [
        { translateX: x },
        { translateY: bounce },
        { rotate: `${dir * run * 12}deg` },
        { scaleX: 1 + run * 0.12 },
        { scaleY: 1 - run * 0.08 },
      ],
    };
  });
  const trailFade = useSharedValue(0);
  const trailSeg = useSharedValue(0);
  useAnimatedReaction(
    () => (width ? scrollX.value / width : 0),
    (pos) => {
      const seg = Math.max(0, Math.min(MO_SIDES.length - 2, Math.floor(pos)));
      const frac = pos - seg;
      if (frac > 0.01 && frac < 0.99) {
        cancelAnimation(trailFade);
        trailFade.value = 1;
        trailSeg.value = seg;
      } else if (trailFade.value > 0.99) {
        trailFade.value = withDelay(120, withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }));
      }
    }
  );

  // The bubble steps aside while Mo is mid-dash.
  const bubbleFade = useAnimatedStyle(() => {
    const pos = width ? scrollX.value / width : 0;
    const frac = pos - Math.floor(pos);
    return { opacity: 1 - Math.min(1, Math.sin(Math.PI * frac) * 2.4) };
  });

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const goTo = (i) => {
    startDash();
    const next = Math.max(0, Math.min(PAGES.length - 1, i));
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };

  const leave = (params) => {
    voice.stop();
    sfx.play(params?.mode === 'login' ? 'tick' : 'chime');
    setPrefs({ introSeen: true });
    nav.navigate('phone_entry', params);
  };

  const p = PAGES[page];
  const last = page === PAGES.length - 1;
  const charState = talking ? p.during : settled ? p.after : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: isDark() ? colors.canvas : colors.periwinkle }}>
      <StatusBar
        barStyle={isDark() ? 'light-content' : 'dark-content'}
        backgroundColor={isDark() ? colors.canvas : colors.periwinkle}
      />

      {/* top bar */}
      <View style={{ paddingTop: insets.top, paddingHorizontal: layout.screenPadding }}>
        <View style={{ height: TOPBAR, flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="h3" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
            Come Over
          </AppText>
          <VoiceToggle
            tone="glass"
            onChange={(on) => {
              if (on) {
                setForceSpeak(page);
                setPlayKey((k) => k + 1);
              }
            }}
          />
          <Pressable
            onPress={() => leave()}
            accessibilityRole="button"
            accessibilityLabel="Skip intro"
            hitSlop={6}
            style={({ pressed }) => ({
              marginLeft: space.xs,
              minHeight: layout.minTouch,
              paddingLeft: space.md,
              paddingRight: space.sm,
              borderRadius: radius.pill,
              backgroundColor: glass(0.55),
              flexDirection: 'row',
              alignItems: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <AppText variant="bodyStrong" maxScale={1.2}>
              Skip
            </AppText>
            <Icon name="chevron-right" size={16} color={colors.ink} style={{ marginLeft: 2 }} />
          </Pressable>
        </View>
      </View>

      {/* pages */}
      <View style={{ flex: 1 }}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={startDash}
          onMomentumScrollEnd={(e) => {
            endDash();
            setPage(Math.round(e.nativeEvent.contentOffset.x / width));
          }}
          style={{ flex: 1 }}
        >
          {PAGES.map((pg, i) => (
            <Page key={pg.key} p={pg} i={i} width={width} heroH={heroH} charSize={charSize} scrollX={scrollX} />
          ))}
        </Animated.ScrollView>

        {/* Mo + speech bubble, fixed above the pages */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: heroH }}>
          {TRAIL.map((line, k) => (
            <TrailLine
              key={k}
              line={line}
              scrollX={scrollX}
              pageW={width}
              seg={trailSeg}
              fade={trailFade}
              xL={moLeftX + charSize / 2}
              xR={moRightX + charSize / 2}
              top={heroH - charSize}
              size={charSize}
            />
          ))}
          <Animated.View
            style={[
              { position: 'absolute', left: 0, top: heroH - charSize, width: charSize, height: charSize },
              moStyle,
            ]}
          >
            <GuideCharacter
              size={charSize}
              state={dashing ? 'happy' : charState}
              talking={talking && !dashing}
              autoHop={false}
            />
          </Animated.View>
          <Animated.View
            key={moSide}
            style={[
              { position: 'absolute', bottom: bubbleBottom },
              moSide === 'left'
                ? { left: bubbleLeft, right: layout.screenPadding }
                : { left: layout.screenPadding, right: width - (moRightX + charSize * 0.1) },
              bubbleFade,
            ]}
          >
            <GuideBubble
              text={p.line}
              active={focused}
              speak={speakNow}
              playKey={playKey}
              tail={moSide}
              tailAlign="end"
              tailOffset={10} // arrow centre level with Mo's mouth
              onTalkingChange={setTalking}
              onDone={() => setSettled(true)}
              maxScale={1.25}
            />
          </Animated.View>
        </View>
      </View>

      {/* footer */}
      <View
        style={{
          paddingHorizontal: layout.screenPadding,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {PAGES.map((pg, i) => (
              <Dot key={pg.key} i={i} width={width} scrollX={scrollX} onPress={() => goTo(i)} />
            ))}
          </View>
          <Button
            title={last ? 'Get started' : 'Next'}
            iconRight="arrow-right"
            full={false}
            style={{ minWidth: 148 }}
            onPress={() => (last ? leave() : goTo(page + 1))}
          />
        </View>
        <Button
          title="I already have an account"
          variant="ghost"
          size="sm"
          style={{ marginTop: space.xs }}
          onPress={() => leave({ mode: 'login' })}
        />
      </View>
    </View>
  );
}
