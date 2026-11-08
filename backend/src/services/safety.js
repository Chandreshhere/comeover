'use strict';
// Shared safety vocabulary.
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

module.exports = { REASON_CODES, priorityFor };
