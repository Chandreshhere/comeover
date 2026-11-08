# Porting guide: legacy (Lambda + PostgreSQL) → Node + MongoDB

The foundation is in place: Express app, Mongoose models, Slide OTP auth, libs, realtime, jobs, Docker and tests. The remaining work is to rewrite each `legacy/src/handlers/<module>.js` as `src/handlers/<module>.js` against MongoDB, **keeping every route key, request shape, response shape and error code exactly as in `docs/API.md`**. The mobile app and admin console are already coded against those shapes. `legacy/` is deleted once every module is ported.

## Conventions (unchanged from legacy)

```js
'use strict';
const { err, json, created } = require('../lib/http');
const { requireUser, assertCanAct, assertAdult } = require('../lib/auth');
const routes = {
  'GET /v1/activities/{activityId}': async (req) => { /* return a value → 200 JSON */ },
  'POST /v1/activities': async (req) => created(body),          // or json(status, body, headers)
};
module.exports = { routes };
```

- **The `req` object:**
  - Has `{ params, query, headers, ip, requestId, body, rawBody(), routeKey, method, path }`.
  - `req.event` no longer exists: use `header(req, 'x-foo')`, `req.rawBody()` for webhook signatures, and `req.ip`.
- **Errors:** throw `err.badRequest(code, message, details)`, `err.forbidden(code)`, `err.notFound(code)`, `err.conflict(...)` or `err.tooMany(retryAfterSec, code)`. Duplicate keys (11000) map to 409 `conflict`; Cast/Validation errors map to 400 `invalid_value`; transient transaction errors map to 409 `retry`.
- **Route order:** within a module, put literal segments before params, e.g. `DELETE …/join-requests/me` before `…/join-requests/{requestId}`. Express matches in registration order.
- **Mounting:** add nothing. `src/handlers/index.js` already lists every module and mounts it as soon as the file exists.

## Import changes (legacy → new)

| Legacy | New |
|---|---|
| `db.query/one/many(sql, params)` | Mongoose models: `const { Activity, Participant } = require('../models')`. Use `.lean()` for reads |
| `db.withTransaction(async (client, after) => …)` | `db.withTransaction(async (session, after) => …)`. Pass `{ session }` to every write (`Model.create([doc], { session })`, `updateOne(f, u, { session })`) and `.session(session)` to reads |
| `requireUser(req, { allowSuspended, client })` | `requireUser(req, { allowSuspended, session })`. Returns `{ id, status, ageVerified, displayName, hasProfile, roles, visibility }` |
| `requireAdmin(req, minRole)` | Same call. Returns `{ id, role, name }`, and `id` is the admin's **User id** (use it as `actorAdminId`). The `admin_users` table is gone |
| `withIdempotency(db, req, userId, fn, opts)` | `withIdempotency(req, userId, fn, opts)` |
| `enforce(db, name, subject)` | `enforce(name, subject, cost = 1, { code, message })`. Limit names live in `lib/rateLimit.LIMITS` |
| `audit(client, entry)` | `audit(entry, { session })` |
| `notify(client, after, userId, opts)` | `notify(session, after, userId, opts)`. Both may be `null` outside a transaction |
| `realtime.publish(channel, { type, data })` | `realtime.publish(channel, type, data)` (the old form is still accepted) |
| `enqueue({ type, ...payload })` | `jobs.enqueue(type, payload, { dedupeKey, delayMs, session })` (the old form is still accepted) |
| `awardXp(client, {...})` | `awardXp(session, {...})` (same result shape) |
| `ent.getActive(db, userId)` / `grant(db, x)` / `revoke(db, x)` | `getActive(userId, { session })` / `grant(x, { session })` / `revoke(x, { session })` |
| `present.*(row)` (snake_case SQL rows) | `present.*(doc, extras)` (camelCase Mongo docs; see `lib/present.js`). Activity presentation stays in the activities port |
| `geo.presentLocation(row, viewer)` | Takes a camelCase Activity (`coarseArea`, `exactLocationVisibleAfterAccept`) |
| `ST_DWithin` / `ST_Distance` | `geo.withinFilter(lat, lng, km)` in `find()`, or `geo.geoNearStage(lat, lng, km, { query })` as the first `aggregate()` stage to get `distanceM` |
| `pageParams` + `LIMIT/OFFSET` | `p = pageParams(req.query)` → `.skip(p.offset).limit(p.fetchLimit)` → `return pageOf(rows, p, mapFn)` (**async**). Keyset: `afterKeyset` / `keysetPageOf` |
| `media.*` with `MEDIA_BUCKET` | Same API (S3-compatible, `S3_BUCKET`); `media.publicUrl(key)` returns a CDN URL or a signed one |
| AWS Secrets Manager / SNS / SQS / API GW WS | Gone. Config comes from env (`src/config.js`); jobs are `lib/jobs`; WS is `lib/realtime` |
| `app_users.cognito_sub` | Gone. The user id is the JWT `sub` |

## Model map (SQL table → collection)

| PostgreSQL | MongoDB model (collection) | Notes |
|---|---|---|
| app_users + profiles + notification_preferences + user_progress + availability_status | **User** (`users`) | `profile` is a subdocument (null until profile setup), plus `notificationPrefs`, `progress { xpTotal, level, weeklyGoal, streakWeeks, freezesLeft, dailyStreakOptIn }` and `availability { status, activitySlugs, coarseCell, area, until }`. `roles: ['admin'|'moderator']` |
| activity_categories | Category | Activities store the category **slug** (`category`), not an id |
| city_areas | CityArea | `centroid` is GeoJSON |
| activities | Activity | `location` is GeoJSON (derived from latitude/longitude on save); `coarseCell` is a geohash(6); `acceptedCount` (host = 1), `waitlistCount`, `nextWaitlistPosition`; `review { status, flags }` for admin review |
| activity_participants | Participant | Unique `(activityId, userId)` |
| activity_feedback, reliability_events | ActivityFeedback, ReliabilityEvent | |
| circles, circle_members | Circle (`memberCount` denormalised), CircleMember | |
| circle_challenges, circle_challenge_progress | CircleChallenge, ChallengeProgress | |
| conversations, conversation_members, messages | Conversation (`lastMessage`, `lastMessageAt`, `directKey`), ConversationMember (`muted`, `lastReadAt`, `leftAt`, `hiddenAt`, `lastMessageAt`), Message | Update `Conversation.lastMessage` **and** `ConversationMember.lastMessageAt` on every send |
| user_blocks | Block | |
| reports, report_actions, appeals | Report, ReportAction, Appeal | `adminId` / `decidedBy` hold User ids |
| audit_events, admin_users | AuditEvent; admins are Users with roles | |
| trusted_contacts, plan_shares | TrustedContact, PlanShare (TTL) | |
| quests, user_quests, levels, achievements, user_achievements | Quest, UserQuest (`periodKey`), Level (`xpThreshold`), Achievement, UserAchievement | |
| xp_events, xp_daily_totals, streak_freezes, assistant_usage | XpEvent, XpDailyTotal, StreakFreeze, AssistantUsage | Days are IST strings `YYYY-MM-DD` |
| expenses + expense_items + item_assignments + expense_shares | **Expense** | `items[{ _id, label, amountMinor, quantity, assignees[{ userId, shareRatio }] }]`, `shares[{ userId, amountMinor, state, paymentReference, confirmedBy, … }]` embedded |
| subscriptions, entitlements | Subscription, Entitlement | |
| device_tokens, notifications | DeviceToken, Notification | |
| business_profiles + business_staff, venues, sponsored_campaigns, campaign_metrics, activity_daily_metrics, business_invoices, webhook_events | BusinessProfile (`staff[]` embedded), Venue (GeoJSON), SponsoredCampaign, CampaignMetric, ActivityDailyMetric, BusinessInvoice, WebhookEvent (TTL 90 d) | |
| idempotency_keys, rate_limits, otp_attempts | IdempotencyKey (TTL 48 h), RateLimit (TTL), OtpRequest (TTL) | |
| ws_connections, ws_subscriptions | In-memory in `lib/realtime` | |
| (new) | Session, Job, RealtimeEvent | |

## Patterns

**Transaction plus side effects after commit:**

```js
const db = require('../lib/db');
return db.withTransaction(async (session, after) => {
  const a = await Activity.findById(id).session(session).lean();
  if (!a) throw err.notFound('activity_not_found');
  await Participant.create([{ activityId: id, userId: user.id, state: 'requested', intro }], { session });
  await notify(session, after, a.hostUserId, { type: 'join', title: 'New join request', data: { target: { screen: 'activity_detail', params: { id } } } });
  after(() => realtime.publish(`activity:${id}`, 'join.updated', { activityId: id, userId: user.id, state: 'requested' }));
  return { state: 'requested' };
});
```

**Capacity without overbooking** (replaces `SELECT … FOR UPDATE`):

```js
const a = await Activity.findOneAndUpdate(
  { _id: id, status: 'open', $expr: { $lt: ['$acceptedCount', '$capacity'] } },
  { $inc: { acceptedCount: 1 } },
  { new: true, session }
).lean();
if (!a) { /* full → waitlist or 409 capacity_full */ }
if (a.acceptedCount >= a.capacity) await Activity.updateOne({ _id: id }, { $set: { status: 'full' } }, { session });
```

Keep `acceptedCount` in step on every state change: increment when a request is accepted or an instant join succeeds; decrement on cancel, removal or no-show. The host counts as 1.

**Counters and upserts:** use `$inc`, and `findOneAndUpdate(filter, { $setOnInsert }, { upsert: true, new: true })`. Catch `e.code === 11000` when two inserts race on a unique key.

**Never** build a filter from raw request objects. Validate first (`lib/validate.check`) or coerce with `String(...)` / `Number(...)`.

**Realtime events** (envelope `{ type, channel, data, at }`):

| type | channel | data |
|---|---|---|
| `message.created` | `conversation:{id}` | Message |
| `join.updated` | `activity:{id}` and `user:{userId}:notifications` | `{ activityId, userId, state, requestId?, conversationId?, method? }` |
| `activity.updated` | `activity:{id}` | `{ activityId, status?, fields? }` |
| `notification.created` | `user:{id}:notifications` | Notification (sent automatically by `notify()`) |
| `progress.updated` | `user:{id}:notifications` | Progress |

**Jobs to register** in `src/jobs/index.js` (port them from `legacy/src/handlers/jobs.js`):
- `quest_evaluate { userId }` (progress)
- `reliability_recalc { userId }` (activities)
- `moderation_alert { reportId, appeal }` (safety/admin; log or notify admins instead of SNS)
- `schedule('lifecycle', '*/15 * * * *', …)` (activities)

## Error codes the clients branch on (keep them exact)

| Area | Codes |
|---|---|
| Publish | `private_venue_not_allowed`, `venue_not_allowed`, `start_in_past`, `invalid_time`, `category_restricted`, `capacity_out_of_range`, `not_circle_member`, `duplicate_plan`, `rate_limited`, `account_restricted`, `age_gate_required` |
| Join | `capacity_full`, `age_gate_required`, `account_restricted` |
| Check-in | `too_far`, `checkin_window_closed` |
| Completion | `not_participant`, `too_early` |
| Guide | `quota_exceeded`, `unsupported_intent` |
| Feedback | `already_submitted` |
| Business | `no_venue` |
| Global | `maintenance` (503), `token_expired` (401), `account_suspended` (403) |
| SplitMate | A non-payee confirming a share gets `403 forbidden` |

## Checklist per module

1. Port every route of the legacy file with the same keys. Keep response shapes as in `docs/API.md` "Models".
2. Inline the relevant `legacy/src/services/*` logic, or move it to `src/services/*` against Mongo.
3. Wrap multi-document writes in `db.withTransaction`, and keep realtime/push in `after()`.
4. Keep the authorization rules: participant/host checks, blocks filtered from discovery and messaging, roles for admin.
5. Add DB tests (`test/<module>.db.test.js`, using `test/helpers/mongo.js` and `test/helpers/env.js`).
6. Run `npm test`, `npm run check` (every mounted route must be documented) and `npm run smoke`.
7. When every module is ported: `npm run check -- --strict` passes, then delete `legacy/`.

## Proposed porting groups

| Group | Legacy files | Routes | Notes |
|---|---|---|---|
| A: Me & progress | `profile.js` (13), `progress.js` (10), `services/progress.js`, job `quest_evaluate` | 23 | Bootstrap, PATCH /me (flag-only patches before profile setup), data export, media upload URL, quests, milestones, achievements, streak calendar |
| B: Plans & discovery | `discovery.js` (10), `activities.js` (11), `assistant.js` (1), `services/activities.js`, jobs `reliability_recalc` + `lifecycle` | 22 | The heaviest logic: geo search, capacity/waitlist, check-in, completion + XP, the IRL Guide (Claude) |
| C: Community, chat, money & safety | `circles.js` (10), `messaging.js` (8), `expenses.js` (10), `safety.js` (10), `services/safety.js`, job `moderation_alert` | 38 | Blocks filtering, conversation membership, ledger states |
| D: Monetisation & admin | `monetization.js` (11), `webhooks.js` (3), `admin.js` (25) | 39 | Store verification, Razorpay, venues/campaigns/analytics, admin KPIs (aggregation pipelines), moderation, taxonomy |
