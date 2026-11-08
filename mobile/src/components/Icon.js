// Minimal line iconography (Feather set, MIT). Activity-specific glyphs use
// our own pictograms in src/illustrations/Pictograms.js instead.
import React from 'react';
import Feather from 'react-native-vector-icons/Feather';
import { colors } from '@/theme/tokens';

export default function Icon({ name, size = 20, color = colors.ink, style }) {
  return <Feather name={name} size={size} color={color} style={style} />;
}
