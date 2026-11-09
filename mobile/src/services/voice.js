// Guide voice: a thin, crash-proof wrapper around react-native-tts.
//
// API
//   speak(text, { onStart, onDone }) → token (> 0) when speech was attempted,
//                                      0 when it wasn't (muted, no native
//                                      module, screen reader on, empty text).
//                                      onDone(reason) fires exactly once per
//                                      attempted line: 'finish' | 'cancel' |
//                                      'stopped' | 'replaced' | 'error' | 'timeout'.
//   stop(token?)                     → stops the current line (or only that
//                                      line when a token is given).
//   isAvailable()                    → the native module is linked and usable.
//
// Every native call is wrapped: the module is required lazily, only when the
// native side exists, so a build without the pod/gradle link (or a TTS engine
// that refuses to start) silently falls back to a text-only guide.
//
// Respects prefs.guideVoice (the mute button) and VoiceOver/TalkBack: when a
// screen reader is on it already reads the bubble text, so the guide stays
// quiet instead of talking over it.
import { AccessibilityInfo, Image, NativeModules, Platform } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import { clipFor } from './voiceClips';
import ENVELOPES from './voiceEnvelopes.json';
import { soundLib } from './sfx';
import { useAppStore } from '@/store/useAppStore';

const RATE = 0.48;
const PITCH = 1.1;
// Preferred voices, best first. en-IN matches the app's audience; the others
// are installed on practically every device.
const LANG_ORDER = ['en-IN', 'en-US', 'en-GB', 'en-AU', 'en'];

let mod = null; // the react-native-tts singleton
let loadTried = false;
let broken = false; // init failed (no engine, rejected config…)
let initPromise = null;
let subscriptions = [];
let screenReaderOn = false;
let srSubscription = null;

let seq = 0;
let active = null; // { token, id, onStart, onDone, started, done, timer }
const retired = new Set(); // utterance ids we stopped/replaced — ignore their late events

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
};
// Native methods return promises; never leave a rejection unhandled.
const quiet = (p) => {
  if (p && typeof p.then === 'function') return p.catch(() => null);
  return Promise.resolve(p);
};

function load() {
  if (loadTried) return mod;
  loadTried = true;
  try {
    // react-native-tts builds a NativeEventEmitter at import time, which
    // throws on iOS when the native module is missing — check first.
    if (!NativeModules || !NativeModules.TextToSpeech) return null;
    // eslint-disable-next-line global-require
    const m = require('react-native-tts');
    mod = (m && m.default) || m || null;
  } catch (e) {
    mod = null;
  }
  if (mod) watchScreenReader();
  return mod;
}

function watchScreenReader() {
  if (srSubscription) return;
  safe(() => {
    quiet(AccessibilityInfo.isScreenReaderEnabled()).then((on) => {
      screenReaderOn = !!on;
    });
    srSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => {
      screenReaderOn = !!on;
      if (on) stop();
    });
  });
}

const normLang = (l) => String(l || '').replace('_', '-').toLowerCase();

function pickVoice(voices) {
  const usable = (voices || []).filter((v) => v && v.id && !v.notInstalled && !v.networkConnectionRequired && normLang(v.language).startsWith('en'));
  for (const lang of LANG_ORDER) {
    const want = lang.toLowerCase();
    const matches = usable.filter((v) => (want === 'en' ? true : normLang(v.language) === want));
    if (matches.length) {
      // Higher quality first (iOS: 500 enhanced/premium > 300 default).
      return matches.sort((a, b) => (b.quality || 0) - (a.quality || 0))[0];
    }
  }
  return null;
}

function init() {
  if (initPromise) return initPromise;
  const tts = load();
  if (!tts) {
    broken = true;
    initPromise = Promise.resolve(false);
    return initPromise;
  }
  initPromise = (async () => {
    try {
      // Android: resolves once an engine is bound, rejects when none exists.
      await tts.getInitStatus();
    } catch (e) {
      broken = true;
      return false;
    }
    safe(() => {
      subscriptions = [
        tts.addEventListener('tts-start', (e) => onEvent('start', e)),
        tts.addEventListener('tts-finish', (e) => onEvent('finish', e)),
        tts.addEventListener('tts-cancel', (e) => onEvent('cancel', e)),
        // iOS has no 'tts-error' event (subscribing to it raises a red box in dev).
        ...(Platform.OS === 'android' ? [tts.addEventListener('tts-error', (e) => onEvent('error', e))] : []),
      ].filter(Boolean);
    });
    // Don't let the speech engine touch the audio session: its 'ignore silent
    // switch' / ducking modes take audio focus and pause the user's music
    // (Spotify, Apple Music) without resuming it. sfx.js sets the one session
    // the app uses: Playback + mix-with-others (plays on silent, never stops
    // other audio).
    await quiet(safe(() => tts.setDefaultRate(RATE, false)));
    await quiet(safe(() => tts.setDefaultPitch(PITCH)));
    const voices = await quiet(safe(() => tts.voices()));
    const voice = pickVoice(voices);
    if (voice) {
      await quiet(safe(() => tts.setDefaultLanguage(voice.language)));
      await quiet(safe(() => tts.setDefaultVoice(voice.id)));
    } else {
      await quiet(safe(() => tts.setDefaultLanguage(Platform.OS === 'ios' ? 'en-US' : 'en-IN')));
    }
    return true;
  })().catch(() => {
    broken = true;
    return false;
  });
  return initPromise;
}

// Lip sync: while a recorded line plays, `lipLevel` (0..1) follows the audio's
// loudness (precomputed by scripts/voice-envelopes.js) and `lipOn` is 1. Mo's
// mouth reads these on the UI thread.
export const lipLevel = makeMutable(0);
export const lipOn = makeMutable(0);
let lipTimer = null;
function stopLip() {
  if (lipTimer) clearInterval(lipTimer);
  lipTimer = null;
  lipOn.value = 0;
  lipLevel.value = 0;
}
function startLip(key) {
  const e = ENVELOPES[key];
  stopLip();
  if (!e) return;
  const t0 = Date.now() + 30; // small output latency
  const frame = 1000 / e.fps;
  lipOn.value = 1;
  lipTimer = setInterval(() => {
    const i = Math.floor((Date.now() - t0) / frame);
    if (i >= e.env.length) {
      stopLip();
      return;
    }
    lipLevel.value = i < 0 ? 0 : e.env[i];
  }, 33);
}

function finish(req, reason) {
  if (!req || req.done) return;
  req.done = true;
  if (req.clip || req.lip) stopLip();
  if (req.timer) clearTimeout(req.timer);
  if (req.clip) {
    const clip = req.clip;
    req.clip = null;
    safe(() => {
      if (reason !== 'finish') clip.stop();
      clip.release();
    });
  }
  if (req.id != null && reason !== 'finish') retired.add(String(req.id));
  if (active === req) active = null;
  safe(() => req.onDone && req.onDone(reason));
}

function onEvent(type, e) {
  const id = e && e.utteranceId != null ? String(e.utteranceId) : null;
  if (id && retired.has(id)) {
    if (type !== 'start') retired.delete(id);
    return;
  }
  const req = active;
  if (!req) return;
  if (req.id != null && id != null && req.id !== id) return;
  // A finish/cancel before our line even started belongs to the line we just
  // replaced (its id may not have been known yet) — ignore it.
  if (type !== 'start' && req.id == null && !req.started) return;
  if (type === 'start') {
    if (req.id == null && id != null) req.id = id;
    if (!req.started) {
      req.started = true;
      safe(() => req.onStart && req.onStart());
    }
    return;
  }
  finish(req, type);
}

const voiceEnabled = () => safe(() => useAppStore.getState().prefs.guideVoice !== false, true);

export function isAvailable() {
  return !broken && !!load();
}

// Mo's recorded line, if there is one (see voiceClips.js). Returns a token, or 0.
function playClip({ asset, key }, { onStart, onDone }) {
  const S = soundLib();
  const uri = S && safe(() => Image.resolveAssetSource(asset)?.uri, null);
  if (!uri) return 0;
  const req = { token: ++seq, id: null, onStart, onDone, started: false, done: false, timer: null, clip: null };
  active = req;
  req.timer = setTimeout(() => finish(req, 'timeout'), 15000);
  try {
    const snd = new S(uri, '', (err) => {
      if (req.done) {
        safe(() => snd.release());
        return;
      }
      if (err) {
        finish(req, 'error');
        return;
      }
      req.clip = snd;
      req.started = true;
      req.lip = true;
      safe(() => onStart && onStart());
      snd.play(() => finish(req, 'finish'));
      startLip(key);
    });
  } catch (e) {
    finish(req, 'error');
    return 0;
  }
  return req.token;
}

export function speak(text, { onStart, onDone } = {}) {
  const line = String(text || '').trim();
  if (!line || !voiceEnabled() || screenReaderOn) return 0;

  // One voice at a time: the new line replaces whatever was playing.
  const clip = clipFor(line);
  if (clip) {
    if (active) finish(active, 'replaced');
    if (mod && !broken) safe(() => quiet(mod.stop()));
    const t = playClip(clip, { onStart, onDone });
    if (t) return t;
  }
  if (!isAvailable()) return 0;

  // One voice at a time: the new line replaces whatever was playing.
  if (active) {
    finish(active, 'replaced');
    safe(() => quiet(mod.stop()));
  }
  const req = { token: ++seq, id: null, onStart, onDone, started: false, done: false, timer: null };
  active = req;
  // Safety net: if the engine never reports back, end the line anyway so the
  // character doesn't keep talking forever.
  req.timer = setTimeout(() => finish(req, 'timeout'), 3000 + line.length * 110);

  init().then((ok) => {
    if (req.done) return;
    if (!ok) {
      finish(req, 'error');
      return;
    }
    let call;
    try {
      call = mod.speak(line);
    } catch (e) {
      finish(req, 'error');
      return;
    }
    quiet(call).then((id) => {
      if (id == null) return;
      if (req.done) retired.add(String(id));
      else if (req.id == null) req.id = String(id);
    });
    if (call && typeof call.then === 'function') call.catch(() => finish(req, 'error'));
  });
  return req.token;
}

export function stop(token) {
  const req = active;
  if (token != null && (!req || req.token !== token)) return;
  if (req) finish(req, 'stopped');
  if (mod && !broken) safe(() => quiet(mod.stop()));
}

// Warm the engine up (voice list, rate) before the first line so the first
// sentence doesn't start late. Safe to call any time.
// Prime the shared audio session (Playback + mix with others) early.
export function prepare() {
  safe(() => soundLib());
  if (!voiceEnabled() || !load()) return;
  init();
}

// For tests / teardown.
export function _reset() {
  stop();
  subscriptions.forEach((s) => safe(() => s.remove()));
  subscriptions = [];
}

export default { speak, stop, isAvailable, prepare };
