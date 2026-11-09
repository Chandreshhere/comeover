// UI sound effects: tiny original sounds (src/assets/sounds, synthesised for
// Come Over) that go with animations: pop, ping, pong, chime, whoosh, tick, blip.
//
//   sfx.play('pop')            fire and forget
//   sfx.play('chime', { volume: 0.6 })
//
// Respects Settings → Sounds (prefs.sound). Every native call is guarded and
// the module is loaded lazily, so a missing native module never crashes.
import { Image } from 'react-native';
import { useAppStore } from '@/store/useAppStore';

const FILES = {
  pop: require('../assets/sounds/pop.wav'),
  ping: require('../assets/sounds/ping.wav'),
  pong: require('../assets/sounds/pong.wav'),
  chime: require('../assets/sounds/chime.wav'),
  whoosh: require('../assets/sounds/whoosh.wav'),
  tick: require('../assets/sounds/tick.wav'),
  blip: require('../assets/sounds/blip.wav'),
};

const VOLUME = { pop: 0.7, ping: 0.55, pong: 0.55, chime: 0.6, whoosh: 0.45, tick: 0.35, blip: 0.4 };

let Sound = null;
let broken = false;
const cache = {}; // name -> Sound instance (loaded once, replayed)

function lib() {
  if (Sound || broken) return Sound;
  try {
    // eslint-disable-next-line global-require
    Sound = require('react-native-sound').default;
    // Play even with the ring/silent switch on, and ALWAYS mix with other audio
    // (mixWithOthers = true) so the user's music keeps playing underneath.
    Sound.setCategory('Playback', true);
  } catch (e) {
    broken = true;
    Sound = null;
  }
  return Sound;
}

function load(name) {
  if (cache[name]) return cache[name];
  const S = lib();
  if (!S || !FILES[name]) return null;
  try {
    const uri = Image.resolveAssetSource(FILES[name])?.uri;
    if (!uri) return null;
    const s = new S(uri, '', (err) => {
      if (err) delete cache[name];
    });
    cache[name] = s;
    return s;
  } catch (e) {
    return null;
  }
}

export function enabled() {
  return useAppStore.getState().prefs?.sound !== false;
}

// Warm the cache so the first play isn't late (call once at startup).
export function preload(names = Object.keys(FILES)) {
  if (!enabled()) return;
  names.forEach(load);
}

export function play(name, { volume } = {}) {
  if (!enabled()) return;
  const s = load(name);
  if (!s) return;
  try {
    const go = () => {
      s.setVolume(volume ?? VOLUME[name] ?? 0.6);
      s.stop(() => s.play());
    };
    if (s.isLoaded()) go();
    else setTimeout(() => s.isLoaded() && go(), 120);
  } catch (e) {
    // ignore: sound is a nice-to-have
  }
}

// The shared audio library (also used for Mo's recorded voice lines).
export const soundLib = () => lib();

const sfx = { play, preload, enabled };
export default sfx;
