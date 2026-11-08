// Single source of truth, transcribed from 02_design_tokens.json.
// Never hard-code colours, radii or type sizes in screens — import from here.
import { Platform } from 'react-native';

export const colors = {
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
  white: '#FFFFFF',
  scrim: 'rgba(9,10,14,0.42)',
  glass: 'rgba(255,255,255,0.32)',
};

// Pastel accent rotation used by activity cards and category tiles.
export const accents = [
  { bg: colors.pink, fg: colors.ink },
  { bg: colors.orange, fg: colors.ink },
  { bg: colors.periwinkle, fg: colors.ink },
  { bg: colors.lavender, fg: colors.ink },
  { bg: colors.mint, fg: colors.ink },
];

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
      shadowColor: '#171F37',
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

export const theme = { colors, accents, fonts, type, space, radius, layout, shadow };
export default theme;
