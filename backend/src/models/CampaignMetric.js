'use strict';
// campaign_metrics — daily counters per campaign (day = "YYYY-MM-DD").
const { makeSchema, model } = require('./_base');

const CampaignMetricSchema = makeSchema(
  {
    campaignId: { type: String, required: true },
    day: { type: String, required: true },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    joinRequests: { type: Number, default: 0 },
    checkIns: { type: Number, default: 0 },
  },
  { timestamps: false }
);
CampaignMetricSchema.index({ campaignId: 1, day: 1 }, { unique: true });

module.exports = model('CampaignMetric', CampaignMetricSchema, 'campaign_metrics');
