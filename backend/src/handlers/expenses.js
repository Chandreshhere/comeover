'use strict';
// SplitMate: a transparent expense LEDGER. No wallet, no custody, no stored
// balances. Settlement = UPI deep link to the payer's own UPI app; "paid" is
// participant-reported and "confirmed" is payee-acknowledged — never bank-verified.
const { err, created, header } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { withIdempotency } = require('../lib/idempotency');
const { enforce } = require('../lib/rateLimit');
const { notify } = require('../lib/notify');
const { computeShares, upiLink } = require('../lib/split');
const media = require('../lib/media');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const { blockedEither } = require('../services/safety');
const { planGroupMembers, sharesAcceptedPlan, sharesCircle } = require('../services/community');

const models = () => require('../models');
const payeeOf = (e) => e.payeeUserId || e.creatorUserId;

async function loadExpense(expenseId, userId, { session } = {}) {
  const { Expense } = models();
  const q = Expense.findOne({ _id: String(expenseId), $or: [{ creatorUserId: userId }, { 'shares.userId': userId }] });
  if (session) q.session(session);
  const e = await q.lean();
  if (!e) throw err.notFound('expense_not_found');
  return e;
}

// Shares are listed largest first (then by user id), items only for itemised splits.
function present(e) {
  const shares = [...(e.shares || [])].sort((a, b) => b.amountMinor - a.amountMinor || String(a.userId).localeCompare(String(b.userId)));
  return P.expense({ ...e, shares, items: e.splitMethod === 'itemised' ? e.items || [] : [] });
}

// Participants must be people you actually did something with.
async function assertParticipantsAllowed(creatorId, activityId, ids, { session } = {}) {
  if (activityId) {
    const g = await planGroupMembers(activityId, { session });
    if (!g || !g.members.has(creatorId)) throw err.forbidden('not_participant');
    if (ids.some((id) => !g.members.has(id))) throw err.badRequest('participant_not_in_plan', 'Everyone in the split must be part of the plan');
    return;
  }
  for (const id of ids) {
    if (id === creatorId) continue;
    const connected = (await sharesAcceptedPlan(creatorId, id, { session })) || (await sharesCircle(creatorId, id, { session }));
    if (!connected) throw err.badRequest('participant_not_connected', 'You can only split with people from your plans or circles');
  }
  const either = await blockedEither(creatorId, { session });
  if (ids.some((id) => either.has(id))) throw err.badRequest('participant_blocked');
}

// Replace unsettled shares with the computed ones; settled/marked shares keep their state.
function mergeShares(e, computed) {
  const payee = payeeOf(e);
  const existing = new Map((e.shares || []).map((s) => [s.userId, s]));
  const now = new Date();
  const next = computed.map((s) => {
    const old = existing.get(s.userId);
    if (old) return { ...old, amountMinor: s.amountMinor, updatedAt: now };
    return { userId: s.userId, amountMinor: s.amountMinor, state: s.userId === payee ? 'confirmed' : 'unsettled', updatedAt: now };
  });
  const kept = (e.shares || []).filter((s) => s.state !== 'unsettled' && !computed.some((c) => c.userId === s.userId));
  return [...next, ...kept];
}

const ITEM_SPEC = {
  type: 'array',
  max: 100,
  items: {
    type: 'object',
    fields: {
      label: { type: 'string', required: true, max: 80 },
      amountMinor: { type: 'integer', required: true, min: 1, max: 100000000 },
      quantity: { type: 'integer', min: 1, max: 999, default: 1 },
      assigneeIds: { type: 'array', required: true, min: 1, max: 50, items: { type: 'string', format: 'uuid' } },
    },
  },
};

function buildItems(items, participantIds) {
  for (const it of items) if (it.assigneeIds.some((u) => !participantIds.includes(u))) throw err.badRequest('assignee_not_participant');
  return items.map((it) => ({ label: it.label, amountMinor: it.amountMinor, quantity: it.quantity, assignees: it.assigneeIds.map((u) => ({ userId: u, shareRatio: 1 })) }));
}

const itemisedShares = (totalMinor, items, ids) =>
  computeShares('itemised', Number(totalMinor), ids, {
    items: items.map((i) => ({ label: i.label, amountMinor: i.amountMinor, quantity: i.quantity, assignments: i.assignees.map((a) => ({ userId: a.userId })) })),
  });

const routes = {
  'POST /v1/expenses': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        activityId: { type: 'string', format: 'uuid' },
        description: { type: 'string', required: true, min: 1, max: 120 },
        totalMinor: { type: 'integer', required: true, min: 1, max: 100000000 },
        splitMethod: { type: 'string', required: true, enum: ['equal', 'custom', 'itemised', 'percentage'] },
        participantIds: { type: 'array', max: 50, unique: true, items: { type: 'string', format: 'uuid' }, default: () => [] },
        payeeId: { type: 'string', format: 'uuid' },
        payeeUpi: { type: 'string', format: 'vpa' },
        amounts: { type: 'object' },
        percentages: { type: 'object' },
        shares: {
          type: 'array',
          max: 50,
          items: { type: 'object', fields: { userId: { type: 'string', required: true, format: 'uuid' }, amountMinor: { type: 'integer', min: 0 }, percent: { type: 'number', min: 0, max: 100 } } },
        },
        items: ITEM_SPEC,
        receiptKey: { type: 'string', max: 200 },
      },
      req.body
    );
    // `shares` is an alternative to amounts/percentages: [{ userId, amountMinor }] or [{ userId, percent }].
    if (v.shares && v.shares.length) {
      if (v.splitMethod === 'custom') v.amounts = Object.fromEntries(v.shares.map((s) => [s.userId, s.amountMinor || 0]));
      if (v.splitMethod === 'percentage') v.percentages = Object.fromEntries(v.shares.map((s) => [s.userId, s.percent || 0]));
    }
    const ids = [...new Set([user.id, ...v.participantIds, ...(v.shares || []).map((s) => s.userId)])];
    if (ids.length < 2) throw err.badRequest('participants_required', 'Add at least one person to split with');
    const payeeId = v.payeeId || user.id;
    if (!ids.includes(payeeId)) throw err.badRequest('payee_not_participant');
    if (v.receiptKey && !media.isOwnedKey(v.receiptKey, 'bill', user.id)) throw err.badRequest('invalid_receipt_key');
    const idemKey = header(req, 'idempotency-key');
    return withIdempotency(req, user.id, async () => {
      await enforce('expense_create', user.id);
      await assertParticipantsAllowed(user.id, v.activityId, ids);
      const { Expense } = models();
      const id = await db.withTransaction(async (session, after) => {
        const itemised = v.splitMethod === 'itemised' && v.items && v.items.length;
        const items = itemised ? buildItems(v.items, ids) : [];
        const computed = itemised ? itemisedShares(v.totalMinor, items, ids) : computeShares(v.splitMethod, v.totalMinor, ids, { amounts: v.amounts, percentages: v.percentages });
        const base = {
          creatorUserId: user.id,
          activityId: v.activityId || null,
          description: v.description,
          totalMinor: v.totalMinor,
          splitMethod: v.splitMethod,
          payeeUserId: payeeId,
          // Only the payee may attach their own UPI ID (prevents redirecting other people's money).
          payeeUpiVpa: payeeId === user.id ? v.payeeUpi || null : null,
          receiptKey: v.receiptKey || null,
          ...(idemKey ? { idempotencyKey: String(idemKey).slice(0, 128) } : {}),
          items,
        };
        const shares = mergeShares({ ...base, shares: [] }, computed);
        const [e] = await Expense.create([{ ...base, shares }], { session });
        for (const s of shares) {
          if (s.userId === user.id || s.userId === payeeId) continue;
          await notify(session, after, s.userId, {
            type: 'activity',
            title: `${user.displayName || 'Someone'} split "${v.description}"`,
            body: `Your share: ₹${(s.amountMinor / 100).toFixed(2)}`,
            data: { expenseId: e._id, target: { screen: 'split_summary', params: { id: e._id } } },
          });
        }
        return e._id;
      });
      return created(present(await loadExpense(id, user.id)));
    });
  },

  'GET /v1/expenses': async (req) => {
    const user = await requireUser(req);
    const { Expense } = models();
    const page = pageParams(req.query);
    const rows = await Expense.find({ $or: [{ creatorUserId: user.id }, { 'shares.userId': user.id }] })
      .sort({ createdAt: -1, _id: -1 })
      .skip(page.offset)
      .limit(page.fetchLimit)
      .lean();
    return pageOf(rows, page, present);
  },

  'GET /v1/expenses/{expenseId}': async (req) => {
    const user = await requireUser(req);
    return present(await loadExpense(req.params.expenseId, user.id));
  },

  'POST /v1/expenses/{expenseId}/items': async (req) => {
    const user = await requireUser(req);
    const { items } = check({ items: { ...ITEM_SPEC, required: true, min: 1 } }, req.body);
    const { Expense } = models();
    await db.withTransaction(async (session) => {
      const e = await loadExpense(req.params.expenseId, user.id, { session });
      if (e.creatorUserId !== user.id) throw err.forbidden('creator_only');
      const payee = payeeOf(e);
      if ((e.shares || []).some((s) => s.state === 'confirmed' && s.userId !== payee)) throw err.conflict('already_settled', 'Some shares are already settled');
      const participantIds = (e.shares || []).map((s) => s.userId);
      const built = buildItems(items, participantIds);
      const computed = itemisedShares(e.totalMinor, built, participantIds);
      await Expense.updateOne({ _id: e._id }, { $set: { splitMethod: 'itemised', items: built, shares: mergeShares(e, computed) } }, { session });
    });
    return present(await loadExpense(req.params.expenseId, user.id));
  },

  'POST /v1/expenses/{expenseId}/participants': async (req) => {
    const user = await requireUser(req);
    const { userIds } = check({ userIds: { type: 'array', required: true, min: 1, max: 50, unique: true, items: { type: 'string', format: 'uuid' } } }, req.body);
    const { Expense } = models();
    await db.withTransaction(async (session) => {
      const e = await loadExpense(req.params.expenseId, user.id, { session });
      if (e.creatorUserId !== user.id) throw err.forbidden('creator_only');
      if (e.splitMethod !== 'equal') throw err.conflict('resplit_required', 'Add people to equal splits only, or recreate the split');
      const ids = [...new Set([...(e.shares || []).map((s) => s.userId), ...userIds])];
      await assertParticipantsAllowed(user.id, e.activityId, ids, { session });
      await Expense.updateOne({ _id: e._id }, { $set: { shares: mergeShares(e, computeShares('equal', Number(e.totalMinor), ids)) } }, { session });
    });
    return present(await loadExpense(req.params.expenseId, user.id));
  },

  'GET /v1/expenses/{expenseId}/summary': async (req) => {
    const user = await requireUser(req);
    const { User } = models();
    const e = await loadExpense(req.params.expenseId, user.id);
    const payeeId = payeeOf(e);
    const shares = [...(e.shares || [])].sort((a, b) => b.amountMinor - a.amountMinor);
    const people = await User.find({ _id: { $in: [...new Set([...shares.map((s) => s.userId), payeeId])] } }).select('profile.displayName').lean();
    const nameOf = new Map(people.map((u) => [u._id, u.profile ? u.profile.displayName : null]));
    const settled = shares.filter((s) => s.state === 'confirmed').reduce((n, s) => n + Number(s.amountMinor), 0);
    return {
      expense: present(e),
      payee: { userId: payeeId, name: nameOf.get(payeeId) || null, upi: e.payeeUpiVpa || null },
      totals: { totalMinor: Number(e.totalMinor), confirmedMinor: settled, outstandingMinor: Number(e.totalMinor) - settled },
      perPerson: shares.map((s) => ({
        userId: s.userId,
        name: nameOf.get(s.userId) || null,
        amountMinor: Number(s.amountMinor),
        state: s.state,
        owesPayee: s.userId !== payeeId && s.state !== 'confirmed',
        upiLink:
          s.userId === user.id && s.userId !== payeeId ? upiLink({ vpa: e.payeeUpiVpa, payeeName: nameOf.get(payeeId), amountMinor: Number(s.amountMinor), note: e.description }) : null,
      })),
      disclaimer: 'Payments happen in your UPI app. SplitMate only records who says they paid.',
    };
  },

  'POST /v1/expenses/{expenseId}/settlement-intent': async (req) => {
    const user = await requireUser(req);
    const { Expense, User } = models();
    const e = await loadExpense(req.params.expenseId, user.id);
    const payeeId = payeeOf(e);
    if (payeeId === user.id) throw err.badRequest('you_are_payee');
    const s = (e.shares || []).find((x) => x.userId === user.id);
    if (!s) throw err.forbidden('no_share');
    if (s.state === 'confirmed') throw err.conflict('already_confirmed');
    const payee = await User.findById(payeeId).select('profile.displayName').lean();
    const payeeName = payee && payee.profile ? payee.profile.displayName : null;
    const now = new Date();
    await Expense.updateOne({ _id: e._id, 'shares.userId': user.id }, { $set: { 'shares.$.settlementIntentAt': now, 'shares.$.updatedAt': now } });
    const link = upiLink({ vpa: e.payeeUpiVpa, payeeName, amountMinor: Number(s.amountMinor), note: e.description });
    return {
      amountMinor: Number(s.amountMinor),
      payeeId,
      payeeName,
      upiLink: link,
      hasUpi: !!link,
      note: link ? 'Opens your UPI app. Come back and mark it paid.' : 'The payee has not added a UPI ID — settle in person or ask them for it.',
    };
  },

  'POST /v1/expenses/{expenseId}/settlement-confirmation': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        action: { type: 'string', required: true, enum: ['mark_paid', 'confirm', 'dispute'] },
        userId: { type: 'string', format: 'uuid' },
        paymentReference: { type: 'string', max: 64 },
      },
      req.body
    );
    const state = { mark_paid: 'marked_paid', confirm: 'confirmed', dispute: 'disputed' }[v.action];
    return routes['PATCH /v1/expenses/{expenseId}/shares/{userId}']({
      ...req,
      user,
      params: { expenseId: req.params.expenseId, userId: v.userId || user.id },
      body: { state, ...(v.paymentReference ? { paymentReference: v.paymentReference } : {}) },
    });
  },

  // Rules: share owner → marked_paid | unsettled | disputed; payee → confirmed | disputed. Either party may dispute.
  'PATCH /v1/expenses/{expenseId}/shares/{userId}': async (req) => {
    const user = await requireUser(req);
    const v = check({ state: { type: 'string', required: true, enum: ['unsettled', 'marked_paid', 'confirmed', 'disputed'] }, paymentReference: { type: 'string', max: 64 } }, req.body);
    const { Expense } = models();
    const shareUserId = String(req.params.userId);
    await db.withTransaction(async (session, after) => {
      const e = await loadExpense(req.params.expenseId, user.id, { session });
      const payeeId = payeeOf(e);
      const s = (e.shares || []).find((x) => x.userId === shareUserId);
      if (!s) throw err.notFound('share_not_found');
      const isOwner = s.userId === user.id;
      const isPayee = payeeId === user.id;
      const allowed = (v.state === 'disputed' && (isOwner || isPayee)) || (isOwner && ['marked_paid', 'unsettled'].includes(v.state)) || (isPayee && v.state === 'confirmed');
      if (!allowed) throw err.forbidden('forbidden', v.state === 'confirmed' ? 'Only the payee can confirm a payment' : 'You can only update your own share');
      const now = new Date();
      const set = { 'shares.$.state': v.state, 'shares.$.updatedAt': now };
      if (v.paymentReference) set['shares.$.paymentReference'] = v.paymentReference;
      if (v.state === 'confirmed') {
        set['shares.$.confirmedBy'] = user.id;
        set['shares.$.confirmedAt'] = now;
      }
      await Expense.updateOne({ _id: e._id, 'shares.userId': s.userId }, { $set: set }, { session });
      const other = isOwner ? payeeId : s.userId;
      if (other !== user.id) {
        const name = user.displayName || 'Someone';
        const titles = { marked_paid: `${name} marked their share as paid`, confirmed: `${name} confirmed your payment`, disputed: `${name} flagged a payment`, unsettled: `${name} reopened a share` };
        await notify(session, after, other, { type: 'activity', title: titles[v.state], body: e.description, data: { expenseId: e._id, target: { screen: 'split_settlement', params: { id: e._id } } } });
      }
    });
    return present(await loadExpense(req.params.expenseId, user.id));
  },
};

module.exports = { routes, assertParticipantsAllowed, mergeShares };
