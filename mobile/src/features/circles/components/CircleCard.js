import React from 'react';
import { View } from 'react-native';
import { AppText, AvatarStack, Button, Card, Icon, Pictogram, Tag } from '@/components';
import { accents, colors, radius, space } from '@/theme/tokens';
import { whenLabel } from '@/utils/format';

export const circleAccent = (c) => accents[(c?.accentIndex ?? 0) % accents.length].bg;

// Circle list card: pastel pictogram tile, name, members/area, next plan and join.
export default function CircleCard({ circle: c, nextPlan, joined, joining = false, onPress, onJoin, style }) {
  return (
    <Card
      onPress={onPress}
      elevated={false}
      padding={14}
      style={[{ borderWidth: 1.2, borderColor: colors.border }, style]}
      accessibilityLabel={`${c.name}. ${c.members} members in ${c.area}.${nextPlan ? ` Next plan: ${nextPlan.title}.` : ''}${joined ? ' Joined.' : ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: circleAccent(c), alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={c.pictogram} size={30} />
        </View>
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {c.name}
            </AppText>
            {c.visibility === 'private' && <Icon name="lock" size={12} color={colors.muted} style={{ marginLeft: 4 }} />}
          </View>
          <AppText variant="caption" color={colors.muted} numberOfLines={1}>
            {c.members ?? 0} members{c.area ? ` · ${c.area}` : ''}
          </AppText>
          <View style={{ marginTop: 6 }}>
            <AvatarStack seeds={c.memberSeeds || []} size={22} max={4} extra={Math.max(0, (c.members || 0) - (c.memberSeeds?.length || 0))} />
          </View>
        </View>
        {onJoin && (
          <Button title={joined ? 'Joined' : 'Join'} size="xs" variant={joined ? 'secondary' : 'primary'} icon={joined ? 'check' : undefined} full={false} loading={joining} onPress={onJoin} accessibilityLabel={joined ? `${c.name}, joined` : `Join ${c.name}`} />
        )}
      </View>
      {nextPlan && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: space.sm }}>
          <Pictogram name={nextPlan.pictogram} size={16} />
          <AppText variant="caption" numberOfLines={1} style={{ flex: 1, marginLeft: 6 }}>
            Next: {nextPlan.title}
          </AppText>
          <Tag label={whenLabel(nextPlan.startsAt)} bg={colors.surface} />
        </View>
      )}
    </Card>
  );
}
