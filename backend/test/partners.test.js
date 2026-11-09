'use strict';
// Partner perks (offers, eligibility, codes, staff confirmation), table holds, partnerVisits
// quest stats and the admin views, against an in-memory MongoDB replica set.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMongo, stopMongo, clearCollections } = require('./helpers/mongo');
const { startApp, client, makeUser } = require('./helpers/groupD');
const L = require('../src/lib/perks');
const { LEVELS } = require('../scripts/seed');

let skip = null;
let app;
let call;

test.before(async () => {
  const m = await startMongo();
  if (m.skip) {
    skip = m.skip;
    return;
  }
  app = await startApp(['discovery', 'activities', 'partners', 'monetization', 'progress', 'admin']);
  call = client(app.base);
});

test.after(async () => {
  if (app) await app.close();
  await stopMongo();
});

test.beforeEach(async () => {
  if (skip) return;
  await clearCollections();
  await require('../src/models').Level.insertMany(LEVELS);
});

const models = () => require('../src/models');
const HOUR = 3600000;
// A single IST weekday far from today (and tomorrow), so "not now" is stable while the test runs.
const notToday = () => [(L.istClock(new Date()).dow + 3) % 7];

async function partner({ verified = true, name = 'Chai Point', area = 'Navrangpura', lat = 23.037, lng = 72.56 } = {}) {
  const { BusinessProfile, Venue } = models();
  const owner = await makeUser({ name: `${name} Owner` });
  const staff = await makeUser({ name: 'Sunil Staff' });
  const business = await BusinessProfile.create({
    ownerUserId: owner.id,
    name: `${name} Pvt Ltd`,
    kind: 'venue',
    verificationStatus: verified ? 'verified' : 'pending',
    staff: [
      { userId: owner.id, role: 'owner' },
      { userId: staff.id, role: 'staff' },
    ],
  });
  // The legacy Mixed `offers` field must stay harmless.
  const venue = await Venue.create({ businessId: business._id, name, area, latitude: lat, longitude: lng, venueType: 'Café', categorySlugs: ['chai'], verified, offers: [{ title: 'legacy text offer' }] });
  return { owner, staff, business, venue };
}

async function makeOffer(p, body = {}) {
  const r = await call('POST', '/v1/business/offers', { token: p.owner.token, body: { title: 'Chai and snacks', kind: 'percent', value: 15, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

async function setXp(u, xp) {
  await models().User.updateOne({ _id: u.id }, { $set: { 'progress.xpTotal': xp } });
}

async function setShowUps(u, attended, missed) {
  const { ReliabilityEvent } = models();
  for (let i = 0; i < attended; i += 1) await ReliabilityEvent.create({ userId: u.id, activityId: crypto.randomUUID(), kind: 'attended' });
  for (let i = 0; i < missed; i += 1) await ReliabilityEvent.create({ userId: u.id, activityId: crypto.randomUUID(), kind: 'no_show' });
}

async function plan(host, { venueId = null, members = [], capacity = 6, status = 'open', startsInH = 3 } = {}) {
  const { Activity, Participant } = models();
  const start = new Date(Date.now() + startsInH * HOUR);
  const a = await Activity.create({
    hostUserId: host.id,
    category: 'chai',
    title: 'Chai at the corner',
    startsAt: start,
    endsAt: new Date(start.getTime() + HOUR),
    capacity,
    venueId,
    latitude: 23.037,
    longitude: 72.56,
    acceptedCount: 1 + members.length,
    status,
  });
  await Participant.create({ activityId: a._id, userId: host.id, state: 'accepted', decidedAt: new Date() });
  for (const m of members) await Participant.create({ activityId: a._id, userId: m.id, state: 'accepted', decidedAt: new Date() });
  return a;
}

const titlesFor = async (userId) => (await models().Notification.find({ userId }).sort({ createdAt: 1 }).lean()).map((n) => n.title);

// ---------------------------------------------------------------------------
test('business offers: create, validate, edit, pause, end; hidden from users until the venue is verified', async (t) => {
  if (skip) return t.skip(skip);
  const owner = await makeUser({ name: 'Owner' });
  const on = await call('POST', '/v1/business/venues', {
    token: owner.token,
    body: {
      businessName: 'Dice Café',
      kind: 'venue',
      contact: { email: 'owner@dice.example' },
      proofKey: `venue_proof/${owner.id}/doc.pdf`,
      agreements: ['terms'],
      venue: { name: 'Dice Café', address: '12 CG Road', area: 'Navrangpura', latitude: 23.03, longitude: 72.56, venueType: 'Board game café', categories: ['boardgames'] },
    },
  });
  assert.equal(on.status, 201, JSON.stringify(on.body));
  const venueId = on.body.venueId;

  // Validation (contract ranges and cross-field rules).
  const bad = async (body, path) => {
    const r = await call('POST', '/v1/business/offers', { token: owner.token, body: { title: 'Board game hour', kind: 'percent', value: 15, ...body } });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'validation_failed');
    assert.ok(r.body.details.some((d) => d.path === path), `${path}: ${JSON.stringify(r.body.details)}`);
  };
  await bad({ value: 55 }, 'value');
  await bad({ value: 3 }, 'value');
  await bad({ kind: 'flat', value: 6000 }, 'value');
  await bad({ title: 'x' }, 'title');
  await bad({ minLevel: 11 }, 'minLevel');
  await bad({ startMinute: 600, endMinute: 540 }, 'endMinute');
  await bad({ days: [7] }, 'days[0]');
  await bad({ validFrom: '2026-12-10T00:00:00Z', validTo: '2026-12-01T00:00:00Z' }, 'validTo');

  // Creating works while the venue is in review; defaults follow the contract.
  const created = await call('POST', '/v1/business/offers', { token: owner.token, body: { title: 'Board game hour', kind: 'percent', value: 15 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const o = created.body;
  assert.equal(o.venueId, venueId);
  assert.equal(o.label, '15% off');
  assert.equal(o.window, 'Any time');
  assert.equal(o.status, 'active');
  assert.deepEqual([o.minGroup, o.minLevel, o.minShowUpRate, o.perUserPerWeek, o.startMinute, o.endMinute], [2, 1, 0.8, 1, 0, 1440]);
  assert.deepEqual(o.days, [0, 1, 2, 3, 4, 5, 6]);
  const freebie = await call('POST', '/v1/business/offers', { token: owner.token, body: { title: 'Free chai', kind: 'freebie', value: 40, days: [4, 1, 2, 3], startMinute: 960, endMinute: 1140 } });
  assert.equal(freebie.status, 201, JSON.stringify(freebie.body));
  assert.equal(freebie.body.value, null, 'freebie has no value');
  assert.equal(freebie.body.label, 'Free chai');
  assert.equal(freebie.body.window, 'Mon to Thu, 4 to 7 pm');
  assert.deepEqual(freebie.body.days, [1, 2, 3, 4]);

  // Users cannot see offers of an unverified venue.
  const user = await makeUser({ name: 'Asha' });
  const hidden = await call('GET', '/v1/me/perks', { token: user.token });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal(hidden.body.unlocked.length + hidden.body.locked.length, 0);
  assert.equal((await call('GET', `/v1/venues/${venueId}`, { token: user.token })).status, 404);
  const redeemHidden = await call('POST', `/v1/offers/${o.id}/redeem`, { token: user.token, body: {} });
  assert.equal(redeemHidden.status, 404);
  assert.equal(redeemHidden.body.code, 'offer_not_found');
  const me = await call('GET', '/v1/business/venues/me', { token: owner.token });
  assert.deepEqual(me.body.offers, [], 'MyVenue shows what users see: nothing until verified');
  assert.equal(me.body.hasOffer, false);

  // Admin verifies: the offers appear.
  const { BusinessProfile, Venue } = models();
  await BusinessProfile.updateOne({ ownerUserId: owner.id }, { $set: { verificationStatus: 'verified' } });
  await Venue.updateOne({ _id: venueId }, { $set: { verified: true } });
  const shown = await call('GET', `/v1/venues/${venueId}`, { token: user.token });
  assert.equal(shown.status, 200, JSON.stringify(shown.body));
  assert.equal(shown.body.offers.length, 2);
  assert.equal(shown.body.hasOffer, true);
  assert.equal(shown.body.bestOfferLabel, '15% off');
  assert.ok(shown.body.offers.every((x) => x.eligibility), 'signed-in viewer gets eligibility');
  assert.equal(shown.body.offers[0].status, undefined, 'users never see business-only fields');

  // Edit and pause.
  const edit = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { value: 20, minLevel: 2, description: 'Any board game, any table' } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.label, '20% off');
  assert.equal(edit.body.minLevel, 2);
  // Edits are validated against the merged offer: switching to flat keeps value 20 (valid), 5 is not.
  const badEdit = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { kind: 'flat', value: 5 } });
  assert.equal(badEdit.status, 400);
  assert.deepEqual(badEdit.body.details, [{ path: 'value', code: 'too_small', min: 10 }]);
  const toFlat = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { kind: 'flat' } });
  assert.equal(toFlat.body.label, '₹20 off');
  const toFreebie = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { kind: 'freebie', title: 'Free game hour' } });
  assert.equal(toFreebie.status, 200);
  assert.equal(toFreebie.body.value, null);
  assert.equal(toFreebie.body.label, 'Free game hour');
  const pause = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { status: 'paused' } });
  assert.equal(pause.body.status, 'paused');
  const afterPause = await call('GET', `/v1/venues/${venueId}`, { token: user.token });
  assert.deepEqual(afterPause.body.offers.map((x) => x.id), [freebie.body.id], 'paused offers are hidden');
  assert.equal((await call('POST', `/v1/offers/${o.id}/redeem`, { token: user.token, body: {} })).body.code, 'offer_not_found');

  // Expired validity hides an offer as well.
  await call('PATCH', `/v1/business/offers/${freebie.body.id}`, { token: owner.token, body: { validFrom: new Date(Date.now() - 3 * 86400000).toISOString(), validTo: new Date(Date.now() - 86400000).toISOString() } });
  assert.deepEqual((await call('GET', `/v1/venues/${venueId}`, { token: user.token })).body.offers, []);

  // End is final; the business list shows status + stats.
  const end = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { status: 'ended' } });
  assert.equal(end.body.status, 'ended');
  const again = await call('PATCH', `/v1/business/offers/${o.id}`, { token: owner.token, body: { status: 'active' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'offer_ended');
  const list = await call('GET', '/v1/business/offers', { token: owner.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((x) => x.status), ['active', 'ended']);
  assert.deepEqual(list.body.items[0].stats, { week: 0, total: 0 });

  // Only staff of that business.
  const stranger = await makeUser({ name: 'Stranger' });
  assert.equal((await call('GET', '/v1/business/offers', { token: stranger.token })).body.code, 'no_business');
  const other = await partner({ name: 'Other Café' });
  const foreign = await call('PATCH', `/v1/business/offers/${freebie.body.id}`, { token: other.owner.token, body: { status: 'paused' } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.code, 'offer_not_found');
  // Any staff member (not only owners) manages offers.
  const byStaff = await call('POST', '/v1/business/offers', { token: other.staff.token, body: { title: 'Free cookie', kind: 'freebie' } });
  assert.equal(byStaff.status, 201, JSON.stringify(byStaff.body));

  // At most 10 non-ended offers per venue.
  for (let i = 0; i < 9; i += 1) await makeOffer(other, { title: `Offer ${i}` });
  const eleventh = await call('POST', '/v1/business/offers', { token: other.owner.token, body: { title: 'One too many', kind: 'freebie' } });
  assert.equal(eleventh.status, 409);
  assert.equal(eleventh.body.code, 'too_many_offers');
});

test('GET /venues: offers, hasOffer, bestOfferLabel, eligibility and the hasOffer filter', async (t) => {
  if (skip) return t.skip(skip);
  const withOffer = await partner({ name: 'Alpha Chai' });
  await partner({ name: 'Beta Books' });
  await makeOffer(withOffer, { title: 'Free bun maska', kind: 'freebie' });
  await makeOffer(withOffer, { title: 'Weekend combo', kind: 'flat', value: 100, minLevel: 3 });
  await makeOffer(withOffer, { title: 'Big discount', kind: 'percent', value: 25 });
  const u = await makeUser({ name: 'Ravi' });
  const r = await call('GET', '/v1/venues', { token: u.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byName = new Map(r.body.items.map((v) => [v.name, v]));
  const a = byName.get('Alpha Chai');
  assert.equal(a.hasOffer, true);
  assert.equal(a.offers.length, 3);
  assert.equal(a.bestOfferLabel, '25% off', 'unlocked first, then percent before freebie');
  assert.equal(a.offers[2].label, '₹100 off', 'level-locked offer ranks last');
  assert.deepEqual(a.offers[2].eligibility.reasons, ['level']);
  assert.equal(a.offers[2].eligibility.unlockLevelName, 'Regular');
  assert.ok(!a.offers.some((x) => x.title === 'legacy text offer'), 'legacy Mixed offers are superseded');
  const b = byName.get('Beta Books');
  assert.deepEqual(b.offers, []);
  assert.equal(b.hasOffer, false);
  assert.equal(b.bestOfferLabel, null);

  const only = await call('GET', '/v1/venues?hasOffer=true', { token: u.token });
  assert.deepEqual(only.body.items.map((v) => v.name), ['Alpha Chai']);
  const near = await call('GET', '/v1/venues?hasOffer=true&lat=23.037&lng=72.56', { token: u.token });
  assert.deepEqual(near.body.items.map((v) => v.name), ['Alpha Chai']);
});

test('eligibility gating on redeem: level, show-up (with the 3-plan grace), window, weekly limit', async (t) => {
  if (skip) return t.skip(skip);
  const p = await partner();
  const user = await makeUser({ name: 'Meera' });

  const lv = await makeOffer(p, { minLevel: 3 });
  const locked = await call('POST', `/v1/offers/${lv.id}/redeem`, { token: user.token, body: {} });
  assert.equal(locked.status, 403);
  assert.equal(locked.body.code, 'offer_locked');
  assert.equal(locked.body.details.unlockLevel, 3);
  assert.deepEqual(locked.body.details.reasons, ['level']);
  assert.match(locked.body.message, /level 3 \(Regular\)/);
  await setXp(user, 100); // level 3, Regular
  assert.equal((await call('POST', `/v1/offers/${lv.id}/redeem`, { token: user.token, body: {} })).status, 201);
  const xpAfter = (await models().User.findById(user.id).lean()).progress.xpTotal;
  assert.equal(xpAfter, 100, 'XP is never spent');

  const strict = await makeOffer(p, { title: 'Reliable regulars', minShowUpRate: 0.9 });
  await setShowUps(user, 1, 1); // 2 considered plans: still counts as 1.0
  assert.equal((await call('POST', `/v1/offers/${strict.id}/redeem`, { token: user.token, body: {} })).status, 201);
  const strict2 = await makeOffer(p, { title: 'Reliable regulars 2', minShowUpRate: 0.9 });
  await setShowUps(user, 1, 0); // 3 plans, 2/3 = 0.67 < 0.9
  const low = await call('POST', `/v1/offers/${strict2.id}/redeem`, { token: user.token, body: {} });
  assert.equal(low.status, 403);
  assert.equal(low.body.code, 'offer_locked');
  assert.deepEqual(low.body.details.reasons, ['show_up']);

  // (The user is now below the default 0.8 too; a fresh member is under the 3-plan grace.)
  const fresh = await makeUser({ name: 'Fresh' });
  const later = await makeOffer(p, { title: 'Another day', days: notToday() });
  const nn = await call('POST', `/v1/offers/${later.id}/redeem`, { token: fresh.token, body: {} });
  assert.equal(nn.status, 409);
  assert.equal(nn.body.code, 'not_now');
  assert.doesNotMatch(nn.body.message, /—/);

  // Weekly limit: one confirmed visit uses it up.
  const weekly = await makeOffer(p, { title: 'Weekly treat', perUserPerWeek: 1 });
  const first = await call('POST', `/v1/offers/${weekly.id}/redeem`, { token: fresh.token, body: {} });
  assert.equal(first.status, 201);
  const conf = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: first.body.redemption.code } });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  const second = await call('POST', `/v1/offers/${weekly.id}/redeem`, { token: fresh.token, body: {} });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'weekly_limit');
  const v = await call('GET', `/v1/venues/${p.venue._id}`, { token: fresh.token });
  const shown = v.body.offers.find((x) => x.id === weekly.id);
  assert.deepEqual(shown.eligibility.reasons, ['weekly_limit']);
  assert.equal(shown.eligibility.usedThisWeek, 1);
});

test('redeem: same unexpired code on repeat, new code after expiry, cancel, owner-only polling', async (t) => {
  if (skip) return t.skip(skip);
  const p = await partner();
  const o = await makeOffer(p, { minGroup: 3 });
  const user = await makeUser({ name: 'Kavya Shah' });
  const r1 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: user.token, body: {} });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const red = r1.body.redemption;
  assert.match(red.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(red.qrPayload, `comeover:redeem:${red.code}`);
  assert.equal(red.status, 'issued');
  assert.equal(new Date(red.expiresAt) - new Date(red.issuedAt), 20 * 60000);
  assert.deepEqual(red.offer, { id: o.id, title: 'Chai and snacks', label: '15% off', window: 'Any time', minGroup: 3 });
  assert.deepEqual(red.venue, { id: p.venue._id, name: 'Chai Point', area: 'Navrangpura' });
  assert.equal(red.activityId, null);
  assert.equal(red.groupSize, null);

  const r2 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: user.token, body: {} });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.redemption.id, red.id);
  assert.equal(r2.body.redemption.code, red.code);

  // Poll: owner only.
  const poll = await call('GET', `/v1/redemptions/${red.id}`, { token: user.token });
  assert.equal(poll.status, 200);
  assert.equal(poll.body.redemption.status, 'issued');
  const someoneElse = await makeUser({ name: 'Nosy' });
  assert.equal((await call('GET', `/v1/redemptions/${red.id}`, { token: someoneElse.token })).status, 404);

  // Past its 20 minutes the code reads as expired, and redeeming again issues a fresh one.
  const { OfferRedemption } = models();
  await OfferRedemption.updateOne({ _id: red.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', `/v1/redemptions/${red.id}`, { token: user.token })).body.redemption.status, 'expired');
  const r3 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: user.token, body: {} });
  assert.equal(r3.status, 201);
  assert.notEqual(r3.body.redemption.id, red.id);

  // Cancel (issued → cancelled), idempotent; a cancelled code can't be confirmed.
  const c = await call('POST', `/v1/redemptions/${r3.body.redemption.id}/cancel`, { token: user.token });
  assert.equal(c.status, 200);
  assert.equal(c.body.redemption.status, 'cancelled');
  assert.equal((await call('POST', `/v1/redemptions/${r3.body.redemption.id}/cancel`, { token: user.token })).body.redemption.status, 'cancelled');
  assert.equal((await call('POST', `/v1/redemptions/${red.id}/cancel`, { token: user.token })).body.code, 'not_cancellable');
  const late = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: r3.body.redemption.code } });
  assert.equal(late.status, 410);
  assert.equal(late.body.code, 'code_expired');

  const mine = await call('GET', '/v1/me/redemptions', { token: user.token });
  assert.equal(mine.status, 200);
  assert.deepEqual(
    mine.body.items.map((x) => x.status),
    ['cancelled', 'expired'],
    'newest first'
  );
});

test('staff confirm: case-insensitive code, group size, wrong venue, used, expired, not found', async (t) => {
  if (skip) return t.skip(skip);
  const p = await partner();
  const other = await partner({ name: 'Elsewhere' });
  const o = await makeOffer(p, { perUserPerWeek: 7 });
  const host = await makeUser({ name: 'Asha Patel' });
  const friends = [await makeUser({ name: 'B' }), await makeUser({ name: 'C' }), await makeUser({ name: 'D' })];
  const a = await plan(host, { venueId: p.venue._id, members: friends });
  await setXp(host, 160);

  const r = await call('POST', `/v1/offers/${o.id}/redeem`, { token: host.token, body: { activityId: a._id } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.redemption.activityId, a._id);
  const code = r.body.redemption.code;
  const messy = ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)} `;

  const noStaff = await call('POST', '/v1/business/redemptions/confirm', { token: host.token, body: { code } });
  assert.equal(noStaff.status, 403);
  assert.equal(noStaff.body.code, 'no_business');
  const wrong = await call('POST', '/v1/business/redemptions/confirm', { token: other.staff.token, body: { code } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'wrong_venue');
  const unknown = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: 'ZZZZZZ' } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'code_not_found');
  assert.equal((await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: 'nope' } })).body.code, 'code_not_found');

  const ok = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: messy } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const br = ok.body.redemption;
  assert.equal(br.status, 'redeemed');
  assert.equal(br.groupSize, 4, 'defaults to the accepted members of the plan (host + 3)');
  assert.ok(br.redeemedAt);
  assert.deepEqual(br.user, { firstName: 'Asha', level: 4, levelName: 'Explorer' });
  assert.ok(!JSON.stringify(br).includes('+91'), 'never a phone number');

  const used = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code } });
  assert.equal(used.status, 409);
  assert.equal(used.body.code, 'code_used');
  assert.equal((await call('GET', `/v1/redemptions/${br.id}`, { token: host.token })).body.redemption.status, 'redeemed');

  // groupSize: explicit value (clamped to 20), and 1 without a plan.
  const solo = await makeUser({ name: 'Solo' });
  const s1 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: solo.token, body: {} });
  const c1 = await call('POST', '/v1/business/redemptions/confirm', { token: p.owner.token, body: { code: s1.body.redemption.code } });
  assert.equal(c1.body.redemption.groupSize, 1);
  const s2 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: solo.token, body: {} });
  const c2 = await call('POST', '/v1/business/redemptions/confirm', { token: p.owner.token, body: { code: s2.body.redemption.code, groupSize: 45 } });
  assert.equal(c2.body.redemption.groupSize, 20);
  // An activityId the user is not part of is ignored.
  const s3 = await call('POST', `/v1/offers/${o.id}/redeem`, { token: solo.token, body: { activityId: a._id } });
  assert.equal(s3.body.redemption.activityId, null);

  // Expired.
  const { OfferRedemption } = models();
  await OfferRedemption.updateOne({ _id: s3.body.redemption.id }, { $set: { expiresAt: new Date(Date.now() - 60000) } });
  const exp = await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: s3.body.redemption.code } });
  assert.equal(exp.status, 410);
  assert.equal(exp.body.code, 'code_expired');

  // Hub list + counts and analytics.
  const list = await call('GET', '/v1/business/redemptions', { token: p.staff.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.items.length, 3);
  assert.deepEqual(list.body.counts, { today: 3, week: 3, month: 3 });
  assert.equal(list.body.items[0].user.firstName, 'Solo');
  const an = await call('GET', '/v1/business/analytics?range=7d', { token: p.owner.token });
  assert.equal(an.status, 200, JSON.stringify(an.body));
  assert.deepEqual(an.body.verifiedVisits, { week: 3, month: 3 });
  const otherAn = await call('GET', '/v1/business/analytics?range=7d', { token: other.owner.token });
  assert.deepEqual(otherAn.body.verifiedVisits, { week: 0, month: 0 });
  const offers = await call('GET', '/v1/business/offers', { token: p.owner.token });
  assert.deepEqual(offers.body.items[0].stats, { week: 3, total: 3 });
});

test('table holds: host only, partner venue only, one active hold, confirm/decline notify, activity cancel', async (t) => {
  if (skip) return t.skip(skip);
  const p = await partner();
  const host = await makeUser({ name: 'Rohan Mehta' });
  const member = await makeUser({ name: 'Member' });
  const outsider = await makeUser({ name: 'Outsider' });
  const a = await plan(host, { venueId: p.venue._id, members: [member], capacity: 6 });

  const notHost = await call('POST', `/v1/activities/${a._id}/table-hold`, { token: member.token, body: {} });
  assert.equal(notHost.status, 403);
  assert.equal(notHost.body.code, 'host_only');
  const plain = await plan(host);
  const np = await call('POST', `/v1/activities/${plain._id}/table-hold`, { token: host.token, body: {} });
  assert.equal(np.status, 409);
  assert.equal(np.body.code, 'not_partner_venue');
  const unverified = await partner({ name: 'Pending Place', verified: false });
  const up = await plan(host, { venueId: unverified.venue._id });
  assert.equal((await call('POST', `/v1/activities/${up._id}/table-hold`, { token: host.token, body: {} })).body.code, 'not_partner_venue');
  const done = await plan(host, { venueId: p.venue._id, status: 'completed' });
  assert.equal((await call('POST', `/v1/activities/${done._id}/table-hold`, { token: host.token, body: {} })).body.code, 'activity_not_open');

  assert.deepEqual((await call('GET', `/v1/activities/${a._id}/table-hold`, { token: host.token })).body, { hold: null });
  const h = await call('POST', `/v1/activities/${a._id}/table-hold`, { token: host.token, body: { note: 'Window seat if possible' } });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.equal(h.body.partySize, 6, 'defaults to the plan capacity');
  assert.equal(h.body.status, 'requested');
  assert.equal(h.body.note, 'Window seat if possible');
  assert.deepEqual(h.body.venue, { id: p.venue._id, name: 'Chai Point', area: 'Navrangpura' });
  assert.equal(new Date(h.body.startsAt).getTime(), new Date(a.startsAt).getTime());
  assert.equal(h.body.activity, undefined, 'host view has no business fields');
  const dup = await call('POST', `/v1/activities/${a._id}/table-hold`, { token: host.token, body: { partySize: 2 } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'hold_exists');

  // Staff (owner and staff) were told; the notification opens the business holds screen.
  assert.deepEqual(await titlesFor(p.staff.id), ['New table request']);
  assert.deepEqual(await titlesFor(p.owner.id), ['New table request']);
  const n = await models().Notification.findOne({ userId: p.staff.id }).lean();
  assert.equal(n.data.target.screen, 'business_holds');
  assert.doesNotMatch(n.body, /—/);

  // Members can see it; outsiders cannot.
  assert.equal((await call('GET', `/v1/activities/${a._id}/table-hold`, { token: member.token })).body.hold.id, h.body.id);
  assert.equal((await call('GET', `/v1/activities/${a._id}/table-hold`, { token: outsider.token })).status, 403);

  // Business list (default upcoming) with activity + host first name.
  const list = await call('GET', '/v1/business/table-holds', { token: p.staff.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.items.length, 1);
  assert.deepEqual(list.body.items[0].host, { firstName: 'Rohan' });
  assert.equal(list.body.items[0].activity.joinedCount, 2);
  assert.equal(list.body.items[0].activity.capacity, 6);
  assert.equal((await call('GET', '/v1/business/table-holds?status=requested', { token: p.staff.token })).body.items.length, 1);
  assert.equal((await call('GET', '/v1/business/table-holds', { token: outsider.token })).body.code, 'no_business');
  const otherBiz = await partner({ name: 'Rival' });
  assert.equal((await call('POST', `/v1/business/table-holds/${h.body.id}/respond`, { token: otherBiz.staff.token, body: { decision: 'confirm' } })).status, 404);

  // Confirm → host notified.
  const conf = await call('POST', `/v1/business/table-holds/${h.body.id}/respond`, { token: p.staff.token, body: { decision: 'confirm' } });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  assert.equal(conf.body.status, 'confirmed');
  assert.ok(conf.body.respondedAt);
  assert.equal(conf.body.activity.id, a._id);
  assert.deepEqual(await titlesFor(host.id), ['Chai Point is holding your table']);
  assert.equal((await call('GET', '/v1/business/table-holds?status=requested', { token: p.staff.token })).body.items.length, 0);
  assert.equal((await call('GET', '/v1/business/table-holds', { token: p.staff.token })).body.items.length, 1, 'upcoming includes confirmed');

  // Host cancels; then a new request is declined with a reason.
  assert.deepEqual((await call('DELETE', `/v1/activities/${a._id}/table-hold`, { token: member.token })).body.code, 'host_only');
  const del = await call('DELETE', `/v1/activities/${a._id}/table-hold`, { token: host.token });
  assert.deepEqual(del.body, { ok: true });
  assert.equal((await call('DELETE', `/v1/activities/${a._id}/table-hold`, { token: host.token })).body.code, 'hold_not_found');
  assert.equal((await call('GET', `/v1/activities/${a._id}/table-hold`, { token: host.token })).body.hold.status, 'cancelled');
  const h2 = await call('POST', `/v1/activities/${a._id}/table-hold`, { token: host.token, body: { partySize: 3 } });
  assert.equal(h2.status, 201);
  const dec = await call('POST', `/v1/business/table-holds/${h2.body.id}/respond`, { token: p.owner.token, body: { decision: 'decline', reason: 'Fully booked tonight' } });
  assert.equal(dec.body.status, 'declined');
  assert.equal(dec.body.declineReason, 'Fully booked tonight');
  assert.equal((await titlesFor(host.id)).pop(), "Chai Point can't hold a table");
  const hostNote = await models().Notification.findOne({ userId: host.id, title: "Chai Point can't hold a table" }).lean();
  assert.match(hostNote.body, /Fully booked tonight/);
  assert.equal(hostNote.data.target.screen, 'activity_detail');
  const again = await call('POST', `/v1/business/table-holds/${h2.body.id}/respond`, { token: p.owner.token, body: { decision: 'confirm' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'hold_not_pending');

  // Cancelling the plan cancels its hold and tells the venue.
  const h3 = await call('POST', `/v1/activities/${a._id}/table-hold`, { token: host.token, body: {} });
  assert.equal(h3.status, 201);
  const cancel = await call('POST', `/v1/activities/${a._id}/cancel`, { token: host.token, body: { reason: 'Rain' } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await models().TableHold.findById(h3.body.id).lean()).status, 'cancelled');
  assert.equal((await titlesFor(p.staff.id)).pop(), 'Table request cancelled');
  assert.equal((await call('GET', '/v1/business/table-holds?status=all', { token: p.staff.token })).body.items.length, 3);
  assert.equal((await call('POST', `/v1/activities/${a._id}/table-hold`, { token: host.token, body: {} })).body.code, 'activity_not_open');
});

test('GET /me/perks: unlocked vs locked, distance order, nextUnlock', async (t) => {
  if (skip) return t.skip(skip);
  const near = await partner({ name: 'Zeta Near', lat: 23.0371, lng: 72.5601 });
  const far = await partner({ name: 'Alpha Far', lat: 23.06, lng: 72.507 });
  await makeOffer(near, { title: 'Near treat', kind: 'freebie' });
  await makeOffer(far, { title: 'Far deal', kind: 'percent', value: 10, days: notToday() });
  await makeOffer(far, { title: 'Explorer deal', kind: 'flat', value: 150, minLevel: 4 });
  await makeOffer(near, { title: 'Explorer near', kind: 'percent', value: 30, minLevel: 4 });
  await makeOffer(near, { title: 'Host deal', kind: 'percent', value: 40, minLevel: 6 });
  const u = await makeUser({ name: 'Diya' });
  await setXp(u, 100); // level 3

  const r = await call('GET', '/v1/me/perks?lat=23.037&lng=72.56', { token: u.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.level, { level: 3, name: 'Regular' });
  assert.equal(r.body.showUpRate, 1);
  assert.equal(r.body.plansConsidered, 0);
  assert.deepEqual(r.body.unlocked.map((x) => x.offer.title), ['Near treat', 'Far deal'], 'nearest first');
  assert.deepEqual(r.body.unlocked[1].offer.eligibility.reasons, ['not_now'], 'unlocked can still be not_now');
  assert.deepEqual(r.body.locked.map((x) => x.offer.title), ['Explorer near', 'Host deal', 'Explorer deal']);
  const v = r.body.unlocked[0].venue;
  assert.deepEqual(Object.keys(v).sort(), ['area', 'categories', 'distanceM', 'id', 'name', 'venueType']);
  assert.equal(v.distanceM, 300, 'coarse distance');
  assert.deepEqual(r.body.nextUnlock, { level: 4, name: 'Explorer', xpNeeded: 60, offers: 2 });

  const byName = await call('GET', '/v1/me/perks', { token: u.token });
  assert.deepEqual(byName.body.unlocked.map((x) => x.offer.title), ['Far deal', 'Near treat'], 'no location: by venue name');
  assert.equal(byName.body.unlocked[0].venue.distanceM, null);

  await setXp(u, 700);
  const top = await call('GET', '/v1/me/perks', { token: u.token });
  assert.equal(top.body.locked.length, 0);
  assert.equal(top.body.nextUnlock, null);
});

test('partnerVisits: counted in every stats window and usable as a quest criterion', async (t) => {
  if (skip) return t.skip(skip);
  const { evaluateQuest } = require('../src/lib/quests');
  const S = require('../src/services/progress');
  const p = await partner();
  const o = await makeOffer(p, { perUserPerWeek: 7 });
  const u = await makeUser({ name: 'Yash' });
  const before = await S.computeStats(u.id);
  assert.deepEqual([before.day.partnerVisits, before.week.partnerVisits, before.all.partnerVisits], [0, 0, 0]);

  const r = await call('POST', `/v1/offers/${o.id}/redeem`, { token: u.token, body: {} });
  await call('POST', '/v1/business/redemptions/confirm', { token: p.staff.token, body: { code: r.body.redemption.code } });
  // An old visit (40 days ago) counts towards "all" only.
  await models().OfferRedemption.create({ offerId: o.id, venueId: p.venue._id, businessId: p.business._id, userId: u.id, code: 'OLDOLD', status: 'redeemed', issuedAt: new Date(Date.now() - 40 * 86400000), expiresAt: new Date(Date.now() - 40 * 86400000 + 1200000), redeemedAt: new Date(Date.now() - 40 * 86400000), weekKey: '2026-01-04' });
  // Issued but not confirmed codes never count.
  await call('POST', `/v1/offers/${o.id}/redeem`, { token: u.token, body: {} });

  const s = await S.computeStats(u.id);
  assert.deepEqual([s.day.partnerVisits, s.week.partnerVisits, s.all.partnerVisits], [1, 1, 2]);
  assert.deepEqual(evaluateQuest({ type: 'partner_visits', count: 2, window: 'week' }, s), { progress: 1, total: 2, done: false });
  assert.deepEqual(evaluateQuest({ type: 'partnerVisits', count: 2, window: 'all' }, s), { progress: 2, total: 2, done: true });
  assert.equal(evaluateQuest({ type: 'partner_visits', count: 1 }, null).progress, 0);

  // Admins can create the quest; the quest list shows server-evaluated progress.
  const admin = await makeUser({ name: 'Ada', roles: ['admin'] });
  const q = await call('POST', '/v1/admin/taxonomy/quests', {
    token: admin.token,
    body: { slug: 'q_partner_2', kind: 'weekly', title: 'Visit 2 partner places', description: 'Show your perk code at 2 partner places this week', criteria: { type: 'partner_visits', count: 2, window: 'week' }, xpReward: 50, reason: 'Partner launch' },
  });
  assert.equal(q.status, 201, JSON.stringify(q.body));
  const quests = await S.questsFor(u.id);
  const mine = quests.find((x) => x.quest.slug === 'q_partner_2');
  assert.equal(mine.progress, 1);
  assert.equal(mine.state, 'started');
});

test('admin: businesses review list, offers moderation, redemptions', async (t) => {
  if (skip) return t.skip(skip);
  const { BusinessProfile, AuditEvent } = models();
  const admin = await makeUser({ name: 'Ada', roles: ['admin'] });
  const mod = await makeUser({ name: 'Mo', roles: ['moderator'] });
  const v1 = await partner({ name: 'Verified One' });
  const pend1 = await partner({ name: 'Pending Old', verified: false });
  await BusinessProfile.updateOne({ _id: pend1.business._id }, { $set: { createdAt: new Date(Date.now() - 5 * 86400000), verificationDocKey: `venue_proof/${pend1.owner.id}/doc.pdf`, gstin: '24ABCDE1234F1Z5', contactEmail: 'old@pending.example' } }, { timestamps: false });
  const pend2 = await partner({ name: 'Pending New', verified: false });
  await partner({ name: 'Rejected', verified: false }).then((x) => BusinessProfile.updateOne({ _id: x.business._id }, { $set: { verificationStatus: 'rejected' } }));
  const o1 = await makeOffer(v1, { title: 'Live one' });
  const o2 = await makeOffer(v1, { title: 'Paused one', status: 'paused' });
  await makeOffer(pend1, { title: 'Waiting one' });
  const u = await makeUser({ name: 'Guest User' });
  const r = await call('POST', `/v1/offers/${o1.id}/redeem`, { token: u.token, body: {} });
  await call('POST', '/v1/business/redemptions/confirm', { token: v1.staff.token, body: { code: r.body.redemption.code } });
  await call('POST', `/v1/offers/${o1.id}/redeem`, { token: u.token, body: {} }).then(() => null); // weekly limit: not issued

  assert.equal((await call('GET', '/v1/admin/businesses', { token: mod.token })).status, 403);
  const pending = await call('GET', '/v1/admin/businesses', { token: admin.token });
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.deepEqual(pending.body.counts, { pending: 2, verified: 1, rejected: 1, suspended: 0 });
  assert.deepEqual(pending.body.items.map((b) => b.name), ['Pending Old Pvt Ltd', 'Pending New Pvt Ltd'], 'pending: oldest first');
  const first = pending.body.items[0];
  assert.equal(first.proofUrl, null, 'storage not configured → null, never an error');
  assert.equal(first.gstin, '24ABCDE1234F1Z5');
  assert.deepEqual(first.contact, { name: null, phone: null, email: 'old@pending.example' });
  assert.deepEqual(first.owner, { id: pend1.owner.id, displayName: 'Pending Old Owner' });
  assert.equal(first.venue.name, 'Pending Old');
  assert.equal(first.venue.verified, false);
  assert.deepEqual(first.venue.categories, ['chai']);
  assert.deepEqual(first.offers, { active: 1, total: 1 });
  assert.equal(first.verifiedVisits30d, 0);
  assert.equal(pending.body.nextCursor, null);
  const paged = await call('GET', '/v1/admin/businesses?limit=1', { token: admin.token });
  assert.equal(paged.body.items.length, 1);
  assert.ok(paged.body.nextCursor);
  const page2 = await call('GET', `/v1/admin/businesses?limit=1&cursor=${paged.body.nextCursor}`, { token: admin.token });
  assert.equal(page2.body.items[0].id, pend2.business._id);
  const verified = await call('GET', '/v1/admin/businesses?status=verified', { token: admin.token });
  assert.deepEqual(verified.body.items.map((b) => b.name), ['Verified One Pvt Ltd']);
  assert.deepEqual(verified.body.items[0].offers, { active: 1, total: 2 });
  assert.equal(verified.body.items[0].verifiedVisits30d, 1);
  assert.equal((await call('GET', '/v1/admin/businesses?status=all', { token: admin.token })).body.items.length, 4);
  assert.equal((await call('GET', '/v1/admin/businesses?status=bogus', { token: admin.token })).status, 400);

  // Offers moderation.
  const active = await call('GET', '/v1/admin/offers', { token: admin.token });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  assert.deepEqual(active.body.items.map((o) => o.title), ['Waiting one', 'Live one'], 'active only, newest first');
  const live = active.body.items[1];
  assert.equal(live.label, '15% off');
  assert.equal(live.status, 'active');
  assert.deepEqual(live.stats, { week: 1, total: 1 });
  assert.deepEqual(live.business, { id: v1.business._id, name: 'Verified One Pvt Ltd', verificationStatus: 'verified' });
  assert.deepEqual(live.venue, { id: v1.venue._id, name: 'Verified One', area: 'Navrangpura' });
  assert.equal(live.eligibility, undefined);
  assert.equal((await call('GET', '/v1/admin/offers?status=paused', { token: admin.token })).body.items[0].id, o2.id);
  assert.equal((await call('GET', '/v1/admin/offers?status=all', { token: admin.token })).body.items.length, 3);
  const noReason = await call('POST', `/v1/admin/offers/${o1.id}/status`, { token: admin.token, body: { status: 'paused' } });
  assert.equal(noReason.status, 400);
  const paused = await call('POST', `/v1/admin/offers/${o1.id}/status`, { token: admin.token, body: { status: 'paused', reason: 'Misleading title' } });
  assert.deepEqual(paused.body, { id: o1.id, status: 'paused' });
  assert.ok(await AuditEvent.exists({ action: 'offer.status.paused', targetId: o1.id }));
  assert.equal((await call('GET', `/v1/venues/${v1.venue._id}`, { token: u.token })).body.offers.length, 0);
  assert.equal((await call('POST', `/v1/admin/offers/${crypto.randomUUID()}/status`, { token: admin.token, body: { status: 'ended', reason: 'Gone' } })).body.code, 'offer_not_found');

  // Redemptions across venues.
  const reds = await call('GET', '/v1/admin/redemptions', { token: admin.token });
  assert.equal(reds.status, 200, JSON.stringify(reds.body));
  assert.equal(reds.body.items.length, 1);
  const x = reds.body.items[0];
  assert.equal(x.status, 'redeemed');
  assert.equal(x.groupSize, 1);
  assert.deepEqual(x.offer, { id: o1.id, title: 'Live one', label: '15% off' });
  assert.deepEqual(x.venue, { id: v1.venue._id, name: 'Verified One', area: 'Navrangpura' });
  assert.deepEqual(x.user, { id: u.id, displayName: 'Guest User' });
  assert.equal(reds.body.nextCursor, null);
});
