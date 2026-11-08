'use strict';
// Central environment configuration. Every variable is documented in .env.example.
const bool = (v, d = false) => (v == null || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const env = process.env;

const config = {
  env: env.NODE_ENV || 'development',
  port: int(env.PORT, 8080),
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
  corsOrigins: list(env.CORS_ORIGINS),
  trustProxy: env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
  logLevel: env.LOG_LEVEL || 'info',
  maintenance: { enabled: bool(env.MAINTENANCE_MODE), message: env.MAINTENANCE_MESSAGE || "We're doing a quick tune-up. Back shortly." },

  mongoUri: env.MONGODB_URI || 'mongodb://localhost:27017/irl?replicaSet=rs0',

  jwt: {
    secret: env.JWT_SECRET || '',
    issuer: env.JWT_ISSUER || 'projectirl',
    accessTtlSec: int(env.ACCESS_TOKEN_TTL_SEC, 900),
    refreshTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 30),
  },

  slide: {
    baseUrl: (env.SLIDE_BASE_URL || 'https://api.slide.cx').replace(/\/$/, ''),
    apiKey: env.SLIDE_API_KEY || '',
    otpWidgetId: env.SLIDE_OTP_WIDGET_ID || '',
    timeoutMs: int(env.SLIDE_TIMEOUT_MS, 10000),
    otpTtlSec: int(env.OTP_TTL_SEC, 600),
    resendAfterSec: int(env.OTP_RESEND_AFTER_SEC, 30),
    maxVerifyAttempts: int(env.OTP_MAX_ATTEMPTS, 5),
    codeLength: int(env.SLIDE_OTP_CODE_LENGTH, 6), // must match the Slide OTP widget; sent to clients for the code boxes
  },

  // TEMPORARY fixed-code sign-in for ONE phone number (for testing before Slide is set up).
  // Off unless both phone and code are set. In production it is ignored unless
  // TEST_LOGIN_ALLOW_PRODUCTION=true AND TEST_LOGIN_EXPIRES_AT (ISO date) is in the future.
  testLogin: {
    phone: env.TEST_LOGIN_PHONE || '',
    code: env.TEST_LOGIN_CODE || '',
    expiresAt: env.TEST_LOGIN_EXPIRES_AT || '',
    allowProduction: bool(env.TEST_LOGIN_ALLOW_PRODUCTION),
  },

  s3: {
    bucket: env.S3_BUCKET || '',
    region: env.S3_REGION || 'ap-south-1',
    endpoint: env.S3_ENDPOINT || '', // R2 / MinIO; empty = AWS S3
    forcePathStyle: bool(env.S3_FORCE_PATH_STYLE),
    accessKeyId: env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    serverSideEncryption: env.S3_SSE === 'none' ? null : env.S3_SSE || 'AES256',
    cdnUrl: env.MEDIA_CDN_URL || '',
  },

  anthropic: { apiKey: env.ANTHROPIC_API_KEY || '', model: env.ASSISTANT_MODEL || 'claude-opus-5-5' },

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    venuePlanPriceInr: int(env.VENUE_PLAN_PRICE_INR, 999),
  },

  apple: {
    issuerId: env.APPLE_IAP_ISSUER_ID || '',
    keyId: env.APPLE_IAP_KEY_ID || '',
    privateKey: (env.APPLE_IAP_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    bundleId: env.APPLE_BUNDLE_ID || 'com.projectirl.app',
    environment: env.APPLE_ENV || 'Sandbox',
    rootCaG3Sha256: env.APPLE_ROOT_CA_G3_SHA256 || '',
  },

  google: {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    androidPackageName: env.ANDROID_PACKAGE_NAME || 'com.projectirl.app',
    rtdnToken: env.GOOGLE_RTDN_TOKEN || '',
    fcmProjectId: env.FCM_PROJECT_ID || '',
  },

  iap: { plusProductId: env.IAP_PLUS_PRODUCT_ID || 'irl_plus_monthly', proProductId: env.IAP_PRO_PRODUCT_ID || 'irl_pro_monthly' },

  jobs: { enabled: bool(env.JOBS_ENABLED, true), pollMs: int(env.JOBS_POLL_MS, 2000) },
  realtime: { changeStreams: bool(env.REALTIME_CHANGE_STREAMS, true) },
};

module.exports = config;
