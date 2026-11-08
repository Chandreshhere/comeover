'use strict';
// Quests, XP, levels/milestones, achievements, streaks. All derived server-side
// from verified completions; clients can only *claim* rewards the server computed.
const { createRouter, err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { awardXp } = require('../lib/xp');
const { evaluateQuest, periodKey, istDate, weekStart } = require('../lib/quests');
const P = require('../lib/present');
const S = require('../services/progress');

const stripStats = ({ _stats, ...rest }) => rest;

function questOut(x) {
  return P.quest({ ...x.row, progress_count: x.progress, total: x.total, state: x.state });
}

async function findQuest(id) {
  const q = await db.one('SELECT * FROM quests WHERE slug = $1 OR id::text = $1', [id]);
  if (!q || !q.active) throw err.notFound('quest_not_found');
  return q;
}

async function milestonesFor(userId) {
  const [prog, levels] = await Promise.all([
    db.one('SELECT xp_total FROM user_progress WHERE user_id = $1', [userId]),
    db.many('SELECT level, name, xp_threshold, subtitle, pictogram FROM levels WHERE level >= 2 ORDER BY level'),
  ]);
  const xp = prog ? prog.xp_total : 0;
  let currentAssigned = false;
  return levels.map((l) => {
    let state = 'locked';
    if (xp >= l.xp_threshold) state = 'done';
    else if (!currentAssigned) {
      state = 'current';
      currentAssigned = true;
    }
    return { id: `level-${l.level}`, title: l.name, subtitle: l.subtitle || '', pictogram: l.pictogram || 'sparkle', state, progress: Math.min(xp, l.xp_threshold), total: l.xp_threshold, xp: l.xp_threshold };
  });
}

function achievementHint(c, left) {
  const n = (x, word) => `${x} more ${word}${x === 1 ? '' : 's'}`;
  switch (c.type) {
    case 'category_completed':
      return `${n(left, `${c.category} plan`)} to go`;
    case 'early_activity':
      return `Finish ${n(left, 'plan')} that starts before ${c.beforeHour || 8} AM`;
    case 'late_activity':
      return `Finish ${n(left, 'plan')} that starts after ${((c.afterHour || 21) % 12) || 12} PM`;
    case 'distinct_categories':
      return `Try ${n(left, 'new category')}`;
    case 'host_completed':
      return `Host ${n(left, 'plan')} that actually happen${left === 1 ? 's' : ''}`;
    case 'reliability':
      return `Keep showing up — ${Math.round((c.min || 0.95) * 100)}%+ across ${c.minPlans || 10} plans`;
    default:
      return left ? `${n(left, 'verified meetup')} to go` : null;
  }
}

async function achievementsFor(userId, stats) {
  const s = stats || (await S.computeStats(db, userId));
  const rows = await db.many(
    `SELECT a.*, ua.earned_at, ua.evidence FROM achievements a
       LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
      WHERE a.active ORDER BY (ua.earned_at IS NULL), ua.earned_at DESC, a.title`,
    [userId]
  );
  return rows.map((a) => {
    const ev = evaluateQuest(a.criteria, s);
    const left = Math.max(0, ev.total - ev.progress);
    return {
      id: a.slug,
      title: a.title,
      pictogram: a.pictogram || 'star',
      earned: !!a.earned_at,
      earnedAt: a.earned_at || null,
      progress: a.earned_at ? ev.total : ev.progress,
      total: ev.total,
      criteria: a.description,
      evidence: (a.evidence && a.evidence.summary) || null,
      color: a.color,
      category: a.criteria.category || null,
      kind: a.criteria.type,
      hint: a.earned_at ? null : achievementHint(a.criteria, left),
    };
  });
}

const routes = {
  'GET /v1/me/progress': async (req) => {
    const user = await requireUser(req);
    return stripStats(await S.progressFor(db, user.id));
  },

  'GET /v1/quests/today': async (req) => {
    const user = await requireUser(req);
    const list = await S.questsFor(db, user.id);
    return { items: list.map(questOut), nextCursor: null };
  },

  'GET /v1/quests': async (req) => {
    const user = await requireUser(req);
    const { kind } = check({ kind: { type: 'string', enum: ['daily', 'weekly'] } }, req.query);
    const list = await S.questsFor(db, user.id, { kind });
    return { items: list.map(questOut), nextCursor: null };
  },

  'POST /v1/quests/{questId}/start': async (req) => {
    const user = await requireUser(req);
    const q = await findQuest(req.params.questId);
    const period = periodKey(q.kind);
    await db.query(
      `INSERT INTO user_quests (user_id, quest_id, period_key, state) VALUES ($1, $2, $3, 'started')
       ON CONFLICT (user_id, quest_id, period_key) DO UPDATE SET state = CASE WHEN user_quests.state = 'available' THEN 'started' ELSE user_quests.state END, updated_at = now()`,
      [user.id, q.id, period]
    );
    const list = await S.questsFor(db, user.id);
    const mine = list.find((x) => x.row.id === q.id);
    return questOut(mine);
  },

  'POST /v1/quests/{questId}/claim': async (req) => {
    const user = await requireUser(req);
    const q = await findQuest(req.params.questId);
    const period = periodKey(q.kind);
    const stats = await S.computeStats(db, user.id);
    const ev = evaluateQuest(q.criteria, stats);
    if (!ev.done) throw err.conflict('quest_not_complete', 'Finish the quest first — only verified meetups count.');
    const result = await db.withTransaction(async (client) => {
      const { rows } = await client.query('SELECT state FROM user_quests WHERE user_id = $1 AND quest_id = $2 AND period_key = $3 FOR UPDATE', [user.id, q.id, period]);
      if (rows[0] && rows[0].state === 'claimed') throw err.conflict('already_claimed');
      await client.query(
        `INSERT INTO user_quests (user_id, quest_id, period_key, state, progress) VALUES ($1, $2, $3, 'claimed', $4)
         ON CONFLICT (user_id, quest_id, period_key) DO UPDATE SET state = 'claimed', progress = EXCLUDED.progress, updated_at = now()`,
        [user.id, q.id, period, JSON.stringify(ev)]
      );
      return awardXp(client, { userId: user.id, eventType: 'quest_claimed', refId: `${q.slug}:${period}`, base: q.xp_reward });
    });
    const progress = stripStats(await S.progressFor(db, user.id));
    return { claimed: true, xpAwarded: result.xp, capped: !!result.capped, leveledUp: !!result.leveledUp, progress };
  },

  'GET /v1/me/milestones': async (req) => {
    const user = await requireUser(req);
    return { items: await milestonesFor(user.id), nextCursor: null };
  },

  'GET /v1/me/achievements': async (req) => {
    const user = await requireUser(req);
    return { items: await achievementsFor(user.id), nextCursor: null };
  },

  'GET /v1/me/roadmap': async (req) => {
    const user = await requireUser(req);
    const progress = await S.progressFor(db, user.id);
    const [milestones, achievements] = await Promise.all([milestonesFor(user.id), achievementsFor(user.id, progress._stats)]);
    return { level: progress.level, xp: progress.xp, milestones, achievements, categoryCounts: progress.categoryCounts };
  },

  'GET /v1/me/streak-calendar': async (req) => {
    const user = await requireUser(req);
    const { months } = check({ months: { type: 'integer', min: 1, max: 12, default: 3 } }, req.query);
    const progress = await S.progressFor(db, user.id);
    const freezes = new Set(
      (await db.many("SELECT to_char(day, 'YYYY-MM-DD') AS d FROM streak_freezes WHERE user_id = $1", [user.id])).map((r) => r.d)
    );
    const today = istDate();
    const start = S.addDays(weekStart(new Date(Date.now() - months * 30 * 86400000)), 0);
    const days = [];
    for (let d = start; d <= S.addDays(weekStart(), 6); d = S.addDays(d, 1)) {
      const count = progress._stats.byDay[d] || 0;
      let state;
      if (d > today) state = 'future';
      else if (d === today) state = count ? 'today_done' : 'today';
      else if (count) state = 'done';
      else if (freezes.has(d)) state = 'freeze';
      else state = progress.dailyStreakOptIn ? 'missed' : 'rest';
      days.push({ date: d, state, count });
    }
    return { days, streakWeeks: progress.streakWeeks, weeklyGoal: progress.weeklyGoal, freezesLeft: progress.freezesLeft };
  },

  'POST /v1/me/streak-freeze': async (req) => {
    const user = await requireUser(req);
    const { day } = check({ day: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ } }, req.body);
    const progress = await S.progressFor(db, user.id);
    if (progress.freezesLeft < 1) throw err.conflict('no_freezes_left', 'One freeze per week — it refills on Sunday.');
    const candidates = progress.week.filter((d) => d.state === 'missed' || d.state === 'rest');
    const target = day ? candidates.find((d) => d.date === day) : candidates[candidates.length - 1];
    if (!target) throw err.conflict('nothing_to_freeze', 'There is no missed day this week to protect.');
    await db.query('INSERT INTO streak_freezes (user_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, target.date]);
    return stripStats(await S.progressFor(db, user.id));
  },
};

exports.handler = createRouter(routes);
