'use strict';
// Location privacy helpers. Rule (08_api_contract.json): return approximate
// location to other users; never expose exact coordinates. Activity venue
// coordinates are snapped to a ~300 m grid unless the caller is the host or an
// accepted participant of a plan whose host allowed exact location after accept.
//
// Mongo: activities/venues carry a GeoJSON `location` with a 2dsphere index;
// use nearFilter()/geoNearStage() for "plans within R km" queries.

const M_PER_DEG_LAT = 111320;
const DEFAULT_GRID_M = 300;
const MAX_RADIUS_KM = 25;
const DEFAULT_RADIUS_KM = 3;

const toRad = (d) => (d * Math.PI) / 180;
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Snap to the centre of a grid cell. Deterministic per cell, so repeated
// requests can't be averaged to recover the true point.
function snapToGrid(lat, lng, gridM = DEFAULT_GRID_M) {
  if (!isValidCoord(lat, lng)) return null;
  const latStep = gridM / M_PER_DEG_LAT;
  const cellLat = (Math.floor(lat / latStep) + 0.5) * latStep;
  const lngStep = gridM / (M_PER_DEG_LAT * Math.max(Math.cos(toRad(cellLat)), 1e-6));
  const cellLng = (Math.floor(lng / lngStep) + 0.5) * lngStep;
  return { latitude: round(cellLat, 5), longitude: round(cellLng, 5) };
}

function haversineMeters(a, b) {
  const R = 6371008.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Coarse distance that is safe to show: < 300 m floor, 100 m steps < 1 km,
// 500 m steps < 10 km, 1 km steps beyond.
function coarseDistanceMeters(m) {
  if (m == null || !Number.isFinite(m)) return null;
  if (m < 300) return 300;
  if (m < 1000) return Math.round(m / 100) * 100;
  if (m < 10000) return Math.round(m / 500) * 500;
  return Math.round(m / 1000) * 1000;
}

function distanceBand(m) {
  if (m == null || !Number.isFinite(m)) return 'Nearby';
  if (m < 300) return '< 300 m';
  const c = coarseDistanceMeters(m);
  if (c < 1000) return `~${c} m`;
  const km = c / 1000;
  return `~${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

function clampRadiusKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(n, MAX_RADIUS_KM);
}

// Decide what location to show a viewer for an activity (Mongo doc, camelCase).
// viewer = { isHost, isAccepted }
function presentLocation(activity, viewer) {
  const lat = activity.latitude;
  const lng = activity.longitude;
  const area = activity.coarseArea || null;
  if (lat == null || lng == null) return { area, latitude: null, longitude: null, precision: 'area' };
  const exact = viewer && (viewer.isHost || (viewer.isAccepted && activity.exactLocationVisibleAfterAccept));
  if (exact) return { area, latitude: lat, longitude: lng, precision: 'exact' };
  const s = snapToGrid(lat, lng);
  return { area, latitude: s.latitude, longitude: s.longitude, precision: `approx_${DEFAULT_GRID_M}m` };
}

function withinMeters(a, b, meters) {
  if (!a || !b || !isValidCoord(a.latitude, a.longitude) || !isValidCoord(b.latitude, b.longitude)) return false;
  return haversineMeters(a, b) <= meters;
}

// --- geohash (replaces PostGIS ST_GeoHash) --------------------------------
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohash(lat, lng, precision = 6) {
  if (!isValidCoord(lat, lng)) return null;
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

// ~1.2 km × 0.6 km cell used for coarse availability / activity grouping.
const cellId = (lat, lng) => geohash(lat, lng, 6);

// --- Mongo query helpers ---------------------------------------------------
const toPoint = (lat, lng) => (isValidCoord(lat, lng) ? { type: 'Point', coordinates: [Number(lng), Number(lat)] } : null);

// Filter for find(): documents whose `field` is within radiusKm of (lat,lng).
// ($geoWithin/$centerSphere works inside transactions and with sort/skip; no distance returned.)
function withinFilter(lat, lng, radiusKm, field = 'location') {
  if (!isValidCoord(lat, lng)) return {};
  const radians = clampRadiusKm(radiusKm) / 6378.1;
  return { [field]: { $geoWithin: { $centerSphere: [[Number(lng), Number(lat)], radians] } } };
}

// First stage of an aggregate() that also returns `distanceM` (must be the first stage).
function geoNearStage(lat, lng, radiusKm, { field = 'location', query = {}, distanceField = 'distanceM' } = {}) {
  return {
    $geoNear: {
      near: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
      distanceField,
      maxDistance: clampRadiusKm(radiusKm) * 1000,
      spherical: true,
      key: field,
      query,
    },
  };
}

module.exports = {
  DEFAULT_GRID_M,
  MAX_RADIUS_KM,
  DEFAULT_RADIUS_KM,
  isValidCoord,
  snapToGrid,
  haversineMeters,
  coarseDistanceMeters,
  distanceBand,
  clampRadiusKm,
  presentLocation,
  withinMeters,
  geohash,
  cellId,
  toPoint,
  withinFilter,
  geoNearStage,
};
