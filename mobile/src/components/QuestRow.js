import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, space } from '@/theme/tokens';
import { Pictogram } from '@/illustrations/Pictograms';
import { usePressScale } from './Button';
import AppText from './AppText';
import Icon from './Icon';
import { ProgressRing } from './Progress';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TONES = {
  dark: { bg: colors.ink, fg: colors.white, sub: 'rgba(255,255,255,0.62)', iconBg: colors.white, iconFg: colors.ink, trailBg: colors.white, trailFg: colors.ink },
  soft: { bg: 'rgba(9,10,14,0.10)', fg: colors.ink, sub: colors.inkSoft, iconBg: colors.white, iconFg: colors.ink, trailBg: colors.ink, trailFg: colors.white },
  light: { bg: colors.surface, fg: colors.ink, sub: colors.muted, iconBg: colors.ink, iconFg: colors.white, trailBg: colors.ink, trailFg: colors.white },
};

// Dark rounded milestone/quest row (quest_card token). Trailing slot shows a
// chevron button, a progress ring, an XP reward or a completed check.
export default function QuestRow({ title, subtitle, pictogram = 'sparkle', tone = 'dark', progress, total, xp, done = false, locked = false, onPress, style }) {
  const t = TONES[tone] || TONES.dark;
  const press = usePressScale();
  const a11y = `${title}. ${subtitle || ''}${total ? ` ${progress} of ${total}` : ''}${done ? ' Completed' : ''}${locked ? ' Locked' : ''}`;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={!onPress}
      style={[
        { backgroundColor: t.bg, borderRadius: radius.quest, padding: 10, paddingRight: 12, flexDirection: 'row', alignItems: 'center', opacity: locked ? 0.55 : 1 },
        press.style,
        style,
      ]}
    >
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t.iconBg, alignItems: 'center', justifyContent: 'center' }}>
        {locked ? <Icon name="lock" size={18} color={t.iconFg} /> : <Pictogram name={pictogram} size={24} color={t.iconFg} />}
      </View>
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong" color={t.fg} numberOfLines={1}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" color={t.sub} numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        )}
      </View>
      {done ? (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={18} color={colors.white} />
        </View>
      ) : total ? (
        <ProgressRing value={progress / total} size={38} color={t.fg} track={tone === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(9,10,14,0.15)'} label={`${progress}/${total}`} labelColor={t.fg} />
      ) : xp ? (
        <View style={{ backgroundColor: t.trailBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
          <AppText variant="label" color={t.trailFg}>
            +{xp} XP
          </AppText>
        </View>
      ) : (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.trailBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron-right" size={18} color={t.trailFg} />
        </View>
      )}
    </AnimatedPressable>
  );
}
