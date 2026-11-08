'use strict';
// Shared safety vocabulary + block lookups + the moderation_alert job.
const logger = require('../logger');

const REASON_CODES = [
  'harassment',
  'safety_threat',
  'dating_or_solicitation',
  'underage',
  'impersonation',
  'spam',
  'scam',
  'hate',
  'inappropriate_content',
  'no_show_abuse',
  'unsafe_venue',
  'other',
];

const URGENT = new Set(['safety_threat', 'underage']);
const HIGH = new Set(['harassment', 'dating_or_solicitation', 'hate', 'scam', 'impersonation']);

function priorityFor(reason) {
  if (URGENT.has(reason)) return 'urgent';
  if (HIGH.has(reason)) return 'high';
  if (reason === 'spam') return 'low';
  return 'normal';
}

// Ids the user has blocked (one direction: hides their content from me).
async function blockedByMe(userId, { session } = {}) {
  const { Block } = require('../models');
  const q = Block.find({ blockerUserId: userId }).select('blockedUserId');
  if (session) q.session(session);
  const rows = await q.lean();
  return new Set(rows.map((r) => r.blockedUserId));
}

// Ids blocked in either direction (no contact at all: direct chats, circles, splits).
async function blockedEither(userId, { session } = {}) {
  const { Block } = require('../models');
  const q = Block.find({ $or: [{ blockerUserId: userId }, { blockedUserId: userId }] }).select('blockerUserId blockedUserId');
  if (session) q.session(session);
  const rows = await q.lean();
  return new Set(rows.map((r) => (r.blockerUserId === userId ? r.blockedUserId : r.blockerUserId)));
}

async function isBlockedEither(a, b, { session } = {}) {
  if (!a || !b) return false;
  const { Block } = require('../models');
  const q = Block.exists({ $or: [{ blockerUserId: a, blockedUserId: b }, { blockerUserId: b, blockedUserId: a }] });
  if (session) q.session(session);
  return !!(await q);
}

// moderation_alert { reportId, appeal } — urgent/high reports and all appeals page the
// moderation team: an in-app notification (+ push) to every admin/moderator, plus an
// optional webhook (MODERATION_WEBHOOK_URL, e.g. a Slack/Teams incoming webhook).
async function runModerationAlert({ reportId, appeal = false }) {
  const { Report, User } = require('../models');
  const { notify } = require('../lib/notify');
  const r = await Report.findById(reportId).select('reasonCode priority status').lean();
  if (!r) return { skipped: 'report_not_found' };
  if (!appeal && !['urgent', 'high'].includes(r.priority)) return { skipped: 'low_priority' };
  const title = `[IRL ${appeal ? 'APPEAL' : r.priority.toUpperCase()}] ${r.reasonCode}`;
  const body = `${appeal ? 'New appeal' : 'New report'} ${r._id} (${r.reasonCode}, ${r.priority}). Review in the admin console.`;
  const staff = await User.find({ roles: { $in: ['admin', 'moderator'] }, status: { $nin: ['suspended', 'deleted'] } }).select('_id').lean();
  for (const s of staff) {
    await notify(null, null, s._id, { type: 'safety', title, body, data: { reportId: String(r._id), appeal: !!appeal, target: null } });
  }
  const url = process.env.MODERATION_WEBHOOK_URL;
  if (url) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `${title}\n${body}` }) });
      if (!res.ok) logger.warn({ msg: 'moderation_webhook_failed', status: res.status });
    } catch (e) {
      logger.warn({ msg: 'moderation_webhook_failed', err: e.message });
    }
  }
  logger.warn({ msg: 'moderation_alert', reportId: String(r._id), priority: r.priority, appeal: !!appeal, notified: staff.length });
  return { notified: staff.length };
}

module.exports = { REASON_CODES, priorityFor, blockedByMe, blockedEither, isBlockedEither, runModerationAlert };
