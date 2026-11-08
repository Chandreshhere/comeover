# Project IRL — project history & handoff

> Condensed log of the whole build (not a verbatim transcript), written on **8 Nov 2026**, so anyone — or any AI coding assistant — can clone this repo and continue exactly where it stopped.
> **This file intentionally contains no secrets, no phone number and no test code** (the repo is public). Section 6 says where each secret lives.

**Quick links**

| What | Where |
|---|---|
| Repo | https://github.com/Chandreshhere/comeover |
| Live API | https://comeover-api.onrender.com (health: `/healthz`, `/readyz`; REST base `/v1`; WebSocket `/ws`) |
| Live admin console | https://comeover-admin.vercel.app |
| Product spec | `prompt.md`, `0x_*.json/.sql/.csv`, `11_Product_Research_and_Implementation_Blueprint.docx` (repo root) |
| API reference | `backend/docs/API.md` (126 routes) |
| Porting notes | `backend/docs/PORTING.md` |

---

## 1. What this is

**Project IRL** — "Less scrolling. More living." A platonic, activity-first network for finding people to do real things with, nearby, soon. Not a dating app, not paid companionship, not a social feed. Plans have a time window, a public venue, a host and a capacity; people request to join; the host approves; a group chat opens; people meet, check in, confirm completion and earn XP.

Three folders:

| Folder | What | Stack |
|---|---|---|
| `mobile/` | iOS + Android app, 77 screens | React Native **0.76.5 CLI** (not Expo), JavaScript, React Navigation 7, Reanimated 3, zustand 5, Poppins font, original SVG art |
| `backend/` | API, auth, realtime, jobs | Node 20, Express 4, Mongoose 8 (**MongoDB**), `ws`, Docker |
| `admin/` | Moderation / ops console | Next.js 14 (App Router), JavaScript |

## 2. Timeline of the conversation (what was asked → what was done)

1. **"Read prompt.md and implement the work phase by phase"** (with a three-phone reference image). Read `prompt.md` and every spec file. Visual direction = the reference: periwinkle `#9CB9FF`, white cards, black pill buttons, pastel pink/orange, big rounded type. All art is original (mascot "Mo", 22 line pictograms, illustrated avatars, assistant orb) — nothing copied.
2. **Phase 0 – foundation:** design tokens + motion system from the spec, 15 shared components, navigation for every screen id in `03_screen_inventory.json` (deep links `projectirl://…`), store, API layer.
3. **Phase 1 – the three anchor screens:** Social Roadmap (left phone), Discover (middle), IRL Guide (right).
4. **User: "make on react native cli not expo"** → switched to a bare React Native CLI project with real `android/` and `ios/` folders; **"node is installed"** → the shell just didn't have Node on PATH (see §8).
5. **Phases 2–9 built in parallel by sub-agents:** onboarding · discovery/live radar/plan lifecycle · create flow/circles/chat · progress/SplitMate · profile/safety/notifications · premium/business hub · backend · admin web.
6. **User: "use all real apis"** → deleted all mock/demo code; real REST client, session storage in Keychain/Keystore, WebSocket client, FCM push, store billing, Razorpay, S3 uploads; endpoint reconciliation between apps and backend (every call matched).
7. **User: "push here https://github.com/Chandreshhere/comeover.git"** → Git was not installed; installed via `winget`, committed, pushed (GitHub sign-in via Git Credential Manager).
8. **User: "live the admin on vercel"** → Vercel project `comeover-admin` (root directory `admin`), auto-deploys on push to `main`.
9. **User: "we can make on mongo db? node as backend?"** → decided: **replace the AWS Lambda/PostgreSQL backend with Node + Express + MongoDB**, **OTP via Slide** (https://slide.synquic.com), Docker for hosting, old backend deleted. 126 routes, 48 models, WebSocket, jobs, 154 tests.
10. **Hosting:** MongoDB Atlas (created with the Atlas CLI), Render for the API, Vercel for the admin (see §4).
11. **User: "i'll do slide later… add mock data for test and add a fixed-code login for <owner phone>"** → (a) a **temporary fixed-code test login** for one number, and (b) a **demo-data seeder** (665 docs).
12. **Bugs found by testing against the live site** (all fixed): admin API URL had an invisible BOM (`\uFEFF`) → requests went to the wrong host (404); discovery radius was sent in metres but the API wants **km**; multi-category filter (`chai,run`) was rejected; circle-challenge and venue-offer response shapes; report reason codes aligned.
13. **History rewrite:** the owner's number + test code had been committed in a test file. I started a `git filter-branch` rewrite, then the owner said **"don't remove anything"** → fully cancelled, nothing was force-pushed. **The old commit `fd75765` still contains the number and code in public history** (the current files do not).
14. **Last request: "make nearby work"** → verified with the app's real store code against the live API: every radius × time filter, multi-category, map pan, nearby people, search — all pass.

## 3. Architecture in one page

```
 Phone (React Native)  ──REST /v1 + WS /ws──▶  Render: comeover-api (Docker, Node)  ──▶  MongoDB Atlas (db "irl")
 Admin (Next.js on Vercel) ──REST /v1──────────▶            │
                                                            ├─▶ Slide  (OTP over WhatsApp/SMS)        [key not set yet]
                                                            ├─▶ Anthropic (IRL Guide)                 [key not set yet]
                                                            ├─▶ S3-compatible storage (uploads)       [not set yet]
                                                            ├─▶ Razorpay (venue plans) / Apple / Google billing  [not set yet]
                                                            └─▶ FCM (push)                            [not set yet]
```

**Sign-in (Slide + our own tokens).** `POST /v1/auth/otp/request {phone}` → backend calls Slide `otp/send`; `…/otp/resend` → `otp/retry`; `…/otp/verify {requestId, code}` → Slide `otp/verify` + `otp/verify-token`; then we issue our own **HS256 access JWT (15 min)** and an **opaque rotating refresh token (30 days, reuse detection revokes the whole family)**. Roles (`admin`, `moderator`) live on the `User` document; grant with `grant-role`. The Slide key never leaves the server.

**Privacy rules enforced server-side:** other users only see coarse distance/area (~300 m snapping, distance bands); exact venue is revealed only to the host and accepted participants; 18+ gate; chat only after an accepted join; report/block never paywalled; XP only from mutually confirmed completion, deduplicated, daily-capped; SplitMate is a ledger + UPI hand-off only (no wallet, no custody).

**Realtime:** WebSocket at `/ws?token=<access JWT>`; channels `activity:{id}`, `conversation:{id}`, `user:{id}:notifications`; cross-instance fan-out through a MongoDB change stream.

**Money:** subscriptions go through App Store / Google Play (server verifies receipts); only the Venue/Club business plan uses Razorpay (order + signed webhook). No custody.

## 4. What is deployed (non-secret facts)

| Piece | Detail |
|---|---|
| **MongoDB Atlas** | Project `comeover`, cluster `Cluster0` (M0 free, AWS Mumbai `ap-south-1`, MongoDB 8), database `irl`, DB user `irl_api` (readWrite on `irl`). Network access currently `0.0.0.0/0`. |
| **Render** | Web service `comeover-api`, **Docker**, Singapore, **free plan** (sleeps after ~15 min idle → ~1 min cold start). Auto-deploys from `main`, building `backend/Dockerfile`; build filter `backend/**` (admin/mobile pushes don't rebuild it). Health check `/healthz`. |
| **Vercel** | Project `comeover-admin`, Root Directory `admin`, auto-deploys from `main`. One env var: `NEXT_PUBLIC_API_URL=https://comeover-api.onrender.com/v1`. |
| **GitHub** | `Chandreshhere/comeover`, branch `main`. |
| **Mobile config** | `mobile/src/config.env.json` already points at the live API (`API_URL`, `WS_URL`). |

## 5. Current state (verified 8 Nov 2026)

* Backend: **154/154 tests** pass (in-memory MongoDB), `npm run check` OK (126 routes documented, 0 missing contract operations), live smoke tests pass.
* Mobile: lint 0 errors / 0 warnings (190 files), **17/17 tests**, Android + iOS JS bundles build. **Never run on a physical device or emulator** (no Android SDK on the dev PC).
* Admin: production build passes; login page + API reachable on Vercel.
* Every mobile endpoint (90) and admin endpoint (21) exists on the backend.
* **Demo data is loaded in Atlas** (665 documents, 31 collections): 14 fake users (phones like `+910000000001` — invalid Indian numbers, can never receive SMS), 34 plans, chats, circles, expenses, reports, venues, campaigns, dashboard history. The owner's account has a full demo profile (level 4, 3-week streak…).
* **Sign-in works only for the owner's number via the temporary test login** (Slide credentials not added yet).

## 6. Secrets & settings — where they live (values are NOT in git)

| Secret / setting | Lives in | Notes |
|---|---|---|
| `MONGODB_URI` (contains the DB password) | Render env + local `backend/.env` | Password was generated by the Atlas CLI. If lost: Atlas → Database Access → edit user `irl_api` → new password → update Render + `.env`. |
| `JWT_SECRET` | Render env + local `backend/.env` | Changing it signs everyone out. |
| `CORS_ORIGINS` | Render env | `https://comeover-admin.vercel.app` (add `http://localhost:3001` for local admin dev). |
| `TEST_LOGIN_PHONE`, `TEST_LOGIN_CODE`, `TEST_LOGIN_EXPIRES_AT`, `TEST_LOGIN_ALLOW_PRODUCTION` | Render env | Temporary fixed-code login for **one** number. Expires **2026-11-16 00:00 IST** (`2026-11-15T18:30:00Z`). In production the server ignores it without the allow flag **and** a future expiry. |
| `SEED_TEST_PHONE` | local `backend/.env` | Which account gets the demo profile (the seeder and `reset-otp-limits.js` read it). |
| `SLIDE_API_KEY`, `SLIDE_OTP_WIDGET_ID` | **not set yet** — add to Render env | Slide dashboard → API keys / OTP. |
| `ANTHROPIC_API_KEY` | **not set yet** | Needed for the IRL Guide. |
| `S3_*`, `MEDIA_CDN_URL` | **not set yet** | Any S3-compatible store (AWS S3, Cloudflare R2, MinIO). |
| `RAZORPAY_*`, `APPLE_*`, `GOOGLE_*`, `FCM_PROJECT_ID`, `SLIDE_SMS_*` | **not set yet** | See `backend/.env.example` for every variable and comments. |
| Render API key / Vercel token / Atlas CLI login | the dev PC's CLI config only | Re-run `render login`, `vercel login`, `atlas auth login` on a new machine. |

**To recreate `backend/.env` on a new machine:** `cp backend/.env.example backend/.env`, then copy values from Render → `comeover-api` → **Environment**, and set `SEED_TEST_PHONE`.

## 7. How to run / operate

```bash
# --- Backend (local) ---
cd backend && npm install
cp .env.example .env            # fill MONGODB_URI (Atlas) + JWT_SECRET (>=32 chars) at minimum
node --env-file=.env src/server.js          # or: docker compose up -d   (Mongo 7 replica set + api; not yet run on this PC)
npm test                         # 154 tests, no external services needed
node scripts/check.js --strict   # routes ↔ docs ↔ contract
node --env-file=.env scripts/seed.js                 # taxonomy (categories, levels, quests, badges, areas) — idempotent
node --env-file=.env scripts/seed-demo.js            # demo data — idempotent
node --env-file=.env scripts/seed-demo.js --reset    # remove demo data
node --env-file=.env scripts/grant-role.js <phone> admin|moderator|none
node --env-file=.env scripts/reset-otp-limits.js     # clear the 3-codes-per-hour limit for SEED_TEST_PHONE

# --- Admin ---
cd admin && npm install && cp .env.example .env.local   # NEXT_PUBLIC_API_URL=https://comeover-api.onrender.com/v1
npm run dev        # http://localhost:3001      (npm run build && npm start for production)

# --- Mobile ---
cd mobile && npm install
npm run configure -- --api https://comeover-api.onrender.com/v1    # writes src/config.env.json (already done)
npm run link-assets                                                # Poppins fonts (already linked)
npm run android          # needs JDK 17 + Android SDK; add MAPS_API_KEY=... to android/local.properties
cd ios && bundle install && pod install && cd .. && npm run ios     # macOS only
npm run lint && npm test
```

**Deploying:** just `git push origin main` — Vercel redeploys the admin, Render redeploys the API (only when `backend/**` changed). Check a deploy: Render dashboard → `comeover-api` → Events, or `GET /readyz`.

**Git on the dev PC:** Git was installed with `winget install Git.Git`; auth is Git Credential Manager (browser sign-in once). A fresh clone elsewhere: `git clone https://github.com/Chandreshhere/comeover.git`, then `git pull` / `git add -A` / `git commit` / `git push`.

## 8. Lessons & gotchas (each one cost time)

* **Piping a value into `vercel env add` from Windows PowerShell adds a BOM** (`\uFEFF`) → the API URL became a relative path and every request 404'd. Set env vars through the Vercel REST API / dashboard, or pipe UTF-8 without BOM. The admin now also strips a BOM/whitespace.
* **Discovery `radius` is kilometres (0.2–25)**, not metres. The API returns 400 for anything bigger.
* **`category` on `GET /v1/activities` takes one slug or a comma list (max 10).**
* **OTP rate limit is 3 codes/hour per phone** (token bucket in Mongo). Repeated test sign-ins hit 429 → run `reset-otp-limits.js`.
* **Render free plan sleeps** (first request after ~15 min idle takes ~1 min). Upgrade to Starter (~$7/mo) or add a keep-alive ping before a live demo.
* **Node/Git were not on PATH in the Claude shell** even though installed — prefix `C:\Program Files\nodejs` and `C:\Program Files\Git\cmd`.
* **Docker is not installed on the dev PC** — `Dockerfile` is proven (Render builds it), `docker-compose.yml` is untested locally.
* **Seeded demo ids** are deterministic UUID-shaped (`de30de30-xxxx-8xxx-…`; version nibble 8 never occurs in the app's v4 ids) so `--reset` can only ever delete demo data.
* `react-native-iap` 12.x, `react-native-keychain` 9.x and `@react-native-firebase` 21.x are pinned because newer majors need RN ≥ 0.82 / Nitro.
* The template's `@react-native/eslint-config` fails to load; `mobile/.eslintrc.js` is a focused config that works.

## 9. Security notes — read before going public

1. **Test login is a deliberate backdoor** (fixed code for one number, admin role). It self-disables on 2026-11-16 00:00 IST, but until then anyone who knows the number **and** code can sign in as admin. **The number and code are still in the public git history (commit `fd75765`, file `backend/test/testlogin.db.test.js`)** because a history rewrite was started and then cancelled. Safest fix: change `TEST_LOGIN_CODE` on Render (instant), and/or rewrite history (`git filter-repo`/`filter-branch` + force-push; GitHub may keep the old commit reachable by hash).
2. Remove the test login for real use: delete the four `TEST_LOGIN_*` variables on Render and redeploy.
3. Atlas network access is `0.0.0.0/0` (Render free has no fixed outbound IP). Tighten when the host has a static IP.
4. Demo data exists in the production database — run `seed-demo.js --reset` before real users arrive.
5. Retention periods shown on the privacy screen (messages 12 months, account data 30 days) are placeholders — get them reviewed (India DPDP).

## 10. What remains (priority order)

**For a pitch / demo**
1. **Run the mobile app on a phone** — never done. Options: Android Studio on a dev machine, or set up a GitHub Actions workflow that builds an installable Android APK (untested; may need a few fix rounds). iOS needs a Mac + Apple developer account.
2. **Keep the API awake** (Render Starter, or a keep-alive ping) or open the site a couple of minutes before presenting.
3. **Add `ANTHROPIC_API_KEY`** so the IRL Guide (third anchor screen) can answer.
4. **Add Slide credentials** (`SLIDE_API_KEY`, `SLIDE_OTP_WIDGET_ID`) → real sign-in for everyone → then remove the test login.

**Before real users**
5. S3-compatible storage (profile photos, bill scans, venue proofs).
6. Google Maps API key (Android map screen; iOS uses Apple Maps).
7. Firebase config files (push): `android/app/google-services.json`, `ios/ProjectIRL/GoogleService-Info.plist`.
8. Razorpay keys (venue plans); App Store / Play subscriptions `irl_plus_monthly`, `irl_pro_monthly` + store keys (receipt verification).
9. Slide SMS sender ID + DLT-approved templates (trusted-contact SMS).
10. Legal review: privacy/terms, retention wording, grievance officer, age gate.
11. Small gaps: admin "Users" page is lookup-by-ID (no list-all endpoint); tighten Atlas network rules; delete the empty Atlas "Project 0"; `docker-compose.yml` untested locally.
12. Product: validate in one city (see the blueprint's 90-day plan), measure completed meetups, not installs.

## 11. Continue in a new AI session — paste this

```
Clone https://github.com/Chandreshhere/comeover and read HANDOFF.md first, then README.md in each folder
(mobile/, backend/, admin/). This is "Project IRL": React Native CLI app + Node/Express/MongoDB API
(deployed on Render, MongoDB Atlas) + Next.js admin (Vercel). Sign-in is phone OTP via Slide, plus a temporary
fixed-code test login for the owner's number (see HANDOFF.md §6, §9). Do NOT commit secrets, the owner's phone
number or the test code. Current priorities are in HANDOFF.md §10. Before changing anything run
`cd backend && npm test` and `cd mobile && npm run lint && npm test`. Deploys happen on `git push origin main`.
```

---

*Everything above reflects the project state on 8 Nov 2026 (HEAD at the time of writing: see `git log`).*
