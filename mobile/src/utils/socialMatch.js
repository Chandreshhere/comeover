// Social energy matching (introvert / ambivert / extrovert).
//
// People tend to click when their social energy is close: two introverts
// enjoy the same calm pace, two extroverts the same buzz, and ambiverts sit
// comfortably with both. Opposite ends can work, so they are never hidden,
// just ranked lower. Plans are matched on group size and how lively the
// activity usually is.

export const SOCIAL_STYLES = ['introvert', 'ambivert', 'extrovert'];

const PAIR = {
  introvert: { introvert: 1, ambivert: 0.8, extrovert: 0.45 },
  ambivert: { introvert: 0.8, ambivert: 1, extrovert: 0.8 },
  extrovert: { introvert: 0.45, ambivert: 0.8, extrovert: 1 },
};

// 0..1, or null when either side hasn't picked a style.
export function styleCompat(mine, theirs) {
  if (!PAIR[mine] || !PAIR[theirs]) return null;
  return PAIR[mine][theirs];
}

export function matchLabel(mine, theirs) {
  const c = styleCompat(mine, theirs);
  if (c == null) return null;
  if (c >= 1) return 'Great match';
  if (c >= 0.8) return 'Good match';
  return null; // never label someone a "bad" match
}

// Calm vs lively activity categories (server taxonomy slugs and pictogram keys).
const CALM = new Set(['chai', 'coffee', 'cafe', 'book', 'books', 'reading', 'walk', 'board', 'boardgames', 'art', 'study', 'cowork', 'laptop', 'film', 'movies', 'yoga', 'pet', 'dog', 'plant', 'photo', 'camera', 'thrifting', 'thrift', 'smoke']);
const LIVELY = new Set(['music', 'gig', 'party', 'game', 'gaming', 'football', 'cricket', 'basketball', 'badminton', 'gym', 'run', 'running', 'dance', 'food', 'karaoke', 'mic']);

// How well a plan suits a social style: 0..1 (0.6 = neutral).
export function planCompat(style, activity) {
  if (!PAIR[style] || !activity) return 0.6;
  const cap = activity.capacity || activity.maxParticipants || 4;
  const key = activity.category || activity.pictogram;
  const calm = CALM.has(key) || CALM.has(activity.pictogram);
  const lively = LIVELY.has(key) || LIVELY.has(activity.pictogram);
  let s = 0.6;
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

// Stable sort: better matches first, original order otherwise.
export function rankPeople(people, myStyle) {
  if (!PAIR[myStyle]) return people;
  return people
    .map((p, i) => ({ p, i, c: styleCompat(myStyle, p.socialStyle) ?? 0.6 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((x) => x.p);
}

export const STYLE_META = {
  introvert: { label: 'Introvert', emoji: '🌙', blurb: 'Small groups, calm places, real conversations.' },
  ambivert: { label: 'Ambivert', emoji: '🌗', blurb: 'Depends on the day. A bit of both.' },
  extrovert: { label: 'Extrovert', emoji: '☀️', blurb: 'The more the merrier. Energy from people.' },
};
