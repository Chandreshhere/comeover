// Pure helpers for the create flow: time windows, venue validation and the
// draft -> preview activity mapping (mirrors store.publishDraft).
import { categories, categoryBySlug, CITY_CENTER } from '@/data/catalog';

export const STEPS = [
  'create_activity_type',
  'create_activity_time',
  'create_activity_place',
  'create_activity_group',
  'create_activity_details',
  'create_activity_preview',
];

export const WHEN_OPTIONS = [
  { value: 'now', label: 'Now', hint: 'Starts in ~5 min', icon: 'zap' },
  { value: 'in15', label: 'In 15 min', hint: 'Micro-plan', icon: 'clock' },
  { value: 'tonight', label: 'Tonight', hint: '6–10 PM', icon: 'moon' },
  { value: 'tomorrow', label: 'Tomorrow', hint: 'Pick a time', icon: 'sunrise' },
  { value: 'weekend', label: 'Weekend', hint: 'Sat or Sun', icon: 'sun' },
  { value: 'custom', label: 'Pick a day', hint: 'Next 7 days', icon: 'calendar' },
];

// Duration presets from the blueprint (micro-plan windows).
export const DURATIONS = [5, 10, 15, 30, 60, 120];

export const DAY_SLOTS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
export const TONIGHT_SLOTS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];

export const VENUE_TYPES = [
  { value: 'Public café', pictogram: 'chai', hint: 'Cafés, tea stalls, bakeries' },
  { value: 'Park', pictogram: 'walk', hint: 'Parks, lakes, promenades' },
  { value: 'Sports court', pictogram: 'badminton', hint: 'Courts, turfs, sports halls' },
  { value: 'Gym', pictogram: 'gym', hint: 'Gyms and fitness studios' },
  { value: 'Library', pictogram: 'book', hint: 'Libraries, reading rooms' },
  { value: 'Partner venue', pictogram: 'star', hint: 'Verified IRL partner places' },
  { value: 'Public area', pictogram: 'pin', hint: 'Markets, landmarks, gates' },
];

export const TAG_OPTIONS = ['beginner-friendly', 'low-key', 'quick', 'outdoors', 'indoors', 'quiet', 'creative', 'sport', 'night', 'weekend', 'all levels', 'focus'];
export const COST_OPTIONS = ['Free', 'Pay for your own', 'Split the bill', 'Venue fee'];
export const LEVELS = [
  { value: 'any', label: 'Any level' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];
export const AGE_RANGES = [null, '18–25', '21–30', '25–35', '30+'];

export const MICRO_PLANS = [
  { key: 'chai15', label: 'Chai in 15', sub: '30 min · nearby', category: 'chai', when: 'in15', durationMin: 30 },
  { key: 'walk', label: 'Walk now', sub: '15 min loop', category: 'walk', when: 'now', durationMin: 15 },
  { key: 'cowork', label: 'Cowork hour', sub: 'Starts in 15', category: 'cowork', when: 'in15', durationMin: 60 },
  { key: 'games', label: 'Games tonight', sub: '2 hrs', category: 'boardgames', when: 'tonight', durationMin: 120 },
];

const MIN_LEAD_MS = 30 * 60000;

const at = (now, offsetDays, hhmm) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
};

export function slotLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${m.toString().padStart(2, '0')} ${ampm}` : `${hh} ${ampm}`;
}

export function nextDays(n = 7, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return { offset: i, date: d };
  });
}

// Slots that are still in the future (with a small lead time) for a day offset.
export function availableSlots(slots, dayOffset, now = new Date()) {
  return slots.filter((s) => at(now, dayOffset, s).getTime() > now.getTime() + (dayOffset === 0 ? 20 * 60000 : 0));
}

export function defaultSlotFor(when) {
  if (when === 'tonight') return '19:30';
  if (when === 'weekend') return '10:00';
  return '18:00';
}

// Returns an ISO string, or null when the selection is in the past.
export function computeStartsAt(when, { dayOffset = 0, time } = {}, now = new Date()) {
  const slot = time || defaultSlotFor(when);
  switch (when) {
    case 'now':
      return new Date(now.getTime() + 5 * 60000).toISOString();
    case 'in15':
      return new Date(now.getTime() + 15 * 60000).toISOString();
    case 'tonight': {
      const t = at(now, 0, slot);
      if (t.getTime() > now.getTime() + 20 * 60000) return t.toISOString();
      return now.getHours() < 22 ? new Date(now.getTime() + MIN_LEAD_MS).toISOString() : null;
    }
    case 'tomorrow':
      return at(now, 1, slot).toISOString();
    case 'weekend': {
      for (let off = 0; off <= 7; off += 1) {
        const d = at(now, off, slot);
        if ([0, 6].includes(d.getDay()) && d.getTime() > now.getTime() + 20 * 60000) return d.toISOString();
      }
      return null;
    }
    case 'custom': {
      const d = at(now, dayOffset, slot);
      return d.getTime() > now.getTime() + 20 * 60000 ? d.toISOString() : null;
    }
    default:
      return null;
  }
}

// Map the IRL Guide's time hints onto create-flow "when" values.
export function whenFromAssistant(kind) {
  if (kind === 'tonight') return 'tonight';
  if (kind === 'weekend') return 'weekend';
  if (kind === 'tomorrow') return 'tomorrow';
  return 'in15';
}

const PRIVATE_HINTS = ['my home', 'my house', 'my place', 'my flat', 'my room', 'apartment', 'flat no', 'house no', 'bedroom', ' pg', 'hostel room', 'residence'];
export function looksPrivate(name = '') {
  const n = ` ${name.toLowerCase()}`;
  return PRIVATE_HINTS.some((h) => n.includes(h));
}

export function defaultTitle(slug) {
  const c = categoryBySlug[slug];
  return c ? `${c.short} — anyone?` : '';
}

export const nearestDuration = (min) => DURATIONS.reduce((best, d) => (Math.abs(d - min) < Math.abs(best - min) ? d : best), DURATIONS[0]);

// Build the activity object others will see — same shape as publishDraft().
export function draftToActivity(d, profile, progress) {
  const cat = categoryBySlug[d.category] || categories[0];
  return {
    id: 'preview',
    title: d.title || defaultTitle(cat.slug),
    category: cat.slug,
    pictogram: cat.pictogram,
    startsAt: d.startsAt || new Date(Date.now() + 15 * 60000).toISOString(),
    durationMin: d.durationMin,
    capacity: d.capacity,
    participants: ['me'],
    joinedCount: 1,
    host: { id: 'me', name: profile?.name || 'You', reliability: progress?.showUpRate ?? 1, completed: progress?.completedActivities ?? 0 },
    area: d.area,
    venueName: d.venueName || `Public spot, ${d.area}`,
    venueType: d.venueType,
    distanceM: 0,
    joinRule: d.joinRule,
    cost: d.cost || 'Free',
    description: d.description,
    tags: d.tags,
    accessibility: d.accessibility,
    status: 'open',
    accentIndex: 3, // lavender — stays legible on the periwinkle preview surface
    latitude: CITY_CENTER.latitude,
    longitude: CITY_CENTER.longitude,
  };
}
