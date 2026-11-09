// Equal-width grid for groups of chips / small options (areas, interests,
// "up for…" activities). Wrapping pills of different widths leave a ragged
// right edge; a grid keeps every row aligned. Each child fills its cell, so
// pass chips with content centred (Chip does that when given `fill`).
//
//   <ChipGrid columns={2}>
//     {areas.map((a) => <Chip key={a} label={a} fill selected={…} onPress={…} />)}
//   </ChipGrid>
import React from 'react';
import { View } from 'react-native';
import { space } from '@/theme/tokens';

export default function ChipGrid({ children, columns = 2, gap = space.xs, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View style={[{ gap }, style]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {row.map((child, c) => (
            <View key={c} style={{ flex: 1, minWidth: 0 }}>
              {child}
            </View>
          ))}
          {/* keep the last row's cells the same width as the others */}
          {Array.from({ length: columns - row.length }, (_, k) => (
            <View key={`pad${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}
