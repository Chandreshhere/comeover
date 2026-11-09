// One partner perk on a venue page: label, title, conditions, then either
// "Use offer" (unlocked and usable now) or the reason it can't be used yet,
// in plain words. Colours are read at render time (dark-mode safe).
import React from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Icon, IconBubble, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { isLocked, lockReason, offerConditions } from '../perks';

export default function OfferCard({ offer: o, onUse, onShowCode, style }) {
  const el = o.eligibility;
  const locked = isLocked(o);
  const reason = lockReason(o);
  const activeId = el?.activeRedemptionId || null;
  const usable = !el || el.eligible;
  const conditions = offerConditions(o);
  return (
    <Card
      elevated={false}
      style={[{ borderWidth: 1.2, borderColor: colors.border }, style]}
      accessibilityLabel={`${o.label}. ${o.title}. ${conditions.join(', ')}${reason ? `. ${reason}` : ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconBubble size={44} tone={locked ? 'subtle' : 'orange'} icon={locked ? 'lock' : 'ticket'} iconSize={22} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="h3" numberOfLines={1} color={locked ? colors.inkSoft : colors.ink}>
            {o.label}
          </AppText>
          {o.title !== o.label && (
            <AppText variant="caption" color={colors.muted} numberOfLines={2} style={{ marginTop: 2 }}>
              {o.title}
            </AppText>
          )}
        </View>
        {!!el && <Tag label={locked ? 'Locked' : 'Unlocked'} icon={locked ? 'lock' : 'unlock'} bg={locked ? colors.surfaceSubtle : colors.mint} fg={colors.ink} style={{ marginLeft: space.xs, alignSelf: 'center' }} />}
      </View>

      {!!o.description && (
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }} numberOfLines={3}>
          {o.description}
        </AppText>
      )}

      {conditions.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xxs, marginTop: space.sm }}>
          {conditions.map((c) => (
            <Tag key={c} label={c} bg={colors.surfaceSubtle} fg={colors.inkSoft} />
          ))}
        </View>
      )}

      {activeId ? (
        <Button title="Show my code" icon="qr-code" size="sm" full={false} align="center" style={{ marginTop: space.md }} onPress={() => onShowCode?.(activeId)} />
      ) : usable ? (
        <Button title="Use offer" icon="qr-code" size="sm" full={false} align="center" style={{ marginTop: space.md }} onPress={() => onUse?.(o)} />
      ) : (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, paddingHorizontal: space.sm, minHeight: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle }}
          accessible
          accessibilityLabel={reason}
        >
          <Icon name={locked ? 'lock' : 'clock'} size={15} color={colors.inkSoft} />
          <AppText variant="label" color={colors.inkSoft} style={{ marginLeft: space.xs, flex: 1 }} numberOfLines={2}>
            {reason}
          </AppText>
        </View>
      )}
    </Card>
  );
}
