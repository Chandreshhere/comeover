// "Am I free?" at the top of Live now: one compact row with my status and
// what I'm up for. The whole row opens availability_setup, where status,
// activities and radar visibility are all changed.
import React from 'react';
import { View } from 'react-native';
import { AppText, Card, Icon } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { colors, glass, layout, radius, space } from '@/theme/tokens';
import { timeLabel } from '@/utils/format';

const BUBBLE = 40;

// A function, not a constant: it reads the live (light/dark) palette.
const statusMeta = (status, until) =>
  ({
    now: {
      title: until ? `Free until ${timeLabel(until)}` : 'Free now',
      icon: 'radio',
      tint: colors.success,
      bg: colors.mint,
    },
    later: { title: 'Free later today', icon: 'sunset', tint: colors.deep, bg: colors.lavender },
    busy: { title: 'You’re busy', icon: 'pause-circle', tint: colors.muted, bg: colors.surface },
  }[status]);

export default function StatusCard({ availability, showOnRadar, onPress }) {
  const status = availability.status === 'now' || availability.status === 'later' ? availability.status : 'busy';
  const m = statusMeta(status, availability.until);
  const available = status !== 'busy';
  const hidden = available && !showOnRadar;
  const acts = (availability.activities || []).map((s) => categoryBySlug[s]?.short).filter(Boolean);
  const detail = !available ? '' : hidden ? 'Hidden from radar' : acts.length ? acts.join(', ') : 'Open to anything';
  const action = available ? 'Change' : 'Go available';

  return (
    <Card
      onPress={onPress}
      bg={m.bg}
      padding={space.sm}
      elevated={!available}
      accessibilityLabel={`${m.title}. ${available && !hidden && acts.length ? `Up for ${detail}` : detail}. ${action}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: layout.minTouch }}>
        <View
          style={{
            width: BUBBLE,
            height: BUBBLE,
            borderRadius: BUBBLE / 2,
            backgroundColor: available ? glass(0.7) : colors.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={hidden ? 'eye-off' : m.icon} size={22} color={m.tint} weight="duotone" />
        </View>
        <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1, marginHorizontal: space.sm }}>
          {m.title}
          <AppText variant="body" color={colors.inkSoft}>
            {detail ? ` · ${detail}` : ''}
          </AppText>
        </AppText>
        <View
          style={{
            height: 32,
            paddingHorizontal: space.sm,
            borderRadius: radius.pill,
            justifyContent: 'center',
            backgroundColor: available ? glass(0.85) : colors.ink,
          }}
        >
          <AppText variant="label" color={available ? colors.ink : colors.white} numberOfLines={1} maxScale={1.2}>
            {action}
          </AppText>
        </View>
      </View>
    </Card>
  );
}
