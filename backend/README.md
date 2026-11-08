# Project IRL backend

One AWS backend serves the mobile app (React Native CLI) and the admin web. Nothing in it is mocked: every handler talks to PostgreSQL and real AWS or third-party services. If a dependency isn't configured, the handler returns `503 *_not_configured`.

- **API reference** (endpoints, models, auth flow, realtime, error codes): [docs/API.md](docs/API.md)
- **Data model**: [db/migrations](db/migrations)
  - `001_init.sql` is `07_postgres_schema.sql` verbatim.
  - `002_extensions.sql` adds PostGIS, idempotency, moderation, realtime, progression, business and entitlements.
  - `003_seed.sql` holds taxonomy only: categories, levels, quests, badges and Ahmedabad areas.

## Architecture

```
Mobile app ──HTTPS──▶ API Gateway HTTP API (/v1, Cognito JWT authorizers) ──▶ Lambda (Node 20, arm64, in VPC)
           ──WSS────▶ API Gateway WebSocket (token-verified $connect)      ──▶ Lambda ws
Admin web  ──Hosted UI (admin pool, MFA)──▶ same HTTP API (AdminAuth, groups admin/moderator)
Lambdas ──▶ RDS Proxy ──▶ RDS PostgreSQL + PostGIS     (existing; credentials via Secrets Manager)
        ──▶ S3 media (private; presigned PUT/GET) + CloudFront (avatar/* only)
        ──▶ SQS jobs (+DLQ) ──▶ jobs Lambda: push (FCM v1 → Android + APNs), quest/badge evaluation, reliability, moderation alerts
        ──▶ EventBridge schedules: lifecycle (15 min), retention/DPDP purge (daily 03:00 IST)
        ──▶ Cognito (app pool: phone OTP via CUSTOM_AUTH triggers; SNS SMS with India DLT ids)
        ──▶ Claude API (IRL Guide), App Store Server API, Google Play Developer API, Razorpay (B2B invoices only)
```

Key decisions:

- **Phone OTP.** Cognito `CUSTOM_AUTH` with Define, Create and Verify triggers.
  - Codes are 6-digit, from `crypto.randomInt`. They expire after 5 minutes, allow 3 attempts per session, and use a constant-time compare.
  - Sends are rate-limited in Postgres (3 per phone per hour, 20 per IP per hour) and logged in `otp_attempts`.
  - The mobile app can call Cognito's public API directly (documented flow) or use the `/auth/*` proxy.
  - The PostAuthentication trigger provisions `app_users`.
- **Authorization** is enforced in SQL on every read and write. For example:
  - Chat requires an accepted join.
  - Only hosts can accept or cancel.
  - Capacity is enforced with `SELECT … FOR UPDATE`.
  - Blocks are filtered from discovery, messaging, circles and search.
- **Location privacy.**
  - Other people's plans are snapped to a ~300 m grid, and distances are banded.
  - Availability stores only a ~1.2 km geohash.
  - Proximity check-in coordinates are compared and then discarded.
- **XP** is server-only.
  - It is awarded on mutual completion or 2+ verified check-ins, or on quest claims.
  - It is de-duplicated through `xp_events.idempotency_key`, with a daily cap of 200.
  - Swipes, messages and joins earn nothing.
- **Payments.**
  - Subscriptions go through StoreKit / Play Billing with server-side verification, and entitlements are server-owned.
  - Venue/Club plans are billed through Razorpay orders, with HMAC-verified webhooks.
  - SplitMate is a **ledger plus UPI deep link only**: no wallet, custody or stored balances.
- **IRL Guide.** It uses `claude-opus-5-5` through `@anthropic-ai/sdk`:
  - Structured output (`output_config.format`), with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
  - Grounded in real plans from the database; ids it returns that weren't provided are dropped.
  - Dating and companionship intents are refused.
  - Per-user daily quota.
- **Realtime.** The envelope is `{type, channel, data, at}`. Event types are `message.created`, `join.updated`, `activity.updated` and `notification.created`.

## Prerequisites

- Node.js 20+, AWS SAM CLI, and Docker (for local Postgres and `sam local`).
- An AWS account with an **existing** VPC, RDS PostgreSQL 15+ with PostGIS, and an **RDS Proxy**. You pass these in as parameters.
  - The private subnets need **NAT egress**, or VPC endpoints for Secrets Manager, SQS, SNS, S3 and Cognito plus NAT for the third-party APIs.
  - The Lambda security group must reach the proxy on port 5432.
- In the region: SNS SMS sandbox exit, an origination identity, and **India DLT registration** (entity id and template id) for +91 delivery.

## Setup

```bash
npm install
npm run check        # loads every module, verifies template/routes/contract/docs coverage
npm test             # unit tests (no AWS/DB needed)
```

### Database

Locally:

```bash
docker compose up -d db
cp .env.example .env   # DATABASE_URL=postgres://irl:irl@localhost:5432/irl
DATABASE_URL=postgres://irl:irl@localhost:5432/irl npm run migrate
```

On RDS, run `npm run migrate` from a host inside the VPC with `DB_SECRET_ARN` and `DB_PROXY_ENDPOINT` set, or with `DATABASE_URL` pointing at the proxy. The migrations are idempotent and tracked in `schema_migrations`. `CREATE EXTENSION postgis` needs the `rds_superuser` role.

### Secrets (Secrets Manager, names must start with `irl/`)

| Secret | JSON | Used by |
|---|---|---|
| `irl/anthropic` | `{"apiKey":"sk-ant-..."}` | IRL Guide |
| `irl/razorpay` | `{"key_secret":"...","webhook_secret":"..."}` | Venue/Club invoices |
| `irl/apple-iap` | `{"issuerId":"...","keyId":"...","privateKey":"-----BEGIN PRIVATE KEY-----..."}` | App Store Server API |
| `irl/google-sa` | service-account JSON with Play Console + FCM access | Play verification + push |

### Deploy

```bash
npm run template                 # regenerate template.yaml from handler route tables
sam build
sam deploy --guided \
  --parameter-overrides Stage=dev PrivateSubnetIds=subnet-a,subnet-b LambdaSecurityGroupIds=sg-x \
    DbProxyEndpoint=irl.proxy-xxx.ap-south-1.rds.amazonaws.com DbSecretArn=arn:aws:secretsmanager:...:secret:rds!db-... \
    AlertEmail=ops@example.com ModerationEmail=safety@example.com \
    AnthropicSecretArn=arn:...:secret:irl/anthropic-xxxx RazorpayKeyId=rzp_live_... RazorpaySecretArn=arn:...:secret:irl/razorpay-xxxx \
    AppleIapSecretArn=arn:...:secret:irl/apple-iap-xxxx AppleRootCaSha256=<sha256 of AppleRootCA-G3> \
    GoogleServiceAccountSecretArn=arn:...:secret:irl/google-sa-xxxx GoogleRtdnToken=<random> \
    SmsDltEntityId=... SmsDltTemplateId=...
```

The stack outputs give the clients everything they need: `Region`, `UserPoolId`, `UserPoolClientId`, `HttpApiUrl` (which includes `/v1`), `WebSocketUrl`, `MediaBucket`, `MediaCdnUrl`, `CognitoDomain`, `AdminUserPoolId` and `AdminWebClientId`.

After deploying:

1. **Create admins.** In the admin pool, create users (email) and add each one to group `admin` or `moderator`. TOTP MFA is enforced on first sign-in.
2. **Point the providers' webhooks at the API.** Each entry is the provider, the URL to register, and the shared secret:

   | Provider | URL | Secret |
   |---|---|---|
   | Razorpay | `{HttpApiUrl}/webhooks/razorpay` | `webhook_secret` |
   | App Store Server Notifications V2 | `{HttpApiUrl}/webhooks/apple` | none |
   | Google Play RTDN (Pub/Sub push) | `{HttpApiUrl}/webhooks/google?token=<GoogleRtdnToken>` | `GoogleRtdnToken` |

3. **Maintenance mode.** Set the env var `MAINTENANCE_MODE=true` (and optionally `MAINTENANCE_MESSAGE`) on the HTTP Lambdas. App endpoints then return `503 maintenance`; admin endpoints and webhooks keep working.

### Local API

`sam local start-api --env-vars env.json` runs the HTTP API locally. Authorizers aren't enforced by SAM local, so send requests whose `requestContext.authorizer.jwt.claims.sub` matches an `app_users.cognito_sub`. For handler-level debugging, the unit tests show how to invoke routers with synthetic events.

## Security rules (from 08_api_contract.json) and where they're enforced

| Rule | Enforcement |
|---|---|
| Never trust client XP or payment status | `src/lib/xp.js` (server rules, idempotent, capped). Store purchases are re-verified with Apple/Google, and Razorpay with HMAC. SplitMate states are labelled `bankVerified:false`. |
| Idempotency keys for joins, expenses and payment callbacks | `src/lib/idempotency.js` (per-user `Idempotency-Key`). Webhooks are deduplicated in `webhook_events`. |
| Row/resource authorization on every read and write | SQL predicates in every handler (`VISIBLE_TO_VIEWER`, `NOT_BLOCKED`, membership checks, host-only checks) |
| Approximate location only | `src/lib/geo.js` and `services/activities.present`. Availability stores a geohash only. |
| Rate limits on OTP, create-plan, join, chat and report | `src/lib/rateLimit.js` (Postgres token bucket) plus API Gateway throttling |
| No card credentials, UPI PINs or bank passwords | None are ever accepted. Payments go through store billing, Razorpay Checkout, or a UPI deep link to the user's own app. |

## Cost controls

- Functions are arm64 Lambdas with a small pool per container (`DB_POOL_MAX=2`) behind RDS Proxy; no NAT-heavy polling.
- SQS batching, an `AWS::Budgets` alert at 80% actual and 100% forecast, and alarms on DLQ depth and API 5xx.
- S3 lifecycle rules: incomplete uploads are aborted, bills expire after 400 days, and data exports after 7 days. Only avatars go through CloudFront.
- Retention job: idempotency keys after 24 h, OTP logs after 30 days, read notifications after 180 days, webhook logs after 90 days, and deleted accounts are anonymised after 30 days.
- IRL Guide: `effort: low`, `max_tokens` 2000, 25 plans of context, per-user daily quota, and a 12 s timeout with 1 retry.

## Layout

```
src/handlers/   auth, profile, discovery, activities, messaging, circles, progress, expenses,
                monetization, safety, assistant, webhooks, admin, ws, jobs, cognito/triggers
src/services/   activities (shared queries/presenter/create), progress (stats, quests, streaks), safety
src/lib/        http, validate, db, auth, idempotency, rateLimit, geo, xp, quests, split, entitlements,
                present, page, media, notify, realtime, queue, push, googleAuth, anthropic, audit, aws,
                payments/{razorpay,appstore,playstore}
infra/          template.base.yaml + template.outputs.yaml (scripts/build-template.js generates template.yaml)
scripts/        migrate, check, build-template
test/           node:test unit tests
```
