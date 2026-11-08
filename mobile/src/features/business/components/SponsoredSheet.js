import React from 'react';
import { View } from 'react-native';
import { AppText, Button, Icon, Sheet } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { sponsoredReason } from '../businessShared';

// "Why am I seeing this?" — paid placement and ranking-impact disclosure.
export default function SponsoredSheet({ venue, area, onClose, onReport }) {
  return (
    <Sheet visible={!!venue} onClose={onClose} title="Why am I seeing this?">
      {venue && (
        <View>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="info" size={18} />
              <AppText variant="bodyStrong" style={{ marginLeft: 8 }}>
                Sponsored by {venue.name}
              </AppText>
            </View>
            <AppText color={colors.inkSoft} style={{ marginTop: space.xs }}>
              {sponsoredReason(venue, area)}
            </AppText>
          </View>
          <View style={{ marginTop: space.md, gap: 8 }}>
            {[
              ['check', 'Paid items are always labelled “Sponsored”.'],
              ['shield', 'Sponsored plans pass the same safety and moderation checks as everyone else.'],
              ['sliders', 'Your filters and blocks still apply.'],
            ].map(([icon, text]) => (
              <View key={text} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Icon name={icon} size={15} color={colors.inkSoft} style={{ marginTop: 3 }} />
                <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 8, flex: 1, fontSize: 13, lineHeight: 18 }}>
                  {text}
                </AppText>
              </View>
            ))}
          </View>
          <Button title="Got it" style={{ marginTop: space.lg }} onPress={onClose} />
          {onReport && <Button title="Report this ad" variant="ghost" style={{ marginTop: space.xs }} onPress={onReport} />}
        </View>
      )}
    </Sheet>
  );
}
