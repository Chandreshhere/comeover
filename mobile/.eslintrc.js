// Focused lint config (the stock @react-native/eslint-config 0.76.5 currently
// fails to load its jest env with the resolved plugin versions).
module.exports = {
  root: true,
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    babelOptions: { presets: ['module:@react-native/babel-preset'] },
  },
  env: { es2022: true, node: true },
  globals: { __DEV__: 'readonly', fetch: 'readonly', FormData: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', WebSocket: 'readonly', AbortController: 'readonly', Blob: 'readonly' },
  plugins: ['react', 'react-hooks'],
  settings: { react: { version: '18.3' } },
  ignorePatterns: ['android/', 'ios/', 'node_modules/', '**/._*'],
  rules: {
    'no-undef': 'error',
    'react/jsx-no-undef': 'error',
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
  },
  overrides: [{ files: ['__tests__/**', '*.test.js'], env: { jest: true } }],
};
