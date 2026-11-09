// Light / dark / system appearance.
//
// `colors` in tokens.js is a live object: applyScheme() swaps its values in
// place, then this provider bumps a key so the whole tree remounts and every
// inline style re-reads `colors.x`. Navigation state is captured before the
// remount and restored after, so switching theme keeps you on the same screen.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { applyScheme, getScheme } from './tokens';

const ThemeContext = createContext({ scheme: 'light', isDark: false, preference: 'system' });

export const useTheme = () => useContext(ThemeContext);

export const resolveScheme = (preference, system) => (preference === 'light' || preference === 'dark' ? preference : system === 'dark' ? 'dark' : 'light');

// Light (pastel) is the default look; dark mode is opt-in from Settings.
applyScheme('light');

export default function ThemeProvider({ preference = 'light', getNavState, children }) {
  const system = useColorScheme();
  const scheme = resolveScheme(preference, system);
  const [generation, setGeneration] = useState(0);
  const navState = useRef(undefined);

  // Swap the palette synchronously during render so this pass already paints
  // with the right colours, then remount below.
  if (getScheme() !== scheme) {
    navState.current = getNavState?.();
    applyScheme(scheme);
  }
  const key = `${scheme}-${generation}`;

  // Native chrome (alerts, pickers, keyboard, maps) follows the in-app choice.
  useEffect(() => {
    try {
      Appearance.setColorScheme?.(preference === 'system' ? null : preference);
    } catch (e) {
      // older runtimes: native chrome keeps following the system setting
    }
  }, [preference]);

  const value = useMemo(
    () => ({
      scheme,
      isDark: scheme === 'dark',
      preference,
      // Lets the navigator restore where the user was after a theme remount.
      takeNavState: () => {
        const s = navState.current;
        navState.current = undefined;
        return s;
      },
      refresh: () => setGeneration((g) => g + 1),
    }),
    [scheme, preference]
  );

  return (
    <ThemeContext.Provider value={value}>
      <React.Fragment key={key}>{children}</React.Fragment>
    </ThemeContext.Provider>
  );
}
