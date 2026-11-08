'use strict';
// activity_feedback — private post-activity feedback (never shown raw to others).
const { makeSchema, model } = require('./_base');

const ActivityFeedbackSchema = makeSchema({
  activityId: { type: String, required: true },
  fromUserId: { type: String, required: true },
  aboutUserId: { type: String, required: true },
  showedUp: { type: Boolean, default: null },
  rating: { type: Number, min: 1, max: 5, default: null },
  note: { type: String, maxlength: 500, default: null },
});
ActivityFeedbackSchema.index({ activityId: 1, fromUserId: 1, aboutUserId: 1 }, { unique: true });
ActivityFeedbackSchema.index({ aboutUserId: 1, createdAt: -1 });

module.exports = model('ActivityFeedback', ActivityFeedbackSchema, 'activity_feedback');
