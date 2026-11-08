'use strict';
// Server-side XP. Never trust client-provided XP (08_api_contract.json).
// Only verified real-world events qualify (04_motion_system.json quest_rules):
//   - activity completion confirmed by host + ≥1 attendee, or verified group check-in
//   - new category explored after completion
//   - hosted plan completed without cancellation abuse
//   - claiming a server-evaluated quest
// Every award is de-duplicated by idempotencyKey and limited by a daily cap.
//
//   const r = await awardXp(session, { userId, eventType: 'activity_completed', refId: activityId, activityId });
//   // r = { xp, reason, capped, key, leveledUp?, level? }

const DAILY_CAP = 200;

const XP_RULES = {
  activity_completed: 40,
  new_category_explored: 20,
  hosted_completed: 60,
  quest_claimed: null, // amount comes from the quest's xpReward
  circle_challenge_completed: null,
};

const NON_QUALIFYING = new Set(['swipe', 'like', 'message', 'message_sent', 'join_request', 'invite', 'profile_view', 'plan_created', 'login']);

function isQualifying(eventType) {
  return !NON_QUALIFYING.has(eventType) && Object.prototype.hasOwnProperty.call(XP_RULES, eventType);
}

function xpIdempotencyKey(eventType, userId, refId) {
  if (!eventType || !userId || !refId) throw new Error('xp key requires eventType, userId and refId');
  return `xp:${eventType}:${userId}:${refId}`;
}

// Pure decision function (unit-tested).
function computeAward({ eventType, base, todayTotal = 0, cap = DAILY_CAP, alreadyAwarded = false }) {
  if (!isQualifying(eventType)) return { xp: 0, reason: 'non_qualifying', capped: false };
  if (alreadyAwarded) return { xp: 0, reason: 'duplicate', capped: false };
  const amount = base != null ? base : XP_RULES[eventType];
  if (!Number.isInteger(amount) || amount < 0) return { xp: 0, reason: 'invalid_amount', capped: false };
  const room = Math.max(0, cap - Math.max(0, todayTotal));
  const xp = Math.min(amount, room);
  if (xp === 0 && amount > 0) return { xp: 0, reason: 'daily_cap_reached', capped: true };
  return { xp, reason: xp < amount ? 'capped' : 'awarded', capped: xp < amount };
}

// Calendar day in India Standard Time (UTC+05:30), used for the daily cap.
function istDay(date = new Date()) {
  return new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

// levels: [{ level, name, xpThreshold }] (legacy snake_case xp_threshold also accepted)
function levelForXp(xp, levels) {
  const t = (l) => (l.xpThreshold != null ? l.xpThreshold : l.xp_threshold);
  const sorted = [...levels].sort((a, b) => t(a) - t(b));
  let cur = sorted[0];
  for (const l of sorted) if (xp >= t(l)) cur = l;
  const next = sorted.find((l) => t(l) > t(cur)) || null;
  return {
    level: cur.level,
    name: cur.name,
    xp,
    next: next ? { level: next.level, name: next.name, xpThreshold: t(next) } : null,
    ratio: next ? (xp - t(cur)) / (t(next) - t(cur)) : 1,
  };
}

// Award inside a transaction (pass the session from db.withTransaction).
async function awardXp(session, { userId, eventType, refId, activityId = null, base }) {
  const { XpDailyTotal, XpEvent, User, Level } = require('../models');
  const key = xpIdempotencyKey(eventType, userId, refId);
  const day = istDay();
  const opts = session ? { session } : {};
  const totals = await XpDailyTotal.findOneAndUpdate({ userId, day }, { $setOnInsert: { total: 0 } }, { upsert: true, new: true, ...opts }).lean();
  const dup = await XpEvent.exists({ idempotencyKey: key }).session(session || null);
  const decision = computeAward({ eventType, base, todayTotal: totals ? totals.total : 0, alreadyAwarded: !!dup });
  if (decision.reason === 'duplicate' || decision.reason === 'non_qualifying' || decision.reason === 'invalid_amount') return { ...decision, key };

  // Record even capped (0 XP) events so they can never be re-awarded later.
  try {
    await XpEvent.create([{ userId, activityId, eventType, xpDelta: decision.xp, idempotencyKey: key }], opts);
  } catch (e) {
    if (e && e.code === 11000) return { xp: 0, reason: 'duplicate', capped: false, key };
    throw e;
  }
  if (decision.xp > 0) {
    await XpDailyTotal.updateOne({ userId, day }, { $inc: { total: decision.xp } }, opts);
    const user = await User.findOneAndUpdate(
      { _id: userId },
      { $inc: { 'progress.xpTotal': decision.xp }, $set: { 'progress.updatedAt': new Date() } },
      { new: true, ...opts }
    )
      .select('progress')
      .lean();
    const levels = await Level.find({}).select('level name xpThreshold').session(session || null).lean();
    if (user && levels.length) {
      const prevLevel = (user.progress && user.progress.level) || 1;
      const lvl = levelForXp(user.progress.xpTotal, levels);
      if (lvl.level !== prevLevel) {
        await User.updateOne({ _id: userId }, { $set: { 'progress.level': lvl.level } }, opts);
        return { ...decision, key, leveledUp: lvl.level > prevLevel, level: lvl };
      }
    }
  }
  return { ...decision, key };
}

module.exports = { DAILY_CAP, XP_RULES, NON_QUALIFYING, isQualifying, xpIdempotencyKey, computeAward, istDay, levelForXp, awardXp };
