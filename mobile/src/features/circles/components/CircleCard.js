import React from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Icon, Pictogram } from '@/components';
import { accents, colors, space } from '@/theme/tokens';
import { whenLabel } from '@/utils/format';

export const circleAccent = (c) => accents[(c?.accentIndex ?? 0) % accents.length].bg;

const TILE = 52;

// Circle list card: one aligned row. Pastel pictogram tile, name, one meta
// line (members · area) and, when there is one, the next plan. Right slot is
// "Join" for circles you're not in, otherwise a chevron (the card navigates).
export default function CircleCard({ circle: c, nextPlan, joined, joining = false, onPress, onJoin, style }) {
  const meta = [`${c.members ?? 0} members`, c.area].filter(Boolean).join(' · ');
  return (
    <Card
      onPress={onPress}
      elevated={false}
      padding={space.md}
      style={[{ borderWidth: 1.2, borderColor: colors.border, minHeight: TILE + 2 * space.md }, style]}
      accessibilityLabel={`${c.name}. ${c.members ?? 0} members${c.area ? ` in ${c.area}` : ''}.${nextPlan ? ` Next plan: ${nextPlan.title}, ${whenLabel(nextPlan.startsAt)}.` : ''}${joined ? ' Joined.' : ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: TILE, height: TILE, borderRadius: 16, backgroundColor: circleAccent(c), alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={c.pictogram} size={28} color={colors.ink} />
        </View>
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {c.name}
            </AppText>
            {c.visibility === 'private' && <Icon name="lock" size={13} color={colors.muted} style={{ marginLeft: space.xxs }} />}
          </View>
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {meta}
          </AppText>
          {nextPlan ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xxs }}>
              <Icon name="calendar" size={12} color={colors.deep} />
              <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ flex: 1, marginLeft: space.xxs }}>
                {whenLabel(nextPlan.startsAt)} · {nextPlan.title}
              </AppText>
            </View>
          ) : null}
        </View>
        {onJoin ? (
          <Button title="Join" size="xs" full={false} loading={joining} onPress={onJoin} accessibilityLabel={`Join ${c.name}`} />
        ) : (
          <Icon name="chevron-right" size={18} color={colors.muted} />
        )}
      </View>
    </Card>
  );
}
