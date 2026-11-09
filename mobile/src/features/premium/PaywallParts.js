// Shared building blocks for the plans page, checkout, subscription screen and
// the profile upsell: duotone feature bubbles, benefit rows and price text.
// Colours are read at render time only.
import React from 'react';
import { View } from 'react-native';
import { Sparkle } from 'phosphor-react-native/src/icons/Sparkle';
import { AppText, Skeleton } from '@/components';
import { colors, space } from '@/theme/tokens';
import { PRICE_FALLBACK } from './plans';

// Pastel bubble + duotone accent per tone (live palette).
export const toneColors = (tone) =>
  ({
    periwinkle: { bg: colors.periwinkleWash, duo: colors.deep },
    lavender: { bg: colors.lavender, duo: colors.deep },
    mint: { bg: colors.mint, duo: colors.success },
    pink: { bg: colors.pinkSoft, duo: colors.pink },
    orange: { bg: colors.orangeSoft, duo: colors.orange },
    surface: { bg: colors.surfaceSubtle, duo: colors.deep },
  }[tone] || { bg: colors.periwinkleWash, duo: colors.deep });

export function FeatureBubble({ Glyph, tone = 'periwinkle', size = 40, bg }) {
  const t = toneColors(tone);
  const G = Glyph || Sparkle;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg || t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <G size={Math.round(size * 0.52)} color={colors.ink} weight="duotone" duotoneColor={t.duo} duotoneOpacity={0.55} />
    </View>
  );
}

// Benefit row: duotone bubble, label, optional one-line blurb.
export function BenefitRow({ item, compact = false, bubbleBg, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', minHeight: compact ? 36 : 48 }, style]} accessible accessibilityLabel={item.blurb ? `${item.label}. ${item.blurb}` : item.label}>
      <FeatureBubble Glyph={item.Glyph} tone={item.tone} size={compact ? 32 : 40} bg={bubbleBg} />
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant={compact ? 'label' : 'bodyStrong'}>{item.label}</AppText>
        {!compact && !!item.blurb && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 1 }}>
            {item.blurb}
          </AppText>
        )}
      </View>
    </View>
  );
}

// Store price, a skeleton while loading, or an honest fallback — never blank.
export function PriceText({ price, loading, align = 'right', period = '/month', variant = 'h2', color }) {
  if (loading) return <Skeleton width={72} height={24} r={8} style={{ alignSelf: align === 'right' ? 'flex-end' : 'flex-start' }} />;
  if (!price) {
    return (
      <AppText variant="caption" color={colors.muted} align={align} style={{ maxWidth: 104 }}>
        {PRICE_FALLBACK}
      </AppText>
    );
  }
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <AppText variant={variant} color={color || colors.ink} numberOfLines={1}>
        {price}
      </AppText>
      {!!period && (
        <AppText variant="caption" color={color ? color : colors.muted}>
          {period}
        </AppText>
      )}
    </View>
  );
}
