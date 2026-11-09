import React from 'react';
import { Linking, View } from 'react-native';
import { CalendarCheck } from 'phosphor-react-native/src/icons/CalendarCheck';
import { HandCoins } from 'phosphor-react-native/src/icons/HandCoins';
import { HandHeart } from 'phosphor-react-native/src/icons/HandHeart';
import { Siren } from 'phosphor-react-native/src/icons/Siren';
import { AppText, Button } from '@/components';
import config from '@/config';
import IconBubble from '@/features/system/IconBubble';
import { colors, radius, space } from '@/theme/tokens';

export const REPORT_REASONS = [
  { code: 'harassment', title: 'Harassment or bullying', subtitle: 'Unwanted contact, threats, insults' },
  // Codes match the API's REASON_CODES (backend/src/services/safety.js).
  { code: 'safety_threat', title: 'Unsafe behaviour at a meetup', subtitle: 'Made someone feel unsafe in person' },
  { code: 'dating_or_solicitation', title: 'Dating, paid company or selling', subtitle: 'Romantic pressure, paid services, promotions' },
  { code: 'impersonation', title: 'Fake profile or impersonation', subtitle: "Not who they say they are" },
  { code: 'scam', title: 'Spam or scam', subtitle: 'Links, money requests, repeated junk plans' },
  { code: 'no_show_abuse', title: 'Repeated no-shows', subtitle: 'Keeps accepting and not turning up' },
  { code: 'underage', title: 'Might be under 18', subtitle: 'We act on these reports first' },
  { code: 'other', title: 'Something else', subtitle: 'Tell us in your own words' },
];

// A function so the status colours follow light/dark mode (read at render).
export const reportStatus = (status) => {
  const all = {
    open: { label: 'Received', bg: colors.lavender },
    reviewing: { label: 'In review', bg: colors.orangeSoft },
    actioned: { label: 'Action taken', bg: colors.mint },
    dismissed: { label: 'Closed', bg: colors.surfaceSubtle },
    appealed: { label: 'Appealed', bg: colors.pinkSoft },
  };
  return all[status] || all.open;
};

export const reasonTitle = (code) => REPORT_REASONS.find((r) => r.code === code)?.title || 'Report';

export const callEmergency = () => Linking.openURL(`tel:${config.EMERGENCY_NUMBER_IN}`).catch(() => {});

// Calm emergency row used across the safety screens: obvious (red siren +
// red Call button) without a shouting full-width slab.
export function EmergencyRow({ title = 'In danger right now?', body = `Call ${config.EMERGENCY_NUMBER_IN} first, then tell us.`, style }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', minHeight: 64, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1.2, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.sm },
        style,
      ]}
    >
      <IconBubble icon={Siren} tone="danger" size={40} iconSize={20} />
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {!!body && (
          <AppText variant="caption" color={colors.muted}>
            {body}
          </AppText>
        )}
      </View>
      <Button title="Call" icon="phone" size="xs" variant="danger" full={false} onPress={callEmergency} accessibilityLabel={`Call ${config.EMERGENCY_NUMBER_IN}`} />
    </View>
  );
}

// [icon (name or Phosphor component), title, body, bubble tone]
export const GUIDELINES = [
  ['handshake', 'Platonic & activity-first', 'Come Over is for doing things together, not dating, and never paid company.', 'periwinkle'],
  ['map-pin', 'Meet in public', 'Plans happen at public venues or public areas. Private addresses are not allowed for first meetups.', 'mint'],
  [HandHeart, 'Respect consent', "No means no. For photos, contact details, touch, or staying longer. Anyone can leave anytime.", 'pink'],
  ['slash', 'No harassment or hate', 'Insults, threats, slurs or repeated unwanted contact get accounts removed.', 'danger'],
  [HandCoins, 'No selling or solicitation', "Don't use plans to sell, recruit, ask for money or offer paid services.", 'orange'],
  [CalendarCheck, 'Be reliable', "Show up, or drop out early so someone else gets your spot.", 'lavender'],
];
