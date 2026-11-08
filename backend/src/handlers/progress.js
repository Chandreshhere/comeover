'use strict';
// Quests, XP, levels/milestones, achievements, streaks. All derived server-side
// from verified completions; clients can only *claim* rewards the server computed.
const { err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { awardXp } = require('../lib/xp');
const { evaluateQuest, periodKey, istDate, weekStart } = require('../lib/quests');
const P = require('../lib/present');
const S = require('../services/progress');

const questOut = (x) => P.quest(x.quest, { progress: x.progress, total: x.total, state: x.state });

async function findQuest(id) {
  const { Quest } = require('../models');
  const key = String(id);
  const q = await Quest.findOne({ $or: [{ slug: key }, { _id: key }] }).lean();
  if (!q || !q.active) throw err.notFound('quest_not_found');
  return q;
}

async function milestonesFor(userId) {
  const { User, Level } = require('../models');
  const [user, levels] = await Promise.all([User.findById(userId).select('progress.xpTotal').lean(), Level.find({ level: { $gte: 2 } }).sort({ level: 1 }).lean()]);
  const xp = (user && user.progress && user.progress.xpTotal) || 0;
  let currentAssigned = false;
  return levels.map((l) => {
    let state = 'locked';
    if (xp >= l.xpThreshold) state = 'done';
    else if (!currentAssigned) {
      state = 'current';
      currentAssigned = true;
    }
    return { id: `level-${l.level}`, title: l.name, subtitle: l.subtitle || '', pictogram: l.pictogram || 'sparkle', state, progress: Math.min(xp, l.xpThreshold), total: l.xpThreshold, xp: l.xpThreshold };
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
      return `Finish ${n(left, 'plan')} that starts after ${(c.afterHour || 21) % 12 || 12} PM`;
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
  const { Achievement, UserAchievement } = require('../models');
  const [s, defs, earned] = await Promise.all([
    stats || S.computeStats(userId),
    Achievement.find({ active: true }).lean(),
    UserAchievement.find({ userId }).select('achievementId earnedAt evidence').lean(),
  ]);
  const mine = new Map(earned.map((e) => [e.achievementId, e]));
  const rows = defs.map((a) => ({ a, ua: mine.get(a._id) || null }));
  // Earned first (most recent first), then the rest by title.
  rows.sort((x, y) => {
    if (!!x.ua !== !!y.ua) return x.ua ? -1 : 1;
    if (x.ua && y.ua) return new Date(y.ua.earnedAt) - new Date(x.ua.earnedAt);
    return String(x.a.title).localeCompare(String(y.a.title));
  });
  return rows.map(({ a, ua }) => {
    const criteria = a.criteria || {};
    const ev = evaluateQuest(criteria, s);
    const left = Math.max(0, ev.total - ev.progress);
    return {
      id: a.slug,
      title: a.title,
      pictogram: a.pictogram || 'star',
      earned: !!ua,
      earnedAt: ua ? ua.earnedAt : null,
      progress: ua ? ev.total : ev.progress,
      total: ev.total,
      criteria: a.description,
      evidence: (ua && ua.evidence && ua.evidence.summary) || null,
      color: a.color,
      category: criteria.category || null,
      kind: criteria.type,
      hint: ua ? null : achievementHint(criteria, left),
    };
  });
}

const routes = {
  'GET /v1/me/progress': async (req) => {
    const user = await requireUser(req);
    return S.stripStats(await S.progressFor(user.id));
  },

  'GET /v1/quests/today': async (req) => {
    const user = await requireUser(req);
    const list = await S.questsFor(user.id);
    return { items: list.map(questOut), nextCursor: null };
  },

  'GET /v1/quests': async (req) => {
    const user = await requireUser(req);
    const { kind } = check({ kind: { type: 'string', enum: ['daily', 'weekly'] } }, req.query);
    const list = await S.questsFor(user.id, { kind });
    return { items: list.map(questOut), nextCursor: null };
  },

  'POST /v1/quests/{questId}/start': async (req) => {
    const user = await requireUser(req);
    const { UserQuest } = require('../models');
    const q = await findQuest(req.params.questId);
    const period = periodKey(q.kind);
    try {
      await UserQuest.updateOne({ userId: user.id, questId: q._id, periodKey: period }, { $setOnInsert: { state: 'started' } }, { upsert: true });
    } catch (e) {
      if (!e || e.code !== 11000) throw e; // raced with another insert — fine
    }
    await UserQuest.updateOne({ userId: user.id, questId: q._id, periodKey: period, state: 'available' }, { $set: { state: 'started' } });
    const list = await S.questsFor(user.id);
    const mine = list.find((x) => x.quest._id === q._id);
    if (!mine) throw err.notFound('quest_not_found');
    return questOut(mine);
  },

  'POST /v1/quests/{questId}/claim': async (req) => {
    const user = await requireUser(req);
    const { UserQuest } = require('../models');
    const q = await findQuest(req.params.questId);
    const period = periodKey(q.kind);
    const stats = await S.computeStats(user.id);
    const ev = evaluateQuest(q.criteria, stats);
    if (!ev.done) throw err.conflict('quest_not_complete', 'Finish the quest first — only verified meetups count.');
    const result = await db.withTransaction(async (session) => {
      const existing = await UserQuest.findOne({ userId: user.id, questId: q._id, periodKey: period }).session(session).lean();
      if (existing && existing.state === 'claimed') throw err.conflict('already_claimed');
      await UserQuest.updateOne(
        { userId: user.id, questId: q._id, periodKey: period },
        { $set: { state: 'claimed', progress: ev } },
        { upsert: true, session }
      );
      return awardXp(session, { userId: user.id, eventType: 'quest_claimed', refId: `${q.slug}:${period}`, base: q.xpReward });
    });
    const progress = S.stripStats(await S.progressFor(user.id));
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
    const progress = await S.progressFor(user.id);
    const [milestones, achievements] = await Promise.all([milestonesFor(user.id), achievementsFor(user.id, progress._stats)]);
    return { level: progress.level, xp: progress.xp, milestones, achievements, categoryCounts: progress.categoryCounts };
  },

  'GET /v1/me/streak-calendar': async (req) => {
    const user = await requireUser(req);
    const { months } = check({ months: { type: 'integer', min: 1, max: 12, default: 3 } }, req.query);
    const progress = await S.progressFor(user.id);
    const freezes = new Set(await S.freezeDays(user.id));
    const today = istDate();
    const start = weekStart(new Date(Date.now() - months * 30 * 86400000));
    const end = S.addDays(weekStart(), 6);
    const days = [];
    for (let d = start; d <= end; d = S.addDays(d, 1)) {
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
    const { StreakFreeze } = require('../models');
    const { day } = check({ day: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ } }, req.body);
    const progress = await S.progressFor(user.id);
    if (progress.freezesLeft < 1) throw err.conflict('no_freezes_left', 'One freeze per week — it refills on Sunday.');
    const candidates = progress.week.filter((d) => d.state === 'missed' || d.state === 'rest');
    const target = day ? candidates.find((d) => d.date === day) : candidates[candidates.length - 1];
    if (!target) throw err.conflict('nothing_to_freeze', 'There is no missed day this week to protect.');
    try {
      await StreakFreeze.create({ userId: user.id, day: target.date });
    } catch (e) {
      if (!e || e.code !== 11000) throw e;
    }
    return S.stripStats(await S.progressFor(user.id));
  },
};

// quest_evaluate job: mark completed quests (notify once) and award earned badges.
async function runQuestEvaluate({ userId }) {
  if (!userId) return;
  const { UserQuest, Achievement, UserAchievement } = require('../models');
  const { notify } = require('../lib/notify');
  const stats = await S.computeStats(userId);
  const quests = await S.questsFor(userId, { stats });
  await db.withTransaction(async (session, after) => {
    for (const q of quests) {
      if (q.state !== 'completed') continue;
      const filter = { userId, questId: q.quest._id, periodKey: q.period };
      const progress = { progress: q.progress, total: q.total };
      const existing = await UserQuest.findOne(filter).session(session).lean();
      let changed = false;
      if (!existing) {
        await UserQuest.create([{ ...filter, state: 'completed', progress }], { session });
        changed = true;
      } else if (existing.state === 'available' || existing.state === 'started') {
        await UserQuest.updateOne({ _id: existing._id }, { $set: { state: 'completed', progress } }, { session });
        changed = true;
      }
      if (changed) {
        await notify(session, after, userId, {
          type: 'quest',
          title: `Quest complete: ${q.quest.title}`,
          body: `Claim +${q.quest.xpReward} XP on your roadmap.`,
          data: { questId: q.quest.slug, target: { screen: 'social_roadmap', params: {} } },
        });
      }
    }
    const earnedIds = (await UserAchievement.find({ userId }).select('achievementId').session(session).lean()).map((e) => e.achievementId);
    const pending = await Achievement.find({ active: true, _id: { $nin: earnedIds } }).session(session).lean();
    for (const a of pending) {
      const c = a.criteria || {};
      const ev = evaluateQuest(c, stats);
      if (!ev.done) continue;
      const summary =
        c.type === 'category_completed'
          ? `${ev.total} verified ${c.category} plans`
          : c.type === 'reliability'
            ? `${Math.round(stats.reliability.rate * 100)}% show-up across ${stats.reliability.plans} plans`
            : `${ev.total} verified meetups`;
      const r = await UserAchievement.updateOne(
        { userId, achievementId: a._id },
        { $setOnInsert: { earnedAt: new Date(), evidence: { summary, period: periodKey('daily') } } },
        { upsert: true, session }
      );
      if (!r.upsertedCount) continue; // already earned (raced)
      await notify(session, after, userId, {
        type: 'quest',
        title: `Badge earned: ${a.title}`,
        body: a.description,
        data: { achievementId: a.slug, target: { screen: 'achievement_detail', params: { id: a.slug } } },
      });
    }
  });
}

module.exports = { routes, milestonesFor, achievementsFor, achievementHint, runQuestEvaluate };
