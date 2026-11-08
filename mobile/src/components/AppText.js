import React from 'react';
import { Text } from 'react-native';
import { colors, type } from '@/theme/tokens';

// Typography primitive. Dynamic type is honoured but capped so layouts hold.
export default function AppText({
  variant = 'body',
  color = colors.ink,
  align,
  style,
  children,
  caps = false,
  maxScale = 1.4,
  ...rest
}) {
  return (
    <Text
      maxFontSizeMultiplier={maxScale}
      style={[
        type[variant] || type.body,
        { color, includeFontPadding: false },
        align && { textAlign: align },
        caps && { textTransform: 'uppercase', letterSpacing: 0.8 },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}
