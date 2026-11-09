'use strict';
// Profile, preferences, bootstrap, account deletion, data export, public
// profiles, notifications inbox, push devices and media upload URLs.
// Mongo port of legacy/src/handlers/profile.js (13 routes).
const crypto = require('crypto');
const { err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { audit } = require('../lib/audit');
const ent = require('../lib/entitlements');
const media = require('../lib/media');
const { enforce } = require('../lib/rateLimit');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const S = require('../services/progress');
const { SOCIAL_STYLES } = require('../lib/socialMatch');

const DEFAULT_CITY = () => process.env.DEFAULT_CITY || 'Ahmedabad';
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCI = (s) => new RegExp(`^${escapeRe(s)}$`, 'i');

const PROFILE_FIELDS = {
  name: { type: 'string', min: 1, max: 40 },
  displayName: { type: 'string', min: 1, max: 40 },
  bio: { type: 'string', max: 240 },
  avatarKey: { type: 'string', max: 200, nullable: true },
  city: { type: 'string', max: 60 },
  area: { type: 'string', max: 60 },
  interests: { type: 'array', max: 12, unique: true, items: { type: 'string', format: 'slug' } },
  intents: { type: 'array', max: 6, unique: true, items: { type: 'string', max: 40 } },
  visibility: { type: 'string', enum: ['discoverable', 'friends_only', 'hidden'] },
  boundaries: { type: 'string', max: 240 },
  pronouns: { type: 'string', max: 30 },
  languages: { type: 'array', max: 8, items: { type: 'string', max: 30 } },
  avatarSeed: { type: 'string', max: 40 }, // illustrated-avatar choice when no photo is uploaded
  availabilityWindows: { type: 'array', max: 8, unique: true, items: { type: 'string', max: 30 } },
  socialStyle: { type: 'string', enum: SOCIAL_STYLES, nullable: true }, // null clears it
  ageConfirmed: { type: 'boolean' },
  termsAccepted: { type: 'boolean' },
  onboardingCompleted: { type: 'boolean' },
};

// Profile fields that require (or create) a profile. Flag-only patches (age gate,
// terms) arrive before profile setup during onboarding and must not require a name.
const PROFILE_KEYS = ['avatarKey', 'bio', 'city', 'area', 'interests', 'intents', 'visibility', 'boundaries', 'languages', 'pronouns', 'avatarSeed', 'availabilityWindows', 'socialStyle', 'onboardingCompleted'];
const PROFILE_MAP = { avatarKey: 'avatarKey', bio: 'bio', city: 'homeCity', area: 'homeArea', interests: 'interests', intents: 'intents', visibility: 'visibility', boundaries: 'boundaries', languages: 'languages', socialStyle: 'socialStyle' };

function availabilityOut(av) {
  const a = av || {};
  const expired = a.until && new Date(a.until) < new Date();
  return { status: !a.status || expired ? 'busy' : a.status, activities: a.activitySlugs || [], until: a.until || null, area: a.area || null };
}

async function loadMe(userId) {
  const { User, Subscription } = require('../models');
  const u = await User.findById(userId).lean();
  if (!u) throw err.notFound('user_not_found');
  const p = u.profile || null;
  const prefs = (p && p.preferences) || {};
  const np = u.notificationPrefs || {};
  const qh = np.quietHours || { start: '22:00', end: '08:00' };
  const prog = u.progress || {};
  const [ents, sub, avatarUrl] = await Promise.all([
    ent.getActive(userId),
    Subscription.findOne({ userId }).sort({ createdAt: -1 }).select('store status expiresAt').lean(),
    p ? P.avatarUrl(p.avatarKey) : null,
  ]);
  const onboarded = !!(p && p.displayName && u.ageVerified && prefs.onboardedAt);
  return {
    id: u._id,
    phone: u.phone,
    ageConfirmed: !!u.ageVerified,
    onboarded,
    status: u.status,
    statusReason: u.status === 'active' ? null : u.statusReason || null,
    statusUntil: u.statusUntil || null,
    memberSince: u.createdAt,
    session: {
      ageConfirmed: !!u.ageVerified,
      termsAcceptedAt: u.termsAcceptedAt || null,
      onboarded,
      hasProfile: !!(p && p.displayName),
    },
    profile:
      p && p.displayName
        ? {
            id: u._id,
            name: p.displayName,
            bio: p.bio || '',
            avatarKey: p.avatarKey || null,
            avatarUrl,
            city: p.homeCity || null,
            area: p.homeArea || null,
            interests: p.interests || [],
            intents: p.intents || [],
            visibility: p.visibility || 'discoverable',
            boundaries: p.boundaries || '',
            pronouns: prefs.pronouns || '',
            avatarSeed: prefs.avatarSeed || null,
            availabilityWindows: prefs.availabilityWindows || [],
            languages: p.languages || [],
            socialStyle: p.socialStyle || null,
            reliability: P.publicReliability(p.reliabilityScore == null ? 1 : p.reliabilityScore),
          }
        : null,
    prefs: {
      radiusKm: prefs.radiusKm || 3,
      showOnRadar: prefs.showOnRadar !== false,
      analyticsConsent: !!prefs.analyticsConsent,
      dailyStreakOptIn: !!prog.dailyStreakOptIn,
      language: prefs.language || 'English',
      notifications: {
        nearby: np.nearbyActivities ?? true,
        joinRequests: np.joinRequests ?? true,
        messages: np.messages ?? true,
        questReminders: np.questReminders ?? false,
        productUpdates: np.productUpdates ?? false,
        quietEnabled: qh.start !== qh.end,
        quietStart: qh.start,
        quietEnd: qh.end,
      },
    },
    availability: availabilityOut(u.availability),
    subscription: P.subscription(ents, sub),
  };
}

// Unread messages across the caller's open conversations (system messages count; own messages don't).
async function unreadMessages(userId) {
  const { ConversationMember, Message } = require('../models');
  const members = await ConversationMember.find({ userId, leftAt: null }).select('conversationId lastReadAt joinedAt').lean();
  if (!members.length) return 0;
  const or = members.map((m) => ({ conversationId: m.conversationId, createdAt: { $gt: m.lastReadAt || m.joinedAt || new Date(0) } }));
  return Message.countDocuments({ deletedAt: null, senderUserId: { $ne: userId }, $or: or });
}

async function cityFor(profileCity) {
  const { CityArea } = require('../models');
  const find = (name) => CityArea.find({ active: true, city: exactCI(name) }).sort({ name: 1 }).lean();
  let city = profileCity || DEFAULT_CITY();
  let areas = await find(city);
  if (!areas.length && city.toLowerCase() !== DEFAULT_CITY().toLowerCase()) {
    city = DEFAULT_CITY();
    areas = await find(city);
  }
  const pts = areas.map((a) => ({ name: a.name, lat: a.centroid.coordinates[1], lng: a.centroid.coordinates[0] }));
  const avg = (k) => (pts.length ? Math.round((pts.reduce((s, a) => s + a[k], 0) / pts.length) * 1e5) / 1e5 : null);
  return { name: city, center: { lat: avg('lat'), lng: avg('lng') }, areas: pts };
}

// Activities `viewerId` may see from `hostId` (public, circles the viewer is in, or plans they're part of).
async function upcomingHostedPlans(hostId, viewerId) {
  const { Activity, CircleMember, Participant } = require('../models');
  const [myCircles, myParts] = await Promise.all([
    CircleMember.find({ userId: viewerId }).select('circleId').lean(),
    Participant.find({ userId: viewerId }).select('activityId').lean(),
  ]);
  const docs = await Activity.find({
    hostUserId: hostId,
    status: { $in: ['open', 'full'] },
    endsAt: { $gt: new Date() },
    $or: [{ visibility: 'public' }, { hostUserId: viewerId }, { visibility: 'circle', circleId: { $in: myCircles.map((c) => c.circleId) } }, { _id: { $in: myParts.map((x) => x.activityId) } }],
  })
    .sort({ startsAt: 1 })
    .limit(5)
    .lean();
  if (!docs.length) return [];
  // Activity presentation (hydrated host/participants/viewer state) lives with the activities port.
  const A = require('../services/activities');
  return A.presentMany(docs, viewerId);
}

const routes = {
  'GET /v1/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    return loadMe(user.id);
  },

  // Every active city with its areas, for the city/area picker and for
  // matching a location fix to the nearest city on the device.
  'GET /v1/cities': async (req) => {
    await requireUser(req, { allowSuspended: true });
    const { CityArea } = require('../models');
    const rows = await CityArea.find({ active: true }).select('city name centroid').sort({ city: 1, name: 1 }).lean();
    const byCity = new Map();
    for (const r of rows) {
      if (!r.centroid || !Array.isArray(r.centroid.coordinates)) continue;
      const list = byCity.get(r.city) || [];
      list.push({ name: r.name, lat: r.centroid.coordinates[1], lng: r.centroid.coordinates[0] });
      byCity.set(r.city, list);
    }
    const round = (v) => Math.round(v * 1e5) / 1e5;
    const items = [...byCity.entries()].map(([name, areas]) => ({
      name,
      center: { lat: round(areas.reduce((x, a) => x + a.lat, 0) / areas.length), lng: round(areas.reduce((x, a) => x + a.lng, 0) / areas.length) },
      areas,
    }));
    return { items };
  },

  'GET /v1/me/bootstrap': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Category, Level, Notification } = require('../models');
    const [me, categories, levels, progress, unreadN, unreadM] = await Promise.all([
      loadMe(user.id),
      Category.find({ isActive: true, riskLevel: { $ne: 'restricted' } }).sort({ sortOrder: 1, label: 1 }).lean(),
      Level.find({}).sort({ level: 1 }).lean(),
      S.progressFor(user.id),
      Notification.countDocuments({ userId: user.id, readAt: null }),
      unreadMessages(user.id),
    ]);
    const city = await cityFor(me.profile && me.profile.city);
    return {
      me,
      city,
      service: { status: process.env.MAINTENANCE_MODE === 'true' ? 'maintenance' : 'ok' },
      subscription: me.subscription,
      categories: categories.map(P.category),
      levels: levels.map((l) => ({ level: l.level, name: l.name, xp: l.xpThreshold, subtitle: l.subtitle || null, pictogram: l.pictogram || null })),
      progress: S.stripStats(progress),
      unread: { notifications: unreadN, messages: unreadM },
      serverTime: new Date().toISOString(),
    };
  },

  'PATCH /v1/me': async (req) => {
    const user = await requireUser(req);
    const { User, Category } = require('../models');
    const v = check(PROFILE_FIELDS, req.body);
    const name = v.name || v.displayName;
    if (v.avatarKey && !media.isOwnedKey(v.avatarKey, 'avatar', user.id)) throw err.badRequest('invalid_avatar_key');
    if (v.interests && v.interests.length) {
      const known = await Category.countDocuments({ isActive: true, slug: { $in: v.interests } });
      if (known !== v.interests.length) throw err.badRequest('unknown_interest');
    }
    await db.withTransaction(async (session) => {
      const u = await User.findById(user.id).select('ageVerifiedAt ageVerificationMethod termsAcceptedAt profile').session(session).lean();
      if (!u) throw err.notFound('user_not_found');
      const now = new Date();
      const set = {};
      if (v.ageConfirmed === true) {
        // Self-declared 18+ with terms acknowledgement (age_gate). No date of birth is stored.
        set.ageVerified = true;
        if (!u.ageVerifiedAt) set.ageVerifiedAt = now;
        if (!u.ageVerificationMethod) set.ageVerificationMethod = 'self_declared_18plus';
        await audit({ actorUserId: user.id, action: 'user.age_confirmed', targetType: 'user', targetId: user.id, ip: req.ip }, { session });
      }
      if (v.termsAccepted === true && !u.termsAcceptedAt) set.termsAcceptedAt = now;

      const hasProfile = !!(u.profile && u.profile.displayName);
      const writesProfile = !!name || PROFILE_KEYS.some((k) => v[k] !== undefined);
      let profileExists = hasProfile;
      if (!hasProfile && writesProfile) {
        if (!name) throw err.badRequest('name_required', 'Add your name to create a profile');
        set.profile = {
          displayName: name,
          avatarKey: v.avatarKey || null,
          bio: v.bio || null,
          homeCity: v.city || null,
          homeArea: v.area || null,
          interests: v.interests || [],
          intents: v.intents || [],
          visibility: v.visibility || 'discoverable',
          boundaries: v.boundaries || null,
          languages: v.languages || [],
          socialStyle: v.socialStyle || null,
          reliabilityScore: 1,
          preferences: {},
          createdAt: now,
          updatedAt: now,
        };
        profileExists = true;
      } else if (hasProfile) {
        if (name) set['profile.displayName'] = name;
        for (const [k, path] of Object.entries(PROFILE_MAP)) if (v[k] !== undefined) set[`profile.${path}`] = v[k];
      }
      if (profileExists) {
        const prefPatch = {};
        if (v.pronouns !== undefined) prefPatch.pronouns = v.pronouns;
        if (v.avatarSeed !== undefined) prefPatch.avatarSeed = v.avatarSeed;
        if (v.availabilityWindows !== undefined) prefPatch.availabilityWindows = v.availabilityWindows;
        if (v.onboardingCompleted === true) prefPatch.onboardedAt = now.toISOString();
        if (set.profile) Object.assign(set.profile.preferences, prefPatch);
        else for (const [k, val] of Object.entries(prefPatch)) set[`profile.preferences.${k}`] = val;
        if (!set.profile && Object.keys(set).some((k) => k.startsWith('profile.'))) set['profile.updatedAt'] = now;
      }
      if (Object.keys(set).length) await User.updateOne({ _id: user.id }, { $set: set }, { session });
    });
    return loadMe(user.id);
  },

  'GET /v1/users/{userId}/public-profile': async (req) => {
    const user = await requireUser(req);
    const { User, Block, Participant, UserAchievement, Achievement, CircleMember, Circle } = require('../models');
    const targetId = String(req.params.userId);
    const [target, blocked] = await Promise.all([
      User.findOne({ _id: targetId, status: { $in: ['active', 'limited'] }, 'profile.displayName': { $type: 'string' } }).lean(),
      Block.exists({ $or: [{ blockerUserId: user.id, blockedUserId: targetId }, { blockerUserId: targetId, blockedUserId: user.id }] }),
    ]);
    if (!target || blocked || (target.profile.visibility === 'hidden' && target._id !== user.id)) throw err.notFound('user_not_found');

    const [completed, earned, theirCircles, myCircles, upcomingPlans] = await Promise.all([
      Participant.countDocuments({ userId: targetId, state: 'completed' }),
      UserAchievement.find({ userId: targetId }).sort({ earnedAt: -1 }).limit(12).lean(),
      CircleMember.find({ userId: targetId }).select('circleId').lean(),
      CircleMember.find({ userId: user.id }).select('circleId').lean(),
      upcomingHostedPlans(targetId, user.id),
    ]);
    const defs = earned.length ? await Achievement.find({ _id: { $in: earned.map((e) => e.achievementId) } }).lean() : [];
    const defById = new Map(defs.map((a) => [a._id, a]));
    const badges = earned
      .filter((e) => defById.has(e.achievementId))
      .map((e) => {
        const a = defById.get(e.achievementId);
        return { id: a.slug, title: a.title, pictogram: a.pictogram, color: a.color, earnedAt: e.earnedAt };
      });
    const mine = new Set(myCircles.map((c) => c.circleId));
    const sharedIds = theirCircles.map((c) => c.circleId).filter((id) => mine.has(id));
    const activeShared = sharedIds.length ? await Circle.find({ _id: { $in: sharedIds }, status: 'active' }).select('_id').lean() : [];

    // PublicUser + bio/badges. No phone, exact location or raw ratings — ever.
    return {
      ...(await P.publicUser(target, { completed })),
      avatarSeed: (target.profile.preferences && target.profile.preferences.avatarSeed) || target._id,
      bio: target.profile.bio || '',
      memberSince: target.createdAt,
      verification: { phone: true },
      badges,
      sharedCircleIds: activeShared.map((c) => c._id),
      upcomingPlans,
    };
  },

  'PATCH /v1/me/preferences': async (req) => {
    const user = await requireUser(req);
    const { User } = require('../models');
    const v = check(
      {
        notifications: {
          type: 'object',
          fields: {
            nearby: { type: 'boolean' },
            joinRequests: { type: 'boolean' },
            messages: { type: 'boolean' },
            questReminders: { type: 'boolean' },
            productUpdates: { type: 'boolean' },
            quietEnabled: { type: 'boolean' },
            quietStart: { type: 'string', format: 'hhmm' },
            quietEnd: { type: 'string', format: 'hhmm' },
          },
        },
        radiusKm: { type: 'number', min: 1, max: 25 },
        showOnRadar: { type: 'boolean' },
        dailyStreakOptIn: { type: 'boolean' },
        analyticsConsent: { type: 'boolean' },
        weeklyGoal: { type: 'integer', min: 1, max: 14 },
        language: { type: 'string', max: 20 },
      },
      req.body
    );
    const u = await User.findById(user.id).select('profile.displayName notificationPrefs').lean();
    const set = {};
    const n = v.notifications;
    if (n) {
      const map = { productUpdates: 'productUpdates', nearby: 'nearbyActivities', joinRequests: 'joinRequests', messages: 'messages', questReminders: 'questReminders' };
      for (const [k, path] of Object.entries(map)) if (n[k] !== undefined) set[`notificationPrefs.${path}`] = n[k];
      const qh = (u && u.notificationPrefs && u.notificationPrefs.quietHours) || { start: '22:00', end: '08:00' };
      // quietEnabled=false is stored as an empty window (start == end), as in legacy.
      const start = n.quietEnabled === false ? '00:00' : n.quietStart ?? qh.start;
      const end = n.quietEnabled === false ? '00:00' : n.quietEnd ?? qh.end;
      if (n.quietEnabled !== undefined || n.quietStart !== undefined || n.quietEnd !== undefined) set['notificationPrefs.quietHours'] = { start, end };
    }
    const hasProfile = !!(u && u.profile && u.profile.displayName);
    let prefsTouched = false;
    for (const k of ['radiusKm', 'showOnRadar', 'analyticsConsent', 'language']) {
      if (v[k] !== undefined && hasProfile) {
        set[`profile.preferences.${k}`] = v[k];
        prefsTouched = true;
      }
    }
    if (prefsTouched) set['profile.updatedAt'] = new Date();
    if (v.dailyStreakOptIn !== undefined) set['progress.dailyStreakOptIn'] = v.dailyStreakOptIn;
    if (v.weeklyGoal !== undefined) set['progress.weeklyGoal'] = v.weeklyGoal;
    if (v.dailyStreakOptIn !== undefined || v.weeklyGoal !== undefined) set['progress.updatedAt'] = new Date();
    if (v.showOnRadar === false) set['availability.status'] = 'busy';
    if (Object.keys(set).length) await User.updateOne({ _id: user.id }, { $set: set });
    return loadMe(user.id);
  },

  // PUT /v1/me/availability lives in handlers/discovery.js (next to GET /availability/nearby).

  // DPDP-style deletion: immediate deactivation, sessions revoked, purge after 30 days (jobs retention).
  'DELETE /v1/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { User, Activity, Participant, DeviceToken } = require('../models');
    const purgeAfter = new Date(Date.now() + 30 * 86400000);
    await db.withTransaction(async (session) => {
      const now = new Date();
      await User.updateOne({ _id: user.id }, { $set: { status: 'deleted', deletedAt: now, purgeAfter, 'availability.status': 'busy' } }, { session });
      await User.updateOne({ _id: user.id, 'profile.displayName': { $type: 'string' } }, { $set: { 'profile.visibility': 'hidden' } }, { session });
      await Activity.updateMany(
        { hostUserId: user.id, status: { $in: ['open', 'full', 'draft'] } },
        { $set: { status: 'cancelled', cancelledAt: now, cancelReason: 'host_deleted_account' } },
        { session }
      );
      // Leave other people's plans, keeping their denormalised counters in step.
      const parts = await Participant.find({ userId: user.id, state: { $in: ['requested', 'accepted', 'waitlisted'] } }).session(session).lean();
      for (const p of parts) {
        if (p.state === 'accepted') {
          await Activity.updateOne({ _id: p.activityId, acceptedCount: { $gt: 0 } }, { $inc: { acceptedCount: -1 } }, { session });
          await Activity.updateOne({ _id: p.activityId, status: 'full', $expr: { $lt: ['$acceptedCount', '$capacity'] } }, { $set: { status: 'open' } }, { session });
        } else if (p.state === 'waitlisted') {
          await Activity.updateOne({ _id: p.activityId, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } }, { session });
        }
      }
      if (parts.length) await Participant.updateMany({ _id: { $in: parts.map((p) => p._id) } }, { $set: { state: 'cancelled', decidedAt: now } }, { session });
      await DeviceToken.deleteMany({ userId: user.id }, { session });
      await audit({ actorUserId: user.id, action: 'user.delete_requested', targetType: 'user', targetId: user.id, ip: req.ip }, { session });
    });
    // Replaces the Cognito global sign-out: every refresh token for this user is revoked.
    await require('../lib/tokens').revokeAllForUser(user.id, 'account_deleted').catch(() => {});
    return { status: 'deletion_pending', purgeAfter: purgeAfter.toISOString() };
  },

  // DPDP right to access: a JSON copy of the caller's own data via a 24-hour private link.
  'POST /v1/me/data-export': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    await enforce('data_export', user.id);
    if (!media.isConfigured()) throw err.unavailable('media_not_configured');
    const M = require('../models');
    const uid = user.id;
    const [me, parts, messages, memberships, reports, blocks, contacts, expenses, notifications, xp, subs, audits] = await Promise.all([
      loadMe(uid),
      M.Participant.find({ userId: uid }).lean(),
      M.Message.find({ senderUserId: uid }).sort({ createdAt: -1 }).select('conversationId body mediaKey createdAt deletedAt').lean(),
      M.CircleMember.find({ userId: uid }).lean(),
      M.Report.find({ reporterUserId: uid }).sort({ createdAt: -1 }).select('reasonCode details status createdAt').lean(),
      M.Block.find({ blockerUserId: uid }).select('blockedUserId createdAt').lean(),
      M.TrustedContact.find({ userId: uid }).select('name phone status createdAt').lean(),
      M.Expense.find({ 'shares.userId': uid }).sort({ createdAt: -1 }).lean(),
      M.Notification.find({ userId: uid }).sort({ createdAt: -1 }).select('type title body createdAt readAt').lean(),
      M.XpEvent.find({ userId: uid }).sort({ createdAt: -1 }).select('eventType xpDelta activityId createdAt').lean(),
      M.Subscription.find({ userId: uid }).select('store productId status startedAt expiresAt').lean(),
      M.AuditEvent.find({ actorUserId: uid }).sort({ createdAt: -1 }).limit(1000).select('action targetType targetId createdAt').lean(),
    ]);
    const [acts, circles] = await Promise.all([
      parts.length ? M.Activity.find({ _id: { $in: parts.map((p) => p.activityId) } }).select('title startsAt coarseArea hostUserId').lean() : [],
      memberships.length ? M.Circle.find({ _id: { $in: memberships.map((m) => m.circleId) } }).select('name').lean() : [],
    ]);
    const actById = new Map(acts.map((a) => [a._id, a]));
    const circleById = new Map(circles.map((c) => [c._id, c]));
    const strip = ({ _id, ...rest }) => ({ id: _id, ...rest });
    const exportDoc = {
      generatedAt: new Date().toISOString(),
      notice: 'Your Come Over data. Other people’s personal data is excluded. Reports filed about you are not included to protect reporters.',
      account: me,
      plans: parts
        .filter((p) => actById.has(p.activityId))
        .map((p) => {
          const a = actById.get(p.activityId);
          return { id: a._id, title: a.title, startsAt: a.startsAt, area: a.coarseArea, state: p.state, hosted: a.hostUserId === uid, requestedAt: p.requestedAt, checkedInAt: p.checkedInAt, completionConfirmedAt: p.completionConfirmedAt };
        })
        .sort((x, y) => new Date(y.startsAt) - new Date(x.startsAt)),
      messagesSent: messages.map(strip),
      circles: memberships.map((m) => ({ id: m.circleId, name: (circleById.get(m.circleId) || {}).name || null, role: m.role, joinedAt: m.joinedAt })),
      reportsFiled: reports.map(strip),
      blocks: blocks.map(({ blockedUserId, createdAt }) => ({ blockedUserId, createdAt })),
      trustedContacts: contacts.map(({ name, phone, status, createdAt }) => ({ name, phone, status, createdAt })),
      expenseShares: expenses.map((e) => {
        const s = (e.shares || []).find((x) => x.userId === uid) || {};
        return { id: e._id, description: e.description, totalMinor: e.totalMinor, splitMethod: e.splitMethod, createdAt: e.createdAt, amountMinor: s.amountMinor, state: s.state };
      }),
      notifications: notifications.map(({ _id, ...rest }) => rest),
      xpEvents: xp.map(({ _id, ...rest }) => rest),
      subscriptions: subs.map(({ _id, ...rest }) => rest),
      activityLog: audits.map(({ _id, ...rest }) => rest),
    };
    const key = `export/${uid}/${crypto.randomUUID()}.json`;
    await media.putObject(key, JSON.stringify(exportDoc, null, 2), 'application/json');
    const url = await media.signedGet(key, 86400);
    await audit({ actorUserId: uid, action: 'user.data_export', targetType: 'user', targetId: uid, ip: req.ip });
    return { status: 'ready', url, expiresAt: new Date(Date.now() + 86400000).toISOString(), format: 'json' };
  },

  'GET /v1/notifications': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Notification } = require('../models');
    const p = pageParams(req.query, { def: 30, max: 100 });
    const rows = await Notification.find({ userId: user.id }).sort({ createdAt: -1, _id: -1 }).skip(p.offset).limit(p.fetchLimit).lean();
    return pageOf(rows, p, P.notification);
  },

  'POST /v1/notifications/read-all': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Notification } = require('../models');
    const r = await Notification.updateMany({ userId: user.id, readAt: null }, { $set: { readAt: new Date() } });
    return { updated: r.modifiedCount || 0 };
  },

  'POST /v1/notifications/{notificationId}/read': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { Notification } = require('../models');
    const n = await Notification.findOne({ _id: String(req.params.notificationId), userId: user.id }).select('readAt').lean();
    if (!n) throw err.notFound('notification_not_found');
    if (!n.readAt) await Notification.updateOne({ _id: n._id, readAt: null }, { $set: { readAt: new Date() } });
    return { ok: true };
  },

  'POST /v1/devices': async (req) => {
    const user = await requireUser(req);
    const { DeviceToken } = require('../models');
    const v = check({ platform: { type: 'string', required: true, enum: ['ios', 'android'] }, token: { type: 'string', required: true, min: 20, max: 4096 } }, req.body);
    try {
      await DeviceToken.updateOne({ token: v.token }, { $set: { userId: user.id, platform: v.platform } }, { upsert: true });
    } catch (e) {
      if (!e || e.code !== 11000) throw e;
      await DeviceToken.updateOne({ token: v.token }, { $set: { userId: user.id, platform: v.platform } });
    }
    return { ok: true };
  },

  'DELETE /v1/devices/{token}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const { DeviceToken } = require('../models');
    await DeviceToken.deleteOne({ userId: user.id, token: String(req.params.token) });
    return { ok: true };
  },

  'POST /v1/media/upload-url': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        kind: { type: 'string', required: true, enum: Object.keys(media.KINDS).filter((k) => k !== 'export') },
        contentType: { type: 'string', required: true, max: 60 },
        sizeBytes: { type: 'integer', required: true, min: 1 },
      },
      req.body
    );
    await enforce('media_upload', user.id);
    return media.createUpload({ userId: user.id, ...v });
  },
};

module.exports = { routes, loadMe, availabilityOut, unreadMessages, cityFor };
