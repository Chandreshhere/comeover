// Discovery helpers shared by search, category results, map and live radar.
// Pure functions — derive lists with useMemo in components.
import { Platform } from 'react-native';

// iOS presents modals as page sheets (no status-bar inset needed); Android
// presents them full-screen, so keep the top safe-area there.
export const MODAL_EDGES = Platform.OS === 'ios' ? [] : ['top'];

export const WHEN_OPTIONS = [
  { value: 'any', label: 'Any time' },
  { value: 'now', label: 'Starting soon' },
  { value: 'today', label: 'Today' },
  { value: 'tonight', label: 'Tonight' },
  { value: 'weekend', label: 'Weekend' },
];

export const GROUP_OPTIONS = [
  { value: 'any', label: 'Any size' },
  { value: 'small', label: '2–4 people' },
  { value: 'medium', label: '5–8 people' },
  { value: 'large', label: '9+ people' },
];

export const LEVEL_OPTIONS = [
  { value: 'any', label: 'Any level' },
  { value: 'beginner', label: 'Beginner-friendly' },
  { value: 'intermediate', label: 'Intermediate' },
];

const BEGINNER_TAGS = ['beginner-friendly', 'all levels', 'easy', 'low-key', 'micro-plan'];

export const endsAt = (a) => new Date(a.startsAt).getTime() + (a.durationMin || 60) * 60000;
export const isEnded = (a, now = Date.now()) => endsAt(a) < now;
export const hasStarted = (a, now = Date.now()) => new Date(a.startsAt).getTime() <= now;
export const isFull = (a) => (a.joinedCount ?? a.participants?.length ?? 0) >= a.capacity;

// Check-in window: 30 minutes before start until the plan ends.
export const inCheckinWindow = (a, now = Date.now()) => now >= new Date(a.startsAt).getTime() - 30 * 60000 && now <= endsAt(a);

function matchesWhen(a, when, now) {
  if (!when || when === 'any') return true;
  const s = new Date(a.startsAt);
  const n = new Date(now);
  const sameDay = s.toDateString() === n.toDateString();
  switch (when) {
    case 'now':
      return a.live || s.getTime() - now < 90 * 60000;
    case 'today':
      return sameDay;
    case 'tonight':
      return s.getHours() >= 17 && (sameDay || (n.getHours() >= 21 && s.getTime() - now < 24 * 3600000));
    case 'weekend':
      return s.getDay() === 0 || s.getDay() === 6;
    default:
      return true;
  }
}

function matchesGroup(a, size) {
  if (!size || size === 'any') return true;
  if (size === 'small') return a.capacity <= 4;
  if (size === 'medium') return a.capacity >= 5 && a.capacity <= 8;
  return a.capacity > 8;
}

function matchesLevel(a, level) {
  if (!level || level === 'any') return true;
  const tags = (a.tags || []).map((t) => t.toLowerCase());
  if (level === 'beginner') return tags.some((t) => BEGINNER_TAGS.includes(t)) || !tags.includes('intermediate');
  return tags.includes('intermediate') || tags.includes('all levels');
}

export function visibleActivities(activities, { blocked = [], now = Date.now() } = {}) {
  return activities.filter((a) => a.status !== 'cancelled' && a.status !== 'moderated' && !blocked.includes(a.host?.id) && !isEnded(a, now));
}

export function applyFilters(activities, f = {}, now = Date.now()) {
  return activities.filter((a) => {
    if (f.distanceKm && a.distanceM != null && a.distanceM > f.distanceKm * 1000) return false;
    if (!matchesWhen(a, f.when, now)) return false;
    if (!matchesGroup(a, f.groupSize)) return false;
    if (!matchesLevel(a, f.level)) return false;
    if (f.accessible && !a.accessibility) return false;
    if (f.freeOnly && !/free/i.test(a.cost || '')) return false;
    if (f.categories?.length && !f.categories.includes(a.category)) return false;
    return true;
  });
}

export function countActiveFilters(f = {}, defaultKm = 3) {
  let n = 0;
  if (f.distanceKm && f.distanceKm !== defaultKm) n++;
  if (f.when && f.when !== 'any') n++;
  if (f.groupSize && f.groupSize !== 'any') n++;
  if (f.level && f.level !== 'any') n++;
  if (f.accessible) n++;
  if (f.freeOnly) n++;
  if (f.categories?.length) n++;
  return n;
}

export const SORTS = [
  { value: 'soonest', label: 'Soonest' },
  { value: 'nearest', label: 'Nearest' },
  { value: 'popular', label: 'Most joined' },
];

export function sortActivities(list, sort) {
  const copy = [...list];
  if (sort === 'nearest') copy.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
  else if (sort === 'popular') copy.sort((a, b) => b.joinedCount / b.capacity - a.joinedCount / a.capacity);
  else copy.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  return copy;
}

// Maps store join state to the JoinButton visual state.
export const joinUiState = (st) =>
  st === 'requested' ? 'requested' : st === 'accepted' || st === 'checked_in' ? 'accepted' : st === 'waitlisted' ? 'waitlisted' : 'idle';

// Deterministic small hash for stable pseudo-placement (radar blips etc.).
export function hashStr(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Privacy-safe clustering: snap to a ~1.1 km grid and aggregate. Pins show the
// cluster centroid, never an individual's position.
export function clusterActivities(list, cell = 0.012) {
  const buckets = new Map();
  list.forEach((a) => {
    if (a.latitude == null || a.longitude == null) return;
    const key = `${Math.round(a.latitude / cell)}:${Math.round(a.longitude / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(a);
  });
  return [...buckets.entries()].map(([key, items]) => ({
    id: key,
    items,
    latitude: items.reduce((s, a) => s + a.latitude, 0) / items.length,
    longitude: items.reduce((s, a) => s + a.longitude, 0) / items.length,
    pictogram: items[0].pictogram,
    area: items[0].area,
  }));
}
