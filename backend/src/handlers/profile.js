'use strict';
// Profile, preferences, bootstrap, account deletion, public profiles,
// notifications inbox, push devices and media upload URLs.
const { createRouter, err } = require('../lib/http');
const { check } = require('../lib/validate');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { audit } = require('../lib/audit');
const ent = require('../lib/entitlements');
const media = require('../lib/media');
const { enforce } = require('../lib/rateLimit');
const { cognito } = require('../lib/aws');
const { pageParams, pageOf } = require('../lib/page');
const P = require('../lib/present');
const S = require('../services/progress');
const A = require('../services/activities');
const { s3 } = require('../lib/aws');

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
  ageConfirmed: { type: 'boolean' },
  termsAccepted: { type: 'boolean' },
  onboardingCompleted: { type: 'boolean' },
};

async function loadMe(userId) {
  const row = await db.one(
    `SELECT u.id, u.phone_e164, u.status, u.status_reason, u.status_until, u.age_verified, u.terms_accepted_at, u.created_at,
            p.user_id AS has_profile, p.display_name, p.avatar_key, p.bio, p.home_city, p.home_area, p.interests, p.intents, p.visibility,
            p.boundaries, p.languages, p.reliability_score, p.preferences,
            np.product_updates, np.nearby_activities, np.join_requests, np.messages, np.quest_reminders, np.quiet_hours,
            up.daily_streak_opt_in,
            av.status AS av_status, av.activity_slugs AS av_activities, av.available_until AS av_until, av.area AS av_area
       FROM app_users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN user_progress up ON up.user_id = u.id
       LEFT JOIN availability_status av ON av.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  const prefs = row.preferences || {};
  const [ents, sub] = await Promise.all([
    ent.getActive(db, userId),
    db.one("SELECT store, status, expires_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]),
  ]);
  const availExpired = row.av_until && new Date(row.av_until) < new Date();
  const qh = row.quiet_hours || { start: '22:00', end: '08:00' };
  const onboarded = !!(row.has_profile && row.age_verified && prefs.onboardedAt);
  return {
    id: row.id,
    phone: row.phone_e164,
    ageConfirmed: row.age_verified,
    onboarded,
    status: row.status,
    statusReason: row.status === 'active' ? null : row.status_reason,
    statusUntil: row.status_until,
    memberSince: row.created_at,
    session: {
      ageConfirmed: row.age_verified,
      termsAcceptedAt: row.terms_accepted_at,
      onboarded,
      hasProfile: !!row.has_profile,
    },
    profile: row.has_profile
      ? {
          id: row.id,
          name: row.display_name,
          bio: row.bio || '',
          avatarKey: row.avatar_key,
          avatarUrl: await P.avatarUrl(row.avatar_key),
          city: row.home_city,
          area: row.home_area,
          interests: row.interests,
          intents: row.intents,
          visibility: row.visibility,
          boundaries: row.boundaries || '',
          pronouns: prefs.pronouns || '',
          avatarSeed: prefs.avatarSeed || null,
          availabilityWindows: prefs.availabilityWindows || [],
          languages: row.languages,
          reliability: P.publicReliability(row.reliability_score),
        }
      : null,
    prefs: {
      radiusKm: prefs.radiusKm || 3,
      showOnRadar: prefs.showOnRadar !== false,
      analyticsConsent: !!prefs.analyticsConsent,
      dailyStreakOptIn: !!row.daily_streak_opt_in,
      language: prefs.language || 'English',
      notifications: {
        nearby: row.nearby_activities ?? true,
        joinRequests: row.join_requests ?? true,
        messages: row.messages ?? true,
        questReminders: row.quest_reminders ?? false,
        productUpdates: row.product_updates ?? false,
        quietEnabled: qh.start !== qh.end,
        quietStart: qh.start,
        quietEnd: qh.end,
      },
    },
    availability: { status: !row.av_status || availExpired ? 'busy' : row.av_status, activities: row.av_activities || [], until: row.av_until || null, area: row.av_area || null },
    subscription: P.subscription(ents, sub),
  };
}

const routes = {
  'GET /v1/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    return loadMe(user.id);
  },

  'GET /v1/me/bootstrap': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const [me, categories, levels, progress, unreadN, unreadM] = await Promise.all([
      loadMe(user.id),
      db.many("SELECT slug, label, short, pictogram, risk_level FROM activity_categories WHERE is_active AND risk_level <> 'restricted' ORDER BY sort_order, label"),
      db.many('SELECT level, name, xp_threshold, subtitle, pictogram FROM levels ORDER BY level'),
      S.progressFor(db, user.id),
      db.one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id]),
      db.one(
        `SELECT COALESCE(sum((SELECT count(*) FROM messages x WHERE x.conversation_id = cm.conversation_id AND x.deleted_at IS NULL
                   AND x.created_at > COALESCE(cm.last_read_at, cm.joined_at) AND (x.sender_user_id IS NULL OR x.sender_user_id <> $1))), 0)::int AS n
           FROM conversation_members cm WHERE cm.user_id = $1 AND cm.left_at IS NULL`,
        [user.id]
      ),
    ]);
    const { _stats, ...prog } = progress;
    const cityName = (me.profile && me.profile.city) || process.env.DEFAULT_CITY || 'Ahmedabad';
    let areas = await db.many('SELECT name, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM city_areas WHERE active AND lower(city) = lower($1) ORDER BY name', [cityName]);
    let city = cityName;
    if (!areas.length && cityName !== (process.env.DEFAULT_CITY || 'Ahmedabad')) {
      city = process.env.DEFAULT_CITY || 'Ahmedabad';
      areas = await db.many('SELECT name, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM city_areas WHERE active AND lower(city) = lower($1) ORDER BY name', [city]);
    }
    const avg = (k) => (areas.length ? Math.round((areas.reduce((s, a) => s + a[k], 0) / areas.length) * 1e5) / 1e5 : null);
    return {
      me,
      city: { name: city, center: { lat: avg('lat'), lng: avg('lng') }, areas: areas.map((a) => ({ name: a.name, lat: a.lat, lng: a.lng })) },
      service: { status: process.env.MAINTENANCE_MODE === 'true' ? 'maintenance' : 'ok' },
      subscription: me.subscription,
      categories: categories.map(P.category),
      levels: levels.map((l) => ({ level: l.level, name: l.name, xp: l.xp_threshold, subtitle: l.subtitle, pictogram: l.pictogram })),
      progress: prog,
      unread: { notifications: unreadN.n, messages: unreadM.n },
      serverTime: new Date().toISOString(),
    };
  },

  'PATCH /v1/me': async (req) => {
    const user = await requireUser(req);
    const v = check(PROFILE_FIELDS, req.body);
    const name = v.name || v.displayName;
    if (v.avatarKey && !media.isOwnedKey(v.avatarKey, 'avatar', user.id)) throw err.badRequest('invalid_avatar_key');
    if (v.interests) {
      const known = await db.many('SELECT slug FROM activity_categories WHERE is_active AND slug = ANY($1)', [v.interests]);
      if (known.length !== v.interests.length) throw err.badRequest('unknown_interest');
    }
    await db.withTransaction(async (client) => {
      if (v.ageConfirmed === true) {
        // Self-declared 18+ with terms acknowledgement (age_gate). No date of birth is stored.
        await client.query(
          "UPDATE app_users SET age_verified = TRUE, age_verified_at = COALESCE(age_verified_at, now()), age_verification_method = COALESCE(age_verification_method, 'self_declared_18plus') WHERE id = $1",
          [user.id]
        );
        await audit(client, { actorUserId: user.id, action: 'user.age_confirmed', targetType: 'user', targetId: user.id, ip: req.ip });
      }
      if (v.termsAccepted === true) await client.query('UPDATE app_users SET terms_accepted_at = COALESCE(terms_accepted_at, now()) WHERE id = $1', [user.id]);

      const { rowCount } = await client.query('SELECT 1 FROM profiles WHERE user_id = $1', [user.id]);
      // Flag-only updates (age gate, terms) arrive before profile setup during
      // onboarding, so only require a name when profile fields are being written.
      const PROFILE_KEYS = ['avatarKey', 'bio', 'city', 'area', 'interests', 'intents', 'visibility', 'boundaries', 'languages', 'pronouns', 'avatarSeed', 'availabilityWindows', 'onboardingCompleted'];
      const writesProfile = !!name || PROFILE_KEYS.some((k) => v[k] !== undefined);
      if (!rowCount && writesProfile) {
        if (!name) throw err.badRequest('name_required', 'Add your name to create a profile');
        await client.query(
          `INSERT INTO profiles (user_id, display_name, avatar_key, bio, home_city, home_area, interests, intents, visibility, boundaries, languages)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'discoverable'), $10, $11)`,
          [user.id, name, v.avatarKey || null, v.bio || null, v.city || null, v.area || null, v.interests || [], v.intents || [], v.visibility || null, v.boundaries || null, v.languages || []]
        );
        await client.query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        await client.query('INSERT INTO user_progress (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      } else if (rowCount) {
        const map = { avatarKey: 'avatar_key', bio: 'bio', city: 'home_city', area: 'home_area', interests: 'interests', intents: 'intents', visibility: 'visibility', boundaries: 'boundaries', languages: 'languages' };
        const sets = [];
        const vals = [user.id];
        if (name) {
          vals.push(name);
          sets.push(`display_name = $${vals.length}`);
        }
        for (const [k, col] of Object.entries(map)) {
          if (v[k] !== undefined) {
            vals.push(v[k]);
            sets.push(`${col} = $${vals.length}`);
          }
        }
        if (sets.length) await client.query(`UPDATE profiles SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1`, vals);
      }
      const prefPatch = {};
      if (v.pronouns !== undefined) prefPatch.pronouns = v.pronouns;
      if (v.avatarSeed !== undefined) prefPatch.avatarSeed = v.avatarSeed;
      if (v.availabilityWindows !== undefined) prefPatch.availabilityWindows = v.availabilityWindows;
      if (v.onboardingCompleted === true) prefPatch.onboardedAt = new Date().toISOString();
      if (Object.keys(prefPatch).length) await client.query('UPDATE profiles SET preferences = preferences || $2::jsonb WHERE user_id = $1', [user.id, JSON.stringify(prefPatch)]);
    });
    return loadMe(user.id);
  },

  'GET /v1/users/{userId}/public-profile': async (req) => {
    const user = await requireUser(req);
    const row = await db.one(
      `SELECT u.id, u.created_at, p.display_name, p.avatar_key, p.bio, p.interests, p.home_area AS area, p.reliability_score, p.visibility,
              COALESCE(up.level, 1) AS level, av.status AS availability_status, av.activity_slugs,
              (SELECT count(*)::int FROM activity_participants ap WHERE ap.user_id = u.id AND ap.state = 'completed') AS completed
         FROM app_users u JOIN profiles p ON p.user_id = u.id LEFT JOIN user_progress up ON up.user_id = u.id
         LEFT JOIN availability_status av ON av.user_id = u.id AND (av.available_until IS NULL OR av.available_until > now())
        WHERE u.id = $1 AND u.status IN ('active','limited')
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = $2 AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = $2))`,
      [req.params.userId, user.id]
    );
    if (!row || (row.visibility === 'hidden' && row.id !== user.id)) throw err.notFound('user_not_found');
    const badges = await db.many(
      'SELECT a.slug AS id, a.title, a.pictogram, a.color, ua.earned_at AS "earnedAt" FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC LIMIT 12',
      [row.id]
    );
    const [shared, upcoming] = await Promise.all([
      db.many('SELECT a.circle_id FROM circle_members a JOIN circle_members b ON b.circle_id = a.circle_id AND b.user_id = $2 JOIN circles c ON c.id = a.circle_id AND c.status = $3 WHERE a.user_id = $1', [row.id, user.id, 'active']),
      db.many(
        `${A.SELECT} WHERE a.host_user_id = $2 AND a.status IN ('open','full') AND a.ends_at > now() AND ${A.VISIBLE_TO_VIEWER} AND ${A.NOT_BLOCKED} ORDER BY a.starts_at LIMIT 5`,
        [user.id, row.id]
      ),
    ]);
    // PublicUser + bio/badges. No phone, exact location or raw ratings — ever.
    return {
      ...(await P.publicUser(row)),
      avatarSeed: row.id,
      bio: row.bio || '',
      memberSince: row.created_at,
      verification: { phone: true },
      badges,
      sharedCircleIds: shared.map((s) => s.circle_id),
      upcomingPlans: upcoming.map((r) => A.present(r, { viewerId: user.id })),
    };
  },

  'PATCH /v1/me/preferences': async (req) => {
    const user = await requireUser(req);
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
    await db.withTransaction(async (client) => {
      const n = v.notifications;
      if (n) {
        await client.query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        const quietStart = n.quietEnabled === false ? '00:00' : n.quietStart ?? null;
        const quietEnd = n.quietEnabled === false ? '00:00' : n.quietEnd ?? null;
        await client.query(
          `UPDATE notification_preferences SET
             product_updates = COALESCE($2, product_updates), nearby_activities = COALESCE($3, nearby_activities),
             join_requests = COALESCE($4, join_requests), messages = COALESCE($5, messages), quest_reminders = COALESCE($6, quest_reminders),
             quiet_hours = jsonb_build_object('start', COALESCE($7, quiet_hours->>'start'), 'end', COALESCE($8, quiet_hours->>'end'))
           WHERE user_id = $1`,
          [user.id, n.productUpdates ?? null, n.nearby ?? null, n.joinRequests ?? null, n.messages ?? null, n.questReminders ?? null, quietStart, quietEnd]
        );
      }
      const prefs = {};
      for (const k of ['radiusKm', 'showOnRadar', 'analyticsConsent', 'language']) if (v[k] !== undefined) prefs[k] = v[k];
      if (Object.keys(prefs).length) await client.query('UPDATE profiles SET preferences = preferences || $2::jsonb, updated_at = now() WHERE user_id = $1', [user.id, JSON.stringify(prefs)]);
      if (v.dailyStreakOptIn !== undefined || v.weeklyGoal !== undefined) {
        await client.query('INSERT INTO user_progress (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        await client.query('UPDATE user_progress SET daily_streak_opt_in = COALESCE($2, daily_streak_opt_in), weekly_goal = COALESCE($3, weekly_goal), updated_at = now() WHERE user_id = $1', [
          user.id,
          v.dailyStreakOptIn ?? null,
          v.weeklyGoal ?? null,
        ]);
      }
      if (v.showOnRadar === false) await client.query("UPDATE availability_status SET status = 'busy' WHERE user_id = $1", [user.id]);
    });
    return loadMe(user.id);
  },

  // DPDP-style deletion: immediate deactivation, sessions revoked, purge after 30 days (jobs.retention).
  'DELETE /v1/me': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const purgeAfter = new Date(Date.now() + 30 * 86400000).toISOString();
    await db.withTransaction(async (client) => {
      await client.query("UPDATE app_users SET status = 'deleted', deleted_at = now(), purge_after = $2 WHERE id = $1", [user.id, purgeAfter]);
      await client.query("UPDATE profiles SET visibility = 'hidden' WHERE user_id = $1", [user.id]);
      await client.query("UPDATE availability_status SET status = 'busy' WHERE user_id = $1", [user.id]);
      await client.query("UPDATE activities SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'host_deleted_account' WHERE host_user_id = $1 AND status IN ('open','full','draft')", [user.id]);
      await client.query("UPDATE activity_participants SET state = 'cancelled' WHERE user_id = $1 AND state IN ('requested','accepted','waitlisted')", [user.id]);
      await client.query('DELETE FROM device_tokens WHERE user_id = $1', [user.id]);
      await audit(client, { actorUserId: user.id, action: 'user.delete_requested', targetType: 'user', targetId: user.id, ip: req.ip });
    });
    if (process.env.USER_POOL_ID) {
      const { AdminUserGlobalSignOutCommand, AdminDisableUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
      await cognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: process.env.USER_POOL_ID, Username: user.sub })).catch(() => {});
      await cognito().send(new AdminDisableUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: user.sub })).catch(() => {});
    }
    return { status: 'deletion_pending', purgeAfter };
  },

  // DPDP right to access: a JSON copy of the caller's own data via a 24-hour private link.
  'POST /v1/me/data-export': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    await enforce(db, 'data_export', user.id);
    const Bucket = process.env.MEDIA_BUCKET;
    if (!Bucket) throw err.unavailable('media_not_configured');
    const q = (sql) => db.many(sql, [user.id]);
    const [me, participations, messages, circles, reports, blocks, contacts, expenses, notifications, xp, subs, audits] = await Promise.all([
      loadMe(user.id),
      q(`SELECT a.id, a.title, a.starts_at, a.coarse_area, p.state, (a.host_user_id = p.user_id) AS hosted, p.requested_at, p.checked_in_at, p.completion_confirmed_at
           FROM activity_participants p JOIN activities a ON a.id = p.activity_id WHERE p.user_id = $1 ORDER BY a.starts_at DESC`),
      q('SELECT id, conversation_id, body, media_key, created_at, deleted_at FROM messages WHERE sender_user_id = $1 ORDER BY created_at DESC'),
      q('SELECT c.id, c.name, m.role, m.joined_at FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = $1'),
      q('SELECT id, reason_code, details, status, created_at FROM reports WHERE reporter_user_id = $1 ORDER BY created_at DESC'),
      q('SELECT blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = $1'),
      q('SELECT name, phone_e164, status, created_at FROM trusted_contacts WHERE user_id = $1'),
      q(`SELECT e.id, e.description, e.total_minor, e.split_method, e.created_at, s.amount_minor, s.state
           FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE s.user_id = $1 ORDER BY e.created_at DESC`),
      q('SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC'),
      q('SELECT event_type, xp_delta, activity_id, created_at FROM xp_events WHERE user_id = $1 ORDER BY created_at DESC'),
      q('SELECT store, product_id, status, started_at, expires_at FROM subscriptions WHERE user_id = $1'),
      q('SELECT action, target_type, target_id, created_at FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at DESC LIMIT 1000'),
    ]);
    const exportDoc = {
      generatedAt: new Date().toISOString(),
      notice: 'Your Project IRL data. Other people’s personal data is excluded. Reports filed about you are not included to protect reporters.',
      account: me,
      plans: participations,
      messagesSent: messages,
      circles,
      reportsFiled: reports,
      blocks,
      trustedContacts: contacts,
      expenseShares: expenses,
      notifications,
      xpEvents: xp,
      subscriptions: subs,
      activityLog: audits,
    };
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const key = `export/${user.id}/${require('crypto').randomUUID()}.json`;
    await s3().send(new PutObjectCommand({ Bucket, Key: key, Body: JSON.stringify(exportDoc, null, 2), ContentType: 'application/json', ServerSideEncryption: 'AES256' }));
    const url = await media.signedGet(key, 86400);
    await audit(db, { actorUserId: user.id, action: 'user.data_export', targetType: 'user', targetId: user.id, ip: req.ip });
    return { status: 'ready', url, expiresAt: new Date(Date.now() + 86400000).toISOString(), format: 'json' };
  },

  'GET /v1/notifications': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const page = pageParams(req.query, { def: 30, max: 100 });
    const rows = await db.many('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [user.id, page.sqlLimit, page.offset]);
    return pageOf(rows, page, P.notification);
  },

  'POST /v1/notifications/read-all': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const r = await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [user.id]);
    return { updated: r.rowCount };
  },

  'POST /v1/notifications/{notificationId}/read': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    const r = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [req.params.notificationId, user.id]);
    if (!r.rowCount) throw err.notFound('notification_not_found');
    return { ok: true };
  },

  'POST /v1/devices': async (req) => {
    const user = await requireUser(req);
    const v = check({ platform: { type: 'string', required: true, enum: ['ios', 'android'] }, token: { type: 'string', required: true, min: 20, max: 4096 } }, req.body);
    await db.query('INSERT INTO device_tokens (user_id, platform, token) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform', [
      user.id,
      v.platform,
      v.token,
    ]);
    return { ok: true };
  },

  'DELETE /v1/devices/{token}': async (req) => {
    const user = await requireUser(req, { allowSuspended: true });
    await db.query('DELETE FROM device_tokens WHERE user_id = $1 AND token = $2', [user.id, req.params.token]);
    return { ok: true };
  },

  'POST /v1/media/upload-url': async (req) => {
    const user = await requireUser(req);
    const v = check(
      {
        kind: { type: 'string', required: true, enum: Object.keys(media.KINDS) },
        contentType: { type: 'string', required: true, max: 60 },
        sizeBytes: { type: 'integer', required: true, min: 1 },
      },
      req.body
    );
    await enforce(db, 'media_upload', user.id);
    return media.createUpload({ userId: user.id, ...v });
  },
};

exports.loadMe = loadMe;
exports.handler = createRouter(routes);
