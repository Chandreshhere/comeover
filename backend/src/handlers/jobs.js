'use strict';
// Async jobs.
//   handler     — SQS consumer: push | quest_evaluate | reliability_recalc | moderation_alert
//   scheduled   — EventBridge: { task: 'lifecycle' } every 15 min, { task: 'retention' } daily
const db = require('../lib/db');
const push = require('../lib/push');
const { notify } = require('../lib/notify');
const { evaluateQuest, periodKey } = require('../lib/quests');
const S = require('../services/progress');

async function runPush({ userIds = [], notification }) {
  if (!userIds.length) return;
  const rows = await db.many(
    `SELECT t.token, t.user_id, np.* FROM device_tokens t LEFT JOIN notification_preferences np ON np.user_id = t.user_id
       JOIN app_users u ON u.id = t.user_id AND u.status <> 'deleted'
      WHERE t.user_id = ANY($1)`,
    [userIds]
  );
  const tokens = rows.filter((r) => push.shouldDeliver(r.product_updates === undefined ? null : r, notification.type)).map((r) => r.token);
  const data = { ...(notification.data || {}) };
  if (data.target) data.target = JSON.stringify(data.target);
  const res = await push.sendToTokens(tokens, { ...notification, data });
  if (res.invalid && res.invalid.length) await db.query('DELETE FROM device_tokens WHERE token = ANY($1)', [res.invalid]);
}

async function runQuestEvaluate({ userId }) {
  const stats = await S.computeStats(db, userId);
  const quests = await S.questsFor(db, userId, { stats });
  await db.withTransaction(async (client, after) => {
    for (const q of quests) {
      if (q.state !== 'completed') continue;
      const { rows } = await client.query(
        `INSERT INTO user_quests (user_id, quest_id, period_key, state, progress) VALUES ($1, $2, $3, 'completed', $4)
         ON CONFLICT (user_id, quest_id, period_key) DO UPDATE SET state = 'completed', progress = EXCLUDED.progress, updated_at = now()
           WHERE user_quests.state IN ('available','started')
         RETURNING quest_id`,
        [userId, q.row.id, q.period, JSON.stringify({ progress: q.progress, total: q.total })]
      );
      if (rows[0]) {
        await notify(client, after, userId, { type: 'quest', title: `Quest complete: ${q.row.title}`, body: `Claim +${q.row.xp_reward} XP on your roadmap.`, data: { questId: q.row.slug, target: { screen: 'social_roadmap', params: {} } } });
      }
    }
    const { rows: achievements } = await client.query(
      'SELECT a.* FROM achievements a WHERE a.active AND NOT EXISTS (SELECT 1 FROM user_achievements ua WHERE ua.user_id = $1 AND ua.achievement_id = a.id)',
      [userId]
    );
    for (const a of achievements) {
      const ev = evaluateQuest(a.criteria, stats);
      if (!ev.done) continue;
      const summary = a.criteria.type === 'category_completed' ? `${ev.total} verified ${a.criteria.category} plans` : a.criteria.type === 'reliability' ? `${Math.round(stats.reliability.rate * 100)}% show-up across ${stats.reliability.plans} plans` : `${ev.total} verified meetups`;
      await client.query('INSERT INTO user_achievements (user_id, achievement_id, evidence) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, a.id, JSON.stringify({ summary, period: periodKey('daily') })]);
      await notify(client, after, userId, { type: 'quest', title: `Badge earned: ${a.title}`, body: a.description, data: { achievementId: a.slug, target: { screen: 'achievement_detail', params: { id: a.slug } } } });
    }
  });
}

// Reliability = Bayesian-smoothed show-up rate. Peer "didn't show" feedback only
// counts when ≥2 different people say so and the person never checked in.
async function runReliability({ userId }) {
  await db.query(
    `INSERT INTO reliability_events (user_id, activity_id, kind)
     SELECT f.about_user_id, f.activity_id, 'no_show' FROM activity_feedback f
       JOIN activity_participants p ON p.activity_id = f.activity_id AND p.user_id = f.about_user_id
      WHERE f.about_user_id = $1 AND f.showed_up = FALSE AND p.checked_in_at IS NULL AND p.state <> 'completed'
      GROUP BY f.about_user_id, f.activity_id HAVING count(DISTINCT f.from_user_id) >= 2
     ON CONFLICT DO NOTHING`,
    [userId]
  );
  await db.query(
    `UPDATE activity_participants p SET state = 'no_show'
       FROM reliability_events r WHERE r.user_id = $1 AND r.kind = 'no_show' AND p.user_id = r.user_id AND p.activity_id = r.activity_id AND p.state IN ('accepted','checked_in')`,
    [userId]
  );
  await db.query(
    `UPDATE profiles p SET reliability_score = LEAST(1, GREATEST(0, (s.attended + 2.0) / NULLIF(s.attended + s.no_show + 0.5 * s.late + 2.0, 0)))
       FROM (SELECT count(*) FILTER (WHERE kind = 'attended') AS attended, count(*) FILTER (WHERE kind = 'no_show') AS no_show,
                    count(*) FILTER (WHERE kind IN ('late_cancel','host_cancel')) AS late
               FROM reliability_events WHERE user_id = $1) s
      WHERE p.user_id = $1`,
    [userId]
  );
}

async function runModerationAlert({ reportId, appeal }) {
  const r = await db.one('SELECT id, reason_code, priority FROM reports WHERE id = $1', [reportId]);
  if (!r || !process.env.MODERATION_TOPIC_ARN) return;
  if (!appeal && !['urgent', 'high'].includes(r.priority)) return;
  const { PublishCommand } = require('@aws-sdk/client-sns');
  const { sns } = require('../lib/aws');
  await sns().send(
    new PublishCommand({
      TopicArn: process.env.MODERATION_TOPIC_ARN,
      Subject: `[IRL ${appeal ? 'APPEAL' : r.priority.toUpperCase()}] ${r.reason_code}`,
      Message: `${appeal ? 'New appeal' : 'New report'} ${r.id} (${r.reason_code}, ${r.priority}). Review in the admin console.`,
    })
  );
}

const JOBS = { push: runPush, quest_evaluate: runQuestEvaluate, reliability_recalc: runReliability, moderation_alert: runModerationAlert };

exports.handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  const failures = [];
  for (const record of event.Records || []) {
    try {
      const job = JSON.parse(record.body);
      const fn = JOBS[job.type];
      if (!fn) throw new Error(`unknown job ${job.type}`);
      await fn(job);
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'job_failed', messageId: record.messageId, error: e.message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

async function lifecycle() {
  // Plans that started move to in_progress; unanswered requests expire at start time.
  await db.query("UPDATE activities SET status = 'in_progress' WHERE status IN ('open','full') AND starts_at <= now() AND ends_at > now()");
  const expired = await db.many(
    `UPDATE activity_participants p SET state = 'declined', decided_at = now()
       FROM activities a WHERE a.id = p.activity_id AND p.state IN ('requested','waitlisted') AND a.starts_at <= now()
     RETURNING p.user_id, a.id AS activity_id, a.title`
  );
  for (const e of expired) {
    await db.withTransaction((client, after) =>
      notify(client, after, e.user_id, { type: 'join', title: 'Request expired', body: `"${e.title}" started before the host replied. Plenty more nearby.`, data: { activityId: e.activity_id, target: { screen: 'discover_home', params: {} } }, push: false })
    );
  }
  await db.query("UPDATE availability_status SET status = 'busy' WHERE status <> 'busy' AND available_until < now()");
  await db.query("UPDATE app_users SET status = 'active', status_reason = NULL, status_until = NULL WHERE status IN ('limited','suspended') AND status_until IS NOT NULL AND status_until < now()");
  await db.query("UPDATE sponsored_campaigns SET status = 'completed' WHERE status = 'active' AND ends_at < now()");
  await db.query("UPDATE activities SET sponsored_campaign_id = NULL WHERE sponsored_campaign_id IN (SELECT id FROM sponsored_campaigns WHERE status <> 'active')");
  return { expiredRequests: expired.length };
}

async function retention() {
  // DPDP-style purge: anonymise accounts whose 30-day deletion window has passed.
  const purged = await db.many(
    `UPDATE app_users SET phone_e164 = 'deleted:' || id::text, cognito_sub = NULL, purge_after = NULL
      WHERE status = 'deleted' AND purge_after IS NOT NULL AND purge_after < now() RETURNING id`
  );
  for (const u of purged) {
    await db.query("UPDATE profiles SET display_name = 'Deleted user', bio = NULL, avatar_key = NULL, interests = '{}', intents = '{}', boundaries = NULL, preferences = '{}' WHERE user_id = $1", [u.id]);
    await db.query('DELETE FROM availability_status WHERE user_id = $1', [u.id]);
    await db.query('DELETE FROM trusted_contacts WHERE user_id = $1', [u.id]);
    await db.query('DELETE FROM notifications WHERE user_id = $1', [u.id]);
    await db.query('UPDATE messages SET body = NULL, media_key = NULL, deleted_at = COALESCE(deleted_at, now()) WHERE sender_user_id = $1', [u.id]);
  }
  await db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'");
  await db.query("DELETE FROM otp_attempts WHERE created_at < now() - interval '30 days'");
  await db.query("DELETE FROM rate_limits WHERE updated_at < now() - interval '7 days'");
  await db.query("DELETE FROM ws_connections WHERE last_seen_at < now() - interval '1 day'");
  await db.query("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '180 days'");
  await db.query("DELETE FROM webhook_events WHERE received_at < now() - interval '90 days'");
  await db.query('DELETE FROM plan_shares WHERE expires_at < now()');
  return { purgedAccounts: purged.length };
}

exports.scheduled = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  const task = (event && event.task) || 'lifecycle';
  const res = task === 'retention' ? await retention() : await lifecycle();
  console.log(JSON.stringify({ level: 'info', msg: 'scheduled_done', task, ...res }));
  return res;
};
