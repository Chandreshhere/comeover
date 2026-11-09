# Project IRL API reference

The API is a Node.js (Express) server on MongoDB, deployed with Docker. The base URL is `https://<api-host>/v1`, and every path below is relative to it, so `GET /me` means `GET https://<api-host>/v1/me`. The WebSocket endpoint is `wss://<api-host>/ws`.

## Conventions

- **JSON**: request and response bodies are camelCase JSON (`Content-Type: application/json`).
- **Auth** (one of four modes per endpoint):
  - **App**: `Authorization: Bearer <access token>` from `POST /auth/otp/verify` or `POST /auth/session/refresh`.
  - **Admin** / **Admin (moderator+)**: the same kind of access token, belonging to a user with the role `admin` or `moderator`. Roles are granted with `npm run grant-role`, re-read on every request, and revocable at once. `admin` can call everything; `moderator` can call reports, activities, users and audit only.
  - **None**: public endpoint (auth and webhooks).
- **Idempotency**: send `Idempotency-Key: <uuid>` on every mutating request. On endpoints marked **idempotent**:
  - Retrying with the same key and body replays the first response and adds the header `idempotent-replay: true`.
  - The same key with a different body returns `422 idempotency_key_reused`.
  - Keys expire after 24 h.
- **Pagination**: list endpoints take `?cursor=&limit=` and return `{ "items": [...], "nextCursor": "opaque" | null }`. The default `limit` is 20 and the maximum is 50 unless the endpoint says otherwise. Cursors are opaque, so don't parse them.
- **Errors** look like `{ "code": "snake_case", "message": "human readable", "details"?: any }`. The status codes used are:

  | Status | Meaning |
  |---|---|
  | 400 | Validation. `details` is `[{ path, code }]` |
  | 401 | Unauthenticated |
  | 403 | Forbidden |
  | 404 | Not found, or hidden because of a block |
  | 409 | Conflict |
  | 422 | Idempotency key reused |
  | 429 | Rate limited, with a `retry-after` header |
  | 503 | Dependency not configured |
  | 500 | Internal error |

  These codes can come back from any endpoint: `unauthorized`, `token_expired` (refresh, then retry), `token_invalid`, `user_not_found`, `account_deleted`, `account_suspended`, `account_restricted`, `validation_failed`, `invalid_json`, `invalid_cursor`, `invalid_idempotency_key`, `idempotency_key_reused`, `request_in_progress`, `rate_limited`, `conflict`, `invalid_value`, `internal`.
- **Maintenance**: when the server runs with `MAINTENANCE_MODE=true`, every app endpoint returns `503 { code: 'maintenance', message }` with `retry-after: 300`. Admin, auth and webhook endpoints stay up. `GET /me/bootstrap` reports the mode in `service.status`.
- **Times** are ISO-8601 UTC. The server computes "today" and "week" in IST, with weeks running Sunday to Saturday.
- **Privacy**:
  - Other users' exact coordinates are never returned.
  - A plan's coordinates are snapped to a ~300 m grid unless you are its host, or are accepted and the host allows exact location.
  - Distances are banded.
- **Money** is integer paise (`*Minor`) in INR.

## Sign-in flow (phone OTP via Slide)

Codes are delivered by [Slide](https://slide.synquic.com) over WhatsApp, with SMS as the fallback, according to the OTP widget's channel order. Only the server holds the Slide API key and widget id. The app never talks to Slide; it only sees a `requestId`.

1. **Request a code.** `POST /auth/otp/request { phone }`.
   - A 10-digit Indian number is normalised to `+91…`; other numbers must be E.164.
   - The server sends through Slide and returns `{ requestId, channel, retryAfterSec, maskedPhone }`, where `channel` is `whatsapp` or `sms`.
   - Limits: 3 sends per number per hour and 20 per IP per hour, plus Slide's own per-number limit. All of them return `429 otp_rate_limited` (or `rate_limited` for the IP limit) with `retry-after`.
2. **Resend (optional).** `POST /auth/otp/resend { requestId, channel? }` after `retryAfterSec`. `channel` can be `sms` or `whatsapp`; Slide reports a `notice` if it used another one.
3. **Verify.** `POST /auth/otp/verify { requestId, code }`.
   - The server verifies the code with Slide, confirms the phone with Slide's single-use token, then finds or creates the user by phone.
   - It returns `{ accessToken, refreshToken, expiresIn, tokenType: "Bearer", isNewUser, user: { id, roles } }`.
   - A wrong code returns `otp_invalid` with `details.attemptsLeft`. After 5 wrong codes, or once the code is used or expired, the request returns `otp_locked` or `otp_expired`: ask for a new code.
4. **Tokens.**
   - The access token is a 15-minute JWT (`sub` = user id, `roles`).
   - The refresh token is opaque and lasts 30 days. It rotates on every `POST /auth/session/refresh`: store the new one each time.
   - Presenting an old, already-rotated refresh token revokes that sign-in everywhere (`401 session_expired`).
5. **Sign out.** `POST /auth/logout { refreshToken }` ends this device's session. `POST /auth/logout-all` ends every session.
6. **Onboarding.** Then call `GET /me/bootstrap` (below):
   - If `me.session.hasProfile` is false, run onboarding.
   - `PATCH /me` with `{ ageConfirmed: true, termsAccepted: true }` (age gate), then `{ name, … }` (profile).
   - When onboarding is done, `PATCH /me` with `{ onboardingCompleted: true }`.

**Admin web** uses the same phone OTP flow. After sign-in it calls `GET /admin/me`, which returns `403 admin_only` unless the user has the `admin` or `moderator` role.

## Realtime (WebSocket)

- **Connect** to `wss://<api-host>/ws?token=<access token>`. The token is verified on connect; reconnect with a fresh token after a refresh. You are auto-subscribed to `user:{yourId}:notifications`. Several API instances can run behind a load balancer: events reach every instance through a MongoDB change stream.
- **Subscribe** with `{"action":"subscribe","channel":"<channel>"}`. The reply is `{"type":"subscription.ok","channel":…}`, or `subscription.denied`.
- **Unsubscribe** with `{"action":"unsubscribe","channel":…}`.
- **Keepalive** with `{"action":"ping"}`, which replies `{"type":"pong"}`.

Channels, and who may subscribe:

| Channel | Who may subscribe |
|---|---|
| `activity:{activityId}` | The host, plus anyone requested, accepted, waitlisted, checked-in or completed |
| `conversation:{conversationId}` | Active members |
| `user:{userId}:notifications` | That user only |

**Envelope** (server to client): `{ "type": "...", "channel": "...", "data": {...}, "at": "ISO" }`

| type | data |
|---|---|
| `message.created` | Message |
| `join.updated` | `{ activityId, userId, state, requestId?, conversationId?, method? }` |
| `activity.updated` | `{ activityId, status?, fields? }` |
| `notification.created` | Notification |

## Models

```ts
Category     { slug, label, short, pictogram, riskLevel: 'standard'|'elevated'|'restricted' }

Activity {
  id, title, category /* slug */, pictogram, description,
  startsAt, endsAt, durationMin, capacity, joinedCount,
  participants: string[],          // accepted user ids only (host first)
  host: { id, name, reliability /* 0..1, 5% steps */, completed, level, avatarKey, socialStyle },
  area, venueName /* null unless you are host or accepted */, venueId /* partner venue */ | null, venueType,
  latitude, longitude, locationPrecision: 'exact'|'approx_300m'|'area',
  distanceM /* coarse */ | null, distanceBand /* '~600 m' */ | null,
  joinRule: 'approval'|'instant', live, featured, sponsored, sponsorLabel,
  cost, accentIndex /* 0..4 */, tags: string[], accessibility, activityLevel,
  visibility: 'public'|'circle'|'invite_only',
  status: 'open'|'full'|'in_progress'|'completed'|'cancelled'|'moderated',
  circleId, hostedByMe,
  myJoinState: null|'requested'|'accepted'|'waitlisted'|'declined'|'cancelled'|'checked_in'|'completed'|'no_show',
  myRequestId, waitlistPosition /* when myJoinState = 'waitlisted' */,
  conversationId /* present when you are host or accepted */
}

PublicUser   { id, name, area, distanceM?, distanceBand?, reliability, level, interests: string[],
               socialStyle: 'introvert'|'ambivert'|'extrovert'|null /* self-described; ranking only, never filtering */,
               availability: 'now'|'later'|'busy', intent /* category slug */|null, completed, avatarKey, avatarUrl }

Conversation { id, kind: 'direct'|'activity_group'|'circle', activityId, circleId, title, memberIds: string[], muted, unread,
               lastMessage: { id, senderId, body, createdAt } | null }

Message      { id, conversationId, senderId /* 'system' for system messages */, body, mediaKey, deleted, createdAt }

Circle       { id, name, pictogram, members /* count */, area, accentIndex, visibility: 'public'|'private', description,
               rules: string[], memberSeeds /* ≤6 member ids */, nextPlanIds: string[], ownerId, ownerName,
               myRole: 'owner'|'moderator'|'member'|null, category,
               upcomingPlans: Activity[] /* ≤3 in lists, ≤10 in detail */ }

CircleMember PublicUser & { role: 'owner'|'moderator'|'member', joinedAt }

Challenge    { id, title, description, goal /* target count */, progress /* group total */, myProgress, joined,
               rewardXp, startsAt, endsAt, daysLeft, contributors: [{ userId, name, count }] /* top 10 */ }

Progress     { xp, level: { level, name, xp, nextXp, nextName }, completedActivities, peopleMet, hosted, showUpRate,
               weeklyGoal, weeklyDone, streakWeeks, freezesLeft, dailyStreakOptIn, dailyXpCap /* 200 */, xpToday,
               categoryCounts: { [slug]: n },
               week: [{ label: 'Sun'..'Sat', date, state: 'done'|'today'|'today_done'|'rest'|'freeze'|'future'|'missed' }] }

Quest        { id /* slug */, kind: 'daily'|'weekly', title, subtitle, pictogram, progress, total, xp,
               state: 'available'|'started'|'completed'|'claimed' }

Milestone    { id /* 'level-N' */, title, subtitle, pictogram, state: 'done'|'current'|'locked', progress, total, xp }

Achievement  { id /* slug */, title, pictogram, earned, earnedAt, progress, total, criteria /* description */, evidence, color,
               category /* slug or null */, kind /* criteria type, e.g. 'category_completed' */, hint /* how to earn; null once earned */ }

Expense      { id, activityId, description, totalMinor, currency, splitMethod: 'equal'|'custom'|'itemised'|'percentage',
               createdBy, payeeId, payeeUpi, receiptKey, createdAt,
               items?: [{ id, label, amountMinor, quantity, assignees: string[] }],
               shares: [{ userId, amountMinor, state: 'unsettled'|'marked_paid'|'confirmed'|'disputed', paymentReference, bankVerified: false }] }

Notification { id, type: 'activity'|'nearby'|'join'|'message'|'quest'|'safety'|'system'|'marketing', title, body, createdAt, read,
               target: { screen /* mobile inventory id, e.g. activity_detail, group_chat */, params } | null }

Subscription { tier: 'free'|'plus'|'pro', status, expiresAt, store: 'apple'|'google'|null, venue: boolean }

Venue        { id, name, area, address, venueType, categories, description, offers, bookingUrl, verified, sponsored,
               latitude, longitude /* public business location */, distanceM, business: { id, name, verified } | null }

MyVenue      Venue & { status: 'in_review'|'verified'|'rejected'|'suspended', planId, planStatus: 'active'|'payment_processing'|'none',
               reviewNote, contact: { name, phone, email }, business: { id, name, kind, role, verified },
               upcomingPlans: Activity[], planCount, sponsorDisclosure }

Campaign     { id, businessId, activityId, title, audience, budgetMinor, spentMinor, currency, startsAt, endsAt,
               status: 'pending_review'|'active'|'paused'|'completed'|'rejected', label: 'Sponsored', metrics }

TrustedContact { id, name, phone /* full E.164; visible to its owner only */, status: 'invited'|'accepted'|'revoked', createdAt }

Me           { id /* real user id */, phone, ageConfirmed, onboarded, status: 'active'|'limited'|'suspended', statusReason, statusUntil, memberSince,
               session: { ageConfirmed, termsAcceptedAt, onboarded, hasProfile },
               profile: { id, name, bio, avatarKey, avatarUrl, city, area, interests, intents, visibility, boundaries, pronouns, languages,
                          socialStyle: 'introvert'|'ambivert'|'extrovert'|null, reliability } | null,
               prefs: { radiusKm, showOnRadar, analyticsConsent, dailyStreakOptIn, language,
                        notifications: { nearby, joinRequests, messages, questReminders, productUpdates, quietEnabled, quietStart, quietEnd } },
               availability: { status, activities: string[], until, area }, subscription: Subscription }
```

---

## Auth (phone OTP via Slide)

### `POST /auth/otp/request`
Auth: None. Rate limits: 3 per phone per hour, 20 per IP per hour.

- Body: `{ phone }`. A 10-digit Indian number is normalised to +91.
- Returns: `{ requestId, channel: 'whatsapp'|'sms', retryAfterSec, maskedPhone }`.
- Errors: `invalid_phone`, `otp_rate_limited` (429, incl. Slide's own limit), `rate_limited` (per IP), `slide_unavailable` (503), `auth_not_configured` (503).

### `POST /auth/otp/resend`
Auth: None. Rate limit: 5 per phone per hour.

- Body: `{ requestId, channel?: 'sms'|'whatsapp' }`. Allowed once `retryAfterSec` has passed.
- Returns: `{ requestId, channel, retryAfterSec, notice? }`. `notice` is set when Slide used a different channel than the one requested.
- Errors: `otp_expired` (unknown, used or expired request), `otp_rate_limited` (429), `slide_unavailable`.

### `POST /auth/otp/verify`
Auth: None. Rate limit: 60 per IP per hour.

- Body: `{ requestId, code }`.
- Returns: `{ accessToken, refreshToken, expiresIn /* 900 */, tokenType: 'Bearer', isNewUser, user: { id, roles } }`. `isNewUser` is true until the profile has a name.
- Errors:
  - `otp_invalid` (400), with `details.attemptsLeft`.
  - `otp_locked` (400) after 5 wrong codes. Request a new code.
  - `otp_expired` (400): the code was already used or has expired.
  - `account_deleted` (403).
  - `slide_unavailable` (503).

### `POST /auth/session/refresh`
Auth: None. Rate limit: 120 per IP per hour.

- Body: `{ refreshToken }`.
- Returns: `{ accessToken, refreshToken /* rotated: replace the stored one */, expiresIn, tokenType }`.
- Errors: `session_expired` (401) for an unknown, expired, revoked or already-rotated token. Reusing a rotated token also revokes that sign-in on every device.

### `POST /auth/logout`
Auth: None.

- Body: `{ refreshToken }`. Revokes this device's session.
- Returns: `{ ok: true }`.

### `POST /auth/logout-all`
Auth: App. Suspended accounts may call it.

- Revokes every session of the signed-in user. Access tokens already issued stay valid until they expire (at most 15 min).
- Returns: `{ ok: true, revoked }`.

## Me, profile and preferences

### `GET /me`
Auth: App. Suspended accounts may call it.

- Returns: `Me`.

### `GET /me/bootstrap`
Auth: App. Suspended accounts may call it.

- Returns:

```
{ me: Me,                          /* me.id, me.ageConfirmed, me.onboarded, me.status, me.prefs, me.availability */
  city: { name, center: { lat, lng }, areas: [{ name, lat, lng }] },   /* your home city, else DEFAULT_CITY (Ahmedabad) */
  service: { status: 'ok'|'maintenance' },
  subscription: Subscription,
  categories: Category[],
  levels: [{ level, name, xp, subtitle, pictogram }],
  progress: Progress,
  unread: { notifications, messages },
  serverTime }
```

### `PATCH /me`
Auth: App.

- Body (all fields optional):
  - Profile: `{ name, bio, avatarKey, city, area, interests: slug[] /* ≤12 */, intents: string[], visibility: 'discoverable'|'friends_only'|'hidden', boundaries, pronouns, languages, socialStyle: 'introvert'|'ambivert'|'extrovert'|null }`
  - `socialStyle` is the "What are you?" answer asked after onboarding (`null` clears it). It is shown on PublicUser and the plan host, and only ever changes the order of people and plans — nobody is hidden because of it.
  - Flags: `{ ageConfirmed: true, termsAccepted: true, onboardingCompleted: true }`
- The first call creates the profile and requires `name`.
- `ageConfirmed: true` is a self-declared 18+ (no date of birth is stored). It is required before creating or joining plans.
- Returns: `Me`.
- Errors:
  - `name_required`
  - `unknown_interest`
  - `invalid_avatar_key`: the key must come from an `avatar` upload of your own.

### `PATCH /me/preferences`
Auth: App.

- Body: `{ notifications?: { nearby, joinRequests, messages, questReminders, productUpdates, quietEnabled, quietStart: 'HH:MM', quietEnd }, radiusKm, showOnRadar, dailyStreakOptIn, analyticsConsent, weeklyGoal /* 1..14 */, language }`
- Returns: `Me`.

### `DELETE /me`
Auth: App. Suspended accounts may call it.

- What happens:
  - The account is deactivated immediately and all sessions are revoked.
  - Plans you host are cancelled.
  - Personal data is anonymised after 30 days.
- Returns: `{ status: 'deletion_pending', purgeAfter }`.

### `POST /me/data-export`
Auth: App. Suspended accounts may call it. Rate limit: 3 per day.

- Builds a JSON copy of your own data and returns a private link that is valid for 24 h. The file is deleted after 7 days.
- Included: account, plans, messages you sent, circles, reports you filed, blocks, trusted contacts, expense shares, notifications, XP events, subscriptions and your activity log.
- Other people's data and reports filed about you are excluded.
- Returns: `{ status: 'ready', url, expiresAt, format: 'json' }`.
- Errors: `media_not_configured`.

### `GET /users/{userId}/public-profile`
Auth: App.

- Returns: `PublicUser & { avatarSeed, bio, memberSince, verification: { phone: true }, badges: [{ id, title, pictogram, color, earnedAt }], sharedCircleIds: string[], upcomingPlans: Activity[] /* ≤5 they host that you can see */ }`.
- Errors: `user_not_found`, which is also returned when either user has blocked the other or the profile is hidden.

## Notifications, devices and media

### `GET /notifications`
Auth: App. Paginated; maximum `limit` is 100.

- Returns: `{ items: Notification[], nextCursor }`.

### `POST /notifications/{notificationId}/read`
Auth: App.

- Returns: `{ ok: true }`.
- Errors: `notification_not_found`.

### `POST /notifications/read-all`
Auth: App.

- Returns: `{ updated }`.

### `POST /devices`
Auth: App.

- Body: `{ platform: 'ios'|'android', token /* FCM registration token */ }`.
- Returns: `{ ok: true }`.

### `DELETE /devices/{token}`
Auth: App.

- Returns: `{ ok: true }`.

### `POST /media/upload-url`
Auth: App. Rate limit: 30 per hour.

- Body: `{ kind: 'avatar'|'bill'|'venue_proof'|'evidence'|'chat', contentType, sizeBytes }`.
- Size limits: avatar 5 MB; bill and venue_proof 10 MB; evidence 15 MB; chat 8 MB.
- Allowed types: jpeg, png, webp and heic for every kind. `bill`, `venue_proof` and `evidence` also accept pdf.
- Returns: `{ uploadUrl, key, method: 'PUT', headers: { 'Content-Type', 'Content-Length', 'x-amz-server-side-encryption' }, expiresInSec: 300 }`.
- Upload with `PUT uploadUrl`, sending exactly those headers. Then pass `key` to the endpoint that uses it.
- Avatars are served from `MediaCdnUrl/{key}`. All other media is private.
- Errors: `invalid_kind`, `unsupported_type`, `file_too_large`, `media_not_configured`.

## Discovery

### `GET /activities`
Auth: App. Paginated.

- Query:
  - Location: `lat&lng`, or `area` (a city area name). With neither, results are city-wide.
  - `radius` (km, 0.2–25, default 3), `category` (one slug or a comma list of up to 10, e.g. `thrifting,smoke`).
  - `when`: `any` (default), `now`, `today`, `tonight`, `tomorrow` or `weekend`.
  - `q` (text, ≤80).
- Returns: `{ items: Activity[], nextCursor, rankedFor: 'introvert'|'ambivert'|'extrovert'|null }`, ordered by start time then distance. When the caller has a `socialStyle`, plans inside each page get a gentle nudge (group size and how calm or lively the category is; a plan moves at most ~2 places, nothing is dropped) and `rankedFor` names the style used, so clients don't apply it twice. Sponsored plans are not boosted.
- Errors: `invalid_location`.

#### Social style matching
Same style = 1.0, introvert↔ambivert = 0.8, extrovert↔ambivert = 0.8, introvert↔extrovert = 0.45, unknown = 0.6 (neutral).
Plans: introverts favour small groups (≤4) and calm categories, extroverts bigger groups (≥5) and lively ones, ambiverts mid-size (3–6).
Implemented in `src/lib/socialMatch.js`, a port of the app's `src/utils/socialMatch.js` — keep the two in step.

### `GET /activities/featured`
Auth: App.

- Query: `lat&lng` or `area`, plus `radius`.
- Returns: `{ items: Activity[] /* ≤3, featured: true */, nextCursor: null }`. Ranked live first, then by host reliability, then by distance. Only plans with spots left.

### `GET /activities/categories`
Auth: App.

- Returns: `{ items: Category[] }`.

### `GET /activities/{activityId}`
Auth: App.

- Query: `lat&lng` (optional), used to compute `distanceM`.
- Returns: `Activity`.
- Errors: `activity_not_found`, which also covers hidden, blocked and moderated plans.

### `GET /me/activities`
Auth: App. Paginated.

- Query: `tab=hosted|joined|past|cancelled` (default `joined`).
- Returns: `{ items: Activity[], nextCursor }`.

### `GET /search`
Auth: App.

- Query: `q` (2–80 chars), and optionally `lat&lng`.
- Returns: `{ activities: Activity[] /* ≤10 */, people: PublicUser[] /* ≤10, discoverable only */, venues: Venue[] /* ≤10, verified; includes id, name, area, verified, sponsored */ }`.

### `PUT /me/availability`
Auth: App.

- Body: `{ status: 'now'|'later'|'busy', activities: slug[] /* ≤5 */, until?, lat?, lng?, area? }`.
- If `status` is `now` and `until` is omitted, it defaults to 2 hours from now. Availability can be set at most 24 h ahead.
- Only a ~1.2 km geohash cell is stored. Precise coordinates are discarded.
- Returns: `{ status, activities, until, area }`.
- Errors: `until_too_far`.

### `GET /availability/nearby`
Auth: App. Paginated.

- Query: `lat&lng` or `area`, plus `radius`.
- Returns: `{ items: PublicUser[], nextCursor }`. Ordered by social-energy match with the caller first (see "Social style matching"; never filtered), then people who are free now, then distance. Only discoverable users with `showOnRadar` on are included, and blocked users never appear.
- Errors: `location_required`.

### `GET /venues`
Auth: App. Paginated.

- Query: `category`, and optionally `lat&lng`.
- Returns: `{ items: Venue[], nextCursor }` (verified venues only).

### `GET /venues/{venueId}`
Auth: App.

- Returns: `Venue & { upcomingPlans: Activity[] }`.
- Errors: `venue_not_found`.

## Plans (create, join, lifecycle)

### `POST /activities`
Auth: App. Idempotent. Requires a profile and 18+. Not allowed while `limited`. Rate limit: 10 per day.

- Body:

```
{ title /* 3–80 */, description?, category /* slug */, startsAt, durationMin /* 5–720 */, capacity? /* 2–30, default 4 */,
  visibility?: 'public'|'circle'|'invite_only', joinRule?: 'approval'|'instant', venueName?, venueType?, area,
  latitude?, longitude?, exactLocationAfterAccept? /* default true */, cost?, tags?: string[] /* ≤8 */,
  accessibility?, activityLevel?: 'any'|'beginner'|'intermediate'|'advanced', circleId?,
  venueId? /* verified partner venue; fills venueName/venueType/coords */ }
```

- Returns: `201 Activity`. The host is auto-accepted and the group chat is created.
- Errors (the client branches on these):
  - Venue: `private_venue_not_allowed` (homes, flats and hotel rooms are rejected), `venue_not_allowed` (`venueId` not verified or not public).
  - Time: `start_in_past`, `invalid_time` (unparseable start, duration outside 5–720 min, or more than 60 days ahead).
  - `capacity_out_of_range`: capacity outside 2–30.
  - Category: `unknown_category`, `category_restricted`.
  - Circle: `circle_required`, `not_circle_member`.
  - `duplicate_plan` (409): you already have a similar plan within the same 30 minutes.
  - `rate_limited` (429).
  - Account: `account_restricted`, `age_gate_required`, `profile_required`.
  - Other: `invalid_location`, `validation_failed`.

### `PATCH /activities/{activityId}`
Auth: App (host only).

- Body: `{ title, description, capacity, joinRule, venueName, cost, tags, accessibility }` (all optional).
- Returns: `Activity`. Raising capacity promotes waitlisted people.
- Errors: `host_only`, `not_editable`, `capacity_out_of_range`, `capacity_below_joined`, `private_venue_not_allowed`.

### `POST /activities/{activityId}/join-requests`
Auth: App. Idempotent. Rate limit: 30 per day.

- Body: `{ intro? /* ≤280 */ }`.
- What happens:
  - The server locks the plan row and checks capacity.
  - On an `instant` plan you are accepted straight away. On an `approval` plan your request waits for the host.
  - If the plan is full you get `state: 'waitlisted'` with a `waitlistPosition`. The waitlist holds max(5, capacity) people.
- Returns: `{ state: 'requested'|'accepted'|'waitlisted', activity: Activity, requestId, waitlistPosition, conversationId? }`.
- Errors:
  - `capacity_full` (409): the plan and its waitlist are both full.
  - `age_gate_required`, `account_restricted`, `profile_required`
  - `activity_not_found`, `own_plan`, `not_joinable`, `already_started`, `declined`
  - `rate_limited`

### `GET /activities/{activityId}/join-requests`
Auth: App (host only).

- Returns: `{ items: [{ id /* requestId */, userId, user: PublicUser, intro, state: 'requested'|'waitlisted'|'accepted'|'checked_in', requestedAt, waitlistPosition }] }`. Pending requests come first.
- Errors: `host_only`.

### `DELETE /activities/{activityId}/join-requests/me`
Auth: App.

- Cancels your request, leaves the waitlist, or leaves the plan.
- Leaving an accepted plan less than 2 h before the start records a late cancel. Your spot goes to the next person on the waitlist.
- Returns: `{ state: 'cancelled', activity: Activity }`.
- Errors: `no_active_request`, `host_cannot_leave`.

### `POST /activities/{activityId}/join-requests/{requestId}/accept`
Auth: App (host only). Idempotent.

- Returns: `{ requestId, state: 'accepted', conversationId }`. The accepted person is added to the group chat and notified.
- Errors: `host_only`, `request_not_found`, `not_pending`, `capacity_full`, `blocked`, `account_restricted`.

### `POST /activities/{activityId}/join-requests/{requestId}/decline`
Auth: App (host only).

- Returns: `{ requestId, state: 'declined' }`. The person gets a kind notice with no reason given.
- Errors: `host_only`, `request_not_found`, `not_pending`.

### `POST /activities/{activityId}/cancel`
Auth: App (host only).

- Body: `{ reason? }`.
- Returns: `Activity` with `status: 'cancelled'`.
- Errors: `host_only`, `not_cancellable`.

### `POST /activities/{activityId}/check-ins`
Auth: App.

- Body: `{ method: 'proximity'|'manual'|'host', lat?, lng?, userId? }`.
- `proximity` needs `lat`/`lng` within 300 m of the venue. The coordinates are not stored.
- `host` lets the host check in `userId`.
- The check-in window opens 30 min before the start and closes 30 min after the end.
- Returns: `{ checkedIn: true, method, verified, mutual }`.
- Errors: `too_far` (proximity check failed; fall back to manual), `checkin_window_closed`, `not_participant`, `host_only`, `user_required`.

### `POST /activities/{activityId}/completion-confirmations`
Auth: App. Idempotent.

- A plan counts as completed when the host and at least one attendee confirm, or when 2 or more people have verified (proximity or host) check-ins.
- XP is awarded server-side, once per person per plan, within the daily cap.
- Returns: `{ state: 'completed'|'confirmed', xpAwarded, duplicate /* you had already confirmed */, pendingOthers /* waiting for the other side */, leveledUp, level, progress: Progress }`.
- Errors: `too_early` (the plan hasn't started), `not_participant`, `not_completable`.

### `POST /activities/{activityId}/feedback`
Auth: App (participants only).

- Body: `{ about: [{ userId, showedUp?, rating? /* 1–5 */, note? }] }`.
- Private: never shown to the other person. Feeds reliability; a no-show needs 2 independent reports.
- You can submit feedback once per plan.
- Returns: `{ ok: true }`.
- Errors: `not_participant`, `already_submitted` (409).

## Messaging

Chat opens only after an approved join (plan groups), inside circles you belong to, or one-to-one with someone you've shared an accepted plan with.

### `GET /conversations`
Auth: App. Paginated; default `limit` 30, maximum 100.

- Returns: `{ items: Conversation[], nextCursor }`. Ordered by latest message. Direct chats with blocked users are omitted.

### `POST /conversations`
Auth: App.

- Body: `{ kind: 'direct', userId }` or `{ kind: 'circle', circleId }`.
- Returns: `201 Conversation`. If the conversation already exists, it is returned (and un-hidden).
- Errors: `user_required`, `blocked`, `chat_not_available`, `circle_required`, `not_circle_member`, `account_restricted`.

### `DELETE /conversations/{conversationId}`
Auth: App.

- Circle chats: you leave the chat.
- Direct and plan chats: hidden for you until a new message arrives.
- Returns: `{ ok: true }`.
- Errors: `conversation_not_found`.

### `POST /conversations/{conversationId}/mute`
Auth: App.

- Body: `{ muted: boolean }`.
- Returns: `{ muted }`.

### `POST /conversations/{conversationId}/read`
Auth: App.

- Returns: `{ ok: true }`.

### `GET /conversations/{conversationId}/messages`
Auth: App. Paginated; default `limit` 40, maximum 100.

- The first page is the newest. Within a page, items run oldest to newest, and `nextCursor` loads older messages.
- Returns: `{ items: Message[], nextCursor }`. Messages from users you've blocked are hidden.

### `POST /conversations/{conversationId}/messages`
Auth: App. Rate limit: 60 per minute.

- Body: `{ body? /* ≤2000 */, mediaKey? /* kind 'chat' */ }`.
- Returns: `201 Message`. Publishes `message.created` and pushes to unmuted members.
- Errors: `empty_message`, `invalid_media_key`, `chat_closed`, `account_restricted`, `conversation_not_found`.

### `POST /messages/{messageId}/report`
Auth: App.

- Body: `{ reasonCode, details? }`.
- Returns: `201 { id, status, createdAt }`.
- Errors: `message_not_found`, `cannot_report_message`.
- `reasonCode` is one of: `harassment`, `safety_threat`, `dating_or_solicitation`, `underage`, `impersonation`, `spam`, `scam`, `hate`, `inappropriate_content`, `no_show_abuse`, `unsafe_venue`, `other`.

## Circles

### `GET /circles`
Auth: App. Paginated.

- Query: `scope=all|joined|suggested|local`, `area`, `q`.
- Returns: `{ items: Circle[], nextCursor }`.

### `POST /circles`
Auth: App. Requires a profile and 18+. Rate limit: 3 per day.

- Body: `{ name, description?, visibility?: 'public'|'private', area?, category?, pictogram?, rules?: string[] }`.
- Returns: `201 Circle`. The creator becomes owner and a circle chat is created.

### `GET /circles/{circleId}`
Auth: App.

- Returns: `Circle & { upcomingPlans: Activity[], challenge: Challenge | null, conversationId }`.
- Errors: `circle_not_found`. Private circles return this to non-members.

### `POST /circles/{circleId}/members`
Auth: App.

- Body: `{}` to join yourself, or `{ userId }` for the owner or a moderator to add someone (private circles).
- Returns: `Circle`.
- Errors: `circle_not_found`, `invite_only`, `owner_or_moderator_only`, `blocked`.

### `GET /circles/{circleId}/members`
Auth: App. Paginated.

- Returns: `{ items: CircleMember[], nextCursor }`. Owner first, then moderators, then members by join date.

### `DELETE /circles/{circleId}/members/me`
Auth: App.

- Returns: `{ ok: true }`.
- Errors: `not_circle_member`, `owner_must_transfer`.

### `DELETE /circles/{circleId}/members/{userId}`
Auth: App (owner or moderator).

- Returns: `{ ok: true }`.
- Errors: `owner_or_moderator_only`, `member_not_found`, `cannot_remove_role`.

### `POST /circles/{circleId}/plans`
Auth: App (members only).

- Body: same as `POST /activities`. Visibility defaults to `circle`; send `visibility: 'public'` to share it more widely.
- Returns: `201 Activity`.

### `GET /circles/{circleId}/challenge`
Auth: App.

- Returns: `{ challenge: Challenge | null }`.

### `POST /circles/{circleId}/challenge/join`
Auth: App (members only).

- Returns: `{ challenge }`.
- Errors: `no_active_challenge`.

## Progress (quests, XP, streaks)

### `GET /me/progress`
Auth: App.

- Returns: `Progress`.

### `GET /quests/today`
Auth: App.

- Returns: `{ items: Quest[] }` (daily and weekly).

### `GET /quests`
Auth: App.

- Query: `kind=daily|weekly`.
- Returns: `{ items: Quest[] }`.

### `POST /quests/{questId}/start`
Auth: App.

- `questId` is the slug (or uuid).
- Returns: `Quest`.
- Errors: `quest_not_found`.

### `POST /quests/{questId}/claim`
Auth: App.

- The server re-evaluates the quest from verified completions. XP counts toward the daily cap.
- Returns: `{ claimed: true, xpAwarded, capped, leveledUp, progress: Progress }`.
- Errors: `quest_not_complete`, `already_claimed`, `quest_not_found`.

### `GET /me/milestones`
Auth: App.

- Returns: `{ items: Milestone[] }`.

### `GET /me/achievements`
Auth: App.

- Returns: `{ items: Achievement[] }`.

### `GET /me/roadmap`
Auth: App.

- Returns: `{ level, xp, milestones: Milestone[], achievements: Achievement[], categoryCounts }`.

### `GET /me/streak-calendar`
Auth: App.

- Query: `months` (1–12, default 3).
- Returns: `{ days: [{ date, state, count }], streakWeeks, weeklyGoal, freezesLeft }`.

### `POST /me/streak-freeze`
Auth: App.

- Body: `{ day?: 'YYYY-MM-DD' }`. Defaults to this week's latest missed or rest day. You get one freeze per week.
- Returns: `Progress`.
- Errors: `no_freezes_left`, `nothing_to_freeze`.

## SplitMate (expense ledger; no custody)

### `POST /expenses`
Auth: App. Idempotent. Rate limit: 30 per day.

- Body:

```
{ activityId?, description, totalMinor, splitMethod: 'equal'|'custom'|'percentage'|'itemised',
  participantIds?: uuid[] /* you are added automatically */, payeeId? /* default you */, payeeUpi? /* only if you are the payee */,
  amounts?: { [userId]: minor } /* custom */, percentages?: { [userId]: pct } /* percentage */,
  shares?: [{ userId, amountMinor? /* custom */, percent? /* percentage */ }] /* alternative to amounts/percentages; adds participants */,
  items?: [{ label, amountMinor, quantity?, assigneeIds: uuid[] }] /* itemised; tax/tip spread pro-rata */, receiptKey? /* kind 'bill' */ }
```

- Participants must be in the plan (when `activityId` is set) or connected to you through a plan or circle.
- The payee's own share is `confirmed` automatically.
- Returns: `201 Expense`.
- Errors:
  - Participants: `participants_required`, `payee_not_participant`, `participant_not_in_plan`, `participant_not_connected`, `participant_blocked`, `not_participant`.
  - Amounts: `custom_amounts_mismatch`, `percentages_must_total_100`, `invalid_custom_amounts`, `items_exceed_total`, `item_unassigned`.
  - Other: `invalid_receipt_key`.

### `GET /expenses`
Auth: App. Paginated.

- Returns: `{ items: Expense[], nextCursor }`.

### `GET /expenses/{expenseId}`
Auth: App.

- Returns: `Expense`, including `items` for itemised splits.
- Errors: `expense_not_found`.

### `POST /expenses/{expenseId}/items`
Auth: App (creator only).

- Body: `{ items: [{ label, amountMinor, quantity?, assigneeIds }] }`. Replaces the existing items and recomputes shares; the split becomes `itemised`.
- Returns: `Expense`.
- Errors: `creator_only`, `already_settled`, `assignee_not_participant`.

### `POST /expenses/{expenseId}/participants`
Auth: App (creator only; equal splits only).

- Body: `{ userIds }`.
- Returns: `Expense`.
- Errors: `creator_only`, `resplit_required`, `participant_not_connected`.

### `GET /expenses/{expenseId}/summary`
Auth: App.

- Returns:

```
{ expense: Expense,
  payee: { userId, name, upi },
  totals: { totalMinor, confirmedMinor, outstandingMinor },
  perPerson: [{ userId, name, amountMinor, state, owesPayee, upiLink /* only on your own row */ }],
  disclaimer }
```

### `POST /expenses/{expenseId}/settlement-intent`
Auth: App.

- Returns: `{ amountMinor, payeeId, payeeName, upiLink /* upi://pay?... */ | null, hasUpi, note }`. This only builds a UPI deep link: no money moves through IRL.
- Errors: `you_are_payee`, `no_share`, `already_confirmed`.

### `POST /expenses/{expenseId}/settlement-confirmation`
Auth: App.

- Body: `{ action: 'mark_paid'|'confirm'|'dispute', userId? /* default you */, paymentReference? }`.
- A shortcut for the share PATCH below, with the same rules.
- Returns: `Expense`.

### `PATCH /expenses/{expenseId}/shares/{userId}`
Auth: App.

- Body: `{ state: 'unsettled'|'marked_paid'|'confirmed'|'disputed', paymentReference? }`.
- Who can set what:
  - The share's owner can set `marked_paid`, `unsettled` or `disputed`.
  - Only the **payee** can set `confirmed`.
  - Either party can set `disputed`.
- `bankVerified` is always false: states are what people report, not bank confirmations.
- Returns: `Expense`.
- Errors: `share_not_found`, `forbidden` (403): for example, a non-payee trying to confirm.

## Safety (never paywalled; available to limited and suspended accounts)

### `POST /reports`
Auth: App. Idempotent. Rate limit: 20 per day.

- Body: `{ userId? /* alias: reportedUserId */, activityId?, messageId?, conversationId?, circleId?, reasonCode, details?, evidenceNote?, evidenceKeys?: string[] /* kind 'evidence', ≤5 */, alsoBlock?: boolean }`.
  - At least one target is required.
  - With `messageId`, the sender becomes the reported user. You must be a member of that conversation.
  - `alsoBlock: true` blocks the reported user in the same call.
- Returns: `201 { id, status, priority, createdAt, blocked, message }`. Urgent and high-priority reports page the moderation team.
- Errors: `target_required`, `cannot_report_self`, `invalid_evidence_key`, `message_not_found`.

### `GET /me/reports`
Auth: App.

- Returns: `{ items: [{ id, reasonCode, status, createdAt, resolvedAt, target: { type, id, name }, outcome: 'action_taken'|'no_violation_found'|null }] }`.

### `POST /blocks`
Auth: App.

- Body: `{ userId }`. Also withdraws pending requests between the two people.
- Returns: `{ blocked: true, userId }`.
- Errors: `cannot_block_self`.

### `DELETE /blocks/{userId}`
Auth: App.

- Returns: `{ blocked: false, userId }`.

### `GET /me/blocks`
Auth: App.

- Returns: `{ items: [{ userId, name, avatarKey, blockedAt }] }`.

### `POST /trusted-contacts/invitations`
Auth: App. Rate limit: 10 per day.

- Body: `{ name, phone, activityId? }`.
- With `activityId`, the contact receives an SMS with the plan, time, venue or area, and the host's first name.
- Returns: `201 TrustedContact & { shared: { activityId, expiresAt } | null }`.
- Errors: `invalid_phone`, `not_participant`.

### `GET /trusted-contacts`
Auth: App.

- Returns: `{ items: TrustedContact[] }`.

### `DELETE /trusted-contacts/{contactId}`
Auth: App.

- Returns: `{ ok: true }`. Also expires any plan shares sent to that contact.
- Errors: `contact_not_found`.

### `GET /safety/case-status`
Auth: App.

- Returns: `{ account: { status, reason, until }, cases: [{ reportId, reasonCode, status, action, durationDays, decidedAt, appeal, appealable }] }`. Reporter identities are never shown.

### `POST /appeals`
Auth: App.

- Body: `{ reportId, statement /* 10–2000 */ }`.
- Returns: `201 { id, status, createdAt }`.
- Errors: `report_not_appealable`.

## Monetisation, subscriptions and business

### `GET /plans`
Auth: App.

- Returns: `{ items: [{ id, planId /* 'free'|'plus'|'pro'|'venue' */, name, priceMonthlyInr, alternativeTestPriceInr, features: string[], productIds: { apple, google } | null, audience, billing: 'free'|'store'|'razorpay_invoice' }], neverGated: string[], currency: 'INR', nextCursor: null }`.
- Like every list in this API, the plans are wrapped in `items`.

### `GET /me/subscription`
Auth: App.

- Returns: `Subscription`.

### `POST /subscriptions/receipt/verify`
Auth: App. Idempotent.

- Body: `{ store: 'apple', transactionId }` or `{ store: 'google', purchaseToken, productId }`.
- The server verifies with the App Store Server API or the Play Developer API and owns the entitlement.
- Set `appAccountToken` (Apple) or `obfuscatedAccountId` (Google) to your user id when purchasing.
- Returns: `Subscription`, i.e. `{ tier, status, expiresAt, store, venue }`.
- Errors:
  - `transaction_id_required`, `purchase_token_required`
  - `purchase_not_found`
  - `purchase_belongs_to_another_account` (409)
  - `billing_not_configured` (503)

### `POST /subscriptions/restore`
Auth: App.

- Body: `{ apple?: { transactionIds: string[] }, google?: { purchaseTokens: string[] } }`.
- Returns: `Subscription & { restored, failed: string[] }`.

### `POST /business/venues`
Auth: App. Requires 18+. This is business onboarding.

- Body:

```
{ businessName, kind: 'venue'|'club'|'organiser',
  contactEmail | contact: { name?, phone?, email }, contactName?, contactPhone?, gstin?,
  proofKey /* kind 'venue_proof' */, planId?: 'venue'|'club',
  agreements: { terms: true, sponsorLabelling?, noGuaranteedAttendance? } /* or an array of the accepted keys */,
  venue: { name, address, area, latitude, longitude, venueType, categories?, bookingUrl? /* https */, description? } }
```

- Returns: `201 { business: { id, name, kind, verificationStatus: 'pending', role }, venueId, message }`. The venue is in review until an admin verifies it.
- Errors: `invalid_proof_key`, `terms_required`, `already_onboarded`.

### `GET /business/venues/me`
Auth: App (business owner or staff).

- Returns: `MyVenue`:
  - `status`: `in_review`, `verified`, `rejected` or `suspended`.
  - `planStatus`: `active`, `payment_processing` (a Razorpay order is pending) or `none`.
  - `reviewNote`: the admin's note on the latest verification decision.
- Errors: `no_venue` (404): you haven't onboarded yet.

### `GET /business/campaigns`
Auth: App (business staff).

- Query: `businessId?`.
- Returns: `{ business, items: Campaign[] }`.
- Errors: `no_business`.

### `POST /business/campaigns`
Auth: App (verified business owner or manager, with an active Venue/Club plan).

- Body: `{ businessId?, activityId?, title, audience?: { areas?, categories? }, budgetMinor /* ≥ ₹100 */, startsAt, endsAt }`.
- Returns: `201 Campaign` with status `pending_review`. Every sponsored plan is labelled "Sponsored".
- Errors: `business_not_verified`, `manager_only`, `venue_plan_required`, `invalid_dates`, `activity_not_owned`.

### `GET /business/analytics`
Auth: App (business staff).

- Query: `venueId?`, `range=7d|30d|90d`, `businessId?`.
- Returns:

```
{ range, venue: { id, name, area },
  days: ['YYYY-MM-DD', ...], labels: ['8 Nov', ...],
  series: { planViews: number[], joins: number[], checkIns: number[], impressions: number[], clicks: number[] },
  totals: { planViews, joins, checkIns, impressions, clicks },
  previousTotals: { ...same keys, for the preceding period of equal length },
  note }
```

  - `planViews` counts non-host opens of plans at the venue.
  - `joins` counts join requests to those plans.
  - `checkIns` counts check-ins.
  - `impressions` and `clicks` come from sponsored campaigns.
- Errors: `no_business`, `no_venue`.

### `POST /business/payments/order`
Auth: App (business owner). Idempotent.

- Body: `{ businessId?, months? /* 1–12 */ }`.
- Creates a Razorpay order for the Venue/Club plan (`VENUE_PLAN_PRICE_INR` × months).
- Returns: `201 { invoiceId, orderId, amountMinor, currency, keyId, description, businessName }`. Pass these to Razorpay Checkout.
- Errors: `owner_only`, `payments_not_configured`.

### `POST /business/payments/verify`
Auth: App (business staff).

- Body: `{ orderId, paymentId, signature }`, as returned by Razorpay Checkout.
- An optional fast path; the webhook remains authoritative.
- Returns: `{ status: 'paid', invoiceId }`.
- Errors: `invoice_not_found`, `invalid_signature`.

## IRL Guide

### `POST /assistant/suggest`
Auth: App.

- Body: `{ prompt /* 2–500 */, lat?, lng?, area?, radiusKm? /* default 5 */ }`.
- How it answers:
  - It uses Claude (`claude-opus-5-5`, structured output, server-side refusal fallback).
  - Answers are grounded only in real nearby plans from the database, passed as public fields only.
  - Ids the model returns that weren't in that list are dropped.
  - Dating, companionship and escort requests are refused.
- Daily quota (IST day): Free 16, Plus 60, Pro 150. Failed and refused calls don't use up quota.
- Returns: `{ reply, refused: false, activityIds: string[] /* ≤3 */, activities: Activity[], draft: { category, title, durationMin, when: 'now'|'in15'|'tonight'|'tomorrow'|'weekend'|'custom', capacity } | null, promptsLeft, model }`.
- Errors:
  - `unsupported_intent` (422): dating, companionship, escort or unsafe requests. `message` is a friendly platonic redirect, and `details.promptsLeft` is included.
  - `quota_exceeded` (429): today's quota is used up.
  - `assistant_busy` (429).
  - `assistant_not_configured`, `assistant_unavailable`, `assistant_bad_output` (all 503).

## Webhooks (no auth; signature-verified, idempotent)

### `POST /webhooks/razorpay`
Auth: None.

- Verified with the `X-Razorpay-Signature` header (HMAC-SHA256 of the raw body with the webhook secret).
- Handles `payment.captured` and `order.paid` (invoice paid, and the Venue entitlement extended by 30 days per month), `payment.failed`, and `refund.processed`.
- Returns: `{ ok: true, duplicate? }`.
- Errors: `invalid_signature` (401), `payments_not_configured`.

### `POST /webhooks/apple`
Auth: None.

- App Store Server Notifications V2. The `signedPayload` JWS is verified against Apple Root CA G3 (pinned fingerprint).
- Returns: `{ ok: true }`.
- Errors: `invalid_signature`, `billing_not_configured`.

### `POST /webhooks/google`
Auth: None.

- Play RTDN delivered by Pub/Sub push to `…/webhooks/google?token=<GOOGLE_RTDN_TOKEN>`. The state is always re-fetched from the Play Developer API.
- Returns: `{ ok: true }`.
- Errors: `invalid_token`, `billing_not_configured`.

## Admin API (user roles `admin` / `moderator`)

Every state-changing call writes `audit_events` with the admin's id. Viewing evidence and opening a report are audited too.

### `GET /admin/me`
Auth: Admin (moderator+).

- Returns: `{ id, name, phone /* masked */, role: 'admin'|'moderator' }`.
- Errors: `admin_only` (403) when the user has no admin role, `admin_disabled` (403) for suspended or deleted accounts.

### `GET /admin/kpis`
Auth: Admin.

- Query: `range=7d|30d`.
- Returns:

```
{ range,
  users: { total, new, active },
  activities: { created, completed, cancelled },
  joins: { requests, accepted, conversion },
  showUpRate, completionRate, medianMinutesToFirstAccept, completedPerActiveUser,
  safety: { openReports, urgentOpen, substantiatedPer1000Meetups },
  revenue: { activeSubscriptions, venuePlans },
  series: [{ day, signups, completed }] }
```

### `GET /admin/reports`
Auth: Admin (moderator+). Paginated.

- Query: `status=queue|open|reviewing|actioned|dismissed|appealed` (`queue` means open, reviewing and appealed).
- Returns: `{ items: [{ id, reasonCode, status, priority, createdAt, reporter: { id, name }, reported: { id, name, status }, activity: { id, title }, messageSnippet, priorReports }], nextCursor }`. Ordered by priority, then age.

### `GET /admin/reports/{reportId}`
Auth: Admin (moderator+).

- Opening a report marks it `reviewing` and assigns it to you.
- Returns:

```
{ id, reasonCode, details, status, priority, createdAt, resolvedAt,
  reporter, reported: { id, name, status, memberSince }, activity: { id, title, status, venueName, area },
  messageId, messageContext: [{ id, senderId, body, deleted, createdAt, reported }],
  evidence: [{ key, url /* 5-min presigned */ }],
  actions: [{ id, action, notes, durationDays, admin, createdAt }],
  appeals: [{ id, statement, status, createdAt, decidedAt }],
  otherReportsAgainstUser: [...] }
```

- Errors: `report_not_found`.

### `POST /admin/reports/{reportId}/actions`
Auth: Admin (moderator+).

- Body: `{ action: 'warn'|'limit'|'suspend'|'remove_content'|'dismiss', reason, durationDays? /* limit, suspend */ }`.
- What each action does:
  - `warn`: notifies the user.
  - `limit`: blocks create, join and message.
  - `suspend`: revokes all the user's refresh tokens (access tokens stop working on the next request, because the suspended status is re-read) and cancels open plans they host.
  - `remove_content`: deletes the message, moderates the plan, or clears the bio and avatar, depending on what was reported.
  - `dismiss`: closes the report with no action.
- Returns: the report detail.
- Errors: `report_not_found`, `no_reported_user`.

### `POST /admin/reports/{reportId}/appeal`
Auth: Admin (moderator+).

- Body: `{ decision: 'uphold'|'overturn', reason }`. Overturning restores the account and records an `appeal_upheld` reliability event.
- Returns: the report detail.
- Errors: `no_open_appeal`.

### `GET /admin/users/{userId}`
Auth: Admin (moderator+).

- Returns:

```
{ id, phone, status, statusReason, statusUntil, createdAt, lastActiveAt,
  verification: { phone, ageSelfDeclaredAt, ageMethod, termsAcceptedAt },
  profile, stats: { xp, level, hosted, completed, noShows, blockedBy, reliability },
  entitlements, reportsAgainst, reportsFiled,
  audit: [{ id, action, actor, metadata, createdAt }] }
```

- Errors: `user_not_found`.

### `POST /admin/users/{userId}/status`
Auth: Admin (moderator+).

- Body: `{ status: 'active'|'limited'|'suspended', reason, durationDays? }`.
- Returns: `{ id, status }`.
- Errors: `user_not_found`.

### `GET /admin/audit`
Auth: Admin (moderator+). Paginated; default `limit` 50, maximum 200.

- Query: `entityType`, `entityId`, `action` (prefix match).
- Returns: `{ items: [{ id, action, entityType, entityId, actor: { type: 'admin'|'user'|'system', id, name? /* admin display name */, email: null }, metadata, ip, createdAt }], nextCursor }`. `metadata.reason` holds the admin's written reason.

### `GET /admin/activities`
Auth: Admin (moderator+). Paginated.

- Query: `queue=flagged|recent`. A plan is flagged when any of these is true:
  - it has an open report;
  - its category is elevated-risk;
  - the host is `limited`;
  - the host's reliability is below 0.7;
  - it is a late-night plan (23:00–05:00 IST).
- Returns: `{ items: [{ id, title, description, category, riskLevel, status, startsAt, area, venueName, venueType, latitude, longitude, capacity, joinedCount, host: { id, name, status, reliability }, reportCount, moderationNote, createdAt }], nextCursor }`.

### `POST /admin/activities/{activityId}/decision`
Auth: Admin (moderator+).

- Body: `{ decision: 'approve'|'remove', reason }`. Removing a plan moderates it and notifies the host and participants.
- Returns: `{ id, decision }`.
- Errors: `activity_not_found`.

### `GET /admin/billing/subscriptions`
Auth: Admin.

- Query: `q` (phone, user id, name or original transaction id).
- Returns: `{ items: [{ id, user: { id, name, phone }, store, productId, status, startedAt, expiresAt, transactionId, originalTransactionId, updatedAt }], nextCursor }`. No card data exists.

### `GET /admin/billing/campaigns`
Auth: Admin.

- Returns: `{ campaigns: [...with metrics], invoices: [{ id, business, planCode, amountMinor, currency, status, razorpayOrderId, razorpayPaymentId, createdAt, paidAt }], businesses: [{ id, name, kind, verificationStatus, contactEmail, createdAt }] }`.

### `POST /admin/billing/campaigns/{campaignId}/decision`
Auth: Admin. An extension: campaigns go live only after review.

- Body: `{ decision: 'approve'|'reject'|'pause', reason }`.
- Returns: `{ id, status }`.
- Errors: `campaign_not_found`.

### `POST /admin/businesses/{businessId}/verification`
Auth: Admin. An extension: venues appear in the app only after verification.

- Body: `{ decision: 'verify'|'reject'|'suspend', reason }`. The `reason` is shown to the business as `reviewNote` on `GET /business/venues/me`.
- Returns: `{ id, verificationStatus }`.
- Errors: `business_not_found`.

### `GET /admin/taxonomy/categories`
Auth: Admin.

- Returns: `{ items: [{ slug, label, short, pictogram, riskLevel, active, sortOrder, activityCount }] }`.

### `POST /admin/taxonomy/categories`
Auth: Admin.

- Body: `{ slug, label, short?, pictogram?, riskLevel?, sortOrder?, reason }`. `reason` is required (it is stored in the audit log), as on every admin write.
- Returns: `201` with the category.
- Errors: `conflict` (duplicate slug).

### `PATCH /admin/taxonomy/categories/{slug}`
Auth: Admin.

- Body: `{ label?, short?, pictogram?, riskLevel?, active?, sortOrder?, reason }`.
- Returns: the category.
- Errors: `category_not_found`.

### `GET /admin/taxonomy/areas`
Auth: Admin.

- Returns: `{ items: [{ id, city, name, active, latitude, longitude }] }`.

### `POST /admin/taxonomy/areas`
Auth: Admin.

- Body: `{ city, name, latitude, longitude, active?, reason }`.
- Returns: `201` with the area.

### `PATCH /admin/taxonomy/areas/{areaId}`
Auth: Admin.

- Body: `{ name?, active?, latitude?, longitude?, reason }`. Send `latitude` and `longitude` together.
- Returns: the area.
- Errors: `area_not_found`, `invalid_location`.

### `GET /admin/taxonomy/quests`
Auth: Admin.

- Returns: `{ items: [{ id, slug, kind, title, description, pictogram, criteria, xpReward, active, startsAt, endsAt, claims }] }`.

### `POST /admin/taxonomy/quests`
Auth: Admin.

- Body: `{ slug, kind: 'daily'|'weekly'|'milestone', title, description, pictogram?, criteria, xpReward /* 0–500 */, active?, startsAt?, endsAt?, reason }`.
- `criteria.type` is one of: `complete_activities`, `new_people`, `new_category`, `host_completed`, `early_activity`, `late_activity`, `category_completed`, `distinct_categories`, `reliability`. These are verified real-world actions only.
- Returns: `201` with the quest.
- Errors: `invalid_criteria`.

### `PATCH /admin/taxonomy/quests/{questId}`
Auth: Admin.

- Body: `{ title?, description?, pictogram?, xpReward?, active?, startsAt?, endsAt?, reason }`. `questId` is the id or the slug. Send `null` to clear `startsAt` or `endsAt`.
- Returns: the quest.
- Errors: `quest_not_found`.
