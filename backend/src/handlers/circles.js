'use strict';
// Circles: recurring groups, members/roles, circle plans and group challenges.
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertAdult, assertCanAct, assertProfile } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const A = require('../services/activities');

const CIRCLE_SELECT = `
  SELECT ci.*,
         (SELECT count(*)::int FROM circle_members m WHERE m.circle_id = ci.id) AS member_count,
         (SELECT COALESCE(array_agg(x.user_id::text), '{}') FROM (
            SELECT user_id FROM circle_members m WHERE m.circle_id = ci.id ORDER BY (m.role = 'owner') DESC, m.joined_at LIMIT 6) x) AS member_seeds,
         (SELECT COALESCE(array_agg(x.id::text), '{}') FROM (
            SELECT id FROM activities a WHERE a.circle_id = ci.id AND a.status IN ('open','full') AND a.ends_at > now() ORDER BY a.starts_at LIMIT 5) x) AS next_plan_ids,
         (SELECT op.display_name FROM profiles op WHERE op.user_id = ci.owner_user_id) AS owner_name,
         my.role AS my_role
    FROM circles ci
    LEFT JOIN circle_members my ON my.circle_id = ci.id AND my.user_id = $1
   WHERE ci.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = ci.owner_user_id) OR (b.blocker_user_id = ci.owner_user_id AND b.blocked_user_id = $1))`;

async function loadCircle(userId, circleId, { requireMember = false } = {}) {
  const row = await db.one(`${CIRCLE_SELECT} AND ci.id = $2`, [userId, circleId]);
  if (!row || (row.visibility === 'private' && !row.my_role)) throw err.notFound('circle_not_found');
  if (requireMember && !row.my_role) throw err.forbidden('not_circle_member');
  return row;
}

async function activeChallenge(userId, circleId) {
  const c = await db.one(
    `SELECT ch.*, (SELECT COALESCE(sum(count), 0)::int FROM circle_challenge_progress p WHERE p.challenge_id = ch.id) AS group_progress,
            mp.count AS my_progress, (mp.user_id IS NOT NULL) AS joined
       FROM circle_challenges ch LEFT JOIN circle_challenge_progress mp ON mp.challenge_id = ch.id AND mp.user_id = $2
      WHERE ch.circle_id = $1 AND ch.ends_at > now() ORDER BY ch.starts_at LIMIT 1`,
    [circleId, userId]
  );
  if (!c) return null;
  const contributors = await db.many(
    `SELECT p.user_id, pr.display_name, p.count FROM circle_challenge_progress p JOIN profiles pr ON pr.user_id = p.user_id
      WHERE p.challenge_id = $1 AND p.count > 0
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = $2 AND b.blocked_user_id = p.user_id)
      ORDER BY p.count DESC LIMIT 10`,
    [c.id, userId]
  );
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    goal: c.target_count,
    progress: Math.min(c.group_progress, c.target_count),
    myProgress: c.my_progress || 0,
    joined: !!c.joined,
    rewardXp: c.xp_reward,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    daysLeft: Math.max(0, Math.ceil((new Date(c.ends_at) - Date.now()) / 86400000)),
    contributors: contributors.map((x) => ({ userId: x.user_id, name: x.display_name, count: x.count })),
  };
}

const routes = {
  'GET /v1/circles': async (req) => {
    const user = await requireUser(req);
    const q = check({ scope: { type: 'string', enum: ['all', 'joined', 'suggested', 'local'], default: 'all' }, area: { type: 'string', max: 60 }, q: { type: 'string', max: 60 } }, req.query);
    const page = pageParams(req.query);
    const me = await db.one('SELECT interests, home_area FROM profiles WHERE user_id = $1', [user.id]);
    const params = [user.id];
    const add = (v) => (params.push(v), `$${params.length}`);
    const where = [];
    if (q.scope === 'joined') where.push('my.user_id IS NOT NULL');
    else where.push("(ci.visibility = 'public' OR my.user_id IS NOT NULL)");
    if (q.scope === 'suggested') where.push(`my.user_id IS NULL AND (ci.category_slug = ANY(${add((me && me.interests) || [])}) OR ci.area = ${add((me && me.home_area) || '')})`);
    if (q.scope === 'local') where.push(`lower(ci.area) = lower(${add(q.area || (me && me.home_area) || '')})`);
    if (q.q) where.push(`ci.name ILIKE ${add(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`);
    const rows = await db.many(
      `${CIRCLE_SELECT} AND ${where.join(' AND ')} ORDER BY (my.user_id IS NOT NULL) DESC, member_count DESC, ci.created_at DESC LIMIT ${add(page.sqlLimit)} OFFSET ${add(page.offset)}`,
      params
    );
    const ids = rows.slice(0, page.limit).map((r) => r.id);
    const plans = ids.length
      ? await db.many(
          `${A.SELECT} WHERE a.circle_id = ANY($2) AND a.status IN ('open','full') AND a.ends_at > now() AND ${A.VISIBLE_TO_VIEWER} AND ${A.NOT_BLOCKED} ORDER BY a.starts_at LIMIT 100`,
          [user.id, ids]
        )
      : [];
    return pageOf(rows, page, (r) => ({ ...P.circle(r), upcomingPlans: plans.filter((p) => p.circle_id === r.id).slice(0, 3).map((p) => A.present(p, { viewerId: user.id })) }));
  },

  'POST /v1/circles': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'circle_create');
    const v = check(
      {
        name: { type: 'string', required: true, min: 3, max: 60 },
        description: { type: 'string', max: 500 },
        visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
        area: { type: 'string', max: 60 },
        category: { type: 'string', format: 'slug' },
        pictogram: { type: 'string', max: 30 },
        rules: { type: 'array', max: 10, items: { type: 'string', max: 140 }, default: () => [] },
      },
      req.body
    );
    await enforce(db, 'circle_create', user.id);
    const id = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO circles (owner_user_id, name, description, visibility, area, category_slug, pictogram, rules)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, (SELECT pictogram FROM activity_categories WHERE slug = $6), 'people'), $8) RETURNING id`,
        [user.id, v.name, v.description || null, v.visibility, v.area || null, v.category || null, v.pictogram || null, v.rules]
      );
      await client.query("INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'owner')", [rows[0].id, user.id]);
      const { rows: c } = await client.query("INSERT INTO conversations (kind, circle_id) VALUES ('circle', $1) RETURNING id", [rows[0].id]);
      await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)', [c[0].id, user.id]);
      await audit(client, { actorUserId: user.id, action: 'circle.create', targetType: 'circle', targetId: rows[0].id, ip: req.ip });
      return rows[0].id;
    });
    return created(P.circle(await loadCircle(user.id, id)));
  },

  'GET /v1/circles/{circleId}': async (req) => {
    const user = await requireUser(req);
    const c = await loadCircle(user.id, req.params.circleId);
    const plans = await db.many(
      `${A.SELECT} WHERE a.circle_id = $2 AND a.status IN ('open','full') AND a.ends_at > now() AND ${A.VISIBLE_TO_VIEWER} AND ${A.NOT_BLOCKED} ORDER BY a.starts_at LIMIT 10`,
      [user.id, c.id]
    );
    const conv = c.my_role ? await db.one("SELECT id FROM conversations WHERE kind = 'circle' AND circle_id = $1", [c.id]) : null;
    return {
      ...P.circle(c),
      upcomingPlans: plans.map((r) => A.present(r, { viewerId: user.id })),
      challenge: await activeChallenge(user.id, c.id),
      conversationId: conv ? conv.id : null,
    };
  },

  'POST /v1/circles/{circleId}/members': async (req) => {
    const user = await requireUser(req);
    assertAdult(user);
    const v = check({ userId: { type: 'string', format: 'uuid' } }, req.body);
    const c = await db.one('SELECT id, name, visibility, owner_user_id FROM circles WHERE id = $1 AND status = $2', [req.params.circleId, 'active']);
    if (!c) throw err.notFound('circle_not_found');
    const { rows: mine } = await db.query('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [c.id, user.id]);
    const myRole = mine[0] && mine[0].role;
    const target = v.userId && v.userId !== user.id ? v.userId : user.id;
    if (target === user.id) {
      if (c.visibility === 'private' && !myRole) throw err.forbidden('invite_only', 'This circle is invite-only');
    } else if (!['owner', 'moderator'].includes(myRole)) {
      throw err.forbidden('owner_or_moderator_only');
    }
    const { rowCount: blocked } = await db.query(
      'SELECT 1 FROM user_blocks WHERE (blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1)',
      [target, c.owner_user_id]
    );
    if (blocked) throw err.forbidden('blocked');
    await db.withTransaction(async (client, after) => {
      await client.query("INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [c.id, target]);
      const { rows: conv } = await client.query("SELECT id FROM conversations WHERE kind = 'circle' AND circle_id = $1", [c.id]);
      if (conv[0]) await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL', [conv[0].id, target]);
      if (target !== user.id) {
        await notify(client, after, target, { type: 'activity', title: `You were added to ${c.name}`, body: 'Say hi in the circle chat.', data: { circleId: c.id, target: { screen: 'circle_detail', params: { id: c.id } } } });
        await audit(client, { actorUserId: user.id, action: 'circle.member_add', targetType: 'circle', targetId: c.id, metadata: { userId: target }, ip: req.ip });
      }
    });
    return P.circle(await loadCircle(user.id, c.id));
  },

  'GET /v1/circles/{circleId}/members': async (req) => {
    const user = await requireUser(req);
    const c = await loadCircle(user.id, req.params.circleId);
    const page = pageParams(req.query, { def: 50, max: 100 });
    const rows = await db.many(
      `SELECT m.role, m.joined_at, u.id, p.display_name, p.avatar_key, p.reliability_score, p.interests, p.home_area AS area, COALESCE(up.level, 1) AS level,
              (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'completed') AS completed
         FROM circle_members m JOIN app_users u ON u.id = m.user_id AND u.status IN ('active','limited')
         JOIN profiles p ON p.user_id = u.id LEFT JOIN user_progress up ON up.user_id = u.id
        WHERE m.circle_id = $1
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = $2 AND b.blocked_user_id = u.id)
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m.joined_at
        LIMIT $3 OFFSET $4`,
      [c.id, user.id, page.sqlLimit, page.offset]
    );
    // PublicUser + role (avatarUrl is part of PublicUser).
    const items = await Promise.all(rows.slice(0, page.limit).map(async (r) => ({ ...(await P.publicUser(r)), role: r.role, joinedAt: r.joined_at })));
    return { items, nextCursor: pageOf(rows, page).nextCursor };
  },

  'DELETE /v1/circles/{circleId}/members/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const m = await db.one('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, user.id]);
    if (!m) throw err.notFound('not_circle_member');
    if (m.role === 'owner') throw err.conflict('owner_must_transfer', 'Make someone else owner before leaving');
    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, user.id]);
      await client.query("UPDATE conversation_members SET left_at = now() WHERE user_id = $2 AND conversation_id IN (SELECT id FROM conversations WHERE kind = 'circle' AND circle_id = $1)", [req.params.circleId, user.id]);
    });
    return { ok: true };
  },

  'DELETE /v1/circles/{circleId}/members/{userId}': async (req) => {
    const user = await requireUser(req);
    const [mine, theirs] = await Promise.all([
      db.one('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, user.id]),
      db.one('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, req.params.userId]),
    ]);
    if (!mine || !['owner', 'moderator'].includes(mine.role)) throw err.forbidden('owner_or_moderator_only');
    if (!theirs) throw err.notFound('member_not_found');
    if (theirs.role === 'owner' || (theirs.role === 'moderator' && mine.role !== 'owner')) throw err.forbidden('cannot_remove_role');
    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, req.params.userId]);
      await client.query("UPDATE conversation_members SET left_at = now() WHERE user_id = $2 AND conversation_id IN (SELECT id FROM conversations WHERE kind = 'circle' AND circle_id = $1)", [req.params.circleId, req.params.userId]);
      await audit(client, { actorUserId: user.id, action: 'circle.member_remove', targetType: 'circle', targetId: req.params.circleId, metadata: { userId: req.params.userId }, ip: req.ip });
    });
    return { ok: true };
  },

  'POST /v1/circles/{circleId}/plans': async (req) => {
    const user = await requireUser(req);
    assertProfile(user);
    assertAdult(user);
    assertCanAct(user, 'create');
    await loadCircle(user.id, req.params.circleId, { requireMember: true });
    await enforce(db, 'create_plan', user.id);
    const visibility = req.body.visibility === 'public' ? 'public' : 'circle';
    const { id } = await db.withTransaction((client) => A.createActivity(client, user, { ...req.body, visibility }, { circleId: req.params.circleId, visibility, ip: req.ip }));
    const row = await A.getVisible(db, id, user.id);
    return created(A.present(row, { viewerId: user.id }));
  },

  'GET /v1/circles/{circleId}/challenge': async (req) => {
    const user = await requireUser(req);
    await loadCircle(user.id, req.params.circleId);
    return { challenge: await activeChallenge(user.id, req.params.circleId) };
  },

  'POST /v1/circles/{circleId}/challenge/join': async (req) => {
    const user = await requireUser(req);
    await loadCircle(user.id, req.params.circleId, { requireMember: true });
    const ch = await db.one('SELECT id FROM circle_challenges WHERE circle_id = $1 AND ends_at > now() ORDER BY starts_at LIMIT 1', [req.params.circleId]);
    if (!ch) throw err.notFound('no_active_challenge');
    await db.query('INSERT INTO circle_challenge_progress (challenge_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ch.id, user.id]);
    return { challenge: await activeChallenge(user.id, req.params.circleId) };
  },
};

exports.handler = createRouter(routes);
