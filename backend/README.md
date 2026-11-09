# Project IRL backend

One Node.js server on MongoDB serves the mobile app (React Native CLI) and the admin web. It ships as a Docker image that runs on any host. Nothing in it is mocked: every handler talks to MongoDB and real third-party services, and a dependency that isn't configured returns `503 *_not_configured`.

- **API reference** (endpoints, models, auth flow, realtime, error codes): [docs/API.md](docs/API.md)
- **Porting notes** for the handlers still being moved from the old AWS/PostgreSQL code: [docs/PORTING.md](docs/PORTING.md)

## Stack

| Concern | Choice |
|---|---|
| HTTP API | Express 4, base path `/v1`, JSON only |
| Database | MongoDB 7 (Mongoose 8). Must be a **replica set** (Atlas, or the `rs0` container) for transactions and change streams |
| Sign-in | Phone OTP via [Slide](https://slide.synquic.com) (WhatsApp first, SMS fallback), then our own JWT access tokens (15 min) and rotating refresh tokens (30 days) |
| Admin access | `admin` / `moderator` roles on the user, granted with `npm run grant-role` |
| Realtime | `ws` on `wss://<host>/ws`; multiple instances fan out through a MongoDB change stream |
| Jobs | MongoDB-backed queue + `node-cron` schedules (one instance wins each slot) |
| Media | S3-compatible storage (AWS S3, Cloudflare R2, MinIO) with presigned uploads |
| IRL Guide | Claude API (`ANTHROPIC_API_KEY`) |
| Payments | Apple / Google receipt verification for subscriptions; Razorpay only for Venue/Club invoices (no wallet, no custody) |
| Push | FCM HTTP v1 (iOS through APNs) with a Google service account |

## Run locally

Prerequisites: Docker, or Node ≥ 20 plus a MongoDB replica set.

```bash
cp .env.example .env
#   JWT_SECRET            openssl rand -base64 48
#   SLIDE_API_KEY         Slide dashboard → API keys (sk_test_… or sk_live_…)
#   SLIDE_OTP_WIDGET_ID   Slide dashboard → OTP → widget (channels: WhatsApp, then SMS)

docker compose up -d --build                                  # API on :8080, MongoDB rs0 on :27017
docker compose exec api npm run seed                          # categories, levels, quests, badges, city areas
docker compose exec api npm run grant-role -- 98XXXXXXXX admin   # your phone → admin console access
curl localhost:8080/readyz
```

Without Docker: run any MongoDB replica set, set `MONGODB_URI`, then `npm install && npm run seed && npm run dev`.

## Deploy (any Docker host)

1. **Database:** create a MongoDB Atlas cluster (Mumbai `ap-south-1` is closest to the pilot) and set `MONGODB_URI`.
2. **Image:** build and push it with `docker build -t <registry>/irl-api .`. Run it on ECS/App Runner, Render, Railway, Fly or a VM, with the variables from `.env.example`.
3. **Routing:** put it behind HTTPS. The load balancer must allow WebSocket upgrades on `/ws`, and its idle timeout should be above 60 s.
4. **Seed:** run `npm run seed` once against the production database, then `npm run grant-role -- <phone> admin`.
5. **Clients:**
   - Mobile: `npm run configure -- --api https://<host>/v1`
   - Admin web: `NEXT_PUBLIC_API_URL=https://<host>/v1`, with the admin origin added to `CORS_ORIGINS`.
6. **Webhooks:** point Razorpay at `https://<host>/v1/webhooks/razorpay`, Apple App Store Server Notifications at `/v1/webhooks/apple`, and Google Play RTDN (Pub/Sub push) at `/v1/webhooks/google?token=<GOOGLE_RTDN_TOKEN>`.

Health: `GET /healthz` (process) and `GET /readyz` (MongoDB + realtime mode). Logs are JSON (pino) on stdout, with phone numbers, OTPs and tokens redacted.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run dev` | Start the server (dev restarts on change) |
| `npm test` | Unit tests plus MongoDB tests on an in-memory replica set (`mongodb-memory-server` downloads `mongod` on first run) |
| `npm run smoke` | Boots the real server against in-memory MongoDB with Slide mocked, then checks health, OTP sign-in, refresh rotation and the WebSocket |
| `npm run check` | Every mounted route is documented in `docs/API.md`; reports routes still to port (`--strict` fails on them) |
| `npm run seed` | Idempotent taxonomy upserts (resets seeded fields, e.g. category labels, to the values in `scripts/seed.js`) |
| `node --env-file=.env scripts/seed.js --only-missing` | Adds taxonomy entries that don't exist yet (e.g. new categories) and never overwrites admin-console edits — use this on a live database |
| `npm run seed:demo` / `npm run seed:demo:reset` | Load / remove demo data for testing (see "Demo data") |
| `npm run grant-role -- <phone> <admin\|moderator\|none>` | Admin console roles |

## Demo data

Realistic test data so the mobile app and the admin console have something to show before real users exist. It is idempotent, and it can be removed again.

Put the phone of the account that should get the completed demo profile in your **private** `.env` first (never commit it): `SEED_TEST_PHONE=98xxxxxxxx` (it falls back to `TEST_LOGIN_PHONE`). The account is found by phone and keeps its own id and roles.

```bash
node --env-file=.env scripts/seed-demo.js                          # load (re-run any time to refresh the dates)
node --env-file=.env scripts/seed-demo.js --test-user-owns-venue   # also give the test account a verified venue
node --env-file=.env scripts/seed-demo.js --reset                  # remove all demo data
```

The same commands exist as `npm run seed:demo` and `npm run seed:demo:reset` (pass `-- --test-user-owns-venue` to the first). The script prints the database host (never the credentials) before it writes anything. It loads the taxonomy (categories, levels, quests, badges, city areas) only if it is missing and never overwrites edits made in the admin console.

**What you get** (about 700 documents; every date is relative to the moment you run it):

- **People:** 14 demo users with fake `+91000000000x` numbers. These are not valid Indian mobile numbers, so no SMS can ever reach anyone. One is *limited* and one is *suspended*, for the admin console.
- **Plans (34):** live now, tonight, tomorrow and the weekend; one full with a waitlist, one sponsored (campaign + partner venue), one circle-only, one invite-only, three flagged for review, one cancelled, and 17 completed or cancelled plans spread over the last 30 days so the admin charts look real.
- **The test account (`SEED_TEST_PHONE`):** its profile is completed and onboarding marked done. It hosts one plan with two pending requests, is accepted into two plans (one starts within the 30-minute check-in window), has one request pending, is waitlisted in one, and has three completed plans. Roles and id are never changed.
- **Around it:** 7 chats with unread messages (including one direct chat), 5 circles with a challenge (the test account owns one), 3 SplitMate expenses covering every payment state, 8 notifications, XP / level 4 / a 3-week streak, a quest ready to claim and 3 badges.
- **Admin console:** 10 reports (urgent to low) with actions and 2 open appeals, 3 plans in the review queue, ~30 audit events, 5 paid subscriptions, 10 verified partner venues (7 in Ahmedabad, 3 in Indore: Vijay Nagar, Palasia / 56 Dukan, Bhawarkua) with 16 level-unlocked perks, 8 confirmed partner visits and 2 table holds, 3 campaigns with 14 days of metrics and invoices.

**Ids.** Demo documents have deterministic ids that look like `de30de30-xxxx-8xxx-…` ("de30" is "demo" in hex). They are valid UUIDs because the API validates ids in request bodies as UUIDs (blocking, reporting, SplitMate, direct chat). Version-8 UUIDs never occur among the random version-4 ids the app generates, so `--reset` can only ever match demo data.

**Reset** deletes every document with a demo id in every collection, plus rows created *by using the app on demo content* (for example a join request you made on a demo plan). It never touches real users, real plans, the taxonomy or the auth sessions. For the test account it zeroes the progress (XP, quests, badges, availability) and keeps the profile and admin role.

## Security rules carried over

- XP, payment state and entitlements are computed on the server only. Client values are never trusted.
- Idempotency keys apply to joins, expenses and payment callbacks. Rate limits cover OTP, plan creation, joins, chat, reports and uploads.
- Authorization is checked on every read and write. Other users only ever get approximate locations (a 300 m grid and distance bands).
- No card data, UPI PINs or bank passwords are stored. SplitMate is a ledger plus a UPI hand-off.
- The Slide API key never leaves the server. Refresh tokens are stored only as hashes, and reusing a rotated token revokes the whole sign-in.
- Filters are built from validated values only; never pass request objects straight into a MongoDB query.
