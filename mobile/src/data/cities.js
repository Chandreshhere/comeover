// Every city Come Over covers (GET /cities), cached for the session, plus a
// nearest-city match for a location fix. Areas are coarse neighbourhoods only.
import { cities as citiesApi } from '@/api/endpoints';

let cache = null;
let inflight = null;

// [{ name, center: { lat, lng }, areas: [{ name, lat, lng }] }], [] when offline.
export function loadCities() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = citiesApi
      .list()
      .then((r) => {
        const items = Array.isArray(r?.items) ? r.items.filter((c) => c && c.name && Array.isArray(c.areas) && c.areas.length) : [];
        if (items.length) cache = items;
        return items;
      })
      .catch(() => [])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export const cachedCities = () => cache || [];

const km = (a, b) => {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};

// The city (and its closest area) for a coordinate, or null when nothing we
// cover is within `maxKm`.
export function nearestCity(list, latitude, longitude, maxKm = 60) {
  if (!Array.isArray(list) || latitude == null || longitude == null) return null;
  const here = { lat: latitude, lng: longitude };
  let best = null;
  for (const city of list) {
    for (const area of city.areas || []) {
      if (area.lat == null || area.lng == null) continue;
      const d = km(here, area);
      if (!best || d < best.km) best = { city, area: area.name, km: d };
    }
  }
  return best && best.km <= maxKm ? best : null;
}
