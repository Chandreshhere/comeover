// Social style (introvert / ambivert / extrovert): store mapping and ranking.
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x' },
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/geolocation', () => ({ setRNConfiguration: jest.fn(), getCurrentPosition: jest.fn() }));
jest.mock('../src/api/endpoints', () => ({
  me: { update: jest.fn(async () => ({})), updatePreferences: jest.fn(async () => ({})) },
  discovery: { nearbyPeople: jest.fn(), activities: jest.fn(), featured: jest.fn(async () => ({ items: [] })) },
}));

import * as E from '../src/api/endpoints';
import { mergeUsers, normSocialStyle, rankPeopleForStyle, rankPlansForStyle, useAppStore } from '../src/store/useAppStore';

const ids = (list) => list.map((x) => x.id);
const people = [
  { id: 'e1', name: 'E1', socialStyle: 'extrovert' },
  { id: 'n1', name: 'N1', socialStyle: null },
  { id: 'a1', name: 'A1', socialStyle: 'ambivert' },
  { id: 'i1', name: 'I1', socialStyle: 'introvert' },
];

describe('ranking helpers', () => {
  it('ranks people by social match, stable, never dropping anyone', () => {
    expect(ids(rankPeopleForStyle(people, 'introvert'))).toEqual(['i1', 'a1', 'n1', 'e1']);
    expect(ids(rankPeopleForStyle(people, 'extrovert'))).toEqual(['e1', 'a1', 'n1', 'i1']);
    expect(ids(rankPeopleForStyle(people, null))).toEqual(['e1', 'n1', 'a1', 'i1']);
    expect(ids(rankPeopleForStyle(people, 'bogus'))).toEqual(['e1', 'n1', 'a1', 'i1']);
  });

  it('nudges plans gently: server order stays the main signal', () => {
    const big = (id) => ({ id, capacity: 12, category: 'music' });
    const small = (id) => ({ id, capacity: 3, category: 'chai' });
    const mid = (id) => ({ id, capacity: 6, category: 'explore' });
    expect(ids(rankPlansForStyle([big('a'), small('b')], 'introvert'))).toEqual(['b', 'a']);
    expect(ids(rankPlansForStyle([small('a'), big('b')], 'extrovert'))).toEqual(['b', 'a']);
    expect(ids(rankPlansForStyle([mid('m1'), mid('m2'), mid('m3'), mid('m4'), small('s5')], 'introvert'))).toEqual(['m1', 'm2', 'm3', 's5', 'm4']);
    expect(ids(rankPlansForStyle([big('b1'), big('b2'), big('b3'), big('b4'), small('s5')], 'introvert'))).toEqual(['b1', 'b2', 's5', 'b3', 'b4']);
    expect(ids(rankPlansForStyle([big('a'), small('b')], null))).toEqual(['a', 'b']);
  });

  it('normalises socialStyle into the users cache and keeps it across partial payloads', () => {
    expect(normSocialStyle('ambivert')).toBe('ambivert');
    expect(normSocialStyle('shy')).toBeNull();
    let users = mergeUsers({}, [{ id: 'u1', name: 'U1', socialStyle: 'introvert' }, { id: 'u2', socialStyle: 'loud' }, { id: 'me', socialStyle: 'extrovert' }]);
    expect(users.u1.socialStyle).toBe('introvert');
    expect(users.u2.socialStyle).toBeNull();
    expect(users.me).toBeUndefined();
    users = mergeUsers(users, [{ id: 'u1', name: 'U1 renamed' }]); // e.g. chat member names only
    expect(users.u1).toEqual({ id: 'u1', name: 'U1 renamed', socialStyle: 'introvert' });
  });
});

describe('store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAppStore.setState({ profile: { ...useAppStore.getState().profile, socialStyle: null }, users: {}, nearbyPeopleIds: [], activities: [], feedIds: [] });
    E.me.update.mockClear();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('ranks nearby people for my style and re-ranks when I change it', async () => {
    useAppStore.setState({ profile: { ...useAppStore.getState().profile, socialStyle: 'introvert' } });
    E.discovery.nearbyPeople.mockResolvedValueOnce({ items: people, nextCursor: null });
    await useAppStore.getState().loadNearbyPeople();
    expect(useAppStore.getState().nearbyPeopleIds).toEqual(['i1', 'a1', 'n1', 'e1']);
    expect(useAppStore.getState().users.e1.socialStyle).toBe('extrovert');

    useAppStore.getState().setProfile({ socialStyle: 'extrovert' });
    expect(useAppStore.getState().profile.socialStyle).toBe('extrovert');
    expect(useAppStore.getState().nearbyPeopleIds).toEqual(['e1', 'a1', 'n1', 'i1']);
    jest.advanceTimersByTime(700);
    expect(E.me.update).toHaveBeenCalledWith({ socialStyle: 'extrovert' });
  });

  it('nudges the feed for my style unless the server already did', async () => {
    useAppStore.setState({ profile: { ...useAppStore.getState().profile, socialStyle: 'introvert' } });
    const plans = [
      { id: 'p1', category: 'music', capacity: 12, participants: [] },
      { id: 'p2', category: 'chai', capacity: 3, participants: [] },
    ];
    E.discovery.activities.mockResolvedValueOnce({ items: plans, nextCursor: null });
    await useAppStore.getState().loadFeed();
    expect(useAppStore.getState().feedIds).toEqual(['p2', 'p1']);

    E.discovery.activities.mockResolvedValueOnce({ items: plans, nextCursor: null, rankedFor: 'introvert' });
    await useAppStore.getState().loadFeed();
    expect(useAppStore.getState().feedIds).toEqual(['p1', 'p2']);
  });
});
