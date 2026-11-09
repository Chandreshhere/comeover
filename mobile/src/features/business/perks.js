// Partner perks: pure helpers shared by the app and the business hub.
// Offers come from the API already labelled (label, window, eligibility);
// these helpers only fill gaps, turn lock reasons and error codes into plain
// words, and validate the business offer form against the contract ranges.
// Product rules: XP is never spent; perks unlock as you level up; venues fund
// the discounts; no payments here.
import { levels } from '@/data/catalog';
import { inr } from '@/utils/format';

export const XP_NOTE = 'Your XP is never spent. Perks unlock as you level up.';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const MAX_OPEN_OFFERS = 10;

// 0 = Sun … 6 = Sat (IST). Shown Monday first.
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const levelName = (n) => levels.find((l) => l.level === Number(n))?.name || null;
export const levelLabel = (n, name) => {
  const nm = name || levelName(n);
  return `Level ${n}${nm ? `, ${nm}` : ''}`;
};

// Flat offers are whole rupees; utils/format's inr() takes paise.
const rupees = (n) => inr(Math.round(Number(n) || 0) * 100);

// "4 pm", "4:30 pm", "12 pm", "12 am".
export function clockLabel(minute, { suffix = true } = {}) {
  const m = ((Number(minute) || 0) % 1440 + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h = h24 % 12 || 12;
  const base = mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}`;
  return suffix ? `${base} ${h24 < 12 ? 'am' : 'pm'}` : base;
}

function timeRange(start, end) {
  const s = Number(start) || 0;
  const e = end == null ? 1440 : Number(end);
  if (s <= 0 && e >= 1440) return '';
  if (e >= 1440) return `from ${clockLabel(s)}`;
  if (s <= 0) return `until ${clockLabel(e)}`;
  const sameHalf = (s < 720) === (e < 720);
  return `${clockLabel(s, { suffix: !sameHalf })} to ${clockLabel(e)}`;
}

function dayRange(days) {
  const set = new Set((Array.isArray(days) && days.length ? days : ALL_DAYS).map(Number));
  if (set.size === 7) return '';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  const idx = ordered.map((d) => WEEK_ORDER.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && ordered.length >= 3) return `${DAY_SHORT[ordered[0]]} to ${DAY_SHORT[ordered[ordered.length - 1]]}`;
  return ordered.map((d) => DAY_SHORT[d]).join(', ');
}

// Plain-English window, matching the server's `window` ("Any time",
// "Mon to Thu, 4 to 7 pm", "Weekends, from 8 am").
export function windowLabel({ days, startMinute = 0, endMinute = 1440 } = {}) {
  const d = dayRange(days);
  const t = timeRange(startMinute, endMinute);
  if (!d && !t) return 'Any time';
  if (!d) return `Every day, ${t}`;
  return t ? `${d}, ${t}` : d;
}

export function offerLabel(o = {}) {
  if (o.label) return o.label;
  if (o.kind === 'percent' && o.value) return `${o.value}% off`;
  if (o.kind === 'flat' && o.value) return `${rupees(o.value)} off`;
  return o.title || 'Member perk';
}

// New-style offers (VenueOffer) carry an id and a kind or label. The legacy
// venue `offers` field (strings / { title, terms }) does not.
export const isPerkOffer = (o) => !!o && typeof o === 'object' && !!o.id && !!(o.kind || o.label);

export function normaliseOffer(o) {
  if (!isPerkOffer(o)) return null;
  const days = Array.isArray(o.days) && o.days.length ? o.days : ALL_DAYS;
  const startMinute = o.startMinute ?? 0;
  const endMinute = o.endMinute ?? 1440;
  return {
    ...o,
    days,
    startMinute,
    endMinute,
    minGroup: o.minGroup ?? 1,
    minLevel: o.minLevel ?? 1,
    minShowUpRate: o.minShowUpRate ?? 0,
    perUserPerWeek: o.perUserPerWeek ?? 1,
    label: offerLabel(o),
    window: o.window || windowLabel({ days, startMinute, endMinute }),
    eligibility: o.eligibility || null,
  };
}

// Short condition chips under an offer: window, group size, level.
export function offerConditions(o) {
  if (!o) return [];
  return [
    o.window && o.window !== 'Any time' ? o.window : null,
    o.minGroup > 1 ? `Groups of ${o.minGroup}+` : null,
    o.minLevel > 1 ? `Level ${o.minLevel}+` : null,
  ].filter(Boolean);
}

const REASON_ORDER = ['level', 'show_up', 'weekly_limit', 'not_now'];

// One reason in plain words. `ctx` is the offer (or { minShowUpRate, window, unlockLevel… }).
export function reasonText(reason, ctx = {}) {
  const el = ctx.eligibility || {};
  switch (reason) {
    case 'level': {
      const lv = el.unlockLevel ?? ctx.unlockLevel ?? ctx.minLevel;
      return lv ? `Unlocks at ${levelLabel(lv, el.unlockLevelName ?? ctx.unlockLevelName)}` : 'Unlocks at a higher level';
    }
    case 'show_up': {
      const rate = ctx.minShowUpRate;
      return rate ? `Needs ${Math.round(rate * 100)}% show-up` : 'Needs a better show-up rate';
    }
    case 'weekly_limit':
      return 'Used this week';
    case 'not_now':
      return ctx.window && ctx.window !== 'Any time' ? `Available ${ctx.window}` : 'Not available right now';
    default:
      return null;
  }
}

export function sortReasons(reasons = []) {
  return [...new Set(reasons)].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));
}

// The first (most important) reason this offer can't be used right now, or null.
export function lockReason(o) {
  const el = o?.eligibility;
  if (!el || el.eligible) return null;
  const [first] = sortReasons(el.reasons || []);
  return reasonText(first, o) || 'Not available right now';
}

// Level or show-up not met: the offer is locked (vs. just not now / used).
export const isLocked = (o) => !!o?.eligibility && (o.eligibility.reasons || []).some((r) => r === 'level' || r === 'show_up');

// Staff-typed codes: case-insensitive, spaces and dashes ignored.
export function normaliseCode(raw = '') {
  return String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export const spacedCode = (code = '') => String(code).split('').join(' ');

export const msLeft = (expiresAt, now = Date.now()) => (expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : 0);

export function countdownLabel(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const isNetwork = (e) => e?.status === 0 || e?.code === 'network' || e?.code === 'timeout' || e?.code === 'not_configured';
export const NO_CONNECTION = 'No connection. Check your internet and try again.';

// Never shows a raw server message: known codes get friendly copy, the rest a calm fallback.
export function friendlyError(e, fallback, map = {}) {
  if (isNetwork(e)) return NO_CONNECTION;
  const m = map[e?.code];
  if (typeof m === 'function') return m(e);
  return m || fallback;
}

export const isOffline = isNetwork;
// The endpoint isn't there yet (backend not deployed) or the thing is gone.
export const isMissing = (e) => e?.status === 404 || e?.status === 405 || e?.code === 'route_not_found';

// POST /offers/{id}/redeem errors → { title, body }.
export function redeemErrorCopy(e, offer) {
  const details = e?.data?.details || {};
  switch (e?.code) {
    case 'offer_locked': {
      const reasons = sortReasons(details.reasons || ['level']);
      const text = reasonText(reasons[0], { ...(offer || {}), unlockLevel: details.unlockLevel, unlockLevelName: details.unlockLevelName });
      return { title: 'Still locked', body: `${text || 'This perk is locked for now'}. ${XP_NOTE}` };
    }
    case 'weekly_limit':
      return { title: 'Used this week', body: 'You have already used this perk this week. It comes back next week.' };
    case 'not_now':
      return {
        title: 'Not right now',
        body: offer?.window && offer.window !== 'Any time' ? `This perk works ${offer.window}. Come back then.` : 'This perk is not available at the moment. Try again later.',
      };
    case 'offer_not_found':
      return { title: 'Perk has ended', body: 'This venue is not running this perk any more.' };
    default:
      if (isNetwork(e)) return { title: 'You are offline', body: NO_CONNECTION, retry: true };
      if (isMissing(e)) return { title: 'Perks are almost here', body: 'Codes are not ready in your area yet. Check back soon.' };
      return { title: 'Could not get a code', body: 'Something went wrong on our side. Try again in a moment.', retry: true };
  }
}

// POST /business/redemptions/confirm errors.
export const CONFIRM_ERRORS = {
  code_not_found: 'We could not find that code. Check the letters and try again.',
  code_used: 'This code was already used.',
  code_expired: 'This code has expired. Ask the guest to get a new one in the app.',
  wrong_venue: 'This code is for a different venue.',
  route_not_found: 'Code checks are not switched on yet. Try again later.',
};

// ---------- business offer form ----------
export const OFFER_KINDS = [
  { value: 'percent', label: 'Percent off' },
  { value: 'flat', label: 'Flat off' },
  { value: 'freebie', label: 'Freebie' },
];

export const SHOW_UP_OPTIONS = [
  { value: 0, label: 'Any' },
  { value: 0.6, label: '60%' },
  { value: 0.7, label: '70%' },
  { value: 0.8, label: '80%' },
  { value: 0.9, label: '90%' },
  { value: 1, label: '100%' },
];

export const emptyOfferForm = () => ({
  title: '',
  description: '',
  kind: 'percent',
  value: '15',
  minGroup: 2,
  minLevel: 1,
  minShowUpRate: 0.8,
  days: [...ALL_DAYS],
  startMinute: 0,
  endMinute: 1440,
  perUserPerWeek: 1,
});

export function offerToForm(o) {
  const n = normaliseOffer(o) || {};
  return {
    ...emptyOfferForm(),
    title: n.title || '',
    description: n.description || '',
    kind: n.kind || 'percent',
    value: n.value != null ? String(n.value) : '',
    minGroup: n.minGroup ?? 2,
    minLevel: n.minLevel ?? 1,
    minShowUpRate: n.minShowUpRate ?? 0.8,
    days: n.days || [...ALL_DAYS],
    startMinute: n.startMinute ?? 0,
    endMinute: n.endMinute ?? 1440,
    perUserPerWeek: n.perUserPerWeek ?? 1,
  };
}

const isInt = (v) => Number.isInteger(v);
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

// Mirrors the contract ranges. Returns { field: message } (empty when valid).
export function validateOffer(f) {
  const errors = {};
  const title = (f.title || '').trim();
  if (title.length < 2 || title.length > 60) errors.title = 'Use 2 to 60 characters.';
  if ((f.description || '').trim().length > 240) errors.description = 'Keep it under 240 characters.';
  if (!OFFER_KINDS.some((k) => k.value === f.kind)) errors.kind = 'Pick a kind of offer.';
  const value = Number(String(f.value ?? '').trim());
  if (f.kind === 'percent' && !inRange(value, 5, 50)) errors.value = 'Pick a whole number from 5 to 50.';
  if (f.kind === 'flat' && !inRange(value, 10, 5000)) errors.value = 'Pick a whole rupee amount from 10 to 5,000.';
  if (!inRange(f.minGroup, 1, 20)) errors.minGroup = 'Group size is 1 to 20.';
  if (!inRange(f.minLevel, 1, 10)) errors.minLevel = 'Level is 1 to 10.';
  if (!(typeof f.minShowUpRate === 'number' && f.minShowUpRate >= 0 && f.minShowUpRate <= 1)) errors.minShowUpRate = 'Pick a show-up rate.';
  const days = Array.isArray(f.days) ? f.days : [];
  if (!days.length || days.some((d) => !inRange(d, 0, 6))) errors.days = 'Pick at least one day.';
  if (!inRange(f.startMinute, 0, 1439) || !inRange(f.endMinute, 1, 1440) || f.endMinute <= f.startMinute) errors.time = 'The end time must be after the start time.';
  if (!inRange(f.perUserPerWeek, 1, 7)) errors.perUserPerWeek = 'Pick 1 to 7 times a week.';
  return errors;
}

export function formToOfferBody(f) {
  return {
    title: f.title.trim(),
    description: (f.description || '').trim() || null,
    kind: f.kind,
    value: f.kind === 'freebie' ? null : Number(String(f.value).trim()),
    minGroup: f.minGroup,
    minLevel: f.minLevel,
    minShowUpRate: f.minShowUpRate,
    days: [...new Set(f.days)].sort((a, b) => a - b),
    startMinute: f.startMinute,
    endMinute: f.endMinute,
    perUserPerWeek: f.perUserPerWeek,
  };
}
