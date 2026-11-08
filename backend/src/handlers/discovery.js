'use strict';
// Discovery: activities near a point or a chosen area, featured plans,
// categories, available-now people (coarse only), search, venues, my plans.
const { createRouter, err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const geo = require('../lib/geo');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const A = require('../services/activities');

const WHEN = ['any', 'now', 'today', 'tonight', 'tomorrow', 'weekend'];
const IST_NOW_DATE = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
const IST_START_DATE = "(a.starts_at AT TIME ZONE 'Asia/Kolkata')::date";

const likeParam = (q) => `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

// Resolve the reference point: device coords, else a named city area, else none (city-wide).
async function referencePoint(query) {
  const lat = query.lat != null ? Number(query.lat) : null;
  const lng = query.lng != null ? Number(query.lng) : null;
  if (lat != null || lng != null) {
    if (!geo.isValidCoord(lat, lng)) throw err.badRequest('invalid_location');
    return { lat, lng };
  }
  if (query.area) {
    const row = await db.one('SELECT ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM city_areas WHERE active AND lower(name) = lower($1) LIMIT 1', [query.area]);
    if (row) return { lat: row.lat, lng: row.lng, area: query.area };
  }
  return null;
}

function whenClause(when) {
  switch (when) {
    case 'now':
      return "a.starts_at <= now() + interval '90 minutes'";
    case 'today':
      return `${IST_START_DATE} = ${IST_NOW_DATE}`;
    case 'tonight':
      return `${IST_START_DATE} = ${IST_NOW_DATE} AND extract(hour FROM a.starts_at AT TIME ZONE 'Asia/Kolkata') >= 17`;
    case 'tomorrow':
      return `${IST_START_DATE} = ${IST_NOW_DATE} + 1`;
    case 'weekend':
      return `${IST_START_DATE} BETWEEN ${IST_NOW_DATE} AND ${IST_NOW_DATE} + 7 AND extract(isodow FROM a.starts_at AT TIME ZONE 'Asia/Kolkata') IN (6, 7)`;
    default:
      return null;
  }
}

// Shared activity search used by /activities, /activities/featured, /search and the assistant.
async function findActivities(viewerId, { point, radiusKm, category, when, q, limit, offset, order = 'time', notFull = false }) {
  const params = [viewerId];
  const add = (v) => (params.push(v), `$${params.length}`);
  let distanceSql = 'NULL::float8';
  const where = [A.VISIBLE_TO_VIEWER, A.NOT_BLOCKED, "a.status IN ('open','full','in_progress')", 'a.ends_at > now()'];
  if (point) {
    const pt = `ST_SetSRID(ST_MakePoint(${add(point.lng)}, ${add(point.lat)}), 4326)::geography`;
    distanceSql = `ST_Distance(a.geog, ${pt})`;
    where.push(`ST_DWithin(a.geog, ${pt}, ${add(geo.clampRadiusKm(radiusKm) * 1000)})`);
  }
  if (category) where.push(`c.slug = ${add(category)}`);
  const w = whenClause(when);
  if (w) where.push(w);
  if (q) {
    const p = add(likeParam(q));
    where.push(`(a.title ILIKE ${p} OR a.description ILIKE ${p} OR a.coarse_area ILIKE ${p} OR c.label ILIKE ${p} OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE t ILIKE ${p}))`);
  }
  if (notFull) where.push("a.status = 'open'");
  const orderSql =
    order === 'featured'
      ? `(a.starts_at <= now() + interval '30 minutes') DESC, hp.reliability_score DESC, distance_m ASC NULLS LAST, a.starts_at ASC`
      : 'a.starts_at ASC, distance_m ASC NULLS LAST';
  const sql = `SELECT ${A.SELECT_COLUMNS}, ${distanceSql} AS distance_m ${A.FROM}
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderSql}
     LIMIT ${add(limit)} OFFSET ${add(offset)}`;
  const { rows } = await db.query(sql, params);
  return rows;
}

const presentRow = (viewerId, featured) => (r) => A.present(r, { viewerId, distanceM: r.distance_m == null ? null : Number(r.distance_m), featured });

async function availabilityOf(userId) {
  const r = await db.one('SELECT status, activity_slugs, area, available_until FROM availability_status WHERE user_id = $1', [userId]);
  if (!r) return { status: 'busy', activities: [], until: null, area: null };
  const expired = r.available_until && new Date(r.available_until) < new Date();
  return { status: expired ? 'busy' : r.status, activities: r.activity_slugs, until: r.available_until, area: r.area };
}

function presentVenue(r) {
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    address: r.address,
    venueType: r.venue_type,
    categories: r.category_slugs || [],
    description: r.description,
    offers: r.offers || [],
    bookingUrl: r.booking_url,
    verified: r.verified,
    sponsored: !!r.sponsored,
    latitude: r.latitude, // venues are public businesses; exact location is intended
    longitude: r.longitude,
    distanceM: r.distance_m != null ? geo.coarseDistanceMeters(Number(r.distance_m)) : null,
    business: r.business_id ? { id: r.business_id, name: r.business_name, verified: r.verification_status === 'verified' } : null,
  };
}

const routes = {
  'GET /v1/activities': async (req) => {
    const user = await requireUser(req);
    const q = check(
      {
        radius: { type: 'number', min: 0.2, max: geo.MAX_RADIUS_KM },
        category: { type: 'string', format: 'slug' },
        when: { type: 'string', enum: WHEN, default: 'any' },
        q: { type: 'string', max: 80 },
      },
      req.query
    );
    const point = await referencePoint(req.query);
    const page = pageParams(req.query);
    const rows = await findActivities(user.id, { point, radiusKm: q.radius, category: q.category, when: q.when, q: q.q, limit: page.sqlLimit, offset: page.offset });
    return pageOf(rows, page, presentRow(user.id, false));
  },

  'GET /v1/activities/featured': async (req) => {
    const user = await requireUser(req);
    const point = await referencePoint(req.query);
    const rows = await findActivities(user.id, { point, radiusKm: req.query.radius, limit: 3, offset: 0, order: 'featured', notFull: true });
    return { items: rows.map(presentRow(user.id, true)), nextCursor: null };
  },

  'GET /v1/activities/categories': async (req) => {
    await requireUser(req, { allowSuspended: true });
    const rows = await db.many('SELECT slug, label, short, pictogram, risk_level FROM activity_categories WHERE is_active AND risk_level <> $1 ORDER BY sort_order, label', ['restricted']);
    return { items: rows.map(P.category), nextCursor: null };
  },

  'GET /v1/activities/{activityId}': async (req) => {
    const user = await requireUser(req);
    const point = await referencePoint(req.query).catch(() => null);
    const params = [user.id, req.params.activityId];
    let dist = 'NULL::float8';
    if (point) {
      params.push(point.lng, point.lat);
      dist = 'ST_Distance(a.geog, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)';
    }
    const row = await db.one(`SELECT ${A.SELECT_COLUMNS}, ${dist} AS distance_m ${A.FROM} WHERE a.id = $2 AND ${A.VISIBLE_TO_VIEWER} AND ${A.NOT_BLOCKED}`, params);
    if (!row) throw err.notFound('activity_not_found');
    if (row.host_user_id !== user.id) {
      // Plan views feed venue analytics (counts only; viewers are not recorded).
      await db.query(
        "INSERT INTO activity_daily_metrics (activity_id, day, views) VALUES ($1, (now() AT TIME ZONE 'Asia/Kolkata')::date, 1) ON CONFLICT (activity_id, day) DO UPDATE SET views = activity_daily_metrics.views + 1",
        [row.id]
      ).catch(() => {});
    }
    return presentRow(user.id, false)(row);
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
    let geohashSql = 'NULL';
    const params = [user.id, v.status, v.activities, until, v.area || null];
    if (v.lat != null && v.lng != null) {
      params.push(v.lng, v.lat);
      geohashSql = 'ST_GeoHash(ST_SetSRID(ST_MakePoint($6, $7), 4326), 6)';
    } else if (v.area) {
      geohashSql = "(SELECT ST_GeoHash(centroid::geometry, 6) FROM city_areas WHERE lower(name) = lower($5) LIMIT 1)";
    }
    await db.query(
      `INSERT INTO availability_status (user_id, status, activity_slugs, available_until, area, coarse_geohash, updated_at)
       VALUES ($1, $2, $3, $4, $5, ${geohashSql}, now())
       ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, activity_slugs = EXCLUDED.activity_slugs,
         available_until = EXCLUDED.available_until, area = COALESCE(EXCLUDED.area, availability_status.area),
         coarse_geohash = COALESCE(EXCLUDED.coarse_geohash, availability_status.coarse_geohash), updated_at = now()`,
      params
    );
    return availabilityOf(user.id);
  },

  'GET /v1/availability/nearby': async (req) => {
    const user = await requireUser(req);
    const point = await referencePoint(req.query);
    if (!point) throw err.badRequest('location_required', 'Send lat/lng or choose an area');
    const page = pageParams(req.query, { def: 20, max: 50 });
    const radiusM = geo.clampRadiusKm(req.query.radius) * 1000;
    const rows = await db.many(
      `SELECT u.id, p.display_name, p.avatar_key, p.reliability_score, p.interests, av.area, av.status AS availability_status, av.activity_slugs,
              COALESCE(up.level, 1) AS level,
              (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'completed') AS completed,
              ST_Distance(ST_PointFromGeoHash(av.coarse_geohash)::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS distance_m
         FROM availability_status av
         JOIN app_users u ON u.id = av.user_id AND u.status = 'active'
         JOIN profiles p ON p.user_id = u.id AND p.visibility = 'discoverable' AND COALESCE((p.preferences->>'showOnRadar')::boolean, TRUE)
         LEFT JOIN user_progress up ON up.user_id = u.id
        WHERE av.status IN ('now','later') AND (av.available_until IS NULL OR av.available_until > now())
          AND av.coarse_geohash IS NOT NULL AND u.id <> $1
          AND ST_DWithin(ST_PointFromGeoHash(av.coarse_geohash)::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = $1))
        ORDER BY (av.status = 'now') DESC, distance_m ASC
        LIMIT $5 OFFSET $6`,
      [user.id, point.lng, point.lat, radiusM, page.sqlLimit, page.offset]
    );
    const items = await Promise.all(rows.slice(0, page.limit).map((r) => P.publicUser(r, { distanceM: Number(r.distance_m) })));
    return { items, nextCursor: pageOf(rows, page).nextCursor };
  },

  'GET /v1/me/activities': async (req) => {
    const user = await requireUser(req);
    const { tab } = check({ tab: { type: 'string', enum: ['hosted', 'joined', 'past', 'cancelled'], default: 'joined' } }, req.query);
    const page = pageParams(req.query);
    const cond = {
      hosted: "a.host_user_id = $1 AND a.status NOT IN ('cancelled','moderated') AND a.ends_at > now() - interval '6 hours'",
      joined: "a.host_user_id <> $1 AND my.state IN ('requested','accepted','waitlisted','checked_in') AND a.status NOT IN ('cancelled','moderated') AND a.ends_at > now()",
      past: "(my.state IN ('accepted','checked_in','completed','no_show')) AND (a.ends_at <= now() OR a.status = 'completed')",
      cancelled: "((a.host_user_id = $1 AND a.status IN ('cancelled','moderated')) OR my.state IN ('cancelled','declined'))",
    }[tab];
    const orderDir = tab === 'past' || tab === 'cancelled' ? 'DESC' : 'ASC';
    const rows = await db.many(`SELECT ${A.SELECT_COLUMNS}, NULL::float8 AS distance_m ${A.FROM} WHERE my.user_id = $1 AND ${cond} ORDER BY a.starts_at ${orderDir} LIMIT $2 OFFSET $3`, [
      user.id,
      page.sqlLimit,
      page.offset,
    ]);
    return pageOf(rows, page, presentRow(user.id, false));
  },

  'GET /v1/search': async (req) => {
    const user = await requireUser(req);
    const { q } = check({ q: { type: 'string', required: true, min: 2, max: 80 } }, req.query);
    const point = await referencePoint(req.query).catch(() => null);
    const like = likeParam(q);
    const [acts, people, venues] = await Promise.all([
      findActivities(user.id, { point, radiusKm: req.query.radius || geo.MAX_RADIUS_KM, q, limit: 10, offset: 0 }),
      db.many(
        `SELECT u.id, p.display_name, p.avatar_key, p.reliability_score, p.interests, p.home_area AS area,
                COALESCE(av.status, 'busy') AS availability_status, av.activity_slugs, COALESCE(up.level, 1) AS level,
                (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'completed') AS completed
           FROM profiles p JOIN app_users u ON u.id = p.user_id AND u.status = 'active'
           LEFT JOIN availability_status av ON av.user_id = u.id AND (av.available_until IS NULL OR av.available_until > now())
           LEFT JOIN user_progress up ON up.user_id = u.id
          WHERE p.visibility = 'discoverable' AND p.display_name ILIKE $2 AND u.id <> $1
            AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = $1))
          ORDER BY p.display_name LIMIT 10`,
        [user.id, like]
      ),
      db.many(
        `SELECT v.*, b.name AS business_name, b.verification_status, EXISTS (SELECT 1 FROM sponsored_campaigns sc WHERE sc.business_id = v.business_id AND sc.status = 'active') AS sponsored, NULL::float8 AS distance_m FROM venues v LEFT JOIN business_profiles b ON b.id = v.business_id
          WHERE v.verified AND (v.name ILIKE $1 OR v.area ILIKE $1) ORDER BY v.name LIMIT 10`,
        [like]
      ),
    ]);
    return {
      activities: acts.map(presentRow(user.id, false)),
      people: await Promise.all(people.map((r) => P.publicUser(r))),
      venues: venues.map(presentVenue),
    };
  },

  'GET /v1/venues': async (req) => {
    await requireUser(req);
    const q = check({ category: { type: 'string', format: 'slug' } }, req.query);
    const point = await referencePoint(req.query).catch(() => null);
    const page = pageParams(req.query);
    const params = [q.category || null, page.sqlLimit, page.offset];
    let dist = 'NULL::float8';
    if (point) {
      params.push(point.lng, point.lat);
      dist = 'ST_Distance(v.geog, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography)';
    }
    const rows = await db.many(
      `SELECT v.*, b.name AS business_name, b.verification_status, EXISTS (SELECT 1 FROM sponsored_campaigns sc WHERE sc.business_id = v.business_id AND sc.status = 'active') AS sponsored, ${dist} AS distance_m
         FROM venues v LEFT JOIN business_profiles b ON b.id = v.business_id
        WHERE v.verified AND v.is_public_place AND ($1::text IS NULL OR $1 = ANY (v.category_slugs))
          AND (b.id IS NULL OR b.verification_status = 'verified')
        ORDER BY distance_m ASC NULLS LAST, v.name LIMIT $2 OFFSET $3`,
      params
    );
    return pageOf(rows, page, presentVenue);
  },

  'GET /v1/venues/{venueId}': async (req) => {
    const user = await requireUser(req);
    const v = await db.one(
      `SELECT v.*, b.name AS business_name, b.verification_status, EXISTS (SELECT 1 FROM sponsored_campaigns sc WHERE sc.business_id = v.business_id AND sc.status = 'active') AS sponsored, NULL::float8 AS distance_m
         FROM venues v LEFT JOIN business_profiles b ON b.id = v.business_id WHERE v.id = $1 AND v.verified`,
      [req.params.venueId]
    );
    if (!v) throw err.notFound('venue_not_found');
    const upcoming = await db.many(
      `SELECT ${A.SELECT_COLUMNS}, NULL::float8 AS distance_m ${A.FROM}
        WHERE ${A.VISIBLE_TO_VIEWER} AND ${A.NOT_BLOCKED} AND a.status IN ('open','full') AND a.ends_at > now()
          AND (a.venue_name = $2 OR (a.geog IS NOT NULL AND $3::geography IS NOT NULL AND ST_DWithin(a.geog, $3::geography, 75)))
        ORDER BY a.starts_at LIMIT 10`,
      [user.id, v.name, v.geog]
    );
    return { ...presentVenue(v), upcomingPlans: upcoming.map(presentRow(user.id, false)) };
  },
};

exports.findActivities = findActivities;
exports.referencePoint = referencePoint;
exports.presentVenue = presentVenue;
exports.availabilityOf = availabilityOf;
exports.handler = createRouter(routes);
