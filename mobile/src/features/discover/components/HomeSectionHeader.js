import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Icon } from '@/components';
import { colors, radius, space } from '@/theme/tokens';

// Pastel bubble + strong duotone colour, read at render time (dark-mode safe).
export const homeTone = (t) =>
  ({
    orange: { bg: colors.orangeSoft, fg: colors.orange },
    mint: { bg: colors.mint, fg: colors.success },
    pink: { bg: colors.pinkSoft, fg: colors.pink },
    lavender: { bg: colors.lavender, fg: colors.deep },
    blue: { bg: colors.periwinkleWash, fg: colors.deep },
  })[t] || { bg: colors.surfaceSubtle, fg: colors.deep };

// Home section header: duotone icon bubble + title, optional action pill.
export default function HomeSectionHeader({ icon, tone = 'blue', title, action, onAction, style }) {
  const t = homeTone(tone);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.sm, minHeight: 32 }, style]}>
      {!!icon && (
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', marginRight: space.xs }}>
          <Icon name={icon} size={16} color={colors.ink} weight="duotone" duotoneColor={t.fg} duotoneOpacity={0.5} />
        </View>
      )}
      <AppText variant="h3" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </AppText>
      {!!action && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            height: 32,
            paddingLeft: space.sm,
            paddingRight: space.xs,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceSubtle,
            marginLeft: space.xs,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <AppText variant="label" color={colors.deep} numberOfLines={1}>
            {action}
          </AppText>
          <Icon name="chevron-right" size={13} color={colors.deep} style={{ marginLeft: 2 }} />
        </Pressable>
      )}
    </View>
  );
}
