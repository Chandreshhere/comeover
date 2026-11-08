'use strict';
// jobs — Mongo-backed work queue (replaces SQS). Finished jobs expire after 7 days.
const { makeSchema, Mixed, model } = require('./_base');

const JobSchema = makeSchema({
  type: { type: String, required: true },
  payload: { type: Mixed, default: () => ({}) },
  status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
  runAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lockedUntil: { type: Date, default: null },
  lockedBy: { type: String, default: null },
  lastError: { type: String, default: null },
  finishedAt: { type: Date, default: null },
  dedupeKey: { type: String, default: undefined },
});
JobSchema.index({ status: 1, runAt: 1 });
JobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 7 * 86400 });
JobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, status: { $in: ['queued', 'running'] } } });

module.exports = model('Job', JobSchema, 'jobs');
