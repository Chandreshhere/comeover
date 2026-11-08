// Build-time public configuration. Next.js inlines NEXT_PUBLIC_* values, so each
// variable must be referenced literally here.
export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, ''),
  cognitoDomain: (process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '').replace(/\/+$/, ''),
  cognitoClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
  cognitoRedirectUri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI || '',
  cognitoLogoutUri: process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI || '',
};

export const ENV_VARS = [
  { name: 'NEXT_PUBLIC_API_URL', value: config.apiUrl, help: 'Backend HttpApiUrl including /v1, e.g. https://abc123.execute-api.ap-south-1.amazonaws.com/v1' },
  { name: 'NEXT_PUBLIC_COGNITO_DOMAIN', value: config.cognitoDomain, help: 'Cognito Hosted UI domain, e.g. https://irl-admin.auth.ap-south-1.amazoncognito.com' },
  { name: 'NEXT_PUBLIC_COGNITO_CLIENT_ID', value: config.cognitoClientId, help: 'App client id (public client, no secret, authorization code + PKCE)' },
  { name: 'NEXT_PUBLIC_COGNITO_REDIRECT_URI', value: config.cognitoRedirectUri, help: 'Must be an allowed callback URL, e.g. http://localhost:3001/auth/callback' },
  { name: 'NEXT_PUBLIC_COGNITO_LOGOUT_URI', value: config.cognitoLogoutUri, help: 'Must be an allowed sign-out URL, e.g. http://localhost:3001/login?signedout=1' },
];

export const missingEnv = ENV_VARS.filter((v) => !v.value).map((v) => v.name);
export const isConfigured = missingEnv.length === 0;
