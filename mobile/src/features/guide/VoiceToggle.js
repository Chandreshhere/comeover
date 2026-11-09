// Mute / unmute Mo's voice (prefs.guideVoice, device-only). Hidden when the
// device has no usable text-to-speech, so it never promises a voice it can't play.
import React from 'react';
import { Pressable } from 'react-native';
import { Icon } from '@/components';
import { colors, glass, layout } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
import haptics from '@/utils/haptics';
import voice from '@/services/voice';

// tone: 'glass' (on brand surfaces) | 'surface' (on cards/canvas) | 'scrim' (on the dark tour backdrop).
// The tour backdrop is near-black in both schemes, so 'scrim' uses fixed white alphas on purpose.
const tones = () => ({
  glass: { bg: glass(0.55), fg: colors.ink, border: 'transparent' },
  surface: { bg: colors.surface, fg: colors.ink, border: colors.border },
  scrim: { bg: 'rgba(255,255,255,0.16)', fg: colors.pureWhite, border: 'rgba(255,255,255,0.28)' },
});

export default function VoiceToggle({ tone = 'glass', size = layout.minTouch, onChange, style }) {
  const on = useAppStore((s) => s.prefs.guideVoice !== false);
  const setPrefs = useAppStore((s) => s.setPrefs);
  if (!voice.isAvailable()) return null;
  const t = tones()[tone] || tones().glass;
  return (
    <Pressable
      onPress={() => {
        const next = !on;
        haptics.select();
        if (!next) voice.stop();
        setPrefs({ guideVoice: next });
        onChange?.(next);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Mo's voice"
      accessibilityHint={on ? 'Mutes the guide' : 'Reads the guide aloud'}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, borderWidth: 1.2, borderColor: t.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Icon name={on ? 'sound-on' : 'sound-off'} size={Math.round(size * 0.44)} color={t.fg} weight={on ? 'fill' : 'regular'} />
    </Pressable>
  );
}
