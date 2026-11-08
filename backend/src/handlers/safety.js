'use strict';
// Reports, blocks, trusted contacts / plan sharing, case status and appeals.
// Never paywalled; available to limited and suspended accounts.
const crypto = require('crypto');
const { createRouter, err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { enqueue } = require('../lib/queue');
const { withIdempotency } = require('../lib/idempotency');
const media = require('../lib/media');
const { sendSms } = require('../lib/aws');
const { normalisePhone } = require('./auth');
const { REASON_CODES, priorityFor } = require('../services/safety');


function istLabel(ts) {
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const routes = {
  'POST /v1/reports': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check(
      {
        userId: { type: 'string', format: 'uuid' },
        reportedUserId: { type: 'string', format: 'uuid' },
        activityId: { type: 'string', format: 'uuid' },
        messageId: { type: 'string', format: 'uuid' },
        conversationId: { type: 'string', format: 'uuid' },
        circleId: { type: 'string', format: 'uuid' },
        reasonCode: { type: 'string', required: true, enum: REASON_CODES },
        details: { type: 'string', max: 2000 },
        evidenceNote: { type: 'string', max: 2000 },
        evidenceKeys: { type: 'array', max: 5, items: { type: 'string', max: 200 }, default: () => [] },
        alsoBlock: { type: 'boolean', default: false },
      },
      req.body
    );
    let reportedUserId = v.userId || v.reportedUserId || null;
    let conversationId = v.conversationId || null;
    let activityId = v.activityId || null;
    if (v.messageId) {
      // Message reports: only members of that conversation; the sender becomes the reported user.
      const m = await db.one(
        `SELECT m.sender_user_id, m.conversation_id, c.activity_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
           JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2 WHERE m.id = $1`,
        [v.messageId, user.id]
      );
      if (!m) throw err.notFound('message_not_found');
      reportedUserId = reportedUserId || m.sender_user_id;
      conversationId = conversationId || m.conversation_id;
      activityId = activityId || m.activity_id;
    }
    if (!reportedUserId && !activityId && !conversationId && !v.circleId) throw err.badRequest('target_required', 'Tell us who or what you are reporting');
    if (reportedUserId === user.id) throw err.badRequest('cannot_report_self');
    if (v.evidenceKeys.some((k) => !media.isOwnedKey(k, 'evidence', user.id))) throw err.badRequest('invalid_evidence_key');
    return withIdempotency(db, req, user.id, async () => {
      await enforce(db, 'report', user.id);
      const r = await db.withTransaction(async (client, after) => {
        const { rows } = await client.query(
          `INSERT INTO reports (reporter_user_id, reported_user_id, activity_id, message_id, conversation_id, circle_id, reason_code, details, evidence_note, evidence_keys, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, status, priority, created_at`,
          [user.id, reportedUserId, activityId, v.messageId || null, conversationId, v.circleId || null, v.reasonCode, v.details || null, v.evidenceNote || null, v.evidenceKeys, priorityFor(v.reasonCode)]
        );
        if (v.alsoBlock && reportedUserId) {
          await client.query('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, reportedUserId]);
          await audit(client, { actorUserId: user.id, action: 'user.block', targetType: 'user', targetId: reportedUserId, metadata: { viaReport: rows[0].id }, ip: req.ip });
        }
        await audit(client, { actorUserId: user.id, action: 'report.create', targetType: 'report', targetId: rows[0].id, metadata: { reasonCode: v.reasonCode }, ip: req.ip });
        after(() => enqueue({ type: 'moderation_alert', reportId: rows[0].id }));
        return rows[0];
      });
      return created({
        id: r.id,
        status: r.status,
        priority: r.priority,
        createdAt: r.created_at,
        blocked: !!(v.alsoBlock && reportedUserId),
        message: 'Thanks — our safety team reviews every report. You can track it in Safety → My reports.',
      });
    });
  },

  'GET /v1/me/reports': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const rows = await db.many(
      `SELECT r.id, r.reason_code, r.status, r.created_at, r.resolved_at, r.reported_user_id, r.activity_id,
              p.display_name AS reported_name, a.title AS activity_title,
              (SELECT ra.action FROM report_actions ra WHERE ra.report_id = r.id ORDER BY ra.created_at DESC LIMIT 1) AS last_action
         FROM reports r LEFT JOIN profiles p ON p.user_id = r.reported_user_id LEFT JOIN activities a ON a.id = r.activity_id
        WHERE r.reporter_user_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [user.id]
    );
    // Outcome is summarised; enforcement details about the other person are not disclosed.
    return {
      items: rows.map((r) => ({
        id: r.id,
        reasonCode: r.reason_code,
        status: r.status,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        target: r.reported_user_id ? { type: 'user', id: r.reported_user_id, name: r.reported_name } : r.activity_id ? { type: 'activity', id: r.activity_id, name: r.activity_title } : { type: 'conversation' },
        outcome: r.status === 'actioned' ? 'action_taken' : r.status === 'dismissed' ? 'no_violation_found' : null,
      })),
      nextCursor: null,
    };
  },

  'POST /v1/blocks': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { userId } = check({ userId: { type: 'string', required: true, format: 'uuid' } }, req.body);
    if (userId === user.id) throw err.badRequest('cannot_block_self');
    await enforce(db, 'block', user.id);
    await db.withTransaction(async (client) => {
      await client.query('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, userId]);
      // Withdraw pending requests between the two people on each other's plans.
      await client.query(
        `UPDATE activity_participants p SET state = 'declined', decided_at = now()
           FROM activities a WHERE a.id = p.activity_id AND p.state IN ('requested','waitlisted')
            AND ((a.host_user_id = $1 AND p.user_id = $2) OR (a.host_user_id = $2 AND p.user_id = $1))`,
        [user.id, userId]
      );
      await audit(client, { actorUserId: user.id, action: 'user.block', targetType: 'user', targetId: userId, ip: req.ip });
    });
    return { blocked: true, userId };
  },

  'DELETE /v1/blocks/{userId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    await db.query('DELETE FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2', [user.id, req.params.userId]);
    await audit(db, { actorUserId: user.id, action: 'user.unblock', targetType: 'user', targetId: req.params.userId, ip: req.ip });
    return { blocked: false, userId: req.params.userId };
  },

  'GET /v1/me/blocks': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const rows = await db.many(
      'SELECT b.blocked_user_id, b.created_at, p.display_name, p.avatar_key FROM user_blocks b LEFT JOIN profiles p ON p.user_id = b.blocked_user_id WHERE b.blocker_user_id = $1 ORDER BY b.created_at DESC',
      [user.id]
    );
    return { items: rows.map((r) => ({ userId: r.blocked_user_id, name: r.display_name, avatarKey: r.avatar_key, blockedAt: r.created_at })), nextCursor: null };
  },

  'POST /v1/trusted-contacts/invitations': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check(
      {
        name: { type: 'string', required: true, min: 1, max: 60 },
        phone: { type: 'string', required: true, max: 20 },
        activityId: { type: 'string', format: 'uuid' },
      },
      req.body
    );
    const phone = normalisePhone(v.phone);
    await enforce(db, 'trusted_share', user.id);
    const contact = await db.one(
      `INSERT INTO trusted_contacts (user_id, name, phone_e164) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, phone_e164) DO UPDATE SET name = EXCLUDED.name, status = CASE WHEN trusted_contacts.status = 'revoked' THEN 'invited' ELSE trusted_contacts.status END
       RETURNING *`,
      [user.id, v.name, phone]
    );
    let shared = null;
    if (v.activityId) {
      const a = await db.one(
        `SELECT a.id, a.title, a.starts_at, a.ends_at, a.venue_name, a.coarse_area, hp.display_name AS host_name
           FROM activities a JOIN profiles hp ON hp.user_id = a.host_user_id
           JOIN activity_participants p ON p.activity_id = a.id AND p.user_id = $2 AND p.state IN ('accepted','checked_in')
          WHERE a.id = $1`,
        [v.activityId, user.id]
      );
      if (!a) throw err.forbidden('not_participant', 'You can share plans you are part of');
      const token = crypto.randomBytes(18).toString('base64url');
      await db.query('INSERT INTO plan_shares (user_id, activity_id, trusted_contact_id, share_token, expires_at) VALUES ($1, $2, $3, $4, $5 + interval \'6 hours\')', [user.id, a.id, contact.id, token, a.ends_at]);
      const where = a.venue_name ? `${a.venue_name}, ${a.coarse_area}` : a.coarse_area;
      await sendSms(phone, `${user.displayName} shared a plan with you via Project IRL: "${a.title}" ${istLabel(a.starts_at)} at ${where} (host: ${a.host_name}). If you are ever worried, call 112.`);
      shared = { activityId: a.id, expiresAt: a.ends_at };
    } else {
      await sendSms(phone, `${user.displayName} added you as a trusted contact on Project IRL. You may receive plan details from them. Reply STOP to opt out.`);
    }
    await audit(db, { actorUserId: user.id, action: 'trusted_contact.invite', targetType: 'trusted_contact', targetId: contact.id, metadata: { sharedActivity: v.activityId || null }, ip: req.ip });
    return created({ id: contact.id, name: contact.name, phone: contact.phone_e164, status: contact.status, shared });
  },

  'GET /v1/trusted-contacts': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const rows = await db.many("SELECT * FROM trusted_contacts WHERE user_id = $1 AND status <> 'revoked' ORDER BY created_at", [user.id]);
    return { items: rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone_e164, status: c.status, createdAt: c.created_at })), nextCursor: null };
  },

  'DELETE /v1/trusted-contacts/{contactId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const r = await db.query("UPDATE trusted_contacts SET status = 'revoked' WHERE id = $1 AND user_id = $2", [req.params.contactId, user.id]);
    if (!r.rowCount) throw err.notFound('contact_not_found');
    await db.query('UPDATE plan_shares SET expires_at = now() WHERE trusted_contact_id = $1 AND expires_at > now()', [req.params.contactId]);
    return { ok: true };
  },

  'GET /v1/safety/case-status': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const [account, against] = await Promise.all([
      db.one('SELECT status, status_reason, status_until FROM app_users WHERE id = $1', [user.id]),
      db.many(
        `SELECT r.id, r.reason_code, r.status, r.created_at, r.resolved_at,
                (SELECT row_to_json(x) FROM (SELECT ra.action, ra.duration_days, ra.created_at FROM report_actions ra WHERE ra.report_id = r.id ORDER BY ra.created_at DESC LIMIT 1) x) AS action,
                (SELECT row_to_json(y) FROM (SELECT ap.id, ap.status, ap.created_at, ap.decided_at FROM appeals ap WHERE ap.report_id = r.id AND ap.user_id = $1) y) AS appeal
           FROM reports r WHERE r.reported_user_id = $1 AND r.status IN ('actioned','appealed')
          ORDER BY r.created_at DESC LIMIT 50`,
        [user.id]
      ),
    ]);
    // Reporter identities are never revealed.
    return {
      account: { status: account.status, reason: account.status_reason, until: account.status_until },
      cases: against.map((c) => ({
        reportId: c.id,
        reasonCode: c.reason_code,
        status: c.status,
        action: c.action ? c.action.action : null,
        durationDays: c.action ? c.action.duration_days : null,
        decidedAt: c.resolved_at,
        appeal: c.appeal ? { id: c.appeal.id, status: c.appeal.status, createdAt: c.appeal.created_at, decidedAt: c.appeal.decided_at } : null,
        appealable: c.status === 'actioned' && !c.appeal,
      })),
    };
  },

  'POST /v1/appeals': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check({ reportId: { type: 'string', required: true, format: 'uuid' }, statement: { type: 'string', required: true, min: 10, max: 2000 } }, req.body);
    const r = await db.one("SELECT id FROM reports WHERE id = $1 AND reported_user_id = $2 AND status = 'actioned'", [v.reportId, user.id]);
    if (!r) throw err.notFound('report_not_appealable');
    const a = await db.withTransaction(async (client, after) => {
      const { rows } = await client.query('INSERT INTO appeals (report_id, user_id, statement) VALUES ($1, $2, $3) RETURNING id, status, created_at', [r.id, user.id, v.statement]);
      await client.query("UPDATE reports SET status = 'appealed' WHERE id = $1", [r.id]);
      await audit(client, { actorUserId: user.id, action: 'appeal.create', targetType: 'report', targetId: r.id, ip: req.ip });
      after(() => enqueue({ type: 'moderation_alert', reportId: r.id, appeal: true }));
      return rows[0];
    });
    return created({ id: a.id, status: a.status, createdAt: a.created_at });
  },
};

exports.handler = createRouter(routes);
