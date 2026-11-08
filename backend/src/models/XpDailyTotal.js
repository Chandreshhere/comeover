'use strict';
// xp_daily_totals — daily XP cap bookkeeping (IST calendar day "YYYY-MM-DD").
const { makeSchema, model } = require('./_base');

const XpDailyTotalSchema = makeSchema(
  {
    userId: { type: String, required: true },
    day: { type: String, required: true },
    total: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false }
);
XpDailyTotalSchema.index({ userId: 1, day: 1 }, { unique: true });

module.exports = model('XpDailyTotal', XpDailyTotalSchema, 'xp_daily_totals');
