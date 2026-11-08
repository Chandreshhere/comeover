'use strict';
// device_tokens — FCM registration tokens.
const { makeSchema, model } = require('./_base');

const DeviceTokenSchema = makeSchema({
  userId: { type: String, required: true },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  token: { type: String, required: true },
});
DeviceTokenSchema.index({ token: 1 }, { unique: true });
DeviceTokenSchema.index({ userId: 1 });

module.exports = model('DeviceToken', DeviceTokenSchema, 'device_tokens');
