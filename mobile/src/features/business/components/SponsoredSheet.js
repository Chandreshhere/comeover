import React from 'react';
import { View } from 'react-native';
import { AppText, Button, ListGroup, ListRow, Sheet } from '@/components';
import { colors, space } from '@/theme/tokens';
import { sponsoredReason } from '../businessShared';

// "Why am I seeing this?" — paid placement and ranking-impact disclosure.
export default function SponsoredSheet({ venue, area, onClose, onReport }) {
  return (
    <Sheet visible={!!venue} onClose={onClose} title="Why am I seeing this?">
      {venue && (
        <View>
          <AppText variant="bodyStrong">Sponsored by {venue.name}</AppText>
          <AppText color={colors.inkSoft} style={{ marginTop: space.xxs }}>
            {sponsoredReason(venue, area)}
          </AppText>
          <ListGroup style={{ marginTop: space.md }}>
            <ListRow icon="check" title="Always labelled “Sponsored”" />
            <ListRow icon="shield" title="Same safety checks as everyone" />
            <ListRow icon="sliders" title="Your filters and blocks still apply" last />
          </ListGroup>
          <Button title="Got it" style={{ marginTop: space.lg }} onPress={onClose} />
          {onReport && <Button title="Report this ad" variant="ghost" style={{ marginTop: space.xs }} onPress={onReport} />}
        </View>
      )}
    </Sheet>
  );
}
