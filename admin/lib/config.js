// Build-time public configuration. Next.js inlines NEXT_PUBLIC_* values, so each
// variable must be referenced literally here.
export const config = {
  // Strip a stray BOM / whitespace (e.g. from a piped `vercel env add`) and trailing slashes.
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || '').replace(/^[﻿\s]+|\s+$/g, '').replace(/\/+$/, ''),
};

export const ENV_VARS = [
  { name: 'NEXT_PUBLIC_API_URL', value: config.apiUrl, help: 'Project IRL API base URL including /v1, e.g. https://api.your-domain.com/v1 (add this console origin to the API CORS_ORIGINS)' },
];

export const missingEnv = ENV_VARS.filter((v) => !v.value).map((v) => v.name);
export const isConfigured = missingEnv.length === 0;
