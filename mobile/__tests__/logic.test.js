jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x' },
}));

import { coarseDistance, durationLabel, inr } from '../src/utils/format';
import { applyTaxonomy, categories, categoryBySlug, CITY, levels } from '../src/data/catalog';
import { mapIncoming, qs, setSelfId } from '../src/api/client';
import { decodeJwt } from '../src/api/cognito';

describe('coarseDistance (privacy: never exact)', () => {
  it('buckets short distances', () => {
    expect(coarseDistance(120)).toBe('< 300 m');
    expect(coarseDistance(640)).toBe('600 m');
  });
  it('rounds km to half-km bands', () => {
    expect(coarseDistance(1430)).toBe('1.5 km');
    expect(coarseDistance(2000)).toBe('2 km');
    expect(coarseDistance(23400)).toBe('23 km');
  });
});

describe('format helpers', () => {
  it('formats durations and rupees', () => {
    expect(durationLabel(20)).toBe('20 min');
    expect(durationLabel(90)).toBe('1h 30m');
    expect(inr(20000)).toBe('₹200');
  });
});

describe('server taxonomy', () => {
  it('replaces categories in place, hides restricted ones and keeps known pictograms', () => {
    const ref = categories;
    applyTaxonomy({
      categories: [
        { slug: 'chai', label: 'Chai', pictogram: 'chai' },
        { slug: 'pickleball', label: 'Pickleball', pictogram: 'unknown-glyph' },
        { slug: 'nightlife', label: 'Nightlife', riskLevel: 'restricted' },
      ],
      levels: [{ level: 2, name: 'B', xp: 50 }, { level: 1, name: 'A', xp: 0 }],
      city: { name: 'Pune', areas: [{ name: 'Baner', lat: 18.56, lng: 73.78 }] },
    });
    expect(categories).toBe(ref);
    expect(categories.map((c) => c.slug)).toEqual(['chai', 'pickleball']);
    expect(categoryBySlug.pickleball.pictogram).toBe('sparkle');
    expect(categoryBySlug.nightlife).toBeUndefined();
    expect(levels[0].xp).toBe(0);
    expect(CITY).toEqual({ name: 'Pune', areas: ['Baner'] });
  });
});

describe("'me' id mapping", () => {
  afterEach(() => setSelfId(null));
  it('rewrites only the exact self id in responses', () => {
    setSelfId('5f1c');
    const out = mapIncoming({ host: { id: '5f1c' }, participants: ['5f1c', 'u2'], body: 'hi 5f1c' });
    expect(out).toEqual({ host: { id: 'me' }, participants: ['me', 'u2'], body: 'hi 5f1c' });
  });
  it('is a no-op before sign-in', () => {
    expect(mapIncoming({ id: 'abc' })).toEqual({ id: 'abc' });
  });
});

describe('query strings', () => {
  it('drops empty values and joins arrays', () => {
    expect(qs({ lat: 23.03, category: ['chai', 'run'], q: '', cursor: undefined })).toBe('?lat=23.03&category=chai%2Crun');
  });
});

describe('JWT decoding', () => {
  it('reads claims from a Cognito id token', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'abc-123', 'cognito:groups': ['admin'] })).toString('base64').replace(/=+$/, '');
    global.atob = global.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
    expect(decodeJwt(`x.${payload}.y`)).toEqual({ sub: 'abc-123', 'cognito:groups': ['admin'] });
  });
});
