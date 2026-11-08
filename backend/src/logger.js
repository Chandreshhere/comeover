'use strict';
// JSON logs (pino). Phone numbers, tokens and OTPs are redacted.
const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : config.logLevel,
  base: { service: 'irl-api' },
  redact: {
    paths: ['req.headers.authorization', '*.phone', '*.otp', '*.code', '*.accessToken', '*.refreshToken', '*.token', 'headers.authorization'],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
