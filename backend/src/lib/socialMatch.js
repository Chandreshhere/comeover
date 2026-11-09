'use strict';
// Social energy matching (introvert / ambivert / extrovert).
// Server port of mobile/src/utils/socialMatch.js — keep the two in step.
//
// People tend to click when their social energy is close: two introverts enjoy
// the same calm pace, two extroverts the same buzz, and ambiverts sit comfortably
// with both. Opposite ends can work, so nobody is ever hidden — only ranked lower.
// Plans are matched on group size and how lively the activity usually is.

const SOCIAL_STYLES = ['introvert', 'ambivert', 'extrovert'];
const NEUTRAL = 0.6; // either side has no style yet

const PAIR = {
  introvert: { introvert: 1, ambivert: 0.8, extrovert: 0.45 },
  ambivert: { introvert: 0.8, ambivert: 1, extrovert: 0.8 },
  extrovert: { introvert: 0.45, ambivert: 0.8, extrovert: 1 },
};

const isStyle = (s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(PAIR, s);

// 0..1, or null when either side hasn't picked a style.
function styleCompat(mine, theirs) {
  if (!isStyle(mine) || !isStyle(theirs)) return null;
  return PAIR[mine][theirs];
}

// Calm vs lively activity categories (taxonomy slugs and pictogram keys).
const CALM = new Set(['chai', 'coffee', 'cafe', 'book', 'books', 'reading', 'walk', 'board', 'boardgames', 'art', 'study', 'cowork', 'laptop', 'film', 'movies', 'yoga', 'pet', 'dog', 'plant', 'photo', 'camera', 'thrifting', 'thrift', 'smoke']);
const LIVELY = new Set(['music', 'gig', 'party', 'game', 'gaming', 'football', 'cricket', 'basketball', 'badminton', 'gym', 'run', 'running', 'dance', 'food', 'karaoke', 'mic']);

// How well a plan suits a social style: 0..1 (0.6 = neutral).
// activity: { capacity, category, pictogram } (a presented Activity or a lean doc).
function planCompat(style, activity) {
  if (!isStyle(style) || !activity) return NEUTRAL;
  const cap = activity.capacity || activity.maxParticipants || 4;
  const key = activity.category || activity.pictogram;
  const calm = CALM.has(key) || CALM.has(activity.pictogram);
  const lively = LIVELY.has(key) || LIVELY.has(activity.pictogram);
  let s = NEUTRAL;
  if (style === 'introvert') {
    if (cap <= 4) s += 0.25;
    else if (cap >= 8) s -= 0.2;
    if (calm) s += 0.15;
    if (lively) s -= 0.1;
  } else if (style === 'extrovert') {
    if (cap >= 5) s += 0.25;
    else if (cap <= 2) s -= 0.15;
    if (lively) s += 0.15;
  } else {
    if (cap >= 3 && cap <= 6) s += 0.15;
    if (calm || lively) s += 0.05;
  }
  return Math.max(0, Math.min(1, s));
}

// Stable sort: better matches first, original order otherwise. Nobody is dropped.
// styleOf(person) returns that person's style (default: person.socialStyle).
function rankPeople(people, myStyle, styleOf = (p) => p && p.socialStyle) {
  if (!isStyle(myStyle)) return people.slice();
  return people
    .map((p, i) => ({ p, i, c: styleCompat(myStyle, styleOf(p)) ?? NEUTRAL }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((x) => x.p);
}

// Gentle re-rank of an already ordered plan list: the incoming order stays the
// main signal. A plan only overtakes its neighbour when it suits the style clearly
// better (compat gap > 1/weight ≈ 0.33), so nothing moves more than ~2 places and
// nothing is dropped. Ambiverts' range is narrow, so their order barely changes.
const PLAN_WEIGHT = 3;
const sortKey = (i, c, weight) => Math.round((i - (c - NEUTRAL) * weight) * 1e9) / 1e9; // rounded: float noise must not break ties
function rankPlans(plans, style, weight = PLAN_WEIGHT) {
  if (!isStyle(style) || plans.length < 2) return plans.slice();
  return plans
    .map((a, i) => ({ a, i, k: sortKey(i, planCompat(style, a), weight) }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map((x) => x.a);
}

module.exports = { SOCIAL_STYLES, NEUTRAL, PAIR, isStyle, styleCompat, planCompat, rankPeople, rankPlans, CALM, LIVELY };
