'use strict';
// realtime_events — cross-instance WebSocket fan-out. Each API instance tails this
// collection with a change stream and delivers events to its local sockets.
// Short TTL: it is a transport, not a history.
const { Schema, Mixed, uuid, model } = require('./_base');

const RealtimeEventSchema = new Schema(
  {
    _id: { type: String, default: uuid },
    channel: { type: String, required: true },
    type: { type: String, required: true },
    data: { type: Mixed, default: () => ({}) },
    origin: { type: String, default: null }, // instance id that published it
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
RealtimeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

module.exports = model('RealtimeEvent', RealtimeEventSchema, 'realtime_events');
