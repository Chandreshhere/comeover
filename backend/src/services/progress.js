'use strict';
// Progress computed from verified completions only (state = 'completed').
const { evaluateQuest, periodKey, istDate, weekStart } = require('../lib/quests');
const { levelForXp, DAILY_CAP } = require('../lib/xp');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function completions(q, userId) {
  const { rows } = await q.query(
    `SELECT a.id, c.slug AS category, (a.host_user_id = $1) AS hosted,
            to_char(a.starts_at AT TIME ZONE 'Asia/Kolkata', 'HH24')::int AS start_hour,
            to_char(COALESCE(a.completed_at, p.completion_confirmed_at, a.ends_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day
       FROM activity_participants p JOIN activities a ON a.id = p.activity_id LEFT JOIN activity_categories c ON c.id = a.category_id
      WHERE p.user_id = $1 AND p.state = 'completed'
      ORDER BY day`,
    [userId]
  );
  return rows;
}

async function firstMet(q, userId) {
  const { rows } = await q.query(
    `SELECT p2.user_id, min(to_char(COALESCE(a.completed_at, a.ends_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')) AS day
       FROM activity_participants p1
       JOIN activity_participants p2 ON p2.activity_id = p1.activity_id AND p2.user_id <> p1.user_id AND p2.state = 'completed'
       JOIN activities a ON a.id = p1.activity_id
      WHERE p1.user_id = $1 AND p1.state = 'completed'
      GROUP BY p2.user_id`,
    [userId]
  );
  return rows;
}

async function reliability(q, userId) {
  const { rows } = await q.query(
    `SELECT count(*) FILTER (WHERE kind = 'attended')::int AS attended,
            count(*) FILTER (WHERE kind IN ('no_show','late_cancel'))::int AS missed
       FROM reliability_events WHERE user_id = $1`,
    [userId]
  );
  const { attended, missed } = rows[0];
  const n = attended + missed;
  return { rate: n ? attended / n : 1, plans: n };
}

// Stats object consumed by evaluateQuest (see lib/quests.js).
async function computeStats(q, userId, now = new Date()) {
  const [done, met, rel] = await Promise.all([completions(q, userId), firstMet(q, userId), reliability(q, userId)]);
  const today = istDate(now);
  const wk = weekStart(now);
  const inDay = (d) => d === today;
  const inWeek = (d) => d >= wk;
  const firstCat = {};
  for (const r of done) if (r.category && !firstCat[r.category]) firstCat[r.category] = r.day;
  const win = (pred) => ({
    completed: done.filter((r) => pred(r.day)).length,
    newPeople: met.filter((m) => pred(m.day)).length,
    newCategories: Object.values(firstCat).filter(pred).length,
    hostedCompleted: done.filter((r) => r.hosted && pred(r.day)).length,
    startHours: done.filter((r) => pred(r.day)).map((r) => r.start_hour),
  });
  const categoryCounts = {};
  for (const r of done) if (r.category) categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
  return {
    day: win(inDay),
    week: win(inWeek),
    all: { ...win(() => true), categoryCounts, reliability: rel.rate, plansConsidered: rel.plans },
    peopleMet: met.length,
    byDay: done.reduce((acc, r) => ((acc[r.day] = (acc[r.day] || 0) + 1), acc), {}),
    reliability: rel,
  };
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function progressFor(q, userId, now = new Date()) {
  const [stats, prog, levels, freezes, today] = await Promise.all([
    computeStats(q, userId, now),
    q.query('SELECT xp_total, weekly_goal, daily_streak_opt_in FROM user_progress WHERE user_id = $1', [userId]).then((r) => r.rows[0] || { xp_total: 0, weekly_goal: 2, daily_streak_opt_in: false }),
    q.query('SELECT level, name, xp_threshold FROM levels ORDER BY level').then((r) => r.rows),
    q.query("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM streak_freezes WHERE user_id = $1 AND day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 400", [userId]).then((r) => r.rows.map((x) => x.day)),
    q.query('SELECT total FROM xp_daily_totals WHERE user_id = $1 AND day = $2', [userId, istDate(now)]).then((r) => (r.rows[0] ? r.rows[0].total : 0)),
  ]);
  const xpToday = today;
  const todayDate = istDate(now);
  const wk = weekStart(now);
  const frozen = new Set(freezes);

  const week = DAY_LABELS.map((label, i) => {
    const date = addDays(wk, i);
    const count = stats.byDay[date] || 0;
    let state;
    if (date > todayDate) state = 'future';
    else if (date === todayDate) state = count ? 'today_done' : 'today';
    else if (count) state = 'done';
    else if (frozen.has(date)) state = 'freeze';
    else state = prog.daily_streak_opt_in ? 'missed' : 'rest';
    return { label, date, state };
  });

  // Weekly streak: consecutive weeks meeting the goal (or protected by a freeze).
  const weeklyDone = Object.entries(stats.byDay).filter(([d]) => d >= wk).reduce((n, [, c]) => n + c, 0);
  const goal = prog.weekly_goal || 2;
  let streakWeeks = weeklyDone >= goal ? 1 : 0;
  for (let w = 1; w <= 104; w += 1) {
    const start = addDays(wk, -7 * w);
    const end = addDays(start, 7);
    const n = Object.entries(stats.byDay).filter(([d]) => d >= start && d < end).reduce((s, [, c]) => s + c, 0);
    const protectedWeek = freezes.some((d) => d >= start && d < end);
    if (n >= goal || protectedWeek) streakWeeks += 1;
    else break;
  }
  const freezesThisWeek = freezes.filter((d) => d >= wk).length;
  const lvl = levels.length ? levelForXp(prog.xp_total, levels) : { level: 1, name: 'Newcomer', next: null };

  return {
    xp: prog.xp_total,
    level: { level: lvl.level, name: lvl.name, xp: prog.xp_total, nextXp: lvl.next ? lvl.next.xpThreshold : null, nextName: lvl.next ? lvl.next.name : null },
    completedActivities: stats.all.completed,
    peopleMet: stats.peopleMet,
    hosted: stats.all.hostedCompleted,
    showUpRate: Math.round(stats.reliability.rate * 100) / 100,
    weeklyGoal: goal,
    weeklyDone,
    streakWeeks,
    freezesLeft: Math.max(0, 1 - freezesThisWeek),
    dailyStreakOptIn: !!prog.daily_streak_opt_in,
    dailyXpCap: DAILY_CAP,
    xpToday,
    categoryCounts: stats.all.categoryCounts,
    week,
    _stats: stats,
  };
}

async function questsFor(q, userId, { kind, stats } = {}) {
  const s = stats || (await computeStats(q, userId));
  const params = [userId];
  let filter = "q.active AND (q.starts_at IS NULL OR q.starts_at <= now()) AND (q.ends_at IS NULL OR q.ends_at > now()) AND q.kind IN ('daily','weekly')";
  if (kind) {
    params.push(kind);
    filter += ` AND q.kind = $${params.length}`;
  }
  const { rows } = await q.query(`SELECT q.* FROM quests q WHERE ${filter} ORDER BY q.kind, q.xp_reward`, params);
  const { rows: uq } = await q.query('SELECT quest_id, period_key, state FROM user_quests WHERE user_id = $1', [userId]);
  return rows.map((row) => {
    const period = periodKey(row.kind);
    const ev = evaluateQuest(row.criteria, s);
    const mine = uq.find((u) => u.quest_id === row.id && u.period_key === period);
    let state = 'available';
    if (mine && mine.state === 'claimed') state = 'claimed';
    else if (ev.done) state = 'completed';
    else if (ev.progress > 0 || (mine && mine.state === 'started')) state = 'started';
    return { row, period, state, progress: ev.progress, total: ev.total };
  });
}

module.exports = { DAY_LABELS, computeStats, progressFor, questsFor, addDays };
