# Kids' check-in V1: refresh against today's code, and the first PR's build brief

2026-11-27 · Chief Architect · Planning only. The owner approved starting the child-safety program on 2026-11-27
("yes, start child safety"). This page checks [v1-strategy.md](v1-strategy.md) and [subsplash-cutover.md](subsplash-cutover.md)
against `milestone-1` as of today, splits V1 into pull requests and gives the complete brief for the first one.
**Every V1 safety requirement in v1-strategy.md §2, §3, §7 and §8 stands.** Where this page differs from those on
order or mechanism, this page governs; [plan.md](plan.md) and [revision-3.2.md](revision-3.2.md) stay the V2/V3 reference.

---

## 1. For the owner (plain language)

- **What V1 gives a Sunday:** each child is checked out one by one, and a tag can never release two families' children
  together. Pickup codes can't clash between iPads. A "Hold: see coordinator" flag stops a release on every iPad,
  online or offline. Only named people can open the check-in list. Labels show allergies clearly, but not private
  notes or the family name. Nothing about a check-in can be deleted, and every release says who did it.
- **What stays on Subsplash until V1 is done:** all of kids' check-in at the desk. The Hub's check-in is only tried
  on test iPads until the pilot (about 21 February). Media also stays on Subsplash, for now.
- **Order of releases:** (1) a record of everything that happens at check-in, plus the iPad version check. (2) Safe
  check-out. (3) History that can't be deleted. (4) Who may use check-in. (5) New codes and medical levels. (6) Holds
  and who collected. Then the Subsplash import, a dress rehearsal and the pilot.
- **Nothing changes on a Sunday when these ship:** the desk still runs on Subsplash. Releases 3 and 4 touch parts of
  the Hub that are in use (services, merging people, account access), so they need your approval first.
- **Nothing is needed from you before release 1.**

---

## 2. What changed since the plan

Each assumption was checked against `origin/milestone-1` (39 migrations) on 2026-11-27.

| Plan assumption | Today's code | Keep / adjust |
|---|---|---|
| Any team leader reads the church-wide roster (v1 §1.4) | **Fixed for now by #52.** `canCheckin` lets stations, staff and admins in, plus leaders listed in the `checkin_user_ids` setting (`server/routes/checkin.js:16-20`) | **Adjust:** PR 4 replaces the setting with a per-account switch. The urgency is gone |
| The roster sends adults' medical notes (v1 §1.4) | **Fixed by #51.** Adults' allergies and notes are blanked (`checkin.js:64-68`, `124-128`) | **Keep the minimisation item (PR 4).** The roster still sends every adult's phone and birthdate and every photo (`checkin.js:60-61`). It also loads all `household_pickups` rows, then filters them in memory (`checkin.js:62`) |
| Stations and leaders can add an adult to an existing household (v1 §1.5) | **Fixed.** Below staff, a household join is child-only (`server/routes/people.js:184`), tested in `test/household-safety.test.js:51` | **Remove from V1 scope.** Keep the test |
| Pickup contacts change with no campus check or audit (v1 §2.3) | **Fixed.** Staff only, `visibleHousehold` campus check, `pickup.add` and `pickup.remove` audit (`people.js:424-439`) | **Remove from V1 scope.** What's left of item 3 is the `checked_out_to` record (PR 6) |
| "Check out all" across households; the server's `{ids}` path checks nothing | **Unchanged.** `showMatch` uses `kids[0]`'s family for the pickup list, then releases every child on the code (`public/js/checkin.js:407-431`). The server releases any ids at the campus (`checkin.js:137-154`) | **Keep (PR 2).** PR 1 records mixed requests first |
| Who released a child is known | **New gap.** `checked_out_by` is whatever the iPad sends in `by` (`checkin.js:140`). Station actions in `audit_log` have `user_id` null (`server/http.js:53-56`). No check-out, check-in or delete writes any audit row | **Adjust: PR 1** adds `checkin_events` with the identity the server knows |
| 4-character codes made on each iPad | **Unchanged** (`public/js/checkin-rules.js:26-33`, `public/js/checkin.js:303`) | **Keep (PR 5)** |
| Stations and leaders hard-delete check-ins | **Unchanged** (`checkin.js:157-163`) | **Keep (PR 3)**. PR 1 records each delete first |
| Deleting a service or series deletes history | **Unchanged.** A service delete cascades its `assignments`, and `checkins.service_id` is set to NULL (`server/routes/services.js:188-196`). A series end date and "stop from" delete services by date, past ones included (`server/routes/series.js:197`, `209`) | **Keep (PR 3)** |
| Deleting a person cascades history | **No route deletes people** (they are archived). The cascades exist only in the schema | **Adjust:** the triggers in PR 3 are a backstop, not a route fix |
| Merge keeps history | **New finding.** Merge deletes the duplicate's leftover assignments (`people.js:308`), so a past-assignment trigger would make merges fail | **Adjust (PR 3):** keep the duplicate's past rows on the archived duplicate, and delete only future ones |
| A hub session on a kiosk overrides the station | **Unchanged.** `stationAuth` steps aside whenever there is a session (`server/routes/stations.js:26`). The kiosk also shows a "Sign in to sync" link (`public/js/checkin.js:199`) | **Keep (PR 4).** Remove the link too |
| No app-version reporting | **Unchanged.** `stationAuth` stores only `last_seen` (`stations.js:22-31`) | **Adjust: moved into PR 1** (it is small, and a switch turns it on). Refusing old versions can be on from the pilot (cutover §1) |
| Offline check-outs are a flat id list sent with the sync time | **Unchanged** (`public/js/checkin.js:426-445`). No live iPad holds such a queue | **Keep (PR 2).** No conversion is needed |
| Labels print full medical notes and the family name | **Unchanged** (`public/js/checkin.js:467-487`) | **Keep.** The label switch is not gated: the Hub launches with Level 1 labels only (cutover §1). Accepted risk II-49 no longer applies |
| `frame-ancestors 'none'` on the check-in page | **New constraint.** Since the App Builder (migration 38) needed it, the Hub sends `X-Frame-Options: SAMEORIGIN` on every response (`server/index.js:58`) | **Adjust (PR 4):** a header just for `/checkin` and its files, overriding the global one |
| Per-account flags | **New pattern.** Attendance (migration 36) and Edit the app (migration 38) are `users` columns, read in `toUser` (`server/auth.js:71-87`). `canAttendCampus` fails closed when a below-leader account has no campus list (`auth.js:135-140`) | **Adjust:** the check-in switch copies this pattern (`users.checkin`), not the grants table that `permissions.md` described. Campus-limited admins can grant it within their campuses (`accountInReach`, `auth.js:161-177`) |
| Settings | **Constraint.** `GET /settings` returns every key in `SETTINGS` to every signed-in account (`server/routes/setup.js:119-125`). `PATCH /settings` audits key names only (`setup.js:141`) | **Adjust:** child-safety settings live in one `settings` key, `checkin_safety`, served by their own admin-only endpoint that audits old → new |
| Empty-household cleanup (PR #118) | `emptyHouseholdWhere` treats any foreign key to `households` as a reference (`people.js:355-370`) | **Keep.** New check-in tables use plain integers (no FK) for households, and holds are keyed on the child. A future table with a household FK is protected automatically |
| My info (members edit their own details) | Adults change the household address only, never pickups or medical (`server/routes/me.js:85-100`) | **Keep.** Parents changing their own pickups is V2, and would be a permission change |
| Theme (migration 37) | `public/checkin.html:8` loads `theme.js`, so the kiosk follows the device's dark mode | **QA item:** labels and the building sheet print black on white in dark mode (PR 2, PR 6) |
| Service worker | Caches the check-in files as `mb-checkin-v4` (`public/sw.js:5`), network first | **Rule:** each PR that changes check-in files bumps the cache name |
| Migration numbers | `milestone-1` is at 39. Number 40 is taken by Classes v1 (PR #122, `origin/claude/classes-v1`, `server/db.js:990`). plan.md §4.3 says the check-in work starts at m37, which is now stale | **Adjust:** child safety starts at **41**. `MIGRATIONS` is an array, so each number is its place in it. **PR 1 merges after #122**, or takes the next free number if #122 slips. The code comment must match the position |
| Tests | Check-in tests are in `test/api.test.js:773`, `1727`, `1959`, plus `household-safety`, `attendance-access` and `qa-pass`. CI runs `npm test` (#53) | **Keep them unchanged** as regression. New tests go in `test/checkin-*.test.js` |
| Agent team | No `accessibility-specialist` agent exists (`.claude/agents/`). `ui-ux-specialist` covers accessibility ([agent-workflow.md](../../agent-workflow.md)) | **Adjust:** screens are reviewed by `ui-ux-specialist` |

**Design rule carried from plan.md §4.8 (adjusted):** safety enforcement is not switchable once it ships (the
two-family stop, holds, delete guards, the append-only record, campus checks). It is safe to ship because the Hub's
check-in isn't used at the desk until the pilot. **Switches are only for:**
- workflow choices: refusing old iPad versions
- church choices: the legal hold

For the PRs that touch live Hub code (3 and 4), "nothing changes on Sunday" comes from three things:
- **Server-only behaviour, with tests:** what volunteers see stays the same.
- **The access migration:** no one gains or loses access on the day.
- **Your approval** before each one.

---

## 3. V1 releases (6 PRs, then cutover)

Migration numbers assume #122 merged first; use the next free number at build time. **Every PR is reviewed by:**
- `security-specialist`
- `qa-engineer`: `npm test`, and `npm run test:ui` for screen PRs
- `devops-engineer`: each migration, tried on a restored backup
- `chief-architect`: the final review

| PR | Scope | Migration | Routes and guards | UI | Tests (new file) | Docs | Build / extra review | Owner decision | Sunday safety |
|---|---|---|---|---|---|---|---|---|---|
| **1. Check-in record** | `checkin_events` (append-only); events on every existing check-in path; mixed-family check-outs recorded (not refused); iPad app-version report and admin switch; admin-only `checkin_safety` settings | **41** | `GET /checkin/events` (staff+, campus, never stations); `GET`/`PATCH /checkin/safety` (admin; PATCH needs all campuses) | Stations page: version column, admin safety card | `checkin-record.test.js` | database, api, permissions, features, architecture, testing | senior-developer / ui-ux-specialist | None | Recording only; the switch is off by default |
| **2. Check-out guard** | Two-family stop; tick each child; "Check out all" removed; server 409 when a request spans two households (online `request`), record and alert on offline `report`; per-release outbox with the real time; replays recorded, never refused; `checked_out_by` from the server; label and tag privacy (first name, last initial, no family name); old daily lists cleared once synced; unpair wipes everything but unsent records | **42**: `checkins` + `checked_out_device_id`, `checked_out_user_id`, `client_checked_out_at` | `POST /checkin/checkout` v2 body `{mode, household_id, ids, at}`; the old shape still accepted (no live iPads, but test iPads) | Check-out screen, labels | `checkin-checkout.test.js` | api, features, operational-policy | senior-developer / church-operations, ui-ux-specialist | None (in the approved V1 scope) | Check-in only, which isn't used at the desk |
| **3. History** | One-hour spike: do triggers fire on cascaded deletes in `node:sqlite`? Then: void instead of delete (`checkins` + `voided_at`, `voided_by_user_id`, `void_reason`; stations can't void); triggers refusing delete on `checkins` and on assignments of past services; past-service delete, series end or stop-from over past dates, and position force-delete refused or archived; merge keeps the duplicate's past rows; `checkin_safety.legal_hold` blocks void, merge and backup pruning | **43** | `POST /checkin/checkins/:id/void` (check-in access, not stations); `DELETE` returns 405 with guidance | Void dialog; a 409 message on past deletes | `checkin-history.test.js` | database, api, permissions, features, tech-debt | senior-developer / church-operations, devops-engineer (restored-backup rehearsal) | **Approve the triggers and route changes** | Touches live services, series and merge; deploy midweek |
| **4. Access** | `users.checkin` switch (migration copies `checkin_user_ids`, and staff/admin per your decision); `canCheckin` + `canCheckinCampus` (fails closed like `canAttendCampus`); remove the old setting; station token wins over a session; no "Sign in to sync" on kiosks; roster minimised (children plus household adults' names and phones, Level 1 only, no adult birthdates, pickups loaded per campus); `no-store` on roster and active; CSP and `frame-ancestors 'none'` on `/checkin` | **44** | Existing check-in routes; the account dialogs write the switch | Account dialogs ("Kids' check-in" switch) | `checkin-access.test.js` | permissions, api, security, features | senior-developer / ui-ux-specialist | **Approve the permission change; name who has it on day one** | Same people keep access on the day (migration copy) |
| **5. Codes and medical** | Station letter at pairing (unique per campus; a replacement keeps it); 5-character codes; the iPad avoids today's codes; the server flags clashes (`checkin.code_clash` event); Level 1 fields (allergen words, EPI yes/no, one-line action) on the iPad and label; Level 2 (`medical_notes`, children) shown on tap online only, logged as `medical.view` events; Level 3 `person_care_notes`, hub only; staff review list with a per-campus count (launch gate: zero) | **45**: `checkin_devices.station_letter` + partial unique index; `people` + `allergy_epi`, `allergy_action`, `medical_sorted_at`; `person_care_notes` | `GET /checkin/medical/:personId` (check-in access, online, logged); care-notes routes staff+ | Label, Rooms tap, People review list, person page Level 3 | `checkin-codes.test.js`, `checkin-medical.test.js` (canary strings) | database, api, permissions, features, security | senior-developer / church-operations, ui-ux-specialist | **Confirm 5-character codes and the three medical levels** | Check-in only; Level 3 is a new hub field |
| **6. Holds and release record** | `checkin_holds` (set and clear history, no details); the hold blocks release on every path: online, offline (roster must be from today) and staff; release of a held child only in the hub, audited; collector picked from household adults and listed contacts; `checked_out_to` (name, relationship, kind, ID type); printable "who's in the building" sheet from the cache, offline | **46**: `checkin_holds`; `checkins` + `checked_out_to_name`, `_relationship`, `_kind`, `id_type` | `POST`/`DELETE /checkin/holds` (decision below); `POST /checkin/checkins/:id/release-held` (check-in access + staff) | Check-out collector step, hold banner, building sheet, hold control on the person page | `checkin-holds.test.js` | api, permissions, features, operational-policy | senior-developer / church-operations, ui-ux-specialist | **Who may set and clear holds** | Check-in only |

**After V1 code (cutover, [subsplash-cutover.md](subsplash-cutover.md) §2):**
- **PR 7, Subsplash import:** dry-run diff, matching, a reconciliation list that must reach zero. It needs a sample export.
- **Readiness, not a PR:**
  - regression on real iPads and printers
  - the paper-kit drill
  - the dress rehearsal
  - the [release checklist](../../release-checklist.md)
  - the signed test report

**Development effort:** about 100–130 h across PRs 1–6, in line with v1-strategy §6.

**Calendar** (a deploy freeze from 19 Dec to 3 Jan is assumed, not yet confirmed):

| When | What |
|---|---|
| By 4 Dec | PR 1 |
| By 11 Dec | PR 2 |
| Before 18 Dec, if approved by about 9 Dec | One of PR 3 or PR 4 |
| Early January | The other one |
| Mid-January | PR 5 |
| Late January | PR 6 and PR 7 |
| About 21 Feb | Pilot, unchanged |

**Order notes:**
- PRs 1 and 2 touch only check-in files.
- PRs 3 and 4 both touch `people.js`: build one at a time.
- Scheduling items H1 and H3 wait for PR 3 (the assignment trigger).

---

## 4. PR 1 build brief: the check-in record

**Branch** `claude/checkin-record` from `origin/milestone-1` after #122 has merged; otherwise rebase when it merges.
**Goal:**
- Record everything that already happens in kids' check-in, with the identity the server knows.
- Let the hub see which app version each iPad runs.
- Give admins one switch: refusing out-of-date iPads.

**No existing behaviour changes.**

### 4.1 Migration 41 (append at the end of `MIGRATIONS`, with this comment)

```sql
-- 41: kids' check-in record (child-safety V1, PR 1). checkin_events is append-only (triggers refuse
-- UPDATE and DELETE) and holds plain ids with name snapshots, no foreign keys to people, users,
-- households or devices, so it outlives anything it mentions. It never holds medical text, phone
-- numbers or addresses. checkin_devices gains the check-in app version each iPad last reported.
CREATE TABLE checkin_events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,                              -- server time, ISO UTC, set in JS (never datetime('now'))
  day TEXT,                                      -- campus-local date of `at`; NULL for church-wide events
  client_at TEXT,                                -- when the iPad says it happened (ISO UTC), if it said
  campus_id INTEGER REFERENCES campuses(id),     -- no ON DELETE action: a campus with history can't be deleted
  action TEXT NOT NULL,                          -- closed list in server/checkin-events.js
  checkin_id TEXT,                               -- plain id: the event outlives the check-in
  person_id INTEGER,                             -- plain id
  household_id INTEGER,                          -- server-derived when recorded; plain id
  security_code TEXT NOT NULL DEFAULT '',
  device_id INTEGER,                             -- plain id, with a name snapshot
  device_name TEXT NOT NULL DEFAULT '',
  user_id INTEGER,                               -- plain id, with a name snapshot
  user_name TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}'              -- JSON object
);
CREATE INDEX checkin_events_day ON checkin_events (campus_id, day, action);
CREATE INDEX checkin_events_checkin ON checkin_events (checkin_id);
CREATE INDEX checkin_events_person ON checkin_events (person_id, id);
CREATE TRIGGER checkin_events_no_update BEFORE UPDATE ON checkin_events
  BEGIN SELECT RAISE(ABORT, 'checkin_events is append-only'); END;
CREATE TRIGGER checkin_events_no_delete BEFORE DELETE ON checkin_events
  BEGIN SELECT RAISE(ABORT, 'checkin_events is append-only'); END;
ALTER TABLE checkin_devices ADD COLUMN app_version TEXT NOT NULL DEFAULT '';
ALTER TABLE checkin_devices ADD COLUMN app_version_at TEXT;
```

**The migration itself:**
- **Additive only:** no UPDATE or DELETE of existing rows.
- **`SCHEMA_VERSION` becomes 41.** This bypasses `test/api.test.js:1847` (it uses the constant).

**Rollback:** reverting the code leaves the table in place. It is harmless and nothing reads it.

### 4.2 Event writer: new module `server/checkin-events.js`

- **The function:**
  - `recordEvent(db, req, { action, campusId, checkinId, personId, householdId, code, clientAt, detail })`
  - It throws if `action` isn't in `ACTIONS`.
- **Actor:**
  - **A station:** `device_id`, `device_name` = `req.user.station.id` and `.name`, with `user_id` null.
  - **A hub user:** `user_id`, `user_name` = `req.user.id` and `.name`.
  - **App version:** the validated `x-checkin-version` header.
- **Times:**
  - `at` = `new Date().toISOString()`.
  - `day` = `localNow(campus.timezone, now).date`.
  - `client_at`: accepted only if `Date.parse` succeeds; stored as ISO, otherwise null.
- **Detail rules:**
  - Detail is a plain object, JSON-encoded and capped at 2,000 characters (too long → 400).
  - Free text from the client is allowed only as `by_claimed` (≤ 100 characters) and `station_label` (≤ 60).
  - Never copy allergies, medical notes, phones, emails, addresses or birthdates.
- **Transactions:** called inside the same `tx()` as the change it records, so a check-in and its event are stored
  together or not at all.

**`ACTIONS` and where each is written:**

| Action | Written by | Row | `detail` |
|---|---|---|---|
| `checkin` | `POST /checkin/checkins`, for each **newly** inserted row (`changes === 1`); replays write nothing | checkin, person, household, code, `client_at` = `checked_in_at` | `{kind, room_id, service_id, station_label}` |
| `checkin.skipped` | same route, for a record skipped (person not found, or another campus's family) | person (as sent) | `{reason: 'not_found' \| 'other_campus'}` |
| `checkout` | `POST /checkin/checkout`, for each row released (`changes === 1`) | checkin, person, household, code | `{path: 'code' \| 'ids', by_claimed}` |
| `checkout.mixed` | same route, once per request, when the released rows span more than one household. **Record only: the request still succeeds (PR 2 refuses it)** | code if given | `{path, households: [ids], checkin_ids: [ids]}` |
| `checkout.repeat` | an id that exists at this campus but was already checked out | checkin, person | `{path}` |
| `checkout.unknown` | an id not found at this campus | checkin (as sent, ≤ 64 characters) | `{path}` |
| `checkout.code_miss` | the code path returns 404 | code (as sent, upper-cased) | `{}` |
| `checkin.delete` | `DELETE /checkin/checkins/:id`, written **before** the delete, in one `tx()` | checkin, person, household, code | `{kind, room_id, service_id, day, checked_in_at, checked_out_at}` |
| `roster.download` | `GET /checkin/roster`, **at most once per actor per campus per day** (skip if a row exists for the same campus, day, action and device or user) | — | `{households, children}` counts |
| `device.pair` / `device.update` / `device.remove` | `stations.js` POST / PATCH / DELETE `/checkin/devices`; the device fields are the station's | — | `{name}`; for update `{fields, from_campus, to_campus}` |
| `version.refused` | the version guard (§4.4), at most once per device per day | — | `{sent, required}` |
| `safety.settings` | `PATCH /checkin/safety` | campus null, day null | `{from, to}` |

The existing `audit_log` rows (`checkin.device`, `checkin.device.remove`) stay as they are.

### 4.3 Endpoints (all in `server/routes/checkin.js`, except where noted)

**`GET /api/checkin/events?campus_id=&day=YYYY-MM-DD[&action=]`**
- **Access:**
  - `requireRole('staff')`.
  - Refuse `req.user.station` with 403 (stations pass `stationMay` for `/checkin/*`, and their role is leader, so
    `requireRole` already refuses them; test it anyway).
  - `campus(req, …)`, so the campus must exist and pass `canCampus`.
- **Query:**
  - `day` is required: `isDate`, otherwise 400.
  - `action` is optional and must be in `ACTIONS`, otherwise 400.
- **Response:**
  - Returns `{ events, truncated }`: up to 5,000 rows in `id` order.
  - Each event has `detail` parsed, plus `first_name` and `last_name` LEFT JOINed from `people` at read time (not
    stored).
- **Audit:** writes `audit(db, req, 'checkin.events.view', {campus_id, day})`.

**`GET /api/checkin/safety`** (admin)
- **Access:** `requireRole('admin')`. Campus-limited admins may read.
- **Response:** `{ require_current_app: boolean, current_app_version: CHECKIN_APP_VERSION }`.

**`PATCH /api/checkin/safety`** (admin, all campuses)
- **Access:** `requireRole('admin')`, then `requireAllCampuses`.
- **Body:** `{ require_current_app: boolean }`.
  - An unknown key → 400.
  - A wrong type → 400.
  - This is stricter than `PATCH /settings`.
- **Storage:** `setSetting(db, 'checkin_safety', {...current, ...body})`.
- **Audit:** `audit(db, req, 'checkin.safety', {from, to})` plus a `safety.settings` event.
- **Not in `SETTINGS`:** `checkin_safety` is **not** added to `SETTINGS` in `setup.js`, so `GET /settings` never
  shows it and `PATCH /settings` can't change it.
- **Default:** `{ require_current_app: false }`. Later PRs add their keys here (for example `legal_hold` in PR 3).

**`GET /api/checkin/devices`** (`stations.js`, unchanged guard `requireRole('staff')`)
- Adds `app_version` and `app_version_at` to each row.

### 4.4 App version

**Shared version constant:**
- `public/js/checkin-rules.js` exports `CHECKIN_APP_VERSION = 1`.
- It is an integer, raised by any PR that changes what the iPad sends or how it releases.
- The server imports it from the same file, just as `checkin.js` already imports `roomFor`.

**Client** (`public/js/checkin.js`):
- **Every request:** `call()` adds the header `x-checkin-version: <CHECKIN_APP_VERSION>`.
- **On a 426 with `reload: true`:**
  - Show a status message that stays: "This iPad needs the latest check-in. Close the app and open it again."
  - Keep the queue and the outbox exactly as they are. Today's code already keeps them on any non-2xx response;
    don't change that.
- **Service worker:** bump `CACHE` in `public/sw.js` to `mb-checkin-v5`.

**`stationAuth`** (`stations.js`):
- After the station is found, read the header and validate it with `/^\d{1,6}$/` (otherwise treat it as missing).
- If it differs from `d.app_version`, run `UPDATE checkin_devices SET app_version = ?, app_version_at = ?` (JS ISO
  time).
- Set `req.checkinVersion`.
- **Leave the `req.user ||` early return alone.** It is PR 4's change.

**Version guard** (`checkin.js`, a middleware):
- **Applies only when** `checkin_safety.require_current_app` is true **and** `req.user.station` is set.
- **Routes:** `GET /checkin/roster`, `GET /checkin/active`, `POST /checkin/checkins`, `POST /checkin/checkout` and
  `DELETE /checkin/checkins/:id`.
- **When the version is missing or below `CHECKIN_APP_VERSION`:**
  - It responds with **426** `{ error: 'This iPad is running an older check-in. Close the app and open it again, then try once more.', reload: true }`.
  - It writes `version.refused` (deduplicated).
- **Never applied to:**
  - hub users
  - `/checkin/station`, `/checkin/pair*` and `/checkin/campuses`
  - `/campuses` and `POST /people`

### 4.5 UI (`public/js/pages/stations.js`; phone first, plain wording, [design-system.md](../../design-system.md))

**Each station row** shows one of these, based on `app_version` against the current version:
- "Up to date"
- "Older check-in, reload this iPad" (warning style)
- "Not reported yet"

**Admin-only card "Check-in safety":**
- **Shown** only when `me.role === 'admin'`.
- **Disabled for campus-limited admins**, with the `ALL_CAMPUSES_MESSAGE` wording.
- **The switch:** a labelled checkbox, "Only let iPads with the latest check-in sync".
- **Help text:** "Turn this on once every iPad above says Up to date. Older iPads keep what they've recorded and
  sync after they're reopened."

**Accessibility:**
- a real `<label>`
- status shown in text, not only colour
- 44 px tap targets

### 4.6 Tests: new file `test/checkin-record.test.js`

**Setup** (copy `test/household-safety.test.js:16-47`: an in-memory database, two campuses, accounts made with
`startSession`, a station paired through the real routes):

**Fixed clock:**
- At the top of `before`, **before any session or pairing**:
  `mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-02-21T15:30:00Z') })`.
- Disable it in `after`.
- Use `mock.timers.setTime(…)` for the time-zone case.
- **If mocking `Date` breaks the HTTP stack:**
  - Build every expected date with `localNow(tz, new Date())` instead.
  - Never hard-code today's date.
  - Say in the PR which approach was used.

**Cases:**
1. **The schema:**
   - `user_version === SCHEMA_VERSION`.
   - The table, indexes and both triggers exist.
   - A direct `UPDATE` and a direct `DELETE` on `checkin_events` each throw "append-only".
2. **Check-in upload by the station:**
   - Exactly one `checkin` event per new record, with `device_id` and `device_name` from the pairing, `user_id` null,
     `household_id` from the server, the code, `client_at`, and `app_version` from the header.
   - Re-sending the same batch adds no events.
   - A record for another campus's family writes `checkin.skipped` (`other_campus`). An unknown person writes
     `not_found`.
3. **The same upload by a staff user:** `user_id` and `user_name` are set, `device_id` is null.
4. **Check-out by code:**
   - A `checkout` event per child.
   - `detail.by_claimed` equals the body's `by`.
   - The actor comes from the server, even when `by` says something else.
5. **Characterisation, two families:**
   - Check out ids from two households in one request. It **still returns 200 and releases both**.
   - Exactly one `checkout.mixed` event lists both household ids.
   - The test is named so that PR 2 flips it.
6. **Repeats and misses:**
   - A repeat check-out → `checkout.repeat`.
   - An unknown id → `checkout.unknown`.
   - A wrong code → 404 plus `checkout.code_miss`.
7. **A deleted check-in:** after `DELETE /checkin/checkins/:id`, the `checkin.delete` event still exists with the
   snapshot fields.
8. **Roster downloads:** two downloads by the station on one day → one `roster.download`. Moving the clock to the
   next day → a second one.
9. **Station changes:** pair, rename and remove a station → `device.pair`, `device.update`, `device.remove`. Events
   keep the name after the device row is gone.
10. **Canary:**
    - Give a child `allergies` and `medical_notes` containing `CANARY-7Q`, and an adult a phone `555-0199`.
    - After every step above, no `checkin_events` row (any column) contains either string.
11. **`GET /checkin/events` access:**

    | Caller | Result |
    |---|---|
    | Staff with all campuses | 200 |
    | Campus-limited staff, own campus | 200 |
    | Campus-limited staff, other campus | 403 |
    | Leader on `checkin_user_ids` | 403 |
    | Station | 403 |
    | Signed out | 401 |

    It also writes the `checkin.events.view` audit, and a missing or bad `day` → 400.
12. **Time zone:**
    - With the clock at `2027-02-21T05:30:00Z` and a campus in `America/Chicago`, an event's `day` is `2027-02-20`.
    - Filtering `day=2027-02-20` returns it.
13. **Safety settings:**
    - `GET` works for an admin. Staff → 403. Station → 403.
    - `PATCH` works for an admin with all campuses. A campus-limited admin → 403. An unknown key → 400. A non-boolean
      → 400.
    - The `audit_log` row `checkin.safety` holds `from` and `to`, and a `safety.settings` event exists.
    - `GET /settings` (as admin and as volunteer) has no `checkin_safety` key.
14. **App version:**
    - The header is stored on the device and shown by `GET /checkin/devices`. A value such as `abc` is stored as `''`.
    - **Switch off:** a station with no header and one with `0` both work as today.
    - **Switch on:**
      - no header or `0` → 426 with `reload: true` on the five routes, plus one `version.refused` per day
      - the current version → 200
      - a staff user with no header → 200
      - `/checkin/station` with no header → 200
15. **Regression:** the existing check-in tests (`api.test.js:773`, `1727`, `1959`, `household-safety`,
    `attendance-access`, `qa-pass`) pass **without edits**.

**UI:** add the Stations version column and the admin card to `npm run test:ui` (`scripts/ui-smoke.mjs`) if it covers
Stations. Otherwise state that it wasn't tested in the browser.

### 4.7 Docs in the same PR ([development.md](../../development.md) table)

| Page | What to add |
|---|---|
| `docs/database.md` | The migration count; the `checkin_events` row; a short "Append-only tables" rule (triggers, no FKs, name snapshots); the new `checkin_devices` columns; "Sensitive data": events never hold medical text |
| `docs/api.md` | The three endpoints, the `x-checkin-version` header, the 426 response |
| `docs/permissions.md` | Events: staff+ at their campuses, never stations. Safety settings: admins, and changes need all campuses |
| `docs/features.md` | A row: "Check-in record and iPad versions", Built, not used at the desk yet |
| `docs/architecture.md` | Area settings in one `settings` key with their own endpoint (when the key mustn't be in `GET /settings`); the append-only pattern |
| `docs/testing.md` | The fixed-clock pattern (`mock.timers` with `Date` only, enabled before sessions) |
| `docs/plans/child-safety/README.md` | Mark PR 1 done |

### 4.8 What must NOT change in PR 1

- **Responses of existing routes:** every field and status code stays the same. That covers `/checkin/roster`,
  `/checkin/active`, `/checkin/checkins`, `/checkin/checkout`, `DELETE /checkin/checkins/:id`, pairing and
  `/checkin/devices`. The one addition: the two version fields on `/checkin/devices`.
- **Codes:** 4-character pickup codes and their alphabet.
- **Check-out:** "Check out all", the code and ids paths, and the flat offline outbox. `checked_out_by` keeps storing
  `by` as today.
- **Deletes:** stations and leaders can still delete a check-in (PR 3 changes this).
- **Access:** `canCheckin`, `checkin_user_ids`, `stationAuth`'s session-first rule and `stationMay` are untouched.
- **Labels:** content and printing.
- **Settings and audit:** `SETTINGS` in `setup.js` and existing `audit_log` actions stay as they are.
- **No new dependency, env var or background job.**
- **People, households, services, series and merge code** are not touched.

**Security review focus:**
- the actor can't be forged
- detail can't carry medical text
- the events endpoint's campus scope
- the 426 guard can't lose a queued record

### 4.9 Done when

- `npm test` is green, and the run is reported.
- The `security-specialist` review is resolved.
- QA has paired a test iPad (or a browser) and seen the version on Stations, and turned the switch on and off.
- `devops-engineer` has applied migration 41 to a restored backup copy and checked `integrity_check` and
  `foreign_key_check`.
- The Chief Architect's review says ready.

---

## 5a. Owner decisions made (27 Nov 2026)

- **PR 1:** built and deployed (live with deploy #129). **PR 2:** built and reviewed (#130), held until the pilot.
- **PR 3 approved:** protect check-in history (no deletes of check-ins or past serving records; past services can't
  be deleted), after a backup and a rehearsal on a copy of real data.
- **PR 4:** the "Kids' check-in" access is **automatic for staff and admins**; anyone else needs the per-account
  switch (like Attendance). Who has the switch on day one: still to name before the pilot.
- **PR 5 approved:** pickup codes are a station letter plus 4 characters; medical details at three levels (always
  shown / on tap / office only).
- **PR 6 approved as recommended:** holds are placed and removed by staff with check-in access at that campus, and the
  safeguarding lead is told each time.
- Still open: no offline approvals in V1 (item 5), the Christmas freeze (item 6), the pre-pilot names and printer
  models (item 7), how long the check-in record is kept, and the PR 2 questions (refusing the old check-out shape and
  mixed offline reports once all iPads are on version 2; accepting backdating within the check-in-to-now window).

## 5. Owner decisions still open

**Needed before PR 1:** none.

**Later:**
1. **Before PR 3:** approve the history protection. The database will refuse to delete check-ins and past serving
   records, and past services can no longer be deleted (a backup and a rehearsal on a copy come first).
2. **Before PR 4:** approve the "Kids' check-in" switch on each account (like the Attendance switch). Decide whether
   staff and admins keep check-in automatically or need the switch too, and name who has it on day one.
3. **Before PR 5:** confirm 5-character pickup codes (a station letter plus 4 characters) and the three medical
   levels (always shown / on tap / office only).
4. **Before PR 6:** who may put on and take off a "Hold: see coordinator". Recommended: staff with check-in access at
   that campus, with the safeguarding lead told each time.
5. **Confirm no offline approvals in V1.** Anyone not on the list is released only by the coordinator at the desk
   after a call to a parent.
6. **Freeze:** confirm no deploys from 19 Dec to 3 Jan, and whether PR 3 or PR 4 may go live before it.
7. **Before the pilot (not code):**
   - name the safeguarding lead and a backup, the duty coordinators, the legal-hold admin, the tech volunteer and the
     paper-kit owner
   - send the label printer models and a sample Subsplash export
