# Architecture

How the Church Hub is built and how its parts fit together. Read this before proposing a
structural change. Related: [database.md](database.md), [api.md](api.md),
[permissions.md](permissions.md), [features.md](features.md).

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 22.13 (ES modules) | `package.json` → `"type": "module"` |
| Web server | Express 5 | The **only** runtime dependency. Keep it that way unless a dependency clearly earns its place (see [development.md](development.md)). |
| Database | SQLite via Node's built-in `node:sqlite` | One file (`MB_DB`, `/data/meadowbrook.db` on Render), WAL mode, foreign keys on. Nothing native to compile. |
| Front end | Plain JavaScript modules, no framework, no build step | `html` tagged templates from `public/js/lib.js` render escaped HTML. CSS is hand-written with custom properties. |
| Tests | `node:test` | `npm test` (API, end-to-end against in-memory SQLite), `npm run test:ui` (browser smoke, needs Playwright, see [development.md](development.md)). |
| Hosting | Render, one Docker container (`Dockerfile`) with a persistent disk at `/data` | DB, uploads and local backup copies live on the disk. `GET /healthz`. |

## Three front ends, one server

| App | Entry | Who | Router |
|---|---|---|---|
| **Hub** (staff dashboard) | `public/app.html`, `public/js/app.js` | Volunteers up to admins | Hash router: `ROUTES` in `app.js` → `public/js/pages/<page>.js` (lazy `import()`) |
| **Member app** (PWA) | `public/app/index.html`, `public/js/member/main.js` | Everyone, including guests with no account | Hash router in `member/main.js`; tabs and the widget home screen come from App Builder config |
| **Kids' check-in** | `public/checkin.html`, `public/js/checkin.js` | Leaders, or iPads paired as stations | Single page; `public/js/checkin-rules.js` is shared with the server |

Smaller pages: `login.html`, `respond.html` (accept/decline from an email link), `give.html`
(guest giving), `privacy.html`. The service worker `public/sw.js` caches the check-in app and
handles push notifications. The member app can live at its own address (`MB_APP_URL`, e.g.
`app.<church>.church`) and always at `/app/`.

Shared front-end modules worth knowing before writing UI: `lib.js` (api calls with the `x-mb`
header, `html`/`mount`, icons, dialogs, toasts, dates, `chips`, `pickPerson`), `plan.js`
(order-of-service timeline), `chat.js`, `tasks.js`, `give.js`, `myschedule.js`, `push.js`,
`video.js` (YouTube and Mux players), `search.js`, `app-widgets.js` (shared with the server).

## Server layout (`server/`)

| File | Role |
|---|---|
| `index.js` | Builds the Express app (`createApp({ db, uploadDir, now })`; `now` is an injectable clock, used by Classes so tests can fix "today"), mounts every router under `/api`, serves static files and the pages, and when run directly starts the **background timers** (below). |
| `db.js` | `MIGRATIONS` (append-only), `openDb`, `tx`, `getSetting`/`setSetting` (key–value JSON in `settings`), `updateFields`. |
| `auth.js` | Sessions (cookie `mb_session`), `loadUser`, `requireRole`, `canCampus`, `campusFilter`, `requireAppHeader`, Google OAuth, email codes and passwords, sign-in policy, Google Drive connect. |
| `http.js` | `HttpError`, `bad`/`notFound`/`forbidden`, input helpers (`int`, `str`, `required`, `oneOf`, `isDate`), `audit`, `localNow`, the error handler. |
| `routes/*.js` | One router per area (see [api.md](api.md)). Each exports `default function xRoutes(db, opts)`. |
| `notify.js` / `push.js` / `mail.js` | Inbox notifications, Web Push (own VAPID keys, no paid service), SMTP email. |
| `stripe.js` | Stripe calls (giving, event payments) and webhook verification. |
| `daily.js` / `live.js` | Video calls in chats (Daily), live chat updates (server-sent events). |
| `media.js` / `mux.js` / `podcast.js` | YouTube sync and live detection, Mux streaming/uploads/trims, podcast audio and feed. |
| `backup.js` | Encrypted nightly backups to the disk and Google Drive. |
| `classes.js` | Rules for Classes that need no request: marking a quiz, whether a make-up is open, how fast video credit may grow, question checks. Pure, so tests use fixed dates. |
| `csv.js` | CSV parsing/writing for imports and exports. |

## A request, end to end

1. `express.json` → `loadUser(db)` attaches `req.user` (or `null`) from the session cookie.
2. `requireAppHeader`: any non-GET request must carry `x-mb: 1` (blocks cross-site forgery).
3. `/api` router: `stationAuth` first (paired iPads may use check-in only), then each area's router.
4. Route guard: `requireRole('leader')`, a permission flag (`requireFinance`,
   `req.user.announce`), then campus scoping with `canCampus` / `campusFilter`.
5. Validation with `http.js` helpers; errors thrown as `HttpError` become JSON `{ error }`
   with friendly, plain-English messages that the UI shows as-is.
6. Writes that matter are recorded with `audit(db, req, action, detail)`.

## Background work (`server/index.js`, only when started as the server)

| Every | Job |
|---|---|
| 15 min | Volunteer serving reminders, task reminders |
| 1 min | Video-call housekeeping, scheduled announcements, Mux check (live state, recordings, uploads, trims, podcast audio) |
| 2 min | YouTube live check (around service times) |
| 1 hour | YouTube channel sync |
| 10 min | Nightly backup check (runs once a day after 3 a.m. church time) |

Jobs are idempotent and guarded so overlapping runs don't double up (`running ||= …`). Tests
call them directly instead of waiting.

## Integrations

All optional; each turns on with environment variables and has a test override so tests use
stand-in servers. Details and setup are in [api.md](api.md) and the README.

Google (sign-in, Drive backups) · SMTP email · Web Push · Stripe (giving, event payments) ·
Daily (video calls) · YouTube (Data API optional) · Mux (live, recordings, uploads, podcast
audio) · Render (hosting).

## Deployment

- `Dockerfile` (node:22-slim, `npm ci --omit=dev`), `PORT=8090`, `MB_DB=/data/meadowbrook.db`,
  `MB_UPLOADS=/data/uploads`. Render redeploys on every merge to `main`.
- Secrets live **only** in Render's environment settings (see [security.md](security.md)).
- `MB_TRUST_PROXY=2` on Render (Cloudflare edge + load balancer) so secure cookies work and rate limits see each visitor's address.
- Migrations run automatically on start (`openDb` → `migrate`).

## Multi-church (SaaS) readiness

Today each church runs its **own copy** of the hub: one deployment, one database, one set of
secrets. That is real isolation, and it is the supported model for now. Multi-tenancy (many
churches in one deployment) is **not** built. Until it is, new work should keep the door open:

1. **No church-specific values in code.** Names, colours, domains, times and wording come from
   `settings` (`church_name`, `brand_color`, …) or environment variables. "Meadowbrook" in code
   or default text is technical debt (tracked in [tech-debt.md](tech-debt.md)).
2. **All data access goes through `db` passed into routers**, never a module-level global, so a
   per-church database (or a `church_id` scope) can be introduced in one place.
3. **New tables hang off existing roots** (people, campuses, services, teams, users) rather than
   floating free, so a future `church_id` has an obvious home.
4. **Per-church settings belong in `settings`**, not in env vars, unless they are secrets or
   deployment concerns.
5. **Uploaded files stay under `MB_UPLOADS`** with relative paths stored in the database.
6. **Background jobs take `db` as a parameter** so they can loop over several churches later.
7. **Integrations are configured per deployment today**; when designing new ones, note which
   credentials would be per church (Stripe account, Mux environment, Google project).

Paths to SaaS, recorded so nobody builds toward the wrong one by accident:
- *Database per church* (closest to today): one process hosts several SQLite files chosen by
  host name. Strong isolation, simple backups; needs per-church settings for integrations.
- *Shared database with `church_id`*: every table and query scoped. More change, more risk of
  leaks; needs row-level checks everywhere.
Choosing between them is an architectural decision for the owner (see
[agent-workflow.md](agent-workflow.md), approvals).
The proposed plan (database per church plus a directory, and the shared store app) is in
[plans/mobile-and-multichurch/plan.md](plans/mobile-and-multichurch/plan.md).
