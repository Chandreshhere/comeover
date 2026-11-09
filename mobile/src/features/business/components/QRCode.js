// QR code drawn with react-native-svg from a pure-JS encoder (qrcode-generator),
// so no native module is needed. Always black on white (scanners need the
// contrast, even in dark mode) with a 4-module quiet zone.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';
import { colors } from '@/theme/tokens';

// Dark modules as one path: each horizontal run of dark modules is one rectangle.
export function qrPath(text, ecc = 'M') {
  const qr = qrcode(0, ecc);
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r += 1) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c += 1;
        continue;
      }
      let len = 1;
      while (c + len < n && qr.isDark(r, c + len)) len += 1;
      d += `M${c} ${r}h${len}v1h-${len}z`;
      c += len;
    }
  }
  return { n, d };
}

export default function QRCode({ value, size = 220, quiet = 4, accessibilityLabel = 'QR code', style }) {
  const qr = useMemo(() => {
    if (!value) return null;
    try {
      return qrPath(value);
    } catch (e) {
      return null;
    }
  }, [value]);
  if (!qr) return <View style={[{ width: size, height: size, backgroundColor: colors.pureWhite }, style]} />;
  const total = qr.n + quiet * 2;
  return (
    <View style={[{ width: size, height: size, backgroundColor: colors.pureWhite }, style]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${total} ${total}`} shapeRendering="crispEdges">
        <Rect x={-quiet} y={-quiet} width={total} height={total} fill={colors.pureWhite} />
        <Path d={qr.d} fill={colors.pureBlack} />
      </Svg>
    </View>
  );
}
