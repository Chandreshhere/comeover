// Taxonomy + live lookups. Categories, levels and city areas are owned by the
// backend (admin taxonomy) and arrive with GET /me/bootstrap; the bundled
// values below are only the offline fallback for first launch. The exported
// arrays/objects are updated IN PLACE so existing imports stay live.
//
// People are never bundled: `personById` reads the store's user cache, which
// is filled from API responses (activity hosts, nearby people, members…).

import { PICTOGRAM_ICONS } from '@/components/iconMap';

const DEFAULT_CATEGORIES = [
  { slug: 'chai', label: 'Chai & coffee', short: 'Chai', pictogram: 'chai' },
  { slug: 'badminton', label: 'Badminton', short: 'Badminton', pictogram: 'badminton' },
  { slug: 'gym', label: 'Gym partner', short: 'Gym', pictogram: 'gym' },
  { slug: 'walk', label: 'Walks', short: 'Walk', pictogram: 'walk' },
  { slug: 'run', label: 'Running', short: 'Run', pictogram: 'run' },
  { slug: 'cowork', label: 'Coworking', short: 'Cowork', pictogram: 'laptop' },
  { slug: 'study', label: 'Study', short: 'Study', pictogram: 'book' },
  { slug: 'food', label: 'Food walks', short: 'Food', pictogram: 'food' },
  { slug: 'boardgames', label: 'Board games', short: 'Games', pictogram: 'board' },
  { slug: 'gaming', label: 'Gaming', short: 'Gaming', pictogram: 'game' },
  { slug: 'movies', label: 'Movies', short: 'Movies', pictogram: 'film' },
  { slug: 'music', label: 'Music & jams', short: 'Music', pictogram: 'music' },
  { slug: 'photo', label: 'Photography', short: 'Photo', pictogram: 'camera' },
  { slug: 'explore', label: 'City explore', short: 'Explore', pictogram: 'pin' },
  { slug: 'thrifting', label: 'Thrifting', short: 'Thrift', pictogram: 'thrift' },
  { slug: 'smoke', label: 'Smoke break', short: 'Smoke', pictogram: 'smoke' },
];

const DEFAULT_LEVELS = [
  { level: 1, name: 'Newcomer', xp: 0 },
  { level: 2, name: 'First Hello', xp: 40 },
  { level: 3, name: 'Regular', xp: 100 },
  { level: 4, name: 'Explorer', xp: 160 },
  { level: 5, name: 'Connector', xp: 300 },
  { level: 6, name: 'Host', xp: 480 },
  { level: 7, name: 'Circle Builder', xp: 700 },
  { level: 8, name: 'Local Legend', xp: 1000 },
];

const DEFAULT_CITY = {
  name: 'Ahmedabad',
  center: { latitude: 23.0365, longitude: 72.5611 },
  areas: ['Navrangpura', 'Bodakdev', 'Satellite', 'Vastrapur', 'Prahlad Nagar', 'SG Highway', 'Law Garden', 'Riverfront', 'Old City'],
};

// Pictogram keys the app can draw (components/iconMap.js).
const PICTOGRAMS = new Set(Object.keys(PICTOGRAM_ICONS));

export const categories = [...DEFAULT_CATEGORIES];
export const categoryBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
export const levels = [...DEFAULT_LEVELS];
export const CITY = { name: DEFAULT_CITY.name, areas: [...DEFAULT_CITY.areas] };
export const CITY_CENTER = { ...DEFAULT_CITY.center };
export const areaCentroids = {};

// Called by the store after GET /me/bootstrap (or GET /activities/categories).
export function applyTaxonomy({ categories: cats, levels: lv, city } = {}) {
  if (Array.isArray(cats) && cats.length) {
    const next = cats
      .filter((c) => c.isActive !== false && c.riskLevel !== 'restricted')
      .map((c) => ({
        slug: c.slug,
        label: c.label,
        short: c.short || c.label,
        pictogram: PICTOGRAMS.has(c.pictogram) ? c.pictogram : categoryBySlug[c.slug]?.pictogram || 'sparkle',
        riskLevel: c.riskLevel || 'standard',
      }));
    categories.splice(0, categories.length, ...next);
    Object.keys(categoryBySlug).forEach((k) => delete categoryBySlug[k]);
    next.forEach((c) => {
      categoryBySlug[c.slug] = c;
    });
  }
  if (Array.isArray(lv) && lv.length) levels.splice(0, levels.length, ...[...lv].sort((a, b) => a.xp - b.xp));
  if (city) {
    if (city.name) CITY.name = city.name;
    if (Array.isArray(city.areas) && city.areas.length) {
      CITY.areas.splice(0, CITY.areas.length, ...city.areas.map((a) => (typeof a === 'string' ? a : a.name)));
      city.areas.forEach((a) => {
        if (typeof a === 'object' && a.lat != null) areaCentroids[a.name] = { latitude: a.lat, longitude: a.lng };
      });
    }
    if (city.center) {
      CITY_CENTER.latitude = city.center.lat ?? city.center.latitude;
      CITY_CENTER.longitude = city.center.lng ?? city.center.longitude;
    }
  }
}

// Live user lookup backed by the store's `users` cache (set in useAppStore).
let userSource = () => ({});
export const setUserSource = (fn) => {
  userSource = fn;
};
export const getPerson = (id) => userSource()[id] || null;
export const personById = new Proxy(
  {},
  {
    get: (_, id) => (typeof id === 'string' ? userSource()[id] : undefined),
    has: (_, id) => id in userSource(),
  }
);
