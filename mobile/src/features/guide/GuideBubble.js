// Speech bubble for Mo: typewriter reveal, optional voice, tail pointing back
// at the character, a light haptic tick when a new line appears.
//
//   <GuideBubble text="Hi, I'm Mo!" tail="left" active speak
//                onTalkingChange={setTalking} onDone={...} />
//
//   active          only the active bubble types and speaks; an inactive one
//                   shows its full text (e.g. pages of the intro carousel).
//   speak           read the line aloud (services/voice) when it activates.
//   playKey         change it to replay the line (typing + voice).
//   tail            'left' | 'right' | 'top' | 'bottom' — the side Mo is on.
//   tailAlign       'start' (default) measures tailOffset from the top
//                   (left/right tails) or left edge (top/bottom tails);
//                   'end' from the bottom / right edge.
//   tailOffset      distance of the tail from that edge.
//   onTalkingChange (talking: bool) — true while the voice is speaking, or
//                   while typing when there is no voice. Drive Mo's mouth.
//
// Layout never jumps while typing: the untyped part is rendered transparent.
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText } from '@/components';
import { colors, fonts, radius, shadow, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import voice from '@/services/voice';


let screenReader = false;
let srChecked = false;
const checkScreenReader = () => {
  if (srChecked) return;
  srChecked = true;
  try {
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        screenReader = !!on;
      })
      .catch(() => null);
    AccessibilityInfo.addEventListener('screenReaderChanged', (on) => {
      screenReader = !!on;
    });
  } catch (e) {
    // ignore
  }
};

// Typewriter + voice for one line. Returns how many characters are revealed
// and whether Mo should be talking right now.
export function useGuideLine({ text, active = true, speak = true, playKey }) {
  const reduce = useReducedMotion();
  const line = text || '';
  const [count, setCount] = useState(active ? 0 : line.length);
  const [typing, setTyping] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [runId, setRunId] = useState(0);
  const speakRef = useRef(speak);
  speakRef.current = speak;

  useEffect(() => {
    checkScreenReader();
  }, []);

  useEffect(() => {
    if (!active || !line) {
      setCount(line.length);
      setTyping(false);
      return undefined;
    }
    let alive = true;
    let timer;
    let token = 0;
    setRunId((r) => r + 1);
    haptics.light();
    sfx.play('pop');
    if (speakRef.current) {
      token = voice.speak(line, {
        onStart: () => alive && setSpeaking(true),
        onDone: () => alive && setSpeaking(false),
      });
    }
    setTyping(true);
    if (reduce || screenReader) {
      // No typewriter: show the line, keep Mo "talking" for a beat so the
      // moment still reads as speech when there's no voice.
      setCount(line.length);
      timer = setTimeout(() => alive && setTyping(false), Math.min(2600, 400 + line.length * 22));
    } else {
      setCount(0);
      let i = 0;
      const step = () => {
        if (!alive) return;
        i += 1;
        setCount(i);
        if (i >= line.length) {
          setTyping(false);
          return;
        }
        const ch = line[i - 1];
        timer = setTimeout(step, /[.!?]/.test(ch) && line[i] === ' ' ? 240 : /[,;:—–]/.test(ch) ? 110 : 26);
      };
      timer = setTimeout(step, 160);
    }
    return () => {
      alive = false;
      clearTimeout(timer);
      if (token) voice.stop(token);
      setSpeaking(false);
      setTyping(false);
    };
  }, [line, active, playKey, reduce]);

  return { count: Math.min(count, line.length), talking: typing || speaking, typing, speaking, runId };
}

// The arrow is a real triangle (SVG) that tucks 2pt into the bubble, so its
// fill covers the bubble's border where they meet and only the two outer edges
// carry the border: one continuous outline, no seams or notches.
const TAIL_W = 11; // how far it sticks out
const TAIL_H = 20; // base length along the bubble edge
const TUCK = 2;
const BORDER = 1.5;
function Tail({ side, offset, align }) {
  const vertical = side === 'left' || side === 'right';
  const w = vertical ? TAIL_W + TUCK : TAIL_H;
  const h = vertical ? TAIL_H : TAIL_W + TUCK;
  const end = align === 'end';
  // Triangle points, with the tip on the outside and the base inside the bubble.
  const pts = {
    left: [[w, 0], [0, h / 2], [w, h]],
    right: [[0, 0], [w, h / 2], [0, h]],
    top: [[0, h], [w / 2, 0], [w, h]],
    bottom: [[0, 0], [w / 2, h], [w, 0]],
  }[side];
  if (!pts) return null;
  const pos = {
    left: { left: -TAIL_W, [end ? 'bottom' : 'top']: offset },
    right: { right: -TAIL_W, [end ? 'bottom' : 'top']: offset },
    top: { top: -TAIL_W, [end ? 'right' : 'left']: offset },
    bottom: { bottom: -TAIL_W, [end ? 'right' : 'left']: offset },
  }[side];
  const [a, b, c] = pts.map(([x, y]) => `${x} ${y}`);
  // Outline only the two outer edges, stopping exactly at the bubble's edge
  // (the tucked-in part is hidden by the bubble's own border).
  const k = TUCK / (TAIL_W + TUCK); // share of each edge that lies inside the bubble
  const lerp = ([x1, y1], [x2, y2], t) => `${x1 + (x2 - x1) * t} ${y1 + (y2 - y1) * t}`;
  const e1 = lerp(pts[0], pts[1], k);
  const e2 = lerp(pts[2], pts[1], k);
  return (
    <Svg pointerEvents="none" width={w} height={h} style={{ position: 'absolute', ...pos }}>
      <Path d={`M${a} L${b} L${c} Z`} fill={colors.surface} />
      <Path d={`M${e1} L${b} L${e2}`} stroke={colors.border} strokeWidth={BORDER} strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export default function GuideBubble({
  text,
  title,
  active = true,
  speak = true,
  playKey,
  tail = 'left',
  tailAlign = 'start',
  tailOffset = 22,
  onTalkingChange,
  onDone,
  onPress,
  style,
  maxScale = 1.25,
  children,
}) {
  const reduce = useReducedMotion();
  const { count, talking, typing, speaking, runId } = useGuideLine({ text, active, speak, playKey });
  const pop = useSharedValue(1);
  const doneFor = useRef(-1);

  useEffect(() => {
    onTalkingChange?.(talking);
  }, [talking]);

  useEffect(() => {
    if (!active || runId === 0 || typing || speaking || doneFor.current === runId) return;
    doneFor.current = runId;
    onDone?.();
  }, [active, runId, typing, speaking]);

  // Pop in from the tail each time a new line starts.
  useEffect(() => {
    if (!active || runId === 0 || reduce) return;
    pop.value = 0;
    pop.value = withSpring(1, { damping: 13, stiffness: 230, mass: 0.7 });
  }, [runId]);

  const a = tailAlign === 'end' ? '80%' : '20%';
  const origin = { left: `0% ${a}`, right: `100% ${a}`, top: `${a} 0%`, bottom: `${a} 100%` }[tail] || '50% 50%';
  const popStyle = useAnimatedStyle(() => ({ opacity: 0.3 + pop.value * 0.7, transform: [{ scale: 0.86 + pop.value * 0.14 }] }));

  const line = text || '';
  const label = title ? `${title}. ${line}` : line;
  const body = (
    <>
      {!!title && (
        <AppText variant="label" caps color={colors.deep} style={{ marginBottom: 2 }} maxScale={maxScale}>
          {title}
        </AppText>
      )}
      <AppText variant="body" maxScale={maxScale} style={{ fontFamily: fonts.medium }}>
        <Text>{line.slice(0, count)}</Text>
        <Text style={{ color: 'transparent' }}>{line.slice(count)}</Text>
      </AppText>
    </>
  );

  const box = [
    {
      backgroundColor: colors.surface,
      borderRadius: radius.card - 4,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      transformOrigin: origin,
    },
    shadow.card,
    popStyle,
    style,
  ];

  return (
    <Animated.View style={box} accessibilityLiveRegion="polite">
      <Tail side={tail} offset={tailOffset} align={tailAlign} />
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Plays the line again" hitSlop={8}>
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label}>
          {body}
        </View>
      )}
      {children}
    </Animated.View>
  );
}
