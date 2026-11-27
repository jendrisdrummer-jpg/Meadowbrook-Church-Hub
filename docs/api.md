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
| `setup.js` | `/me`, `/settings`, `/campuses`, `/rooms`, `/users`, `/app-icon` | mixed; settings/users admin. Church-wide admin routes (settings, app icon, campus create, backups, import, profile fields) refuse campus-limited admins with 403, and `GET /users` returns them only accounts in reach: see [permissions.md](permissions.md#campus-limited-admins). `POST`/`PATCH /users` also take `attendance` (campus list required with more than one campus; 400) and `PATCH /campuses/:id` takes `attendance_mode`. `POST`/`PATCH /users` set `person_id` only when the admin sends one (409 if that person already has an account; audited `user.link` / `user.unlink`). `GET /users` also returns `unlinked` (each row has a `suggestion` `{person_id, name, campus_short, note}` when exactly one non-archived person shares the account's email and the admin has that person in reach, else `null`; a hint only, [account-links.md](account-links.md)) `shared_emails` (groups of non-archived people sharing one email, trimmed and case-insensitive: `{email, people: [{id, name, campus}]}`; a campus-limited admin gets only groups wholly in reach) and `duplicate_links` (people with more than one account, empty when healthy). |
| `people.js` | `/people`, `/households` (`GET /households?q=` matches the family name or any member's name at your campuses and returns `people: [{ name, role }]` for each), (and `/households/:id/pickups`, `/pickups/:id`: staff, household's campus must be one of yours), `/pickups`, `/blockouts`, `/import/*`, `/people/export.csv`, `/people/:id/serving-campuses` (staff); `POST /people` with `household_id` needs staff unless `household_role` is `child` | leader+ (edit staff, merge/import admin) |
| `fields.js` | `/profile-fields`, `/people/:id/profile` | leader+ (define admin) |
| `teams.js` | `/teams`, `/positions`, members. For leader+, `GET /teams` also returns `leader_names`, `mine` (they lead it) and `open_next` (`{service_id, starts_at, needed, open}` for the next service in 7 days; `null` for a team a leader doesn't lead, or when nothing is coming up); volunteers get the plain list. `GET /teams/:id` members carry `has_account` (yes or no: an active account) and, only for teams the caller sees in full, `reachable` (yes or no: a scheduling request would arrive by email or in the app) and `unreachable_reason` (`no_contact` or `notices_off`); `GET /schedule?team_id=` members carry the same `reachable` and `unreachable_reason`, never an email or phone | leader+ |
| `services.js` | `/services`, `/items`, `/songs`, assignments, `/schedule`, autofill (`POST /schedule/autofill` and `/services/:id/autofill` need a valid `team_id`, one team at a time: none gives 400 "Choose one team to fill.", an unknown team 404, a team the person can't schedule 403; both return `{added, open}`: `open` is spots still empty, so the screen can say "all filled" or "no one free"), `POST /services/:id/remind`. For leaders who aren't staff, detail is limited to the teams they lead (see [permissions.md](permissions.md#team-leaders-and-other-teams)): `/services` counts, `/services/:id` positions (`detail` flag), `/schedule` (also returns `led_team_ids`, `decline_reason` per assignment, and 403 for another team's `team_id`) and `/services/:id/candidates` (403 for other teams) | volunteer+ read, leader+ write |
| `series.js`, `templates.js` | repeating services, templates; read-only counts of scheduled volunteers before an edit or delete: `GET /series/:id/impact?from=` (this and following) and `GET /services/:id/impact` return `{services, volunteers, assignments, accepted}` | leader+/staff (impact: staff, campus-scoped) |
| `songfiles.js` | `/songs/:id/files`, `/song-files/:id` | volunteer+ read |
| `attendance.js`, `checkin.js` | roll call, check-in, headcounts, weekly attendance; `GET /checkin/campuses` lists the campuses the account may set a station up for | leader+ (or station); roll, headcounts, `POST /services/:id/roll/guest` and `GET /attendance/services` also accept an account with the Attendance switch (`requireAttendance`, campus-scoped). `GET /attendance/services?from=&to=` lists services at the account's campuses (default: last 14 days and tomorrow; up to 62 days per request) with `attendance_mode`, headcounts and roll count. `POST /services/:id/roll/guest {first_name, last_name, household_id?, role?: 'child', force?}` adds a guest in a new family, or a child to a family already on the roll, and marks them present: 201 `{id, first_name, last_name}`, 409 name-only duplicate, 403 for an adult in an existing family, 429 after 30 a day. `GET /attendance/summary?year=YYYY|weeks=N&campus_id=&service_time=HH:MM` (leader+, campus-scoped, 403 for a campus the account lacks) returns `{from, to, weeks[{week, total, prev_week, prev_total}], stats{average, previous_average, change_pct, month, month_average, highest, weeks_with_numbers}, services[{id, date, time, campus, title, attendance, source, headcount, marked, kids}], service_times, years}`. Attendance per service is the headcount total if any headcount was entered, otherwise the distinct people marked present in roll call (not counting anyone also checked in as a kid there), plus kids checked in; `source` is `headcount`, `roll` or `kids`. Weeks start Sunday; `prev_*` is the same week 52 weeks earlier; `years` lists years with any data. `GET /attendance/weekly` also returns `source` (`headcount`, `names` or `mixed` per campus and week); `adults` is the counted total (headcount, else names on the roll minus kids also checked in). | `GET /attendance/missing?weeks=2|3|4&campus_id=` (leader+, campus-scoped): regulars (here 3+ times in the last 12 weeks, not inactive) who missed that many Sundays when attendance was taken at their campus, with `missed` and `last_at`; every leader sees everyone at their campuses. Home's `attention.missing` counts the 2+ list.
| `stations.js` | `/checkin/pair`, `/checkin/station`, `/checkin/devices` | public pairing; staff devices |
| `groups.js` | `/groups`, `/groups/:id`, `/groups/:id/candidates`, `/groups/:id/members/:personId` | volunteer+; staff manage, a group's leaders run its roster (campus-bound finder, 30 adds/day, no contact details) |
| `chat.js`, `calls.js`, `tasks.js` | chats, messages, files, SSE stream, calls, tasks | volunteer+ and membership |
| `notifications.js` | inbox, preferences, push subscriptions | volunteer+ |
| `announcements.js` | announcements, guest push | `announce` flag |
| `app.js` | `GET /app/config` (public; `user.campus_id` is the signed-in person's own campus, used by the This week card; `today` is the church’s own date, from its first campus’s clock, for announcements that end). `PUT /app/config` and `POST /app/images` (the App Builder) need an admin or an account with the **Edit the app** flag (`requireAppEditor`; 401 signed out, 403 otherwise). A save drops a widget’s tab link when no tab can open it (deleted, a Link tab, or a switched-off Page), keeps Home on, and checks the Announcement and Link list widgets (headline ≤80, text ≤300, `ends` YYYY-MM-DD, up to 8 links of ≤40 characters). Connect cards, sign-ups, email reply links | mixed |
| `me.js` | `GET`/`PATCH /me/person` (the signed-in account's own linked person; no id is ever accepted). `PATCH` takes only `phone` and `birthdate` (People validation; `birthdate` not for a person whose household role is child, and `GET` says so in `can_edit_birthdate`); any other field is 400 with nothing saved. `GET` also returns email, campus and household address read-only. Audited `me.person.update` with field names only. `PATCH /me/address {address, city, state, zip}`: an adult (not household role child) changes their own household's home address for everyone in it; any other field 400; child or no household 403; audited `me.household.address` with field names only. `GET` returns `home` and `can_edit_address`. `POST /me/office-request {topic: email|family|other, message}` notifies active staff/admins whose campuses include the person's (all, if the person has no campus), audited `me.office_request`; 5 an hour per account (429); sent as notification kind `account`, which staff can turn off in their notification settings. Unlinked accounts get 409 "ask the office to link it" on all three | volunteer+, own record; needs `x-mb` |
| `events.js` | `/events` (public), `/admin/events/*` | staff for admin |
| `forms.js` | `/public/forms/:slug` (public), `/forms` (signed-in forms), `/admin/forms/*`, `/admin/form-responses/*` | staff for admin; admin deletes |
| `giving.js`, `finance.js` | checkout (public), my giving, `/finance/*` | `requireFinance` |
| `media.js` | `/watch` (public), `/media/*` (Mux, uploads, podcast settings) | staff |
| `backups.js` | `/backups/*` | admin |
| `checks.js` | `GET /admin/production-checks` (includes an info row with the admin's own address as the server sees it) | admin |
| `search.js`, `dashboard.js` | global search, home. `GET /dashboard` returns `attention` (open spots, haven't replied, declines to cover with `declines_next` and `declines_service`, the soonest affected service (null when none), connect cards, app sign-ups, new form responses; leader+ only, zeros for volunteers) and `my_teams` (teams the person leads: next service, open/not-replied/declines, member count, `chat_id`). `GET /attention` is the light version for the menu badges (same numbers, `?campus_id=` optional). Dates use each campus's own calendar day | volunteer+ (results filtered by role/campus) |

### Forms (`routes/forms.js`)

| Route | Who | Notes |
|---|---|---|
| `GET /public/forms/:slug` | guest (signed-in forms: needs a session) | Active forms only (else 404). Returns title, intro, which contact fields to ask and the questions (`id, label, type, options, required`); nothing else. A signed-in form seen by a guest returns `needs_sign_in: true` and no questions. |
| `POST /public/forms/:slug` | guest (signed-in forms: 401 without a session) | Body `{name, email, phone, answers, website}`. A filled `website` (honeypot) is dropped silently. Rate-limited per address (IPv6 by /64, and per /48 at 16 times these numbers): 30 tries and 10 successful submissions per 10 minutes, and per form 200 per hour: 429. Signed-in forms at another campus than the account's: 404. Returns `{ok: true}` only (no response id). Required fields, choices, dates and lengths are checked: 400. Records `user_id`/`person_id` only from the session. Notifies `notify_user_id` (if still eligible; at most one notice per form per person per 15 minutes) with no answer text. |
| `GET /forms` | volunteer+ | Active signed-in forms (titles) for the app's More tab, campus-filtered. |
| `GET /admin/forms`, `GET /admin/forms/:id` | staff | Forms at the account's campuses plus church-wide ones; `can_manage` and response counts only where the account may read responses. |
| `GET /admin/forms/notify-options` | staff | `?campus_id=` (none = church-wide). Names (`id`, `name`) of active staff/admins who could be told about that form's responses; nothing else. Empty for a campus the account can't access. |
| `POST /admin/forms`, `PATCH /admin/forms/:id` | staff | Campus-limited staff: their own campuses only, never church-wide. `active: false` archives (audited as `form.archive`). Audited `form.create`, `form.edit`. The slug is chosen at create and then fixed. |
| `GET /admin/forms/:id/responses`, `.../responses.csv` | staff who manage the form | Church-wide forms: only staff with no campus limit. CSV cells starting `=`, `+`, `-`, `@` are defused (`toCsv`). The CSV export is audited as `form.export` (title and row count). |
| `PATCH /admin/form-responses/:id` | staff who manage the form | `{done: bool}` marks done or reopens. |
| `DELETE /admin/form-responses/:id` | admin who manages the form | Audited `form.response_delete`. |

Question types and answer checking are shared with event sign-ups in `server/questions.js`.

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
| Render | Hosting, disk, env vars | `Dockerfile` | `MB_TRUST_PROXY=2`, `PUBLIC_URL`, `MB_APP_URL` | |

Other environment variables: `PORT`, `MB_DB`, `MB_UPLOADS`, `MB_BACKUP_PASSWORD`,
`MB_BACKUP_DIR`, `MB_ADMIN_EMAILS`, `MB_DEV_LOGIN` (never in production). See `.env.example`.

Browser libraries loaded from a CDN at run time: YouTube's iframe API and hls.js (pinned) in
`public/js/video.js`. Nothing else is fetched from third parties.
