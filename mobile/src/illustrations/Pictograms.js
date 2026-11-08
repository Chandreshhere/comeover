// Original line pictograms for activities. Drawn on a 32x32 grid, ink stroke.
// Used in the roadmap hero cluster, category chips and activity cards.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

const P = {
  chai: (c) => (
    <>
      <Path d="M7 13 H23 V20 C23 24 20 27 15 27 C10 27 7 24 7 20 Z" stroke={c} />
      <Path d="M23 15 C27 15 27 21 23 21" stroke={c} />
      <Path d="M11 9 C11 7 13 7 13 5 M16 9 C16 7 18 7 18 5" stroke={c} />
    </>
  ),
  badminton: (c) => (
    <>
      <Path d="M12 20 L7 9 H17 Z" stroke={c} />
      <Line x1="9" y1="13" x2="15.5" y2="13" stroke={c} />
      <Circle cx="12" cy="23" r="3" stroke={c} />
      <Path d="M20 26 L27 8" stroke={c} />
    </>
  ),
  gym: (c) => (
    <>
      <Rect x="4" y="11" width="4" height="10" rx="1.5" stroke={c} />
      <Rect x="24" y="11" width="4" height="10" rx="1.5" stroke={c} />
      <Rect x="8" y="13" width="3" height="6" rx="1" stroke={c} />
      <Rect x="21" y="13" width="3" height="6" rx="1" stroke={c} />
      <Line x1="11" y1="16" x2="21" y2="16" stroke={c} />
    </>
  ),
  music: (c) => (
    <>
      <Path d="M12 23 V8 L25 5 V20" stroke={c} />
      <Circle cx="9" cy="23" r="3" stroke={c} />
      <Circle cx="22" cy="20" r="3" stroke={c} />
    </>
  ),
  pin: (c) => (
    <>
      <Path d="M16 28 C16 28 7 19 7 13 C7 8 11 4 16 4 C21 4 25 8 25 13 C25 19 16 28 16 28 Z" stroke={c} />
      <Circle cx="16" cy="13" r="3.5" stroke={c} />
    </>
  ),
  camera: (c) => (
    <>
      <Rect x="4" y="10" width="24" height="16" rx="4" stroke={c} />
      <Path d="M11 10 L13 6 H19 L21 10" stroke={c} />
      <Circle cx="16" cy="18" r="4.5" stroke={c} />
    </>
  ),
  run: (c) => (
    <>
      <Path d="M5 22 C5 18 9 17 11 17 L14 12 L19 14 C21 17 24 18 27 18 V23 C27 24 26 25 25 25 H7 C6 25 5 24 5 22 Z" stroke={c} />
      <Line x1="10" y1="21" x2="14" y2="21" stroke={c} />
    </>
  ),
  sparkle: (c) => (
    <>
      <Path d="M16 4 C17 11 21 15 28 16 C21 17 17 21 16 28 C15 21 11 17 4 16 C11 15 15 11 16 4 Z" stroke={c} />
    </>
  ),
  chat: (c) => (
    <>
      <Path d="M6 8 H26 V21 H14 L8 26 V21 H6 Z" stroke={c} />
      <Line x1="11" y1="13" x2="21" y2="13" stroke={c} />
      <Line x1="11" y1="17" x2="17" y2="17" stroke={c} />
    </>
  ),
  sun: (c) => (
    <>
      <Circle cx="16" cy="16" r="6" stroke={c} />
      <Path d="M16 3 V7 M16 25 V29 M3 16 H7 M25 16 H29 M7 7 L9.5 9.5 M22.5 22.5 L25 25 M25 7 L22.5 9.5 M9.5 22.5 L7 25" stroke={c} />
    </>
  ),
  game: (c) => (
    <>
      <Path d="M9 10 H23 C27 10 29 14 29 19 C29 24 26 25 24 23 L21 20 H11 L8 23 C6 25 3 24 3 19 C3 14 5 10 9 10 Z" stroke={c} />
      <Path d="M10 14 V18 M8 16 H12" stroke={c} />
      <Circle cx="21" cy="15" r="1" stroke={c} />
      <Circle cx="24" cy="17" r="1" stroke={c} />
    </>
  ),
  book: (c) => (
    <>
      <Path d="M16 8 C12 5 7 5 4 6 V25 C7 24 12 24 16 27 C20 24 25 24 28 25 V6 C25 5 20 5 16 8 Z" stroke={c} />
      <Line x1="16" y1="8" x2="16" y2="27" stroke={c} />
    </>
  ),
  food: (c) => (
    <>
      <Path d="M4 17 H28 C28 23 23 27 16 27 C9 27 4 23 4 17 Z" stroke={c} />
      <Path d="M10 13 C10 11 12 11 12 9 M16 13 C16 11 18 11 18 9 M22 13 C22 11 24 11 24 9" stroke={c} />
    </>
  ),
  laptop: (c) => (
    <>
      <Rect x="7" y="7" width="18" height="13" rx="2" stroke={c} />
      <Path d="M3 24 H29 L27 21 H5 Z" stroke={c} />
    </>
  ),
  film: (c) => (
    <>
      <Rect x="5" y="7" width="22" height="18" rx="3" stroke={c} />
      <Path d="M10 7 V25 M22 7 V25 M5 13 H10 M5 19 H10 M22 13 H27 M22 19 H27" stroke={c} />
    </>
  ),
  walk: (c) => (
    <>
      <Circle cx="17" cy="6" r="2.5" stroke={c} />
      <Path d="M16 10 L13 18 L17 21 L18 28 M13 18 L9 27 M15 12 L21 15 M15 12 L10 14" stroke={c} />
    </>
  ),
  board: (c) => (
    <>
      <Rect x="6" y="6" width="20" height="20" rx="4" stroke={c} />
      <Circle cx="12" cy="12" r="1.4" stroke={c} />
      <Circle cx="20" cy="20" r="1.4" stroke={c} />
      <Circle cx="16" cy="16" r="1.4" stroke={c} />
    </>
  ),
  star: (c) => (
    <Path d="M16 4 L19.6 11.6 L28 12.6 L21.8 18.3 L23.4 26.6 L16 22.5 L8.6 26.6 L10.2 18.3 L4 12.6 L12.4 11.6 Z" stroke={c} />
  ),
  check: (c) => <Path d="M6 17 L13 24 L26 9" stroke={c} />,
  calendar: (c) => (
    <>
      <Rect x="5" y="7" width="22" height="20" rx="4" stroke={c} />
      <Path d="M5 13 H27 M11 4 V9 M21 4 V9" stroke={c} />
    </>
  ),
  people: (c) => (
    <>
      <Circle cx="12" cy="11" r="4" stroke={c} />
      <Circle cx="22" cy="12" r="3" stroke={c} />
      <Path d="M4 26 C4 20 8 17 12 17 C16 17 20 20 20 26" stroke={c} />
      <Path d="M20 18 C24 18 28 20 28 25" stroke={c} />
    </>
  ),
  shield: (c) => (
    <>
      <Path d="M16 4 L26 8 V15 C26 21 22 26 16 28 C10 26 6 21 6 15 V8 Z" stroke={c} />
      <Path d="M11 16 L15 20 L21 12" stroke={c} />
    </>
  ),
};

export const PICTOGRAM_NAMES = Object.keys(P);

export function Pictogram({ name, size = 28, color = colors.ink, strokeWidth = 2 }) {
  const draw = P[name] || P.sparkle;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {draw(color)}
    </Svg>
  );
}

// Scattered "orbiting activity pictograms" cluster used above the mascot.
// Positions are relative (0..1) so the cluster scales with its container.
const CLUSTER = [
  { n: 'chai', x: 0.04, y: 0.18, r: -8 },
  { n: 'sparkle', x: 0.17, y: 0.02, r: 0, s: 0.7 },
  { n: 'badminton', x: 0.28, y: 0.2, r: 10 },
  { n: 'music', x: 0.46, y: 0.02, r: -6 },
  { n: 'pin', x: 0.58, y: 0.22, r: 0 },
  { n: 'camera', x: 0.72, y: 0.04, r: 8 },
  { n: 'check', x: 0.86, y: 0.18, r: 0, s: 0.8 },
  { n: 'gym', x: 0.06, y: 0.5, r: 6 },
  { n: 'calendar', x: 0.9, y: 0.46, r: -10, s: 0.85 },
  { n: 'game', x: 0.74, y: 0.36, r: 12, s: 0.85 },
  { n: 'star', x: 0.16, y: 0.34, r: 0, s: 0.6 },
];

export function PictogramCluster({ width, height, color = colors.ink }) {
  return (
    <View pointerEvents="none" style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {CLUSTER.map((p, i) => {
        const size = 28 * (p.s || 1);
        return (
          <View key={i} style={{ position: 'absolute', left: p.x * (width - size), top: p.y * height, transform: [{ rotate: `${p.r}deg` }] }}>
            <Pictogram name={p.n} size={size} color={color} />
          </View>
        );
      })}
    </View>
  );
}
