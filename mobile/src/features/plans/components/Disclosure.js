// Expandable card row for progressive disclosure: rules, fine print and
// optional settings stay one tap away instead of crowding the screen.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { AppText, Icon } from '@/components';
import { IconBubble } from '@/components/Card';
import { colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';

const reveal = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

export default function Disclosure({ title, subtitle, icon, glyph, initiallyOpen = false, children, style }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }, style]}>
      <Pressable
        onPress={() => {
          haptics.select();
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm }}
      >
        {(icon || glyph) && <IconBubble size={40} shape="squircle" tone="periwinkle" icon={icon} glyph={glyph} iconSize={22} style={{ marginRight: space.sm }} />}
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          {!!subtitle && (
            <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
              {subtitle}
            </AppText>
          )}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} style={{ marginLeft: space.xs }} />
      </Pressable>
      {open && (
        <Animated.View entering={reveal} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space.sm }}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

// Plain icon + text line used inside a Disclosure (or any card).
export function FactLine({ icon, glyph, title, text, last }) {
  const Glyph = glyph;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.xs, marginBottom: last ? 0 : space.xxs }} accessible accessibilityLabel={[title, text].filter(Boolean).join('. ')}>
      {/* Icon box = first line's height, so the glyph centres on that line. */}
      <View style={{ width: 24, height: title ? 16 : 14, alignItems: 'center', justifyContent: 'center' }}>
        {Glyph ? <Glyph size={18} color={colors.inkSoft} weight="bold" /> : <Icon name={icon} size={18} color={colors.inkSoft} />}
      </View>
      <View style={{ flex: 1, marginLeft: space.sm }}>
        {!!title && <AppText variant="label">{title}</AppText>}
        {!!text && (
          <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: title ? 2 : 0 }}>
            {text}
          </AppText>
        )}
      </View>
    </View>
  );
}
