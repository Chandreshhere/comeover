'use strict';
// Conversations & messages. Chat only opens after an approved join (activity
// groups), within circles you belong to, or 1:1 between people who shared an
// accepted plan. Blocks are enforced on every read and write.
const { err, created, header } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser, assertCanAct } = require('../lib/auth');
const { enforce } = require('../lib/rateLimit');
const realtime = require('../lib/realtime');
const jobs = require('../lib/jobs');
const { pageParams, pageOf } = require('../lib/page');
const media = require('../lib/media');
const P = require('../lib/present');
const { REASON_CODES, priorityFor, blockedByMe, blockedEither, isBlockedEither } = require('../services/safety');
const { isInPlanGroup, sharesAcceptedPlan } = require('../services/community');

const models = () => require('../models');

// Membership + conversation, hiding direct chats with blocked people. 404 otherwise.
async function loadConversation(userId, conversationId, { session } = {}) {
  const { Conversation, ConversationMember } = models();
  const id = String(conversationId);
  const cmq = ConversationMember.findOne({ conversationId: id, userId, leftAt: null });
  const cq = Conversation.findById(id);
  if (session) {
    cmq.session(session);
    cq.session(session);
  }
  const [cm, c] = await Promise.all([cmq.lean(), cq.lean()]);
  if (!cm || !c) throw err.notFound('conversation_not_found');
  if (c.kind === 'direct') {
    const others = await ConversationMember.find({ conversationId: id, userId: { $ne: userId } }).select('userId').lean();
    for (const o of others) if (await isBlockedEither(userId, o.userId, { session })) throw err.notFound('conversation_not_found');
  }
  return { c, cm };
}

// Presents a batch of { c, cm } for one viewer → Conversation[] (same order).
async function describe(userId, rows, { mine } = {}) {
  if (!rows.length) return [];
  const { ConversationMember, Activity, Circle, User, Message } = models();
  const ids = rows.map((r) => r.c._id);
  const blocked = mine || (await blockedByMe(userId));
  const members = await ConversationMember.find({ conversationId: { $in: ids }, leftAt: null }).select('conversationId userId').lean();
  const membersOf = new Map();
  for (const m of members) {
    if (!membersOf.has(m.conversationId)) membersOf.set(m.conversationId, []);
    membersOf.get(m.conversationId).push(m.userId);
  }
  const actIds = rows.map((r) => r.c.activityId).filter(Boolean);
  const circleIds = rows.map((r) => r.c.circleId).filter(Boolean);
  const directOthers = rows.filter((r) => r.c.kind === 'direct').map((r) => (membersOf.get(r.c._id) || []).find((u) => u !== userId)).filter(Boolean);
  // A direct chat's other member may have left (hidden); fall back to any member row.
  const allDirect = rows.filter((r) => r.c.kind === 'direct').map((r) => r.c._id);
  const anyMembers = allDirect.length ? await ConversationMember.find({ conversationId: { $in: allDirect }, userId: { $ne: userId } }).select('conversationId userId').lean() : [];
  const otherOf = new Map(anyMembers.map((m) => [m.conversationId, m.userId]));
  const [acts, circles, people] = await Promise.all([
    actIds.length ? Activity.find({ _id: { $in: actIds } }).select('title').lean() : [],
    circleIds.length ? Circle.find({ _id: { $in: circleIds } }).select('name').lean() : [],
    User.find({ _id: { $in: [...new Set([...directOthers, ...otherOf.values()])] } })
      .select('profile.displayName')
      .lean(),
  ]);
  const titleOfAct = new Map(acts.map((a) => [a._id, a.title]));
  const nameOfCircle = new Map(circles.map((c) => [c._id, c.name]));
  const nameOfUser = new Map(people.map((u) => [u._id, u.profile ? u.profile.displayName : null]));
  const blockedList = [...blocked];

  return Promise.all(
    rows.map(async ({ c, cm }) => {
      const since = cm.lastReadAt || cm.joinedAt || new Date(0);
      const unread = await Message.countDocuments({
        conversationId: c._id,
        deletedAt: null,
        createdAt: { $gt: since },
        senderUserId: { $nin: [userId, ...blockedList] },
      });
      let last = c.lastMessage;
      if (last && last.senderId && blocked.has(last.senderId)) {
        const m = await Message.findOne({ conversationId: c._id, deletedAt: null, senderUserId: { $nin: blockedList } }).sort({ createdAt: -1 }).lean();
        last = m ? { id: m._id, senderId: m.senderUserId, kind: m.kind, body: m.body, createdAt: m.createdAt } : null;
      }
      const title = c.kind === 'activity_group' ? titleOfAct.get(c.activityId) : c.kind === 'circle' ? nameOfCircle.get(c.circleId) : nameOfUser.get(otherOf.get(c._id)) || null;
      return P.conversation({ ...c, lastMessage: last }, { title: title || null, memberIds: membersOf.get(c._id) || [], muted: cm.muted, unread });
    })
  );
}

const sortAt = (c) => new Date(c.lastMessageAt || c.createdAt).getTime();

const routes = {
  'GET /v1/conversations': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { ConversationMember, Conversation } = models();
    const page = pageParams(req.query, { def: 30, max: 100 });
    const cms = await ConversationMember.find({ userId: user.id, leftAt: null }).sort({ lastMessageAt: -1 }).limit(1000).lean();
    const convs = cms.length ? await Conversation.find({ _id: { $in: cms.map((m) => m.conversationId) } }).lean() : [];
    const byId = new Map(convs.map((c) => [c._id, c]));
    const either = await blockedEither(user.id);
    const directIds = convs.filter((c) => c.kind === 'direct').map((c) => c._id);
    const directMembers = directIds.length ? await ConversationMember.find({ conversationId: { $in: directIds }, userId: { $ne: user.id } }).select('conversationId userId').lean() : [];
    const blockedDirect = new Set(directMembers.filter((m) => either.has(m.userId)).map((m) => m.conversationId));
    const rows = cms
      .map((cm) => ({ cm, c: byId.get(cm.conversationId) }))
      .filter(({ c, cm }) => c && !blockedDirect.has(c._id) && (!cm.hiddenAt || (c.lastMessageAt && new Date(c.lastMessageAt) > new Date(cm.hiddenAt))))
      .sort((a, b) => sortAt(b.c) - sortAt(a.c));
    const slice = rows.slice(page.offset, page.offset + page.fetchLimit);
    const items = await describe(user.id, slice.slice(0, page.limit));
    return pageOf(slice, page, (_, i) => items[i]);
  },

  'POST /v1/conversations': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'message');
    const v = check(
      {
        kind: { type: 'string', required: true, enum: ['direct', 'circle'] },
        userId: { type: 'string', format: 'uuid' },
        circleId: { type: 'string', format: 'uuid' },
      },
      req.body
    );
    const { Conversation, ConversationMember, CircleMember } = models();
    let id;
    if (v.kind === 'direct') {
      if (!v.userId || v.userId === user.id) throw err.badRequest('user_required');
      if (await isBlockedEither(user.id, v.userId)) throw err.forbidden('blocked');
      // Direct chat only between people who shared an accepted plan.
      if (!(await sharesAcceptedPlan(user.id, v.userId))) throw err.forbidden('chat_not_available', 'You can message people after you share an accepted plan.');
      const directKey = [user.id, v.userId].sort().join(':');
      id = await db.withTransaction(async (session) => {
        let c = await Conversation.findOne({ directKey }).session(session).lean();
        if (!c) [c] = await Conversation.create([{ kind: 'direct', directKey }], { session });
        const now = new Date();
        await ConversationMember.updateOne(
          { conversationId: c._id, userId: user.id },
          { $set: { hiddenAt: null, leftAt: null }, $setOnInsert: { conversationId: c._id, userId: user.id, joinedAt: now, lastMessageAt: c.lastMessageAt || null } },
          { upsert: true, session }
        );
        await ConversationMember.updateOne(
          { conversationId: c._id, userId: v.userId },
          { $setOnInsert: { conversationId: c._id, userId: v.userId, joinedAt: now, lastMessageAt: c.lastMessageAt || null } },
          { upsert: true, session }
        );
        return c._id;
      });
    } else {
      if (!v.circleId) throw err.badRequest('circle_required');
      if (!(await CircleMember.exists({ circleId: v.circleId, userId: user.id }))) throw err.forbidden('not_circle_member');
      id = await db.withTransaction(async (session) => {
        let c = await Conversation.findOne({ kind: 'circle', circleId: v.circleId }).session(session).lean();
        if (!c) [c] = await Conversation.create([{ kind: 'circle', circleId: v.circleId }], { session });
        await ConversationMember.updateOne(
          { conversationId: c._id, userId: user.id },
          { $set: { leftAt: null, hiddenAt: null }, $setOnInsert: { conversationId: c._id, userId: user.id, joinedAt: new Date(), lastMessageAt: c.lastMessageAt || null } },
          { upsert: true, session }
        );
        return c._id;
      });
    }
    const row = await loadConversation(user.id, id);
    const [conv] = await describe(user.id, [row]);
    return created(conv);
  },

  'DELETE /v1/conversations/{conversationId}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { ConversationMember } = models();
    const { c } = await loadConversation(user.id, req.params.conversationId);
    const now = new Date();
    // Circles: leave the chat. Direct/activity chats: hide for me until a new message arrives.
    if (c.kind === 'circle') await ConversationMember.updateOne({ conversationId: c._id, userId: user.id }, { $set: { leftAt: now } });
    else await ConversationMember.updateOne({ conversationId: c._id, userId: user.id }, { $set: { hiddenAt: now, lastReadAt: now } });
    return { ok: true };
  },

  'POST /v1/conversations/{conversationId}/mute': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { muted } = check({ muted: { type: 'boolean', required: true } }, req.body);
    const { ConversationMember } = models();
    const r = await ConversationMember.updateOne({ conversationId: String(req.params.conversationId), userId: user.id, leftAt: null }, { $set: { muted } });
    if (!r.matchedCount) throw err.notFound('conversation_not_found');
    return { muted };
  },

  'POST /v1/conversations/{conversationId}/read': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { ConversationMember } = models();
    const r = await ConversationMember.updateOne({ conversationId: String(req.params.conversationId), userId: user.id, leftAt: null }, { $set: { lastReadAt: new Date() } });
    if (!r.matchedCount) throw err.notFound('conversation_not_found');
    return { ok: true };
  },

  // Newest page first; items within a page are oldest → newest. nextCursor loads older.
  'GET /v1/conversations/{conversationId}/messages': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Message } = models();
    const { c } = await loadConversation(user.id, req.params.conversationId);
    const page = pageParams(req.query, { def: 40, max: 100 });
    const blocked = [...(await blockedByMe(user.id))];
    const rows = await Message.find({ conversationId: c._id, ...(blocked.length ? { senderUserId: { $nin: blocked } } : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .skip(page.offset)
      .limit(page.fetchLimit)
      .lean();
    const res = await pageOf(rows, page, P.message);
    res.items.reverse();
    return res;
  },

  'POST /v1/conversations/{conversationId}/messages': async (req) => {
    const user = await requireUser(req);
    assertCanAct(user, 'message');
    const v = check({ body: { type: 'string', max: 2000 }, mediaKey: { type: 'string', max: 200 } }, req.body);
    if (!v.body && !v.mediaKey) throw err.badRequest('empty_message');
    if (v.mediaKey && !media.isOwnedKey(v.mediaKey, 'chat', user.id)) throw err.badRequest('invalid_media_key');
    const { Message, Conversation, ConversationMember, Activity, Circle, Block } = models();
    const { c } = await loadConversation(user.id, req.params.conversationId);
    if (c.kind === 'activity_group') {
      const a = await Activity.findById(c.activityId).select('status').lean();
      if (!a || a.status === 'moderated' || !(await isInPlanGroup(c.activityId, user.id))) throw err.forbidden('chat_closed', 'This chat is only for accepted participants.');
    }
    const rawKey = header(req, 'idempotency-key');
    const clientKey = rawKey && /^[A-Za-z0-9:_\-.]{1,128}$/.test(String(rawKey).trim()) ? String(rawKey).trim() : undefined;
    if (clientKey) {
      // Retried send: return the message already stored for this key.
      const dup = await Message.findOne({ conversationId: c._id, senderUserId: user.id, clientKey }).lean();
      if (dup) return created(P.message(dup));
    }
    await enforce('chat_message', user.id);

    let title = null;
    if (c.kind === 'activity_group') title = ((await Activity.findById(c.activityId).select('title').lean()) || {}).title || null;
    if (c.kind === 'circle') title = ((await Circle.findById(c.circleId).select('name').lean()) || {}).name || null;

    let doc;
    try {
      doc = await db.withTransaction(async (session, after) => {
        const now = new Date();
        const [m] = await Message.create([{ conversationId: c._id, senderUserId: user.id, kind: 'user', body: v.body || null, mediaKey: v.mediaKey || null, ...(clientKey ? { clientKey } : {}) }], { session });
        const last = { id: m._id, senderId: user.id, kind: 'user', body: m.body ? m.body.slice(0, 280) : null, createdAt: m.createdAt };
        await Conversation.updateOne({ _id: c._id }, { $set: { lastMessage: last, lastMessageAt: m.createdAt } }, { session });
        await ConversationMember.updateMany({ conversationId: c._id }, { $set: { lastMessageAt: m.createdAt } }, { session });
        await ConversationMember.updateOne({ conversationId: c._id, userId: user.id }, { $set: { lastReadAt: now } }, { session });
        const others = await ConversationMember.find({ conversationId: c._id, userId: { $ne: user.id }, leftAt: null, muted: false }).select('userId').session(session).lean();
        const blockers = others.length ? await Block.find({ blockerUserId: { $in: others.map((o) => o.userId) }, blockedUserId: user.id }).select('blockerUserId').session(session).lean() : [];
        const skip = new Set(blockers.map((b) => b.blockerUserId));
        const recipients = others.map((o) => o.userId).filter((u) => !skip.has(u));
        const msg = P.message(m);
        after(async () => {
          await realtime.publish(`conversation:${c._id}`, 'message.created', msg);
          if (recipients.length) {
            const screen = c.kind === 'activity_group' ? 'group_chat' : 'chat_thread';
            const name = user.displayName || 'Someone';
            await jobs.enqueue('push', {
              userIds: recipients,
              notification: {
                type: 'message',
                title: c.kind === 'direct' ? name : `${name} · ${title || 'Group'}`,
                body: (v.body || 'Sent a photo').slice(0, 140),
                data: { conversationId: c._id, target: { screen, params: { conversationId: c._id } } },
              },
            });
          }
        });
        return m;
      });
    } catch (e) {
      if (e && e.code === 11000 && clientKey) {
        const dup = await Message.findOne({ conversationId: c._id, senderUserId: user.id, clientKey }).lean();
        if (dup) return created(P.message(dup));
      }
      throw e;
    }
    return created(P.message(doc));
  },

  'POST /v1/messages/{messageId}/report': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const v = check({ reasonCode: { type: 'string', required: true, enum: REASON_CODES }, details: { type: 'string', max: 2000 } }, req.body);
    const { Message, ConversationMember, Conversation, Report } = models();
    const m = await Message.findById(String(req.params.messageId)).select('conversationId senderUserId').lean();
    const member = m && (await ConversationMember.exists({ conversationId: m.conversationId, userId: user.id }));
    if (!m || !member) throw err.notFound('message_not_found');
    if (!m.senderUserId || m.senderUserId === user.id) throw err.badRequest('cannot_report_message');
    await enforce('report', user.id);
    const c = await Conversation.findById(m.conversationId).select('activityId').lean();
    const r = await db.withTransaction(async (session, after) => {
      const [doc] = await Report.create(
        [
          {
            reporterUserId: user.id,
            reportedUserId: m.senderUserId,
            activityId: (c && c.activityId) || null,
            messageId: m._id,
            conversationId: m.conversationId,
            reasonCode: v.reasonCode,
            details: v.details || null,
            priority: priorityFor(v.reasonCode),
          },
        ],
        { session }
      );
      after(() => jobs.enqueue('moderation_alert', { reportId: doc._id }));
      return doc;
    });
    return created({ id: r._id, status: r.status, createdAt: r.createdAt });
  },
};

module.exports = { routes, loadConversation, describe };
