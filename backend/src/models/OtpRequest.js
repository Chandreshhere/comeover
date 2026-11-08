'use strict';
// otp_requests — one Slide OTP request (_id = Slide requestId). Replaces otp_attempts.
// Expires automatically (TTL on expiresAt).
const { Schema, model } = require('./_base');

const OtpRequestSchema = new Schema(
  {
    _id: { type: String, required: true }, // Slide requestId
    phone: { type: String, required: true },
    ip: { type: String, default: null },
    channel: { type: String, default: null }, // 'sms' | 'whatsapp' | 'test'
    provider: { type: String, default: 'slide' }, // 'slide' | 'test' (fixed-code test login, see lib/testLogin.js)
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);
OtpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpRequestSchema.index({ phone: 1, createdAt: -1 });

module.exports = model('OtpRequest', OtpRequestSchema, 'otp_requests');
