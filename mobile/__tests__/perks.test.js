import {
  clockLabel,
  formToOfferBody,
  emptyOfferForm,
  friendlyError,
  lockReason,
  normaliseCode,
  normaliseOffer,
  offerConditions,
  redeemErrorCopy,
  validateOffer,
  windowLabel,
} from '../src/features/business/perks';
import { qrPath } from '../src/features/business/components/QRCode';

describe('perk windows (IST, plain English)', () => {
  it('matches the server wording', () => {
    expect(windowLabel({ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440 })).toBe('Any time');
    expect(windowLabel({ days: [1, 2, 3, 4], startMinute: 960, endMinute: 1140 })).toBe('Mon to Thu, 4 to 7 pm');
    expect(windowLabel({ days: [0, 6], startMinute: 480, endMinute: 1440 })).toBe('Weekends, from 8 am');
    expect(windowLabel({ days: [1, 3, 5], startMinute: 0, endMinute: 1440 })).toBe('Mon, Wed, Fri');
    expect(windowLabel({ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 660, endMinute: 900 })).toBe('Every day, 11 am to 3 pm');
  });
  it('formats clock times', () => {
    expect(clockLabel(990)).toBe('4:30 pm');
    expect(clockLabel(0)).toBe('12 am');
    expect(clockLabel(720)).toBe('12 pm');
  });
});

describe('offers and lock reasons', () => {
  const base = { id: 'o1', title: 'Weekday deal', kind: 'percent', value: 15, minGroup: 3, minLevel: 5, minShowUpRate: 0.8, days: [1, 2, 3, 4], startMinute: 960, endMinute: 1140 };
  it('fills label and window when the server leaves them out', () => {
    const o = normaliseOffer(base);
    expect(o.label).toBe('15% off');
    expect(o.window).toBe('Mon to Thu, 4 to 7 pm');
    expect(offerConditions(o)).toEqual(['Mon to Thu, 4 to 7 pm', 'Groups of 3+', 'Level 5+']);
    expect(normaliseOffer('Free chai')).toBeNull();
    expect(normaliseOffer({ id: 'o2', kind: 'flat', value: 100, title: 'Bill deal' }).label).toBe('₹100 off');
    expect(normaliseOffer({ id: 'o3', kind: 'freebie', value: null, title: 'Free chai' }).label).toBe('Free chai');
  });
  it('explains locks in plain words', () => {
    const lvl = normaliseOffer({ ...base, eligibility: { eligible: false, reasons: ['not_now', 'level'], unlockLevel: 5, unlockLevelName: 'Connector' } });
    expect(lockReason(lvl)).toBe('Unlocks at Level 5, Connector');
    const show = normaliseOffer({ ...base, eligibility: { eligible: false, reasons: ['show_up'] } });
    expect(lockReason(show)).toBe('Needs 80% show-up');
    const now = normaliseOffer({ ...base, window: 'Mon to Thu, 4 to 7 pm', eligibility: { eligible: false, reasons: ['not_now'] } });
    expect(lockReason(now)).toBe('Available Mon to Thu, 4 to 7 pm');
    const used = normaliseOffer({ ...base, eligibility: { eligible: false, reasons: ['weekly_limit'] } });
    expect(lockReason(used)).toBe('Used this week');
    expect(lockReason(normaliseOffer({ ...base, eligibility: { eligible: true, reasons: [] } }))).toBeNull();
  });
  it('maps redeem errors to friendly copy, never raw messages', () => {
    expect(redeemErrorCopy({ code: 'weekly_limit', message: 'raw' }).title).toBe('Used this week');
    expect(redeemErrorCopy({ code: 'offer_locked', data: { details: { reasons: ['level'], unlockLevel: 5 } } }).body).toMatch(/^Unlocks at Level 5/);
    expect(redeemErrorCopy({ status: 404, code: 'route_not_found', message: 'No route for POST' }).body).not.toMatch(/route/i);
    expect(friendlyError({ code: 'weird', message: 'stack trace' }, 'Fallback')).toBe('Fallback');
    expect(friendlyError({ status: 0, code: 'network' }, 'Fallback')).toMatch(/No connection/);
  });
});

describe('staff code entry', () => {
  it('uppercases, drops spaces and caps at 6', () => {
    expect(normaliseCode('ab3 xyz')).toBe('AB3XYZ');
    expect(normaliseCode(' k7-m2 p9 q')).toBe('K7M2P9');
  });
});

describe('business offer form validation (contract ranges)', () => {
  it('accepts the defaults and builds the body', () => {
    const f = { ...emptyOfferForm(), title: '15% off the bill' };
    expect(validateOffer(f)).toEqual({});
    expect(formToOfferBody(f)).toMatchObject({ kind: 'percent', value: 15, minGroup: 2, days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440 });
  });
  it('rejects out-of-range values', () => {
    const f = { ...emptyOfferForm(), title: 'x', value: '60', days: [], startMinute: 1200, endMinute: 1100, perUserPerWeek: 9 };
    expect(Object.keys(validateOffer(f)).sort()).toEqual(['days', 'perUserPerWeek', 'time', 'title', 'value']);
    expect(validateOffer({ ...emptyOfferForm(), title: 'Flat deal', kind: 'flat', value: '5' }).value).toBeTruthy();
    expect(validateOffer({ ...emptyOfferForm(), title: 'Free chai', kind: 'freebie', value: '' })).toEqual({});
    expect(formToOfferBody({ ...emptyOfferForm(), title: 'Free chai', kind: 'freebie', value: '' }).value).toBeNull();
  });
});

describe('QR encoding (pure JS)', () => {
  it('produces a square module grid with dark runs', () => {
    const { n, d } = qrPath('comeover:redeem:AB3XYZ');
    expect(n).toBeGreaterThanOrEqual(21);
    expect(d.startsWith('M0 0h7')).toBe(true); // finder pattern top-left
  });
});
