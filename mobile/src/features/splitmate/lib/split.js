// SplitMate maths + helpers. Ledger only: the app records who owes what and
// hands off to a UPI app. It never holds, pools or moves money, and a share
// marked "paid" by a participant is a claim, not a bank confirmation.
import { colors } from '@/theme/tokens';
import { personById } from '@/data/catalog';

export const METHODS = [
  { value: 'equal', label: 'Equal' },
  { value: 'custom', label: 'Custom' },
  { value: 'percentage', label: 'Percent' },
  { value: 'itemised', label: 'Items' },
];

export const METHOD_LABEL = { equal: 'Split equally', custom: 'Custom amounts', percentage: 'By percentage', itemised: 'Itemised' };

// UPI VPA format (handle@psp). Only the public ID is stored — never PINs.
export const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export const toMinor = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
// Paise -> text for an input: '' for nothing, '250' for whole rupees and
// '249.50' (always two decimals) when there are paise.
export const minorToInput = (m) => {
  const n = Math.round(Number(m) || 0);
  if (n <= 0) return '';
  const paise = n % 100;
  return paise ? `${Math.floor(n / 100)}.${String(paise).padStart(2, '0')}` : String(n / 100);
};

// Indian digit grouping (1,23,456) without relying on Intl.
const groupIN = (n) => {
  const s = String(n);
  if (s.length <= 3) return s;
  return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
};

// Paise -> display money: '₹1,250' for whole rupees, '₹333.30' otherwise.
// Always exact (integer maths) and never 'NaN'.
export function money(minor) {
  const n = Math.round(Number(minor) || 0);
  const abs = Math.abs(n);
  const paise = abs % 100;
  return `${n < 0 ? '−' : ''}₹${groupIN(Math.floor(abs / 100))}${paise ? `.${String(paise).padStart(2, '0')}` : ''}`;
}

// Names resolve through the store's user cache (filled from API responses;
// SplitBits.useKnownPeople fetches profiles that aren't cached yet).
export const UNKNOWN_NAME = 'Member';
export const nameOf = (id, meName = 'You') => (id === 'me' ? meName : personById[id]?.name || UNKNOWN_NAME);

const IN_PLAN = new Set(['accepted', 'checked_in', 'completed']);

// People you can split with = people you've actually shared a plan or chat
// with (never strangers from discovery). Most recent plans first.
// -> string[] of user ids (excluding 'me' and blocked users).
export function peoplePool({ activities = [], joinStates = {}, conversations = [], blocked = [] }) {
  const out = [];
  const seen = new Set(['me', ...blocked]);
  const add = (id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  [...activities]
    .filter((a) => IN_PLAN.has(joinStates[a.id]) || a.host?.id === 'me')
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
    .forEach((a) => {
      add(a.host?.id);
      (a.participants || []).forEach(add);
    });
  conversations.forEach((c) => (c.memberIds || []).forEach(add));
  return out;
}

export const participantsOf = (activity) => Array.from(new Set(['me', ...((activity?.participants || []).filter(Boolean))]));

let seq = 0;
export const localId = (p = 'i') => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function newDraft(overrides = {}) {
  return {
    clientId: localId('exp'),
    description: '',
    totalMinor: 0,
    activityId: null,
    participants: ['me'],
    method: 'equal',
    payeeId: 'me',
    payeeUpi: '',
    custom: {},
    percent: {},
    items: [],
    taxMinor: 0,
    tipMinor: 0,
    billUri: null, // local preview only
    receiptKey: null, // S3 key from POST /media/upload-url (kind: bill)
    ...overrides,
  };
}

// Distribute `total` across weights with integer paise; remainder goes to the
// largest weights first so the sum is always exact.
function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) floors[order[k][1]] += 1;
  return floors;
}

// Equal amounts in paise per person: { id: minor }, summing exactly to total.
export function equalAmounts(total, ids) {
  const parts = distribute(Math.max(0, Math.round(Number(total) || 0)), ids.map(() => 1));
  return Object.fromEntries(ids.map((id, i) => [id, parts[i]]));
}

// Even percentages with at most two decimals that add up to exactly 100
// (worked out in basis points, so 3 people -> 33.34 / 33.33 / 33.33).
export function evenPercents(ids) {
  const bp = distribute(10000, ids.map(() => 1));
  return Object.fromEntries(ids.map((id, i) => [id, bp[i] / 100]));
}

// Spread what's left of `total` over the people whose amount is still blank
// (0). -> new { id: minor } map, or null when nothing is left or nobody is blank.
export function fillBlanks(amounts, ids, total) {
  const assigned = ids.reduce((s, id) => s + (amounts[id] || 0), 0);
  const left = total - assigned;
  const blanks = ids.filter((id) => !amounts[id]);
  if (left <= 0 || !blanks.length) return null;
  const parts = distribute(left, blanks.map(() => 1));
  const next = { ...amounts };
  blanks.forEach((id, i) => {
    next[id] = parts[i];
  });
  return next;
}

export function itemsSubtotal(items) {
  return items.reduce((s, it) => s + (it.amountMinor || 0), 0);
}

export function itemisedBreakdown(draft) {
  const ids = draft.participants;
  const base = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const it of draft.items) {
    const who = (it.assignees || []).filter((a) => ids.includes(a));
    if (!who.length || !it.amountMinor) continue;
    const parts = distribute(it.amountMinor, who.map(() => 1));
    who.forEach((a, i) => {
      base[a] += parts[i];
    });
  }
  const extras = (draft.taxMinor || 0) + (draft.tipMinor || 0);
  const extraParts = distribute(extras, ids.map((id) => base[id]));
  return ids.map((id, i) => ({ userId: id, itemsMinor: base[id], extrasMinor: extraParts[i], amountMinor: base[id] + extraParts[i] }));
}

export function draftTotal(draft) {
  if (draft.method === 'itemised') return itemsSubtotal(draft.items) + (draft.taxMinor || 0) + (draft.tipMinor || 0);
  return draft.totalMinor || 0;
}

// -> { shares:[{userId, amountMinor}], total, assigned, valid, error }
export function computeShares(draft) {
  const ids = draft.participants;
  const total = draftTotal(draft);
  if (!ids.length) return { shares: [], total, assigned: 0, valid: false, error: 'Add at least one person.' };
  if (total <= 0) return { shares: [], total, assigned: 0, valid: false, error: 'Enter the bill total.' };

  let shares;
  if (draft.method === 'equal') {
    shares = distribute(total, ids.map(() => 1)).map((amountMinor, i) => ({ userId: ids[i], amountMinor }));
  } else if (draft.method === 'custom') {
    shares = ids.map((id) => ({ userId: id, amountMinor: draft.custom[id] || 0 }));
  } else if (draft.method === 'percentage') {
    const pct = ids.map((id) => Number(draft.percent[id]) || 0);
    const pctSum = pct.reduce((a, b) => a + b, 0);
    if (Math.abs(pctSum - 100) > 0.001) {
      return {
        shares: ids.map((id, i) => ({ userId: id, amountMinor: Math.round((total * pct[i]) / 100) })),
        total,
        assigned: Math.round((total * pctSum) / 100),
        valid: false,
        error: `Percentages add up to ${Math.round(pctSum * 100) / 100}%. They need to total 100%.`,
      };
    }
    shares = distribute(total, pct).map((amountMinor, i) => ({ userId: ids[i], amountMinor }));
  } else {
    const unassigned = draft.items.filter((it) => it.amountMinor > 0 && !(it.assignees || []).some((a) => ids.includes(a)));
    shares = itemisedBreakdown(draft).map(({ userId, amountMinor }) => ({ userId, amountMinor }));
    if (!draft.items.length) return { shares, total, assigned: 0, valid: false, error: 'Add at least one item.' };
    if (unassigned.length) return { shares, total, assigned: total - itemsSubtotal(unassigned), valid: false, error: `${unassigned.length} item${unassigned.length > 1 ? 's are' : ' is'} not assigned to anyone.` };
  }
  const assigned = shares.reduce((s, x) => s + x.amountMinor, 0);
  if (assigned !== total) {
    const diff = total - assigned;
    return { shares, total, assigned, valid: false, error: diff > 0 ? `${money(diff)} still unassigned.` : `Over by ${money(-diff)}.` };
  }
  return { shares, total, assigned, valid: true, error: null };
}

// Function, not a constant: reads the live (light/dark) palette.
export const stateMeta = () => ({
  unsettled: { label: 'Unpaid', bg: colors.surfaceSubtle, fg: colors.inkSoft, icon: 'circle' },
  marked_paid: { label: 'Marked paid', bg: colors.orangeSoft, fg: colors.ink, icon: 'clock' },
  confirmed: { label: 'Confirmed', bg: colors.mint, fg: colors.ink, icon: 'check' },
  disputed: { label: 'Disputed', bg: colors.pinkSoft, fg: colors.danger, icon: 'alert-circle' },
});

// Totals from the current user's point of view.
export function ledgerTotals(expenses) {
  let youOwe = 0;
  let owedToYou = 0;
  let awaiting = 0;
  for (const e of expenses) {
    for (const sh of e.shares || []) {
      if (e.payeeId === 'me' && sh.userId !== 'me' && sh.state !== 'confirmed') owedToYou += sh.amountMinor;
      if (e.payeeId !== 'me' && sh.userId === 'me') {
        if (sh.state === 'unsettled' || sh.state === 'disputed') youOwe += sh.amountMinor;
        if (sh.state === 'marked_paid') awaiting += sh.amountMinor;
      }
    }
  }
  return { youOwe, owedToYou, awaiting };
}

export const settledCount = (e) => (e.shares || []).filter((s) => s.state === 'confirmed').length;

export function upiUrl({ payeeUpi, payeeName, amountMinor, note }) {
  const params = [
    `pa=${encodeURIComponent(payeeUpi)}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${(amountMinor / 100).toFixed(2)}`,
    'cu=INR',
    `tn=${encodeURIComponent(note || 'Come Over split')}`,
  ];
  return `upi://pay?${params.join('&')}`;
}
