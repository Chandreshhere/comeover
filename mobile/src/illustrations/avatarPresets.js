// Personality avatars ("vibes") built on DiceBear's Avataaars style (design by
// Pablo Stanley, free for personal and commercial use). Each vibe is a curated
// set of looks so every pick is pleasant; people choose a vibe, a skin tone and
// a hair colour, and "Shuffle" steps through the vibe's looks.
//
// The choice is stored in profile.avatarSeed (server max 40 chars) as
//   v1.<vibe>.<skinIdx>.<hairIdx>.<look>      e.g. "v1.nerd.2.0.1"
// Any other seed (a user id, 'me-irl', an old random seed) maps to a stable
// preset through a hash, so people who never picked still get a nice avatar.
//
// Pure data + functions: no React Native imports, safe to use anywhere. Indexes
// into SKIN_TONES / HAIR_COLORS are part of the stored format, so only ever
// append to those lists. Vibes are stored by id, so their order can change.

// Realistic tones light → deep, then two playful cartoon tones.
export const SKIN_TONES = [
  { hex: 'ffdbb4', label: 'Light' },
  { hex: 'edb98a', label: 'Light medium' },
  { hex: 'd08b5b', label: 'Medium' },
  { hex: 'ae5d29', label: 'Medium deep' },
  { hex: '614335', label: 'Deep' },
  { hex: 'f8d25c', label: 'Sunny yellow' },
  { hex: 'fd9841', label: 'Tangerine' },
];

export const HAIR_COLORS = [
  { hex: '2c1b18', label: 'Black' },
  { hex: '4a312c', label: 'Dark brown' },
  { hex: '724133', label: 'Brown' },
  { hex: 'a55728', label: 'Auburn' },
  { hex: 'b58143', label: 'Caramel' },
  { hex: 'd6b370', label: 'Blonde' },
  { hex: 'ecdcbf', label: 'Platinum' },
  { hex: 'e8e1e1', label: 'Silver' },
  { hex: 'c93305', label: 'Red' },
  { hex: 'f59797', label: 'Pink' },
];

export const DEFAULT_SKIN = 2; // warm medium tone
export const DEFAULT_HAIR = 0;

// Headwear that hides the hair (hair colour then only tints a beard, if any).
const COVERS_HAIR = ['hat', 'hijab', 'turban', 'winterHat1', 'winterHat02', 'winterHat03', 'winterHat04'];

// Look shorthand: top (hair or headwear), clothing, clothes colour, extras.
//   hat: headwear colour · acc: glasses · beard · eyes · brows · mouth · graphic
const look = (top, clothing, clothesColor, extra = {}) => ({ top, clothing, clothesColor, ...extra });

// `bg` names a theme token (read at render time so dark mode follows).
export const VIBES = [
  {
    id: 'nerd',
    label: 'Nerd',
    blurb: 'Glasses on, fun facts ready',
    bg: 'lavender',
    looks: [
      look('shortFlat', 'collarAndSweater', '5199e4', { acc: 'prescription02', brows: 'raisedExcitedNatural', mouth: 'smile' }),
      look('bob', 'collarAndSweater', 'ff5c5c', { acc: 'round', eyes: 'happy' }),
      look('theCaesarAndSidePart', 'blazerAndSweater', '25557c', { acc: 'prescription01', mouth: 'twinkle' }),
      look('bun', 'collarAndSweater', 'a7ffc4', { acc: 'prescription02', eyes: 'surprised', brows: 'raisedExcitedNatural', mouth: 'smile' }),
      look('hijab', 'collarAndSweater', 'ffffb1', { hat: '5199e4', acc: 'round', eyes: 'happy', mouth: 'smile' }),
      look('shortCurly', 'collarAndSweater', 'b1e2ff', { acc: 'round', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'cool',
    label: 'Cool',
    blurb: 'Shades on, zero stress',
    bg: 'periwinkleSoft',
    looks: [
      look('shavedSides', 'hoodie', '262e33', { acc: 'sunglasses' }),
      look('hat', 'graphicShirt', '3c4f5c', { hat: '262e33', acc: 'wayfarers', graphic: 'diamond', mouth: 'twinkle' }),
      look('dreads01', 'hoodie', '5199e4', { acc: 'sunglasses', mouth: 'smile' }),
      look('straightAndStrand', 'hoodie', '3c4f5c', { acc: 'wayfarers' }),
      look('turban', 'hoodie', '25557c', { hat: '262e33', acc: 'sunglasses', beard: 'beardMedium', mouth: 'twinkle' }),
      look('shortWaved', 'graphicShirt', '929598', { acc: 'wayfarers', graphic: 'bear', eyes: 'wink', mouth: 'smile' }),
    ],
  },
  {
    id: 'glam',
    label: 'Glam',
    blurb: 'Main character energy',
    bg: 'pinkSoft',
    looks: [
      look('longButNotTooLong', 'blazerAndShirt', 'ff488e', { eyes: 'wink', brows: 'raisedExcitedNatural', mouth: 'twinkle' }),
      look('curvy', 'shirtScoopNeck', 'ff5c5c', { brows: 'raisedExcitedNatural', mouth: 'smile' }),
      look('bob', 'blazerAndSweater', '262e33', { acc: 'kurt', accColor: 'ffffff', mouth: 'twinkle' }),
      look('shortWaved', 'blazerAndShirt', '262e33', { beard: 'beardLight', eyes: 'wink', mouth: 'twinkle' }),
      look('miaWallace', 'shirtVNeck', 'ff488e', { mouth: 'twinkle' }),
      look('hijab', 'blazerAndShirt', '262e33', { hat: 'ff488e', eyes: 'wink', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'sporty',
    label: 'Sporty',
    blurb: 'Up early, game on',
    bg: 'mint',
    looks: [
      look('froBand', 'shirtCrewNeck', 'ff5c5c', { eyes: 'happy', brows: 'raisedExcitedNatural', mouth: 'smile' }),
      look('shortRound', 'shirtCrewNeck', '65c9ff', { brows: 'raisedExcited', mouth: 'smile' }),
      look('bun', 'shirtScoopNeck', 'a7ffc4', { eyes: 'happy', mouth: 'smile' }),
      look('theCaesar', 'shirtVNeck', '25557c', { beard: 'beardLight', eyes: 'happy' }),
      look('hijab', 'shirtCrewNeck', '5199e4', { hat: '262e33', eyes: 'happy', mouth: 'smile' }),
    ],
  },
  {
    id: 'artsy',
    label: 'Artsy',
    blurb: 'Sketchbook always packed',
    bg: 'orangeSoft',
    looks: [
      look('bun', 'overall', 'ffafb9', { eyes: 'happy', mouth: 'smile' }),
      look('curly', 'overall', '65c9ff', { eyes: 'side', mouth: 'twinkle' }),
      look('frida', 'shirtScoopNeck', 'ffffb1', { mouth: 'smile' }),
      look('shaggyMullet', 'overall', 'a7ffc4', { acc: 'round', accColor: 'ff488e', mouth: 'smile' }),
      look('dreads02', 'graphicShirt', 'ff488e', { graphic: 'cumbia', eyes: 'happy', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'chill',
    label: 'Chill',
    blurb: 'Slow mornings, long chats',
    bg: 'mint',
    looks: [
      look('shaggy', 'hoodie', '929598', { eyes: 'side', mouth: 'twinkle' }),
      look('winterHat1', 'hoodie', 'e6e6e6', { hat: '5199e4', eyes: 'happy', mouth: 'smile' }),
      look('winterHat02', 'hoodie', '3c4f5c', { hat: 'ff5c5c', mouth: 'twinkle' }),
      look('straight02', 'hoodie', 'b1e2ff', { eyes: 'happy' }),
      look('dreads', 'hoodie', 'a7ffc4', { eyes: 'side', mouth: 'twinkle' }),
      look('turban', 'hoodie', 'b1e2ff', { hat: '3c4f5c', beard: 'beardLight', eyes: 'happy', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'gamer',
    label: 'Gamer',
    blurb: 'One more round?',
    bg: 'lavender',
    looks: [
      look('shortCurly', 'hoodie', '262e33', { acc: 'round', eyes: 'happy', mouth: 'smile' }),
      look('shaggyMullet', 'hoodie', 'ff488e', { eyes: 'surprised', brows: 'raisedExcited', mouth: 'smile' }),
      look('straight01', 'hoodie', '65c9ff', { acc: 'prescription01', eyes: 'happy' }),
      look('winterHat04', 'hoodie', '25557c', { hat: '262e33', eyes: 'wink', mouth: 'tongue' }),
      look('fro', 'graphicShirt', '5199e4', { graphic: 'bat', acc: 'round', eyes: 'happy', mouth: 'smile' }),
    ],
  },
  {
    id: 'bookworm',
    label: 'Bookworm',
    blurb: 'Cafe corner, good book',
    bg: 'periwinkleWash',
    looks: [
      look('straight01', 'blazerAndSweater', '929598', { acc: 'prescription01', mouth: 'twinkle' }),
      look('shortRound', 'collarAndSweater', '25557c', { acc: 'round', eyes: 'happy' }),
      look('bun', 'collarAndSweater', 'ffafb9', { acc: 'prescription02', mouth: 'twinkle' }),
      look('theCaesarAndSidePart', 'blazerAndSweater', '3c4f5c', { acc: 'round', beard: 'beardMedium', mouth: 'twinkle' }),
      look('hijab', 'collarAndSweater', 'e6e6e6', { hat: '25557c', acc: 'prescription01', eyes: 'happy', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'foodie',
    label: 'Foodie',
    blurb: 'Will travel for momos',
    bg: 'orangeSoft',
    looks: [
      look('shortFlat', 'graphicShirt', 'ff5c5c', { graphic: 'pizza', eyes: 'happy', mouth: 'tongue' }),
      look('curvy', 'graphicShirt', 'ffafb9', { graphic: 'pizza', eyes: 'happy', mouth: 'smile' }),
      look('fro', 'shirtCrewNeck', 'ffffb1', { eyes: 'hearts', mouth: 'smile' }),
      look('turban', 'graphicShirt', '65c9ff', { hat: 'ff5c5c', graphic: 'pizza', beard: 'beardLight', eyes: 'happy', mouth: 'smile' }),
      look('bob', 'shirtScoopNeck', 'a7ffc4', { eyes: 'hearts', mouth: 'tongue' }),
    ],
  },
  {
    id: 'explorer',
    label: 'Explorer',
    blurb: 'New lanes, new places',
    bg: 'periwinkleSoft',
    looks: [
      look('hat', 'shirtCrewNeck', '3c4f5c', { hat: '25557c', mouth: 'smile' }),
      look('winterHat03', 'shirtVNeck', '3c4f5c', { hat: 'a7ffc4', eyes: 'happy', mouth: 'smile' }),
      look('turban', 'shirtCrewNeck', '929598', { hat: '5199e4', acc: 'wayfarers', mouth: 'smile' }),
      look('longButNotTooLong', 'shirtVNeck', '65c9ff', { acc: 'wayfarers', mouth: 'smile' }),
      look('shortWaved', 'shirtCrewNeck', '25557c', { beard: 'beardMedium', eyes: 'happy', mouth: 'smile' }),
    ],
  },
  {
    id: 'boss',
    label: 'Boss',
    blurb: 'Big plans, bigger heart',
    bg: 'periwinkleWash',
    looks: [
      look('theCaesarAndSidePart', 'blazerAndShirt', '262e33', { beard: 'beardLight', mouth: 'smile' }),
      look('straightAndStrand', 'blazerAndShirt', '25557c', { mouth: 'twinkle' }),
      look('sides', 'blazerAndSweater', '3c4f5c', { beard: 'beardMajestic', eyes: 'happy', mouth: 'smile' }),
      look('bob', 'blazerAndShirt', 'ff5c5c', { acc: 'wayfarers', mouth: 'twinkle' }),
      look('turban', 'blazerAndShirt', '262e33', { hat: '25557c', beard: 'beardMedium', mouth: 'smile' }),
      look('hijab', 'blazerAndShirt', '929598', { hat: '262e33', mouth: 'twinkle' }),
    ],
  },
  {
    id: 'softie',
    label: 'Softie',
    blurb: 'Warm hugs, kind words',
    bg: 'pinkSoft',
    looks: [
      look('curly', 'shirtScoopNeck', 'ffafb9', { eyes: 'hearts', mouth: 'smile' }),
      look('shortWaved', 'shirtVNeck', 'ff488e', { eyes: 'hearts', mouth: 'twinkle' }),
      look('longButNotTooLong', 'overall', 'b1e2ff', { eyes: 'happy', mouth: 'smile' }),
      look('frizzle', 'shirtCrewNeck', 'ffffb1', { eyes: 'hearts', mouth: 'smile' }),
      look('hijab', 'shirtScoopNeck', 'b1e2ff', { hat: 'ffafb9', eyes: 'happy', mouth: 'smile' }),
    ],
  },
];

const VIBE_BY_ID = VIBES.reduce((acc, v) => {
  acc[v.id] = v;
  return acc;
}, {});

export const vibeById = (id) => VIBE_BY_ID[id] || VIBES[0];

// FNV-1a: stable across devices and app versions.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Legacy seeds lean towards warm tones and darker hair (most people here),
// with the full realistic range still in the mix.
const LEGACY_SKIN = [2, 3, 2, 1, 3, 4, 0, 2];
const LEGACY_HAIR = [0, 0, 1, 1, 2, 0, 3, 4];

const ENCODED = /^v1\.([a-z]+)\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/;

export const isEncodedAvatar = (seed) => typeof seed === 'string' && ENCODED.test(seed) && !!VIBE_BY_ID[ENCODED.exec(seed)[1]];

const wrap = (n, len) => ((Number(n) % len) + len) % len;

// → { vibe, skin, hair, variant } with every index in range.
export function avatarParts(seed) {
  const s = seed == null || seed === '' ? 'irl' : String(seed);
  const m = ENCODED.exec(s);
  if (m && VIBE_BY_ID[m[1]]) {
    const vibe = VIBE_BY_ID[m[1]];
    return {
      vibe: vibe.id,
      skin: wrap(m[2], SKIN_TONES.length),
      hair: wrap(m[3], HAIR_COLORS.length),
      variant: wrap(m[4], vibe.looks.length),
      legacy: false,
    };
  }
  const h = hash(s);
  const vibe = VIBES[h % VIBES.length];
  return {
    vibe: vibe.id,
    skin: LEGACY_SKIN[(h >>> 5) % LEGACY_SKIN.length],
    hair: LEGACY_HAIR[(h >>> 9) % LEGACY_HAIR.length],
    variant: (h >>> 13) % vibe.looks.length,
    legacy: true,
  };
}

export function encodeAvatar({ vibe, skin = DEFAULT_SKIN, hair = DEFAULT_HAIR, variant = 0 } = {}) {
  const v = vibeById(vibe);
  return `v1.${v.id}.${wrap(skin, SKIN_TONES.length)}.${wrap(hair, HAIR_COLORS.length)}.${wrap(variant, v.looks.length)}`;
}

// Any seed → its encoded form (legacy seeds become the preset they render as).
export const normalizeAvatar = (seed) => encodeAvatar(avatarParts(seed));

// The next look of the same vibe, keeping skin and hair.
export function shuffleAvatar(seed) {
  const p = avatarParts(seed);
  return encodeAvatar({ ...p, variant: p.variant + 1 });
}

// A fresh pick for someone who hasn't chosen yet: a vibe from their seed,
// shown in the default warm tone.
export function starterAvatar(seed) {
  const p = avatarParts(seed);
  return p.legacy ? encodeAvatar({ vibe: p.vibe, skin: DEFAULT_SKIN, hair: DEFAULT_HAIR, variant: p.variant }) : encodeAvatar(p);
}

export const lookOf = (parts) => {
  const v = vibeById(parts.vibe);
  return v.looks[wrap(parts.variant, v.looks.length)];
};

// True when the look's headwear hides the hair and there is no beard to tint.
export const hairHidden = (parts) => {
  const l = lookOf(parts);
  return COVERS_HAIR.includes(l.top) && !l.beard;
};

// DiceBear Avataaars options for parts (every choice pinned, so rendering is
// fully determined by the parts). Transparent background: the circle behind
// it comes from the theme. `clip: false` skips an SVG mask (cheaper to draw).
export function dicebearOptions(parts, overrides) {
  const l = lookOf(parts);
  const skin = SKIN_TONES[wrap(parts.skin, SKIN_TONES.length)].hex;
  const hair = HAIR_COLORS[wrap(parts.hair, HAIR_COLORS.length)].hex;
  return {
    seed: encodeAvatar(parts),
    clip: false,
    backgroundColor: [],
    style: ['default'],
    top: [l.top],
    topProbability: 100,
    hairColor: [hair],
    hatColor: [l.hat || '262e33'],
    skinColor: [skin],
    clothing: [l.clothing],
    clothesColor: [l.clothesColor],
    clothingGraphic: [l.graphic || 'bear'],
    accessories: [l.acc || 'round'],
    accessoriesProbability: l.acc ? 100 : 0,
    accessoriesColor: [l.accColor || '262e33'],
    facialHair: [l.beard || 'beardLight'],
    facialHairProbability: l.beard ? 100 : 0,
    facialHairColor: [hair],
    eyes: [l.eyes || 'default'],
    eyebrows: [l.brows || 'defaultNatural'],
    mouth: [l.mouth || 'default'],
    nose: ['default'],
    ...overrides,
  };
}

// seed → everything needed to draw it: parts, the vibe, its background token
// and the DiceBear options.
export function decodeAvatar(seed) {
  const parts = avatarParts(seed);
  const vibe = vibeById(parts.vibe);
  return { ...parts, vibeMeta: vibe, bg: vibe.bg, options: dicebearOptions(parts) };
}
