'use strict';
// Admin web API (/v1/admin/*). Authorised by the ADMIN user pool's JWT
// authorizer + Cognito groups: 'admin' → all; 'moderator' → reports,
// activities, users, audit. Every state-changing call writes audit_events.
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { pageParams, pageOf } = require('../lib/page');
const media = require('../lib/media');
const realtime = require('../lib/realtime');
const { cognito } = require('../lib/aws');
const { REASON_CODES } = require('../services/safety');

const RANGE_DAYS = { '7d': 7, '30d': 30 };

async function signOutAppUser(userId) {
  if (!process.env.USER_POOL_ID) return;
  const u = await db.one('SELECT cognito_sub FROM app_users WHERE id = $1', [userId]);
  if (!u || !u.cognito_sub) return;
  const { AdminUserGlobalSignOutCommand } = require('@aws-sdk/client-cognito-identity-provider');
  await cognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: process.env.USER_POOL_ID, Username: u.cognito_sub })).catch(() => {});
}

async function setUserStatus(client, after, adminId, userId, status, reason, durationDays, ip) {
  const until = durationDays ? new Date(Date.now() + durationDays * 86400000).toISOString() : null;
  const { rowCount } = await client.query("UPDATE app_users SET status = $2, status_reason = $3, status_until = $4 WHERE id = $1 AND status <> 'deleted'", [userId, status, reason, until]);
  if (!rowCount) throw err.notFound('user_not_found');
  if (status !== 'active') await client.query("UPDATE availability_status SET status = 'busy' WHERE user_id = $1", [userId]);
  if (status === 'suspended') {
    await client.query("UPDATE activities SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'host_suspended' WHERE host_user_id = $1 AND status IN ('open','full')", [userId]);
    after(() => signOutAppUser(userId));
  }
  await notify(client, after, userId, {
    type: 'safety',
    title: status === 'active' ? 'Your account is fully restored' : status === 'limited' ? 'Some actions are paused on your account' : 'Your account is suspended',
    body: status === 'active' ? 'Thanks for your patience.' : 'See Safety → Case status for details and how to appeal.',
    data: { target: { screen: 'safety_center', params: { tab: 'case' } } },
  });
  await audit(client, { actorAdminId: adminId, action: `user.status.${status}`, targetType: 'user', targetId: userId, metadata: { reason, durationDays: durationDays || null }, ip });
}

const userBrief = (id, name, status) => (id ? { id, name, status } : null);

const routes = {
  'GET /v1/admin/kpis': async (req) => {
    await requireAdmin(req, 'admin');
    const { range } = check({ range: { type: 'string', enum: ['7d', '30d'], default: '7d' } }, req.query);
    const days = RANGE_DAYS[range];
    const [users, acts, joins, show, liquidity, safety, revenue, series] = await Promise.all([
      db.one(
        `SELECT count(*) FILTER (WHERE status <> 'deleted')::int AS total,
                count(*) FILTER (WHERE created_at >= now() - make_interval(days => $1))::int AS new,
                count(*) FILTER (WHERE last_active_at >= now() - make_interval(days => $1))::int AS active
           FROM app_users`,
        [days]
      ),
      db.one(
        `SELECT count(*) FILTER (WHERE created_at >= now() - make_interval(days => $1))::int AS created,
                count(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - make_interval(days => $1))::int AS completed,
                count(*) FILTER (WHERE status = 'cancelled' AND cancelled_at >= now() - make_interval(days => $1))::int AS cancelled
           FROM activities`,
        [days]
      ),
      db.one(
        `SELECT count(*) FILTER (WHERE p.user_id <> a.host_user_id)::int AS requests,
                count(*) FILTER (WHERE p.user_id <> a.host_user_id AND p.state IN ('accepted','checked_in','completed','no_show'))::int AS accepted
           FROM activity_participants p JOIN activities a ON a.id = p.activity_id
          WHERE p.requested_at >= now() - make_interval(days => $1)`,
        [days]
      ),
      db.one(
        `SELECT count(*) FILTER (WHERE p.check_in_method IS NOT NULL OR p.state = 'completed')::int AS showed,
                count(*) FILTER (WHERE p.state IN ('accepted','checked_in','completed','no_show'))::int AS accepted,
                count(DISTINCT a.id) FILTER (WHERE a.status = 'completed')::int AS completed_plans,
                count(DISTINCT a.id)::int AS plans
           FROM activity_participants p JOIN activities a ON a.id = p.activity_id
          WHERE a.ends_at BETWEEN now() - make_interval(days => $1) AND now() AND p.user_id <> a.host_user_id`,
        [days]
      ),
      db.one(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (first_accept - a.created_at)) / 60) AS median_min
           FROM activities a JOIN LATERAL (SELECT min(p.decided_at) AS first_accept FROM activity_participants p
                                            WHERE p.activity_id = a.id AND p.user_id <> a.host_user_id AND p.state IN ('accepted','checked_in','completed')) f ON f.first_accept IS NOT NULL
          WHERE a.created_at >= now() - make_interval(days => $1)`,
        [days]
      ),
      db.one(
        `SELECT count(*) FILTER (WHERE status IN ('open','reviewing','appealed'))::int AS open,
                count(*) FILTER (WHERE status IN ('open','reviewing') AND priority = 'urgent')::int AS urgent,
                count(*) FILTER (WHERE status = 'actioned' AND resolved_at >= now() - make_interval(days => $1))::int AS substantiated
           FROM reports`,
        [days]
      ),
      db.one(
        `SELECT count(*) FILTER (WHERE entitlement IN ('plus','pro') AND (expires_at IS NULL OR expires_at > now()))::int AS subscriptions,
                count(*) FILTER (WHERE entitlement = 'venue' AND (expires_at IS NULL OR expires_at > now()))::int AS venue
           FROM entitlements`
      ),
      db.many(
        `SELECT d::date AS day,
                (SELECT count(*)::int FROM app_users u WHERE u.created_at::date = d::date) AS signups,
                (SELECT count(*)::int FROM activities a WHERE a.completed_at::date = d::date) AS completed
           FROM generate_series(current_date - ($1 - 1), current_date, interval '1 day') d ORDER BY d`,
        [days]
      ),
    ]);
    const wau = users.active || 0;
    return {
      range,
      users,
      activities: acts,
      joins: { ...joins, conversion: joins.requests ? Math.round((joins.accepted / joins.requests) * 100) / 100 : null },
      showUpRate: show.accepted ? Math.round((show.showed / show.accepted) * 100) / 100 : null,
      completionRate: show.plans ? Math.round((show.completed_plans / show.plans) * 100) / 100 : null,
      medianMinutesToFirstAccept: liquidity.median_min != null ? Math.round(Number(liquidity.median_min)) : null,
      completedPerActiveUser: wau ? Math.round((acts.completed / wau) * 100) / 100 : null,
      safety: { openReports: safety.open, urgentOpen: safety.urgent, substantiatedPer1000Meetups: acts.completed ? Math.round((safety.substantiated / acts.completed) * 1000 * 10) / 10 : null },
      revenue: { activeSubscriptions: revenue.subscriptions, venuePlans: revenue.venue },
      series,
    };
  },

  'GET /v1/admin/reports': async (req) => {
    await requireAdmin(req, 'moderator');
    const q = check({ status: { type: 'string', enum: ['open', 'reviewing', 'actioned', 'dismissed', 'appealed', 'queue'], default: 'queue' } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    const statuses = q.status === 'queue' ? ['open', 'reviewing', 'appealed'] : [q.status];
    const rows = await db.many(
      `SELECT r.*, rp.display_name AS reporter_name, tp.display_name AS reported_name, tu.status AS reported_status, a.title AS activity_title,
              left(m.body, 160) AS message_snippet,
              (SELECT count(*)::int FROM reports x WHERE x.reported_user_id = r.reported_user_id AND x.id <> r.id) AS prior_reports
         FROM reports r
         LEFT JOIN profiles rp ON rp.user_id = r.reporter_user_id
         LEFT JOIN profiles tp ON tp.user_id = r.reported_user_id
         LEFT JOIN app_users tu ON tu.id = r.reported_user_id
         LEFT JOIN activities a ON a.id = r.activity_id
         LEFT JOIN messages m ON m.id = r.message_id
        WHERE r.status = ANY($1)
        ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.created_at
        LIMIT $2 OFFSET $3`,
      [statuses, page.sqlLimit, page.offset]
    );
    return pageOf(rows, page, (r) => ({
      id: r.id,
      reasonCode: r.reason_code,
      status: r.status,
      priority: r.priority,
      createdAt: r.created_at,
      reporter: userBrief(r.reporter_user_id, r.reporter_name),
      reported: userBrief(r.reported_user_id, r.reported_name, r.reported_status),
      activity: r.activity_id ? { id: r.activity_id, title: r.activity_title } : null,
      messageSnippet: r.message_snippet,
      priorReports: r.prior_reports,
    }));
  },

  'GET /v1/admin/reports/{reportId}': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const r = await db.one(
      `SELECT r.*, rp.display_name AS reporter_name, tp.display_name AS reported_name, tu.status AS reported_status, tu.created_at AS reported_since,
              a.title AS activity_title, a.status AS activity_status, a.venue_name, a.coarse_area
         FROM reports r LEFT JOIN profiles rp ON rp.user_id = r.reporter_user_id LEFT JOIN profiles tp ON tp.user_id = r.reported_user_id
         LEFT JOIN app_users tu ON tu.id = r.reported_user_id LEFT JOIN activities a ON a.id = r.activity_id
        WHERE r.id = $1`,
      [req.params.reportId]
    );
    if (!r) throw err.notFound('report_not_found');
    const [actions, appeals, context, history] = await Promise.all([
      db.many('SELECT ra.*, au.email AS admin_email FROM report_actions ra LEFT JOIN admin_users au ON au.id = ra.admin_id WHERE ra.report_id = $1 ORDER BY ra.created_at', [r.id]),
      db.many('SELECT * FROM appeals WHERE report_id = $1 ORDER BY created_at', [r.id]),
      r.message_id
        ? db.many(
            `SELECT m.id, m.sender_user_id, m.body, m.kind, m.created_at, m.deleted_at FROM messages m
              WHERE m.conversation_id = (SELECT conversation_id FROM messages WHERE id = $1)
                AND m.created_at BETWEEN (SELECT created_at FROM messages WHERE id = $1) - interval '30 minutes' AND (SELECT created_at FROM messages WHERE id = $1) + interval '30 minutes'
              ORDER BY m.created_at LIMIT 30`,
            [r.message_id]
          )
        : [],
      r.reported_user_id ? db.many('SELECT id, reason_code, status, created_at FROM reports WHERE reported_user_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 20', [r.reported_user_id, r.id]) : [],
    ]);
    const evidence = await Promise.all((r.evidence_keys || []).map(async (key) => ({ key, url: await media.signedGet(key, 300) })));
    if (evidence.length) await audit(db, { actorAdminId: admin.id, action: 'report.evidence_viewed', targetType: 'report', targetId: r.id, metadata: { count: evidence.length }, ip: req.ip });
    if (r.status === 'open') {
      await db.query("UPDATE reports SET status = 'reviewing', assigned_admin_id = COALESCE(assigned_admin_id, $2) WHERE id = $1", [r.id, admin.id]);
      await audit(db, { actorAdminId: admin.id, action: 'report.review_started', targetType: 'report', targetId: r.id, ip: req.ip });
    }
    return {
      id: r.id,
      reasonCode: r.reason_code,
      details: r.details,
      status: r.status === 'open' ? 'reviewing' : r.status,
      priority: r.priority,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      reporter: userBrief(r.reporter_user_id, r.reporter_name),
      reported: r.reported_user_id ? { id: r.reported_user_id, name: r.reported_name, status: r.reported_status, memberSince: r.reported_since } : null,
      activity: r.activity_id ? { id: r.activity_id, title: r.activity_title, status: r.activity_status, venueName: r.venue_name, area: r.coarse_area } : null,
      messageId: r.message_id,
      messageContext: context.map((m) => ({ id: m.id, senderId: m.kind === 'system' ? 'system' : m.sender_user_id, body: m.body, deleted: !!m.deleted_at, createdAt: m.created_at, reported: m.id === r.message_id })),
      evidence,
      actions: actions.map((a) => ({ id: a.id, action: a.action, notes: a.notes, durationDays: a.duration_days, admin: a.admin_email, createdAt: a.created_at })),
      appeals: appeals.map((a) => ({ id: a.id, statement: a.statement, status: a.status, createdAt: a.created_at, decidedAt: a.decided_at })),
      otherReportsAgainstUser: history.map((h) => ({ id: h.id, reasonCode: h.reason_code, status: h.status, createdAt: h.created_at })),
    };
  },

  'POST /v1/admin/reports/{reportId}/actions': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const v = check(
      {
        action: { type: 'string', required: true, enum: ['warn', 'limit', 'suspend', 'remove_content', 'dismiss'] },
        reason: { type: 'string', required: true, min: 3, max: 1000 },
        durationDays: { type: 'integer', min: 1, max: 365 },
      },
      req.body
    );
    await db.withTransaction(async (client, after) => {
      const { rows } = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [req.params.reportId]);
      const r = rows[0];
      if (!r) throw err.notFound('report_not_found');
      if (['warn', 'limit', 'suspend'].includes(v.action) && !r.reported_user_id) throw err.badRequest('no_reported_user');
      await client.query('INSERT INTO report_actions (report_id, admin_id, action, notes, duration_days) VALUES ($1, $2, $3, $4, $5)', [r.id, admin.id, v.action, v.reason, v.durationDays || null]);
      switch (v.action) {
        case 'warn':
          await notify(client, after, r.reported_user_id, { type: 'safety', title: 'A note from the safety team', body: 'A report about you was reviewed. Please follow the community rules — repeated issues can limit your account.', data: { target: { screen: 'safety_center', params: { tab: 'case' } } } });
          break;
        case 'limit':
          await setUserStatus(client, after, admin.id, r.reported_user_id, 'limited', v.reason, v.durationDays, req.ip);
          break;
        case 'suspend':
          await setUserStatus(client, after, admin.id, r.reported_user_id, 'suspended', v.reason, v.durationDays, req.ip);
          break;
        case 'remove_content':
          if (r.message_id) {
            await client.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [r.message_id]);
          } else if (r.activity_id) {
            await client.query("UPDATE activities SET status = 'moderated', moderation_note = $2 WHERE id = $1", [r.activity_id, v.reason]);
            after(() => realtime.publish(`activity:${r.activity_id}`, { type: 'activity.updated', data: { activityId: r.activity_id, status: 'moderated' } }));
          } else if (r.reported_user_id) {
            await client.query("UPDATE profiles SET bio = NULL, avatar_key = NULL, updated_at = now() WHERE user_id = $1", [r.reported_user_id]);
          }
          break;
        default:
          break;
      }
      await client.query("UPDATE reports SET status = $2, resolved_at = now() WHERE id = $1", [r.id, v.action === 'dismiss' ? 'dismissed' : 'actioned']);
      await audit(client, { actorAdminId: admin.id, action: `report.${v.action}`, targetType: 'report', targetId: r.id, metadata: { reason: v.reason, durationDays: v.durationDays || null, reportedUserId: r.reported_user_id }, ip: req.ip });
    });
    return routes['GET /v1/admin/reports/{reportId}'](req);
  },

  'POST /v1/admin/reports/{reportId}/appeal': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ decision: { type: 'string', required: true, enum: ['uphold', 'overturn'] }, reason: { type: 'string', required: true, min: 3, max: 1000 } }, req.body);
    await db.withTransaction(async (client, after) => {
      const { rows } = await client.query("SELECT ap.*, r.reported_user_id FROM appeals ap JOIN reports r ON r.id = ap.report_id WHERE ap.report_id = $1 AND ap.status = 'open' FOR UPDATE OF ap", [req.params.reportId]);
      const ap = rows[0];
      if (!ap) throw err.notFound('no_open_appeal');
      await client.query('UPDATE appeals SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1', [ap.id, v.decision === 'uphold' ? 'upheld' : 'overturned', admin.id]);
      await client.query("UPDATE reports SET status = $2, resolved_at = now() WHERE id = $1", [req.params.reportId, v.decision === 'uphold' ? 'actioned' : 'dismissed']);
      if (v.decision === 'overturn') {
        await client.query("INSERT INTO report_actions (report_id, admin_id, action, notes) VALUES ($1, $2, 'restore', $3)", [req.params.reportId, admin.id, v.reason]);
        await client.query("INSERT INTO reliability_events (user_id, kind) VALUES ($1, 'appeal_upheld') ON CONFLICT DO NOTHING", [ap.user_id]);
        await setUserStatus(client, after, admin.id, ap.user_id, 'active', `appeal overturned: ${v.reason}`, null, req.ip);
      } else {
        await notify(client, after, ap.user_id, { type: 'safety', title: 'Appeal reviewed', body: 'The original decision stands. You can contact support for more details.', data: { target: { screen: 'safety_center', params: { tab: 'case' } } } });
      }
      await audit(client, { actorAdminId: admin.id, action: `appeal.${v.decision}`, targetType: 'report', targetId: req.params.reportId, metadata: { reason: v.reason, appealId: ap.id }, ip: req.ip });
    });
    return routes['GET /v1/admin/reports/{reportId}'](req);
  },

  'GET /v1/admin/users/{userId}': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const u = await db.one(
      `SELECT u.*, p.display_name, p.bio, p.avatar_key, p.home_city, p.home_area, p.interests, p.visibility, p.reliability_score,
              up.xp_total, up.level,
              (SELECT count(*)::int FROM activities a WHERE a.host_user_id = u.id) AS hosted,
              (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'completed') AS completed,
              (SELECT count(*)::int FROM activity_participants x WHERE x.user_id = u.id AND x.state = 'no_show') AS no_shows,
              (SELECT count(*)::int FROM user_blocks b WHERE b.blocked_user_id = u.id) AS blocked_by
         FROM app_users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN user_progress up ON up.user_id = u.id
        WHERE u.id = $1`,
      [req.params.userId]
    );
    if (!u) throw err.notFound('user_not_found');
    const [against, by, auditRows, ents] = await Promise.all([
      db.many('SELECT id, reason_code, status, priority, created_at FROM reports WHERE reported_user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]),
      db.many('SELECT id, reason_code, status, created_at FROM reports WHERE reporter_user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]),
      db.many("SELECT a.*, au.email AS admin_email FROM audit_events a LEFT JOIN admin_users au ON au.id = a.actor_admin_id WHERE (a.target_type = 'user' AND a.target_id = $1) OR a.actor_user_id = $2 ORDER BY a.created_at DESC LIMIT 100", [String(u.id), u.id]),
      db.many('SELECT entitlement, source, expires_at FROM entitlements WHERE user_id = $1', [u.id]),
    ]);
    await audit(db, { actorAdminId: admin.id, action: 'user.viewed', targetType: 'user', targetId: u.id, ip: req.ip });
    return {
      id: u.id,
      phone: u.phone_e164,
      status: u.status,
      statusReason: u.status_reason,
      statusUntil: u.status_until,
      createdAt: u.created_at,
      lastActiveAt: u.last_active_at,
      verification: { phone: !!u.cognito_sub, ageSelfDeclaredAt: u.age_verified_at, ageMethod: u.age_verification_method, termsAcceptedAt: u.terms_accepted_at },
      profile: u.display_name ? { name: u.display_name, bio: u.bio, avatarKey: u.avatar_key, city: u.home_city, area: u.home_area, interests: u.interests, visibility: u.visibility } : null,
      stats: { xp: u.xp_total || 0, level: u.level || 1, hosted: u.hosted, completed: u.completed, noShows: u.no_shows, blockedBy: u.blocked_by, reliability: Number(u.reliability_score || 1) },
      entitlements: ents.map((e) => ({ entitlement: e.entitlement, source: e.source, expiresAt: e.expires_at })),
      reportsAgainst: against.map((r) => ({ id: r.id, reasonCode: r.reason_code, status: r.status, priority: r.priority, createdAt: r.created_at })),
      reportsFiled: by.map((r) => ({ id: r.id, reasonCode: r.reason_code, status: r.status, createdAt: r.created_at })),
      audit: auditRows.map((a) => ({ id: a.id, action: a.action, actor: a.actor_admin_id ? { type: 'admin', email: a.admin_email } : { type: 'user', id: a.actor_user_id }, metadata: a.metadata, createdAt: a.created_at })),
    };
  },

  'POST /v1/admin/users/{userId}/status': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ status: { type: 'string', required: true, enum: ['active', 'limited', 'suspended'] }, reason: { type: 'string', required: true, min: 3, max: 1000 }, durationDays: { type: 'integer', min: 1, max: 365 } }, req.body);
    await db.withTransaction((client, after) => setUserStatus(client, after, admin.id, req.params.userId, v.status, v.reason, v.durationDays, req.ip));
    return { id: req.params.userId, status: v.status };
  },

  'GET /v1/admin/audit': async (req) => {
    await requireAdmin(req, 'moderator');
    const q = check({ entityType: { type: 'string', max: 40 }, entityId: { type: 'string', max: 80 }, action: { type: 'string', max: 60 } }, req.query);
    const page = pageParams(req.query, { def: 50, max: 200 });
    const rows = await db.many(
      `SELECT a.*, au.email AS admin_email FROM audit_events a LEFT JOIN admin_users au ON au.id = a.actor_admin_id
        WHERE ($1::text IS NULL OR a.target_type = $1) AND ($2::text IS NULL OR a.target_id = $2) AND ($3::text IS NULL OR a.action LIKE $3 || '%')
        ORDER BY a.created_at DESC LIMIT $4 OFFSET $5`,
      [q.entityType || null, q.entityId || null, q.action || null, page.sqlLimit, page.offset]
    );
    return pageOf(rows, page, (a) => ({
      id: String(a.id),
      action: a.action,
      entityType: a.target_type,
      entityId: a.target_id,
      actor: a.actor_admin_id ? { type: 'admin', id: a.actor_admin_id, email: a.admin_email } : a.actor_user_id ? { type: 'user', id: a.actor_user_id } : { type: 'system' },
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.created_at,
    }));
  },

  'GET /v1/admin/activities': async (req) => {
    await requireAdmin(req, 'moderator');
    const { queue } = check({ queue: { type: 'string', enum: ['flagged', 'recent'], default: 'flagged' } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    // Flagged = reported, elevated-risk category, host limited, or late-night/low-reliability signals.
    const flaggedWhere = `(
        EXISTS (SELECT 1 FROM reports r WHERE r.activity_id = a.id AND r.status IN ('open','reviewing'))
        OR c.risk_level = 'elevated'
        OR hu.status = 'limited'
        OR (hp.reliability_score < 0.7)
        OR (extract(hour FROM a.starts_at AT TIME ZONE 'Asia/Kolkata') >= 23 OR extract(hour FROM a.starts_at AT TIME ZONE 'Asia/Kolkata') < 5)
      ) AND a.status IN ('open','full','in_progress') AND a.moderation_note IS DISTINCT FROM 'approved'`;
    const rows = await db.many(
      `SELECT a.*, c.slug AS category_slug, c.risk_level, hp.display_name AS host_name, hu.status AS host_status, hp.reliability_score,
              (SELECT count(*)::int FROM reports r WHERE r.activity_id = a.id) AS report_count,
              (SELECT count(*)::int FROM activity_participants p WHERE p.activity_id = a.id AND p.state IN ('accepted','checked_in','completed')) AS joined
         FROM activities a JOIN app_users hu ON hu.id = a.host_user_id JOIN profiles hp ON hp.user_id = a.host_user_id
         LEFT JOIN activity_categories c ON c.id = a.category_id
        WHERE ${queue === 'flagged' ? flaggedWhere : "a.created_at >= now() - interval '7 days'"}
        ORDER BY ${queue === 'flagged' ? 'report_count DESC, a.starts_at' : 'a.created_at DESC'}
        LIMIT $1 OFFSET $2`,
      [page.sqlLimit, page.offset]
    );
    return pageOf(rows, page, (a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      category: a.category_slug,
      riskLevel: a.risk_level,
      status: a.status,
      startsAt: a.starts_at,
      area: a.coarse_area,
      venueName: a.venue_name,
      venueType: a.venue_type,
      latitude: a.latitude,
      longitude: a.longitude,
      capacity: a.capacity,
      joinedCount: a.joined,
      host: { id: a.host_user_id, name: a.host_name, status: a.host_status, reliability: Number(a.reliability_score) },
      reportCount: a.report_count,
      moderationNote: a.moderation_note,
      createdAt: a.created_at,
    }));
  },

  'POST /v1/admin/activities/{activityId}/decision': async (req) => {
    const admin = await requireAdmin(req, 'moderator');
    const v = check({ decision: { type: 'string', required: true, enum: ['approve', 'remove'] }, reason: { type: 'string', required: true, min: 3, max: 1000 } }, req.body);
    await db.withTransaction(async (client, after) => {
      const { rows } = await client.query('SELECT id, host_user_id, title, status FROM activities WHERE id = $1 FOR UPDATE', [req.params.activityId]);
      const a = rows[0];
      if (!a) throw err.notFound('activity_not_found');
      if (v.decision === 'approve') {
        await client.query("UPDATE activities SET moderation_note = 'approved' WHERE id = $1", [a.id]);
      } else {
        await client.query("UPDATE activities SET status = 'moderated', moderation_note = $2 WHERE id = $1", [a.id, v.reason]);
        const { rows: ps } = await client.query("SELECT user_id FROM activity_participants WHERE activity_id = $1 AND state IN ('requested','accepted','waitlisted','checked_in')", [a.id]);
        for (const p of ps) {
          await notify(client, after, p.user_id, {
            type: p.user_id === a.host_user_id ? 'safety' : 'activity',
            title: p.user_id === a.host_user_id ? 'Your plan was removed' : 'A plan you joined was removed',
            body: p.user_id === a.host_user_id ? 'It did not meet the community guidelines. You can appeal from Safety.' : `"${a.title}" is no longer available.`,
            data: { activityId: a.id, target: { screen: p.user_id === a.host_user_id ? 'safety_center' : 'my_activities', params: {} } },
          });
        }
        after(() => realtime.publish(`activity:${a.id}`, { type: 'activity.updated', data: { activityId: a.id, status: 'moderated' } }));
      }
      await audit(client, { actorAdminId: admin.id, action: `activity.${v.decision}`, targetType: 'activity', targetId: a.id, metadata: { reason: v.reason }, ip: req.ip });
    });
    return { id: req.params.activityId, decision: v.decision };
  },

  // ---- admin-only below ----
  'GET /v1/admin/billing/subscriptions': async (req) => {
    await requireAdmin(req, 'admin');
    const { q } = check({ q: { type: 'string', max: 80 } }, req.query);
    const page = pageParams(req.query, { def: 25, max: 100 });
    const rows = await db.many(
      `SELECT s.id, s.user_id, s.store, s.product_id, s.status, s.started_at, s.expires_at, s.store_transaction_id, s.original_transaction_id, s.updated_at,
              u.phone_e164, p.display_name
         FROM subscriptions s JOIN app_users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = u.id
        WHERE $1::text IS NULL OR u.phone_e164 LIKE '%' || $1 || '%' OR s.user_id::text = $1 OR s.original_transaction_id = $1 OR p.display_name ILIKE '%' || $1 || '%'
        ORDER BY s.updated_at DESC LIMIT $2 OFFSET $3`,
      [q || null, page.sqlLimit, page.offset]
    );
    // No card or payment-instrument data exists in this system.
    return pageOf(rows, page, (s) => ({
      id: s.id,
      user: { id: s.user_id, name: s.display_name, phone: s.phone_e164 },
      store: s.store,
      productId: s.product_id,
      status: s.status,
      startedAt: s.started_at,
      expiresAt: s.expires_at,
      transactionId: s.store_transaction_id,
      originalTransactionId: s.original_transaction_id,
      updatedAt: s.updated_at,
    }));
  },

  'GET /v1/admin/billing/campaigns': async (req) => {
    await requireAdmin(req, 'admin');
    const [campaigns, invoices, businesses] = await Promise.all([
      db.many(
        `SELECT c.*, b.name AS business_name, COALESCE(sum(m.impressions), 0)::int AS impressions, COALESCE(sum(m.clicks), 0)::int AS clicks,
                COALESCE(sum(m.join_requests), 0)::int AS join_requests, COALESCE(sum(m.check_ins), 0)::int AS check_ins
           FROM sponsored_campaigns c JOIN business_profiles b ON b.id = c.business_id LEFT JOIN campaign_metrics m ON m.campaign_id = c.id
          GROUP BY c.id, b.name ORDER BY c.created_at DESC LIMIT 200`
      ),
      db.many('SELECT i.*, b.name AS business_name FROM business_invoices i JOIN business_profiles b ON b.id = i.business_id ORDER BY i.created_at DESC LIMIT 200'),
      db.many("SELECT id, name, kind, verification_status, contact_email, created_at FROM business_profiles ORDER BY (verification_status = 'pending') DESC, created_at DESC LIMIT 200"),
    ]);
    return {
      campaigns: campaigns.map((c) => ({ id: c.id, business: { id: c.business_id, name: c.business_name }, title: c.title, status: c.status, label: c.label, budgetMinor: Number(c.budget_minor), startsAt: c.starts_at, endsAt: c.ends_at, metrics: { impressions: c.impressions, clicks: c.clicks, joinRequests: c.join_requests, checkIns: c.check_ins } })),
      invoices: invoices.map((i) => ({ id: i.id, business: { id: i.business_id, name: i.business_name }, planCode: i.plan_code, amountMinor: Number(i.amount_minor), currency: i.currency, status: i.status, razorpayOrderId: i.razorpay_order_id, razorpayPaymentId: i.razorpay_payment_id, createdAt: i.created_at, paidAt: i.paid_at })),
      businesses: businesses.map((b) => ({ id: b.id, name: b.name, kind: b.kind, verificationStatus: b.verification_status, contactEmail: b.contact_email, createdAt: b.created_at })),
    };
  },

  // Extensions used by the business flow (labelled sponsored placements must be reviewed).
  'POST /v1/admin/billing/campaigns/{campaignId}/decision': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check({ decision: { type: 'string', required: true, enum: ['approve', 'reject', 'pause'] }, reason: { type: 'string', required: true, min: 3, max: 500 } }, req.body);
    const status = { approve: 'active', reject: 'rejected', pause: 'paused' }[v.decision];
    await db.withTransaction(async (client) => {
      const { rows } = await client.query('UPDATE sponsored_campaigns SET status = $2 WHERE id = $1 RETURNING activity_id', [req.params.campaignId, status]);
      if (!rows[0]) throw err.notFound('campaign_not_found');
      if (rows[0].activity_id) await client.query('UPDATE activities SET sponsored_campaign_id = $2 WHERE id = $1', [rows[0].activity_id, status === 'active' ? req.params.campaignId : null]);
      await audit(client, { actorAdminId: admin.id, action: `campaign.${v.decision}`, targetType: 'campaign', targetId: req.params.campaignId, metadata: { reason: v.reason }, ip: req.ip });
    });
    return { id: req.params.campaignId, status };
  },

  'POST /v1/admin/businesses/{businessId}/verification': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check({ decision: { type: 'string', required: true, enum: ['verify', 'reject', 'suspend'] }, reason: { type: 'string', required: true, min: 3, max: 500 } }, req.body);
    const status = { verify: 'verified', reject: 'rejected', suspend: 'suspended' }[v.decision];
    await db.withTransaction(async (client) => {
      const { rowCount } = await client.query('UPDATE business_profiles SET verification_status = $2, review_note = $3 WHERE id = $1', [req.params.businessId, status, v.reason]);
      if (!rowCount) throw err.notFound('business_not_found');
      await client.query('UPDATE venues SET verified = $2 WHERE business_id = $1', [req.params.businessId, status === 'verified']);
      await audit(client, { actorAdminId: admin.id, action: `business.${v.decision}`, targetType: 'business', targetId: req.params.businessId, metadata: { reason: v.reason }, ip: req.ip });
    });
    return { id: req.params.businessId, verificationStatus: status };
  },

  'GET /v1/admin/taxonomy/categories': async (req) => {
    await requireAdmin(req, 'admin');
    const rows = await db.many('SELECT c.*, (SELECT count(*)::int FROM activities a WHERE a.category_id = c.id) AS activity_count FROM activity_categories c ORDER BY c.sort_order, c.label');
    return { items: rows.map((c) => ({ slug: c.slug, label: c.label, short: c.short, pictogram: c.pictogram, riskLevel: c.risk_level, active: c.is_active, sortOrder: c.sort_order, activityCount: c.activity_count })), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/categories': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        slug: { type: 'string', required: true, format: 'slug' },
        label: { type: 'string', required: true, max: 40 },
        short: { type: 'string', max: 16 },
        pictogram: { type: 'string', max: 30 },
        riskLevel: { type: 'string', enum: ['standard', 'elevated', 'restricted'], default: 'standard' },
        sortOrder: { type: 'integer', min: 0, max: 10000, default: 100 },
      },
      req.body
    );
    const c = await db.one('INSERT INTO activity_categories (slug, label, short, pictogram, risk_level, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [v.slug, v.label, v.short || v.label, v.pictogram || 'sparkle', v.riskLevel, v.sortOrder]);
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.category.create', targetType: 'category', targetId: c.slug, metadata: v, ip: req.ip });
    return created({ slug: c.slug, label: c.label, short: c.short, pictogram: c.pictogram, riskLevel: c.risk_level, active: c.is_active, sortOrder: c.sort_order });
  },

  'PATCH /v1/admin/taxonomy/categories/{slug}': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check({ label: { type: 'string', max: 40 }, short: { type: 'string', max: 16 }, pictogram: { type: 'string', max: 30 }, riskLevel: { type: 'string', enum: ['standard', 'elevated', 'restricted'] }, active: { type: 'boolean' }, sortOrder: { type: 'integer', min: 0, max: 10000 } }, req.body);
    const c = await db.one(
      `UPDATE activity_categories SET label = COALESCE($2, label), short = COALESCE($3, short), pictogram = COALESCE($4, pictogram),
         risk_level = COALESCE($5, risk_level), is_active = COALESCE($6, is_active), sort_order = COALESCE($7, sort_order)
       WHERE slug = $1 RETURNING *`,
      [req.params.slug, v.label ?? null, v.short ?? null, v.pictogram ?? null, v.riskLevel ?? null, v.active ?? null, v.sortOrder ?? null]
    );
    if (!c) throw err.notFound('category_not_found');
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.category.update', targetType: 'category', targetId: c.slug, metadata: v, ip: req.ip });
    return { slug: c.slug, label: c.label, short: c.short, pictogram: c.pictogram, riskLevel: c.risk_level, active: c.is_active, sortOrder: c.sort_order };
  },

  'GET /v1/admin/taxonomy/areas': async (req) => {
    await requireAdmin(req, 'admin');
    const rows = await db.many('SELECT id, city, name, active, ST_Y(centroid::geometry) AS latitude, ST_X(centroid::geometry) AS longitude FROM city_areas ORDER BY city, name');
    return { items: rows.map((a) => ({ id: a.id, city: a.city, name: a.name, active: a.active, latitude: a.latitude, longitude: a.longitude })), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/areas': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check({ city: { type: 'string', required: true, max: 60 }, name: { type: 'string', required: true, max: 60 }, latitude: { type: 'number', required: true, min: -90, max: 90 }, longitude: { type: 'number', required: true, min: -180, max: 180 } }, req.body);
    const a = await db.one(
      'INSERT INTO city_areas (city, name, centroid) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography) RETURNING id, city, name, active',
      [v.city, v.name, v.latitude, v.longitude]
    );
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.area.create', targetType: 'area', targetId: a.id, metadata: v, ip: req.ip });
    return created({ ...a, latitude: v.latitude, longitude: v.longitude });
  },

  'PATCH /v1/admin/taxonomy/areas/{areaId}': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check({ name: { type: 'string', max: 60 }, active: { type: 'boolean' }, latitude: { type: 'number', min: -90, max: 90 }, longitude: { type: 'number', min: -180, max: 180 } }, req.body);
    if ((v.latitude == null) !== (v.longitude == null)) throw err.badRequest('invalid_location');
    const a = await db.one(
      `UPDATE city_areas SET name = COALESCE($2, name), active = COALESCE($3, active),
         centroid = CASE WHEN $4::float8 IS NULL THEN centroid ELSE ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography END
       WHERE id = $1 RETURNING id, city, name, active, ST_Y(centroid::geometry) AS latitude, ST_X(centroid::geometry) AS longitude`,
      [req.params.areaId, v.name ?? null, v.active ?? null, v.latitude ?? null, v.longitude ?? null]
    );
    if (!a) throw err.notFound('area_not_found');
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.area.update', targetType: 'area', targetId: a.id, metadata: v, ip: req.ip });
    return a;
  },

  'GET /v1/admin/taxonomy/quests': async (req) => {
    await requireAdmin(req, 'admin');
    const rows = await db.many('SELECT q.*, (SELECT count(*)::int FROM user_quests uq WHERE uq.quest_id = q.id AND uq.state = $1) AS claims FROM quests q ORDER BY q.kind, q.slug', ['claimed']);
    return { items: rows.map((q) => ({ id: q.id, slug: q.slug, kind: q.kind, title: q.title, description: q.description, pictogram: q.pictogram, criteria: q.criteria, xpReward: q.xp_reward, active: q.active, startsAt: q.starts_at, endsAt: q.ends_at, claims: q.claims })), nextCursor: null };
  },

  'POST /v1/admin/taxonomy/quests': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      {
        slug: { type: 'string', required: true, format: 'slug' },
        kind: { type: 'string', required: true, enum: ['daily', 'weekly', 'milestone'] },
        title: { type: 'string', required: true, max: 60 },
        description: { type: 'string', required: true, max: 200 },
        pictogram: { type: 'string', max: 30 },
        criteria: { type: 'object', required: true },
        xpReward: { type: 'integer', required: true, min: 0, max: 500 },
        active: { type: 'boolean', default: true },
        startsAt: { type: 'string', format: 'datetime' },
        endsAt: { type: 'string', format: 'datetime' },
      },
      req.body
    );
    const ALLOWED = ['complete_activities', 'new_people', 'new_category', 'host_completed', 'early_activity', 'late_activity', 'category_completed', 'distinct_categories', 'reliability'];
    if (!ALLOWED.includes(v.criteria.type)) throw err.badRequest('invalid_criteria', `criteria.type must be one of ${ALLOWED.join(', ')} (verified real-world actions only)`);
    const q = await db.one(
      'INSERT INTO quests (slug, kind, title, description, pictogram, criteria, xp_reward, active, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
      [v.slug, v.kind, v.title, v.description, v.pictogram || 'sparkle', JSON.stringify(v.criteria), v.xpReward, v.active, v.startsAt || null, v.endsAt || null]
    );
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.quest.create', targetType: 'quest', targetId: q.id, metadata: v, ip: req.ip });
    return created({ id: q.id, ...v });
  },

  'PATCH /v1/admin/taxonomy/quests/{questId}': async (req) => {
    const admin = await requireAdmin(req, 'admin');
    const v = check(
      { title: { type: 'string', max: 60 }, description: { type: 'string', max: 200 }, pictogram: { type: 'string', max: 30 }, xpReward: { type: 'integer', min: 0, max: 500 }, active: { type: 'boolean' }, startsAt: { type: 'string', format: 'datetime', nullable: true }, endsAt: { type: 'string', format: 'datetime', nullable: true } },
      req.body
    );
    const q = await db.one(
      `UPDATE quests SET title = COALESCE($2, title), description = COALESCE($3, description), pictogram = COALESCE($4, pictogram),
         xp_reward = COALESCE($5, xp_reward), active = COALESCE($6, active),
         starts_at = CASE WHEN $7::boolean THEN $8::timestamptz ELSE starts_at END, ends_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE ends_at END
       WHERE id::text = $1 OR slug = $1 RETURNING *`,
      [req.params.questId, v.title ?? null, v.description ?? null, v.pictogram ?? null, v.xpReward ?? null, v.active ?? null, 'startsAt' in v, v.startsAt ?? null, 'endsAt' in v, v.endsAt ?? null]
    );
    if (!q) throw err.notFound('quest_not_found');
    await audit(db, { actorAdminId: admin.id, action: 'taxonomy.quest.update', targetType: 'quest', targetId: q.id, metadata: v, ip: req.ip });
    return { id: q.id, slug: q.slug, kind: q.kind, title: q.title, description: q.description, pictogram: q.pictogram, criteria: q.criteria, xpReward: q.xp_reward, active: q.active, startsAt: q.starts_at, endsAt: q.ends_at };
  },
};

exports.REASON_CODES = REASON_CODES;
exports.handler = createRouter(routes);
