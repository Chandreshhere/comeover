// Human copy + icons for the server's feature codes (GET /plans returns codes
// such as 'saved_searches'; never show those raw). Unknown codes are turned
// into readable text so a new server feature never renders as snake_case.
//
// Glyphs are Phosphor components (rendered duotone in pastel bubbles). Only
// component references live at module scope — never colours.
import { BookmarkSimple } from 'phosphor-react-native/src/icons/BookmarkSimple';
import { CalendarCheck } from 'phosphor-react-native/src/icons/CalendarCheck';
import { ChartLineUp } from 'phosphor-react-native/src/icons/ChartLineUp';
import { ChatsCircle } from 'phosphor-react-native/src/icons/ChatsCircle';
import { CirclesThreePlus } from 'phosphor-react-native/src/icons/CirclesThreePlus';
import { Compass } from 'phosphor-react-native/src/icons/Compass';
import { FileArrowDown } from 'phosphor-react-native/src/icons/FileArrowDown';
import { Flag } from 'phosphor-react-native/src/icons/Flag';
import { Funnel } from 'phosphor-react-native/src/icons/Funnel';
import { HandWaving } from 'phosphor-react-native/src/icons/HandWaving';
import { Handshake } from 'phosphor-react-native/src/icons/Handshake';
import { MagicWand } from 'phosphor-react-native/src/icons/MagicWand';
import { Megaphone } from 'phosphor-react-native/src/icons/Megaphone';
import { Notepad } from 'phosphor-react-native/src/icons/Notepad';
import { Palette } from 'phosphor-react-native/src/icons/Palette';
import { PlusCircle } from 'phosphor-react-native/src/icons/PlusCircle';
import { PresentationChart } from 'phosphor-react-native/src/icons/PresentationChart';
import { Prohibit } from 'phosphor-react-native/src/icons/Prohibit';
import { Repeat } from 'phosphor-react-native/src/icons/Repeat';
import { ShieldCheck } from 'phosphor-react-native/src/icons/ShieldCheck';
import { Sparkle } from 'phosphor-react-native/src/icons/Sparkle';
import { Ticket } from 'phosphor-react-native/src/icons/Ticket';
import { Trophy } from 'phosphor-react-native/src/icons/Trophy';
import { UsersFour } from 'phosphor-react-native/src/icons/UsersFour';
import { UsersThree } from 'phosphor-react-native/src/icons/UsersThree';

// tone: which pastel bubble the icon sits in (resolved to live colours at render).
export const FEATURES = {
  // Free / never gated
  browse: { label: 'Browse plans nearby', blurb: 'See what people around you are up to', Glyph: Compass, tone: 'mint' },
  basic_create: { label: 'Create plans', blurb: 'Start a plan and invite people nearby', Glyph: PlusCircle, tone: 'mint' },
  basic_join: { label: 'Join plans', blurb: 'Request to join anything that looks fun', Glyph: HandWaving, tone: 'mint' },
  accepted_plan_chat: { label: 'Group chat for your plans', blurb: 'Chat with everyone in plans you’re in', Glyph: ChatsCircle, tone: 'mint' },
  safety: { label: 'Safety tools', blurb: 'Safety center, check-ins and trusted contacts', Glyph: ShieldCheck, tone: 'mint' },
  reporting: { label: 'Reporting', blurb: 'Report people, plans and venues', Glyph: Flag, tone: 'mint' },
  blocking: { label: 'Blocking', blurb: 'Block anyone, anytime', Glyph: Prohibit, tone: 'mint' },
  core_quests: { label: 'Quests & streaks', blurb: 'Weekly goals and badges', Glyph: Trophy, tone: 'mint' },

  // Plus
  saved_searches: { label: 'Saved searches', blurb: 'Keep the searches you use most one tap away', Glyph: BookmarkSimple, tone: 'periwinkle' },
  advanced_filters: { label: 'Advanced filters', blurb: 'Narrow plans down to exactly your vibe', Glyph: Funnel, tone: 'lavender' },
  extra_plan_drafts: { label: 'More plan drafts', blurb: 'Keep extra plans in the works', Glyph: Notepad, tone: 'orange' },
  availability_scheduling: { label: 'Availability scheduling', blurb: 'Set when you’re free ahead of time', Glyph: CalendarCheck, tone: 'mint' },
  activity_insights: { label: 'Activity insights', blurb: 'See your meetup patterns over time', Glyph: ChartLineUp, tone: 'periwinkle' },
  profile_themes: { label: 'Profile themes', blurb: 'Make your profile feel like you', Glyph: Palette, tone: 'pink' },
  advanced_circle_discovery: { label: 'Better circle discovery', blurb: 'Find circles that really fit you', Glyph: CirclesThreePlus, tone: 'lavender' },
  more_guide_prompts: { label: 'More guide prompts', blurb: 'Ask the guide for more ideas each day', Glyph: MagicWand, tone: 'pink' },

  // Pro
  recurring_plan_templates: { label: 'Recurring plans', blurb: 'Repeat your weekly plan without retyping it', Glyph: Repeat, tone: 'orange' },
  large_groups: { label: 'Larger groups', blurb: 'Host plans with more people', Glyph: UsersFour, tone: 'pink' },
  co_host_roles: { label: 'Co-hosts', blurb: 'Share hosting duties with friends', Glyph: Handshake, tone: 'mint' },
  community_analytics: { label: 'Community analytics', blurb: 'See how your plans and circles are doing', Glyph: PresentationChart, tone: 'periwinkle' },
  scheduled_quest_challenges: { label: 'Group quest challenges', blurb: 'Schedule quests for your community', Glyph: Trophy, tone: 'orange' },
  attendance_export: { label: 'Attendance export', blurb: 'Download who came to your plans', Glyph: FileArrowDown, tone: 'lavender' },

  // Venue / Club
  sponsored_slots: { label: 'Sponsored slots', blurb: 'Promote plans at your venue, always labelled', Glyph: Megaphone, tone: 'orange' },
  campaign_analytics: { label: 'Campaign analytics', blurb: 'Impressions, joins and check-ins', Glyph: ChartLineUp, tone: 'periwinkle' },
  offer_tracking: { label: 'Offer tracking', blurb: 'See which member offers get used', Glyph: Ticket, tone: 'pink' },
  staff_roles: { label: 'Staff roles', blurb: 'Let your team help without sharing a login', Glyph: UsersThree, tone: 'mint' },
};

const looksLikeCode = (s) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(s) || /^[a-z0-9]+$/.test(s);

// 'saved_searches' → 'Saved searches'; leaves human text untouched.
export function humanise(s) {
  const str = String(s || '').trim();
  if (!str) return '';
  if (!looksLikeCode(str)) return str;
  const words = str.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Any feature entry from the API (code string, human string or object) →
// { key, label, blurb, Glyph, tone }.
export function featureInfo(f) {
  if (f && typeof f === 'object') {
    const code = f.code || f.id || f.key || f.label || '';
    const known = FEATURES[code];
    return {
      key: String(code || f.label),
      label: f.label || f.title || known?.label || humanise(code),
      blurb: f.blurb || f.description || known?.blurb || '',
      Glyph: known?.Glyph || Sparkle,
      tone: known?.tone || 'periwinkle',
    };
  }
  const code = String(f || '');
  const known = FEATURES[code];
  if (known) return { key: code, ...known };
  return { key: code, label: humanise(code), blurb: '', Glyph: Sparkle, tone: 'periwinkle' };
}
