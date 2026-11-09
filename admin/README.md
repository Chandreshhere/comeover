# IRL Admin — moderation & operations console

Next.js 14 (App Router, JavaScript) web console for Project IRL trust & safety, operations and configuration. It uses the same design tokens as the mobile app (`02_design_tokens.json`): periwinkle hero surfaces, white 24 px cards, black pill buttons, pastel accents and Poppins.

The console talks **only** to the real Project IRL API (Node + MongoDB). There is no mock data. If `NEXT_PUBLIC_API_URL` is missing, every page shows **Configuration required**.

## Setup

```bash
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL
npm install
npm run dev                  # http://localhost:3001
npm run build && npm start   # production
```

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API base URL **including `/v1`**, e.g. `https://api.your-domain.com/v1` |

`NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them. The API must list this origin in `CORS_ORIGINS` and allow the `Authorization`, `Content-Type` and `Idempotency-Key` headers.

### Granting access

Admins sign in with their phone number. Grant a role on the server:

```bash
cd ../backend && npm run grant-role -- +919876543210 admin      # or: moderator
```

A user without either role can sign in but sees "No admin role".

## Auth flow

1. `/login` asks for a phone number and calls `POST /v1/auth/otp/request`. The API sends a one-time code through [Slide](https://slide.synquic.com), over WhatsApp or SMS depending on the Slide OTP widget. The code can be resent, or switched between WhatsApp and SMS, with `POST /v1/auth/otp/resend`.
2. The code is checked with `POST /v1/auth/otp/verify`, which returns an access token (short-lived JWT with `sub` and `roles`) and a refresh token. The console then loads `GET /v1/admin/me` for name and role.
3. Tokens are kept in `sessionStorage` and cleared when the tab closes. The access token is refreshed with `POST /v1/auth/session/refresh` 60 s before expiry, and again on any 401 (one retry). The refresh token rotates on each use. If refresh fails, the session is cleared and the user goes to `/login?expired=1`.
4. Sign out calls `POST /v1/auth/logout` (which revokes the refresh token) and returns to `/login?signedout=1`.
5. The role shown in the UI comes from the server. The backend enforces authorization on every route; the UI only hides what a role can't use.

| Area | admin | moderator |
| --- | --- | --- |
| Dashboard (KPIs) | ✓ | No |
| Reports, appeals | ✓ | ✓ |
| Activity review | ✓ | ✓ |
| Users (view / status) | ✓ | ✓ |
| Users directory search | ✓ | No |
| Audit log | ✓ | ✓ |
| Partners, announcements | ✓ | No |
| Billing support | ✓ | No |
| Taxonomy & quests | ✓ | No |

Nav items are hidden per role, and each route is guarded: a moderator opening `/admin/billing` sees "No access". After sign-in, admins land on the dashboard and moderators on the reports queue.

## API contract used

The base is `NEXT_PUBLIC_API_URL` (already `/v1`).

- Every request sends `Authorization: Bearer <access token>`.
- Mutations also send `Idempotency-Key` (reused on the post-refresh retry).
- Errors are expected as JSON `{ code, message, details? }`.
- Lists are expected as `{ items, nextCursor }`, and the console paginates with "Load more" (`?cursor=`).

| Screen | Calls |
| --- | --- |
| Dashboard | `GET /admin/insights?range=7d\|30d\|90d` · `GET /admin/kpis?range=7d\|30d` (plan liquidity, urgent reports) |
| Users list | `GET /admin/users?q&status&sort&cursor` (admin; phones masked) |
| Partners | `GET /admin/businesses?status&cursor` · `POST /admin/businesses/{id}/verification` · `GET /admin/offers?status&cursor` · `POST /admin/offers/{id}/status {status, reason}` · `GET /admin/redemptions?cursor` |
| Announcements | `POST /admin/announcements {title, body, audience, deepLink?, dryRun?, reason}` · `GET /admin/announcements` |
| Reports list | `GET /admin/reports?status&cursor` |
| Report review | `GET /admin/reports/{id}` · `POST /admin/reports/{id}/actions {action: warn\|limit\|suspend\|remove_content\|dismiss, reason, durationDays?}` · `POST /admin/reports/{id}/appeal {decision: uphold\|overturn, reason}` · `GET /admin/audit?entityType=report&entityId={id}&cursor` |
| User detail | `GET /admin/users/{id}` · `POST /admin/users/{id}/status {status: active\|limited\|suspended, reason}` · `GET /admin/audit?entityType=user&entityId={id}&cursor` |
| Activity review | `GET /admin/activities?queue=flagged\|recent&cursor` · `POST /admin/activities/{id}/decision {decision: approve\|remove, reason}` |
| Audit log | `GET /admin/audit?entityType&entityId&cursor` |
| Billing | `GET /admin/billing/subscriptions?q` · `GET /admin/billing/campaigns` |
| Taxonomy | `GET\|POST /admin/taxonomy/categories` · `PATCH /admin/taxonomy/categories/{slug}` · `GET\|POST /admin/taxonomy/areas` · `PATCH /admin/taxonomy/areas/{id}` · `GET\|POST /admin/taxonomy/quests` · `PATCH /admin/taxonomy/quests/{id}` |

Request bodies this console sends (camelCase), which the backend should accept:

- Category: `POST {slug, label, riskLevel, isActive, reason}` · `PATCH {riskLevel?, isActive?, reason}`
- Area: `POST {city, name, latitude, longitude, active, reason}` (area centroid) · `PATCH {active, reason}`
- Quest: `POST|PATCH {slug, title, description, criteria, xpReward, startsAt, endsAt, active, reason}`

Response shapes aren't final, so `lib/normalize.js` reads both camelCase and snake_case (e.g. `reasonCode` / `reason_code`, `riskLevel` / `risk_level`) and nested objects. Missing fields render as "n/a". The dashboard reads `GET /admin/insights` (see backend `docs/API.md`); every panel has an empty state and a table view. Charts are inline SVG in `components/charts.js` (no chart library, solid colours only); the palette is validated for colour-vision deficiency against the white card surface.

**Users** is a searchable directory for admins (name, exact id, or the last 4 phone digits; status tabs; newest or recently active), plus the id lookup and a per-tab "recently viewed" list that moderators also get.

## States

Every data view handles:

- Loading: skeletons.
- Empty: a friendly empty state.
- Error: message, server `code` and **Retry**.
- 401: "Session ended" with **Sign in**, plus an automatic redirect after a failed refresh.
- 403: "Not permitted", with the server message.
- 404: "Not found".
- Network or CORS failure: an explicit hint.

## Structure

```
app/
  layout.js                 Poppins + global tokens
  login/                    phone OTP sign-in (Slide via the API), WhatsApp/SMS resend
  admin/layout.js           Shell: config gate, session, role nav, route guard
  admin/page.js             role-aware landing
  admin/dashboard/          insights dashboard (admin)
  admin/partners/           business review, offers, redemptions (admin)
  admin/announcements/      compose, audience check, send, history (admin)
  admin/users/              member directory (admin) and id lookup
  admin/reports/[id]/       report review, enforcement, appeal, audit trail
  admin/users/[id]/         user record, status changes, audit trail
  admin/activities/         flagged / recent plan review
  admin/audit/              global audit log
  admin/billing/            subscriptions & campaigns (read-only, admin)
  admin/taxonomy/           categories, city areas, quests (admin)
components/                 Shell, ActionDialog (reason required), AuditList, charts, SlaTimer, ui
lib/
  config.js                 env + missing-config detection
  auth.js                   OTP sign-in, token storage/rotating refresh, logout, roles/permissions
  api.js                    fetch client + endpoint map
  normalize.js              defensive response normalisers
  format.js                 formatting, reason labels, SLA hours by priority
```

## Policy notes

- Every enforcement, status change and taxonomy edit needs a written reason (at least 10 characters), which is sent to the API for the audit log.
- Billing is read-only and shows no card or UPI data. Refunds happen in the stores.
- Quest criteria that reference messages, likes, swipes or app time are rejected client-side. The server must enforce this too.
- Review SLA by report priority: urgent 1 h · high 4 h · normal 24 h · low 72 h. A server-provided `slaDueAt` wins.
