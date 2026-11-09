// Playful icon bubble: a duotone Phosphor glyph inside a soft pastel circle
// (or rounded square). Shared by the messaging, circles, safety, system and
// onboarding screens. Tones are a function so they read the live light/dark
// palette at render time.
import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components';
import { colors } from '@/theme/tokens';

export const bubbleTones = () => ({
  periwinkle: { bg: colors.periwinkleWash, fg: colors.deep },
  lavender: { bg: colors.lavender, fg: colors.deep },
  mint: { bg: colors.mint, fg: colors.success },
  orange: { bg: colors.orangeSoft, fg: colors.orange },
  pink: { bg: colors.pinkSoft, fg: colors.pink },
  danger: { bg: colors.pinkSoft, fg: colors.danger, icon: colors.danger },
  neutral: { bg: colors.surfaceSubtle, fg: colors.muted },
  surface: { bg: colors.surface, fg: colors.deep },
  ink: { bg: colors.ink, fg: colors.periwinkle, icon: colors.white },
});

export const toneOf = (tone) => {
  const all = bubbleTones();
  return all[tone] || all.periwinkle;
};

// `icon` is an app icon name ('map-pin', 'flag', 'Confetti') or a Phosphor
// component imported directly (for glyphs not in components/iconMap.js).
export default function IconBubble({ icon, tone = 'periwinkle', size = 40, iconSize, square = false, weight = 'duotone', style }) {
  const t = toneOf(tone);
  const glyphSize = iconSize || Math.round(size * 0.5);
  const tint = t.icon || colors.ink;
  const Glyph = typeof icon === 'string' ? null : icon;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: square ? Math.round(size * 0.32) : size / 2,
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {Glyph ? (
        <Glyph size={glyphSize} color={tint} weight={weight} duotoneColor={t.fg} duotoneOpacity={0.45} />
      ) : (
        <Icon name={icon} size={glyphSize} color={tint} weight={weight} duotoneColor={t.fg} duotoneOpacity={0.45} />
      )}
    </View>
  );
}
