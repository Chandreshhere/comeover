'use strict';
// Progress computed from verified completions only (Participant.state = 'completed').
// Mongo port of legacy/src/services/progress.js — same outputs.
//
//   const stats = await computeStats(userId);            // input for lib/quests.evaluateQuest
//   const progress = await progressFor(userId);          // Progress model (+ _stats, stripped by handlers)
//   const list = await questsFor(userId, { kind });      // [{ quest, period, state, progress, total }]
const { evaluateQuest, periodKey, istDate, weekStart } = require('../lib/quests');
const { levelForXp, DAILY_CAP } = require('../lib/xp');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_MS = 330 * 60000;

const istHour = (d) => new Date(new Date(d).getTime() + IST_MS).getUTCHours();
const sess = (q, session) => (session ? q.session(session) : q);

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The day a completion counts on: plan completion time, else the user's confirmation, else the plan end.
const completionDay = (activity, participant) => istDate(new Date(activity.completedAt || (participant && participant.completionConfirmedAt) || activity.endsAt));

// [{ id, category, hosted, startHour, day }] sorted by day.
async function completions(userId, session) {
  const { Participant, Activity } = require('../models');
  const parts = await sess(Participant.find({ userId, state: 'completed' }).select('activityId completionConfirmedAt'), session).lean();
  if (!parts.length) return [];
  const acts = await sess(Activity.find({ _id: { $in: parts.map((p) => p.activityId) } }).select('category hostUserId startsAt endsAt completedAt'), session).lean();
  const byId = new Map(acts.map((a) => [a._id, a]));
  const rows = [];
  for (const p of parts) {
    const a = byId.get(p.activityId);
    if (!a) continue;
    rows.push({ id: a._id, category: a.category || null, hosted: a.hostUserId === userId, startHour: istHour(a.startsAt), day: completionDay(a, p) });
  }
  return rows.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
}

// People the user completed a plan with, and the first day they met: [{ userId, day }].
async function firstMet(userId, activityIds, session) {
  const { Participant, Activity } = require('../models');
  if (!activityIds.length) return [];
  const [others, acts] = await Promise.all([
    sess(Participant.find({ activityId: { $in: activityIds }, state: 'completed', userId: { $ne: userId } }).select('activityId userId'), session).lean(),
    sess(Activity.find({ _id: { $in: activityIds } }).select('completedAt endsAt'), session).lean(),
  ]);
  const dayOf = new Map(acts.map((a) => [a._id, istDate(new Date(a.completedAt || a.endsAt))]));
  const first = new Map();
  for (const o of others) {
    const d = dayOf.get(o.activityId);
    if (!d) continue;
    if (!first.has(o.userId) || d < first.get(o.userId)) first.set(o.userId, d);
  }
  return [...first.entries()].map(([uid, day]) => ({ userId: uid, day }));
}

async function reliability(userId, session) {
  const { ReliabilityEvent } = require('../models');
  const rows = await sess(ReliabilityEvent.find({ userId, kind: { $in: ['attended', 'no_show', 'late_cancel'] } }).select('kind'), session).lean();
  const attended = rows.filter((r) => r.kind === 'attended').length;
  const missed = rows.length - attended;
  const n = attended + missed;
  return { rate: n ? attended / n : 1, plans: n };
}

// Stats object consumed by evaluateQuest (see lib/quests.js).
async function computeStats(userId, { now = new Date(), session } = {}) {
  const done = await completions(userId, session);
  const [met, rel] = await Promise.all([firstMet(userId, done.map((r) => r.id), session), reliability(userId, session)]);
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
    startHours: done.filter((r) => pred(r.day)).map((r) => r.startHour),
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

// Freeze days within the last ~400 days ("YYYY-MM-DD" strings).
async function freezeDays(userId, { now = new Date(), session } = {}) {
  const { StreakFreeze } = require('../models');
  const since = addDays(istDate(now), -400);
  const rows = await sess(StreakFreeze.find({ userId, day: { $gt: since } }).select('day'), session).lean();
  return rows.map((r) => r.day);
}

async function progressFor(userId, { now = new Date(), session, stats: given } = {}) {
  const { User, Level, XpDailyTotal } = require('../models');
  const [stats, user, levels, freezes, todayTotal] = await Promise.all([
    given || computeStats(userId, { now, session }),
    sess(User.findById(userId).select('progress'), session).lean(),
    sess(Level.find({}).select('level name xpThreshold').sort({ level: 1 }), session).lean(),
    freezeDays(userId, { now, session }),
    sess(XpDailyTotal.findOne({ userId, day: istDate(now) }).select('total'), session).lean(),
  ]);
  const prog = (user && user.progress) || {};
  const xpTotal = prog.xpTotal || 0;
  const optIn = !!prog.dailyStreakOptIn;
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
    else state = optIn ? 'missed' : 'rest';
    return { label, date, state };
  });

  // Weekly streak: consecutive weeks meeting the goal (or protected by a freeze).
  const weeklyDone = Object.entries(stats.byDay)
    .filter(([d]) => d >= wk)
    .reduce((n, [, c]) => n + c, 0);
  const goal = prog.weeklyGoal || 2;
  let streakWeeks = weeklyDone >= goal ? 1 : 0;
  for (let w = 1; w <= 104; w += 1) {
    const start = addDays(wk, -7 * w);
    const end = addDays(start, 7);
    const n = Object.entries(stats.byDay)
      .filter(([d]) => d >= start && d < end)
      .reduce((s, [, c]) => s + c, 0);
    const protectedWeek = freezes.some((d) => d >= start && d < end);
    if (n >= goal || protectedWeek) streakWeeks += 1;
    else break;
  }
  const freezesThisWeek = freezes.filter((d) => d >= wk).length;
  const lvl = levels.length ? levelForXp(xpTotal, levels) : { level: 1, name: 'Newcomer', next: null };

  return {
    xp: xpTotal,
    level: { level: lvl.level, name: lvl.name, xp: xpTotal, nextXp: lvl.next ? lvl.next.xpThreshold : null, nextName: lvl.next ? lvl.next.name : null },
    completedActivities: stats.all.completed,
    peopleMet: stats.peopleMet,
    hosted: stats.all.hostedCompleted,
    showUpRate: Math.round(stats.reliability.rate * 100) / 100,
    weeklyGoal: goal,
    weeklyDone,
    streakWeeks,
    freezesLeft: Math.max(0, 1 - freezesThisWeek),
    dailyStreakOptIn: optIn,
    dailyXpCap: DAILY_CAP,
    xpToday: (todayTotal && todayTotal.total) || 0,
    categoryCounts: stats.all.categoryCounts,
    week,
    _stats: stats,
  };
}

// Active daily/weekly quests with server-evaluated state for this period.
async function questsFor(userId, { kind, stats, now = new Date(), session } = {}) {
  const { Quest, UserQuest } = require('../models');
  const s = stats || (await computeStats(userId, { now, session }));
  const filter = {
    active: true,
    kind: kind ? kind : { $in: ['daily', 'weekly'] },
    $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }],
  };
  const [quests, mine] = await Promise.all([
    sess(Quest.find(filter).sort({ kind: 1, xpReward: 1 }), session).lean(),
    sess(UserQuest.find({ userId }).select('questId periodKey state'), session).lean(),
  ]);
  return quests.map((quest) => {
    const period = periodKey(quest.kind, now);
    const ev = evaluateQuest(quest.criteria, s);
    const uq = mine.find((u) => u.questId === quest._id && u.periodKey === period);
    let state = 'available';
    if (uq && uq.state === 'claimed') state = 'claimed';
    else if (ev.done) state = 'completed';
    else if (ev.progress > 0 || (uq && uq.state === 'started')) state = 'started';
    return { quest, period, state, progress: ev.progress, total: ev.total };
  });
}

const stripStats = ({ _stats, ...rest }) => rest;

module.exports = { DAY_LABELS, addDays, completions, firstMet, reliability, computeStats, freezeDays, progressFor, questsFor, stripStats };
