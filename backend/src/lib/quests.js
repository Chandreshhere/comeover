'use strict';
// Server-side quest / achievement evaluation from verified activity stats.
// Stats are computed by the jobs worker from completed participations only.

// stats shape:
// { day: Window, week: Window, all: Window & { categoryCounts, reliability, plansConsidered } }
// Window = { completed, newPeople, newCategories, hostedCompleted, startHours: number[] }
function emptyWindow() {
  return { completed: 0, newPeople: 0, newCategories: 0, hostedCompleted: 0, startHours: [] };
}

function evaluateQuest(criteria, stats) {
  const c = criteria || {};
  const w = (stats && stats[c.window || 'all']) || emptyWindow();
  const all = (stats && stats.all) || { ...emptyWindow(), categoryCounts: {} };
  const total = Math.max(1, c.count || 1);
  let progress = 0;
  switch (c.type) {
    case 'complete_activities':
      progress = w.completed;
      break;
    case 'new_people':
      progress = w.newPeople;
      break;
    case 'new_category':
      progress = w.newCategories;
      break;
    case 'host_completed':
      progress = w.hostedCompleted;
      break;
    case 'early_activity':
      progress = (w.startHours || []).filter((h) => h < (c.beforeHour ?? 8)).length;
      break;
    case 'late_activity':
      progress = (w.startHours || []).filter((h) => h >= (c.afterHour ?? 21)).length;
      break;
    case 'category_completed':
      progress = (all.categoryCounts || {})[c.category] || 0;
      break;
    case 'distinct_categories':
      progress = Object.keys(all.categoryCounts || {}).length;
      break;
    case 'reliability':
      progress = (all.plansConsidered || 0) >= (c.minPlans || 0) && (all.reliability || 0) >= (c.min || 1) ? total : 0;
      break;
    default:
      progress = 0;
  }
  progress = Math.min(progress, total);
  return { progress, total, done: progress >= total };
}

// IST calendar helpers. Weeks run Sunday→Saturday to match the app's week strip.
function istDate(date = new Date()) {
  return new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

function weekStart(date = new Date()) {
  const ist = new Date(date.getTime() + 330 * 60000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

// Period key so daily/weekly quests reset.
function periodKey(kind, date = new Date()) {
  if (kind === 'daily') return `D${istDate(date)}`;
  if (kind === 'weekly') return `W${weekStart(date)}`;
  return 'all';
}

module.exports = { evaluateQuest, periodKey, emptyWindow, istDate, weekStart };
