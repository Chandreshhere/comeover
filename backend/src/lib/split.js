'use strict';
// SplitMate ledger maths (integer paise; deterministic rounding).
// The app NEVER holds or moves money: settlement is a UPI deep link to the
// payer's own UPI app, and "paid" states are user/payee-reported, not bank-confirmed.
const { err } = require('./http');
const { FORMATS } = require('./validate');

// Largest-remainder apportionment of `total` by `weights` (same order as ids).
function apportion(total, ids, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw err.badRequest('invalid_weights');
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) floors[order[k].i] += 1;
  return ids.map((id, i) => ({ userId: id, amountMinor: floors[i] }));
}

function computeShares(method, totalMinor, participantIds, opts = {}) {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw err.badRequest('invalid_total');
  const ids = [...new Set(participantIds)];
  if (!ids.length) throw err.badRequest('no_participants');
  switch (method) {
    case 'equal':
      return apportion(totalMinor, ids, ids.map(() => 1));
    case 'custom': {
      const amounts = opts.amounts || {};
      const out = ids.map((id) => ({ userId: id, amountMinor: Number(amounts[id] || 0) }));
      if (out.some((s) => !Number.isInteger(s.amountMinor) || s.amountMinor < 0)) throw err.badRequest('invalid_custom_amounts');
      const sum = out.reduce((a, s) => a + s.amountMinor, 0);
      if (sum !== totalMinor) throw err.badRequest('custom_amounts_mismatch', `Custom amounts add up to ${sum}, expected ${totalMinor}`);
      return out;
    }
    case 'percentage': {
      const pct = opts.percentages || {};
      const weights = ids.map((id) => Number(pct[id] || 0));
      const sum = weights.reduce((a, b) => a + b, 0);
      if (weights.some((w) => w < 0) || Math.abs(sum - 100) > 0.01) throw err.badRequest('percentages_must_total_100');
      return apportion(totalMinor, ids, weights);
    }
    case 'itemised': {
      const items = opts.items || [];
      if (!items.length) return ids.map((id) => ({ userId: id, amountMinor: 0 }));
      const perUser = Object.fromEntries(ids.map((id) => [id, 0]));
      let itemsSum = 0;
      for (const it of items) {
        const lineTotal = it.amountMinor * (it.quantity || 1);
        itemsSum += lineTotal;
        const asg = (it.assignments || []).filter((a) => perUser[a.userId] !== undefined);
        if (!asg.length) throw err.badRequest('item_unassigned', `Item "${it.label || ''}" has no assigned participants`);
        for (const s of apportion(lineTotal, asg.map((a) => a.userId), asg.map((a) => a.ratio || 1))) perUser[s.userId] += s.amountMinor;
      }
      if (itemsSum > totalMinor) throw err.badRequest('items_exceed_total');
      // Tax / service charge / tip: spread the difference in proportion to item subtotals.
      const extra = totalMinor - itemsSum;
      if (extra > 0) {
        const withItems = ids.filter((id) => perUser[id] > 0);
        for (const s of apportion(extra, withItems, withItems.map((id) => perUser[id]))) perUser[s.userId] += s.amountMinor;
      }
      return ids.map((id) => ({ userId: id, amountMinor: perUser[id] }));
    }
    default:
      throw err.badRequest('invalid_split_method');
  }
}

function upiLink({ vpa, payeeName, amountMinor, note }) {
  if (!vpa || !FORMATS.vpa.test(vpa)) return null;
  const params = new URLSearchParams({
    pa: vpa,
    pn: (payeeName || 'Come Over friend').slice(0, 40),
    am: (amountMinor / 100).toFixed(2),
    cu: 'INR',
    tn: (note || 'SplitMate').slice(0, 60),
  });
  return `upi://pay?${params.toString()}`;
}

module.exports = { apportion, computeShares, upiLink };
