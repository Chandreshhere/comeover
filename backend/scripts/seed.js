#!/usr/bin/env node
'use strict';
// Reference/taxonomy data only (no demo users or plans). Idempotent upserts.
//   npm run seed                                  (uses MONGODB_URI; resets seeded fields to these values)
//   node scripts/seed.js --only-missing           (adds missing entries only; never overwrites admin-console edits)
const db = require('../src/lib/db');

const CATEGORIES = [
  ['chai', 'Chai & coffee', 'Chai', 'chai', 'standard', 10],
  ['badminton', 'Badminton', 'Badminton', 'badminton', 'standard', 20],
  ['gym', 'Gym partner', 'Gym', 'gym', 'standard', 30],
  ['walk', 'Walks', 'Walk', 'walk', 'standard', 40],
  ['run', 'Running', 'Run', 'run', 'standard', 50],
  ['cowork', 'Coworking', 'Cowork', 'laptop', 'standard', 60],
  ['study', 'Study', 'Study', 'book', 'standard', 70],
  ['food', 'Food walks', 'Food', 'food', 'standard', 80],
  ['boardgames', 'Board games', 'Games', 'board', 'standard', 90],
  ['gaming', 'Gaming', 'Gaming', 'game', 'standard', 100],
  ['movies', 'Movies', 'Movies', 'film', 'standard', 110],
  ['music', 'Music & jams', 'Music', 'music', 'standard', 120],
  ['photo', 'Photography', 'Photo', 'camera', 'standard', 130],
  ['explore', 'City explore', 'Explore', 'pin', 'elevated', 140],
  ['thrifting', 'Thrifting', 'Thrift', 'thrift', 'standard', 150],
  // 18+ app; tobacco only. 'elevated' puts these plans in the moderators' flagged queue
  // for a look (like City explore) without blocking them.
  ['smoke', 'Smoke break', 'Smoke', 'smoke', 'elevated', 160],
].map(([slug, label, short, pictogram, riskLevel, sortOrder]) => ({ slug, label, short, pictogram, riskLevel, sortOrder }));

const LEVELS = [
  [1, 'Newcomer', 0, 'Welcome to Come Over', 'sparkle'],
  [2, 'First Hello', 40, 'Complete your first meetup', 'chat'],
  [3, 'Regular', 100, 'Keep showing up', 'check'],
  [4, 'Explorer', 160, 'Try different kinds of plans', 'pin'],
  [5, 'Connector', 300, 'Meet new people regularly', 'people'],
  [6, 'Host', 480, 'Host plans that happen', 'star'],
  [7, 'Circle Builder', 700, 'Grow a circle', 'board'],
  [8, 'Local Legend', 1000, '50 meetups · reliable host', 'sparkle'],
].map(([level, name, xpThreshold, subtitle, pictogram]) => ({ level, name, xpThreshold, subtitle, pictogram }));

// Quest criteria are evaluated server-side by src/lib/quests.js (evaluateQuest).
const QUESTS = [
  { slug: 'q_new_person', title: 'Chai with someone new', description: 'Complete 1 plan with a new person', criteria: { type: 'new_people', count: 1, window: 'day' }, xpReward: 40, kind: 'daily', pictogram: 'chai' },
  { slug: 'q_new_category', title: 'Explore a new category', description: 'Try something you have not done yet', criteria: { type: 'new_category', count: 1, window: 'week' }, xpReward: 60, kind: 'weekly', pictogram: 'sparkle' },
  { slug: 'q_weekly_goal', title: 'Weekly goal', description: '2 verified meetups this week', criteria: { type: 'complete_activities', count: 2, window: 'week' }, xpReward: 80, kind: 'weekly', pictogram: 'calendar' },
  { slug: 'q_host', title: 'Host a micro-plan', description: 'Host one plan that actually happens', criteria: { type: 'host_completed', count: 1, window: 'week' }, xpReward: 100, kind: 'weekly', pictogram: 'people' },
  { slug: 'q_early', title: 'Early bird', description: 'Join a plan that starts before 8 AM', criteria: { type: 'early_activity', count: 1, beforeHour: 8, window: 'day' }, xpReward: 30, kind: 'daily', pictogram: 'sun' },
];

const ACHIEVEMENTS = [
  { slug: 'b_chai', title: 'Chai Champ', description: 'Complete 3 chai plans', pictogram: 'chai', color: 'orange', criteria: { type: 'category_completed', category: 'chai', count: 3 } },
  { slug: 'b_early', title: 'Early Bird', description: 'Complete a plan starting before 7 AM', pictogram: 'sun', color: 'periwinkle', criteria: { type: 'early_activity', beforeHour: 7, count: 1, window: 'all' } },
  { slug: 'b_reliable', title: 'Reliable', description: '95%+ show-up across 10 plans', pictogram: 'shield', color: 'mint', criteria: { type: 'reliability', min: 0.95, minPlans: 10 } },
  { slug: 'b_court', title: 'Court Regular', description: 'Play badminton 5 times', pictogram: 'badminton', color: 'pink', criteria: { type: 'category_completed', category: 'badminton', count: 5 } },
  { slug: 'b_night', title: 'Night Owl', description: 'Complete 3 plans after 9 PM', pictogram: 'film', color: 'lavender', criteria: { type: 'late_activity', afterHour: 21, count: 3, window: 'all' } },
  { slug: 'b_trail', title: 'Trailblazer', description: 'Try 6 categories', pictogram: 'pin', color: 'orange', criteria: { type: 'distinct_categories', count: 6 } },
  { slug: 'b_host', title: 'Good Host', description: 'Host 3 completed plans with no cancellations', pictogram: 'people', color: 'periwinkle', criteria: { type: 'host_completed', count: 3, window: 'all' } },
];

// Ahmedabad pilot clusters (manual area selection when location is off). [name, lat, lng]
const AREAS = [
  ['Navrangpura', 23.037, 72.56],
  ['Bodakdev', 23.04, 72.507],
  ['Satellite', 23.027, 72.525],
  ['Vastrapur', 23.037, 72.529],
  ['Prahlad Nagar', 23.012, 72.509],
  ['SG Highway', 23.06, 72.507],
  ['Law Garden', 23.027, 72.56],
  ['Riverfront', 23.03, 72.577],
  ['Old City', 23.025, 72.588],
];

async function seed({ onlyMissing = false } = {}) {
  const { Category, Level, Quest, Achievement, CityArea } = require('../src/models');
  const write = onlyMissing ? '$setOnInsert' : '$set';
  const ops = async (Model, docs, key) =>
    (await Model.bulkWrite(docs.map((d) => ({ updateOne: { filter: key(d), update: { [write]: d }, upsert: true } })))).upsertedCount;
  const counts = {
    categories: await ops(Category, CATEGORIES, (d) => ({ slug: d.slug })),
    levels: await ops(Level, LEVELS, (d) => ({ level: d.level })),
    quests: await ops(Quest, QUESTS, (d) => ({ slug: d.slug })),
    achievements: await ops(Achievement, ACHIEVEMENTS, (d) => ({ slug: d.slug })),
  };
  counts.cityAreas = (
    await CityArea.bulkWrite(
      AREAS.map(([name, lat, lng]) => ({
        updateOne: {
          filter: { city: 'Ahmedabad', name },
          update: onlyMissing
            ? { $setOnInsert: { city: 'Ahmedabad', name, active: true, centroid: { type: 'Point', coordinates: [lng, lat] } } }
            : { $setOnInsert: { city: 'Ahmedabad', name, active: true }, $set: { centroid: { type: 'Point', coordinates: [lng, lat] } } },
          upsert: true,
        },
      }))
    )
  ).upsertedCount;
  return counts;
}

if (require.main === module) {
  (async () => {
    await db.connect();
    await db.syncIndexes();
    const onlyMissing = process.argv.includes('--only-missing');
    const counts = await seed({ onlyMissing });
    console.log(`Seed complete${onlyMissing ? ' (missing entries only)' : ''} (newly inserted): ${JSON.stringify(counts)}`);
    await db.disconnect();
  })().catch(async (e) => {
    console.error(e);
    await db.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { seed, CATEGORIES, LEVELS, QUESTS, ACHIEVEMENTS, AREAS };
