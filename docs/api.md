# API and integrations

Conventions for the HTTP API and how each outside service is wired in. Setup steps for people are
in the README; this page is for building and reviewing code. Permissions: [permissions.md](permissions.md).

## Conventions

- Everything is under `/api`, JSON in and out. Routers live in `server/routes/<area>.js` and are
  mounted in `server/index.js` (order matters: `stationAuth` is first).
- **Non-GET requests need `x-mb: 1`.** The front end's `api()` in `public/js/lib.js` adds it.
- Errors: throw `bad('…')` (400), `notFound('That video')` (404), `forbidden()` (403) or
  `new HttpError(code, msg)`. The handler returns `{ error }`, and the UI shows that message to
  people, so write it in plain, kind English that says what to do.
- Input: always go through `int`, `str(v, max)`, `required`, `oneOf`, `isDate`, `isDateTime`.
  Never interpolate input into SQL; use `?` parameters. Column names in dynamic `UPDATE`s come from
  a fixed allow-list (`updateFields`).
- Lists that can grow get a `LIMIT`. CSV exports end in `.csv` and stream with the right headers.
- Writes that matter call `audit(db, req, 'area.action', detail)`.
- Async handlers are fine (Express 5 forwards rejections).
- Public endpoints return a purpose-built shape (e.g. `publicItem` in `routes/media.js`), never
  raw rows.

## Endpoint map (by router)

| Router | Main paths | Guard |
|---|---|---|
| `setup.js` | `/me`, `/settings`, `/campuses`, `/rooms`, `/users`, `/app-icon` | mixed; settings/users admin |
| `people.js` | `/people`, `/households`, `/pickups`, `/blockouts`, `/import/*`, `/people/export.csv`, `/people/:id/serving-campuses` (staff) | leader+ (edit staff, merge/import admin) |
| `fields.js` | `/profile-fields`, `/people/:id/profile` | leader+ (define admin) |
| `teams.js` | `/teams`, `/positions`, members | leader+ |
| `services.js` | `/services`, `/items`, `/songs`, assignments, `/schedule`, autofill, `POST /services/:id/remind` | volunteer+ read, leader+ write |
| `series.js`, `templates.js` | repeating services, templates | leader+/staff |
| `songfiles.js` | `/songs/:id/files`, `/song-files/:id` | volunteer+ read |
| `attendance.js`, `checkin.js` | roll call, check-in, headcounts, weekly attendance | leader+ (or station) |
| `stations.js` | `/checkin/pair`, `/checkin/station`, `/checkin/devices` | public pairing; staff devices |
| `groups.js` | `/groups`, `/groups/:id`, `/groups/:id/candidates`, `/groups/:id/members/:personId` | volunteer+; staff manage, a group's leaders run its roster (campus-bound finder, 30 adds/day, no contact details) |
| `chat.js`, `calls.js`, `tasks.js` | chats, messages, files, SSE stream, calls, tasks | volunteer+ and membership |
| `notifications.js` | inbox, preferences, push subscriptions | volunteer+ |
| `announcements.js` | announcements, guest push | `announce` flag |
| `app.js` | `/app/config` (public), App Builder, connect cards, sign-ups, email reply links | mixed |
| `events.js` | `/events` (public), `/admin/events/*` | staff for admin |
| `giving.js`, `finance.js` | checkout (public), my giving, `/finance/*` | `requireFinance` |
| `media.js` | `/watch` (public), `/media/*` (Mux, uploads, podcast settings) | staff |
| `backups.js` | `/backups/*` | admin |
| `search.js`, `dashboard.js` | global search, home | volunteer+ (results filtered by role/campus) |

Outside `/api` (in `index.js`): `/healthz`, `/stripe/webhook` (raw body, signature),
`/podcast.xml`, manifests and app icons, `/uploads/app/*` (public pictures) and `/uploads/*`
(volunteer+, since photos include children), page routes.

## Integrations

Every integration is optional and off until its variables are set. Each has an override used only
by tests to point at a local stand-in server. **No integration may be added that bills the church
without the owner's approval.**

| Service | Used for | Code | Turn on with | Test override |
|---|---|---|---|---|
| Google | Sign-in (OAuth); Drive backups (`drive.file` scope) | `auth.js`, `backup.js` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ `GOOGLE_WORKSPACE_DOMAIN`) | `MB_GOOGLE_API`, `MB_GOOGLE_TOKEN_URL` |
| SMTP | Sign-in codes, scheduling emails, statements | `mail.js` | `MB_SMTP_HOST/PORT/USER/PASS`, `MB_MAIL_FROM` | `outbox` in tests |
| Web Push | Notifications (own VAPID keys in `settings`) | `push.js`, `notify.js` | nothing | `MB_PUSH_ALLOW_LOCAL` |
| Stripe | Giving, recurring gifts, paid event sign-ups, webhooks | `stripe.js`, `routes/giving.js`, `events.js` | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | `STRIPE_API_URL` |
| Daily | Video calls in chats | `daily.js`, `routes/calls.js` | `MB_DAILY_API_KEY` | `MB_DAILY_API_URL` |
| YouTube | Channel sync, live detection (Data API key optional) | `media.js` | channel in Media → Setup; `YOUTUBE_API_KEY` | `MB_YOUTUBE_SITE`, `MB_YOUTUBE_API` |
| Mux | Live stream key, recordings, uploads, trims, podcast audio (polled every minute, no webhook) | `mux.js`, `podcast.js` | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | `MB_MUX_API` |
| Render | Hosting, disk, env vars | `Dockerfile` | `MB_TRUST_PROXY=1`, `PUBLIC_URL`, `MB_APP_URL` | |

Other environment variables: `PORT`, `MB_DB`, `MB_UPLOADS`, `MB_BACKUP_PASSWORD`,
`MB_BACKUP_DIR`, `MB_ADMIN_EMAILS`, `MB_DEV_LOGIN` (never in production). See `.env.example`.

Browser libraries loaded from a CDN at run time: YouTube's iframe API and hls.js (pinned) in
`public/js/video.js`. Nothing else is fetched from third parties.
