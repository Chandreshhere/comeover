// Single source of truth, transcribed from 02_design_tokens.json, plus a dark
// palette. Never hard-code colours, radii or type sizes in screens — import
// from here.
//
// Dark mode: `colors` and `accents` are live objects. `applyScheme()` swaps
// their values in place and ThemeProvider remounts the tree, so every style
// that reads `colors.x` at render time picks up the new palette. Never copy a
// colour into a module-level constant — read it inside the component (or wrap
// the table in a function) so it follows the scheme.
import { Platform } from 'react-native';

const light = {
  periwinkle: '#9CB9FF',
  periwinkleSoft: '#C8D7FF',
  periwinkleWash: '#E3EAFF',
  deep: '#526FC3',
  ink: '#090A0E',
  inkSoft: '#30323A',
  muted: '#767985',
  canvas: '#F2F3F8',
  showcase: '#D9DCE5',
  surface: '#FFFFFF',
  surfaceSubtle: '#F7F7FA',
  border: '#E7E8EF',
  track: '#E8EAF2',
  pink: '#E6A2F2',
  pinkSoft: '#F6DDFA',
  orange: '#F0A34B',
  orangeSoft: '#FCE5C8',
  lavender: '#E5E3FA',
  mint: '#BFE8D6',
  success: '#2F9E75',
  warning: '#D99525',
  danger: '#D94F62',
  info: '#5578D8',
  // "white" is the colour that sits on an ink fill (text on a primary button,
  // check marks on a dark chip). It flips with the scheme. Use `pureWhite` for
  // something that must stay white in both schemes (text on a photo or map).
  white: '#FFFFFF',
  pureWhite: '#FFFFFF',
  pureBlack: '#000000',
  scrim: 'rgba(9,10,14,0.42)',
  glass: 'rgba(255,255,255,0.32)',
};

// Dark mode is true black with neutral greys (no blue tint); accents stay
// as deep, readable versions of the pastels.
const dark = {
  periwinkle: '#1C1C1E', // hero cards: lifted grey on black, not blue
  periwinkleSoft: '#2C2C2E',
  periwinkleWash: '#242428',
  deep: '#A9BEFF',
  ink: '#F2F2F4',
  inkSoft: '#C8C8CE',
  muted: '#8E8E96',
  canvas: '#000000', // pages are true black
  showcase: '#1C1C1E',
  surface: '#1C1C1E', // cards: one clear step up from black
  surfaceSubtle: '#2C2C2E', // inputs, chips, nested fills
  border: '#3A3A3C',
  track: '#3A3A3C',
  pink: '#5A3462',
  pinkSoft: '#2A1E2D',
  orange: '#7A4E1A',
  orangeSoft: '#2C2116',
  lavender: '#2E2C45',
  mint: '#1D4A3B',
  success: '#4CC495',
  warning: '#E9B44E',
  danger: '#F2697C',
  info: '#86A3F5',
  white: '#000000',
  pureWhite: '#FFFFFF',
  pureBlack: '#000000',
  scrim: 'rgba(0,0,0,0.7)',
  glass: 'rgba(255,255,255,0.1)',
};

export const palettes = { light, dark };

let scheme = 'light';
export const colors = { ...light };

// Pastel accent rotation used by activity cards and category tiles.
const buildAccents = () => [
  { bg: colors.pink, fg: colors.ink },
  { bg: colors.orange, fg: colors.ink },
  { bg: colors.periwinkle, fg: colors.ink },
  { bg: colors.lavender, fg: colors.ink },
  { bg: colors.mint, fg: colors.ink },
];
export const accents = buildAccents();

export function applyScheme(next) {
  scheme = next === 'dark' ? 'dark' : 'light';
  Object.assign(colors, palettes[scheme]);
  accents.splice(0, accents.length, ...buildAccents());
  return scheme;
}
export const getScheme = () => scheme;
export const isDark = () => scheme === 'dark';

// Translucent white "glass" over a brand surface. Light: frosted white at the
// given strength. Dark: a much fainter lift so it never glows.
export const glass = (a = 0.38) => (scheme === 'dark' ? `rgba(255,255,255,${Math.min(0.16, Math.max(0.05, a * 0.22)).toFixed(3)})` : `rgba(255,255,255,${a})`);
// Ink at an alpha (hairlines, soft fills, pressed states). Follows the scheme.
export const inkAlpha = (a = 0.1) => (scheme === 'dark' ? `rgba(242,242,244,${a})` : `rgba(9,10,14,${a})`);
// The on-ink colour (`colors.white`) at an alpha: secondary text on an ink fill.
export const onInkAlpha = (a = 0.6) => (scheme === 'dark' ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);

// Poppins (OFL) ships as static TTFs in src/assets/fonts and is linked with
// `npm run link-assets`. File name == PostScript name, so the same family
// string works on iOS and Android.
export const fonts = {
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  semibold: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
};

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  h3: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  button: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
};

// 8-point grid.
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

export const radius = {
  sm: 12,
  quest: 18,
  card: 24,
  hero: 28,
  sheet: 28,
  device: 40,
  pill: 999,
};

export const layout = {
  screenPadding: 20,
  buttonHeight: 52,
  chipHeight: 36,
  iconButton: 44,
  cardGap: 12,
  sectionGap: 24,
  bottomNavHeight: 76,
  minTouch: 44,
};

const shadowFactory = (y, blur, opacity, elevation) =>
  Platform.select({
    ios: {
      shadowColor: '#0B1022',
      shadowOffset: { width: 0, height: y },
      shadowOpacity: opacity,
      shadowRadius: blur / 2,
    },
    android: { elevation },
    default: { boxShadow: `0px ${y}px ${blur}px rgba(23,31,55,${opacity})` },
  });

export const shadow = {
  card: shadowFactory(8, 24, 0.07, 3),
  floating: shadowFactory(12, 32, 0.12, 8),
  none: {},
};

export const theme = { colors, accents, fonts, type, space, radius, layout, shadow, glass, inkAlpha, onInkAlpha };
export default theme;
