'use strict';
// Server-side XP. Never trust client-provided XP (08_api_contract.json).
// Only verified real-world events qualify (04_motion_system.json quest_rules):
//   - activity completion confirmed by host + ≥1 attendee, or verified group check-in
//   - new category explored after completion
//   - hosted plan completed without cancellation abuse
//   - claiming a server-evaluated quest
// Every award is de-duplicated by idempotency_key and limited by a daily cap.

const DAILY_CAP = 200;

const XP_RULES = {
  activity_completed: 40,
  new_category_explored: 20,
  hosted_completed: 60,
  quest_claimed: null, // amount comes from the quest's xp_reward
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

function levelForXp(xp, levels) {
  const sorted = [...levels].sort((a, b) => a.xp_threshold - b.xp_threshold);
  let cur = sorted[0];
  for (const l of sorted) if (xp >= l.xp_threshold) cur = l;
  const next = sorted.find((l) => l.xp_threshold > cur.xp_threshold) || null;
  return {
    level: cur.level,
    name: cur.name,
    xp,
    next: next ? { level: next.level, name: next.name, xpThreshold: next.xp_threshold } : null,
    ratio: next ? (xp - cur.xp_threshold) / (next.xp_threshold - cur.xp_threshold) : 1,
  };
}

// Transactional award. `client` must be inside a transaction.
async function awardXp(client, { userId, eventType, refId, activityId = null, base }) {
  const key = xpIdempotencyKey(eventType, userId, refId);
  const day = istDay();
  await client.query('INSERT INTO xp_daily_totals (user_id, day, total) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [userId, day]);
  const { rows: totals } = await client.query('SELECT total FROM xp_daily_totals WHERE user_id = $1 AND day = $2 FOR UPDATE', [userId, day]);
  const { rowCount: dup } = await client.query('SELECT 1 FROM xp_events WHERE idempotency_key = $1', [key]);
  const decision = computeAward({ eventType, base, todayTotal: totals[0] ? totals[0].total : 0, alreadyAwarded: dup > 0 });
  if (decision.reason === 'duplicate' || decision.reason === 'non_qualifying' || decision.reason === 'invalid_amount') return { ...decision, key };

  // Record even capped (0 XP) events so they can never be re-awarded later.
  const ins = await client.query(
    'INSERT INTO xp_events (user_id, activity_id, event_type, xp_delta, idempotency_key) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id',
    [userId, activityId, eventType, decision.xp, key]
  );
  if (!ins.rowCount) return { xp: 0, reason: 'duplicate', capped: false, key };
  if (decision.xp > 0) {
    await client.query('UPDATE xp_daily_totals SET total = total + $3 WHERE user_id = $1 AND day = $2', [userId, day, decision.xp]);
    const { rows: levels } = await client.query('SELECT level, name, xp_threshold FROM levels');
    const { rows: prog } = await client.query(
      `INSERT INTO user_progress (user_id, xp_total) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET xp_total = user_progress.xp_total + EXCLUDED.xp_total, updated_at = now()
       RETURNING xp_total, level`,
      [userId, decision.xp]
    );
    if (levels.length) {
      const lvl = levelForXp(prog[0].xp_total, levels);
      if (lvl.level !== prog[0].level) {
        await client.query('UPDATE user_progress SET level = $2 WHERE user_id = $1', [userId, lvl.level]);
        return { ...decision, key, leveledUp: lvl.level > prog[0].level, level: lvl };
      }
    }
  }
  return { ...decision, key };
}

module.exports = { DAILY_CAP, XP_RULES, NON_QUALIFYING, isQualifying, xpIdempotencyKey, computeAward, istDay, levelForXp, awardXp };
