'use strict';
// SplitMate: a transparent expense LEDGER. No wallet, no custody, no stored
// balances. Settlement = UPI deep link to the payer's own UPI app; "paid" is
// participant-reported and "confirmed" is payee-acknowledged — never bank-verified.
const { createRouter, err, created } = require('../lib/http');
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

async function loadExpense(q, expenseId, userId) {
  const { rows } = await q.query(
    `SELECT e.* FROM expenses e WHERE e.id = $1 AND (e.creator_user_id = $2 OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.user_id = $2))`,
    [expenseId, userId]
  );
  if (!rows[0]) throw err.notFound('expense_not_found');
  return rows[0];
}

async function sharesOf(q, expenseId) {
  return (await q.query('SELECT * FROM expense_shares WHERE expense_id = $1 ORDER BY amount_minor DESC, user_id', [expenseId])).rows;
}

async function itemsOf(q, expenseId) {
  return (
    await q.query(
      `SELECT i.*, COALESCE((SELECT array_agg(a.user_id::text) FROM item_assignments a WHERE a.item_id = i.id), '{}') AS assignees
         FROM expense_items i WHERE i.expense_id = $1 ORDER BY i.created_at`,
      [expenseId]
    )
  ).rows;
}

async function full(q, expenseId, userId) {
  const e = await loadExpense(q, expenseId, userId);
  const [shares, items] = await Promise.all([sharesOf(q, expenseId), itemsOf(q, expenseId)]);
  return P.expense(e, shares, e.split_method === 'itemised' ? items : undefined);
}

// Participants must be people you actually did something with.
async function assertParticipantsAllowed(q, creatorId, activityId, ids) {
  if (activityId) {
    const { rows } = await q.query("SELECT user_id::text FROM activity_participants WHERE activity_id = $1 AND state IN ('accepted','checked_in','completed')", [activityId]);
    const group = new Set(rows.map((r) => r.user_id));
    if (!group.has(creatorId)) throw err.forbidden('not_participant');
    const outsider = ids.find((id) => !group.has(id));
    if (outsider) throw err.badRequest('participant_not_in_plan', 'Everyone in the split must be part of the plan');
    return;
  }
  for (const id of ids) {
    if (id === creatorId) continue;
    const { rowCount } = await q.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM activity_participants a JOIN activity_participants b ON a.activity_id = b.activity_id
                               WHERE a.user_id = $1 AND b.user_id = $2 AND a.state IN ('accepted','checked_in','completed') AND b.state IN ('accepted','checked_in','completed'))
                 OR EXISTS (SELECT 1 FROM circle_members a JOIN circle_members b ON a.circle_id = b.circle_id WHERE a.user_id = $1 AND b.user_id = $2)`,
      [creatorId, id]
    );
    if (!rowCount) throw err.badRequest('participant_not_connected', 'You can only split with people from your plans or circles');
  }
  const { rowCount: blocked } = await q.query('SELECT 1 FROM user_blocks WHERE (blocker_user_id = $1 AND blocked_user_id = ANY($2)) OR (blocked_user_id = $1 AND blocker_user_id = ANY($2))', [creatorId, ids]);
  if (blocked) throw err.badRequest('participant_blocked');
}

async function writeShares(client, expense, shares) {
  await client.query('DELETE FROM expense_shares WHERE expense_id = $1 AND state = $2', [expense.id, 'unsettled']);
  const payee = expense.payee_user_id || expense.creator_user_id;
  for (const s of shares) {
    await client.query(
      `INSERT INTO expense_shares (expense_id, user_id, amount_minor, state) VALUES ($1, $2, $3, $4)
       ON CONFLICT (expense_id, user_id) DO UPDATE SET amount_minor = EXCLUDED.amount_minor, updated_at = now()`,
      [expense.id, s.userId, s.amountMinor, s.userId === payee ? 'confirmed' : 'unsettled']
    );
  }
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

async function replaceItems(client, expense, items, participantIds) {
  await client.query('DELETE FROM expense_items WHERE expense_id = $1', [expense.id]);
  for (const it of items) {
    if (it.assigneeIds.some((u) => !participantIds.includes(u))) throw err.badRequest('assignee_not_participant');
    const { rows } = await client.query('INSERT INTO expense_items (expense_id, label, amount_minor, quantity) VALUES ($1, $2, $3, $4) RETURNING id', [expense.id, it.label, it.amountMinor, it.quantity]);
    for (const u of it.assigneeIds) await client.query('INSERT INTO item_assignments (item_id, user_id) VALUES ($1, $2)', [rows[0].id, u]);
  }
  return computeShares('itemised', Number(expense.total_minor), participantIds, {
    items: items.map((i) => ({ label: i.label, amountMinor: i.amountMinor, quantity: i.quantity, assignments: i.assigneeIds.map((u) => ({ userId: u })) })),
  });
}

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
    return withIdempotency(db, req, user.id, async () => {
      await enforce(db, 'expense_create', user.id);
      await assertParticipantsAllowed(db, user.id, v.activityId, ids);
      const id = await db.withTransaction(async (client, after) => {
        const { rows } = await client.query(
          `INSERT INTO expenses (creator_user_id, activity_id, description, total_minor, split_method, payee_user_id, payee_upi_vpa, receipt_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          // Only the payee may attach their own UPI ID (prevents redirecting other people's money).
          [user.id, v.activityId || null, v.description, v.totalMinor, v.splitMethod, payeeId, payeeId === user.id ? v.payeeUpi || null : null, v.receiptKey || null]
        );
        const e = rows[0];
        const shares =
          v.splitMethod === 'itemised' && v.items && v.items.length
            ? await replaceItems(client, e, v.items, ids)
            : computeShares(v.splitMethod, v.totalMinor, ids, { amounts: v.amounts, percentages: v.percentages });
        await writeShares(client, e, shares);
        for (const s of shares) {
          if (s.userId === user.id || s.userId === payeeId) continue;
          await notify(client, after, s.userId, { type: 'activity', title: `${user.displayName} split "${v.description}"`, body: `Your share: ₹${(s.amountMinor / 100).toFixed(2)}`, data: { expenseId: e.id, target: { screen: 'split_summary', params: { id: e.id } } } });
        }
        return e.id;
      });
      return created(await full(db, id, user.id));
    });
  },

  'GET /v1/expenses': async (req) => {
    const user = await requireUser(req);
    const page = pageParams(req.query);
    const rows = await db.many(
      `SELECT e.* FROM expenses e
        WHERE e.creator_user_id = $1 OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.user_id = $1)
        ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`,
      [user.id, page.sqlLimit, page.offset]
    );
    const visible = rows.slice(0, page.limit);
    const shares = visible.length ? await db.many('SELECT * FROM expense_shares WHERE expense_id = ANY($1)', [visible.map((e) => e.id)]) : [];
    return { items: visible.map((e) => P.expense(e, shares.filter((s) => s.expense_id === e.id))), nextCursor: pageOf(rows, page).nextCursor };
  },

  'GET /v1/expenses/{expenseId}': async (req) => {
    const user = await requireUser(req);
    return full(db, req.params.expenseId, user.id);
  },

  'POST /v1/expenses/{expenseId}/items': async (req) => {
    const user = await requireUser(req);
    const { items } = check({ items: { ...ITEM_SPEC, required: true, min: 1 } }, req.body);
    await db.withTransaction(async (client) => {
      const e = await loadExpense(client, req.params.expenseId, user.id);
      if (e.creator_user_id !== user.id) throw err.forbidden('creator_only');
      const shares = await sharesOf(client, e.id);
      if (shares.some((s) => s.state === 'confirmed' && s.user_id !== (e.payee_user_id || e.creator_user_id))) throw err.conflict('already_settled', 'Some shares are already settled');
      await client.query("UPDATE expenses SET split_method = 'itemised' WHERE id = $1", [e.id]);
      const computed = await replaceItems(client, e, items, shares.map((s) => s.user_id));
      await writeShares(client, e, computed);
    });
    return full(db, req.params.expenseId, user.id);
  },

  'POST /v1/expenses/{expenseId}/participants': async (req) => {
    const user = await requireUser(req);
    const { userIds } = check({ userIds: { type: 'array', required: true, min: 1, max: 50, unique: true, items: { type: 'string', format: 'uuid' } } }, req.body);
    await db.withTransaction(async (client) => {
      const e = await loadExpense(client, req.params.expenseId, user.id);
      if (e.creator_user_id !== user.id) throw err.forbidden('creator_only');
      if (e.split_method !== 'equal') throw err.conflict('resplit_required', 'Add people to equal splits only, or recreate the split');
      const current = (await sharesOf(client, e.id)).map((s) => s.user_id);
      const ids = [...new Set([...current, ...userIds])];
      await assertParticipantsAllowed(client, user.id, e.activity_id, ids);
      await writeShares(client, e, computeShares('equal', Number(e.total_minor), ids));
    });
    return full(db, req.params.expenseId, user.id);
  },

  'GET /v1/expenses/{expenseId}/summary': async (req) => {
    const user = await requireUser(req);
    const e = await loadExpense(db, req.params.expenseId, user.id);
    const shares = await db.many(
      'SELECT s.*, p.display_name FROM expense_shares s JOIN profiles p ON p.user_id = s.user_id WHERE s.expense_id = $1 ORDER BY s.amount_minor DESC',
      [e.id]
    );
    const payeeId = e.payee_user_id || e.creator_user_id;
    const payee = shares.find((s) => s.user_id === payeeId);
    const settled = shares.filter((s) => s.state === 'confirmed').reduce((n, s) => n + Number(s.amount_minor), 0);
    return {
      expense: P.expense(e, shares),
      payee: { userId: payeeId, name: payee ? payee.display_name : null, upi: e.payee_upi_vpa || null },
      totals: { totalMinor: Number(e.total_minor), confirmedMinor: settled, outstandingMinor: Number(e.total_minor) - settled },
      perPerson: shares.map((s) => ({
        userId: s.user_id,
        name: s.display_name,
        amountMinor: Number(s.amount_minor),
        state: s.state,
        owesPayee: s.user_id !== payeeId && s.state !== 'confirmed',
        upiLink: s.user_id === user.id && s.user_id !== payeeId ? upiLink({ vpa: e.payee_upi_vpa, payeeName: payee && payee.display_name, amountMinor: Number(s.amount_minor), note: e.description }) : null,
      })),
      disclaimer: 'Payments happen in your UPI app. SplitMate only records who says they paid.',
    };
  },

  'POST /v1/expenses/{expenseId}/settlement-intent': async (req) => {
    const user = await requireUser(req);
    const e = await loadExpense(db, req.params.expenseId, user.id);
    const payeeId = e.payee_user_id || e.creator_user_id;
    if (payeeId === user.id) throw err.badRequest('you_are_payee');
    const s = await db.one('SELECT * FROM expense_shares WHERE expense_id = $1 AND user_id = $2', [e.id, user.id]);
    if (!s) throw err.forbidden('no_share');
    if (s.state === 'confirmed') throw err.conflict('already_confirmed');
    const payee = await db.one('SELECT display_name FROM profiles WHERE user_id = $1', [payeeId]);
    await db.query('UPDATE expense_shares SET settlement_intent_at = now(), updated_at = now() WHERE expense_id = $1 AND user_id = $2', [e.id, user.id]);
    const link = upiLink({ vpa: e.payee_upi_vpa, payeeName: payee && payee.display_name, amountMinor: Number(s.amount_minor), note: e.description });
    return { amountMinor: Number(s.amount_minor), payeeId, payeeName: payee && payee.display_name, upiLink: link, hasUpi: !!link, note: link ? 'Opens your UPI app. Come back and mark it paid.' : 'The payee has not added a UPI ID — settle in person or ask them for it.' };
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
    return routes['PATCH /v1/expenses/{expenseId}/shares/{userId}']({ ...req, params: { expenseId: req.params.expenseId, userId: v.userId || user.id }, body: { state, paymentReference: v.paymentReference } });
  },

  // Rules: share owner → marked_paid | unsettled | disputed; payee → confirmed | disputed. Either party may dispute.
  'PATCH /v1/expenses/{expenseId}/shares/{userId}': async (req) => {
    const user = await requireUser(req);
    const v = check({ state: { type: 'string', required: true, enum: ['unsettled', 'marked_paid', 'confirmed', 'disputed'] }, paymentReference: { type: 'string', max: 64 } }, req.body);
    await db.withTransaction(async (client, after) => {
      const e = await loadExpense(client, req.params.expenseId, user.id);
      const payeeId = e.payee_user_id || e.creator_user_id;
      const { rows } = await client.query('SELECT * FROM expense_shares WHERE expense_id = $1 AND user_id = $2 FOR UPDATE', [e.id, req.params.userId]);
      const s = rows[0];
      if (!s) throw err.notFound('share_not_found');
      const isOwner = s.user_id === user.id;
      const isPayee = payeeId === user.id;
      const allowed = (v.state === 'disputed' && (isOwner || isPayee)) || (isOwner && ['marked_paid', 'unsettled'].includes(v.state)) || (isPayee && v.state === 'confirmed');
      if (!allowed) throw err.forbidden('forbidden', v.state === 'confirmed' ? 'Only the payee can confirm a payment' : 'You can only update your own share');
      await client.query(
        `UPDATE expense_shares SET state = $3, payment_reference = COALESCE($4, payment_reference), updated_at = now(),
           confirmed_by = CASE WHEN $3 = 'confirmed' THEN $5::uuid ELSE confirmed_by END,
           confirmed_at = CASE WHEN $3 = 'confirmed' THEN now() ELSE confirmed_at END
         WHERE expense_id = $1 AND user_id = $2`,
        [e.id, s.user_id, v.state, v.paymentReference || null, user.id]
      );
      const other = isOwner ? payeeId : s.user_id;
      if (other !== user.id) {
        const titles = { marked_paid: `${user.displayName} marked their share as paid`, confirmed: `${user.displayName} confirmed your payment`, disputed: `${user.displayName} flagged a payment`, unsettled: `${user.displayName} reopened a share` };
        await notify(client, after, other, { type: 'activity', title: titles[v.state], body: e.description, data: { expenseId: e.id, target: { screen: 'split_settlement', params: { id: e.id } } } });
      }
    });
    return full(db, req.params.expenseId, user.id);
  },
};

exports.handler = createRouter(routes);
