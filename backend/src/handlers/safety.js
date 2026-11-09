'use strict';
// Reports, blocks, trusted contacts / plan sharing, case status and appeals.
// Never paywalled; available to limited and suspended accounts.
const crypto = require('crypto');
const { err, created } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const jobs = require('../lib/jobs');
const { withIdempotency } = require('../lib/idempotency');
const media = require('../lib/media');
const { normalizePhone } = require('../lib/phone');
const { sendSms } = require('../lib/sms');
const { REASON_CODES, priorityFor } = require('../services/safety');

function istLabel(ts) {
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const PENDING = ['requested', 'waitlisted'];

// Decline pending requests between two people on each other's plans (keeps waitlistCount in step).
async function withdrawPendingBetween(a, b, session) {
  const { Activity, Participant } = require('../models');
  const [hostedByA, hostedByB] = await Promise.all([
    Activity.distinct('_id', { hostUserId: a }).session(session),
    Activity.distinct('_id', { hostUserId: b }).session(session),
  ]);
  const filter = {
    state: { $in: PENDING },
    $or: [
      { userId: b, activityId: { $in: hostedByA } },
      { userId: a, activityId: { $in: hostedByB } },
    ],
  };
  const pending = await Participant.find(filter).select('activityId state').session(session).lean();
  if (!pending.length) return 0;
  await Participant.updateMany({ _id: { $in: pending.map((p) => p._id) } }, { $set: { state: 'declined', decidedAt: new Date() } }, { session });
  for (const p of pending.filter((x) => x.state === 'waitlisted')) {
    await Activity.updateOne({ _id: p.activityId, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
  }
  return pending.length;
}

async function upsertBlock(blocker, blocked, session) {
  const { Block } = require('../models');
  await Block.updateOne({ blockerUserId: blocker, blockedUserId: blocked }, { $setOnInsert: { blockerUserId: blocker, blockedUserId: blocked, createdAt: new Date() } }, { upsert: true, session });
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
    const { Message, ConversationMember, Conversation, Report } = require('../models');
    let reportedUserId = v.userId || v.reportedUserId || null;
    let conversationId = v.conversationId || null;
    let activityId = v.activityId || null;
    if (v.messageId) {
      // Message reports: only members of that conversation; the sender becomes the reported user.
      const m = await Message.findById(v.messageId).select('senderUserId conversationId').lean();
      const member = m && (await ConversationMember.exists({ conversationId: m.conversationId, userId: user.id }));
      if (!m || !member) throw err.notFound('message_not_found');
      const c = await Conversation.findById(m.conversationId).select('activityId').lean();
      reportedUserId = reportedUserId || m.senderUserId || null;
      conversationId = conversationId || m.conversationId;
      activityId = activityId || (c && c.activityId) || null;
    }
    if (!reportedUserId && !activityId && !conversationId && !v.circleId) throw err.badRequest('target_required', 'Tell us who or what you are reporting');
    if (reportedUserId === user.id) throw err.badRequest('cannot_report_self');
    if (v.evidenceKeys.some((k) => !media.isOwnedKey(k, 'evidence', user.id))) throw err.badRequest('invalid_evidence_key');
    return withIdempotency(req, user.id, async () => {
      await enforce('report', user.id);
      const r = await db.withTransaction(async (session, after) => {
        const [doc] = await Report.create(
          [
            {
              reporterUserId: user.id,
              reportedUserId,
              activityId,
              messageId: v.messageId || null,
              conversationId,
              circleId: v.circleId || null,
              reasonCode: v.reasonCode,
              details: v.details || null,
              evidenceNote: v.evidenceNote || null,
              evidenceKeys: v.evidenceKeys,
              priority: priorityFor(v.reasonCode),
            },
          ],
          { session }
        );
        if (v.alsoBlock && reportedUserId) {
          await upsertBlock(user.id, reportedUserId, session);
          await withdrawPendingBetween(user.id, reportedUserId, session);
          await audit({ actorUserId: user.id, action: 'user.block', targetType: 'user', targetId: reportedUserId, metadata: { viaReport: doc._id }, ip: req.ip }, { session });
        }
        await audit({ actorUserId: user.id, action: 'report.create', targetType: 'report', targetId: doc._id, metadata: { reasonCode: v.reasonCode }, ip: req.ip }, { session });
        after(() => jobs.enqueue('moderation_alert', { reportId: doc._id }));
        return doc;
      });
      return created({
        id: r._id,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt,
        blocked: !!(v.alsoBlock && reportedUserId),
        message: 'Thanks — our safety team reviews every report. You can track it in Safety → My reports.',
      });
    });
  },

  'GET /v1/me/reports': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Report, User, Activity } = require('../models');
    const rows = await Report.find({ reporterUserId: user.id }).sort({ createdAt: -1 }).limit(100).lean();
    const userIds = [...new Set(rows.map((r) => r.reportedUserId).filter(Boolean))];
    const actIds = [...new Set(rows.map((r) => r.activityId).filter(Boolean))];
    const [users, acts] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('profile.displayName').lean() : [],
      actIds.length ? Activity.find({ _id: { $in: actIds } }).select('title').lean() : [],
    ]);
    const nameOf = new Map(users.map((u) => [u._id, u.profile ? u.profile.displayName : null]));
    const titleOf = new Map(acts.map((a) => [a._id, a.title]));
    // Outcome is summarised; enforcement details about the other person are not disclosed.
    return {
      items: rows.map((r) => ({
        id: r._id,
        reasonCode: r.reasonCode,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        target: r.reportedUserId
          ? { type: 'user', id: r.reportedUserId, name: nameOf.get(r.reportedUserId) || null }
          : r.activityId
            ? { type: 'activity', id: r.activityId, name: titleOf.get(r.activityId) || null }
            : r.circleId
              ? { type: 'circle', id: r.circleId, name: null }
              : { type: 'conversation' },
        outcome: r.status === 'actioned' ? 'action_taken' : r.status === 'dismissed' ? 'no_violation_found' : null,
      })),
      nextCursor: null,
    };
  },

  'POST /v1/blocks': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { userId } = check({ userId: { type: 'string', required: true, format: 'uuid' } }, req.body);
    if (userId === user.id) throw err.badRequest('cannot_block_self');
    await enforce('block', user.id);
    await db.withTransaction(async (session) => {
      await upsertBlock(user.id, userId, session);
      // Withdraw pending requests between the two people on each other's plans.
      await withdrawPendingBetween(user.id, userId, session);
      await audit({ actorUserId: user.id, action: 'user.block', targetType: 'user', targetId: userId, ip: req.ip }, { session });
    });
    return { blocked: true, userId };
  },

  'DELETE /v1/blocks/{userId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Block } = require('../models');
    const target = String(req.params.userId);
    await Block.deleteOne({ blockerUserId: user.id, blockedUserId: target });
    await audit({ actorUserId: user.id, action: 'user.unblock', targetType: 'user', targetId: target, ip: req.ip });
    return { blocked: false, userId: target };
  },

  'GET /v1/me/blocks': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Block, User } = require('../models');
    const rows = await Block.find({ blockerUserId: user.id }).sort({ createdAt: -1 }).lean();
    const users = rows.length ? await User.find({ _id: { $in: rows.map((r) => r.blockedUserId) } }).select('profile.displayName profile.avatarKey').lean() : [];
    const byId = new Map(users.map((u) => [u._id, u.profile || {}]));
    return {
      items: rows.map((r) => {
        const p = byId.get(r.blockedUserId) || {};
        return { userId: r.blockedUserId, name: p.displayName || null, avatarKey: p.avatarKey || null, blockedAt: r.createdAt };
      }),
      nextCursor: null,
    };
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
    const phone = normalizePhone(v.phone);
    await enforce('trusted_share', user.id);
    const { TrustedContact, Activity, Participant, User, PlanShare } = require('../models');
    let contact = await TrustedContact.findOneAndUpdate(
      { userId: user.id, phone },
      { $set: { name: v.name }, $setOnInsert: { userId: user.id, phone, status: 'invited' } },
      { upsert: true, new: true }
    ).lean();
    if (contact.status === 'revoked') {
      contact = await TrustedContact.findOneAndUpdate({ _id: contact._id }, { $set: { status: 'invited' } }, { new: true }).lean();
    }
    let shared = null;
    let sms;
    const who = user.displayName || 'Someone';
    if (v.activityId) {
      const a = await Activity.findById(v.activityId).select('title startsAt endsAt venueName coarseArea hostUserId').lean();
      const isHost = a && a.hostUserId === user.id;
      const inGroup = a && (isHost || (await Participant.exists({ activityId: a._id, userId: user.id, state: { $in: ['accepted', 'checked_in'] } })));
      if (!a || !inGroup) throw err.forbidden('not_participant', 'You can share plans you are part of');
      const host = await User.findById(a.hostUserId).select('profile.displayName').lean();
      const hostName = (host && host.profile && host.profile.displayName) || 'the host';
      const token = crypto.randomBytes(18).toString('base64url');
      const expiresAt = new Date(new Date(a.endsAt).getTime() + 6 * 3600000);
      await PlanShare.create({ userId: user.id, activityId: a._id, trustedContactId: contact._id, shareToken: token, expiresAt });
      const where = a.venueName ? `${a.venueName}, ${a.coarseArea || ''}`.replace(/, $/, '') : a.coarseArea || 'a public place';
      sms = await sendSms(phone, `${who} shared a plan with you via Come Over: "${a.title}" ${istLabel(a.startsAt)} at ${where} (host: ${hostName}). If you are ever worried, call 112.`, { templateKey: 'plan_share' });
      shared = { activityId: a._id, expiresAt: a.endsAt };
    } else {
      sms = await sendSms(phone, `${who} added you as a trusted contact on Come Over. You may receive plan details from them. Reply STOP to opt out.`, { templateKey: 'trusted_invite' });
    }
    await audit({ actorUserId: user.id, action: 'trusted_contact.invite', targetType: 'trusted_contact', targetId: contact._id, metadata: { sharedActivity: v.activityId || null, smsSent: !!sms.sent }, ip: req.ip });
    return created({ id: contact._id, name: contact.name, phone: contact.phone, status: contact.status, createdAt: contact.createdAt, shared, smsSent: !!sms.sent });
  },

  'GET /v1/trusted-contacts': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { TrustedContact } = require('../models');
    const rows = await TrustedContact.find({ userId: user.id, status: { $ne: 'revoked' } }).sort({ createdAt: 1 }).lean();
    return { items: rows.map((c) => ({ id: c._id, name: c.name, phone: c.phone, status: c.status, createdAt: c.createdAt })), nextCursor: null };
  },

  'DELETE /v1/trusted-contacts/{contactId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { TrustedContact, PlanShare } = require('../models');
    const id = String(req.params.contactId);
    const r = await TrustedContact.updateOne({ _id: id, userId: user.id }, { $set: { status: 'revoked' } });
    if (!r.matchedCount) throw err.notFound('contact_not_found');
    const now = new Date();
    await PlanShare.updateMany({ trustedContactId: id, expiresAt: { $gt: now } }, { $set: { expiresAt: now } });
    return { ok: true };
  },

  'GET /v1/safety/case-status': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { User, Report, ReportAction, Appeal } = require('../models');
    const [account, against] = await Promise.all([
      User.findById(user.id).select('status statusReason statusUntil').lean(),
      Report.find({ reportedUserId: user.id, status: { $in: ['actioned', 'appealed'] } }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    const ids = against.map((r) => r._id);
    const [actions, appeals] = await Promise.all([
      ids.length ? ReportAction.find({ reportId: { $in: ids } }).sort({ createdAt: -1 }).lean() : [],
      ids.length ? Appeal.find({ reportId: { $in: ids }, userId: user.id }).lean() : [],
    ]);
    const lastAction = new Map();
    for (const a of actions) if (!lastAction.has(a.reportId)) lastAction.set(a.reportId, a);
    const appealOf = new Map(appeals.map((a) => [a.reportId, a]));
    // Reporter identities are never revealed.
    return {
      account: { status: account.status, reason: account.statusReason || null, until: account.statusUntil || null },
      cases: against.map((c) => {
        const act = lastAction.get(c._id);
        const ap = appealOf.get(c._id);
        return {
          reportId: c._id,
          reasonCode: c.reasonCode,
          status: c.status,
          action: act ? act.action : null,
          durationDays: act ? act.durationDays : null,
          decidedAt: c.resolvedAt,
          appeal: ap ? { id: ap._id, status: ap.status, createdAt: ap.createdAt, decidedAt: ap.decidedAt } : null,
          appealable: c.status === 'actioned' && !ap,
        };
      }),
    };
  },

  'POST /v1/appeals': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check({ reportId: { type: 'string', required: true, format: 'uuid' }, statement: { type: 'string', required: true, min: 10, max: 2000 } }, req.body);
    const { Report, Appeal } = require('../models');
    const r = await Report.findOne({ _id: v.reportId, reportedUserId: user.id, status: 'actioned' }).select('_id').lean();
    if (!r) throw err.notFound('report_not_appealable');
    const a = await db.withTransaction(async (session, after) => {
      const [doc] = await Appeal.create([{ reportId: r._id, userId: user.id, statement: v.statement }], { session });
      await Report.updateOne({ _id: r._id }, { $set: { status: 'appealed' } }, { session });
      await audit({ actorUserId: user.id, action: 'appeal.create', targetType: 'report', targetId: r._id, ip: req.ip }, { session });
      after(() => jobs.enqueue('moderation_alert', { reportId: r._id, appeal: true }));
      return doc;
    });
    return created({ id: a._id, status: a.status, createdAt: a.createdAt });
  },
};

module.exports = { routes, withdrawPendingBetween };
