import { computeShares, itemisedBreakdown, ledgerTotals, newDraft, peoplePool, toMinor, upiUrl } from '../src/features/splitmate/lib/split';

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
