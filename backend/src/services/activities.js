'use strict';
// Shared activity queries, presentation and creation (discovery, activities,
// circles, assistant, admin). Activity shape matches mobile/src/data/seed.js.
const { err } = require('../lib/http');
const { check } = require('../lib/validate');
const geo = require('../lib/geo');
const { audit } = require('../lib/audit');
const { accentIndex, publicReliability } = require('../lib/present');

const IN_GROUP_STATES = ['accepted', 'checked_in', 'completed'];
const PRIVATE_VENUE_RE = /\b(home|residence|house|flat|apartment|hotel room|my place|bedroom)\b/i;

const ACTIVITY_FIELDS = {
  title: { type: 'string', required: true, min: 3, max: 80 },
  description: { type: 'string', max: 1000 },
  category: { type: 'string', required: true, format: 'slug' },
  startsAt: { type: 'string', required: true, format: 'datetime' },
  durationMin: { type: 'integer', required: true, min: 5, max: 720 },
  capacity: { type: 'integer', min: 2, max: 30, default: 4 },
  visibility: { type: 'string', enum: ['public', 'circle', 'invite_only'], default: 'public' },
  joinRule: { type: 'string', enum: ['approval', 'instant'], default: 'approval' },
  venueName: { type: 'string', max: 120 },
  venueType: { type: 'string', max: 40 },
  area: { type: 'string', required: true, max: 60 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  exactLocationAfterAccept: { type: 'boolean', default: true },
  cost: { type: 'string', max: 120 },
  tags: { type: 'array', max: 8, items: { type: 'string', max: 24 } },
  accessibility: { type: 'string', max: 300 },
  activityLevel: { type: 'string', enum: ['any', 'beginner', 'intermediate', 'advanced'], default: 'any' },
  circleId: { type: 'string', format: 'uuid' },
  venueId: { type: 'string', format: 'uuid' },
};

// $1 = viewer user id. Optional $2.. bound by callers for distance.
const SELECT_COLUMNS = `
  a.*, c.slug AS category_slug, c.pictogram AS category_pictogram,
  hp.display_name AS host_name, hp.avatar_key AS host_avatar_key, hp.reliability_score AS host_reliability,
  COALESCE(hup.level, 1) AS host_level,
  (SELECT count(*)::int FROM activity_participants hx WHERE hx.user_id = a.host_user_id AND hx.state = 'completed') AS host_completed,
  (SELECT COALESCE(array_agg(ap.user_id::text ORDER BY ap.decided_at NULLS LAST), '{}') FROM activity_participants ap
     WHERE ap.activity_id = a.id AND ap.state IN ('accepted','checked_in','completed')) AS participant_ids,
  my.state AS my_state, my.id AS my_request_id, my.waitlist_position AS my_waitlist_position,
  (SELECT cv.id FROM conversations cv WHERE cv.activity_id = a.id AND cv.kind = 'activity_group' LIMIT 1) AS group_conversation_id,
  (sc.status = 'active') AS is_sponsored, sc.label AS sponsored_label`;

const FROM = `
    FROM activities a
    JOIN app_users hu ON hu.id = a.host_user_id AND hu.status IN ('active','limited')
    JOIN profiles hp ON hp.user_id = a.host_user_id
    LEFT JOIN user_progress hup ON hup.user_id = a.host_user_id
    LEFT JOIN activity_categories c ON c.id = a.category_id
    LEFT JOIN activity_participants my ON my.activity_id = a.id AND my.user_id = $1
    LEFT JOIN sponsored_campaigns sc ON sc.id = a.sponsored_campaign_id`;

const SELECT = `SELECT ${SELECT_COLUMNS} ${FROM}`;

const NOT_BLOCKED = `NOT EXISTS (SELECT 1 FROM user_blocks b
   WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = a.host_user_id)
      OR (b.blocker_user_id = a.host_user_id AND b.blocked_user_id = $1))`;

const VISIBLE_TO_VIEWER = `(a.visibility = 'public'
   OR a.host_user_id = $1
   OR (a.visibility = 'circle' AND EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = a.circle_id AND cm.user_id = $1))
   OR my.user_id IS NOT NULL)
   AND a.status <> 'moderated'`;

function isLive(row, now = Date.now()) {
  return ['open', 'full', 'in_progress'].includes(row.status) && new Date(row.starts_at).getTime() <= now + 30 * 60000 && new Date(row.ends_at).getTime() > now;
}

// Activity model (mobile seed.js shape).
function present(row, { viewerId, distanceM, featured = false } = {}) {
  const isHost = row.host_user_id === viewerId;
  const accepted = IN_GROUP_STATES.includes(row.my_state);
  const canSeeVenue = isHost || accepted;
  const loc = geo.presentLocation(row, { isHost, isAccepted: accepted });
  const participants = row.participant_ids || [];
  return {
    id: row.id,
    title: row.title,
    category: row.category_slug,
    pictogram: row.category_pictogram || 'sparkle',
    description: row.description || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMin: Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000),
    capacity: row.capacity,
    joinedCount: participants.length,
    participants,
    host: {
      id: row.host_user_id,
      name: row.host_name,
      reliability: publicReliability(row.host_reliability),
      completed: row.host_completed || 0,
      level: row.host_level || 1,
      avatarKey: row.host_avatar_key || null,
    },
    area: row.coarse_area,
    venueName: canSeeVenue ? row.venue_name : null,
    venueId: row.venue_id || null,
    venueType: row.venue_type,
    latitude: loc.latitude,
    longitude: loc.longitude,
    locationPrecision: loc.precision,
    distanceM: distanceM != null ? geo.coarseDistanceMeters(distanceM) : null,
    distanceBand: distanceM != null ? geo.distanceBand(distanceM) : null,
    joinRule: row.join_rule,
    live: isLive(row),
    featured: !!featured,
    sponsored: !!row.is_sponsored,
    sponsorLabel: row.is_sponsored ? row.sponsored_label : null,
    cost: row.cost_note || null,
    accentIndex: accentIndex(row.id),
    tags: row.tags || [],
    accessibility: row.accessibility_notes || null,
    activityLevel: row.activity_level,
    visibility: row.visibility,
    status: row.status,
    circleId: row.circle_id || null,
    myJoinState: row.my_state || null,
    myRequestId: row.my_request_id || null,
    waitlistPosition: row.my_state === 'waitlisted' ? row.my_waitlist_position : null,
    conversationId: accepted || isHost ? row.group_conversation_id || null : null,
    hostedByMe: isHost,
  };
}

async function getVisible(q, activityId, viewerId) {
  const { rows } = await q.query(`${SELECT} WHERE a.id = $2 AND ${VISIBLE_TO_VIEWER} AND ${NOT_BLOCKED}`, [viewerId, activityId]);
  return rows[0] || null;
}

async function lockActivity(client, activityId) {
  const { rows } = await client.query('SELECT * FROM activities WHERE id = $1 FOR UPDATE', [activityId]);
  if (!rows[0]) throw err.notFound('activity_not_found');
  return rows[0];
}

async function countInGroup(client, activityId) {
  const { rows } = await client.query("SELECT count(*)::int AS n FROM activity_participants WHERE activity_id = $1 AND state IN ('accepted','checked_in','completed')", [activityId]);
  return rows[0].n;
}

async function groupConversationId(client, activityId) {
  const { rows } = await client.query("SELECT id FROM conversations WHERE activity_id = $1 AND kind = 'activity_group'", [activityId]);
  return rows[0] ? rows[0].id : null;
}

async function addToActivityConversation(client, activityId, userId) {
  const id = await groupConversationId(client, activityId);
  if (!id) return null;
  await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL', [id, userId]);
  return id;
}

async function removeFromActivityConversation(client, activityId, userId) {
  await client.query(
    "UPDATE conversation_members SET left_at = now() WHERE user_id = $2 AND conversation_id IN (SELECT id FROM conversations WHERE activity_id = $1 AND kind = 'activity_group')",
    [activityId, userId]
  );
}

async function systemMessage(client, conversationId, body) {
  if (!conversationId) return null;
  const { rows } = await client.query("INSERT INTO messages (conversation_id, sender_user_id, body, kind) VALUES ($1, NULL, $2, 'system') RETURNING *", [conversationId, body]);
  return rows[0];
}

// Error codes here are part of the client contract (docs/API.md → POST /activities).
function validateCreate(body) {
  const b = body || {};
  const cap = b.capacity == null ? null : Number(b.capacity);
  if (cap != null && (!Number.isInteger(cap) || cap < 2 || cap > 30)) throw err.badRequest('capacity_out_of_range', 'Groups can be 2–30 people');
  if (b.startsAt != null && (typeof b.startsAt !== 'string' || Number.isNaN(Date.parse(b.startsAt)))) throw err.badRequest('invalid_time', 'Pick a valid start time');
  const dur = b.durationMin == null ? null : Number(b.durationMin);
  if (dur != null && (!Number.isInteger(dur) || dur < 5 || dur > 720)) throw err.badRequest('invalid_time', 'Duration must be between 5 minutes and 12 hours');
  const v = check(ACTIVITY_FIELDS, b);
  const starts = new Date(v.startsAt);
  const now = Date.now();
  if (starts.getTime() < now - 5 * 60000) throw err.badRequest('start_in_past', 'Pick a start time in the future');
  if (starts.getTime() > now + 60 * 86400000) throw err.badRequest('invalid_time', 'Plans can be scheduled up to 60 days ahead');
  if ((v.latitude == null) !== (v.longitude == null)) throw err.badRequest('invalid_location', 'Send both latitude and longitude');
  if ([v.venueName, v.venueType].some((s) => s && PRIVATE_VENUE_RE.test(s))) throw err.badRequest('private_venue_not_allowed', 'Plans must meet at a public venue or public area');
  return v;
}

async function createActivity(client, user, body, { circleId = null, visibility, ip } = {}) {
  const v = validateCreate(body);
  const { rows: cats } = await client.query('SELECT id, risk_level, is_active FROM activity_categories WHERE slug = $1', [v.category]);
  const cat = cats[0];
  if (!cat || !cat.is_active) throw err.badRequest('unknown_category');
  if (cat.risk_level === 'restricted') throw err.forbidden('category_restricted', 'This activity type is not allowed');
  const cid = circleId || v.circleId || null;
  let vis = visibility || v.visibility;
  if (v.venueId) {
    // Partner venue: must be verified, public, and owned by a verified business (if any).
    const { rows: vr } = await client.query(
      `SELECT v.name, v.area, v.latitude, v.longitude, v.venue_type FROM venues v LEFT JOIN business_profiles b ON b.id = v.business_id
        WHERE v.id = $1 AND v.verified AND v.is_public_place AND (b.id IS NULL OR b.verification_status = 'verified')`,
      [v.venueId]
    );
    if (!vr[0]) throw err.badRequest('venue_not_allowed', 'That venue is not available for plans');
    v.venueName = v.venueName || vr[0].name;
    v.venueType = v.venueType || vr[0].venue_type;
    if (v.latitude == null) {
      v.latitude = vr[0].latitude;
      v.longitude = vr[0].longitude;
    }
  }
  if (cid) {
    const { rowCount } = await client.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [cid, user.id]);
    if (!rowCount) throw err.forbidden('not_circle_member');
  } else if (vis === 'circle') {
    throw err.badRequest('circle_required', 'Circle plans need a circleId');
  }

  // Spam / anti-gaming: one similar plan per host per 30-minute window.
  const { rowCount: dup } = await client.query(
    `SELECT 1 FROM activities WHERE host_user_id = $1 AND category_id = $2 AND status IN ('open','full','draft')
       AND abs(extract(epoch FROM (starts_at - $3::timestamptz))) < 1800`,
    [user.id, cat.id, v.startsAt]
  );
  if (dup) throw err.conflict('duplicate_plan', 'You already have a similar plan at that time');

  const { rows } = await client.query(
    `INSERT INTO activities (host_user_id, category_id, title, description, starts_at, ends_at, capacity, visibility,
       venue_name, coarse_area, latitude, longitude, exact_location_visible_after_accept, join_rule, venue_type,
       cost_note, tags, accessibility_notes, activity_level, circle_id, venue_id)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + make_interval(mins => $6), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [user.id, cat.id, v.title, v.description || null, v.startsAt, v.durationMin, v.capacity, vis, v.venueName || null, v.area,
      v.latitude ?? null, v.longitude ?? null, v.exactLocationAfterAccept, v.joinRule, v.venueType || null, v.cost || null,
      v.tags || [], v.accessibility || null, v.activityLevel, cid, v.venueId || null]
  );
  const id = rows[0].id;
  await client.query("INSERT INTO activity_participants (activity_id, user_id, state, decided_at) VALUES ($1, $2, 'accepted', now())", [id, user.id]);
  const { rows: conv } = await client.query("INSERT INTO conversations (activity_id, kind) VALUES ($1, 'activity_group') RETURNING id", [id]);
  await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)', [conv[0].id, user.id]);
  await systemMessage(client, conv[0].id, 'Your plan is live. People you accept will join this chat.');
  await audit(client, { actorUserId: user.id, action: 'activity.create', targetType: 'activity', targetId: id, metadata: { category: v.category, circleId: cid }, ip });
  return { id, conversationId: conv[0].id };
}

module.exports = {
  IN_GROUP_STATES,
  ACTIVITY_FIELDS,
  SELECT_COLUMNS,
  FROM,
  SELECT,
  NOT_BLOCKED,
  VISIBLE_TO_VIEWER,
  isLive,
  present,
  getVisible,
  lockActivity,
  countInGroup,
  groupConversationId,
  addToActivityConversation,
  removeFromActivityConversation,
  systemMessage,
  validateCreate,
  createActivity,
};
