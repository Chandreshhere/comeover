'use strict';
// assistant_usage — IRL Guide daily quota (IST day "YYYY-MM-DD").
const { makeSchema, model } = require('./_base');

const AssistantUsageSchema = makeSchema(
  {
    userId: { type: String, required: true },
    day: { type: String, required: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false }
);
AssistantUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

module.exports = model('AssistantUsage', AssistantUsageSchema, 'assistant_usage');
