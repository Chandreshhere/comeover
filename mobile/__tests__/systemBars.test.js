jest.mock('@react-navigation/native', () => ({ NavigationContext: require('react').createContext(null) }));

import { isLightColor, toAndroidHex } from '../src/services/systemBars';

describe('systemBars colour helpers', () => {
  it('normalises hex and rgb(a) colours to Android hex', () => {
    expect(toAndroidHex('#9cb9ff')).toBe('#9CB9FF');
    expect(toAndroidHex('#fff')).toBe('#FFFFFF');
    expect(toAndroidHex('rgb(0, 0, 0)')).toBe('#000000');
    expect(toAndroidHex('rgba(255,255,255,0.5)')).toBe('#80FFFFFF');
    expect(toAndroidHex('transparent')).toBeNull();
    expect(toAndroidHex(undefined)).toBeNull();
  });

  it('picks dark icons for light backgrounds and light icons for dark ones', () => {
    expect(isLightColor('#F2F3F8')).toBe(true); // canvas
    expect(isLightColor('#9CB9FF')).toBe(true); // periwinkle
    expect(isLightColor('#000000')).toBe(false); // dark mode
    expect(isLightColor('#0B0C12')).toBe(false); // splash ink
    expect(isLightColor('#FF9A52')).toBe(true); // splash orange
  });
});
