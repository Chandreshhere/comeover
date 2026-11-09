module.exports = {
  preset: 'react-native',
  // The repo can live on exFAT drives where macOS writes `._*` AppleDouble files.
  testPathIgnorePatterns: ['/node_modules/', '/\\._'],
  modulePathIgnorePatterns: ['/\\._'],
};
