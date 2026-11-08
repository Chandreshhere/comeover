module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: { '@': './src' },
        extensions: ['.ios.js', '.android.js', '.js', '.json'],
      },
    ],
    // Must stay last.
    'react-native-reanimated/plugin',
  ],
};
