'use strict';
// activity_daily_metrics — non-host detail views per day, for venue analytics.
const { makeSchema, model } = require('./_base');

const ActivityDailyMetricSchema = makeSchema(
  {
    activityId: { type: String, required: true },
    day: { type: String, required: true },
    views: { type: Number, default: 0 },
  },
  { timestamps: false }
);
ActivityDailyMetricSchema.index({ activityId: 1, day: 1 }, { unique: true });

module.exports = model('ActivityDailyMetric', ActivityDailyMetricSchema, 'activity_daily_metrics');
