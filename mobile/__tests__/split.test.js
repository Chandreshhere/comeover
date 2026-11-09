import {
  computeShares,
  equalAmounts,
  evenPercents,
  fillBlanks,
  itemisedBreakdown,
  ledgerTotals,
  minorToInput,
  money,
  nameOf,
  newDraft,
  peoplePool,
  stateMeta,
  toMinor,
  upiUrl,
} from '../src/features/splitmate/lib/split';

const sumShares = (r) => r.shares.reduce((n, s) => n + s.amountMinor, 0);

describe('SplitMate maths (always exact to the paisa)', () => {
  it('equal split distributes the remainder paisa', () => {
    const r = computeShares(newDraft({ participants: ['me', 'a', 'b'], method: 'equal', totalMinor: 100001 }));
    expect(r.valid).toBe(true);
    expect(sumShares(r)).toBe(100001);
    const amounts = r.shares.map((s) => s.amountMinor);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it('custom split must add up exactly', () => {
    const ok = computeShares(newDraft({ participants: ['me', 'a'], method: 'custom', totalMinor: 50000, custom: { me: 20000, a: 30000 } }));
    expect(ok.valid).toBe(true);
    expect(sumShares(ok)).toBe(50000);

    const short = computeShares(newDraft({ participants: ['me', 'a'], method: 'custom', totalMinor: 50000, custom: { me: 20000, a: 29999 } }));
    expect(short.valid).toBe(false);
    expect(short.error).toMatch(/unassigned/);

    const over = computeShares(newDraft({ participants: ['me', 'a'], method: 'custom', totalMinor: 50000, custom: { me: 20000, a: 30001 } }));
    expect(over.valid).toBe(false);
    expect(over.error).toMatch(/Over by/);
  });

  it('percentage split rounds to the exact total and rejects ≠ 100%', () => {
    const r = computeShares(newDraft({ participants: ['me', 'a', 'b'], method: 'percentage', totalMinor: 100000, percent: { me: 33.33, a: 33.33, b: 33.34 } }));
    expect(r.valid).toBe(true);
    expect(sumShares(r)).toBe(100000);

    const bad = computeShares(newDraft({ participants: ['me', 'a'], method: 'percentage', totalMinor: 100000, percent: { me: 50, a: 40 } }));
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/100%/);
  });

  it('itemised split shares items and spreads tax/tip proportionally', () => {
    const draft = newDraft({
      participants: ['me', 'a', 'b'],
      method: 'itemised',
      items: [
        { id: 'i1', name: 'Pav bhaji', amountMinor: 15000, assignees: ['me'] },
        { id: 'i2', name: 'Kulfi', amountMinor: 10001, assignees: ['a', 'b'] },
        { id: 'i3', name: 'Water', amountMinor: 3000, assignees: ['me', 'a', 'b'] },
      ],
      taxMinor: 1407,
      tipMinor: 1000,
    });
    const r = computeShares(draft);
    expect(r.valid).toBe(true);
    expect(r.total).toBe(15000 + 10001 + 3000 + 1407 + 1000);
    expect(sumShares(r)).toBe(r.total);
    const b = Object.fromEntries(itemisedBreakdown(draft).map((x) => [x.userId, x]));
    expect(b.me.itemsMinor).toBe(15000 + 1000);
    expect(b.a.itemsMinor + b.b.itemsMinor).toBe(10001 + 2000);
    expect(b.me.extrasMinor + b.a.extrasMinor + b.b.extrasMinor).toBe(2407);
  });

  it('itemised split flags unassigned items', () => {
    const r = computeShares(
      newDraft({ participants: ['me', 'a'], method: 'itemised', items: [{ id: 'i1', name: 'Chai', amountMinor: 4000, assignees: [] }] })
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not assigned/);
  });

  it('parses rupee input to paise', () => {
    expect(toMinor('149.5')).toBe(14950);
    expect(toMinor('₹1,200')).toBe(120000);
    expect(toMinor('')).toBe(0);
    expect(toMinor('.')).toBe(0);
  });
});

describe('Review split prefills (exact, valid from the start)', () => {
  it('equal amounts sum exactly and prefill a valid custom split', () => {
    const ids = ['me', 'a', 'b'];
    const amounts = equalAmounts(100001, ids);
    expect(Object.values(amounts).reduce((n, x) => n + x, 0)).toBe(100001);
    expect(Math.max(...Object.values(amounts)) - Math.min(...Object.values(amounts))).toBeLessThanOrEqual(1);
    const r = computeShares(newDraft({ participants: ids, method: 'custom', totalMinor: 100001, custom: amounts }));
    expect(r.valid).toBe(true);
    expect(equalAmounts(0, ids)).toEqual({ me: 0, a: 0, b: 0 });
  });

  it('round-trips prefilled custom amounts through the text inputs', () => {
    const ids = ['me', 'a', 'b', 'c', 'd', 'e', 'f'];
    const total = 98765;
    const text = Object.fromEntries(Object.entries(equalAmounts(total, ids)).map(([k, v]) => [k, minorToInput(v)]));
    const back = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, toMinor(v)]));
    expect(computeShares(newDraft({ participants: ids, method: 'custom', totalMinor: total, custom: back })).valid).toBe(true);
  });

  it('even percentages always total exactly 100', () => {
    for (let n = 1; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      const pct = evenPercents(ids);
      const bp = Object.values(pct).reduce((s, p) => s + Math.round(p * 100), 0);
      expect(bp).toBe(10000);
      Object.values(pct).forEach((p) => expect(String(p)).toMatch(/^\d+(\.\d{1,2})?$/)); // at most two decimals
      const r = computeShares(newDraft({ participants: ids, method: 'percentage', totalMinor: 123457, percent: pct }));
      expect(r.valid).toBe(true);
      expect(r.shares.reduce((s, x) => s + x.amountMinor, 0)).toBe(123457);
    }
    expect(evenPercents(['me', 'a', 'b'])).toEqual({ me: 33.34, a: 33.33, b: 33.33 });
  });

  it('fills only the blank rows with what is left', () => {
    const ids = ['me', 'a', 'b'];
    const next = fillBlanks({ me: 40000, a: 0, b: 0 }, ids, 100001);
    expect(next.me).toBe(40000);
    expect(next.a + next.b).toBe(60001);
    expect(computeShares(newDraft({ participants: ids, method: 'custom', totalMinor: 100001, custom: next })).valid).toBe(true);
    expect(fillBlanks({ me: 50000, a: 50000, b: 0 }, ids, 100000)).toBeNull(); // nothing left
    expect(fillBlanks({ me: 30000, a: 30000, b: 30000 }, ids, 100000)).toBeNull(); // nobody blank
  });

  it('formats inputs and money without float noise or NaN', () => {
    expect(minorToInput(33334)).toBe('333.34');
    expect(minorToInput(33330)).toBe('333.30');
    expect(minorToInput(25000)).toBe('250');
    expect(minorToInput(5)).toBe('0.05');
    expect(minorToInput(0)).toBe('');
    expect(minorToInput(undefined)).toBe('');
    expect(money(123456789)).toBe('₹12,34,567.89');
    expect(money(100000)).toBe('₹1,000');
    expect(money(33330)).toBe('₹333.30');
    expect(money(0)).toBe('₹0');
    expect(money(NaN)).toBe('₹0');
    expect(money(-2550)).toBe('−₹25.50');
  });

  it('error copy uses exact money and falls back to a neutral name', () => {
    const r = computeShares(newDraft({ participants: ['me', 'a'], method: 'custom', totalMinor: 50000, custom: { me: 20000, a: 29970 } }));
    expect(r.error).toBe('₹0.30 still unassigned.');
    expect(nameOf('me', 'You (Asha)')).toBe('You (Asha)');
    expect(nameOf('nobody-cached')).toBe('Member');
  });

  it('status meta is built on demand for every share state', () => {
    const m = stateMeta();
    ['unsettled', 'marked_paid', 'confirmed', 'disputed'].forEach((k) => expect(m[k].label).toBeTruthy());
  });
});

describe('ledger + people', () => {
  it('computes owe / owed / awaiting from my point of view', () => {
    const totals = ledgerTotals([
      { payeeId: 'u1', shares: [{ userId: 'me', amountMinor: 20000, state: 'unsettled' }] },
      { payeeId: 'u2', shares: [{ userId: 'me', amountMinor: 5000, state: 'marked_paid' }] },
      { payeeId: 'me', shares: [{ userId: 'me', amountMinor: 1000, state: 'confirmed' }, { userId: 'u3', amountMinor: 7000, state: 'unsettled' }] },
    ]);
    expect(totals).toEqual({ youOwe: 20000, owedToYou: 7000, awaiting: 5000 });
  });

  it('only offers people from shared plans and chats, never blocked users', () => {
    const pool = peoplePool({
      activities: [
        { id: 'a1', startsAt: '2026-11-01T10:00:00Z', host: { id: 'h1' }, participants: ['me', 'p1', 'p2'] },
        { id: 'a2', startsAt: '2026-11-05T10:00:00Z', host: { id: 'h2' }, participants: ['p3'] },
        { id: 'a3', startsAt: '2026-11-06T10:00:00Z', host: { id: 'stranger' }, participants: ['s2'] },
      ],
      joinStates: { a1: 'completed', a2: 'accepted' },
      conversations: [{ memberIds: ['me', 'c1', 'p2'] }],
      blocked: ['p1'],
    });
    expect(pool).toEqual(['h2', 'p3', 'h1', 'p2', 'c1']);
  });

  it('builds a UPI deep link without PIN or custody data', () => {
    const url = upiUrl({ payeeUpi: 'meher@okbank', payeeName: 'Meher S', amountMinor: 20050, note: 'Court booking' });
    expect(url).toBe('upi://pay?pa=meher%40okbank&pn=Meher%20S&am=200.50&cu=INR&tn=Court%20booking');
  });
});
