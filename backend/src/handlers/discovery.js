'use strict';
// Discovery: activities near a point or a chosen area, featured plans, categories,
// available-now people (coarse only), search, venues, my plans, my availability.
const { err } = require('../lib/http');
const { check } = require('../lib/validate');
const { requireUser } = require('../lib/auth');
const geo = require('../lib/geo');
const { pageParams, encodeCursor } = require('../lib/page');
const { istDay } = require('../lib/xp');
const P = require('../lib/present');
const SM = require('../lib/socialMatch');
const A = require('../services/activities');
const Perks = require('../services/perks');

const models = () => require('../models');

// Fetch limit+1 rows, present the first `limit` (hidden hosts dropped), cursor by offset.
async function pageActivities(rows, page, viewerId, opts) {
  const more = rows.length > page.limit;
  const items = await A.presentMany(rows.slice(0, page.limit), viewerId, opts);
  return { items, nextCursor: more ? encodeCursor({ o: page.offset + page.limit }) : null };
}

// The viewer's social style ('introvert'|'ambivert'|'extrovert') or null.
async function socialStyleOf(userId) {
  const { User } = models();
  const u = await User.findById(userId).select('profile.socialStyle').lean();
  return P.socialStyleOf(u && u.profile);
}

async function availabilityOf(userId) {
  const { User } = models();
  const u = await User.findById(userId).select('availability').lean();
  const av = (u && u.availability) || {};
  if (!av.status) return { status: 'busy', activities: [], until: null, area: null };
  const expired = av.until && new Date(av.until) < new Date();
  return { status: expired ? 'busy' : av.status, activities: av.activitySlugs || [], until: av.until || null, area: av.area || null };
}

async function completedCounts(userIds) {
  const { Participant } = models();
  if (!userIds.length) return new Map();
  const rows = await Participant.aggregate([{ $match: { userId: { $in: userIds }, state: 'completed' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

// Venues ---------------------------------------------------------------------
// viewerId: the signed-in app user; their offers carry `eligibility`.
async function venueExtras(venues, { viewerId = null, now = new Date() } = {}) {
  const { BusinessProfile, SponsoredCampaign } = models();
  const bizIds = [...new Set(venues.map((v) => v.businessId).filter(Boolean))];
  const [bizRows, active] = await Promise.all([
    bizIds.length ? BusinessProfile.find({ _id: { $in: bizIds } }).select('name verificationStatus').lean() : [],
    bizIds.length ? SponsoredCampaign.distinct('businessId', { businessId: { $in: bizIds }, status: 'active' }) : [],
  ]);
  const biz = new Map(bizRows.map((b) => [b._id, b]));
  // Partner perks (VenueOffer) supersede the legacy Mixed `offers` field on Venue documents.
  const offers = await Perks.offersForVenues(venues, { biz, viewerId, now });
  return { biz, sponsored: new Set(active), offers };
}

function presentVenue(v, { biz, sponsored, offers } = { biz: new Map(), sponsored: new Set(), offers: new Map() }) {
  const b = v.businessId ? biz.get(v.businessId) : null;
  return {
    id: v._id,
    name: v.name,
    area: v.area || null,
    address: v.address || null,
    venueType: v.venueType || null,
    categories: v.categorySlugs || [],
    description: v.description || null,
    ...Perks.venueOfferFields(offers && offers.get(v._id)),
    bookingUrl: v.bookingUrl || null,
    verified: !!v.verified,
    sponsored: !!(v.businessId && sponsored.has(v.businessId)),
    latitude: v.latitude ?? null, // venues are public businesses; exact location is intended
    longitude: v.longitude ?? null,
    distanceM: v.distanceM != null ? geo.coarseDistanceMeters(Number(v.distanceM)) : null,
    business: v.businessId ? { id: v.businessId, name: b ? b.name : null, verified: !!b && b.verificationStatus === 'verified' } : null,
  };
}

async function verifiedBusinessFilter() {
  const { BusinessProfile } = models();
  const unverified = await BusinessProfile.distinct('_id', { verificationStatus: { $ne: 'verified' } });
  return { $or: [{ businessId: null }, { businessId: { $nin: unverified } }] };
}

const routes = {
  'GET /v1/activities': async (req) => {
    const user = await requireUser(req);
    const q = check(
      {
        radius: { type: 'number', min: 0.2, max: geo.MAX_RADIUS_KM },
        // one slug, or a comma-separated list (up to 10), e.g. "chai,run"
        category: { type: 'string', max: 400, pattern: /^[a-z0-9][a-z0-9_-]{1,39}(,[a-z0-9][a-z0-9_-]{1,39}){0,9}$/ },
        when: { type: 'string', enum: A.WHEN, default: 'any' },
        q: { type: 'string', max: 80 },
      },
      req.query
    );
    const point = await A.referencePoint(req.query);
    const page = pageParams(req.query);
    const [rows, style] = await Promise.all([
      A.findActivities(user.id, { point, radiusKm: q.radius, category: q.category, when: q.when, q: q.q, limit: page.fetchLimit, offset: page.offset }),
      socialStyleOf(user.id),
    ]);
    const out = await pageActivities(rows, page, user.id);
    // Gentle social-style nudge inside this page only (start time stays the main order).
    if (style) out.items = SM.rankPlans(out.items, style);
    return { ...out, rankedFor: style };
  },

  'GET /v1/activities/featured': async (req) => {
    const user = await requireUser(req);
    const point = await A.referencePoint(req.query);
    const rows = await A.findActivities(user.id, { point, radiusKm: req.query.radius, limit: 3, offset: 0, order: 'featured', notFull: true });
    return { items: await A.presentMany(rows, user.id, { featured: true }), nextCursor: null };
  },

  'GET /v1/activities/categories': async (req) => {
    await requireUser(req, { allowSuspended: true });
    const { Category } = models();
    const rows = await Category.find({ isActive: true, riskLevel: { $ne: 'restricted' } }).sort({ sortOrder: 1, label: 1 }).lean();
    return { items: rows.map(P.category), nextCursor: null };
  },

  'GET /v1/activities/{activityId}': async (req) => {
    const user = await requireUser(req);
    const point = await A.referencePoint(req.query).catch(() => null);
    const doc = await A.getVisible(req.params.activityId, user.id, { point });
    if (!doc) throw err.notFound('activity_not_found');
    if (doc.hostUserId !== user.id) {
      // Plan views feed venue analytics (counts only; viewers are not recorded).
      const { ActivityDailyMetric } = models();
      await ActivityDailyMetric.updateOne({ activityId: doc._id, day: istDay() }, { $inc: { views: 1 } }, { upsert: true }).catch(() => {});
    }
    const [a] = await A.presentMany([doc], user.id, { keepHidden: true });
    return a;
  },

  'PUT /v1/me/availability': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        status: { type: 'string', required: true, enum: ['now', 'later', 'busy'] },
        activities: { type: 'array', max: 5, unique: true, items: { type: 'string', format: 'slug' }, default: () => [] },
        until: { type: 'string', format: 'datetime', nullable: true },
        lat: { type: 'number', min: -90, max: 90 },
        lng: { type: 'number', min: -180, max: 180 },
        area: { type: 'string', max: 60 },
      },
      req.body
    );
    let until = v.until || null;
    if (v.status === 'now' && !until) until = new Date(Date.now() + 2 * 3600000).toISOString();
    if (until && new Date(until).getTime() > Date.now() + 24 * 3600000) throw err.badRequest('until_too_far', 'Availability can be set up to 24 hours ahead');
    // Only a ~1.2 km geohash cell is stored; the precise point is discarded here.
    let cell = null;
    if (v.lat != null && v.lng != null) cell = geo.cellId(v.lat, v.lng);
    else if (v.area) {
      const p = await A.referencePoint({ area: v.area });
      if (p) cell = geo.cellId(p.lat, p.lng);
    }
    const { User } = models();
    const set = {
      'availability.status': v.status,
      'availability.activitySlugs': v.activities,
      'availability.until': until ? new Date(until) : null,
      'availability.updatedAt': new Date(),
    };
    if (v.area) set['availability.area'] = v.area;
    if (cell) set['availability.coarseCell'] = cell;
    await User.updateOne({ _id: user.id }, { $set: set });
    return availabilityOf(user.id);
  },

  'GET /v1/availability/nearby': async (req) => {
    const user = await requireUser(req);
    const point = await A.referencePoint(req.query);
    if (!point) throw err.badRequest('location_required', 'Send lat/lng or choose an area');
    const page = pageParams(req.query, { def: 20, max: 50 });
    const radiusKm = geo.clampRadiusKm(req.query.radius);
    const { User } = models();
    const [scope, myStyle] = await Promise.all([A.viewerScope(user.id), socialStyleOf(user.id)]);
    const prefixes = A.coveringPrefixes(point.lat, point.lng, radiusKm);
    const now = new Date();
    const candidates = await User.find({
      _id: { $nin: [user.id, ...scope.blocked] },
      status: 'active',
      'profile.visibility': 'discoverable',
      'profile.preferences.showOnRadar': { $ne: false },
      'availability.status': { $in: ['now', 'later'] },
      $or: [{ 'availability.until': null }, { 'availability.until': { $gt: now } }],
      'availability.coarseCell': { $in: prefixes.map((p) => new RegExp(`^${p}`)) },
    })
      .select('profile progress availability preferences.avatarSeed')
      .limit(1000)
      .lean();
    // Best social-energy match first (nobody is filtered out), then free now, then nearest.
    const compat = (u) => SM.styleCompat(myStyle, u.profile && u.profile.socialStyle) ?? SM.NEUTRAL;
    const withDist = candidates
      .map((u) => {
        const c = A.geohashCenter(u.availability.coarseCell);
        return c ? { u, d: geo.haversineMeters({ latitude: point.lat, longitude: point.lng }, c), c: compat(u) } : null;
      })
      .filter((x) => x && x.d <= radiusKm * 1000)
      .sort((a, b) => b.c - a.c || (b.u.availability.status === 'now') - (a.u.availability.status === 'now') || a.d - b.d);
    const slice = withDist.slice(page.offset, page.offset + page.limit);
    const counts = await completedCounts(slice.map((x) => x.u._id));
    const items = await Promise.all(slice.map((x) => P.publicUser(x.u, { distanceM: x.d, completed: counts.get(x.u._id) || 0, area: x.u.availability.area || undefined })));
    return { items, nextCursor: withDist.length > page.offset + page.limit ? encodeCursor({ o: page.offset + page.limit }) : null };
  },

  'GET /v1/me/activities': async (req) => {
    const user = await requireUser(req);
    const { tab } = check({ tab: { type: 'string', enum: ['hosted', 'joined', 'past', 'cancelled'], default: 'joined' } }, req.query);
    const page = pageParams(req.query);
    const { Participant, Activity } = models();
    const mine = await Participant.find({ userId: user.id }).select('activityId state').lean();
    const idsIn = (states) => mine.filter((m) => states.includes(m.state)).map((m) => m.activityId);
    const allIds = mine.map((m) => m.activityId);
    const now = new Date();
    const filter = {
      hosted: { _id: { $in: allIds }, hostUserId: user.id, status: { $nin: ['cancelled', 'moderated'] }, endsAt: { $gt: new Date(now.getTime() - 6 * 3600000) } },
      joined: { _id: { $in: idsIn(['requested', 'accepted', 'waitlisted', 'checked_in']) }, hostUserId: { $ne: user.id }, status: { $nin: ['cancelled', 'moderated'] }, endsAt: { $gt: now } },
      past: { _id: { $in: idsIn(['accepted', 'checked_in', 'completed', 'no_show']) }, $or: [{ endsAt: { $lte: now } }, { status: 'completed' }] },
      cancelled: { $or: [{ _id: { $in: allIds }, hostUserId: user.id, status: { $in: ['cancelled', 'moderated'] } }, { _id: { $in: idsIn(['cancelled', 'declined']) } }] },
    }[tab];
    const dir = tab === 'past' || tab === 'cancelled' ? -1 : 1;
    const rows = await Activity.find(filter).sort({ startsAt: dir, _id: dir }).skip(page.offset).limit(page.fetchLimit).lean();
    return pageActivities(rows, page, user.id, { keepHidden: true });
  },

  'GET /v1/search': async (req) => {
    const user = await requireUser(req);
    const { q } = check({ q: { type: 'string', required: true, min: 2, max: 80 } }, req.query);
    const point = await A.referencePoint(req.query).catch(() => null);
    const re = new RegExp(A.escapeRegex(q), 'i');
    const { User, Venue } = models();
    const scope = await A.viewerScope(user.id);
    const [acts, people, venues] = await Promise.all([
      A.findActivities(user.id, { point, radiusKm: req.query.radius || geo.MAX_RADIUS_KM, q, limit: 10, offset: 0 }),
      User.find({ _id: { $nin: [user.id, ...scope.blocked] }, status: 'active', 'profile.visibility': 'discoverable', 'profile.displayName': re })
        .select('profile progress availability preferences.avatarSeed')
        .sort({ 'profile.displayName': 1 })
        .limit(10)
        .lean(),
      Venue.find({ verified: true, $or: [{ name: re }, { area: re }] })
        .sort({ name: 1 })
        .limit(10)
        .lean(),
    ]);
    const counts = await completedCounts(people.map((u) => u._id));
    const extras = await venueExtras(venues, { viewerId: user.id });
    return {
      activities: await A.presentMany(acts, user.id),
      people: await Promise.all(people.map((u) => P.publicUser(u, { completed: counts.get(u._id) || 0, area: (u.profile && u.profile.homeArea) || undefined }))),
      venues: venues.map((v) => presentVenue(v, extras)),
    };
  },

  'GET /v1/venues': async (req) => {
    const user = await requireUser(req);
    const q = check({ category: { type: 'string', format: 'slug' }, hasOffer: { type: 'boolean' } }, req.query);
    const point = await A.referencePoint(req.query).catch(() => null);
    const page = pageParams(req.query);
    const { Venue, VenueOffer } = models();
    const now = new Date();
    const and = [{ verified: true, isPublicPlace: true }, await verifiedBusinessFilter(), ...(q.category ? [{ categorySlugs: q.category }] : [])];
    if (q.hasOffer) and.push({ _id: { $in: await VenueOffer.distinct('venueId', Perks.liveOfferFilter(now)) } });
    const filter = { $and: and };
    let rows;
    if (point) {
      rows = await Venue.aggregate([
        geo.geoNearStage(point.lat, point.lng, geo.MAX_RADIUS_KM, { query: filter }),
        { $sort: { distanceM: 1, name: 1 } },
        { $skip: page.offset },
        { $limit: page.fetchLimit },
      ]);
      // Venues without coordinates are listed after the nearby ones.
      if (rows.length < page.fetchLimit) {
        const nearIds = rows.map((r) => r._id);
        const rest = await Venue.find({ $and: [filter, { location: { $exists: false } }, { _id: { $nin: nearIds } }] })
          .sort({ name: 1 })
          .limit(page.fetchLimit - rows.length)
          .lean();
        rows = rows.concat(rest);
      }
    } else {
      rows = await Venue.find(filter).sort({ name: 1 }).skip(page.offset).limit(page.fetchLimit).lean();
    }
    const more = rows.length > page.limit;
    const list = rows.slice(0, page.limit);
    const extras = await venueExtras(list, { viewerId: user.id, now });
    return { items: list.map((v) => presentVenue(v, extras)), nextCursor: more ? encodeCursor({ o: page.offset + page.limit }) : null };
  },

  'GET /v1/venues/{venueId}': async (req) => {
    const user = await requireUser(req);
    const { Venue, Activity } = models();
    const v = await Venue.findOne({ _id: String(req.params.venueId), verified: true }).lean();
    if (!v) throw err.notFound('venue_not_found');
    const scope = await A.viewerScope(user.id);
    const match = [{ venueId: v._id }, { venueName: v.name }];
    if (v.location) match.push({ location: { $geoWithin: { $centerSphere: [v.location.coordinates, 0.075 / 6378.1] } } });
    const upcoming = await Activity.find({
      $and: [A.visibleFilter(scope), { status: { $in: ['open', 'full'] } }, { endsAt: { $gt: new Date() } }, { $or: match }],
    })
      .sort({ startsAt: 1 })
      .limit(10)
      .lean();
    const extras = await venueExtras([v], { viewerId: user.id });
    return { ...presentVenue(v, extras), upcomingPlans: await A.presentMany(upcoming, user.id) };
  },
};

module.exports = { routes, availabilityOf, presentVenue, venueExtras, findActivities: A.findActivities, referencePoint: A.referencePoint };
