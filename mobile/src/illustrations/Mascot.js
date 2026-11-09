// "Mo" — Come Over's mascot, now drawn by the guide character
// (features/guide/GuideCharacter.js). This file keeps the original exports and
// props so every screen that shows Mo gets the new look without changes:
//
//   <Mascot size pose mood accent style celebrateKey />   animated
//   <MascotArt size pose accent showMotionLines />        static (lists, empty states)
//
// Footprint is unchanged: `size` wide × size·(200/220) tall.
// pose:  'stride' (default) → idle · 'wave' → wave · 'cheer' → happy
// mood:  'idle' (default) · 'celebrate' → happy, hops whenever celebrateKey
//        changes · 'still' → static pose (no loops)
// accent: the sprout's leaf colour.
// When the Rive file lands, only GuideCharacter changes (see the comment block there).
import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/tokens';
import GuideCharacter from '../features/guide/GuideCharacter';

const RATIO = 200 / 220;

const stateFor = (pose, mood) => {
  if (mood === 'celebrate' || pose === 'cheer') return 'happy';
  if (pose === 'wave') return 'wave';
  return 'idle';
};

// Two tiny sparkles beside Mo (replaces the old motion lines).
function Sparkles({ w, h }) {
  const star = (cx, cy, r) => `M${cx} ${cy - r} Q${cx + r * 0.22} ${cy - r * 0.22} ${cx + r} ${cy} Q${cx + r * 0.22} ${cy + r * 0.22} ${cx} ${cy + r} Q${cx - r * 0.22} ${cy + r * 0.22} ${cx - r} ${cy} Q${cx - r * 0.22} ${cy - r * 0.22} ${cx} ${cy - r} Z`;
  return (
    <Svg width={w} height={h} viewBox="0 0 220 200" style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Path d={star(30, 62, 11)} fill={colors.orange} />
      <Path d={star(48, 36, 6)} fill={colors.pink} />
      <Path d={star(192, 84, 8)} fill={colors.deep} opacity={0.7} />
    </Svg>
  );
}

export function MascotArt({ size = 200, pose = 'stride', accent, showMotionLines = true }) {
  const h = size * RATIO;
  return (
    <View style={{ width: size, height: h, alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {showMotionLines && <Sparkles w={size} h={h} />}
      <GuideCharacter size={h} state={stateFor(pose)} still leaf={accent} decorative />
    </View>
  );
}

export default function Mascot({ size = 200, pose, mood = 'idle', accent, style, celebrateKey }) {
  const h = size * RATIO;
  return (
    <View style={[{ width: size, height: h, alignItems: 'center' }, style]} accessible accessibilityRole="image" accessibilityLabel="Mo, the Come Over mascot">
      <GuideCharacter
        size={h}
        state={stateFor(pose, mood)}
        still={mood === 'still'}
        hopKey={celebrateKey == null || celebrateKey === false ? undefined : celebrateKey}
        autoHop={false}
        leaf={accent}
        decorative
      />
    </View>
  );
}
