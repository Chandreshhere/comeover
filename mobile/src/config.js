// Runtime configuration. Environment values live in src/config.env.json, which
// `npm run configure` generates from the deployed backend's CloudFormation
// outputs (see scripts/configure.js). Nothing here is mocked: if the backend
// isn't configured the app shows a "configuration required" state.
import env from './config.env.json';

export const config = {
  // AWS (from `sam deploy` outputs)
  API_URL: env.API_URL || '', // HttpApiUrl incl. /v1
  WS_URL: env.WS_URL || '', // WebSocketUrl
  AWS_REGION: env.AWS_REGION || '',
  COGNITO_USER_POOL_ID: env.COGNITO_USER_POOL_ID || '',
  COGNITO_CLIENT_ID: env.COGNITO_CLIENT_ID || '',
  MEDIA_CDN_URL: env.MEDIA_CDN_URL || '',

  // Store billing product ids (create these in App Store Connect / Play Console)
  IAP_PRODUCTS: env.IAP_PRODUCTS || { plus: 'irl_plus_monthly', pro: 'irl_pro_monthly' },

  // Product constants
  DEFAULT_RADIUS_KM: 3,
  RADIUS_OPTIONS_KM: [1, 3, 5, 10, 25],
  MIN_AGE: 18,
  REQUEST_TIMEOUT_MS: 15000,
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || 'safety@projectirl.app',
  EMERGENCY_NUMBER_IN: '112',
};

export const isConfigured = () => !!(config.API_URL && config.AWS_REGION && config.COGNITO_CLIENT_ID);

export default config;
