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
| `npm run seed` | Idempotent taxonomy upserts |
| `npm run grant-role -- <phone> <admin\|moderator\|none>` | Admin console roles |

## Security rules carried over

- XP, payment state and entitlements are computed on the server only. Client values are never trusted.
- Idempotency keys apply to joins, expenses and payment callbacks. Rate limits cover OTP, plan creation, joins, chat, reports and uploads.
- Authorization is checked on every read and write. Other users only ever get approximate locations (a 300 m grid and distance bands).
- No card data, UPI PINs or bank passwords are stored. SplitMate is a ledger plus a UPI hand-off.
- The Slide API key never leaves the server. Refresh tokens are stored only as hashes, and reusing a rotated token revokes the whole sign-in.
- Filters are built from validated values only; never pass request objects straight into a MongoDB query.
