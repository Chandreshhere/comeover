// Device location for discovery queries. Coordinates are rounded to ~1 km
// before leaving the device; other users only ever receive coarse areas.
import Geolocation from '@react-native-community/geolocation';

Geolocation.setRNConfiguration({ skipPermissionRequests: true, authorizationLevel: 'whenInUse', locationProvider: 'auto' });

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function getCoarsePosition({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ latitude: round(p.coords.latitude), longitude: round(p.coords.longitude) }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60000 }
    );
  });
}

// Precise one-off read used only for optional proximity check-in; not stored.
export function getPrecisePosition({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}
