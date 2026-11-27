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
| `people.js` | `/people`, `GET /households/empty` and `POST /households/empty/remove {ids}` (admin; households with no one in them, archived people count; limited admins only their own campuses; the remove re-checks each id in one transaction and returns `{removed, skipped}`; audited `household.remove_empty`), `/households` (`GET /households?q=` matches the family name or any member's name at your campuses and returns `people: [{ name, role }]` for each), (and `/households/:id/pickups`, `/pickups/:id`: staff, household's campus must be one of yours), `/pickups`, `/blockouts`, `/import/*`, `/people/export.csv`, `/people/:id/serving-campuses` (staff); `POST /people` with `household_id` needs staff unless `household_role` is `child` | leader+ (edit staff, merge/import admin) |
| `fields.js` | `/profile-fields`, `/people/:id/profile` | leader+ (define admin) |
| `teams.js` | `/teams`, `/positions`, members. For leader+, `GET /teams` also returns `leader_names`, `mine` (they lead it) and `open_next` (`{service_id, starts_at, needed, open}` for the next service in 7 days; `null` for a team a leader doesn't lead, or when nothing is coming up); volunteers get the plain list. `GET /teams/:id` members carry `has_account` (yes or no: an active account) and, only for teams the caller sees in full, `reachable` (yes or no: a scheduling request would arrive by email or in the app) and `unreachable_reason` (`no_contact` or `notices_off`); `GET /schedule?team_id=` members carry the same `reachable` and `unreachable_reason`, never an email or phone | leader+ |
| `services.js` | `/services`, `/items`, `/songs`, assignments, `/schedule`, autofill (`POST /schedule/autofill` and `/services/:id/autofill` need a valid `team_id`, one team at a time: none gives 400 "Choose one team to fill.", an unknown team 404, a team the person can't schedule 403; both return `{added, open}`: `open` is spots still empty, so the screen can say "all filled" or "no one free"), `POST /services/:id/remind`. For leaders who aren't staff, detail is limited to the teams they lead (see [permissions.md](permissions.md#team-leaders-and-other-teams)): `/services` counts, `/services/:id` positions (`detail` flag), `/schedule` (also returns `led_team_ids`, `decline_reason` per assignment, and 403 for another team's `team_id`) and `/services/:id/candidates` (403 for other teams) | volunteer+ read, leader+ write |
| `series.js`, `templates.js` | repeating services, templates; read-only counts of scheduled volunteers before an edit or delete: `GET /series/:id/impact?from=` (this and following) and `GET /services/:id/impact` return `{services, volunteers, assignments, accepted}` | leader+/staff (impact: staff, campus-scoped) |
| `songfiles.js` | `/songs/:id/files`, `/song-files/:id` | volunteer+ read |
| `attendance.js`, `checkin.js` | roll call, check-in, headcounts, weekly attendance; `GET /checkin/campuses` lists the campuses the account may set a station up for | leader+ (or station); roll, headcounts, `POST /services/:id/roll/guest` and `GET /attendance/services` also accept an account with the Attendance switch (`requireAttendance`, campus-scoped). `GET /attendance/services?from=&to=` lists services at the account's campuses (default: last 14 days and tomorrow; up to 62 days per request) with `attendance_mode`, headcounts and roll count. `POST /services/:id/roll/guest {first_name, last_name, household_id?, role?: 'child', force?}` adds a guest in a new family, or a child to a family already on the roll, and marks them present: 201 `{id, first_name, last_name}`, 409 name-only duplicate, 403 for an adult in an existing family, 429 after 30 a day. `GET /attendance/summary?year=YYYY|weeks=N&campus_id=&service_time=HH:MM` (leader+, campus-scoped, 403 for a campus the account lacks) returns `{from, to, weeks[{week, total, prev_week, prev_total}], stats{average, previous_average, change_pct, month, month_average, highest, weeks_with_numbers}, services[{id, date, time, campus, title, attendance, source, headcount, marked, kids}], service_times, years}`. Attendance per service is the headcount total if any headcount was entered, otherwise the distinct people marked present in roll call (not counting anyone also checked in as a kid there), plus kids checked in; `source` is `headcount`, `roll` or `kids`. Weeks start Sunday; `prev_*` is the same week 52 weeks earlier; `years` lists years with any data. `GET /attendance/weekly` also returns `source` (`headcount`, `names` or `mixed` per campus and week); `adults` is the counted total (headcount, else names on the roll minus kids also checked in). | `GET /attendance/missing?weeks=2|3|4&campus_id=` (leader+, campus-scoped): regulars (here 3+ times in the last 12 weeks, not inactive) who missed that many Sundays when attendance was taken at their campus, with `missed` and `last_at`; every leader sees everyone at their campuses. Home's `attention.missing` counts the 2+ list.
| `stations.js` | `/checkin/pair`, `/checkin/station`, `/checkin/devices` | public pairing; staff devices. `GET /checkin/devices` also returns each iPad's `app_version` and `app_version_at`. |
| `checkin.js` (record) | `GET /checkin/events?campus_id=&day=YYYY-MM-DD[&action=]`, `GET`/`PATCH /checkin/safety` | Events: `requireRole('staff')` and the campus must pass `canCampus`; never a station (403), signed out 401; missing or bad `day` or unknown `action` 400. Returns `{events, truncated}` (up to 5,000 in `id` order; `detail` parsed; `first_name`/`last_name` joined from `people` at read time) and audits `checkin.events.view`. `security_code` is masked (`••••`) for any day before today in the campus's time zone. Safety: `GET` admin (campus-limited admins may read) returns `{require_current_app, current_app_version}`; `PATCH {require_current_app: boolean}` needs an admin with all campuses (`requireAllCampuses`), refuses unknown keys and wrong types with 400, audits `checkin.safety {from, to}` and records `safety.settings`. The key is stored as the setting `checkin_safety`, which is not in `GET`/`PATCH /settings`. |
| `groups.js` | `/groups`, `/groups/:id`, `/groups/:id/candidates`, `/groups/:id/members/:personId` | volunteer+; staff manage, a group's leaders run its roster (campus-bound finder, 30 adds/day, no contact details) |
| `chat.js`, `calls.js`, `tasks.js` | chats, messages, files, SSE stream, calls, tasks | volunteer+ and membership |
| `notifications.js` | inbox, preferences, push subscriptions | volunteer+ |
| `announcements.js` | announcements, guest push | `announce` flag |
| `app.js` | `GET /app/config` (public; `user.campus_id` is the signed-in person's own campus, used by the This week card; `today` is the church’s own date, from its first campus’s clock, for announcements that end). `PUT /app/config` and `POST /app/images` (the App Builder) need an admin or an account with the **Edit the app** flag (`requireAppEditor`; 401 signed out, 403 otherwise). Links must be `https://`; a save audits `app.config` with any newly added website (`new_links`). A picture upload must really be a JPEG, PNG or WebP (checked from the file's first bytes, not the header), is capped at 30 an hour per account (429) and is audited `app.image`. A save drops a widget’s tab link when no tab can open it (deleted, a Link tab, or a switched-off Page), keeps Home on, and checks the Announcement and Link list widgets (headline ≤80, text ≤300, `ends` YYYY-MM-DD, up to 8 links of ≤40 characters). Connect cards, sign-ups, email reply links | mixed |
| `me.js` | `PUT`/`DELETE /me/home-layout` (Customise Home: the signed-in account's own Home card order and hidden cards, `{order, hidden}` of card ids from `HOME_CARDS` — attention, services, serving, attendance, away, totals; unknown or repeated ids, non-lists or more than six are 400; `DELETE` returns to the standard Home; no id is accepted, not audited, like the theme; the saved value comes back as `homeLayout` on `GET /me`, `null` when none), `GET`/`PATCH /me/person` (the signed-in account's own linked person; no id is ever accepted). `PATCH` takes only `phone` and `birthdate` (People validation; `birthdate` not for a person whose household role is child, and `GET` says so in `can_edit_birthdate`); any other field is 400 with nothing saved. `GET` also returns email, campus and household address read-only. Audited `me.person.update` with field names only. `PATCH /me/address {address, city, state, zip}`: an adult (not household role child) changes their own household's home address for everyone in it; any other field 400; child or no household 403; audited `me.household.address` with field names only. `GET` returns `home` and `can_edit_address`. `POST /me/office-request {topic: email|family|other, message}` notifies active staff/admins whose campuses include the person's (all, if the person has no campus), audited `me.office_request`; 5 an hour per account (429); sent as notification kind `account`, which staff can turn off in their notification settings. Unlinked accounts get 409 "ask the office to link it" on all three | volunteer+, own record; needs `x-mb` |
| `events.js` | `/events` (public), `/admin/events/*` | staff for admin |
| `forms.js` | `/public/forms/:slug` (public), `/forms` (signed-in forms), `/admin/forms/*`, `/admin/form-responses/*` | staff for admin; admin deletes |
| `giving.js`, `finance.js` | checkout (public), my giving, `/finance/*` | `requireFinance` |
| `media.js` | `/watch`, `/watch/:id` (public; published, playable videos only). Staff (all need `x-mb` to change anything): `GET /media` (the whole library with `counts` by status, each video’s `reason` for not being in the app, `series`/`speakers` lists; `?status=published\|hidden\|skipped\|review` narrows it), `GET /media/:id`, `PATCH /media/:id` (title, date, series (matched case-insensitively to an existing series), speaker, scripture, campus, notes, topics, picture, trim, `status` published or hidden), `POST /media` (add one by link; goes straight in), `GET /media/playlist-extras` (count of published YouTube videos not in the messages playlist) and `POST /media/playlist-extras/hide` (admin with every campus; moves them to `hidden` with `skip_reason` “Not in the messages playlist”; audited; 400 when no playlist is set or, without the API key, the playlist may be only partly visible), `POST /media/sync` (returns `{added, skipped, review}`; `deep` needs the API key), `GET`/`PUT /media/setup` (`PUT` is for an admin who covers every campus; staff can read it. Channel, `playlist` link or id (checked with YouTube; empty clears), `skip_words`, `min_minutes`, `title_format`, `notify_live`, `notify_new`; Mux settings and the old own-player-only switch are no longer returned or accepted). Status `review` is “Needs a look” (`skip_reason` says why). Dormant, unchanged and still staff only: `/media/mux/*` (reset-key is admin, all campuses), `/media/uploads`, `/media/:id/upload*`, `/media/live/show`, `/media/podcast` | staff |
| `backups.js` | `/backups/*` | admin |
| `checks.js` | `GET /admin/production-checks` (includes an info row with the admin's own address as the server sees it) | admin |
| `search.js`, `dashboard.js` | global search, home. `GET /dashboard` returns `attention` (open spots, haven't replied, declines to cover with `declines_next` and `declines_service`, the soonest affected service (null when none), connect cards, app sign-ups, new form responses; leader+ only, zeros for volunteers) and `my_teams` (teams the person leads: next service, open/not-replied/declines, member count, `chat_id`). `GET /attention` is the light version for the menu badges (same numbers, `?campus_id=` optional, plus `media_review`: videos in Media → Needs a look, staff and admin only, 0 for everyone else). Dates use each campus's own calendar day | volunteer+ (results filtered by role/campus) |

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

### Check-in app version (`x-checkin-version`)

The check-in iPad page sends `x-checkin-version: <CHECKIN_APP_VERSION>` (a whole number from
`public/js/checkin-rules.js`, raised by any change to what the iPad sends or how it releases children) on every request.
`stationAuth` keeps the last value on `checkin_devices` (anything that isn't 1–6 digits is stored as `''`), and the record
stores it on each event. When an admin turns on `require_current_app`, a **paired iPad** that sends no version or a lower
one gets **426** `{ error: 'This iPad is running an older check-in. Close the app and open it again, then try once more.', reload: true }`
from `GET /checkin/roster`, `GET /checkin/active`, `POST /checkin/checkins`, `POST /checkin/checkout` and
`DELETE /checkin/checkins/:id` (recorded as `version.refused`, at most once per iPad per day). Signed-in users,
`/checkin/station`, `/checkin/pair*`, `/checkin/campuses`, `/campuses` and `POST /people` are never refused. The iPad keeps its
queue and outbox on any non-2xx answer, so a refused upload is sent again after the app is reopened.

### Check-out (`POST /checkin/checkout`)

Guard: `requireCheckin` (paired station, staff, admin, or an authorised leader), campus scoping, the version check above. Three body shapes:

| Body | Meaning | Rule |
|---|---|---|
| `{ campus_id, mode: 'request', household_id?, ids }` | A release happening now, online | The children must be one family's (a child with no household counts as a family of their own) and, if `household_id` is sent, that family's. Otherwise **409** `{ error, reason: 'two_families' \| 'household_mismatch', families: [{ household_id, name, check_in_ids }] }`, nothing is released, and a `checkout.refused` event and a `checkin.checkout.refused` audit row are written (at most 20 per iPad or account per campus per day; the 409 is always returned). `ids` must not be empty (400). |
| `{ campus_id, mode: 'report', ids, at? }` | A release that already happened (an offline iPad catching up) | **Never refused.** Each child is released at `at` (ISO), kept between their check-in time and now (`time_adjusted: true` in the event when it was moved; `checkins.client_checked_out_at` keeps `at` as sent; no `at` or a bad one means now). A report spanning families is recorded as `checkout.mixed` (`mode: 'report'`) with a `checkin.checkout.mixed` audit row for a person to look at. Children already released are recorded as `checkout.repeat`, so re-sending is safe. |
| `{ campus_id, security_code \| ids, by? }` | The older shape, still accepted | A typed code that matches children of more than one family gets **409** (`reason: 'code_two_families'`). An id list across families is accepted and recorded as `checkout.mixed` (it can't be told from an old iPad's catch-up); with the version switch on, old iPads get 426 anyway. |

`mode` must be `request` or `report` (400), and a body with `mode` can't carry `security_code`. Who released is always from the server: `checked_out_by`, `checked_out_device_id` or `checked_out_user_id`, and the event's device or user. The body's `by` is only kept as `by_claimed` (older shape, or when sent). Response `200 { checked_out: n }`. `GET /checkin/active` lists explicit columns and never returns the release ids.

Recording never makes a check-in or check-out fail or roll back: an oversized event `detail` is cut down and marked `truncated: true` (lists keep their first 20). `POST /checkin/checkout` takes at most 500 `ids` (400 above), collapses duplicates, and writes one `checkout.unknown` row per request (`count`, first 20 `ids`); `checkout.code_miss` is recorded for the first 5 misses per iPad or account per campus per day (`attempt` counts them); `checkin.skipped` is one row per reason per request (`count`, first 20 `person_ids`); `checkout.mixed` stores `count`, `household_count` and the first 20 ids.

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
| YouTube | Channel or messages-playlist sync (Data API `playlistItems`, or the public channel/playlist feed), live detection (Data API key optional) | `media.js` | channel and playlist in Media → Setup; `YOUTUBE_API_KEY` | `MB_YOUTUBE_SITE`, `MB_YOUTUBE_API` |
| Mux (dormant: not used by the church, no staff screen) | Live stream key, recordings, uploads, trims, podcast audio (polled every minute, no webhook) | `mux.js`, `podcast.js` | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | `MB_MUX_API` |
| Render | Hosting, disk, env vars | `Dockerfile` | `MB_TRUST_PROXY=2`, `PUBLIC_URL`, `MB_APP_URL` | |

Other environment variables: `PORT`, `MB_DB`, `MB_UPLOADS`, `MB_BACKUP_PASSWORD`,
`MB_BACKUP_DIR`, `MB_ADMIN_EMAILS`, `MB_DEV_LOGIN` (never in production). See `.env.example`.

Browser libraries loaded from a CDN at run time: YouTube's iframe API and hls.js (pinned) in
`public/js/video.js`. Nothing else is fetched from third parties.
