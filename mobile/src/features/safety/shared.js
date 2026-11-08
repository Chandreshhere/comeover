import { Linking } from 'react-native';
import config from '@/config';
import { colors } from '@/theme/tokens';

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

export const REPORT_STATUS = {
  open: { label: 'Received', bg: colors.lavender },
  reviewing: { label: 'In review', bg: colors.orangeSoft },
  actioned: { label: 'Action taken', bg: colors.mint },
  dismissed: { label: 'Closed', bg: colors.surfaceSubtle },
  appealed: { label: 'Appealed', bg: colors.pinkSoft },
};

export const reasonTitle = (code) => REPORT_REASONS.find((r) => r.code === code)?.title || 'Report';

export const callEmergency = () => Linking.openURL(`tel:${config.EMERGENCY_NUMBER_IN}`).catch(() => {});

export const GUIDELINES = [
  ['users', 'Platonic & activity-first', 'Project IRL is for doing things together — not dating, and never paid company.'],
  ['map-pin', 'Meet in public', 'Plans happen at public venues or public areas. Private addresses are not allowed for first meetups.'],
  ['heart', 'Respect consent', "No means no — for photos, contact details, touch, or staying longer. Anyone can leave anytime."],
  ['slash', 'No harassment or hate', 'Insults, threats, slurs or repeated unwanted contact get accounts removed.'],
  ['dollar-sign', 'No selling or solicitation', "Don't use plans to sell, recruit, ask for money or offer paid services."],
  ['clock', 'Be reliable', "Show up, or drop out early so someone else gets your spot."],
];
