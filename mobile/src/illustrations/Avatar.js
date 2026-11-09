// Personality avatars (DiceBear "Avataaars", design by Pablo Stanley, free for
// personal and commercial use), deterministic from a seed so the same person
// always renders the same way. A photo `uri` always wins. Seeds are either a
// picked vibe ("v1.nerd.2.0.1", see avatarPresets.js) or any legacy string
// (user id, 'me-irl'), which maps to a stable preset.
//
// Rendering is cached per seed (SVG generated and parsed once), so long lists
// stay cheap. `animated` adds a gentle idle bob and a blink; use it only for a
// single hero avatar (picker preview, your own profile), never in lists.
import React, { useEffect } from 'react';
import { Image, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SvgAst, parse } from 'react-native-svg';
import { createAvatar } from '@dicebear/core';
import * as avataaars from '@dicebear/avataaars';
import { colors, fonts } from '../theme/tokens';
import { decodeAvatar, isEncodedAvatar } from './avatarPresets';
import { useAppStore } from '../store/useAppStore';

const FILL = { width: '100%', height: '100%' };
const CACHE_LIMIT = 300;
const cache = new Map();

// seed → { ast, bg } where bg is a theme token name (resolved at render time).
// `blink` renders the same character with closed eyes (for the blink layer).
export function avatarArt(seed, blink = false) {
  const key = `${blink ? 'b|' : ''}${seed == null ? '' : seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = decodeAvatar(seed);
  let ast = null;
  try {
    const svg = createAvatar(avataaars, blink ? { ...spec.options, eyes: ['closed'] } : spec.options)
      .toString()
      .replace(/<metadata[\s\S]*?<\/metadata>/, ''); // licence RDF block: not drawable
    ast = parse(svg);
  } catch (e) {
    ast = null; // fall back to the plain coloured circle
  }
  const art = { ast, bg: spec.bg };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, art);
  return art;
}

// Idle life for a hero avatar: a slow bob (the character dips a few percent
// inside its circle, never revealing an edge) and a quick blink every few
// seconds. Transform/opacity only; nothing runs under Reduce Motion.
function LiveArt({ seed, ast, size }) {
  const reduce = useReducedMotion();
  const bob = useSharedValue(0);
  const lid = useSharedValue(0);

  useEffect(() => {
    if (reduce) return undefined;
    bob.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    lid.value = withRepeat(
      withSequence(withDelay(3600, withTiming(1, { duration: 60 })), withDelay(110, withTiming(0, { duration: 80 }))),
      -1,
      false
    );
    return () => {
      cancelAnimation(bob);
      cancelAnimation(lid);
      bob.value = 0;
      lid.value = 0;
    };
  }, [reduce, bob, lid]);

  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value * size * 0.035 }] }));
  const lidStyle = useAnimatedStyle(() => ({ opacity: lid.value }));
  const closed = reduce ? null : avatarArt(seed, true).ast;

  return (
    <Animated.View style={[{ width: '100%', height: '100%' }, bobStyle]}>
      <SvgAst ast={ast} override={FILL} />
      {closed ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, lidStyle]}>
          <SvgAst ast={closed} override={FILL} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function Avatar({ seed: seedProp = 'irl', size = 44, uri, ring = false, ringColor = colors.surface, label, animated = false }) {
  // Screens often pass a user id: use that person's chosen avatar when the
  // user cache has one ('me' → your own), otherwise the id gives a stable preset.
  const chosen = useAppStore((s) => (isEncodedAvatar(seedProp) ? null : seedProp === 'me' ? s.profile.avatarSeed : s.users?.[seedProp]?.avatarSeed));
  const seed = isEncodedAvatar(chosen) ? chosen : seedProp;
  const border = ring ? Math.max(2, Math.round(size / 18)) : 0;
  const art = uri ? null : avatarArt(seed);
  return (
    <View
      accessible={!!label}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: art ? colors[art.bg] || colors.periwinkleSoft : colors.surfaceSubtle,
        borderWidth: border,
        borderColor: ringColor,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />
      ) : art.ast ? (
        animated ? (
          <LiveArt seed={seed} ast={art.ast} size={size} />
        ) : (
          <SvgAst ast={art.ast} override={FILL} />
        )
      ) : null}
    </View>
  );
}

const MemoAvatar = React.memo(Avatar);
export default MemoAvatar;

export function AvatarStack({ seeds = [], size = 28, max = 4, extra = 0, ringColor = colors.surface }) {
  const shown = seeds.slice(0, max);
  const overflow = extra + Math.max(0, seeds.length - max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`${seeds.length + extra} people`}>
      {shown.map((s, i) => (
        <View key={s + i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32, zIndex: max - i }}>
          <MemoAvatar seed={s} size={size} ring ringColor={ringColor} />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={{
            marginLeft: -size * 0.32,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.ink,
            borderWidth: 2,
            borderColor: ringColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text maxFontSizeMultiplier={1.2} style={{ color: colors.white, fontFamily: fonts.bold, fontSize: Math.max(9, size * 0.34) }}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  );
}
