'use strict';
// Partner perks: pure helpers (no database). Unit-tested in test/perks.test.js.
//
// Product rules:
//  - XP is status, never money. Perks are UNLOCKED by level; XP is never spent or deducted.
//  - A perk needs: level >= minLevel AND show-up rate >= minShowUpRate (the rate counts as 1.0
//    until the user has 3+ considered plans) AND inside the IST day/time window AND under the
//    weekly limit.
//  - Venue staff confirm a 6-character code; a confirmed redemption is one verified partner visit.
//
// Windows are IST: days 0=Sun..6=Sat, startMinute..endMinute minutes from IST midnight (end exclusive).
const crypto = require('crypto');
const { weekStart, istDate } = require('./quests');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const CODE_TTL_MS = 20 * 60000;
const QR_PREFIX = 'comeover:redeem:';
const IST_MS = 330 * 60000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOW_UP_GRACE_PLANS = 3; // below this many considered plans the rate counts as 1.0
const REASONS = ['level', 'show_up', 'weekly_limit', 'not_now'];
const LOCK_REASONS = ['level', 'show_up'];
const KIND_RANK = { percent: 0, flat: 1, freebie: 2 };

// Offer value limits by kind (whole numbers).
const VALUE_LIMITS = { percent: { min: 5, max: 50 }, flat: { min: 10, max: 5000 } };
const MAX_LIVE_OFFERS_PER_VENUE = 10;

// ---------------------------------------------------------------------------
// Codes
function generateCode(randomInt = crypto.randomInt) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// Staff input → canonical code: case-insensitive, spaces and dashes ignored, a scanned
// "comeover:redeem:<code>" QR payload accepted as well.
function normalizeCode(input) {
  let s = String(input == null ? '' : input)
    .replace(/\s+/g, '')
    .toUpperCase();
  const prefix = QR_PREFIX.toUpperCase();
  if (s.startsWith(prefix)) s = s.slice(prefix.length);
  return s.replace(/-/g, '');
}

const isCode = (s) => typeof s === 'string' && CODE_RE.test(s);
const qrPayload = (code) => `${QR_PREFIX}${code}`;

// ---------------------------------------------------------------------------
// IST calendar
function istClock(now = new Date()) {
  const t = new Date(new Date(now).getTime() + IST_MS);
  return { dow: t.getUTCDay(), minute: t.getUTCHours() * 60 + t.getUTCMinutes(), date: t.toISOString().slice(0, 10) };
}

// IST week key (Sunday start, "YYYY-MM-DD"); same weeks as quests and the progress week strip.
const weekKey = (now = new Date()) => weekStart(new Date(now));

// UTC instants of IST midnights.
const istMidnightOf = (isoDate) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - IST_MS);
const istDayStart = (now = new Date()) => istMidnightOf(istDate(new Date(now)));
const istWeekStart = (now = new Date()) => istMidnightOf(weekKey(now));
const istMonthStart = (now = new Date()) => istMidnightOf(`${istDate(new Date(now)).slice(0, 7)}-01`);

// "Sat 15 Nov, 7:30 pm" (IST) for notification copy.
function istWhen(date) {
  const t = new Date(new Date(date).getTime() + IST_MS);
  const c = clock(t.getUTCHours() * 60 + t.getUTCMinutes());
  return `${DAY_SHORT[t.getUTCDay()]} ${t.getUTCDate()} ${MONTH_SHORT[t.getUTCMonth()]}, ${c.mer ? `${c.text} ${c.mer}` : c.text}`;
}

// ---------------------------------------------------------------------------
// Labels
function formatInr(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

// "15% off" | "₹100 off" | the title for a freebie ("Free chai").
function offerLabel(o) {
  if (!o) return null;
  if (o.kind === 'percent') return `${o.value}% off`;
  if (o.kind === 'flat') return `${formatInr(o.value)} off`;
  return o.title;
}

function normDays(days) {
  const list = Array.isArray(days) && days.length ? days : ALL_DAYS;
  return [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

// minute (0..1440) → { text, mer } where mer is 'am'|'pm'|'' ('' for noon / midnight words).
function clock(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m === 720) return { text: 'noon', mer: '' };
  if (m === 0) return { text: 'midnight', mer: '' };
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: mm ? `${h12}:${String(mm).padStart(2, '0')}` : String(h12), mer: h24 < 12 ? 'am' : 'pm' };
}

const clockText = (c) => (c.mer ? `${c.text} ${c.mer}` : c.text);

// null when the offer runs all day.
function timeText(startMinute = 0, endMinute = 1440) {
  const s = Number.isFinite(startMinute) ? startMinute : 0;
  const e = Number.isFinite(endMinute) ? endMinute : 1440;
  if (s <= 0 && e >= 1440) return null;
  if (e >= 1440) return `from ${clockText(clock(s))}`;
  if (s <= 0) return `until ${clockText(clock(e))}`;
  const a = clock(s);
  const b = clock(e);
  // "4 to 7 pm" when both ends share am/pm, else "11 am to 2 pm".
  if (a.mer && a.mer === b.mer) return `${a.text} to ${b.text} ${b.mer}`;
  return `${clockText(a)} to ${clockText(b)}`;
}

// null when every day. "Weekdays" | "Weekends" | "Mondays" | "Mon to Thu" | "Mon and Wed" | "Fri to Sun".
function daysText(days) {
  const d = normDays(days);
  if (d.length === 7) return null;
  const key = d.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  if (d.length === 1) return DAY_PLURAL[d[0]];
  // Consecutive runs, wrapping round the week (Fri, Sat, Sun is one run).
  const set = new Set(d);
  const runs = d
    .filter((x) => !set.has((x + 6) % 7))
    .map((start) => {
      const run = [start];
      for (let n = (start + 1) % 7; set.has(n) && n !== start; n = (n + 1) % 7) run.push(n);
      return run;
    })
    .sort((x, y) => ((x[0] + 6) % 7) - ((y[0] + 6) % 7)); // Monday-first order
  const parts = [];
  for (const run of runs) {
    if (run.length >= 3) parts.push(`${DAY_SHORT[run[0]]} to ${DAY_SHORT[run[run.length - 1]]}`);
    else run.forEach((x) => parts.push(DAY_SHORT[x]));
  }
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Plain English, no em dashes: "Any time" | "Mon to Thu, 4 to 7 pm" | "Weekends, from 8 am" | "Every day, until 11 am".
function windowLabel(o = {}) {
  const dt = daysText(o.days);
  const tt = timeText(o.startMinute ?? 0, o.endMinute ?? 1440);
  if (!dt && !tt) return 'Any time';
  if (!dt) return `Every day, ${tt}`;
  if (!tt) return dt;
  return `${dt}, ${tt}`;
}

// ---------------------------------------------------------------------------
// Validity and eligibility
function isLive(o, now = new Date()) {
  if (!o || o.status !== 'active') return false;
  const t = new Date(now).getTime();
  if (o.validFrom && new Date(o.validFrom).getTime() > t) return false;
  if (o.validTo && new Date(o.validTo).getTime() < t) return false;
  return true;
}

function inWindow(o, now = new Date()) {
  const { dow, minute } = istClock(now);
  const s = o.startMinute ?? 0;
  const e = o.endMinute ?? 1440;
  return normDays(o.days).includes(dow) && minute >= s && minute < e;
}

const effectiveShowUp = (rate, plansConsidered) => ((plansConsidered || 0) < SHOW_UP_GRACE_PLANS ? 1 : rate == null ? 1 : Number(rate));

const nameOf = (levelNames, level) => {
  if (!levelNames) return null;
  const n = levelNames instanceof Map ? levelNames.get(level) : levelNames[level];
  return n || null;
};

// viewer = { level, showUpRate, plansConsidered }
// → { eligible, reasons, unlockLevel, unlockLevelName, usedThisWeek, activeRedemptionId }
function eligibility(o, viewer, { usedThisWeek = 0, activeRedemptionId = null, now = new Date(), levelNames = null } = {}) {
  const v = viewer || {};
  const reasons = [];
  const minLevel = o.minLevel ?? 1;
  const minRate = o.minShowUpRate ?? 0.8;
  if ((v.level || 1) < minLevel) reasons.push('level');
  if (effectiveShowUp(v.showUpRate, v.plansConsidered) + 1e-9 < minRate) reasons.push('show_up');
  if (usedThisWeek >= (o.perUserPerWeek ?? 1)) reasons.push('weekly_limit');
  if (!inWindow(o, now)) reasons.push('not_now');
  return { eligible: reasons.length === 0, reasons, unlockLevel: minLevel, unlockLevelName: nameOf(levelNames, minLevel), usedThisWeek, activeRedemptionId: activeRedemptionId || null };
}

// Unlocked = level and show-up satisfied (it may still be not_now / weekly_limit).
const isUnlocked = (el) => !!el && !el.reasons.some((r) => LOCK_REASONS.includes(r));

// Display order: unlocked first (when eligibility is known), then lowest level, percent > flat > freebie,
// bigger value, oldest first. offers[0] is the venue's "best" offer.
function rankOffers(offers) {
  const locked = (o) => (o.eligibility ? (isUnlocked(o.eligibility) ? 0 : 1) : 0);
  return [...offers].sort(
    (a, b) =>
      locked(a) - locked(b) ||
      (a.minLevel ?? 1) - (b.minLevel ?? 1) ||
      (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
      (b.value || 0) - (a.value || 0) ||
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0) ||
      String(a.id || a._id).localeCompare(String(b.id || b._id))
  );
}

// The next level above `level` that unlocks at least one offer (by level alone).
// levels: [{ level, name, xpThreshold }]. offers: raw or presented offers with minLevel.
function nextUnlock(offers, { level, xp = 0, levels = [] }) {
  const above = offers.filter((o) => (o.minLevel ?? 1) > level);
  if (!above.length) return null;
  const target = Math.min(...above.map((o) => o.minLevel));
  const row = levels.find((l) => l.level === target) || null;
  return {
    level: target,
    name: row ? row.name : null,
    xpNeeded: row && row.xpThreshold != null ? Math.max(0, row.xpThreshold - xp) : null,
    offers: above.filter((o) => o.minLevel === target).length,
  };
}

// Cross-field checks for a full (merged) offer → [{ path, code, ... }] like lib/validate.
function offerErrors(o) {
  const errors = [];
  const lim = VALUE_LIMITS[o.kind];
  if (lim) {
    if (o.value == null) errors.push({ path: 'value', code: 'required' });
    else if (!Number.isInteger(o.value)) errors.push({ path: 'value', code: 'type', expected: 'integer' });
    else if (o.value < lim.min) errors.push({ path: 'value', code: 'too_small', min: lim.min });
    else if (o.value > lim.max) errors.push({ path: 'value', code: 'too_large', max: lim.max });
  }
  const s = o.startMinute ?? 0;
  const e = o.endMinute ?? 1440;
  if (e <= s) errors.push({ path: 'endMinute', code: 'must_be_after_start' });
  if (!normDays(o.days).length || (Array.isArray(o.days) && !o.days.length)) errors.push({ path: 'days', code: 'too_few', min: 1 });
  if (o.validFrom && o.validTo && new Date(o.validTo) <= new Date(o.validFrom)) errors.push({ path: 'validTo', code: 'must_be_after_valid_from' });
  return errors;
}

const clampGroup = (n) => Math.max(1, Math.min(20, Math.round(Number(n) || 1)));

// First word of a display name ("Asha Patel" → "Asha"); never a phone number.
function firstName(displayName) {
  const s = String(displayName || '').trim();
  return s ? s.split(/\s+/)[0] : null;
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  QR_PREFIX,
  ALL_DAYS,
  REASONS,
  LOCK_REASONS,
  VALUE_LIMITS,
  MAX_LIVE_OFFERS_PER_VENUE,
  SHOW_UP_GRACE_PLANS,
  generateCode,
  normalizeCode,
  isCode,
  qrPayload,
  istClock,
  weekKey,
  istDayStart,
  istWeekStart,
  istMonthStart,
  istWhen,
  formatInr,
  offerLabel,
  normDays,
  timeText,
  daysText,
  windowLabel,
  isLive,
  inWindow,
  effectiveShowUp,
  eligibility,
  isUnlocked,
  rankOffers,
  nextUnlock,
  offerErrors,
  clampGroup,
  firstName,
};
