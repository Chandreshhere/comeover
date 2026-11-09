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

// Indore pilot clusters. [name, lat, lng]
const INDORE_AREAS = [
  ['Vijay Nagar', 22.7533, 75.8937],
  ['Palasia', 22.7244, 75.8839],
  ['Bhawarkua', 22.6927, 75.8679],
  ['Sapna Sangeeta', 22.7029, 75.8686],
  ['Rajwada', 22.7186, 75.8547],
];

// India's main cities, a few well-known neighbourhoods each. [name, lat, lng]
// Centroids are approximate neighbourhood centres (coarse discovery only);
// admins can correct or add areas in the console (Taxonomy, Areas).
const MORE_CITIES = {
  Mumbai: [['Bandra West', 19.0596, 72.8295], ['Andheri West', 19.1363, 72.8277], ['Powai', 19.1176, 72.906], ['Lower Parel', 18.995, 72.83], ['Colaba', 18.9067, 72.8147], ['Juhu', 19.1075, 72.8263], ['Malad West', 19.187, 72.84]],
  Delhi: [['Connaught Place', 28.6315, 77.2167], ['Hauz Khas', 28.5494, 77.2001], ['Saket', 28.5245, 77.2066], ['Lajpat Nagar', 28.5677, 77.2433], ['Rajouri Garden', 28.6415, 77.1209], ['North Campus', 28.688, 77.209], ['Dwarka', 28.5921, 77.046]],
  Gurugram: [['Cyber City', 28.495, 77.0895], ['Golf Course Road', 28.453, 77.099], ['Sector 29', 28.4687, 77.0631], ['Sohna Road', 28.412, 77.042]],
  Noida: [['Sector 18', 28.5708, 77.3261], ['Sector 62', 28.627, 77.365], ['Sector 137', 28.51, 77.408]],
  Bengaluru: [['Indiranagar', 12.9784, 77.6408], ['Koramangala', 12.9352, 77.6245], ['HSR Layout', 12.9116, 77.6474], ['Jayanagar', 12.9299, 77.5826], ['Whitefield', 12.9698, 77.75], ['Malleshwaram', 13.0031, 77.5643], ['MG Road', 12.9756, 77.605]],
  Hyderabad: [['Banjara Hills', 17.4126, 78.4482], ['Jubilee Hills', 17.4325, 78.4071], ['Gachibowli', 17.4401, 78.3489], ['HITEC City', 17.4435, 78.3772], ['Kondapur', 17.4692, 78.364], ['Secunderabad', 17.4399, 78.4983]],
  Chennai: [['T Nagar', 13.0418, 80.2341], ['Adyar', 13.0012, 80.2565], ['Anna Nagar', 13.085, 80.2101], ['Nungambakkam', 13.0569, 80.2425], ['Velachery', 12.9815, 80.218], ['Besant Nagar', 12.999, 80.266]],
  Kolkata: [['Park Street', 22.5535, 88.352], ['Salt Lake', 22.58, 88.415], ['New Town', 22.58, 88.47], ['Ballygunge', 22.528, 88.365], ['Jadavpur', 22.499, 88.371]],
  Pune: [['Koregaon Park', 18.5362, 73.894], ['Baner', 18.559, 73.7868], ['Kothrud', 18.5074, 73.8077], ['Viman Nagar', 18.5679, 73.9143], ['Hinjewadi', 18.5913, 73.7389], ['FC Road', 18.5236, 73.8411]],
  Surat: [['Adajan', 21.196, 72.793], ['Vesu', 21.142, 72.772], ['Athwa', 21.18, 72.81], ['Piplod', 21.159, 72.774]],
  Vadodara: [['Alkapuri', 22.311, 73.171], ['Akota', 22.296, 73.165], ['Fatehgunj', 22.324, 73.187]],
  Jaipur: [['C Scheme', 26.91, 75.8], ['Malviya Nagar', 26.853, 75.805], ['Vaishali Nagar', 26.911, 75.743], ['Raja Park', 26.896, 75.83], ['MI Road', 26.917, 75.812]],
  Lucknow: [['Hazratganj', 26.85, 80.946], ['Gomti Nagar', 26.85, 81.0], ['Aliganj', 26.893, 80.943], ['Indira Nagar', 26.879, 80.997]],
  Bhopal: [['MP Nagar', 23.233, 77.434], ['Arera Colony', 23.212, 77.432], ['New Market', 23.235, 77.401]],
  Chandigarh: [['Sector 17', 30.741, 76.782], ['Sector 35', 30.724, 76.759], ['Sector 8', 30.743, 76.799], ['Elante', 30.705, 76.801]],
  Kochi: [['Edappally', 10.0261, 76.3125], ['Kakkanad', 10.0159, 76.3419], ['Fort Kochi', 9.9658, 76.2421], ['Panampilly Nagar', 9.959, 76.296], ['MG Road', 9.971, 76.285]],
  Goa: [['Panaji', 15.4909, 73.8278], ['Calangute', 15.5439, 73.7553], ['Anjuna', 15.5733, 73.74], ['Margao', 15.2832, 73.9862]],
  Nagpur: [['Dharampeth', 21.14, 79.07], ['Sitabuldi', 21.146, 79.083], ['Sadar', 21.16, 79.08]],
  Coimbatore: [['RS Puram', 11.009, 76.95], ['Gandhipuram', 11.017, 76.966], ['Peelamedu', 11.03, 77.02]],
  Bhubaneswar: [['Saheed Nagar', 20.286, 85.844], ['Patia', 20.354, 85.819], ['Jaydev Vihar', 20.298, 85.818]],
  Visakhapatnam: [['Siripuram', 17.72, 83.317], ['MVP Colony', 17.74, 83.335], ['RK Beach', 17.714, 83.323]],
  Guwahati: [['Zoo Road', 26.172, 91.78], ['Paltan Bazaar', 26.181, 91.752], ['Ganeshguri', 26.15, 91.786]],
  Thiruvananthapuram: [['Kowdiar', 8.524, 76.96], ['Pattom', 8.524, 76.942], ['Technopark', 8.558, 76.881]],
};

// Every city's areas: [city, name, lat, lng].
const CITY_AREAS = [
  ...AREAS.map((a) => ['Ahmedabad', ...a]),
  ...INDORE_AREAS.map((a) => ['Indore', ...a]),
  ...Object.entries(MORE_CITIES).flatMap(([city, list]) => list.map((a) => [city, ...a])),
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
      CITY_AREAS.map(([city, name, lat, lng]) => ({
        updateOne: {
          filter: { city, name },
          update: onlyMissing
            ? { $setOnInsert: { city, name, active: true, centroid: { type: 'Point', coordinates: [lng, lat] } } }
            : { $setOnInsert: { city, name, active: true }, $set: { centroid: { type: 'Point', coordinates: [lng, lat] } } },
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

module.exports = { seed, CATEGORIES, LEVELS, QUESTS, ACHIEVEMENTS, AREAS, INDORE_AREAS, CITY_AREAS };
