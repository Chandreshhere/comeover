# IRL Admin — moderation & operations console

Next.js 14 (App Router, JavaScript) web console for Project IRL trust & safety, operations and configuration. It uses the same design tokens as the mobile app (`02_design_tokens.json`): periwinkle hero surfaces, white 24 px cards, black pill buttons, pastel accents and Poppins.

The console talks **only** to the real backend and Amazon Cognito. There is no mock data. If configuration is missing, every page shows **Configuration required**, listing each variable and whether it is set.

## Setup

```bash
cp .env.example .env.local   # fill in all five values
npm install
npm run dev                  # http://localhost:3001
npm run build && npm start   # production
```

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Backend `HttpApiUrl` stack output, **including `/v1`** |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Hosted UI domain, e.g. `https://irl-admin.auth.ap-south-1.amazoncognito.com` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Admin app client id (public client, **no secret**) |
| `NEXT_PUBLIC_COGNITO_REDIRECT_URI` | `https://<host>/auth/callback` — must be an allowed callback URL |
| `NEXT_PUBLIC_COGNITO_LOGOUT_URI` | `https://<host>/login?signedout=1` — must be an allowed sign-out URL |

`NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them. The API must allow this origin in CORS, with `Authorization`, `Content-Type` and `Idempotency-Key` headers.

### Cognito app client

- OAuth flow: **Authorization code grant** with PKCE (S256). Scopes: `openid email profile`.
- Groups: **`admin`** and **`moderator`**. A user in neither group can sign in but sees "No admin role".
- Recommended: MFA required and a separate admin user pool, or at least a separate app client, from the consumer app.

## Auth flow

1. `/login` generates a PKCE verifier and state, stores them in `sessionStorage`, and redirects to `{domain}/oauth2/authorize`. It auto-redirects unless the user just signed out, the session expired, or an error came back.
2. `/auth/callback` checks `state` and exchanges the code at `{domain}/oauth2/token` (`grant_type=authorization_code` + `code_verifier`).
3. Tokens (`id`, `access`, `refresh`) are kept in `sessionStorage` and cleared when the tab closes. The access token is refreshed with `grant_type=refresh_token` 60 s before expiry, and again on any 401 (one retry). If refresh fails, the session is cleared and the user is sent to `/login?expired=1`.
4. Sign out clears tokens and redirects to `{domain}/logout?client_id&logout_uri`.
5. The role comes from the ID token's `cognito:groups`. The ID token is only decoded, not verified, client-side. The backend must verify the access token and enforce authorization on every route; the UI only hides what a role can't use.

| Area | admin | moderator |
| --- | --- | --- |
| Dashboard (KPIs) | ✓ | — |
| Reports, appeals | ✓ | ✓ |
| Activity review | ✓ | ✓ |
| Users (view / status) | ✓ | ✓ |
| Audit log | ✓ | ✓ |
| Billing support | ✓ | — |
| Taxonomy & quests | ✓ | — |

Nav items are hidden per role, and each route is guarded: a moderator opening `/admin/billing` sees "No access". After sign-in, admins land on the dashboard and moderators on the reports queue.

## API contract used

The base is `NEXT_PUBLIC_API_URL` (already `/v1`).

- Every request sends `Authorization: Bearer <access token>`.
- Mutations also send `Idempotency-Key` (reused on the post-refresh retry).
- Errors are expected as JSON `{ code, message, details? }`.
- Lists are expected as `{ items, nextCursor }`, and the console paginates with "Load more" (`?cursor=`).

| Screen | Calls |
| --- | --- |
| Dashboard | `GET /admin/kpis?range=7d\|30d` |
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

Response shapes aren't final, so `lib/normalize.js` reads both camelCase and snake_case (e.g. `reasonCode` / `reason_code`, `riskLevel` / `risk_level`) and nested objects. Missing fields render as "—". The KPI page renders whichever of these sections are present: `northStar`, `metrics` (array or object), `moderation`, `funnel`, `retention`, `clusters`. If none are present, it shows the raw response.

There is no `GET /admin/users` list endpoint, so **Users** is an id lookup plus a per-tab "recently viewed" list. Users are normally opened from reports, activities or audit entries.

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
  login/                    starts Cognito Hosted UI (PKCE)
  auth/callback/            code → token exchange
  admin/layout.js           Shell: config gate, session, role nav, route guard
  admin/page.js             role-aware landing
  admin/dashboard/          KPIs (admin)
  admin/reports/[id]/       report review, enforcement, appeal, audit trail
  admin/users/[id]/         user record, status changes, audit trail
  admin/activities/         flagged / recent plan review
  admin/audit/              global audit log
  admin/billing/            subscriptions & campaigns (read-only, admin)
  admin/taxonomy/           categories, city areas, quests (admin)
components/                 Shell, ActionDialog (reason required), AuditList, charts, SlaTimer, ui
lib/
  config.js                 env + missing-config detection
  auth.js                   PKCE, token storage/refresh, logout, roles/permissions
  api.js                    fetch client + endpoint map
  normalize.js              defensive response normalisers
  format.js                 formatting, reason labels, SLA hours by priority
```

## Policy notes

- Every enforcement, status change and taxonomy edit needs a written reason (at least 10 characters), which is sent to the API for the audit log.
- Billing is read-only and shows no card or UPI data. Refunds happen in the stores.
- Quest criteria that reference messages, likes, swipes or app time are rejected client-side. The server must enforce this too.
- Review SLA by report priority: urgent 1 h · high 4 h · normal 24 h · low 72 h. A server-provided `slaDueAt` wins.
