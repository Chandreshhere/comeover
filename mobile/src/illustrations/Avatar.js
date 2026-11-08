// Original illustrated avatars, deterministic from a seed string so the same
// person always renders the same way. Used until a user uploads a photo.
import React from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, fonts } from '../theme/tokens';

const SKIN = ['#F5D0B5', '#E8B48F', '#D29B72', '#B57B52', '#8D5A3B', '#6B4128'];
const HAIR = ['#1B1B1F', '#3A2618', '#5C3A21', '#2A2A3A', '#8A4B2A'];
const SHIRT = [colors.ink, colors.orange, colors.deep, colors.pink, colors.success, '#F4D35E'];
const BG = [colors.periwinkle, colors.orange, colors.pink, colors.lavender, colors.mint, '#F4D35E'];

const HAIR_PATHS = [
  'M19 27 C18 16 26 11 33 11 C41 11 47 17 45 27 C42 21 36 19 30 20 C25 21 21 23 19 27 Z',
  'M18 28 C17 15 25 10 32 10 C40 10 47 15 46 28 L47 44 C44 46 42 42 43 36 C40 24 24 24 21 36 C22 42 20 46 17 44 Z',
  'M19 27 C18 16 26 12 33 12 C41 12 47 17 45 27 C43 22 38 20 32 20 C26 20 21 22 19 27 Z',
  null, // curly — drawn with circles
];

function hash(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function avatarTraits(seed) {
  const h = hash(String(seed));
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >> 3) % HAIR.length],
    shirt: SHIRT[(h >> 5) % SHIRT.length],
    bg: BG[(h >> 7) % BG.length],
    style: (h >> 9) % 4,
    bun: ((h >> 11) % 5) === 0,
  };
}

export default function Avatar({ seed = 'irl', size = 44, uri, ring = false, ringColor = colors.white, label }) {
  const t = avatarTraits(seed);
  const border = ring ? Math.max(2, Math.round(size / 18)) : 0;
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
        backgroundColor: t.bg,
        borderWidth: border,
        borderColor: ringColor,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Svg width="100%" height="100%" viewBox="0 0 64 64">
          <Path d="M10 66 C12 50 22 44 32 44 C42 44 52 50 54 66 Z" fill={t.shirt} />
          <Rect x="28" y="36" width="8" height="10" rx="3" fill={t.skin} />
          <Circle cx="32" cy="28" r="13" fill={t.skin} />
          {t.style === 3 ? (
            <>
              <Circle cx="21" cy="23" r="6" fill={t.hair} />
              <Circle cx="27" cy="17" r="6" fill={t.hair} />
              <Circle cx="35" cy="16" r="6" fill={t.hair} />
              <Circle cx="42" cy="20" r="6" fill={t.hair} />
              <Circle cx="45" cy="27" r="4.5" fill={t.hair} />
            </>
          ) : (
            <Path d={HAIR_PATHS[t.style]} fill={t.hair} />
          )}
          {t.bun && <Circle cx="32" cy="10" r="5.5" fill={t.hair} />}
          <Circle cx="27" cy="29" r="1.6" fill={colors.ink} />
          <Circle cx="37" cy="29" r="1.6" fill={colors.ink} />
          <Path d="M28 34 C30 36.5 34 36.5 36 34" stroke={colors.ink} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

export function AvatarStack({ seeds = [], size = 28, max = 4, extra = 0, ringColor = colors.white }) {
  const shown = seeds.slice(0, max);
  const overflow = extra + Math.max(0, seeds.length - max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`${seeds.length + extra} people`}>
      {shown.map((s, i) => (
        <View key={s + i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32, zIndex: max - i }}>
          <Avatar seed={s} size={size} ring ringColor={ringColor} />
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
          <Text style={{ color: colors.white, fontFamily: fonts.bold, fontSize: Math.max(9, size * 0.34) }}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  );
}
