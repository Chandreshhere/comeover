// Live radar: a friendly "nearby" view. You sit in the middle; plans and
// people sit on their coarse distance band at a stable pseudo-bearing (hash
// of the id) — never real positions or directions. Flat and light: three thin
// solid rings straight on the page (no disc, no sweep, no ticks), small pill
// labels on the rings, avatars and plan bubbles as blips.
// All motion — the "you are here" ripple, the blips' gentle bob and the
// one-off refresh ring — is driven on the UI thread (Reanimated) from shared
// values, so there are no per-frame React renders. Reduce Motion: still.
// Rings are SVG circles or Views with an exact borderRadius that are only
// ever translated, never scaled, so they always render perfectly round.
import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import { AppText, Avatar, Pictogram } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, isDark, palettes, shadow } from '@/theme/tokens';
import { durations, fadeIn } from '@/theme/motion';
import { hashStr } from '@/features/discover/utils';

// `edge` = the ring that closes each band, as a fraction of the outer ring's
// radius. Rings are spaced for legibility, not to scale.
export const BANDS = [
  { id: 'b1', label: '< 1 km', ring: '< 1 km', maxM: 1000, edge: 0.46 },
  { id: 'b2', label: '1–3 km', ring: '3 km', maxM: 3000, edge: 0.74 },
  { id: 'b3', label: '3–10 km', ring: '10 km', maxM: 10000, edge: 1 },
];

export const bandFor = (m) => BANDS.find((b) => (m ?? 0) <= b.maxM) || BANDS[BANDS.length - 1];

// One clock turn = two "you are here" ripple bursts (every 2.4 s) and one
// slow bob of the blips.
const CYCLE_MS = 4800;
const BOB = 2; // pt, up and down
const RIPPLE_SPAN = 0.56; // share of a 2.4 s burst one ripple takes to fade out
const RIPPLE_GAP = 0.2; // the second ripple trails the first by this share
const LABEL_H = 18;

// ---------- colour ----------
// Hex in, hex out, so every derived colour can be fed back into alpha().
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) =>
    Math.round(v + (B[i] - v) * t)
      .toString(16)
      .padStart(2, '0')
  ).join('')}`;
};

// A function, not a constant: call it at render time so it follows the
// scheme. Status colours (free now / later, plan soon / later) come from the
// fixed light palette: they read well on the pastel page and on true black.
export function radarColors() {
  const L = palettes.light;
  const dark = isDark();
  return {
    ring: dark ? colors.border : colors.periwinkleSoft,
    zone: dark ? mix(colors.canvas, colors.surface, 0.6) : colors.periwinkleWash,
    pulse: L.periwinkle,
    pulsePeak: dark ? 0.55 : 0.9,
    label: colors.muted,
    labelBg: colors.surface,
    now: mix(L.mint, L.success, 0.45),
    later: L.pink,
    select: colors.ink,
    planSoon: { fill: colors.orangeSoft, stroke: L.orange },
    planLater: { fill: dark ? mix(L.periwinkle, colors.canvas, 0.8) : colors.periwinkleSoft, stroke: L.periwinkle },
    glyph: colors.ink,
  };
}

// ---------- geometry ----------
// Bearings are compass degrees: 0 = up, clockwise.
function polar(c, bearing, dist) {
  const a = (bearing * Math.PI) / 180;
  return { x: c + dist * Math.sin(a), y: c - dist * Math.cos(a) };
}

// Range labels sit on top of their ring, in a column above "you".
const labelBox = (b, c, R) => ({
  x: c,
  y: c - b.edge * R,
  hw: ((b.ring.length + 5) * 6) / 2 + 8, // room for a "· +3" overflow count
  hh: LABEL_H / 2 + 2,
});

// Pixel range a blip centre may use inside its band: clear of the ring that
// opens the band, "you" in the middle and the outer ring.
function bandRange(band, R, blip, core) {
  const i = BANDS.indexOf(band);
  const prev = i > 0 ? BANDS[i - 1].edge * R : 0;
  const lo = Math.max(prev + 6, core + 4 + blip / 2);
  const hi = Math.min(band.edge * R - 6, R - blip / 2 - 3);
  return [lo, Math.max(lo, hi)];
}

// Gap between a blip at `p` and something already on the radar: a circle
// ({ r }) or a label pill ({ hw, hh }).
function gap(q, p, half) {
  if (q.hw != null) {
    const dx = Math.max(Math.abs(p.x - q.x) - q.hw, 0);
    const dy = Math.max(Math.abs(p.y - q.y) - q.hh, 0);
    return Math.hypot(dx, dy) - half;
  }
  return Math.hypot(q.x - p.x, q.y - p.y) - q.r - half;
}

// Stable pseudo-bearing from the id hash + a jittered radius inside the
// item's coarse distance band (the same scheme the radar always used).
// A blip that would cover another blip or a label is nudged around its own
// band; the band — the only real signal — never changes. When a band is too
// crowded the leftovers are hidden and counted ("+3" on the band's label);
// everyone is still in the list below the radar.
function placeBlips(entries, c, R, blip, core) {
  const half = blip / 2;
  const placed = [{ x: c, y: c, r: core + 2 }, ...BANDS.map((b) => labelBox(b, c, R))];
  return entries.map((e) => {
    const h = hashStr(String(e.seed));
    const band = bandFor(e.distanceM);
    const [lo, hi] = bandRange(band, R, blip, core);
    const baseBearing = ((h % 360) + 90) % 360;
    const baseT = ((h >> 8) % 100) / 100;
    let best = null;
    for (let k = 0; k < 25 && !best?.clear; k++) {
      const hop = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15;
      const bearing = (((baseBearing + hop) % 360) + 360) % 360;
      for (let j = 0; j < 4 && !best?.clear; j++) {
        const p = polar(c, bearing, lo + (j === 0 ? baseT : [0.1, 0.9, 0.5][j - 1]) * (hi - lo));
        let room = Infinity; // distance to the nearest thing already on the radar
        placed.forEach((q) => {
          room = Math.min(room, gap(q, p, half));
        });
        if (!best || room > best.room) best = { ...p, bearing, room, clear: room >= 5 };
      }
    }
    if (best.room < -2) return { ...e, band, hidden: true };
    placed.push({ x: best.x, y: best.y, r: half });
    // Bob phase: staggered per blip, stable per id.
    return { ...e, x: best.x, y: best.y, band, phase: ((h >> 4) % 100) / 100 };
  });
}

// ---------- motion ----------
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// "You are here": two soft rings grow out of your avatar and fade, every
// 2.4 s. Animates the SVG radius (not a scale), so the stroke stays 1.5 pt.
function Ripple({ clock, index, c, from, to, color, peak, reduce }) {
  const props = useAnimatedProps(() => {
    if (reduce) return { r: from, opacity: 0 };
    const t = (clock.value * 2) % 1;
    const q = (t - index * RIPPLE_GAP) / RIPPLE_SPAN;
    if (q <= 0 || q >= 1) return { r: from, opacity: 0 };
    const eased = 1 - (1 - q) * (1 - q);
    return { r: from + (to - from) * eased, opacity: peak * (1 - q) };
  }, [reduce, index, from, to, peak]);
  return (
    <AnimatedCircle
      cx={c}
      cy={c}
      r={from}
      opacity={0}
      fill={color}
      fillOpacity={0.14}
      stroke={color}
      strokeWidth={1.5}
      animatedProps={props}
    />
  );
}

// One ring out to the edge per successful refresh.
function RefreshRing({ progress, c, from, to, color, peak }) {
  const props = useAnimatedProps(
    () => ({ r: from + (to - from) * progress.value, opacity: progress.value >= 1 ? 0 : peak * (1 - progress.value) }),
    [from, to, peak]
  );
  return (
    <AnimatedCircle cx={c} cy={c} r={from} opacity={0} fill="none" stroke={color} strokeWidth={1.5} animatedProps={props} />
  );
}

// A blip: positioned once, then only translated up and down on the UI thread.
function Blip({ e, box, clock, reduce, hit, onPress, label, selected, children }) {
  const bob = useAnimatedStyle(
    () => ({
      transform: [{ translateY: reduce ? 0 : BOB * Math.sin(2 * Math.PI * (clock.value + e.phase)) }],
    }),
    [reduce, e.phase]
  );
  return (
    <Animated.View
      entering={fadeIn()}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: e.x - box / 2, top: e.y - box / 2, width: box, height: box }}
    >
      <Animated.View pointerEvents="box-none" style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, bob]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={selected ? { selected: true } : undefined}
          hitSlop={Math.max(4, (44 - hit) / 2)}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// Someone free: their avatar inside a thin status ring (mint = now, pink =
// later), split from the ring by a hairline of card colour. Selected: a bit
// larger, with a solid ink ring around it.
function PersonDot({ p, d, ring, rc, selected }) {
  const size = selected ? d + 6 : d;
  const stroke = selected ? 3 : 2;
  const outer = size + 8;
  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      {selected && (
        <View
          style={{
            position: 'absolute',
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: 2,
            borderColor: rc.select,
          }}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: ring,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Avatar seed={p.id} uri={p.avatarUrl} size={size - stroke * 2} ring ringColor={colors.surface} />
      </View>
    </View>
  );
}

// A plan: a small pastel bubble with its activity glyph (orange = starts
// within 30 minutes, periwinkle = later).
function PlanDot({ a, d, tone, rc }) {
  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: tone.fill,
        borderWidth: 1.5,
        borderColor: tone.stroke,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pictogram name={a.pictogram} size={Math.round(d * 0.56)} color={rc.glyph} />
    </View>
  );
}

const NONE = [];
const startsSoon = (a) => !!a.live || new Date(a.startsAt) - Date.now() < 30 * 60000;

export default function Radar({
  size,
  items = NONE,
  people = NONE,
  band = 'all',
  pulseKey,
  onPressItem,
  onPressPerson,
  selectedPersonId,
}) {
  const reduce = useReducedMotion();
  const focused = useIsFocused();
  const meSeed = useAppStore((s) => s.profile.avatarSeed);
  const meUri = useAppStore((s) => s.profile.avatarUri);
  const rc = radarColors();

  const c = size / 2;
  const R = c - LABEL_H / 2 - 1; // the outer ring; its label pill still fits
  const D = Math.round(Math.max(34, Math.min(42, size * 0.115))); // person blip
  const P = Math.round(D * 0.84); // plan bubble
  const ME = size >= 300 ? 44 : 40;
  const core = ME / 2 + 3; // your avatar + its white ring
  const box = D + 14; // room for the selected state

  const clock = useSharedValue(0);
  const refresh = useSharedValue(1);

  // Ripple + bob: only while this tab is on screen. Resume where it paused.
  useEffect(() => {
    if (reduce) {
      cancelAnimation(clock);
      clock.value = 0;
      return undefined;
    }
    if (!focused) return undefined;
    const from = clock.value % 1;
    clock.value = from;
    clock.value = withRepeat(withTiming(from + 1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(clock);
  }, [focused, reduce]);

  // One ring out to the edge per successful refresh.
  useEffect(() => {
    if (reduce) return;
    refresh.value = 0;
    refresh.value = withTiming(1, { duration: durations.radarPulse * 1.4, easing: Easing.out(Easing.quad) });
  }, [pulseKey, reduce]);

  const { blips, hidden } = useMemo(() => {
    // Interleave plans and people so a crowded band hides a fair mix.
    const plans = items.map((a) => ({ key: `a:${a.id}`, seed: a.id, kind: 'plan', item: a, distanceM: a.distanceM }));
    const folks = people.map((p) => ({
      key: `p:${p.id}`,
      seed: p.id,
      kind: 'person',
      item: p,
      distanceM: p.distanceM,
    }));
    const entries = [];
    for (let i = 0; i < Math.max(plans.length, folks.length); i++) {
      if (plans[i]) entries.push(plans[i]);
      if (folks[i]) entries.push(folks[i]);
    }
    const all = placeBlips(entries, c, R, D, core);
    const extra = {};
    all.forEach((e) => {
      if (e.hidden) extra[e.band.id] = (extra[e.band.id] || 0) + 1;
    });
    return { blips: all.filter((e) => !e.hidden), hidden: extra };
  }, [items, people, c, R, D, core]);

  // The zone you're looking at gets a faint fill: the inner circle by
  // default, or the band picked in the distance filter.
  const sel = BANDS.findIndex((b) => b.id === band);
  const zoneIn = sel > 0 ? BANDS[sel - 1].edge * R : 0;
  const zoneOut = (sel >= 0 ? BANDS[sel] : BANDS[0]).edge * R;

  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size} style={{ position: 'absolute' }} pointerEvents="none">
        {zoneIn > 0 ? (
          <Circle
            cx={c}
            cy={c}
            r={(zoneIn + zoneOut) / 2}
            fill="none"
            stroke={rc.zone}
            strokeWidth={zoneOut - zoneIn}
          />
        ) : (
          <Circle cx={c} cy={c} r={zoneOut} fill={rc.zone} />
        )}
        {BANDS.map((b) => (
          <Circle key={b.id} cx={c} cy={c} r={b.edge * R} fill="none" stroke={rc.ring} strokeWidth={1.25} />
        ))}
        {[0, 1].map((i) => (
          <Ripple
            key={i}
            clock={clock}
            index={i}
            c={c}
            from={core}
            to={R * 0.62}
            color={rc.pulse}
            peak={rc.pulsePeak}
            reduce={reduce}
          />
        ))}
        <RefreshRing progress={refresh} c={c} from={core} to={R} color={rc.pulse} peak={rc.pulsePeak} />
      </Svg>

      {/* range labels: tiny pills on top of each ring (the pill masks the line) */}
      {BANDS.map((b) => {
        const on = band === b.id;
        const n = hidden[b.id];
        return (
          <View
            key={b.id}
            pointerEvents="none"
            accessible={!!n}
            accessibilityLabel={n ? `${n} more ${b.label} away, listed below` : undefined}
            style={{
              position: 'absolute',
              left: c - 60,
              top: c - b.edge * R - LABEL_H / 2,
              width: 120,
              height: LABEL_H,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                height: LABEL_H,
                paddingHorizontal: 7,
                borderRadius: LABEL_H / 2,
                justifyContent: 'center',
                backgroundColor: on ? colors.ink : rc.labelBg,
                borderWidth: 1,
                borderColor: on ? colors.ink : rc.ring,
              }}
            >
              <AppText
                variant="caption"
                color={on ? colors.white : rc.label}
                maxScale={1.15}
                numberOfLines={1}
                style={{ fontSize: 10, lineHeight: 13 }}
              >
                {n ? `${b.ring} · +${n}` : b.ring}
              </AppText>
            </View>
          </View>
        );
      })}

      {/* you: your own avatar in a white ring — an origin, not a map position */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: c - core,
          top: c - core,
          width: core * 2,
          height: core * 2,
          borderRadius: core,
          backgroundColor: colors.pureWhite,
          alignItems: 'center',
          justifyContent: 'center',
          ...shadow.card,
        }}
      >
        <Avatar seed={meSeed} uri={meUri} size={ME} />
      </View>

      {blips.map((e) => {
        if (e.kind === 'person') {
          const p = e.item;
          const now = p.availability === 'now';
          const selected = selectedPersonId === p.id;
          return (
            <Blip
              key={e.key}
              e={e}
              box={box}
              clock={clock}
              reduce={reduce}
              hit={D}
              selected={selected}
              onPress={() => onPressPerson?.(p)}
              label={`${p.name || 'Someone'}, free ${now ? 'now' : 'later today'}, ${e.band.label} away`}
            >
              <PersonDot p={p} d={D} ring={now ? rc.now : rc.later} rc={rc} selected={selected} />
            </Blip>
          );
        }
        const a = e.item;
        const soon = startsSoon(a);
        return (
          <Blip
            key={e.key}
            e={e}
            box={box}
            clock={clock}
            reduce={reduce}
            hit={P}
            onPress={() => onPressItem?.(a)}
            label={`${a.title}, ${soon ? 'starting soon' : 'later'}, ${e.band.label} away`}
          >
            <PlanDot a={a} d={P} tone={soon ? rc.planSoon : rc.planLater} rc={rc} />
          </Blip>
        );
      })}
    </View>
  );
}
