'use strict';
// Plan lifecycle: create/edit, join requests (capacity enforced with row locks),
// host approval, waitlist promotion, cancel, check-in, mutual completion + XP, feedback.
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult, assertCanAct, assertProfile } = require('../lib/auth');
const { withIdempotency } = require('../lib/idempotency');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const realtime = require('../lib/realtime');
const { enqueue } = require('../lib/queue');
const geo = require('../lib/geo');
const { awardXp } = require('../lib/xp');
const P = require('../lib/present');
const A = require('../services/activities');

const CHECKIN_RADIUS_M = 300;

async function presentFresh(activityId, viewerId) {
  const row = await A.getVisible(db, activityId, viewerId);
  return row ? A.present(row, { viewerId }) : null;
}

function publishJoin(after, activityId, userId, state, extra = {}) {
  after(async () => {
    const data = { activityId, userId, state, ...extra };
    await realtime.publish(`activity:${activityId}`, { type: 'join.updated', data });
    await realtime.publish(`user:${userId}:notifications`, { type: 'join.updated', data });
  });
}

function publishActivity(after, activityId, data) {
  after(() => realtime.publish(`activity:${activityId}`, { type: 'activity.updated', data: { activityId, ...data } }));
}

async function blockedBetween(q, a, b) {
  const { rowCount } = await q.query(
    'SELECT 1 FROM user_blocks WHERE (blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1)',
    [a, b]
  );
  return rowCount > 0;
}

// Promote the first waitlisted person when a spot frees up.
async function promoteWaitlist(client, after, activity) {
  const n = await A.countInGroup(client, activity.id);
  if (n >= activity.capacity) return null;
  const { rows } = await client.query(
    "SELECT id, user_id FROM activity_participants WHERE activity_id = $1 AND state = 'waitlisted' ORDER BY waitlist_position NULLS LAST, requested_at LIMIT 1 FOR UPDATE",
    [activity.id]
  );
  const w = rows[0];
  if (!w) {
    if (activity.status === 'full') await client.query("UPDATE activities SET status = 'open' WHERE id = $1", [activity.id]);
    return null;
  }
  const next = activity.join_rule === 'instant' ? 'accepted' : 'requested';
  await client.query('UPDATE activity_participants SET state = $2, waitlist_position = NULL, decided_at = CASE WHEN $2 = \'accepted\' THEN now() ELSE decided_at END WHERE id = $1', [w.id, next]);
  if (next === 'accepted') {
    const convId = await A.addToActivityConversation(client, activity.id, w.user_id);
    await notify(client, after, w.user_id, { type: 'join', title: "A spot opened — you're in", body: activity.title, data: { activityId: activity.id, target: { screen: 'group_chat', params: { conversationId: convId } } } });
  } else {
    await notify(client, after, w.user_id, { type: 'join', title: 'A spot opened up', body: `Your request for "${activity.title}" is now with the host.`, data: { activityId: activity.id, target: { screen: 'activity_detail', params: { id: activity.id } } } });
    await notify(client, after, activity.host_user_id, { type: 'join', title: 'New join request', body: activity.title, data: { activityId: activity.id, target: { screen: 'activity_detail', params: { id: activity.id, tab: 'requests' } } } });
  }
  publishJoin(after, activity.id, w.user_id, next);
  const after2 = await A.countInGroup(client, activity.id);
  await client.query('UPDATE activities SET status = $2 WHERE id = $1', [activity.id, after2 >= activity.capacity ? 'full' : 'open']);
  return w.user_id;
}

// Mutual completion rule: host + ≥1 attendee confirmed, or ≥2 verified (proximity/host) check-ins.
async function maybeComplete(client, after, activity) {
  const { rows } = await client.query(
    `SELECT user_id, state, completion_confirmed_at, check_in_method FROM activity_participants
      WHERE activity_id = $1 AND state IN ('accepted','checked_in','completed')`,
    [activity.id]
  );
  const hostConfirmed = rows.some((r) => r.user_id === activity.host_user_id && r.completion_confirmed_at);
  const guestConfirmed = rows.some((r) => r.user_id !== activity.host_user_id && r.completion_confirmed_at);
  const verifiedCheckins = rows.filter((r) => ['proximity', 'host'].includes(r.check_in_method)).length;
  const mutual = activity.status === 'completed' || (hostConfirmed && guestConfirmed) || verifiedCheckins >= 2;
  if (!mutual) return { mutual: false, awards: {} };

  const { rows: catRow } = await client.query('SELECT slug FROM activity_categories WHERE id = $1', [activity.category_id]);
  const category = catRow[0] && catRow[0].slug;
  const awards = {};
  const eligible = rows.filter((r) => r.completion_confirmed_at || ['proximity', 'host'].includes(r.check_in_method));
  for (const r of eligible) {
    const total = { xp: 0 };
    const base = await awardXp(client, { userId: r.user_id, eventType: 'activity_completed', refId: activity.id, activityId: activity.id });
    total.xp += base.xp;
    if (base.leveledUp) total.level = base.level;
    if (category && r.state !== 'completed') {
      const { rowCount: before } = await client.query(
        "SELECT 1 FROM activity_participants p JOIN activities x ON x.id = p.activity_id WHERE p.user_id = $1 AND p.state = 'completed' AND x.category_id = $2 AND x.id <> $3 LIMIT 1",
        [r.user_id, activity.category_id, activity.id]
      );
      if (!before) {
        const nc = await awardXp(client, { userId: r.user_id, eventType: 'new_category_explored', refId: category, activityId: activity.id });
        total.xp += nc.xp;
        if (nc.leveledUp) total.level = nc.level;
      }
    }
    if (r.user_id === activity.host_user_id && !activity.cancelled_at) {
      const h = await awardXp(client, { userId: r.user_id, eventType: 'hosted_completed', refId: activity.id, activityId: activity.id });
      total.xp += h.xp;
      if (h.leveledUp) total.level = h.level;
    }
    await client.query(
      "UPDATE activity_participants SET state = 'completed', completion_confirmed_at = COALESCE(completion_confirmed_at, now()) WHERE activity_id = $1 AND user_id = $2",
      [activity.id, r.user_id]
    );
    await client.query("INSERT INTO reliability_events (user_id, activity_id, kind) VALUES ($1, $2, 'attended') ON CONFLICT DO NOTHING", [r.user_id, activity.id]);
    awards[r.user_id] = total;
  }
  if (activity.status !== 'completed') {
    await client.query("UPDATE activities SET status = 'completed', completed_at = now() WHERE id = $1", [activity.id]);
    publishActivity(after, activity.id, { status: 'completed' });
  }
  after(async () => {
    for (const userId of Object.keys(awards)) {
      await enqueue({ type: 'quest_evaluate', userId });
      await enqueue({ type: 'reliability_recalc', userId });
    }
  });
  return { mutual: true, awards };
}

const routes = {
  'POST /v1/activities': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'create');
    return withIdempotency(db, req, user.id, async () => {
      await enforce(db, 'create_plan', user.id);
      const { id } = await db.withTransaction((client) => A.createActivity(client, user, req.body, { ip: req.ip }));
      return created(await presentFresh(id, user.id));
    });
  },

  'PATCH /v1/activities/{activityId}': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        title: { type: 'string', min: 3, max: 80 },
        description: { type: 'string', max: 1000 },
        capacity: { type: 'integer', min: 2, max: 30 },
        joinRule: { type: 'string', enum: ['approval', 'instant'] },
        venueName: { type: 'string', max: 120 },
        costNote: { type: 'string', max: 120 },
        cost: { type: 'string', max: 120 },
        tags: { type: 'array', max: 8, items: { type: 'string', max: 24 } },
        accessibility: { type: 'string', max: 300 },
      },
      { ...req.body, capacity: undefined }
    );
    if (req.body.capacity != null) {
      const cap = Number(req.body.capacity);
      if (!Number.isInteger(cap) || cap < 2 || cap > 30) throw err.badRequest('capacity_out_of_range', 'Groups can be 2–30 people');
      v.capacity = cap;
    }
    await db.withTransaction(async (client, after) => {
      const a = await A.lockActivity(client, req.params.activityId);
      if (a.host_user_id !== user.id) throw err.forbidden('host_only');
      if (!['open', 'full', 'draft'].includes(a.status)) throw err.conflict('not_editable', 'This plan can no longer be edited');
      if (v.capacity != null) {
        const n = await A.countInGroup(client, a.id);
        if (v.capacity < n) throw err.conflict('capacity_below_joined', `${n} people have already joined`);
      }
      if (v.venueName && /\b(home|residence|house|flat|apartment|hotel room|my place)\b/i.test(v.venueName)) throw err.badRequest('private_venue_not_allowed', 'Plans must meet at a public venue or public area');
      await client.query(
        `UPDATE activities SET title = COALESCE($2, title), description = COALESCE($3, description), capacity = COALESCE($4, capacity),
           join_rule = COALESCE($5, join_rule), venue_name = COALESCE($6, venue_name), cost_note = COALESCE($7, cost_note),
           tags = COALESCE($8, tags), accessibility_notes = COALESCE($9, accessibility_notes), updated_at = now()
         WHERE id = $1`,
        [a.id, v.title ?? null, v.description ?? null, v.capacity ?? null, v.joinRule ?? null, v.venueName ?? null, v.cost ?? v.costNote ?? null, v.tags ?? null, v.accessibility ?? null]
      );
      if (v.capacity != null) {
        const n = await A.countInGroup(client, a.id);
        await client.query('UPDATE activities SET status = $2 WHERE id = $1', [a.id, n >= v.capacity ? 'full' : 'open']);
        if (n < v.capacity) await promoteWaitlist(client, after, { ...a, capacity: v.capacity, status: 'open' });
      }
      await audit(client, { actorUserId: user.id, action: 'activity.update', targetType: 'activity', targetId: a.id, metadata: Object.keys(v), ip: req.ip });
      publishActivity(after, a.id, { fields: Object.keys(v) });
    });
    return presentFresh(req.params.activityId, user.id);
  },

  'POST /v1/activities/{activityId}/join-requests': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'join');
    const { intro } = check({ intro: { type: 'string', max: 280 } }, req.body);
    return withIdempotency(db, req, user.id, async () => {
      await enforce(db, 'join_request', user.id);
      const result = await db.withTransaction(async (client, after) => {
        const a = await A.lockActivity(client, req.params.activityId);
        const visible = await A.getVisible(client, a.id, user.id);
        if (!visible) throw err.notFound('activity_not_found');
        if (a.host_user_id === user.id) throw err.conflict('own_plan', "You're hosting this plan");
        if (await blockedBetween(client, user.id, a.host_user_id)) throw err.notFound('activity_not_found');
        if (!['open', 'full'].includes(a.status)) throw err.conflict('not_joinable', 'This plan is not taking requests');
        if (new Date(a.starts_at).getTime() < Date.now() - 15 * 60000) throw err.conflict('already_started', 'This plan has already started');

        const { rows: ex } = await client.query('SELECT id, state, waitlist_position FROM activity_participants WHERE activity_id = $1 AND user_id = $2 FOR UPDATE', [a.id, user.id]);
        const existing = ex[0];
        if (existing && ['requested', 'accepted', 'waitlisted', 'checked_in', 'completed'].includes(existing.state)) {
          return { requestId: existing.id, state: existing.state, waitlistPosition: existing.waitlist_position };
        }
        if (existing && existing.state === 'declined') throw err.conflict('declined', 'The host declined this request');
        if (existing && existing.state === 'no_show') throw err.conflict('not_joinable');

        const inGroup = await A.countInGroup(client, a.id);
        let state;
        let waitlistPosition = null;
        if (inGroup >= a.capacity) {
          state = 'waitlisted';
          const { rows: wp } = await client.query(
            "SELECT COALESCE(max(waitlist_position), 0) + 1 AS n, count(*)::int AS waiting FROM activity_participants WHERE activity_id = $1 AND state = 'waitlisted'",
            [a.id]
          );
          // Waitlist holds at most max(5, capacity) people; beyond that the plan is simply full.
          if (wp[0].waiting >= Math.max(5, a.capacity)) throw err.conflict('capacity_full', 'This plan and its waitlist are full');
          waitlistPosition = wp[0].n;
        } else {
          state = a.join_rule === 'instant' ? 'accepted' : 'requested';
        }
        let requestId;
        if (existing) {
          await client.query(
            'UPDATE activity_participants SET state = $2, intro = $3, waitlist_position = $4, requested_at = now(), decided_at = CASE WHEN $2 = \'accepted\' THEN now() END WHERE id = $1',
            [existing.id, state, intro || null, waitlistPosition]
          );
          requestId = existing.id;
        } else {
          const { rows } = await client.query(
            "INSERT INTO activity_participants (activity_id, user_id, state, intro, waitlist_position, decided_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'accepted' THEN now() END) RETURNING id",
            [a.id, user.id, state, intro || null, waitlistPosition]
          );
          requestId = rows[0].id;
        }
        let conversationId = null;
        if (state === 'accepted') {
          conversationId = await A.addToActivityConversation(client, a.id, user.id);
          await A.systemMessage(client, conversationId, `${user.displayName} joined the plan.`);
          if (inGroup + 1 >= a.capacity) await client.query("UPDATE activities SET status = 'full' WHERE id = $1", [a.id]);
          await notify(client, after, a.host_user_id, { type: 'join', title: `${user.displayName} joined your plan`, body: a.title, data: { activityId: a.id, target: { screen: 'activity_detail', params: { id: a.id } } } });
        } else if (state === 'requested') {
          await notify(client, after, a.host_user_id, { type: 'join', title: `${user.displayName} wants to join`, body: a.title, data: { activityId: a.id, requestId, target: { screen: 'activity_detail', params: { id: a.id, tab: 'requests' } } } });
        }
        publishJoin(after, a.id, user.id, state, { requestId });
        return { requestId, state, waitlistPosition, conversationId };
      });
      return { ...result, activity: await presentFresh(req.params.activityId, user.id) };
    });
  },

  'GET /v1/activities/{activityId}/join-requests': async (req) => {
    const user = await requireUser(req);
    const a = await db.one('SELECT host_user_id FROM activities WHERE id = $1', [req.params.activityId]);
    if (!a) throw err.notFound('activity_not_found');
    if (a.host_user_id !== user.id) throw err.forbidden('host_only');
    const rows = await db.many(
      `SELECT ap.id AS request_id, ap.state, ap.intro, ap.requested_at, ap.waitlist_position,
              u.id, p.display_name, p.avatar_key, p.reliability_score, p.interests, p.home_area AS area, COALESCE(up.level, 1) AS level,
              (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'completed') AS completed
         FROM activity_participants ap JOIN app_users u ON u.id = ap.user_id JOIN profiles p ON p.user_id = u.id
         LEFT JOIN user_progress up ON up.user_id = u.id
        WHERE ap.activity_id = $1 AND ap.user_id <> $2 AND ap.state IN ('requested','waitlisted','accepted','checked_in')
        ORDER BY (ap.state = 'requested') DESC, ap.requested_at`,
      [req.params.activityId, user.id]
    );
    const items = await Promise.all(
      rows.map(async (r) => ({ id: r.request_id, userId: r.id, user: await P.publicUser(r), intro: r.intro, state: r.state, requestedAt: r.requested_at, waitlistPosition: r.waitlist_position }))
    );
    return { items, nextCursor: null };
  },

  'DELETE /v1/activities/{activityId}/join-requests/me': async (req) => {
    const user = await requireUser(req);
    await db.withTransaction(async (client, after) => {
      const a = await A.lockActivity(client, req.params.activityId);
      if (a.host_user_id === user.id) throw err.conflict('host_cannot_leave', 'Cancel the plan instead');
      const { rows } = await client.query('SELECT id, state FROM activity_participants WHERE activity_id = $1 AND user_id = $2 FOR UPDATE', [a.id, user.id]);
      const p = rows[0];
      if (!p || !['requested', 'accepted', 'waitlisted', 'checked_in'].includes(p.state)) throw err.notFound('no_active_request');
      await client.query("UPDATE activity_participants SET state = 'cancelled', waitlist_position = NULL WHERE id = $1", [p.id]);
      if (['accepted', 'checked_in'].includes(p.state)) {
        await A.removeFromActivityConversation(client, a.id, user.id);
        const convId = await A.groupConversationId(client, a.id);
        await A.systemMessage(client, convId, `${user.displayName} can't make it anymore.`);
        if (new Date(a.starts_at).getTime() - Date.now() < 2 * 3600000) {
          await client.query("INSERT INTO reliability_events (user_id, activity_id, kind) VALUES ($1, $2, 'late_cancel') ON CONFLICT DO NOTHING", [user.id, a.id]);
        }
        await notify(client, after, a.host_user_id, { type: 'join', title: `${user.displayName} dropped out`, body: a.title, data: { activityId: a.id, target: { screen: 'activity_detail', params: { id: a.id } } } });
        await promoteWaitlist(client, after, a);
      }
      publishJoin(after, a.id, user.id, 'cancelled');
    });
    return { state: 'cancelled', activity: await presentFresh(req.params.activityId, user.id) };
  },

  'POST /v1/activities/{activityId}/join-requests/{requestId}/accept': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'host');
    return withIdempotency(db, req, user.id, async () => {
      const out = await db.withTransaction(async (client, after) => {
        const a = await A.lockActivity(client, req.params.activityId);
        if (a.host_user_id !== user.id) throw err.forbidden('host_only');
        const { rows } = await client.query('SELECT id, user_id, state FROM activity_participants WHERE id = $1 AND activity_id = $2 FOR UPDATE', [req.params.requestId, a.id]);
        const p = rows[0];
        if (!p) throw err.notFound('request_not_found');
        if (p.state === 'accepted') return { requestId: p.id, state: 'accepted' };
        if (!['requested', 'waitlisted'].includes(p.state)) throw err.conflict('not_pending');
        if (await blockedBetween(client, user.id, p.user_id)) throw err.conflict('blocked');
        const n = await A.countInGroup(client, a.id);
        if (n >= a.capacity) throw err.conflict('capacity_full', 'The plan is full — raise capacity or wait for a spot');
        await client.query("UPDATE activity_participants SET state = 'accepted', decided_at = now(), decided_by = $2, waitlist_position = NULL WHERE id = $1", [p.id, user.id]);
        const convId = await A.addToActivityConversation(client, a.id, p.user_id);
        const { rows: who } = await client.query('SELECT display_name FROM profiles WHERE user_id = $1', [p.user_id]);
        await A.systemMessage(client, convId, `${user.displayName} accepted ${who[0] ? who[0].display_name : 'a new member'}. The exact meeting spot is shared in this chat only.`);
        if (n + 1 >= a.capacity) await client.query("UPDATE activities SET status = 'full' WHERE id = $1", [a.id]);
        await notify(client, after, p.user_id, { type: 'join', title: `${user.displayName} accepted your request`, body: `${a.title} — group chat is open.`, data: { activityId: a.id, target: { screen: 'group_chat', params: { conversationId: convId } } } });
        await audit(client, { actorUserId: user.id, action: 'join.accept', targetType: 'activity_participant', targetId: p.id, ip: req.ip });
        publishJoin(after, a.id, p.user_id, 'accepted', { requestId: p.id, conversationId: convId });
        return { requestId: p.id, state: 'accepted', conversationId: convId };
      });
      return out;
    });
  },

  'POST /v1/activities/{activityId}/join-requests/{requestId}/decline': async (req) => {
    const user = await requireUser(req);
    return db.withTransaction(async (client, after) => {
      const a = await A.lockActivity(client, req.params.activityId);
      if (a.host_user_id !== user.id) throw err.forbidden('host_only');
      const { rows } = await client.query('SELECT id, user_id, state FROM activity_participants WHERE id = $1 AND activity_id = $2 FOR UPDATE', [req.params.requestId, a.id]);
      const p = rows[0];
      if (!p) throw err.notFound('request_not_found');
      if (!['requested', 'waitlisted'].includes(p.state)) throw err.conflict('not_pending');
      await client.query("UPDATE activity_participants SET state = 'declined', decided_at = now(), decided_by = $2, waitlist_position = NULL WHERE id = $1", [p.id, user.id]);
      // Kind, non-specific copy — no reasons are shared.
      await notify(client, after, p.user_id, { type: 'join', title: "This one didn't work out", body: `The host couldn't fit you into "${a.title}". Plenty more nearby.`, data: { activityId: a.id, target: { screen: 'discover_home', params: {} } } });
      publishJoin(after, a.id, p.user_id, 'declined', { requestId: p.id });
      return { requestId: p.id, state: 'declined' };
    });
  },

  'POST /v1/activities/{activityId}/cancel': async (req) => {
    const user = await requireUser(req);
    const { reason } = check({ reason: { type: 'string', max: 280 } }, req.body);
    await db.withTransaction(async (client, after) => {
      const a = await A.lockActivity(client, req.params.activityId);
      if (a.host_user_id !== user.id) throw err.forbidden('host_only', 'Only the host can cancel the plan. Use DELETE …/join-requests/me to leave.');
      if (['cancelled', 'completed', 'moderated'].includes(a.status)) throw err.conflict('not_cancellable');
      await client.query("UPDATE activities SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1", [a.id, reason || null]);
      const { rows } = await client.query("SELECT user_id FROM activity_participants WHERE activity_id = $1 AND user_id <> $2 AND state IN ('requested','accepted','waitlisted','checked_in')", [a.id, user.id]);
      await client.query("UPDATE activity_participants SET state = 'cancelled' WHERE activity_id = $1 AND user_id <> $2 AND state IN ('requested','accepted','waitlisted','checked_in')", [a.id, user.id]);
      if (new Date(a.starts_at).getTime() - Date.now() < 2 * 3600000 && rows.length) {
        await client.query("INSERT INTO reliability_events (user_id, activity_id, kind) VALUES ($1, $2, 'host_cancel') ON CONFLICT DO NOTHING", [user.id, a.id]);
      }
      await A.systemMessage(client, await A.groupConversationId(client, a.id), `${user.displayName} cancelled this plan${reason ? `: ${reason}` : '.'}`);
      for (const r of rows) {
        await notify(client, after, r.user_id, { type: 'activity', title: 'Plan cancelled', body: `"${a.title}" was cancelled by the host.`, data: { activityId: a.id, target: { screen: 'activity_detail', params: { id: a.id } } } });
      }
      await audit(client, { actorUserId: user.id, action: 'activity.cancel', targetType: 'activity', targetId: a.id, metadata: { reason }, ip: req.ip });
      publishActivity(after, a.id, { status: 'cancelled' });
    });
    return presentFresh(req.params.activityId, user.id);
  },

  'POST /v1/activities/{activityId}/check-ins': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        method: { type: 'string', enum: ['proximity', 'manual', 'host'], default: 'manual' },
        lat: { type: 'number', min: -90, max: 90 },
        lng: { type: 'number', min: -180, max: 180 },
        userId: { type: 'string', format: 'uuid' },
      },
      req.body
    );
    return db.withTransaction(async (client, after) => {
      const a = await A.lockActivity(client, req.params.activityId);
      const now = Date.now();
      if (now < new Date(a.starts_at).getTime() - 30 * 60000 || now > new Date(a.ends_at).getTime() + 30 * 60000) throw err.conflict('checkin_window_closed', 'Check-in is open from 30 minutes before the start until 30 minutes after the end');
      let target = user.id;
      if (v.method === 'host') {
        if (a.host_user_id !== user.id) throw err.forbidden('host_only');
        if (!v.userId) throw err.badRequest('user_required');
        target = v.userId;
      }
      if (v.method === 'proximity') {
        // Coordinates are used for this comparison only and never stored.
        if (a.latitude == null || !geo.withinMeters({ latitude: v.lat, longitude: v.lng }, { latitude: a.latitude, longitude: a.longitude }, CHECKIN_RADIUS_M)) {
          throw err.conflict('too_far', "You don't seem to be at the venue yet. Use manual check-in instead.");
        }
      }
      const { rows } = await client.query("SELECT id, state FROM activity_participants WHERE activity_id = $1 AND user_id = $2 AND state IN ('accepted','checked_in') FOR UPDATE", [a.id, target]);
      if (!rows[0]) throw err.forbidden('not_participant');
      await client.query("UPDATE activity_participants SET state = 'checked_in', checked_in_at = COALESCE(checked_in_at, now()), check_in_method = $2 WHERE id = $1", [rows[0].id, v.method]);
      if (a.status === 'open' || a.status === 'full') await client.query("UPDATE activities SET status = 'in_progress' WHERE id = $1 AND starts_at <= now()", [a.id]);
      publishJoin(after, a.id, target, 'checked_in', { method: v.method });
      const c = await maybeComplete(client, after, { ...a });
      return { checkedIn: true, method: v.method, verified: v.method !== 'manual', mutual: c.mutual };
    });
  },

  'POST /v1/activities/{activityId}/completion-confirmations': async (req) => {
    const user = await requireUser(req);
    return withIdempotency(db, req, user.id, async () => {
      const r = await db.withTransaction(async (client, after) => {
        const a = await A.lockActivity(client, req.params.activityId);
        if (['cancelled', 'moderated'].includes(a.status)) throw err.conflict('not_completable');
        if (Date.now() < new Date(a.starts_at).getTime()) throw err.conflict('too_early', 'You can confirm once the plan has started');
        const { rows } = await client.query(
          "SELECT id, completion_confirmed_at FROM activity_participants WHERE activity_id = $1 AND user_id = $2 AND state IN ('accepted','checked_in','completed') FOR UPDATE",
          [a.id, user.id]
        );
        if (!rows[0]) throw err.forbidden('not_participant');
        const duplicate = !!rows[0].completion_confirmed_at;
        await client.query('UPDATE activity_participants SET completion_confirmed_at = COALESCE(completion_confirmed_at, now()) WHERE id = $1', [rows[0].id]);
        const c = await maybeComplete(client, after, a);
        const mine = c.awards[user.id] || { xp: 0 };
        return { state: c.mutual ? 'completed' : 'confirmed', xpAwarded: mine.xp, duplicate, pendingOthers: !c.mutual, leveledUp: !!mine.level, level: mine.level || null };
      });
      const { _stats, ...progress } = await require('../services/progress').progressFor(db, user.id);
      return { ...r, progress };
    });
  },

  // Private: never shown raw to other users; feeds reliability + safety review.
  'POST /v1/activities/{activityId}/feedback': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        about: {
          type: 'array',
          required: true,
          min: 1,
          max: 30,
          items: { type: 'object', fields: { userId: { type: 'string', required: true, format: 'uuid' }, showedUp: { type: 'boolean' }, rating: { type: 'integer', min: 1, max: 5 }, note: { type: 'string', max: 500 } } },
        },
      },
      req.body
    );
    await db.withTransaction(async (client, after) => {
      const { rows } = await client.query("SELECT user_id FROM activity_participants WHERE activity_id = $1 AND state IN ('accepted','checked_in','completed','no_show')", [req.params.activityId]);
      const members = new Set(rows.map((r) => r.user_id));
      if (!members.has(user.id)) throw err.forbidden('not_participant');
      const { rowCount: done } = await client.query('SELECT 1 FROM activity_feedback WHERE activity_id = $1 AND from_user_id = $2 LIMIT 1', [req.params.activityId, user.id]);
      if (done) throw err.conflict('already_submitted', 'You already shared feedback for this plan');
      for (const f of v.about) {
        if (f.userId === user.id || !members.has(f.userId)) continue;
        await client.query(
          `INSERT INTO activity_feedback (activity_id, from_user_id, about_user_id, showed_up, rating, note) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (activity_id, from_user_id, about_user_id) DO UPDATE SET showed_up = EXCLUDED.showed_up, rating = EXCLUDED.rating, note = EXCLUDED.note`,
          [req.params.activityId, user.id, f.userId, f.showedUp ?? null, f.rating ?? null, f.note || null]
        );
        after(() => enqueue({ type: 'reliability_recalc', userId: f.userId }));
      }
    });
    return { ok: true };
  },
};

exports.maybeComplete = maybeComplete;
exports.handler = createRouter(routes);
