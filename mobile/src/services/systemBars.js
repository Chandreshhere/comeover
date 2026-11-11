// Android only: colour the system navigation bar to match the screen, the way
// iOS draws the app under the home indicator. No-op on iOS.
//
//   useNavigationBar(bg)          in a screen: applied whenever it gains focus
//   setNavigationBarOverride(c)   temporary colour on top (the splash panels);
//   setNavigationBarOverride(null) hands control back to the focused screen
import { useContext, useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

const native = Platform.OS === 'android' ? NativeModules.ComeOverSystemBars : null;

let screenColor = null;
let overrideColor = null;
let applied = null;

// '#RGB' | '#RRGGBB' | 'rgb(...)' | 'rgba(...)' -> '#RRGGBB' / '#AARRGGBB', else null.
export function toAndroidHex(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return `#${m[1].split('').map((x) => x + x).join('')}`.toUpperCase();
  if (/^#([0-9a-f]{6})$/i.test(s)) return s.toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (!m) return null;
  const hex = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
  const rgb = `${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  return (m[4] != null && Number(m[4]) < 1 ? `#${hex(Number(m[4]) * 255)}${rgb}` : `#${rgb}`).toUpperCase();
}

// Perceived brightness of '#RRGGBB' / '#AARRGGBB' (alpha ignored), 0..1.
export function isLightColor(hex) {
  const h = hex.length === 9 ? hex.slice(3) : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55;
}

function apply() {
  const hex = overrideColor || screenColor;
  if (!native || !native.setNavigationBar || !hex || hex === applied) return;
  applied = hex;
  try {
    native.setNavigationBar(hex, isLightColor(hex));
  } catch (e) {
    applied = null; // try again next time
  }
}

export function setNavigationBar(color) {
  const hex = toAndroidHex(color);
  if (!hex) return;
  screenColor = hex;
  apply();
}

export function setNavigationBarOverride(color) {
  overrideColor = color ? toAndroidHex(color) : null;
  apply();
}

// Applies `color` while the calling screen is focused (works outside a
// navigator too, e.g. the not-configured screen).
export function useNavigationBar(color) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!native) return undefined;
    if (!navigation) {
      setNavigationBar(color);
      return undefined;
    }
    if (!navigation.isFocused || navigation.isFocused()) setNavigationBar(color);
    return navigation.addListener ? navigation.addListener('focus', () => setNavigationBar(color)) : undefined;
  }, [navigation, color]);
}
