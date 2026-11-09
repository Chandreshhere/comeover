// Iconography: Phosphor (MIT, phosphoricons.com). Call sites keep the short
// names from the original Feather set ('map-pin', 'users'…); iconMap.js maps
// them to Phosphor glyphs. Pass any Phosphor component name too ('Confetti').
import React from 'react';
import Feather from 'react-native-vector-icons/Feather';
import { colors } from '@/theme/tokens';
import { ICON_NAMES, iconComponent } from './iconMap';

export default function Icon({ name, size = 20, color, style, weight = 'bold', duotoneColor, duotoneOpacity }) {
  const tint = color || colors.ink;
  const Glyph = iconComponent(ICON_NAMES[name] || name);
  if (!Glyph) return <Feather name={name} size={size} color={tint} style={style} />; // unknown name: keep the old glyph rather than a blank
  return <Glyph size={size} color={tint} weight={weight} duotoneColor={duotoneColor} duotoneOpacity={duotoneOpacity} style={style} />;
}
