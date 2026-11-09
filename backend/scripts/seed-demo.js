#!/usr/bin/env node
'use strict';
// Demo / test data for Project IRL (mobile app + admin console).
//
//   node --env-file=.env scripts/seed-demo.js                          seed (idempotent)
//   node --env-file=.env scripts/seed-demo.js --reset                  remove all demo data
//   node --env-file=.env scripts/seed-demo.js --test-user-owns-venue   also give the test user a verified venue
//   npm run seed:demo / npm run seed:demo:reset
//
// What it creates (all relative to "now", so the feed always looks live):
//   14 demo users (fake +910000000001..14 phones: invalid Indian numbers, they can never receive SMS),
//   ~34 plans (live now, tonight, tomorrow, weekend, full + waitlist, sponsored, circle-only, invite-only,
//   flagged for review, cancelled, completed history across the last 30 days), join requests, group chats,
//   5 circles + a challenge, SplitMate expenses, notifications, XP / quests / badges, reports + appeals,
//   audit log, subscriptions, venues, campaigns, metrics and invoices.
//   The test account (the phone in SEED_TEST_PHONE / TEST_LOGIN_PHONE) gets a completed profile + progress
//   and is wired into all of it.
//
// IDS: every demo document has a deterministic id of the form de30de30-xxxx-8xxx-[89ab]xxx-xxxxxxxxxxxx
// ("de30" = "demo" in hex). The API validates many ids as UUIDs (block, report, split, direct chat…), so
// a literal "demo_" prefix would break those flows. Version nibble 8 never occurs in the random v4 ids the
// app generates, so --reset can never touch real data.
const crypto = require('crypto');
const db = require('../src/lib/db');
const { cellId } = require('../src/lib/geo');
const { levelForXp, DAILY_CAP, istDay } = require('../src/lib/xp');
const { computeShares } = require('../src/lib/split');
const { periodKey, weekStart } = require('../src/lib/quests');
const { AREAS, LEVELS, QUESTS, ACHIEVEMENTS, CATEGORIES } = require('./seed');

const models = () => require('../src/models');

// The account that gets the completed demo profile. NEVER put a real number in the repo: set
// SEED_TEST_PHONE (or TEST_LOGIN_PHONE) in backend/.env. The defaults below are fake values used by tests.
const { normalizePhone, maskPhone } = require('../src/lib/phone');
const FAKE_TEST_PHONE = '+919123456780';
const TEST_PHONE = process.env.SEED_TEST_PHONE || process.env.TEST_LOGIN_PHONE ? normalizePhone(process.env.SEED_TEST_PHONE || process.env.TEST_LOGIN_PHONE) : FAKE_TEST_PHONE;
// Only used when the account does not exist yet; an existing account keeps its own id (looked up by phone).
const TEST_USER_ID = '7e570000-0000-4000-8000-000000000001';
const DEMO_ID_RE = /^de30de30-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const IST_MS = 330 * MIN;
const IN_GROUP = ['accepted', 'checked_in', 'completed'];

// ---------------------------------------------------------------------------
// Deterministic ids and pseudo-randomness (no Math.random: same input → same data).
function did(kind, key) {
  const h = crypto.createHash('sha1').update(`irl-demo:${kind}:${key}`).digest('hex');
  return `de30de30-${h.slice(0, 4)}-8${h.slice(4, 7)}-${'89ab'[parseInt(h[7], 16) % 4]}${h.slice(8, 11)}-${h.slice(11, 23)}`;
}
const h01 = (s) => parseInt(crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16) / 0xffffffff;
const pick = (arr, key) => arr[Math.floor(h01(key) * arr.length) % arr.length];
const isDemoId = (id) => typeof id === 'string' && DEMO_ID_RE.test(id);

// ---------------------------------------------------------------------------
// Time helpers (IST calendar maths relative to `now`).
function timeHelpers(now) {
  const nowMs = now.getTime();
  const istMidnight = (offsetDays = 0) => {
    const ist = new Date(nowMs + IST_MS);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + offsetDays) - IST_MS);
  };
  const at = (offsetDays, h, m = 0) => new Date(istMidnight(offsetDays).getTime() + (h * 60 + m) * MIN);
  const ago = (ms) => new Date(nowMs - ms);
  const ahead = (ms) => new Date(nowMs + ms);
  const tonightOrTomorrow = (h, m = 0) => {
    const t = at(0, h, m);
    return t.getTime() > nowMs + 20 * MIN ? t : at(1, h, m);
  };
  const dowOf = (offsetDays) => new Date(istMidnight(offsetDays).getTime() + IST_MS).getUTCDay();
  const nextDow = (dow, h, m = 0) => {
    for (let d = 1; d <= 7; d += 1) if (dowOf(d) === dow) return at(d, h, m);
    return at(1, h, m);
  };
  // `dayInWeek` 0=Sunday … 6=Saturday, `weeksBack` ≥ 1 → a day in an earlier IST calendar week.
  const inPastWeek = (weeksBack, dayInWeek, h, m = 0) => {
    const ws = Date.parse(`${weekStart(now)}T00:00:00Z`) - IST_MS; // IST midnight of this week's Sunday
    return new Date(ws - weeksBack * 7 * DAY + dayInWeek * DAY + (h * 60 + m) * MIN);
  };
  const dayStr = (d) => istDay(d);
  return { nowMs, istMidnight, at, ago, ahead, tonightOrTomorrow, nextDow, inPastWeek, dayStr };
}

// ---------------------------------------------------------------------------
// Static content.
const AREA = Object.fromEntries(AREAS.map(([name, lat, lng]) => [name, { lat, lng }]));
const near = (area, key, spread = 0.0035) => {
  const a = AREA[area] || AREA.Navrangpura;
  return { lat: Math.round((a.lat + (h01(`${key}:lat`) - 0.5) * 2 * spread) * 1e5) / 1e5, lng: Math.round((a.lng + (h01(`${key}:lng`) - 0.5) * 2 * spread) * 1e5) / 1e5 };
};

// key, name, area, interests, intent, availability, reliability, joined (days ago), last active (days ago), bio, status
const USERS = [
  ['aarav', 'Aarav', 'Navrangpura', ['chai', 'cowork', 'study'], 'chai', 'now', 0.97, 30, 0.2, 'Chai first, plans later. Product designer by day.'],
  ['diya', 'Diya', 'Bodakdev', ['badminton', 'run', 'gym'], 'badminton', 'later', 0.94, 29, 0.4, 'Doubles specialist. Shuttles in my bag, always.'],
  ['kabir', 'Kabir', 'Satellite', ['gym', 'run', 'cowork'], 'gym', 'now', 0.9, 27, 1.1, 'Lifting, running, repeating. Early mornings.'],
  ['meera', 'Meera', 'Riverfront', ['walk', 'photo', 'explore'], 'walk', 'later', 0.98, 25, 0.3, 'Slow walks, fast chai, phone photography.'],
  ['rohan', 'Rohan', 'SG Highway', ['movies', 'gaming', 'boardgames'], 'gaming', 'now', 0.88, 23, 0.6, 'Games, movies, and arguing about both.'],
  ['yash', 'Yash', 'Satellite', ['gaming', 'movies'], 'movies', 'busy', 0.62, 21, 5, 'Movies and late nights.', 'limited'],
  ['ishita', 'Ishita', 'Vastrapur', ['boardgames', 'food', 'music'], 'boardgames', 'later', 0.96, 20, 0.8, 'Board-game café regular. I teach rules patiently.'],
  ['vikram', 'Vikram', 'Bodakdev', ['badminton', 'gym'], 'badminton', 'now', 0.92, 18, 0.5, 'Intermediate badminton, happy to rotate partners.'],
  ['tara', 'Tara', 'Riverfront', ['explore', 'music'], 'explore', 'busy', 0.55, 17, 8, 'New in town.', 'suspended'],
  ['anaya', 'Anaya', 'Law Garden', ['photo', 'walk', 'music'], 'photo', 'later', 0.95, 15, 2, 'Golden-hour walks with a camera.'],
  ['saanvi', 'Saanvi', 'Vastrapur', ['run', 'walk', 'food'], 'run', 'later', 0.99, 12, 0.2, 'Easy-pace runs. Nobody gets left behind.'],
  ['kavya', 'Kavya', 'Navrangpura', ['study', 'chai', 'cowork'], 'study', 'now', 0.93, 6, 0.4, 'Study sessions with good chai.'],
  ['arjun', 'Arjun', 'Prahlad Nagar', ['cowork', 'gaming'], 'cowork', 'now', 0.91, 5, 1.5, 'Heads-down work blocks, then a game.'],
  ['dev', 'Dev', 'Old City', ['food', 'explore', 'music'], 'food', 'busy', 0.89, 3, 3, 'Street-food trails and heritage walks.'],
];

// Social energy (introvert / ambivert / extrovert) — a mix so the ranking is visible; some never answered.
const DEMO_STYLES = { aarav: 'introvert', diya: 'extrovert', kabir: 'ambivert', meera: 'introvert', rohan: 'extrovert', ishita: 'ambivert', vikram: 'extrovert', anaya: 'introvert', saanvi: 'ambivert', kavya: 'introvert', arjun: 'ambivert', dev: 'extrovert' };

const BASE_VENUES = {
  chaihouse: { name: 'Sabarmati Chai House', area: 'Navrangpura', type: 'Public café', cats: ['chai', 'cowork', 'study'], biz: 'biz2', verified: true, address: 'Ground floor, near the CG Road junction, Navrangpura', desc: 'Quiet corner café with long shared tables, plenty of power sockets and unlimited refills of masala chai.', offer: { title: '10% off for Come Over groups of 3 or more', terms: 'Show the plan in the app at the counter. Valid Mon–Thu.' } },
  roast: { name: 'Riverside Roast', area: 'Riverfront', type: 'Public café', cats: ['chai', 'photo', 'walk', 'music'], biz: 'biz1', verified: true, address: 'Promenade level, Riverfront east, Ahmedabad', desc: 'Open-air café on the promenade. Good light for photos, better filter coffee.', offer: { title: 'Free cookie with every chai flight', terms: 'One per person. Show your Come Over plan.' } },
  dice: { name: 'Dice & Dough', area: 'Vastrapur', type: 'Board-game café', cats: ['boardgames', 'gaming', 'food'], biz: 'biz1', verified: true, address: 'First floor, Vastrapur, Ahmedabad', desc: 'Two hundred board games, thin-crust pizza and staff who will teach you Catan again.', offer: { title: '₹100 off the table fee for groups of 4+', terms: 'Weekdays before 6 PM.' } },
  court7: { name: 'Court 7 Sports Hub', area: 'Bodakdev', type: 'Sports court', cats: ['badminton', 'gym', 'run'], biz: 'biz2', verified: true, address: 'Bodakdev, Ahmedabad (sports complex)', desc: 'Six wooden badminton courts, a small gym and a running track.', offer: { title: 'First hour free for new Come Over members', terms: 'One redemption per member.' } },
  haveli: { name: 'Old City Heritage Café', area: 'Old City', type: 'Public café', cats: ['food', 'explore', 'photo'], biz: 'biz3', verified: false, address: 'Pol area, Old City, Ahmedabad', desc: 'Courtyard café in a restored haveli. Awaiting verification.', offer: null },
};

const CAT_TITLE = {
  chai: 'Chai & chatter', badminton: 'Badminton doubles', gym: 'Gym partner session', walk: 'Evening walk', run: 'Easy run', cowork: 'Coworking sprint',
  study: 'Study together', food: 'Street food hop', boardgames: 'Board games night', gaming: 'Gaming session', movies: 'Movie meetup', music: 'Acoustic jam',
  photo: 'Photo walk', explore: 'City explore',
};

// ---------------------------------------------------------------------------
// Dataset
function buildDataset({ now = new Date(), testUserOwnsVenue = false, tax, meId = TEST_USER_ID }) {
  const M = models();
  const T = timeHelpers(now);
  const VENUES = JSON.parse(JSON.stringify(BASE_VENUES)); // local copy: coordinates / the optional test-owner venue are per call
  const items = [];
  const ids = { user: {}, activity: {}, venue: {}, business: {}, campaign: {}, circle: {}, conversation: {}, report: {}, expense: {}, message: {}, notification: {} };

  const add = (model, doc, key = null) => {
    const schema = M[model].schema;
    if (schema.path('createdAt') && !doc.createdAt) doc.createdAt = now;
    if (schema.path('updatedAt') && !doc.updatedAt) doc.updatedAt = doc.createdAt || now;
    items.push({ model, doc, key });
    return doc;
  };

  const ME = meId;
  USERS.forEach(([k]) => {
    ids.user[k] = did('user', k);
  });
  ids.user.ME = ME;
  const U = (k) => ids.user[k];

  // ---- venues / businesses ------------------------------------------------
  const BIZ = {
    biz1: { name: 'Riverside & Dice Hospitality (demo)', kind: 'venue', owner: 'ishita', status: 'verified', plan: 'venue', email: 'ops@riverside-demo.example', contact: 'Ishita', phone: '+910000000101', age: 28 },
    biz2: { name: 'Bodakdev Sports & Cafés (demo)', kind: 'club', owner: 'vikram', status: 'verified', plan: null, email: 'hello@bodakdev-demo.example', contact: 'Vikram', phone: '+910000000102', age: 20 },
    biz3: { name: 'Heritage Hospitality (demo)', kind: 'venue', owner: 'dev', status: 'pending', plan: null, email: 'dev@heritage-demo.example', contact: 'Dev', phone: '+910000000103', age: 2 },
  };
  Object.entries(BIZ).forEach(([k, b]) => {
    ids.business[k] = did('business', k);
    add('BusinessProfile', {
      _id: ids.business[k],
      ownerUserId: U(b.owner),
      name: b.name,
      kind: b.kind,
      verificationStatus: b.status,
      contactEmail: b.email,
      contactName: b.contact,
      contactPhone: b.phone,
      gstin: null,
      verificationDocKey: null,
      reviewNote: b.status === 'verified' ? 'Verified: public venue, owner ID checked.' : null,
      planId: b.plan,
      agreements: { labels: true, noGuarantee: true, terms: true },
      staff: [{ userId: U(b.owner), role: 'owner' }],
      createdAt: T.ago(b.age * DAY),
    });
  });
  if (testUserOwnsVenue) {
    ids.business.bizT = did('business', 'bizT');
    add('BusinessProfile', {
      _id: ids.business.bizT,
      ownerUserId: ME,
      name: 'Moon Cowork Rooms (demo)',
      kind: 'venue',
      verificationStatus: 'verified',
      contactEmail: 'chandresh@moon-demo.example',
      contactName: 'Chandresh',
      contactPhone: '+910000000104',
      reviewNote: 'Verified (demo).',
      planId: 'venue',
      agreements: { labels: true, noGuarantee: true, terms: true },
      staff: [{ userId: ME, role: 'owner' }],
      createdAt: T.ago(10 * DAY),
    });
    VENUES.moon = { name: 'The Cowork Chai Room', area: 'Navrangpura', type: 'Public café', cats: ['cowork', 'chai', 'study'], biz: 'bizT', verified: true, address: 'Navrangpura, Ahmedabad', desc: 'Day-pass coworking tables inside a café. Demo venue owned by the test account.', offer: { title: 'Free chai refill for Come Over coworking groups', terms: 'Groups of 3+.' } };
  }
  Object.entries(VENUES).forEach(([k, v]) => {
    const c = near(v.area, `venue:${k}`, 0.0025);
    ids.venue[k] = did('venue', k);
    v.lat = c.lat;
    v.lng = c.lng;
    add('Venue', {
      _id: ids.venue[k],
      businessId: ids.business[v.biz],
      name: v.name,
      address: v.address,
      area: v.area,
      latitude: c.lat,
      longitude: c.lng,
      venueType: v.type,
      categorySlugs: v.cats,
      description: v.desc,
      isPublicPlace: true,
      bookingUrl: `https://example.com/venues/${k}`,
      offers: v.offer ? [v.offer] : [],
      verified: v.verified,
      createdAt: T.ago(((BIZ[v.biz] || { age: 10 }).age - 1) * DAY),
    });
  });

  // ---- plans ---------------------------------------------------------------
  const plans = new Map();
  const campA = did('campaign', 'campA');
  const campB = did('campaign', 'campB');
  const campC = did('campaign', 'campC');
  ids.campaign = { campA, campB, campC };
  const circleIds = {};
  ['navchai', 'runners', 'badminton', 'boardgames', 'cowork'].forEach((k) => {
    circleIds[k] = did('circle', k);
  });
  ids.circle = circleIds;

  // row: { u, state, intro, req (minutes after plan creation) , dec (minutes after request), pos }
  function addPlan(s) {
    const id = did('activity', s.key);
    ids.activity[s.key] = id;
    const venue = s.venue ? VENUES[s.venue] : null;
    const area = s.area || (venue && venue.area) || 'Navrangpura';
    const c = venue ? { lat: venue.lat, lng: venue.lng } : near(area, `plan:${s.key}`);
    const start = s.start;
    const end = new Date(start.getTime() + s.dur * MIN);
    const createdAt = s.createdAt || T.ago((s.createdHoursAgo == null ? 20 : s.createdHoursAgo) * HOUR);
    const rows = s.rows || [];
    const acceptedCount = s.status === 'cancelled' ? 1 : 1 + rows.filter((r) => IN_GROUP.includes(r.state)).length;
    const waitlist = rows.filter((r) => r.state === 'waitlisted');
    const status = s.status || (acceptedCount >= s.cap ? 'full' : 'open');
    const completedAt = s.completedAt || null;
    const nowMs = now.getTime();
    plans.set(s.key, { ...s, id, rows, start, end, createdAt, status, completedAt });
    add('Activity', {
      _id: id,
      hostUserId: U(s.host),
      category: s.cat,
      title: s.title,
      description: s.desc,
      startsAt: start,
      endsAt: end,
      capacity: s.cap,
      visibility: s.visibility || 'public',
      venueName: s.venueName || (venue ? venue.name : null),
      venueType: s.venueType || (venue ? venue.type : 'Public area'),
      venueId: venue ? ids.venue[s.venue] : null,
      coarseArea: area,
      latitude: c.lat,
      longitude: c.lng,
      exactLocationVisibleAfterAccept: true,
      status,
      joinRule: s.rule || 'approval',
      costNote: s.cost || 'Free',
      tags: s.tags || [],
      accessibilityNotes: s.access || null,
      activityLevel: s.level || 'any',
      circleId: s.circle ? circleIds[s.circle] : null,
      sponsoredCampaignId: s.sponsored ? campA : null,
      acceptedCount,
      waitlistCount: status === 'cancelled' ? 0 : waitlist.length,
      nextWaitlistPosition: waitlist.length ? Math.max(...waitlist.map((r) => r.pos || 1)) + 1 : 1,
      completedAt,
      cancelledAt: status === 'cancelled' ? s.cancelledAt || T.ago(3 * HOUR) : null,
      cancelReason: status === 'cancelled' ? s.cancelReason || 'Host unwell' : null,
      moderationNote: null,
      review: { status: s.review ? 'flagged' : 'none', flags: s.review || [], reviewedBy: null, reviewedAt: null },
      createdAt,
      updatedAt: completedAt || createdAt,
    });
    // host row
    const hostDone = status === 'completed';
    add('Participant', {
      _id: did('part', `${s.key}:host`),
      activityId: id,
      userId: U(s.host),
      state: hostDone ? 'completed' : 'accepted',
      requestedAt: createdAt,
      decidedAt: createdAt,
      checkedInAt: null,
      checkInMethod: hostDone ? 'host' : null,
      completionConfirmedAt: hostDone ? completedAt : null,
    }, { activityId: id, userId: U(s.host) });
    rows.forEach((r, i) => {
      const requestedAt = r.reqAt || new Date(Math.min(createdAt.getTime() + (r.req == null ? 10 + i * 17 : r.req) * MIN, nowMs - MIN));
      const decided = ['accepted', 'checked_in', 'completed', 'no_show', 'declined', 'cancelled'].includes(r.state);
      const decidedAt = decided ? new Date(Math.min(requestedAt.getTime() + (r.dec == null ? 6 + i * 5 : r.dec) * MIN, nowMs - MIN)) : null;
      const done = r.state === 'completed';
      add('Participant', {
        _id: did('part', `${s.key}:${r.u}`),
        activityId: id,
        userId: U(r.u),
        state: r.state,
        intro: r.intro || null,
        waitlistPosition: r.state === 'waitlisted' ? r.pos : null,
        requestedAt,
        decidedAt,
        decidedBy: decided ? U(s.host) : null,
        checkedInAt: done ? completedAt : null,
        checkInMethod: done ? 'proximity' : null,
        completionConfirmedAt: done ? completedAt : null,
      }, { activityId: id, userId: U(r.u) });
    });
  }

  const eve = (h, m = 0) => T.tonightOrTomorrow(h, m);
  const soon = (mins) => T.ahead(mins * MIN);

  // --- live / upcoming feed plans
  addPlan({ key: 'chai_now', host: 'aarav', cat: 'chai', title: 'Chai break near you', desc: 'Quick chai between meetings. Low-key, no agenda: just good conversation and maybe a bun maska.', start: soon(25), dur: 45, cap: 4, venue: 'chaihouse', tags: ['low-key', 'quick'], cost: 'Pay for your own chai (~₹40)', access: 'Step-free entrance', createdHoursAgo: 5,
    rows: [{ u: 'diya', state: 'accepted' }, { u: 'ME', state: 'requested', intro: 'Working from a café nearby, would love to join for a quick chai!', reqAt: T.ago(35 * MIN) }] });
  addPlan({ key: 'walk_quick', host: 'meera', cat: 'walk', title: 'Quick 20-min walk + chai', desc: 'Stretch your legs for 20 minutes. Chai from the tapri, short loop, back to work.', start: soon(10), dur: 20, cap: 3, rule: 'instant', area: 'Navrangpura', venueName: 'Public area near the university gate', tags: ['micro-plan'], createdHoursAgo: 3,
    rows: [{ u: 'kavya', state: 'accepted' }] });
  addPlan({ key: 'cowork_sprint', host: 'arjun', cat: 'cowork', title: 'Coworking sprint (2 hrs)', desc: 'Heads-down focus blocks: 50 min work, 10 min chat. Laptops welcome.', start: soon(40), dur: 120, cap: 5, rule: 'instant', area: 'Prahlad Nagar', venueName: 'Café with Wi-Fi, 100 Ft Road', venueType: 'Public café', tags: ['focus', 'quiet'], cost: 'Buy one drink', createdHoursAgo: 6,
    rows: [{ u: 'rohan', state: 'accepted' }, { u: 'dev', state: 'accepted' }] });
  addPlan({ key: 'badminton_eve', host: 'vikram', cat: 'badminton', title: 'Evening badminton doubles', desc: 'Friendly doubles, intermediate level. Bring your own racquet; shuttles are covered.', start: eve(19), dur: 90, cap: 4, venue: 'court7', level: 'intermediate', tags: ['intermediate', 'sport'], cost: 'Court split ~₹200 each', createdHoursAgo: 30,
    rows: [{ u: 'diya', state: 'accepted' }, { u: 'ME', state: 'accepted' }] });
  addPlan({ key: 'run_soon', host: 'saanvi', cat: 'run', title: 'Easy riverfront jog (5K)', desc: 'Conversational pace (6:30–7:00/km). All levels; nobody gets left behind. Meet at the promenade gate.', start: soon(25), dur: 45, cap: 8, rule: 'instant', area: 'Riverfront', venueName: 'Riverfront east promenade gate', venueType: 'Public park', level: 'beginner', tags: ['outdoors', 'all levels'], createdHoursAgo: 8,
    rows: [{ u: 'meera', state: 'accepted' }, { u: 'anaya', state: 'accepted' }, { u: 'ME', state: 'accepted' }, { u: 'kabir', state: 'accepted' }, { u: 'kavya', state: 'accepted' }] });
  addPlan({ key: 'host_cowork', host: 'ME', cat: 'cowork', title: 'Coworking morning at the café', desc: 'Laptops open, headphones optional. Chat at the breaks, quiet the rest of the time.', start: T.at(1, 10), dur: 150, cap: 5, venue: testUserOwnsVenue ? 'moon' : 'chaihouse', tags: ['focus', 'friendly'], cost: 'Buy one drink', access: 'Step-free entrance, sockets at every table', createdHoursAgo: 20,
    rows: [
      { u: 'kavya', state: 'accepted' },
      { u: 'rohan', state: 'requested', intro: 'Working on a design project, can bring my own charger!', reqAt: T.ago(40 * MIN) },
      { u: 'ishita', state: 'requested', intro: 'New to the area, would love some company while I work.', reqAt: T.ago(38 * MIN) },
    ] });
  addPlan({ key: 'boardgames_night', host: 'ishita', cat: 'boardgames', title: 'Board game night at Dice & Dough', desc: 'Catan, Codenames and new-player-friendly games. The venue offers a discount for Come Over groups.', start: eve(20), dur: 150, cap: 8, venue: 'dice', sponsored: true, tags: ['beginner-friendly', 'indoors'], cost: '₹150 table fee (venue)', level: 'beginner', createdHoursAgo: 40,
    rows: [{ u: 'rohan', state: 'accepted' }, { u: 'dev', state: 'accepted' }, { u: 'arjun', state: 'accepted' }, { u: 'kabir', state: 'accepted' }, { u: 'anaya', state: 'accepted' }] });
  addPlan({ key: 'waitlist_full', host: 'rohan', cat: 'gaming', title: 'FIFA night: 2v2 tournament', desc: 'Casual 2v2. Losers buy nothing; winners get bragging rights.', start: T.at(2, 21), dur: 150, cap: 4, area: 'Satellite', venueName: 'Gaming lounge, Satellite', venueType: 'Gaming lounge', tags: ['indoors', 'night'], cost: '₹200/hr per station (venue)', createdHoursAgo: 44,
    rows: [{ u: 'arjun', state: 'accepted' }, { u: 'dev', state: 'accepted' }, { u: 'aarav', state: 'accepted' }, { u: 'ME', state: 'waitlisted', pos: 1 }, { u: 'kavya', state: 'waitlisted', pos: 2 }] });
  addPlan({ key: 'tomorrow_run', host: 'saanvi', cat: 'run', title: '5K easy run: Sunrise Runners', desc: 'Members-only group run. Conversational pace; reflective gear before 6:30 AM.', start: T.at(1, 6), dur: 60, cap: 12, visibility: 'circle', circle: 'runners', area: 'Vastrapur', venueName: 'Vastrapur Lake main gate', venueType: 'Public park', tags: ['outdoors', 'circle'], createdHoursAgo: 30,
    rows: [{ u: 'kabir', state: 'accepted' }, { u: 'diya', state: 'accepted' }, { u: 'meera', state: 'accepted' }] });
  addPlan({ key: 'invite_only_dinner', host: 'anaya', cat: 'food', title: 'Dinner club (invite only)', desc: 'Small invite-only dinner for regulars.', start: T.at(3, 20), dur: 120, cap: 6, visibility: 'invite_only', area: 'Law Garden', venueName: 'Garden restaurant, Law Garden', venueType: 'Restaurant', tags: ['invite-only'], createdHoursAgo: 28,
    rows: [{ u: 'meera', state: 'accepted' }, { u: 'dev', state: 'accepted' }] });
  addPlan({ key: 'weekend_food_walk', host: 'dev', cat: 'food', title: 'Street food crawl: Old City', desc: 'Pav bhaji, chocolate sandwich, kulfi. Split the bill on SplitMate after.', start: T.nextDow(6, 20), dur: 120, cap: 6, area: 'Old City', venueName: 'Manek Chowk', venueType: 'Public market', tags: ['food', 'weekend'], cost: 'Pay as you eat (~₹300)', createdHoursAgo: 50,
    rows: [{ u: 'meera', state: 'accepted' }, { u: 'ishita', state: 'accepted' }, { u: 'anaya', state: 'accepted' }] });
  addPlan({ key: 'weekend_photo', host: 'anaya', cat: 'photo', title: 'Photo walk: Law Garden', desc: 'Golden-hour street photography. Phone cameras totally fine.', start: T.nextDow(0, 7), dur: 90, cap: 5, area: 'Law Garden', venueName: 'Law Garden main entrance', venueType: 'Public park', tags: ['creative', 'weekend'], createdHoursAgo: 36,
    rows: [{ u: 'meera', state: 'accepted' }] });
  addPlan({ key: 'gym_push', host: 'kabir', cat: 'gym', title: 'Gym partner: push day', desc: 'Chest, shoulders, triceps. Spotting each other, steady pace.', start: T.at(1, 7), dur: 60, cap: 2, area: 'Satellite', venueName: 'Gym on Satellite Road', venueType: 'Gym', tags: ['fitness'], cost: 'Own membership or day pass', createdHoursAgo: 14, rows: [] });
  // --- flagged for review
  addPlan({ key: 'movie_night', host: 'yash', cat: 'movies', title: 'Late show movie buddies', desc: 'Catching the late show. Book your own seat in the same row; we meet at the lobby.', start: eve(21, 30), dur: 150, cap: 4, area: 'SG Highway', venueName: 'Multiplex, SG Highway', venueType: 'Cinema', tags: ['night'], cost: 'Own ticket (~₹250)', createdHoursAgo: 26,
    rows: [{ u: 'rohan', state: 'accepted' }, { u: 'kabir', state: 'accepted' }, { u: 'anaya', state: 'accepted' }] });
  addPlan({ key: 'explore_night', host: 'dev', cat: 'explore', title: 'Night-time heritage walk', desc: 'A late walk through the pols of the Old City. Meeting point shared in the group.', start: eve(23, 30), dur: 90, cap: 6, area: 'Old City', venueName: 'Meeting point shared in the group', venueType: 'Public area', tags: ['night', 'heritage'], createdHoursAgo: 12,
    rows: [{ u: 'meera', state: 'accepted' }] });
  addPlan({ key: 'gaming_flat', host: 'arjun', cat: 'gaming', title: 'Gaming night: DM for details', desc: 'Bring your own controller. DM me for the address.', start: T.at(1, 20, 30), dur: 180, cap: 5, area: 'Prahlad Nagar', venueName: 'My flat: DM for address', venueType: 'Private', tags: ['night'], review: ['private_location', 'spam'], createdHoursAgo: 4,
    rows: [{ u: 'rohan', state: 'requested', intro: 'Is this a public place?' }] });
  addPlan({ key: 'cancelled_plan', host: 'aarav', cat: 'chai', title: 'Sunday chai & sketching', desc: 'Bring a sketchbook. Cancelled by the host.', start: T.at(2, 17), dur: 90, cap: 4, venue: 'roast', status: 'cancelled', cancelReason: 'Host unwell', createdHoursAgo: 60,
    rows: [{ u: 'meera', state: 'cancelled' }, { u: 'kavya', state: 'cancelled' }] });

  // --- the test user's three completed plans (weeks −2, −1 and today)
  const todayStart = T.istMidnight(0).getTime();
  const pcDone = new Date(Math.min(Math.max(now.getTime() - 45 * MIN, todayStart + 2 * MIN), now.getTime() - 10000));
  const pcEnd = new Date(pcDone.getTime() - 2 * MIN);
  const pcStart = new Date(pcEnd.getTime() - 60 * MIN);
  const paStart = T.inPastWeek(2, 3, 6, 15);
  const pbStart = T.inPastWeek(1, 4, 19, 0);
  addPlan({ key: 'past_run', host: 'saanvi', cat: 'run', title: 'Sunrise 5K: easy pace', desc: 'Early run along the lake loop. Easy pace, chat all the way.', start: paStart, dur: 60, cap: 8, area: 'Vastrapur', venueName: 'Vastrapur Lake main gate', venueType: 'Public park', status: 'completed', completedAt: new Date(paStart.getTime() + 64 * MIN), createdAt: new Date(paStart.getTime() - 3 * DAY), tags: ['outdoors'],
    rows: [{ u: 'ME', state: 'completed' }, { u: 'diya', state: 'completed' }, { u: 'meera', state: 'completed' }] });
  addPlan({ key: 'past_badminton', host: 'vikram', cat: 'badminton', title: 'Thursday doubles at Court 7', desc: 'Doubles at Court 7.', start: pbStart, dur: 90, cap: 4, venue: 'court7', status: 'completed', completedAt: new Date(pbStart.getTime() + 94 * MIN), createdAt: new Date(pbStart.getTime() - 2 * DAY), level: 'intermediate',
    rows: [{ u: 'ME', state: 'completed' }, { u: 'diya', state: 'completed' }, { u: 'kabir', state: 'completed' }] });
  addPlan({ key: 'past_hosted', host: 'ME', cat: 'badminton', title: 'Doubles practice at Court 7', desc: 'Warm-up rallies and a few friendly games. All levels.', start: pcStart, dur: 60, cap: 4, venue: 'court7', status: 'completed', completedAt: pcDone, createdAt: T.ago(30 * HOUR), level: 'intermediate',
    rows: [{ u: 'diya', state: 'completed' }, { u: 'vikram', state: 'completed' }, { u: 'saanvi', state: 'completed' }] });

  // --- completed / cancelled history across the last 30 days (admin KPIs)
  const HIST = [[28, 'chai'], [26, 'walk'], [24, 'badminton'], [22, 'run'], [20, 'cowork'], [18, 'food'], [16, 'boardgames'], [14, 'gym'], [11, 'photo'], [9, 'chai'], [7, 'music'], [5, 'walk'], [3, 'badminton'], [2, 'chai']];
  const HIST_HOURS = [18, 7, 19, 6, 11, 20, 20, 7, 7, 17, 19, 18, 19, 17];
  const hostPool = ['aarav', 'diya', 'kabir', 'meera', 'rohan', 'ishita', 'vikram', 'anaya', 'saanvi', 'kavya', 'arjun', 'dev'];
  const joinedOf = Object.fromEntries(USERS.map((u) => [u[0], u[7]]));
  HIST.forEach(([daysAgo, cat], i) => {
    const key = `hist_${i + 1}`;
    const cancelled = i === 4 || i === 12; // two cancelled plans
    const hostKey = pick(hostPool.filter((u) => joinedOf[u] >= daysAgo + 1), `${key}:host`);
    const eligible = hostPool.filter((u) => u !== hostKey && joinedOf[u] >= daysAgo + 1);
    const n = 2 + (i % 3);
    const chosen = [];
    for (let j = 0; chosen.length < Math.min(n, eligible.length) && j < 40; j += 1) {
      const c = pick(eligible, `${key}:p${j}`);
      if (!chosen.includes(c)) chosen.push(c);
    }
    const start = T.at(-daysAgo, HIST_HOURS[i], (i % 2) * 30);
    const dur = 60 + (i % 3) * 30;
    const createdAt = new Date(start.getTime() - (1 + (i % 3)) * DAY);
    const rows = chosen.map((u, j) => ({
      u,
      state: cancelled ? 'cancelled' : i % 5 === 2 && j === 0 ? 'no_show' : 'completed',
      req: 8 + ((i * 7 + j * 13) % 40),
      dec: 6 + ((i * 11 + j * 17) % 70),
    }));
    if (!cancelled && eligible.length > chosen.length) rows.push({ u: pick(eligible.filter((u) => !chosen.includes(u)), `${key}:decl`), state: 'declined', req: 90, dec: 30 });
    const venueKey = cat === 'badminton' ? 'court7' : cat === 'boardgames' ? 'dice' : cat === 'chai' ? 'chaihouse' : null;
    addPlan({
      key, host: hostKey, cat, title: `${CAT_TITLE[cat]}${cancelled ? ' (cancelled)' : ''}`, desc: `${CAT_TITLE[cat]} with the neighbourhood crowd.`, start, dur, cap: 4 + (i % 3), venue: venueKey, area: venueKey ? undefined : pick(Object.keys(AREA), `${key}:area`),
      venueName: venueKey ? undefined : 'Public spot (demo)', status: cancelled ? 'cancelled' : 'completed', cancelledAt: cancelled ? new Date(start.getTime() - 3 * HOUR) : null,
      completedAt: cancelled ? null : new Date(start.getTime() + dur * MIN + 5 * MIN), createdAt, rows,
    });
  });

  // ---- XP, reliability, progress (derived from the completed plans) ------------
  const xpEvents = [];
  const dayTotals = new Map();
  const xpByUser = {};
  const seenCat = {};
  const completed = [...plans.values()].filter((p) => p.status === 'completed').sort((a, b) => a.completedAt - b.completedAt);
  const award = (uk, type, base, refId, activityId, at) => {
    const uid = U(uk);
    const day = istDay(at);
    const dk = `${uk}:${day}`;
    const used = dayTotals.get(dk) || 0;
    const delta = Math.max(0, Math.min(base, DAILY_CAP - used));
    dayTotals.set(dk, used + delta);
    xpByUser[uk] = (xpByUser[uk] || 0) + delta;
    xpEvents.push({ uk, uid, type, delta, key: `xp:${type}:${uid}:${refId}`, activityId, at, day });
  };
  completed.forEach((p) => {
    const members = [p.host, ...p.rows.filter((r) => r.state === 'completed').map((r) => r.u)];
    members.forEach((uk) => {
      award(uk, 'activity_completed', 40, p.id, p.id, p.completedAt);
      if (uk === p.host) award(uk, 'hosted_completed', 60, p.id, p.id, p.completedAt);
      seenCat[uk] = seenCat[uk] || new Set();
      if (!seenCat[uk].has(p.cat)) {
        seenCat[uk].add(p.cat);
        award(uk, 'new_category_explored', 20, p.cat, p.id, p.completedAt);
      }
    });
    // reliability events: attended (host + completed rows) and no_show rows
    [p.host, ...p.rows.filter((r) => ['completed', 'no_show'].includes(r.state)).map((r) => r.u)].forEach((uk) => {
      const row = p.rows.find((r) => r.u === uk);
      const kind = row && row.state === 'no_show' ? 'no_show' : 'attended';
      add('ReliabilityEvent', { _id: did('rel', `${p.key}:${uk}:${kind}`), userId: U(uk), activityId: p.id, kind, createdAt: p.completedAt }, { userId: U(uk), activityId: p.id, kind });
    });
  });
  xpEvents.forEach((e) => {
    add('XpEvent', { _id: did('xp', e.key), userId: e.uid, activityId: e.activityId, eventType: e.type, xpDelta: e.delta, idempotencyKey: e.key, createdAt: e.at }, { idempotencyKey: e.key });
  });
  dayTotals.forEach((total, dk) => {
    const [uk, day] = dk.split(':');
    add('XpDailyTotal', { _id: did('xpday', dk), userId: U(uk), day, total }, { userId: U(uk), day });
  });

  // ---- users -------------------------------------------------------------------
  USERS.forEach(([k, name, area, interests, intent, avail, rel, joined, active, bio, status]) => {
    const c = near(area, `user:${k}`, 0.003);
    const xp = xpByUser[k] || 0;
    const lvl = levelForXp(xp, LEVELS);
    const createdAt = T.ago(joined * DAY);
    add('User', {
      _id: U(k),
      phone: `+9100000000${String(USERS.findIndex((u) => u[0] === k) + 1).padStart(2, '0')}`,
      status: status || 'active',
      statusReason: status === 'limited' ? 'Under review after reports of repeated no-shows and rude messages.' : status === 'suspended' ? 'Repeated scam listings (report upheld).' : null,
      statusUntil: status === 'limited' ? T.ahead(6 * DAY) : status === 'suspended' ? T.ahead(25 * DAY) : null,
      ageVerified: true,
      ageVerifiedAt: createdAt,
      ageVerificationMethod: 'self_declared_18plus',
      termsAcceptedAt: createdAt,
      roles: [],
      profile: {
        displayName: name,
        avatarKey: null,
        bio,
        homeCity: 'Ahmedabad',
        homeArea: area,
        interests,
        intents: ['Make new friends', 'Weekend plans'],
        visibility: 'discoverable',
        boundaries: null,
        languages: ['English', 'Hindi', 'Gujarati'],
        reliabilityScore: rel,
        socialStyle: DEMO_STYLES[k] || null,
        preferences: { avatarSeed: `demo-${k}`, showOnRadar: true, radiusKm: 3, language: 'English', onboardedAt: createdAt },
        createdAt,
        updatedAt: createdAt,
      },
      notificationPrefs: {},
      progress: { xpTotal: xp, level: lvl.level, weeklyGoal: 2, streakWeeks: 0, freezesLeft: 1, dailyStreakOptIn: false, updatedAt: now },
      availability: { status: avail, activitySlugs: [intent, interests[0]].filter((v, i, a) => a.indexOf(v) === i), coarseCell: cellId(c.lat, c.lng), area, until: avail === 'now' ? T.ahead(3 * HOUR) : null, updatedAt: now },
      lastActiveAt: T.ago(active * DAY),
      createdAt,
      updatedAt: T.ago(active * DAY),
    }, { phone: `+9100000000${String(USERS.findIndex((u) => u[0] === k) + 1).padStart(2, '0')}` });
  });

  // ---- chats ----------------------------------------------------------------------
  const unreadFor = { ME: 0 };
  function addChat(planKey, memberKeys, script, { readThrough } = {}) {
    const p = plans.get(planKey);
    const convId = did('conv', planKey);
    ids.conversation[planKey] = convId;
    const msgs = script
      .map((s, i) => ({ ...s, id: did('msg', `${planKey}:${i}`), at: new Date(now.getTime() - s.ago * MIN) }))
      .sort((a, b) => a.at - b.at);
    msgs.forEach((m) => {
      add('Message', { _id: m.id, conversationId: convId, senderUserId: m.from === 'system' ? null : U(m.from), kind: m.from === 'system' ? 'system' : 'user', body: m.text, createdAt: m.at, updatedAt: m.at });
      ids.message[`${planKey}:${msgs.indexOf(m)}`] = m.id;
    });
    const last = msgs[msgs.length - 1];
    add('Conversation', {
      _id: convId,
      kind: 'activity_group',
      activityId: p.id,
      lastMessage: { id: last.id, senderId: last.from === 'system' ? null : U(last.from), kind: last.from === 'system' ? 'system' : 'user', body: last.text, createdAt: last.at },
      lastMessageAt: last.at,
      createdAt: p.createdAt,
    });
    memberKeys.forEach((uk) => {
      let lastReadAt = last.at;
      if (uk === 'ME' && readThrough != null) lastReadAt = new Date(msgs[readThrough].at.getTime() + 1000);
      if (uk === 'ME') unreadFor.ME += msgs.filter((m) => m.at > lastReadAt && m.from !== 'ME').length;
      add('ConversationMember', { _id: did('cmem', `${planKey}:${uk}`), conversationId: convId, userId: U(uk), joinedAt: new Date(msgs[0].at.getTime() - MIN), muted: false, lastReadAt, leftAt: null, hiddenAt: null, lastMessageAt: last.at }, { conversationId: convId, userId: U(uk) });
    });
    return convId;
  }

  addChat('badminton_eve', ['vikram', 'diya', 'ME'], [
    { from: 'system', text: 'You are in! Court 7 is booked for 7 PM. The exact spot is shared here with the group only.', ago: 26 * 60 },
    { from: 'vikram', text: 'Court 3 is booked 🏸 See you at the main entrance.', ago: 25 * 60 },
    { from: 'diya', text: 'I can bring extra shuttles.', ago: 24 * 60 },
    { from: 'ME', text: 'Nice! I will bring water and a spare racquet.', ago: 23 * 60 },
    { from: 'vikram', text: 'Perfect. I will split the court fee on SplitMate after.', ago: 3 * 60 },
    { from: 'diya', text: 'Running 10 minutes late, start without me!', ago: 35 },
  ], { readThrough: 3 });
  addChat('run_soon', ['saanvi', 'meera', 'anaya', 'ME', 'kabir', 'kavya'], [
    { from: 'system', text: 'You are in! Meet at the Riverfront east promenade gate.', ago: 5 * 60 },
    { from: 'saanvi', text: 'Easy pace, about 6:30/km. Water and shoes, that is all you need.', ago: 4 * 60 },
    { from: 'meera', text: 'Joining from the Law Garden side, see you there!', ago: 150 },
    { from: 'ME', text: 'On my way. Wear something reflective!', ago: 50 },
    { from: 'saanvi', text: 'We are at the gate, stretching.', ago: 8 },
  ], { readThrough: 3 });
  addChat('host_cowork', ['ME', 'kavya'], [
    { from: 'system', text: 'Your plan is live. People you accept will join this chat.', ago: 20 * 60 },
    { from: 'system', text: 'Kavya joined the plan.', ago: 18 * 60 },
    { from: 'kavya', text: 'Can I bring my own charger? 🔌', ago: 17 * 60 },
    { from: 'ME', text: 'Yes please, the café has limited sockets.', ago: 16 * 60 },
    { from: 'kavya', text: 'Perfect, see you at 10!', ago: 15 * 60 },
  ]);
  addChat('past_hosted', ['ME', 'diya', 'vikram', 'saanvi'], [
    { from: 'system', text: 'Your plan is live. People you accept will join this chat.', ago: 29 * 60 },
    { from: 'ME', text: 'Court 2 is booked, 7 AM sharp.', ago: 28 * 60 },
    { from: 'diya', text: 'Bringing the good shuttles 🙂', ago: 27 * 60 },
    { from: 'vikram', text: 'Great game everyone! Same time next week?', ago: 40 },
  ]);
  addChat('past_run', ['saanvi', 'ME', 'diya', 'meera'], [
    { from: 'system', text: 'You are in! Meet at the main gate at 6:10.', ago: 14 * 24 * 60 },
    { from: 'saanvi', text: 'Lake loop, easy pace. See you there.', ago: 14 * 24 * 60 - 30 },
    { from: 'ME', text: 'Great run, thanks Saanvi!', ago: 14 * 24 * 60 - 3000 },
  ]);
  addChat('past_badminton', ['vikram', 'ME', 'diya', 'kabir'], [
    { from: 'system', text: 'You are in! Court 7, 7 PM.', ago: 8 * 24 * 60 },
    { from: 'vikram', text: 'Thanks all, good games.', ago: 8 * 24 * 60 - 1500 },
    { from: 'kabir', text: 'Who is up for another round?', ago: 8 * 24 * 60 - 1600 },
  ]);
  // Reported conversation (demo users only): feeds the admin report "message context".
  const movieConv = addChat('movie_night', ['yash', 'rohan', 'kabir', 'anaya'], [
    // the last four are minutes apart so the admin "message context" (±30 min) shows the whole exchange
    { from: 'system', text: 'You are in! Lobby at 9:15.', ago: 20 * 60 },
    { from: 'yash', text: 'Be at the lobby by 9:15, I am not holding seats for anyone.', ago: 18 * 60 },
    { from: 'rohan', text: 'Sure, see you there.', ago: 18 * 60 - 6 },
    { from: 'yash', text: 'Honestly you lot are so slow. Why do I even bother organising?', ago: 18 * 60 - 10 },
    { from: 'anaya', text: 'That felt unnecessarily rude.', ago: 18 * 60 - 14 },
  ]);
  // direct chat: test user ↔ Diya (they shared accepted plans)
  const directKey = [ME, U('diya')].sort().join(':');
  const directId = did('conv', 'direct:ME:diya');
  ids.conversation.direct_diya = directId;
  const dm = [
    { from: 'diya', text: 'Hey! Loved the doubles last week 🙂', ago: 2 * 24 * 60 },
    { from: 'ME', text: 'Same! Same time next week?', ago: 2 * 24 * 60 - 20 },
    { from: 'diya', text: 'Booked Court 7 again for Thursday at 7. Join us?', ago: 26 * 60 },
  ].map((s, i) => ({ ...s, id: did('msg', `direct:${i}`), at: new Date(now.getTime() - s.ago * MIN) }));
  dm.forEach((m) => add('Message', { _id: m.id, conversationId: directId, senderUserId: U(m.from), kind: 'user', body: m.text, createdAt: m.at, updatedAt: m.at }));
  const dmLast = dm[dm.length - 1];
  add('Conversation', { _id: directId, kind: 'direct', directKey, lastMessage: { id: dmLast.id, senderId: U('diya'), kind: 'user', body: dmLast.text, createdAt: dmLast.at }, lastMessageAt: dmLast.at, createdAt: dm[0].at }, { directKey });
  add('ConversationMember', { _id: did('cmem', 'direct:ME'), conversationId: directId, userId: ME, joinedAt: dm[0].at, lastReadAt: dm[1].at, lastMessageAt: dmLast.at }, { conversationId: directId, userId: ME });
  add('ConversationMember', { _id: did('cmem', 'direct:diya'), conversationId: directId, userId: U('diya'), joinedAt: dm[0].at, lastReadAt: dmLast.at, lastMessageAt: dmLast.at }, { conversationId: directId, userId: U('diya') });
  unreadFor.ME += 1;

  // ---- circles --------------------------------------------------------------------
  const CIRCLES = {
    navchai: { name: 'Navrangpura Chai Club', cat: 'chai', area: 'Navrangpura', pic: 'chai', owner: 'aarav', mods: ['kavya'], members: ['diya', 'meera', 'ME', 'saanvi'], desc: 'Weekday chai breaks around CG Road. Show up, say hi, leave whenever.', rules: ['Public cafés only', 'Be on time or drop a note', 'No selling or promos'], age: 28 },
    runners: { name: 'Sunrise Runners AMD', cat: 'run', area: 'Vastrapur', pic: 'run', owner: 'saanvi', mods: ['meera'], members: ['ME', 'kabir', 'diya', 'anaya', 'kavya'], desc: 'Easy group runs at dawn. All paces welcome.', rules: ['Conversational pace', 'Reflective gear before 6:30 AM'], age: 24 },
    badminton: { name: 'Bodakdev Badminton', cat: 'badminton', area: 'Bodakdev', pic: 'badminton', owner: 'vikram', mods: ['diya'], members: ['kabir', 'arjun', 'rohan'], desc: 'Doubles most evenings. Intermediate friendly.', rules: ['Split court fees fairly', 'Rotate partners'], age: 20 },
    boardgames: { name: 'Board Game Nights', cat: 'boardgames', area: 'Vastrapur', pic: 'board', owner: 'ishita', mods: ['rohan'], members: ['dev', 'arjun', 'anaya', 'kabir', 'kavya'], desc: 'New games every Friday. Teachers on hand.', rules: ['Teach newcomers', 'Clean up the table'], age: 18 },
    cowork: { name: "Moon's Cowork Crew", cat: 'cowork', area: 'Navrangpura', pic: 'laptop', owner: 'ME', mods: ['kavya'], members: ['arjun', 'aarav'], desc: 'Weekday coworking mornings at friendly cafés.', rules: ['Headphones are fine', 'Keep calls outside'], age: 9 },
  };
  Object.entries(CIRCLES).forEach(([k, c]) => {
    const everyone = [c.owner, ...c.mods, ...c.members];
    add('Circle', { _id: circleIds[k], ownerUserId: U(c.owner), name: c.name, description: c.desc, visibility: 'public', area: c.area, pictogram: c.pic, categorySlug: c.cat, rules: c.rules, status: 'active', memberCount: everyone.length, createdAt: T.ago(c.age * DAY) });
    everyone.forEach((uk, i) => {
      const role = uk === c.owner ? 'owner' : c.mods.includes(uk) ? 'moderator' : 'member';
      add('CircleMember', { _id: did('cm', `${k}:${uk}`), circleId: circleIds[k], userId: U(uk), role, joinedAt: T.ago((c.age - Math.min(c.age - 1, i * 2)) * DAY) }, { circleId: circleIds[k], userId: U(uk) });
    });
  });
  const monthStart = T.istMidnight(-(parseInt(T.dayStr(now).slice(8), 10) - 1));
  const challengeId = did('challenge', 'navchai');
  add('CircleChallenge', { _id: challengeId, circleId: circleIds.navchai, title: '10 chai meetups this month', description: 'Together, complete 10 verified chai plans before the month ends.', targetCount: 10, xpReward: 100, startsAt: monthStart, endsAt: new Date(monthStart.getTime() + 31 * DAY), createdBy: U('aarav'), createdAt: monthStart });
  [['aarav', 3], ['diya', 1], ['meera', 1], ['ME', 2], ['kavya', 1]].forEach(([uk, n]) => add('ChallengeProgress', { _id: did('chp', uk), challengeId, userId: U(uk), count: n }, { challengeId, userId: U(uk) }));

  // ---- test-user progress (quests, badges) ------------------------------------------
  const questId = (slug) => tax.quests.get(slug);
  const achId = (slug) => tax.achievements.get(slug);
  const wk = periodKey('weekly', now);
  const dy = periodKey('daily', now);
  const uq = (slug, period, state, progress) => add('UserQuest', { _id: did('uq', `${slug}:${period}`), userId: ME, questId: questId(slug), periodKey: period, progress, state }, { userId: ME, questId: questId(slug), periodKey: period });
  uq('q_host', wk, 'completed', { progress: 1, total: 1 });
  uq('q_weekly_goal', wk, 'started', { progress: 1, total: 2 });
  uq('q_new_person', dy, 'started', { progress: 0, total: 1 });
  uq('q_new_category', wk, 'available', { progress: 0, total: 1 });
  [['b_early', '1 verified plan before 7 AM (Sunrise 5K)', paStart], ['b_chai', 'Demo badge (granted by demo data)', T.ago(12 * DAY)], ['b_reliable', 'Demo badge (granted by demo data)', T.ago(2 * DAY)]].forEach(([slug, summary, at]) => {
    add('UserAchievement', { _id: did('ua', slug), userId: ME, achievementId: achId(slug), earnedAt: at, evidence: { summary, demo: true } }, { userId: ME, achievementId: achId(slug) });
  });
  const meXp = xpByUser.ME || 0;
  const feedback = [
    ['past_run', 'ME', 'saanvi', true, 5, 'Great pace, welcoming group.'], ['past_run', 'saanvi', 'ME', true, 5, null],
    ['past_badminton', 'ME', 'vikram', true, 5, 'Well-run session.'], ['past_badminton', 'vikram', 'ME', true, 5, null],
    ['past_hosted', 'ME', 'diya', true, 5, null], ['past_hosted', 'ME', 'vikram', true, 5, null],
    ['past_hosted', 'diya', 'ME', true, 5, 'Well organised, thanks for hosting!'], ['past_hosted', 'vikram', 'ME', true, 4, null],
  ];
  feedback.forEach(([pk, from, about, showed, rating, note]) => {
    const p = plans.get(pk);
    add('ActivityFeedback', { _id: did('fb', `${pk}:${from}:${about}`), activityId: p.id, fromUserId: U(from), aboutUserId: U(about), showedUp: showed, rating, note, createdAt: new Date(p.completedAt.getTime() + 20 * MIN) }, { activityId: p.id, fromUserId: U(from), aboutUserId: U(about) });
  });

  // ---- SplitMate -----------------------------------------------------------------------
  const exp = (key, e) => {
    ids.expense[key] = did('expense', key);
    const shares = e.shares.map((s) => ({ userId: U(s.u), amountMinor: s.amount, state: s.state, paymentReference: s.ref || null, settlementIntentAt: s.state === 'unsettled' ? null : e.createdAt, confirmedBy: s.state === 'confirmed' ? U(e.payee) : null, confirmedAt: s.state === 'confirmed' ? e.createdAt : null, updatedAt: e.createdAt }));
    add('Expense', {
      _id: ids.expense[key],
      creatorUserId: U(e.creator),
      activityId: e.activityKey ? plans.get(e.activityKey).id : null,
      description: e.description,
      currency: 'INR',
      totalMinor: e.total,
      splitMethod: e.method,
      payeeUserId: U(e.payee),
      payeeUpiVpa: e.upi,
      receiptKey: null,
      items: (e.items || []).map((it, i) => ({ _id: did('expitem', `${key}:${i}`), label: it.label, amountMinor: it.amount, quantity: it.qty, assignees: it.who.map((u) => ({ userId: U(u), shareRatio: 1 })), createdAt: e.createdAt })),
      shares,
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
    });
  };
  const sharesFor = (method, total, who, opts) => computeShares(method, total, who.map((w) => U(w)), opts);
  const amountOf = (computed, uk) => computed.find((c) => c.userId === U(uk)).amountMinor;
  {
    const who = ['vikram', 'diya', 'kabir', 'ME'];
    const c = sharesFor('equal', 80000, who);
    exp('court', { creator: 'vikram', payee: 'vikram', upi: 'vikram@okbank', description: 'Court 7 booking: last Thursday', total: 80000, method: 'equal', activityKey: 'past_badminton', createdAt: new Date(pbStart.getTime() + 3 * HOUR),
      shares: [{ u: 'vikram', amount: amountOf(c, 'vikram'), state: 'confirmed' }, { u: 'diya', amount: amountOf(c, 'diya'), state: 'confirmed' }, { u: 'kabir', amount: amountOf(c, 'kabir'), state: 'marked_paid', ref: 'UPI-DEMO-4412' }, { u: 'ME', amount: amountOf(c, 'ME'), state: 'unsettled' }] });
  }
  {
    const who = ['ME', 'saanvi', 'diya', 'meera'];
    const items = [
      { label: 'Masala chai', amount: 4000, qty: 3, who: ['ME', 'saanvi', 'meera'] },
      { label: 'Fafda-jalebi platter', amount: 18000, qty: 1, who: ['ME', 'saanvi', 'diya', 'meera'] },
      { label: 'Bun maska', amount: 6000, qty: 2, who: ['saanvi', 'diya'] },
      { label: 'Water bottles', amount: 2000, qty: 4, who: ['ME', 'saanvi', 'diya', 'meera'] },
    ];
    const c = sharesFor('itemised', 52500, who, { items: items.map((i) => ({ label: i.label, amountMinor: i.amount, quantity: i.qty, assignments: i.who.map((u) => ({ userId: U(u) })) })) });
    exp('breakfast', { creator: 'ME', payee: 'ME', upi: 'chandresh@okbank', description: 'Chai & snacks after the run', total: 52500, method: 'itemised', activityKey: 'past_run', items, createdAt: new Date(paStart.getTime() + 3 * HOUR),
      shares: [{ u: 'ME', amount: amountOf(c, 'ME'), state: 'confirmed' }, { u: 'saanvi', amount: amountOf(c, 'saanvi'), state: 'marked_paid', ref: 'UPI-DEMO-7731' }, { u: 'diya', amount: amountOf(c, 'diya'), state: 'unsettled' }, { u: 'meera', amount: amountOf(c, 'meera'), state: 'disputed' }] });
  }
  {
    const who = ['saanvi', 'ME', 'diya', 'meera'];
    const c = sharesFor('equal', 160000, who);
    exp('brunch', { creator: 'saanvi', payee: 'saanvi', upi: 'saanvi@okbank', description: 'Sunday brunch after the long run', total: 160000, method: 'equal', activityKey: null, createdAt: T.ago(2 * DAY),
      shares: [{ u: 'saanvi', amount: amountOf(c, 'saanvi'), state: 'confirmed' }, { u: 'ME', amount: amountOf(c, 'ME'), state: 'marked_paid', ref: 'UPI-DEMO-9087' }, { u: 'diya', amount: amountOf(c, 'diya'), state: 'confirmed' }, { u: 'meera', amount: amountOf(c, 'meera'), state: 'unsettled' }] });
  }

  // ---- notifications (test user) ----------------------------------------------------------
  const N = [
    ['join', 'Vikram accepted your request', 'Evening badminton doubles: the group chat is open.', 95, false, { screen: 'group_chat', params: { conversationId: ids.conversation.badminton_eve } }, { activityId: ids.activity.badminton_eve }],
    ['join', 'Rohan wants to join your plan', 'Coworking morning at the café', 40, false, { screen: 'activity_detail', params: { id: ids.activity.host_cowork } }, { activityId: ids.activity.host_cowork }],
    ['join', 'Ishita wants to join your plan', 'Coworking morning at the café', 38, false, { screen: 'activity_detail', params: { id: ids.activity.host_cowork } }, { activityId: ids.activity.host_cowork }],
    ['nearby', 'A chai plan starts soon near you', 'Chai break near you starts in 25 min.', 30, false, { screen: 'category_results', params: { category: 'chai' } }, {}],
    ['quest', 'Quest complete: Host a micro-plan', 'Claim +100 XP on your roadmap.', 180, false, { screen: 'social_roadmap', params: {} }, { questId: 'q_host' }],
    ['activity', 'Your run starts soon', 'Easy riverfront jog starts in 25 min. Check in when you arrive.', 20, true, { screen: 'activity_detail', params: { id: ids.activity.run_soon } }, { activityId: ids.activity.run_soon }],
    ['safety', 'Safety tip', 'Share your plan with a trusted contact from any plan page.', 30 * 60, true, { screen: 'safety_center', params: {} }, {}],
    ['system', 'Welcome to Come Over', 'Find someone for whatever you are doing. Start with a plan near you.', 7 * 24 * 60, true, { screen: 'discover_home', params: {} }, {}],
  ];
  N.forEach(([type, title, body, minsAgo, read, target, data], i) => {
    const at = T.ago(minsAgo * MIN);
    ids.notification[i] = did('notif', String(i));
    add('Notification', { _id: ids.notification[i], userId: ME, type, title, body, data: { ...data, target }, readAt: read ? new Date(at.getTime() + 5 * MIN) : null, createdAt: at });
  });

  // ---- safety: reports, actions, appeals, trusted contact -----------------------------------
  const R = {};
  const report = (key, r) => {
    R[key] = did('report', key);
    ids.report[key] = R[key];
    add('Report', {
      _id: R[key],
      reporterUserId: U(r.by),
      reportedUserId: r.about ? U(r.about) : null,
      activityId: r.activity ? plans.get(r.activity).id : null,
      messageId: r.message || null,
      conversationId: r.conv || null,
      reasonCode: r.reason,
      details: r.details,
      evidenceKeys: [],
      evidenceNote: r.note || null,
      priority: r.priority,
      status: r.status,
      assignedAdminId: r.assigned ? ME : null,
      resolvedAt: r.resolvedAgo != null ? T.ago(r.resolvedAgo * HOUR) : null,
      createdAt: T.ago(r.ago * HOUR),
      updatedAt: T.ago((r.resolvedAgo != null ? r.resolvedAgo : r.ago) * HOUR),
    });
  };
  report('r1', { by: 'meera', about: 'yash', activity: 'movie_night', reason: 'safety_threat', priority: 'urgent', status: 'open', ago: 3, details: 'After the last meetup he kept following me and my friend when we left, even after we said we were fine on our own. I did not feel safe.' });
  report('r2', { by: 'aarav', about: 'arjun', reason: 'underage', priority: 'urgent', status: 'reviewing', ago: 20, assigned: true, details: 'Mentioned being in 11th standard in a chat. Might be under 18.' });
  report('r3', { by: 'anaya', about: 'yash', activity: 'movie_night', conv: movieConv, message: ids.message['movie_night:3'], reason: 'harassment', priority: 'high', status: 'open', ago: 14, details: 'Rude messages in the group chat. See the highlighted message.' });
  report('r4', { by: 'diya', about: 'dev', reason: 'dating_or_solicitation', priority: 'high', status: 'open', ago: 26, details: 'Asked to meet one-on-one several times and kept pushing for a romantic plan after I said no.' });
  report('r5', { by: 'kabir', about: 'arjun', activity: 'gaming_flat', reason: 'spam', priority: 'normal', status: 'reviewing', ago: 22, assigned: true, details: 'Plan asks everyone to DM for an address and links to a paid group.' });
  report('r6', { by: 'ME', about: 'yash', activity: 'movie_night', reason: 'no_show_abuse', priority: 'normal', status: 'open', ago: 40, details: 'Accepted three plans this week and did not turn up to any.' });
  report('r7', { by: 'saanvi', about: 'tara', reason: 'scam', priority: 'high', status: 'appealed', ago: 7 * 24, resolvedAgo: 5 * 24, details: 'Posted plans that were really ticket resales and asked for advance UPI payments.' });
  report('r8', { by: 'meera', about: 'rohan', reason: 'inappropriate_content', priority: 'normal', status: 'actioned', ago: 10 * 24, resolvedAgo: 9 * 24, details: 'Posted an inappropriate meme in a group chat.' });
  report('r9', { by: 'kabir', about: 'diya', reason: 'other', priority: 'low', status: 'dismissed', ago: 13 * 24, resolvedAgo: 12 * 24, details: 'Felt she was a bit too competitive at badminton.' });
  report('r10', { by: 'anaya', about: 'yash', reason: 'harassment', priority: 'high', status: 'appealed', ago: 9 * 24, resolvedAgo: 8 * 24, details: 'Repeated rude comments after a meetup.' });
  const action = (key, rep, act, notes, days, agoH) => add('ReportAction', { _id: did('ract', key), reportId: R[rep], adminId: ME, action: act, notes, durationDays: days || null, createdAt: T.ago(agoH * HOUR) });
  action('a7', 'r7', 'suspend', 'Repeated scam listings confirmed by two reporters.', 30, 5 * 24);
  action('a8', 'r8', 'warn', 'Warned about community rules on content.', null, 9 * 24);
  action('a9', 'r9', 'dismiss', 'No rule broken, normal competitive play.', null, 12 * 24);
  action('a10', 'r10', 'limit', 'Account limited for 14 days after repeated rude behaviour.', 14, 8 * 24);
  const appeal = (key, rep, who, statement, agoH) => add('Appeal', { _id: did('appeal', key), reportId: R[rep], userId: U(who), statement, status: 'open', decidedBy: null, decidedAt: null, createdAt: T.ago(agoH * HOUR) }, { reportId: R[rep], userId: U(who) });
  appeal('tara', 'r7', 'tara', 'I was selling my own spare tickets at face value and never asked for money in advance. Happy to share the original booking as proof.', 4 * 24);
  appeal('yash', 'r10', 'yash', 'I raised my voice once and I apologise. It will not happen again and I would like to keep hosting.', 6 * 24);
  add('TrustedContact', { _id: did('tc', 'maa'), userId: ME, name: 'Maa (demo)', phone: '+910000000099', status: 'accepted', createdAt: T.ago(6 * DAY) }, { userId: ME, phone: '+910000000099' });

  // ---- billing: subscriptions, entitlements, invoices ----------------------------------------
  const SUBS = [['aarav', 'plus', 'google', 25, 5], ['diya', 'plus', 'apple', 18, 12], ['kabir', 'pro', 'google', 11, 19], ['meera', 'plus', 'apple', 28, 2], ['saanvi', 'pro', 'apple', 6, 24]];
  SUBS.forEach(([uk, tier, store, startedDays, leftDays], i) => {
    const txn = `demo-txn-${String(i + 1).padStart(3, '0')}`;
    add('Subscription', { _id: did('sub', uk), userId: U(uk), store, productId: tier === 'pro' ? 'irl_pro_monthly' : 'irl_plus_monthly', status: 'active', startedAt: T.ago(startedDays * DAY), expiresAt: T.ahead(leftDays * DAY), storeTransactionId: txn, originalTransactionId: `${txn}-orig`, autoRenew: true, createdAt: T.ago(startedDays * DAY) }, { storeTransactionId: txn });
    add('Entitlement', { _id: did('ent', uk), userId: U(uk), entitlement: tier, source: store, sourceRef: txn, expiresAt: T.ahead(leftDays * DAY) }, { userId: U(uk), entitlement: tier });
  });
  add('Subscription', { _id: did('sub', 'rohan'), userId: U('rohan'), store: 'google', productId: 'irl_plus_monthly', status: 'expired', startedAt: T.ago(60 * DAY), expiresAt: T.ago(30 * DAY), storeTransactionId: 'demo-txn-006', originalTransactionId: 'demo-txn-006-orig', autoRenew: false, createdAt: T.ago(60 * DAY) }, { storeTransactionId: 'demo-txn-006' });
  add('Entitlement', { _id: did('ent', 'venue-ishita'), userId: U('ishita'), entitlement: 'venue', source: 'razorpay', sourceRef: 'pay_demo_0001', expiresAt: T.ahead(26 * DAY) }, { userId: U('ishita'), entitlement: 'venue' });
  add('BusinessInvoice', { _id: did('inv', '0000'), businessId: ids.business.biz1, planCode: 'venue', amountMinor: 99900, currency: 'INR', razorpayOrderId: 'order_demo_0000', razorpayPaymentId: 'pay_demo_0000', status: 'paid', paidAt: T.ago(35 * DAY), createdAt: T.ago(35 * DAY) }, { razorpayOrderId: 'order_demo_0000' });
  add('BusinessInvoice', { _id: did('inv', '0001'), businessId: ids.business.biz1, planCode: 'venue', amountMinor: 99900, currency: 'INR', razorpayOrderId: 'order_demo_0001', razorpayPaymentId: 'pay_demo_0001', status: 'paid', paidAt: T.ago(5 * DAY), createdAt: T.ago(5 * DAY) }, { razorpayOrderId: 'order_demo_0001' });
  if (testUserOwnsVenue) {
    add('Entitlement', { _id: did('ent', 'venue-me'), userId: ME, entitlement: 'venue', source: 'grant', sourceRef: 'demo', expiresAt: T.ahead(30 * DAY) }, { userId: ME, entitlement: 'venue' });
    add('BusinessInvoice', { _id: did('inv', 'me'), businessId: ids.business.bizT, planCode: 'venue', amountMinor: 99900, currency: 'INR', razorpayOrderId: 'order_demo_me', razorpayPaymentId: 'pay_demo_me', status: 'paid', paidAt: T.ago(3 * DAY), createdAt: T.ago(3 * DAY) }, { razorpayOrderId: 'order_demo_me' });
  }

  // ---- campaigns + metrics -----------------------------------------------------------------------
  const dayList = (fromAgo, toAgo) => {
    const out = [];
    for (let d = fromAgo; d >= toAgo; d -= 1) out.push(T.dayStr(T.ago(d * DAY)));
    return out;
  };
  const metrics = (campaignId, days, scale) => {
    let clicks = 0;
    days.forEach((day) => {
      const imp = Math.round((180 + h01(`${campaignId}:${day}:i`) * 240) * scale);
      const clk = Math.round(imp * (0.04 + h01(`${campaignId}:${day}:c`) * 0.05));
      const jr = Math.round(clk * (0.1 + h01(`${campaignId}:${day}:j`) * 0.15));
      const ci = Math.round(jr * (0.3 + h01(`${campaignId}:${day}:k`) * 0.4));
      clicks += clk;
      add('CampaignMetric', { _id: did('cmet', `${campaignId}:${day}`), campaignId, day, impressions: imp, clicks: clk, joinRequests: jr, checkIns: ci }, { campaignId, day });
    });
    return clicks;
  };
  const clicksA = metrics(campA, dayList(13, 0), 1);
  const clicksC = metrics(campC, dayList(13, 8), 0.8);
  add('SponsoredCampaign', { _id: campA, businessId: ids.business.biz1, activityId: ids.activity.boardgames_night, title: 'Board game night at Dice & Dough', audience: { areas: ['Vastrapur', 'Bodakdev'], categories: ['boardgames', 'gaming'] }, budgetMinor: 500000, spentMinor: clicksA * 1200, currency: 'INR', startsAt: T.ago(12 * DAY), endsAt: T.ahead(10 * DAY), status: 'active', label: 'Sponsored', createdBy: U('ishita'), createdAt: T.ago(14 * DAY) });
  add('SponsoredCampaign', { _id: campB, businessId: ids.business.biz1, activityId: null, title: 'Weekend chai flight at Riverside Roast', audience: { areas: ['Riverfront'], categories: ['chai', 'photo'] }, budgetMinor: 300000, spentMinor: 0, currency: 'INR', startsAt: T.ahead(3 * DAY), endsAt: T.ahead(17 * DAY), status: 'pending_review', label: 'Sponsored', createdBy: U('ishita'), createdAt: T.ago(3 * HOUR) });
  add('SponsoredCampaign', { _id: campC, businessId: ids.business.biz1, activityId: null, title: 'Monsoon café crawl', audience: { areas: ['Navrangpura', 'Riverfront'], categories: ['chai', 'food'] }, budgetMinor: 250000, spentMinor: Math.min(250000, clicksC * 1200), currency: 'INR', startsAt: T.ago(26 * DAY), endsAt: T.ago(8 * DAY), status: 'completed', label: 'Sponsored', createdBy: U('ishita'), createdAt: T.ago(28 * DAY) });
  dayList(13, 0).forEach((day) => add('ActivityDailyMetric', { _id: did('adm', `boardgames:${day}`), activityId: ids.activity.boardgames_night, day, views: Math.round(20 + h01(`views:${day}`) * 50) }, { activityId: ids.activity.boardgames_night, day }));
  dayList(13, 0).forEach((day) => add('ActivityDailyMetric', { _id: did('adm', `cowork:${day}`), activityId: ids.activity.host_cowork, day, views: Math.round(5 + h01(`views2:${day}`) * 25) }, { activityId: ids.activity.host_cowork, day }));
  if (testUserOwnsVenue) {
    const campT = did('campaign', 'campT');
    ids.campaign.campT = campT;
    const clicksT = metrics(campT, dayList(9, 0), 0.7);
    add('SponsoredCampaign', { _id: campT, businessId: ids.business.bizT, activityId: null, title: 'Coworking mornings at The Cowork Chai Room', audience: { areas: ['Navrangpura'], categories: ['cowork', 'chai'] }, budgetMinor: 200000, spentMinor: clicksT * 1200, currency: 'INR', startsAt: T.ago(9 * DAY), endsAt: T.ahead(14 * DAY), status: 'active', label: 'Sponsored', createdBy: ME, createdAt: T.ago(10 * DAY) });
  }

  // ---- audit log ----------------------------------------------------------------------------------
  let au = 0;
  const audit = (by, action, targetType, targetId, metadata, agoH) => {
    au += 1;
    add('AuditEvent', { _id: did('audit', String(au)), actorUserId: by === 'admin' ? null : U(by), actorAdminId: by === 'admin' ? ME : null, action, targetType, targetId: String(targetId), metadata: metadata || {}, ip: by === 'admin' ? '203.0.113.7' : '198.51.100.23', createdAt: T.ago(agoH * HOUR) });
  };
  audit('admin', 'report.review_started', 'report', R.r2, {}, 20);
  audit('admin', 'report.review_started', 'report', R.r5, {}, 21);
  audit('admin', 'user.viewed', 'user', U('arjun'), {}, 20);
  audit('admin', 'user.viewed', 'user', U('yash'), {}, 30);
  audit('admin', 'report.warn', 'report', R.r8, { reason: 'Warned about community rules on content.', reportedUserId: U('rohan') }, 9 * 24);
  audit('admin', 'report.dismiss', 'report', R.r9, { reason: 'No rule broken, normal competitive play.', reportedUserId: U('diya') }, 12 * 24);
  audit('admin', 'report.suspend', 'report', R.r7, { reason: 'Repeated scam listings confirmed by two reporters.', durationDays: 30, reportedUserId: U('tara') }, 5 * 24);
  audit('admin', 'user.status.suspended', 'user', U('tara'), { reason: 'Repeated scam listings (report upheld).', durationDays: 30 }, 5 * 24);
  audit('admin', 'report.limit', 'report', R.r10, { reason: 'Account limited for 14 days after repeated rude behaviour.', durationDays: 14, reportedUserId: U('yash') }, 8 * 24);
  audit('admin', 'user.status.limited', 'user', U('yash'), { reason: 'Under review after reports of repeated no-shows and rude messages.', durationDays: 14 }, 8 * 24);
  audit('admin', 'activity.approve', 'activity', ids.activity.weekend_food_walk, { reason: 'Public market, host has a clean record.' }, 2 * 24);
  audit('admin', 'activity.remove', 'activity', ids.activity.hist_5, { reason: 'Duplicate listing.' }, 6 * 24);
  audit('admin', 'campaign.approve', 'campaign', campA, { reason: 'Clearly labelled, public venue.' }, 13 * 24);
  audit('admin', 'business.verify', 'business', ids.business.biz1, { reason: 'Owner ID and venue photos checked.' }, 27 * 24);
  audit('admin', 'business.verify', 'business', ids.business.biz2, { reason: 'Public sports venue, licence seen.' }, 19 * 24);
  audit('admin', 'taxonomy.category.update', 'category', 'explore', { reason: 'Night-time walks need a closer look.', riskLevel: 'elevated' }, 25 * 24);
  audit('admin', 'taxonomy.quest.update', 'quest', 'q_host', { reason: 'Raise reward to encourage hosting.', xpReward: 100 }, 20 * 24);
  [['aarav', 'chai_now'], ['meera', 'walk_quick'], ['vikram', 'badminton_eve'], ['saanvi', 'run_soon'], ['ME', 'host_cowork'], ['ishita', 'boardgames_night'], ['rohan', 'waitlist_full'], ['dev', 'explore_night']].forEach(([uk, pk], i) => {
    audit(uk, 'activity.create', 'activity', ids.activity[pk], { category: plans.get(pk).cat }, 3 + i * 3);
  });
  ['aarav', 'kavya', 'arjun', 'dev'].forEach((uk) => audit(uk, 'user.age_confirmed', 'user', U(uk), {}, (USERS.find((u) => u[0] === uk)[7] * 24) - 1));
  audit('ishita', 'campaign.create', 'campaign', campB, {}, 3);
  audit('meera', 'report.create', 'report', R.r1, { reasonCode: 'safety_threat' }, 3);

  return { items, ids, unreadMessagesForTestUser: unreadFor.ME, plans: [...plans.values()].map((p) => ({ key: p.key, id: p.id, status: p.status })), testUserXp: meXp, counts: items.reduce((m, i) => ((m[i.model] = (m[i.model] || 0) + 1), m), {}) };
}

// ---------------------------------------------------------------------------
// Taxonomy: the demo data needs categories, quests and badges. Seed them only if missing
// (never overwrite edits made in the admin console).
async function ensureTaxonomy() {
  const { Category, Level, Quest, Achievement, CityArea } = models();
  const missing = async () => {
    const [cats, lv, qs, as, areas] = await Promise.all([
      Category.distinct('slug'), Level.countDocuments({}), Quest.distinct('slug'), Achievement.distinct('slug'), CityArea.countDocuments({ city: 'Ahmedabad' }),
    ]);
    return (
      CATEGORIES.some((c) => !cats.includes(c.slug)) ||
      !lv ||
      ['q_host', 'q_weekly_goal', 'q_new_person', 'q_new_category'].some((s) => !qs.includes(s)) ||
      ['b_early', 'b_chai', 'b_reliable'].some((s) => !as.includes(s)) ||
      !areas
    );
  };
  if (await missing()) await require('./seed').seed({ onlyMissing: true });
  const [qs, as] = await Promise.all([Quest.find({}).select('slug').lean(), Achievement.find({}).select('slug').lean()]);
  return { quests: new Map(qs.map((q) => [q.slug, q._id])), achievements: new Map(as.map((a) => [a.slug, a._id])) };
}

// ---------------------------------------------------------------------------
// The real test account: completed profile + progress (never changes _id or roles).
function testUserPatch(now, xp) {
  const T = timeHelpers(now);
  const c = near('Navrangpura', 'user:ME', 0.002);
  return {
    profile: {
      displayName: 'Chandresh',
      avatarKey: null,
      bio: 'Chai, badminton and weekend walks. Building Come Over, testing it in real life.',
      homeCity: 'Ahmedabad',
      homeArea: 'Navrangpura',
      interests: ['chai', 'badminton', 'walk', 'cowork', 'run'],
      intents: ['Make new friends', 'Weekend plans', 'Fitness buddy'],
      visibility: 'discoverable',
      boundaries: 'Public places only; I like plans with clear start and end times.',
      languages: ['English', 'Hindi', 'Gujarati'],
      reliabilityScore: 0.95,
      preferences: { avatarSeed: 'demo-chandresh', showOnRadar: true, radiusKm: 5, language: 'English', onboardedAt: T.ago(30 * DAY), pronouns: '' },
      createdAt: T.ago(30 * DAY),
      updatedAt: now,
    },
    progress: { xpTotal: xp, level: levelForXp(xp, LEVELS).level, weeklyGoal: 1, streakWeeks: 3, freezesLeft: 1, dailyStreakOptIn: false, updatedAt: now },
    availability: { status: 'later', activitySlugs: ['chai', 'badminton'], coarseCell: cellId(c.lat, c.lng), area: 'Navrangpura', until: null, updatedAt: now },
  };
}

async function upsertTestUser(now, xp, meId = TEST_USER_ID) {
  const { User } = models();
  const patch = testUserPatch(now, xp);
  const existing = await User.findOne({ phone: TEST_PHONE }).select('_id profile').lean();
  const $set = {
    ageVerified: true,
    ageVerifiedAt: now,
    ageVerificationMethod: 'self_declared_18plus',
    termsAcceptedAt: now,
    notificationPrefs: { productUpdates: false, nearbyActivities: true, joinRequests: true, messages: true, questReminders: true, quietHours: { start: '22:00', end: '08:00' } },
    progress: patch.progress,
    availability: patch.availability,
    lastActiveAt: now,
  };
  if (existing && existing.profile) {
    // keep a real avatar / created timestamps; refresh the demo-relevant fields
    Object.entries(patch.profile).forEach(([k, v]) => {
      if (['avatarKey', 'createdAt'].includes(k)) return;
      if (k === 'preferences') Object.entries(v).forEach(([pk, pv]) => (pk === 'onboardedAt' ? null : ($set[`profile.preferences.${pk}`] = pv)));
      else $set[`profile.${k}`] = v;
    });
    if (!(existing.profile.preferences && existing.profile.preferences.onboardedAt)) $set['profile.preferences.onboardedAt'] = patch.profile.preferences.onboardedAt;
  } else {
    $set.profile = patch.profile;
  }
  $set.updatedAt = now;
  // `roles` and `_id` are never part of the update; a brand-new account (empty test DB) is created as an admin.
  const r = await User.updateOne(
    { phone: TEST_PHONE },
    { $set, $setOnInsert: { _id: meId, roles: ['admin'], status: 'active', createdAt: now } },
    { upsert: true, timestamps: false, setDefaultsOnInsert: false }
  );
  return { created: !!r.upsertedCount };
}

// ---------------------------------------------------------------------------
async function writeItems(items) {
  const M = models();
  const byModel = new Map();
  for (const it of items) {
    if (!byModel.has(it.model)) byModel.set(it.model, []);
    byModel.get(it.model).push(it);
  }
  const summary = {};
  for (const [name, list] of byModel) {
    const Model = M[name];
    const ops = [];
    for (const { doc, key } of list) {
      const m = new Model(doc);
      await m.validate(); // runs schema validation + derived fields (e.g. Activity location / coarseCell)
      const full = m.toObject({ virtuals: false, versionKey: false, minimize: false, flattenMaps: true });
      const { _id, ...rest } = full;
      ops.push({ updateOne: { filter: key || { _id }, update: key ? { $set: rest, $setOnInsert: { _id } } : { $set: rest }, upsert: true } });
    }
    const r = await Model.collection.bulkWrite(ops, { ordered: true });
    summary[name] = { docs: list.length, inserted: r.upsertedCount, updated: r.modifiedCount };
  }
  return summary;
}

async function removeVenueOwnerDocs() {
  // Without --test-user-owns-venue the test-owned business/venue docs must not exist.
  const M = models();
  const bizT = did('business', 'bizT');
  const venueT = did('venue', 'moon');
  const campT = did('campaign', 'campT');
  await Promise.all([
    M.BusinessProfile.deleteOne({ _id: bizT }),
    M.Venue.deleteOne({ _id: venueT }),
    M.SponsoredCampaign.deleteOne({ _id: campT }),
    M.CampaignMetric.deleteMany({ campaignId: campT }),
    M.Entitlement.deleteOne({ _id: did('ent', 'venue-me') }),
    M.BusinessInvoice.deleteOne({ _id: did('inv', 'me') }),
  ]);
}

async function seedDemo({ now = new Date(), testUserOwnsVenue = false, log = () => {} } = {}) {
  const tax = await ensureTaxonomy();
  // An existing account keeps its own id; everything demo refers to it through that id.
  const existingMe = await models().User.findOne({ phone: TEST_PHONE }).select('_id').lean();
  const meId = existingMe ? existingMe._id : TEST_USER_ID;
  const ds = buildDataset({ now, testUserOwnsVenue, tax, meId });
  const u = await upsertTestUser(now, ds.testUserXp, meId);
  if (!testUserOwnsVenue) await removeVenueOwnerDocs();
  log(`test user ${maskPhone(TEST_PHONE)}: ${u.created ? 'created' : 'updated'}`);
  const summary = await writeItems(ds.items);
  return { summary, ids: ds.ids, plans: ds.plans, unreadMessagesForTestUser: ds.unreadMessagesForTestUser, testUserXp: ds.testUserXp };
}

// Removes every demo document (ids matching DEMO_ID_RE) plus rows created at runtime that
// point at demo content, and zeroes the test account's progress. Real data is left alone.
async function resetDemo() {
  const M = models();
  const SKIP = new Set(['Session', 'OtpRequest']); // never touch auth collections
  const deleted = {};
  for (const [name, Model] of Object.entries(M)) {
    if (SKIP.has(name) || !Model.deleteMany) continue;
    const r = await Model.deleteMany({ _id: DEMO_ID_RE });
    if (r.deletedCount) deleted[name] = r.deletedCount;
  }
  // rows made while using the app that only make sense with the demo content
  const sweep = [
    ['Participant', { activityId: DEMO_ID_RE }], ['ConversationMember', { conversationId: DEMO_ID_RE }], ['Message', { conversationId: DEMO_ID_RE }],
    ['CircleMember', { circleId: DEMO_ID_RE }], ['ChallengeProgress', { challengeId: DEMO_ID_RE }], ['Notification', { userId: DEMO_ID_RE }],
    ['ActivityFeedback', { activityId: DEMO_ID_RE }], ['ReliabilityEvent', { activityId: DEMO_ID_RE }], ['XpEvent', { activityId: DEMO_ID_RE }],
    ['Report', { $or: [{ reportedUserId: DEMO_ID_RE }, { activityId: DEMO_ID_RE }] }], ['Block', { $or: [{ blockedUserId: DEMO_ID_RE }, { blockerUserId: DEMO_ID_RE }] }],
    ['Expense', { activityId: DEMO_ID_RE }],
  ];
  const swept = {};
  for (const [name, filter] of sweep) {
    const r = await M[name].deleteMany(filter);
    if (r.deletedCount) swept[name] = r.deletedCount;
  }
  // test account: back to a blank progress state (profile and roles stay)
  const meDoc = await M.User.findOne({ phone: TEST_PHONE }).select('_id').lean();
  const meId = meDoc ? meDoc._id : TEST_USER_ID;
  const own = { userId: meId };
  await Promise.all(['XpEvent', 'XpDailyTotal', 'UserQuest', 'UserAchievement', 'StreakFreeze', 'ReliabilityEvent'].map((n) => M[n].deleteMany(own)));
  await M.User.updateOne(
    { _id: meId },
    { $set: { 'progress.xpTotal': 0, 'progress.level': 1, 'progress.weeklyGoal': 2, 'progress.streakWeeks': 0, 'progress.freezesLeft': 1, 'availability.status': 'busy', 'availability.activitySlugs': [], 'availability.coarseCell': null, 'availability.area': null, 'availability.until': null } },
    { timestamps: false }
  );
  return { deleted, swept };
}

// ---------------------------------------------------------------------------
// Host only: never print credentials.
function hostOf(uri, fallback) {
  try {
    return new URL(String(uri).replace(/^mongodb(\+srv)?:/, 'https:')).hostname || fallback;
  } catch (e) {
    return fallback; // e.g. a multi-host URI that the URL parser rejects
  }
}

async function main(argv) {
  const args = new Set(argv);
  if (args.has('--help') || args.has('-h')) {
    console.log('usage: node --env-file=.env scripts/seed-demo.js [--reset] [--test-user-owns-venue]');
    return;
  }
  if (!process.env.SEED_TEST_PHONE && !process.env.TEST_LOGIN_PHONE) {
    console.error('Set SEED_TEST_PHONE (or TEST_LOGIN_PHONE) in backend/.env: the phone of the account that should get the demo profile.');
    process.exit(2);
  }
  await db.connect();
  const conn = db.mongoose.connection;
  console.log(`Target: ${hostOf(process.env.MONGODB_URI, conn.host)} / database "${conn.name}"`);
  await db.syncIndexes();
  if (args.has('--reset')) {
    const r = await resetDemo();
    if (Object.keys(r.deleted).length) {
      console.log('Removed demo documents:');
      console.table(r.deleted);
    } else {
      console.log('No demo documents found: nothing to remove.');
    }
    if (Object.keys(r.swept).length) {
      console.log('Removed runtime rows pointing at demo content:');
      console.table(r.swept);
    }
    console.log(`Test account ${maskPhone(TEST_PHONE)}: progress zeroed (profile and admin role kept).`);
    return;
  }
  const r = await seedDemo({ testUserOwnsVenue: args.has('--test-user-owns-venue'), log: (m) => console.log(m) });
  const rows = Object.entries(r.summary).map(([k, v]) => ({ collection: k, docs: v.docs, inserted: v.inserted, updated: v.updated }));
  console.table(rows);
  const total = rows.reduce((n, x) => n + x.docs, 0);
  console.log(`Demo data ready: ${total} documents across ${rows.length} collections.`);
  console.log(`Sign in as ${maskPhone(TEST_PHONE)} (admin). Remove everything with: npm run seed:demo:reset`);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => db.disconnect())
    .catch(async (e) => {
      console.error(e);
      await db.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { buildDataset, seedDemo, resetDemo, writeItems, ensureTaxonomy, testUserPatch, did, isDemoId, DEMO_ID_RE, TEST_PHONE, TEST_USER_ID, USERS, QUESTS, ACHIEVEMENTS };
