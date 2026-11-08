// Global client state (zustand v5). All data comes from the Project IRL API;
// nothing is seeded. Persistence keeps only device-local preferences, the
// create-flow draft and an offline snapshot for display while reconnecting.
//
// RULES FOR SCREENS (zustand v5):
//  - Select primitives or stable references: useAppStore((s) => s.profile).
//  - Never build new objects/arrays inside a selector — derive with useMemo.
//  - Call the `load*` actions on focus (useFocusEffect) and read `status[key]`
//    ('idle'|'loading'|'ready'|'error') + `errors[key]` for loading/error UI.
//  - XP, payments, join decisions and safety outcomes are server-authoritative.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mapIncoming, setSelfId } from '@/api/client';
import * as E from '@/api/endpoints';
import { startPhoneSignIn, answerOtp } from '@/api/cognito';
import { clearSession, hasSession, loadSession, onSignedOut, saveSession } from '@/api/session';
import { suggest } from '@/api/assistant';
import config, { isConfigured } from '@/config';
import { applyTaxonomy, areaCentroids, categoryBySlug, CITY_CENTER, levels as levelTable, setUserSource } from '@/data/catalog';
import realtime from '@/services/realtime';
import { getCoarsePosition } from '@/services/location';

const nowIso = () => new Date().toISOString();
const tempId = (p) => `${p}_tmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const itemsOf = (r) => (Array.isArray(r) ? r : r?.items || []);

export const initialDraft = {
  category: null,
  title: '',
  description: '',
  tags: [],
  when: 'now', // now | in15 | tonight | tomorrow | weekend | custom
  startsAt: null,
  durationMin: 30,
  area: '',
  venueName: '',
  venueType: 'Public café',
  capacity: 4,
  joinRule: 'approval', // approval | instant
  audience: 'everyone', // everyone | circle | invite_only
  circleId: null,
  ageRange: null,
  level: 'any',
  cost: '',
  accessibility: '',
};

const initialPrefs = {
  location: 'unknown', // unknown | granted | denied | manual
  coords: null, // rounded, device-only; sent only as query params for discovery
  radiusKm: config.DEFAULT_RADIUS_KM,
  notifications: { enabled: false, nearby: true, joinRequests: true, messages: true, questReminders: false, productUpdates: false, quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' },
  haptics: true,
  sound: false,
  analyticsConsent: false,
  dailyStreakOptIn: false,
  showOnRadar: true,
  language: 'English',
};
const DEVICE_ONLY_PREFS = new Set(['coords', 'haptics', 'sound']);

const initialState = {
  boot: { ready: false, configured: isConfigured(), offline: false },
  session: { serverId: null, phone: null, verified: false, ageConfirmed: false, termsAcceptedAt: null, onboarded: false, status: 'active' },
  profile: { id: 'me', name: '', bio: '', avatarSeed: 'me-irl', avatarKey: null, avatarUri: null, city: '', area: '', interests: [], intents: [], visibility: 'discoverable', boundaries: '', pronouns: '', languages: [] },
  prefs: initialPrefs,
  availability: { status: 'busy', until: null, activities: [] },
  filters: { distanceKm: config.DEFAULT_RADIUS_KM, when: 'any', groupSize: 'any', level: 'any', accessible: false, freeOnly: false, categories: [] },

  status: {}, // key -> idle | loading | ready | error
  errors: {}, // key -> message

  users: {}, // id -> PublicUser
  nearbyPeopleIds: [],
  activities: [],
  feedIds: [],
  featuredId: null,
  feedCursor: null,
  createdActivities: [],
  joinStates: {},
  joinIntros: {},
  completionAwards: {},
  feedback: {},
  myActivities: { hosted: [], joined: [], past: [], cancelled: [] },

  draft: { ...initialDraft },

  progress: { xp: 0, level: null, completedActivities: 0, peopleMet: 0, hosted: 0, showUpRate: 1, weeklyGoal: 2, weeklyDone: 0, streakWeeks: 0, freezesLeft: 0, categoryCounts: {}, week: [], lastLevelSeen: null },
  quests: [],
  milestones: [],
  achievements: [],
  streakCalendar: null,

  conversations: [],
  messages: {},

  circles: [],
  joinedCircles: [],
  circleMembers: {},
  circleChallenges: {},

  blocked: [],
  reports: [],
  trustedContacts: [],

  expenses: [],
  notifications: [],
  unread: { notifications: 0, messages: 0 },
  subscription: { tier: 'free', status: null, expiresAt: null, store: null },
  service: { status: 'ok' },
};

// ---------- normalisers ----------
function mergeUsers(users, list) {
  if (!list?.length) return users;
  const next = { ...users };
  list.forEach((u) => {
    if (u?.id && u.id !== 'me') next[u.id] = { ...(next[u.id] || {}), ...u };
  });
  return next;
}
function hostsOf(list) {
  return list.map((a) => a.host).filter(Boolean);
}
function normActivity(a) {
  const cat = categoryBySlug[a.category];
  const participants = a.participants || [];
  return {
    ...a,
    pictogram: a.pictogram || cat?.pictogram || 'sparkle',
    participants,
    joinedCount: a.joinedCount ?? participants.length,
    distanceM: a.distanceM ?? null,
    accentIndex: a.accentIndex ?? 0,
    tags: a.tags || [],
    hostedByMe: a.host?.id === 'me',
  };
}
function upsertActivities(state, list) {
  if (!list?.length) return {};
  const byId = new Map(state.activities.map((a) => [a.id, a]));
  const joinStates = { ...state.joinStates };
  list.forEach((raw) => {
    const a = normActivity(raw);
    byId.set(a.id, { ...(byId.get(a.id) || {}), ...a });
    if (raw.myJoinState !== undefined) {
      if (raw.myJoinState) joinStates[a.id] = raw.myJoinState;
      else delete joinStates[a.id];
    }
    if (a.host?.id === 'me') joinStates[a.id] = joinStates[a.id] || 'accepted';
  });
  const activities = Array.from(byId.values());
  return {
    activities,
    joinStates,
    users: mergeUsers(state.users, hostsOf(list)),
    createdActivities: activities.filter((a) => a.host?.id === 'me'),
  };
}
function mapMe(me = {}) {
  // Backend returns profile fields under me.profile (null until profile setup).
  const p = me.profile || {};
  return {
    session: {
      serverId: me.id || null,
      phone: me.phone || null,
      verified: true,
      ageConfirmed: !!me.ageConfirmed,
      termsAcceptedAt: me.termsAcceptedAt || null,
      onboarded: !!me.onboarded,
      status: me.status || 'active',
    },
    profile: {
      ...initialState.profile,
      id: 'me',
      name: p.name || '',
      bio: p.bio || '',
      avatarSeed: p.avatarSeed || me.id || 'me-irl',
      avatarKey: p.avatarKey || null,
      avatarUri: p.avatarUrl || null,
      city: p.city || '',
      area: p.area || '',
      interests: p.interests || [],
      intents: p.intents || [],
      visibility: p.visibility || 'discoverable',
      boundaries: p.boundaries || '',
      pronouns: p.pronouns || '',
      languages: p.languages || [],
      availabilityWindows: p.availabilityWindows || [],
      reliability: p.reliability ?? null,
    },
  };
}
function mapProgress(p = {}, prev = {}) {
  return {
    ...prev,
    xp: p.xp ?? 0,
    level: p.level || null,
    completedActivities: p.completedActivities ?? 0,
    peopleMet: p.peopleMet ?? 0,
    hosted: p.hosted ?? 0,
    showUpRate: p.showUpRate ?? 1,
    weeklyGoal: p.weeklyGoal ?? 2,
    weeklyDone: p.weeklyDone ?? 0,
    streakWeeks: p.streakWeeks ?? 0,
    freezesLeft: p.freezesLeft ?? 0,
    categoryCounts: p.categoryCounts || {},
    week: p.week || [],
  };
}

// Debounced PATCH helpers so typing in forms doesn't spam the API.
function debounced(fn, ms = 600) {
  let t = null;
  let acc = {};
  return (patch) => {
    acc = { ...acc, ...patch };
    clearTimeout(t);
    t = setTimeout(() => {
      const body = acc;
      acc = {};
      fn(body).catch(() => {});
    }, ms);
  };
}
const pushProfile = debounced((body) => E.me.update(body));
const pushPrefs = debounced((body) => E.me.updatePreferences(body));

let otp = { phone: null, session: null };

export const useAppStore = create(
  persist(
    (set, get) => {
      // Runs an async loader with status/error bookkeeping.
      const run = async (key, fn, { silent = false } = {}) => {
        if (!silent) set((s) => ({ status: { ...s.status, [key]: 'loading' }, errors: { ...s.errors, [key]: null } }));
        try {
          const r = await fn();
          set((s) => ({ status: { ...s.status, [key]: 'ready' } }));
          return r;
        } catch (e) {
          set((s) => ({ status: { ...s.status, [key]: 'error' }, errors: { ...s.errors, [key]: e.message || 'Something went wrong' } }));
          if (e.code === 'account_restricted') set((s) => ({ session: { ...s.session, status: 'limited' } }));
          if (e.code === 'maintenance') set({ service: { status: 'maintenance' } });
          throw e;
        }
      };
      const quiet = (p) => p.catch(() => null);

      const discoveryCoords = async () => {
        const { prefs, profile } = get();
        if (prefs.location === 'granted') {
          const c = (await getCoarsePosition()) || prefs.coords;
          if (c && (!prefs.coords || c.latitude !== prefs.coords.latitude || c.longitude !== prefs.coords.longitude)) {
            set((s) => ({ prefs: { ...s.prefs, coords: c } }));
          }
          if (c) return c;
        }
        return areaCentroids[profile.area] || CITY_CENTER;
      };

      const handleRealtime = (raw) => {
        const evt = mapIncoming(raw);
        const d = evt.data || {};
        switch (evt.type) {
          case 'message.created': {
            const m = d.message || d;
            const cid = m.conversationId || d.conversationId;
            set((s) => {
              const list = s.messages[cid] || [];
              if (list.some((x) => x.id === m.id)) return {};
              return {
                messages: { ...s.messages, [cid]: [...list.filter((x) => !(x.pending && x.senderId === 'me' && x.body === m.body)), m] },
                conversations: s.conversations.map((c) =>
                  c.id === cid ? { ...c, lastMessage: m, unread: m.senderId === 'me' ? c.unread : (c.unread || 0) + 1 } : c
                ),
              };
            });
            if (!get().conversations.some((c) => c.id === cid)) quiet(get().loadConversations({ silent: true }));
            break;
          }
          case 'join.updated': {
            const { activityId, state: js } = d;
            set((s) => ({ joinStates: { ...s.joinStates, [activityId]: js } }));
            quiet(get().loadActivity(activityId, { silent: true }));
            if (js === 'accepted') quiet(get().loadConversations({ silent: true }));
            break;
          }
          case 'activity.updated':
            if (d.activity) set((s) => upsertActivities(s, [d.activity]));
            break;
          case 'notification.created':
            if (d.notification || d.id) {
              const n = d.notification || d;
              set((s) => ({ notifications: [n, ...s.notifications.filter((x) => x.id !== n.id)], unread: { ...s.unread, notifications: s.unread.notifications + 1 } }));
            }
            break;
          case 'progress.updated':
            set((s) => ({ progress: mapProgress(d.progress || d, s.progress) }));
            break;
          default:
        }
      };

      return {
        ...initialState,

        // ---------- boot / session ----------
        initSession: async () => {
          if (!isConfigured()) {
            set({ boot: { ready: true, configured: false, offline: false } });
            return;
          }
          await loadSession();
          setSelfId(get().session.serverId || null); // cached id so offline reads still map to 'me'
          if (!hasSession()) {
            set((s) => ({ boot: { ...s.boot, ready: true, configured: true }, session: { ...initialState.session } }));
            return;
          }
          try {
            await get().bootstrap();
            set((s) => ({ boot: { ...s.boot, ready: true, configured: true, offline: false } }));
          } catch (e) {
            // Offline/unreachable: keep the cached snapshot and let screens retry.
            set((s) => ({ boot: { ...s.boot, ready: true, configured: true, offline: e.code === 'network' || e.code === 'timeout' } }));
          }
        },
        bootstrap: async () => {
          const r = await run('bootstrap', () => E.me.bootstrap());
          setSelfId(r.me?.id || null);
          applyTaxonomy({ categories: r.categories, levels: r.levels, city: r.city });
          const m = mapMe(r.me);
          set((s) => ({
            ...m,
            prefs: { ...s.prefs, ...(r.me?.prefs || {}), coords: s.prefs.coords, haptics: s.prefs.haptics, sound: s.prefs.sound },
            availability: r.me?.availability || s.availability,
            progress: mapProgress(r.progress, s.progress),
            unread: r.unread || s.unread,
            subscription: r.subscription || s.subscription,
            service: r.service || { status: 'ok' },
          }));
          realtime.start(handleRealtime);
          realtime.subscribe(`user:${r.me?.id}:notifications`);
          if (get().prefs.notifications.enabled) quiet(get().enablePush());
          return r;
        },
        // Registers this device for FCM/APNs push (after the user opted in).
        enablePush: async () => {
          // eslint-disable-next-line global-require
          const { registerForPush } = require('@/services/push');
          // eslint-disable-next-line global-require
          const { navigateFromNotification } = require('@/navigation/navigationRef');
          const r = await registerForPush({
            onForegroundMessage: (msg) => {
              const n = msg?.data?.notification ? JSON.parse(msg.data.notification) : null;
              if (n) get().addNotification(mapIncoming(n));
            },
            onOpen: (msg) => {
              const target = msg?.data?.target ? JSON.parse(msg.data.target) : null;
              if (target) navigateFromNotification(target);
            },
          });
          set((s) => ({ prefs: { ...s.prefs, notifications: { ...s.prefs.notifications, enabled: r.enabled } } }));
          return r;
        },
        requestOtp: async (phone) => {
          try {
            const r = await startPhoneSignIn(phone);
            otp = { phone, session: r.session };
            set((s) => ({ session: { ...s.session, phone } }));
            return { sent: true, retryAfterSec: 30 };
          } catch (e) {
            if (['TooManyRequestsException', 'LimitExceededException'].includes(e.code)) e.code = 'otp_rate_limited';
            throw e;
          }
        },
        verifyOtp: async (code) => {
          try {
            const tokens = await answerOtp(otp.phone, otp.session, code);
            await saveSession(tokens);
          } catch (e) {
            if (e.session) otp.session = e.session;
            if (e.code === 'CodeMismatchException') e.code = 'otp_invalid';
            else if (['NotAuthorizedException', 'TooManyFailedAttemptsException'].includes(e.code)) e.code = 'otp_locked';
            throw e;
          }
          otp = { phone: otp.phone, session: null };
          await get().bootstrap();
          return { isNewUser: !get().session.onboarded };
        },
        confirmAge: async () => {
          await E.me.update({ ageConfirmed: true, termsAccepted: true });
          set((s) => ({ session: { ...s.session, ageConfirmed: true, termsAcceptedAt: nowIso() } }));
        },
        completeOnboarding: () => {
          set((s) => ({ session: { ...s.session, onboarded: true } }));
          quiet(E.me.update({ onboardingCompleted: true }));
        },
        logout: async () => {
          realtime.stop();
          try {
            // eslint-disable-next-line global-require
            await require('@/services/push').unregisterPush();
          } catch (e) {
            // ignore
          }
          await clearSession();
          setSelfId(null);
          set({ ...initialState, boot: { ready: true, configured: isConfigured(), offline: false }, prefs: { ...initialPrefs, haptics: get().prefs.haptics } });
        },
        deleteAccount: async () => {
          await E.me.remove();
          await get().logout();
          await AsyncStorage.removeItem('irl-store');
        },

        // ---------- profile & prefs ----------
        setProfile: (patch) => {
          set((s) => ({ profile: { ...s.profile, ...patch } }));
          const { avatarUri, avatarSeed, id, ...server } = patch; // avatarUri is a display URL; avatarKey is what the server stores
          if (avatarSeed) server.avatarSeed = avatarSeed;
          if (Object.keys(server).length) pushProfile(server);
        },
        toggleInterest: (slug) => {
          const has = get().profile.interests.includes(slug);
          get().setProfile({ interests: has ? get().profile.interests.filter((x) => x !== slug) : [...get().profile.interests, slug] });
        },
        setPrefs: (patch) => {
          set((s) => ({ prefs: { ...s.prefs, ...patch } }));
          const server = Object.fromEntries(Object.entries(patch).filter(([k]) => !DEVICE_ONLY_PREFS.has(k)));
          if (Object.keys(server).length) pushPrefs(server);
        },
        setNotificationPrefs: (patch) => {
          const notifications = { ...get().prefs.notifications, ...patch };
          set((s) => ({ prefs: { ...s.prefs, notifications } }));
          pushPrefs({ notifications });
        },
        // Optimistic; resolves with the server value, rolls back and rethrows on failure.
        setAvailability: async (patch) => {
          const prev = get().availability;
          const next = { ...prev, ...patch };
          set({ availability: next });
          try {
            const saved = await E.me.setAvailability(next);
            if (saved && typeof saved === 'object' && saved.status) set({ availability: saved });
            return saved;
          } catch (e) {
            set({ availability: prev });
            throw e;
          }
        },
        setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
        resetFilters: () => set({ filters: { ...initialState.filters } }),
        loadPublicProfile: (userId) =>
          run(`user:${userId}`, async () => {
            const u = await E.users.publicProfile(userId);
            set((s) => ({ users: mergeUsers(s.users, [u]), ...upsertActivities(s, u.upcomingPlans || []) }));
            return u;
          }),

        // ---------- discovery ----------
        // Options: center {latitude, longitude} (map panning), radiusKm, categories
        // override the saved filters for this query only.
        loadFeed: ({ more = false, silent = false, center, radiusKm, categories } = {}) =>
          run(
            'feed',
            async () => {
              const coords = center || (await discoveryCoords());
              const f = get().filters;
              const cats = categories || f.categories;
              const params = {
                lat: coords.latitude,
                lng: coords.longitude,
                radius: (radiusKm || f.distanceKm || get().prefs.radiusKm) * 1000,
                category: cats?.length ? cats : undefined,
                when: f.when !== 'any' ? f.when : undefined,
                groupSize: f.groupSize !== 'any' ? f.groupSize : undefined,
                level: f.level !== 'any' ? f.level : undefined,
                accessible: f.accessible || undefined,
                freeOnly: f.freeOnly || undefined,
                cursor: more ? get().feedCursor : undefined,
              };
              const [list, featured] = await Promise.all([E.discovery.activities(params), more ? null : quiet(E.discovery.featured({ lat: params.lat, lng: params.lng }))]);
              const items = itemsOf(list);
              const feat = featured ? itemsOf(featured)[0] || featured.activity || (featured.id ? featured : null) : null;
              set((s) => ({
                ...upsertActivities(s, feat ? [feat, ...items] : items),
                feedIds: more ? [...s.feedIds, ...items.map((a) => a.id)] : items.map((a) => a.id),
                featuredId: feat?.id ?? (more ? s.featuredId : null),
                feedCursor: list?.nextCursor || null,
              }));
              return items;
            },
            { silent }
          ),
        loadActivity: (id, { silent = false } = {}) =>
          run(
            `activity:${id}`,
            async () => {
              const a = await E.discovery.activity(id);
              set((s) => upsertActivities(s, [a]));
              realtime.subscribe(`activity:${id}`);
              return a;
            },
            { silent }
          ),
        loadMyActivities: (tab) =>
          run(`my:${tab}`, async () => {
            const items = itemsOf(await E.me.activities(tab));
            set((s) => ({ ...upsertActivities(s, items), myActivities: { ...s.myActivities, [tab]: items.map((a) => a.id) } }));
            return items;
          }),
        loadNearbyPeople: () =>
          run('nearbyPeople', async () => {
            const c = await discoveryCoords();
            const items = itemsOf(await E.discovery.nearbyPeople({ lat: c.latitude, lng: c.longitude, radius: get().prefs.radiusKm * 1000 }));
            set((s) => ({ users: mergeUsers(s.users, items), nearbyPeopleIds: items.map((u) => u.id) }));
            return items;
          }),
        loadCategories: () =>
          run('categories', async () => {
            const cats = itemsOf(await E.discovery.categories());
            applyTaxonomy({ categories: cats });
            return cats;
          }),
        search: async (q) => {
          const c = await discoveryCoords();
          const r = await E.discovery.search(q, { lat: c.latitude, lng: c.longitude });
          set((s) => ({ ...upsertActivities(s, r.activities || []), users: mergeUsers(s.users, r.people || []) }));
          return { activities: r.activities || [], people: r.people || [], venues: r.venues || [] };
        },
        askGuide: async (prompt) => {
          const coords = await discoveryCoords();
          const r = await suggest(prompt, { coords, radiusKm: get().prefs.radiusKm });
          if (r.activities?.length) set((s) => upsertActivities(s, r.activities));
          return r;
        },

        // ---------- plans ----------
        requestJoin: async (activityId, intro = '') => {
          set((s) => ({ joinStates: { ...s.joinStates, [activityId]: 'requested' }, joinIntros: { ...s.joinIntros, [activityId]: intro } }));
          try {
            const r = await E.activities.requestJoin(activityId, intro);
            const st = r.state || 'requested';
            set((s) => ({ joinStates: { ...s.joinStates, [activityId]: st } }));
            if (r.activity) set((s) => upsertActivities(s, [r.activity]));
            if (st === 'accepted') quiet(get().loadConversations({ silent: true }));
            realtime.subscribe(`activity:${activityId}`);
            return st;
          } catch (e) {
            set((s) => {
              const joinStates = { ...s.joinStates };
              delete joinStates[activityId];
              return { joinStates };
            });
            throw e;
          }
        },
        cancelJoin: async (activityId) => {
          const prev = get().joinStates[activityId];
          set((s) => ({ joinStates: { ...s.joinStates, [activityId]: 'cancelled' } }));
          try {
            await E.activities.cancelJoin(activityId);
            quiet(get().loadActivity(activityId, { silent: true }));
          } catch (e) {
            set((s) => ({ joinStates: { ...s.joinStates, [activityId]: prev } }));
            throw e;
          }
        },
        checkIn: async (activityId, method = 'manual', coords = null) => {
          await E.activities.checkIn(activityId, { method, lat: coords?.latitude, lng: coords?.longitude, accuracy: coords?.accuracy });
          set((s) => ({ joinStates: { ...s.joinStates, [activityId]: 'checked_in' } }));
        },
        // Server decides XP (mutual confirmation, dedupe, daily cap).
        confirmCompletion: async (activityId) => {
          const before = levelFor(get().progress.xp);
          const r = await E.activities.confirmCompletion(activityId);
          set((s) => ({
            completionAwards: { ...s.completionAwards, [activityId]: r.xpAwarded || 0 },
            joinStates: { ...s.joinStates, [activityId]: r.state || 'completed' },
            progress: r.progress ? mapProgress(r.progress, s.progress) : s.progress,
          }));
          if (!r.progress) quiet(get().loadProgress());
          quiet(get().loadQuests());
          const after = levelFor(get().progress.xp);
          return { xpAwarded: r.xpAwarded || 0, duplicate: !!r.duplicate, pendingOthers: !!r.pendingOthers, leveledUp: r.leveledUp ?? after.level > before.level, level: after };
        },
        submitFeedback: async (activityId, payload) => {
          await E.activities.feedback(activityId, payload);
          set((s) => ({ feedback: { ...s.feedback, [activityId]: { ...payload, at: nowIso() } } }));
        },
        loadJoinRequests: (activityId) => run(`joinRequests:${activityId}`, async () => itemsOf(await E.activities.joinRequests(activityId))),
        decideJoinRequest: async (activityId, requestId, accept) => {
          await (accept ? E.activities.acceptJoin(activityId, requestId) : E.activities.declineJoin(activityId, requestId));
          quiet(get().loadActivity(activityId, { silent: true }));
        },

        // ---------- create ----------
        updateDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
        resetDraft: () => set({ draft: { ...initialDraft, area: get().profile.area } }),
        publishDraft: async () => {
          const d = get().draft;
          const body = {
            title: d.title,
            category: d.category,
            description: d.description,
            tags: d.tags,
            startsAt: d.startsAt || new Date(Date.now() + 15 * 60000).toISOString(),
            durationMin: d.durationMin,
            capacity: d.capacity,
            area: d.area || get().profile.area,
            venueName: d.venueName,
            venueType: d.venueType,
            joinRule: d.joinRule,
            visibility: d.audience === 'everyone' ? 'public' : d.audience === 'circle' ? 'circle' : 'invite_only',
            circleId: d.audience === 'circle' ? d.circleId : undefined,
            level: d.level,
            ageRange: d.ageRange,
            cost: d.cost,
            accessibility: d.accessibility,
          };
          const a = await E.activities.create(body, d.clientKey || `create:${d.startsAt}:${d.title}`);
          set((s) => ({ ...upsertActivities(s, [a]), draft: { ...initialDraft, area: s.profile.area } }));
          quiet(get().loadConversations({ silent: true }));
          return get().activities.find((x) => x.id === a.id) || a;
        },
        cancelHostedActivity: async (activityId, reason) => {
          const a = await E.activities.cancel(activityId, reason);
          set((s) => upsertActivities(s, [a?.id ? a : { ...s.activities.find((x) => x.id === activityId), status: 'cancelled' }]));
        },

        // ---------- progress ----------
        loadProgress: () =>
          run('progress', async () => {
            const p = await E.me.progress();
            set((s) => ({ progress: mapProgress(p, s.progress) }));
            return p;
          }),
        loadQuests: () =>
          run('quests', async () => {
            const items = itemsOf(await E.quests.list());
            set({ quests: items });
            return items;
          }),
        loadMilestones: () =>
          run('milestones', async () => {
            const items = itemsOf(await E.me.milestones());
            set({ milestones: items });
            return items;
          }),
        loadAchievements: () =>
          run('achievements', async () => {
            const items = itemsOf(await E.me.achievements());
            set({ achievements: items });
            return items;
          }),
        loadStreakCalendar: (months = 3) =>
          run('streakCalendar', async () => {
            const r = await E.me.streakCalendar(months);
            set({ streakCalendar: r });
            return r;
          }),
        claimQuest: async (questId) => {
          const q = get().quests.find((x) => x.id === questId);
          if (!q || q.state !== 'completed') return 0;
          const r = await E.quests.claim(questId);
          set((s) => ({
            quests: s.quests.map((x) => (x.id === questId ? { ...x, state: 'claimed' } : x)),
            progress: r.progress ? mapProgress(r.progress, s.progress) : { ...s.progress, xp: s.progress.xp + (r.xpAwarded ?? q.xp) },
          }));
          return r.xpAwarded ?? q.xp;
        },
        applyStreakFreeze: async () => {
          const r = await E.me.streakFreeze();
          set((s) => ({ progress: mapProgress(r.progress || r, s.progress) }));
        },
        markLevelSeen: (level) => set((s) => ({ progress: { ...s.progress, lastLevelSeen: level } })),

        // ---------- messaging ----------
        loadConversations: ({ silent = false } = {}) =>
          run(
            'conversations',
            async () => {
              const items = itemsOf(await E.messaging.conversations());
              set({ conversations: items, unread: { ...get().unread, messages: items.reduce((n, c) => n + (c.unread || 0), 0) } });
              return items;
            },
            { silent }
          ),
        loadMessages: (conversationId) =>
          run(`messages:${conversationId}`, async () => {
            const r = await E.messaging.messages(conversationId, { limit: 50 });
            const items = itemsOf(r).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            set((s) => ({ messages: { ...s.messages, [conversationId]: items }, users: mergeUsers(s.users, r.users || []) }));
            realtime.subscribe(`conversation:${conversationId}`);
            return items;
          }),
        sendMessage: async (conversationId, body) => {
          const tmp = { id: tempId('m'), senderId: 'me', body, createdAt: nowIso(), pending: true };
          set((s) => ({ messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] || []), tmp] } }));
          try {
            const m = await E.messaging.send(conversationId, body, tmp.id);
            set((s) => {
              const list = (s.messages[conversationId] || []).filter((x) => x.id !== tmp.id && x.id !== m.id);
              return { messages: { ...s.messages, [conversationId]: [...list, m] } };
            });
          } catch (e) {
            set((s) => ({ messages: { ...s.messages, [conversationId]: (s.messages[conversationId] || []).map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) } }));
            throw e;
          }
        },
        // Removes a local (pending/failed) message, e.g. before a retry.
        dropMessage: (conversationId, messageId) =>
          set((s) => ({ messages: { ...s.messages, [conversationId]: (s.messages[conversationId] || []).filter((m) => m.id !== messageId) } })),
        markConversationRead: (conversationId) => {
          set((s) => ({ conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)) }));
          quiet(E.messaging.read(conversationId));
        },
        toggleMute: (conversationId) => {
          const c = get().conversations.find((x) => x.id === conversationId);
          const muted = !c?.muted;
          set((s) => ({ conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, muted } : x)) }));
          quiet(E.messaging.mute(conversationId, muted));
        },
        removeConversation: async (conversationId) => {
          await E.messaging.remove(conversationId);
          realtime.unsubscribe(`conversation:${conversationId}`);
          set((s) => {
            const { [conversationId]: _drop, ...messages } = s.messages;
            return { conversations: s.conversations.filter((c) => c.id !== conversationId), messages };
          });
        },
        // Returns the conversation id (server enforces that a shared accepted plan exists).
        startDirectConversation: async (userId) => {
          const existing = get().conversations.find((c) => c.kind === 'direct' && c.memberIds.includes(userId));
          if (existing) return existing.id;
          const c = await E.messaging.start({ kind: 'direct', userId });
          set((s) => ({ conversations: [c, ...s.conversations.filter((x) => x.id !== c.id)] }));
          return c.id;
        },

        // ---------- circles ----------
        loadCircles: (params) =>
          run('circles', async () => {
            const items = itemsOf(await E.circles.list(params));
            set((s) => {
              const byId = new Map(s.circles.map((c) => [c.id, c]));
              items.forEach((c) => byId.set(c.id, { ...(byId.get(c.id) || {}), ...c }));
              const circles = Array.from(byId.values());
              return { circles, joinedCircles: circles.filter((c) => c.myRole).map((c) => c.id) };
            });
            return items;
          }),
        loadCircle: (id) =>
          run(`circle:${id}`, async () => {
            const c = await E.circles.get(id);
            set((s) => ({
              circles: [c, ...s.circles.filter((x) => x.id !== id)],
              joinedCircles: c.myRole ? Array.from(new Set([...s.joinedCircles, id])) : s.joinedCircles.filter((x) => x !== id),
              ...upsertActivities(s, c.upcomingPlans || []),
            }));
            return c;
          }),
        loadCircleMembers: (id) =>
          run(`circleMembers:${id}`, async () => {
            const items = itemsOf(await E.circles.members(id));
            set((s) => ({ users: mergeUsers(s.users, items), circleMembers: { ...s.circleMembers, [id]: items } }));
            return items;
          }),
        loadCircleChallenge: (id) =>
          run(`circleChallenge:${id}`, async () => {
            const ch = await E.circles.challenge(id);
            set((s) => ({ circleChallenges: { ...s.circleChallenges, [id]: ch } }));
            return ch;
          }),
        joinCircle: async (circleId) => {
          set((s) => ({ joinedCircles: Array.from(new Set([...s.joinedCircles, circleId])) }));
          try {
            await E.circles.join(circleId);
            quiet(get().loadCircle(circleId));
          } catch (e) {
            set((s) => ({ joinedCircles: s.joinedCircles.filter((c) => c !== circleId) }));
            throw e;
          }
        },
        leaveCircle: async (circleId) => {
          set((s) => ({ joinedCircles: s.joinedCircles.filter((c) => c !== circleId) }));
          await E.circles.leave(circleId);
        },
        createCircle: async (payload) => {
          const c = await E.circles.create(payload);
          set((s) => ({ circles: [c, ...s.circles], joinedCircles: [c.id, ...s.joinedCircles] }));
          return c;
        },
        removeCircleMember: async (circleId, userId) => {
          await E.circles.removeMember(circleId, userId);
          set((s) => ({
            circles: s.circles.map((c) => (c.id === circleId ? { ...c, memberSeeds: (c.memberSeeds || []).filter((u) => u !== userId), members: Math.max(1, (c.members || 1) - 1) } : c)),
            circleMembers: { ...s.circleMembers, [circleId]: (s.circleMembers[circleId] || []).filter((m) => m.id !== userId) },
          }));
        },
        joinCircleChallenge: async (circleId) => {
          const ch = await E.circles.joinChallenge(circleId);
          set((s) => ({ circleChallenges: { ...s.circleChallenges, [circleId]: ch?.id ? ch : { ...(s.circleChallenges[circleId] || {}), joined: true, joinedAt: nowIso() } } }));
        },

        // ---------- safety (never paywalled) ----------
        loadSafety: () =>
          run('safety', async () => {
            const [blocks, reports, contacts] = await Promise.all([E.me.blocks(), E.me.reports(), E.safety.trustedContacts()]);
            const blockedUsers = itemsOf(blocks);
            set((s) => ({
              blocked: blockedUsers.map((b) => b.id || b.userId),
              users: mergeUsers(s.users, blockedUsers.filter((b) => b.id)),
              reports: itemsOf(reports),
              trustedContacts: itemsOf(contacts),
            }));
          }),
        blockUser: async (userId) => {
          await E.safety.block(userId);
          set((s) => ({
            blocked: s.blocked.includes(userId) ? s.blocked : [...s.blocked, userId],
            conversations: s.conversations.filter((c) => !(c.kind === 'direct' && c.memberIds.includes(userId))),
            nearbyPeopleIds: s.nearbyPeopleIds.filter((id) => id !== userId),
          }));
        },
        unblockUser: async (userId) => {
          await E.safety.unblock(userId);
          set((s) => ({ blocked: s.blocked.filter((b) => b !== userId) }));
        },
        submitReport: async (payload) => {
          const r = await E.safety.report(payload);
          set((s) => ({ reports: [{ id: r.id, status: r.status || 'open', createdAt: nowIso(), ...payload, ...r }, ...s.reports] }));
          return r;
        },
        addTrustedContact: async (contact) => {
          const r = await E.safety.inviteTrustedContact(contact);
          set((s) => ({ trustedContacts: [...s.trustedContacts, { ...contact, ...r, id: r.id || tempId('tc') }] }));
        },
        removeTrustedContact: async (contactId) => {
          await E.safety.removeTrustedContact(contactId);
          set((s) => ({ trustedContacts: s.trustedContacts.filter((c) => c.id !== contactId) }));
        },

        // ---------- SplitMate (ledger only — no custody) ----------
        loadExpenses: () =>
          run('expenses', async () => {
            const items = itemsOf(await E.expenses.list());
            set({ expenses: items });
            return items;
          }),
        loadExpense: (id) =>
          run(`expense:${id}`, async () => {
            const e = await E.expenses.get(id);
            set((s) => ({ expenses: [e, ...s.expenses.filter((x) => x.id !== id)] }));
            return e;
          }),
        addExpense: async (expense) => {
          const e = await E.expenses.create(expense, `expense:${expense.clientId || `${expense.description}:${expense.totalMinor}`}`);
          set((s) => ({ expenses: [e, ...s.expenses.filter((x) => x.id !== e.id)] }));
          return e;
        },
        setShareState: async (expenseId, userId, state, paymentReference) => {
          const prev = get().expenses.find((e) => e.id === expenseId);
          set((s) => ({
            expenses: s.expenses.map((e) =>
              e.id === expenseId ? { ...e, shares: e.shares.map((sh) => (sh.userId === userId ? { ...sh, state, paymentReference: paymentReference ?? sh.paymentReference } : sh)) } : e
            ),
          }));
          try {
            const e = await E.expenses.updateShare(expenseId, userId, { state, paymentReference });
            if (e?.id) set((s) => ({ expenses: s.expenses.map((x) => (x.id === e.id ? e : x)) }));
          } catch (err) {
            set((s) => ({ expenses: s.expenses.map((x) => (x.id === expenseId ? prev : x)) }));
            throw err;
          }
        },

        // ---------- notifications ----------
        loadNotifications: () =>
          run('notifications', async () => {
            const items = itemsOf(await E.notifications.list());
            set({ notifications: items, unread: { ...get().unread, notifications: items.filter((n) => !n.read).length } });
            return items;
          }),
        markNotificationRead: (nid) => {
          set((s) => ({ notifications: s.notifications.map((n) => (n.id === nid ? { ...n, read: true } : n)), unread: { ...s.unread, notifications: Math.max(0, s.unread.notifications - 1) } }));
          quiet(E.notifications.read(nid));
        },
        markAllNotificationsRead: () => {
          set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), unread: { ...s.unread, notifications: 0 } }));
          quiet(E.notifications.readAll());
        },
        addNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications.filter((x) => x.id !== n.id)] })),

        // ---------- monetisation ----------
        loadSubscription: () =>
          run('subscription', async () => {
            const sub = await E.me.subscription();
            set({ subscription: sub });
            return sub;
          }),
        setSubscription: (patch) => set((s) => ({ subscription: { ...s.subscription, ...patch } })),
      };
    },
    {
      name: 'irl-store',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // Device-local prefs + draft + a small offline snapshot. No tokens (Keychain).
      partialize: (s) => ({
        session: { onboarded: s.session.onboarded, ageConfirmed: s.session.ageConfirmed, verified: s.session.verified, serverId: s.session.serverId },
        profile: s.profile,
        prefs: s.prefs,
        filters: s.filters,
        draft: s.draft,
        progress: { ...s.progress, lastLevelSeen: s.progress.lastLevelSeen },
      }),
      merge: (persisted, current) => {
        const p = persisted || {};
        return {
          ...current,
          ...p,
          session: { ...current.session, ...(p.session || {}) },
          prefs: { ...current.prefs, ...(p.prefs || {}), notifications: { ...current.prefs.notifications, ...(p.prefs?.notifications || {}) } },
          progress: { ...current.progress, ...(p.progress || {}) },
        };
      },
      migrate: () => ({}), // v1 held demo data — discard it.
    }
  )
);

// Live user cache for '@/data/catalog' personById.
setUserSource(() => useAppStore.getState().users);
onSignedOut(() => {
  realtime.stop();
  setSelfId(null);
  useAppStore.setState({ session: { ...initialState.session } });
});

// ---------- selectors / pure helpers ----------
export function levelFor(xp) {
  const L = levelTable.length ? levelTable : [{ level: 1, name: 'Newcomer', xp: 0 }];
  let cur = L[0];
  for (const l of L) if (xp >= l.xp) cur = l;
  const next = L.find((l) => l.level === cur.level + 1);
  const span = next ? next.xp - cur.xp : 1;
  return { ...cur, next, into: xp - cur.xp, span, ratio: next ? (xp - cur.xp) / span : 1 };
}

export const selectUnreadCount = (s) => (s.status.notifications === 'ready' ? s.notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0) : s.unread.notifications);
export const selectUnreadMessages = (s) => (s.status.conversations === 'ready' ? s.conversations.reduce((n, c) => n + (c.unread || 0), 0) : s.unread.messages);
export const selectStatus = (key) => (s) => s.status[key] || 'idle';
export const selectError = (key) => (s) => s.errors[key] || null;

export default useAppStore;
