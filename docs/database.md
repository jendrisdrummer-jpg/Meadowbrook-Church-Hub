# Database

SQLite through `node:sqlite`, one file per church (`MB_DB`). The schema is defined only by the
`MIGRATIONS` array in `server/db.js` (45 migrations). This page is a map; when it and
`db.js` disagree, `db.js` is right, and this page should be fixed in the same pull request.

## Rules for changing the schema

1. **Append a new migration** at the end of `MIGRATIONS`, with a comment saying what it is for.
   **Never edit or reorder a migration that has shipped**: every church's database has already
   run it (`PRAGMA user_version` counts them).
2. Additive changes (`CREATE TABLE`, `ALTER TABLE … ADD COLUMN` with a default, new indexes) are
   the norm. SQLite can't drop or rename columns easily; avoid needing to.
3. **Destructive changes** (dropping tables/columns, deleting or rewriting existing rows, data
   back-fills that lose information) need the owner's explicit approval (see
   [agent-workflow.md](agent-workflow.md)) and a backup first (Settings → Backups → Back up now).
4. Dates: `TEXT`. UTC timestamps as `YYYY-MM-DD HH:MM:SS` (`datetime('now')`); local service
   and event times as `YYYY-MM-DDTHH:MM` in the campus's time zone. Money: integer cents.
   Flags: `INTEGER 0/1`. Lists/objects: JSON in `TEXT` (`'[]'`, `'{}'`).
5. Foreign keys are on. Choose `ON DELETE CASCADE` (child can't exist alone) or `SET NULL`
   (history should survive) deliberately.
6. Settings that are per church go in the `settings` table (`getSetting`/`setSetting`, JSON
   values), not new tables or env vars. See SaaS notes in [architecture.md](architecture.md).
7. Update this page and add tests for the new tables in the same change.

## Tables by area

Arrows show the main references.

### Church, people and access
| Table | Purpose |
|---|---|
| `settings` | Key → JSON value: church name, brand colour, app config (migration 37 put the "This week" card first on a saved Home layout once), media/podcast/mux settings, backup state, live state… |
| `campuses` | Campuses with time zone, colour, address, and `attendance_mode` (migration 36: `names`, `headcount` or `both`, which screen Take attendance opens first). Most data is campus-scoped. |
| `serving_campuses` → people, campuses | Campuses a volunteer can serve at (migration 32). No rows = home campus only (`people.campus_id`); no rows and no home campus = any campus. Rules in `server/eligibility.js`. |
| `households` → campuses | Families: address, phone, notes. |
| `people` → households, campuses | Everyone in the directory (names up to 100 characters; birthdate a real past date; email shaped like `x@y.z`): contact, birthdate, grade, status, photo, **allergies, medical notes**, sign-up/welcome dates. |
| `household_pickups` → households | Who may pick up the kids. Only `people.household_id` (set null) and this table (cascade) point at `households`; the empty-families tool (Settings → Checks) reads the foreign keys from the schema, so it never removes a household anything still uses. |
| `users` → people | Sign-in accounts: `role`, `campus_ids` (JSON or NULL = all), `finance`, `announce`, `attendance` (migration 36: may take attendance at its campuses), `home_layout` (migration 39: JSON `{order:[cardId], hidden:[cardId]}`, one person's Customise Home choice; NULL = the standard Home), `checkin` (migration 43: Kids' check-in switch; staff, admins and stations need none; copied from the old `checkin_user_ids` setting, which is no longer read), `app_editor` (migration 38: may open the App Builder and save the app; admins always can; off for everyone at first), `role_auto` (leader via team), `password_hash`, `notify` prefs, `theme` (`light`, `dark` or `device`; new accounts start as `device`, and migration 37 moved accounts still on the old `light` default to `device`), `link_requested_at` (an unlinked account last asked the office to link it). One account per person: index `users_person_unique` (unique where `person_id` is set) is created at startup by `ensureAccountLinkIndex` in `db.js` only when no duplicates exist, not by a migration (see [account-links.md](account-links.md)). |
| `sessions` → users | Sign-in sessions. `token` is the sha256 hex of the cookie value (never the cookie itself); rows from before hashing are converted on startup. |
| `login_codes` | Hashed one-time email sign-in codes. |
| `profile_fields`, `profile_values` → people | Custom profile fields (milestones, spiritual journey, classes) with a `visibility` of leader or staff. |
| `audit_log` → users | Who changed what (`audit()` in `http.js`). |
| `feedback` → users, campuses | Feedback from staff and leaders: category, severity, text, page, status, an admin-only note, and `done_note` (what was done, shown to everyone as "You said, we did"). |
| `forms` → campuses, users | Simple staff-configured forms: unique `slug` (the public link; never changes), `title`, `intro`, `campus_id` (NULL = church-wide), `questions` JSON `[{id, label, type, options, required}]` (types text, longtext, choice, multichoice, yesno, date), `audience` (`public` or `signed_in`), `ask_contact` JSON (name/email/phone each `off`, `optional` or `required`), `active` (off = archived: link stops working, responses stay), `notify_user_id`. |
| `form_responses` → forms (cascade), users, people | One response: typed `name`/`email`/`phone`, `answers` JSON, `status` (`new`/`done`) with `done_by`/`done_at`. `user_id` and `person_id` are set **only** from the signed-in account (its linked person), never from a typed email or name. Staff-only. |

### Teams, services and scheduling
| Table | Purpose |
|---|---|
| `teams`, `positions`, `team_members` → people | Ministry teams, their positions, members and leaders (`is_leader`). |
| `blockouts` → people | Dates a volunteer is away. |
| `service_types` (+ `service_type_needs`, `service_skips`) | Repeating services ("every Sunday 9:00 at North") that create services ahead of time. |
| `services` → campuses, service_types | Each service: time, title, series, `locked`. |
| `service_needs` → services, positions | How many of each position a service needs. |
| `plan_items` → services, songs, people | Order of service (headers, songs, items; `category`, `info`, `is_start`, `placeholder`). |
| `service_templates`, `template_items`, `template_needs` | Reusable orders of service with fill-in slots. |
| `songs`, `song_files` → songs | Song library and charts/lyrics/audio files. |
| `assignments` → services, positions, people | Who serves where; `status` pending/accepted/declined; draft until `sent_at`; `reminded_at` = automatic reminder sent, `nudged_at` = leader’s manual “Remind” (kept apart so a nudge never cancels the automatic one; migration 34). |

### Attendance and check-in
| Table | Purpose |
|---|---|
| `attendance` → services, people | Roll call (marked by the attendance team). |
| `headcounts` → services | Counts per area. |
| `rooms` → campuses | Kids' rooms by age/grade. |
| `checkins` → people, rooms, services | Kids' check-ins with security codes and check-out. Migration 41 (child-safety V1, PR 2) adds `checked_out_device_id` and `checked_out_user_id` (plain ids, no foreign keys, so they outlive the iPad or account; exactly one is set by a release, from what the server knows) and `client_checked_out_at` (the time an offline iPad said it released the child, as sent; `checked_out_at` holds that time kept between the check-in and the sync). `checked_out_by` is now the iPad's or account's name from the server, never the text the iPad sends. The child-safety plan numbers this migration 42; the number is the place in `MIGRATIONS`, so it is 41 here. Migration 42 (PR 3) adds `voided_at`, `voided_by` (the account's id, a plain integer), `voided_by_name` and `void_reason`: a check-in is **voided, never deleted**, every list leaves voided rows out, and the database refuses to delete a check-in (see [Protected history](#protected-history)). |
| `checkin_devices`, `device_pairings` | iPads paired as check-in stations (token stored as a hash). `app_version` / `app_version_at` (migration 40): the check-in app version the iPad last reported in `x-checkin-version` (`''` = never, or not a whole number), and when. `station_letter` (migration 44): the letter every pickup code from that iPad starts with, unique within a campus (partial unique index `checkin_devices_letter`; NULL allowed for the 22nd station on). Existing stations got A, B, C... in the order they were added. |
| `checkin_events` | **Append-only** record of what happened at kids' check-in (migration 40): `at` (server time), `day` (the campus's local date), `client_at`, `campus_id`, `action` (a closed list in `server/checkin-events.js`), plain ids (`checkin_id`, `person_id`, `household_id`, `device_id`, `user_id`) with name snapshots (`device_name`, `user_name`), `security_code`, `app_version` and a small JSON `detail`. Written by `recordEvent` in the same transaction as the change it records. Read through `GET /checkin/events` (staff and up). |

Migration 44 (pickup codes and medical levels) adds `checkin_devices.station_letter`, the `people` columns `allergy_epi` (0/1), `allergy_action` and
`medical_sorted_at`, and `person_care_notes (person_id PK, note, updated_by, updated_by_name, updated_at)`: private notes, one row per person, staff only, never
sent to a station. Pickup codes in `checkins.security_code` are now five characters (station letter + four); four-character codes on older check-ins stay valid.

Migration 45 (holds and who collected) adds `checkin_holds (id, person_id, person_name, campus_id, note, placed_at, placed_by, placed_by_name, changed_at,
changed_by, changed_by_name, lifted_at, lifted_by, lifted_by_name, lift_reason)`: one row per hold, never deleted. A child has at most one **active** hold
(`lifted_at IS NULL`, enforced by a partial unique index); lifting sets `lifted_at` and a later hold is a new row. `person_id` is a plain id with a name
snapshot (no foreign key), like `checkin_events`, so the history outlives the person record; `campus_id` is where it was placed (who may manage it), while it blocks release at
every campus. `note` is private to staff in the Hub (a pointer to the confidential list, at most 300 characters). Triggers: no `DELETE`, who/where/when can't change, a lifted
hold can't change, and a person with a hold on record can't be deleted (`people_keep_hold_history`). `checkins` gains `checked_out_to_name`,
`checked_out_to_relationship`, `checked_out_to_kind` (`household_adult`, `pickup_contact`, `other`, `unverified`, or empty when an older iPad sent none),
`checked_out_id_type` (`drivers_license`, `passport`, `other_photo_id`, `known`, `not_checked`; never an ID number) and `checked_out_held` (1 = released while a hold was on). The trigger
`checkins_collector_is_final` refuses any change to those columns once `checked_out_at` is set. How the church runs check-in is the setting `checkin_features` (`{checkout, holds, medical_tap, label_overflow, auto_team_ids}`; no migration, read through `checkinFeatures()` in `server/checkin-settings.js`, which fills in defaults). The safeguarding lead is the setting `checkin_safeguarding`
(`{lead_ids: [user ids]}`; up to 5).

### Communication
| Table | Purpose |
|---|---|
| `chats`, `chat_members`, `chat_reads` | Team chats (members follow the roster) and groups. |
| `groups`, `group_members` → people | **Small groups** (Bible study, home groups), separate from serving teams. `groups.campus_id` NULL = church-wide; `group_members.is_leader` marks the people who run the roster. A group never touches `users.role`. Each group has one chat: `chats.group_id` (unique), `chats.kind = 'smallgroup'`; its members are read live from `group_members` (no copy), so leaving the group leaves the chat. `chats.name` mirrors the group name for task and call cards. Migration 33. |
| `messages` (+ `message_files`, `message_reactions`) | Messages with replies, mentions, files, reactions, task and call cards. **Private.** |
| `calls` → chats | Video calls/meetings (Daily rooms). |
| `tasks`, `task_items`, `task_comments` | Personal, team and chat tasks with checklists, comments, repeats. |
| `notifications` → users | Each account's inbox. |
| `push_subscriptions` → users, `guest_push` | Devices that allowed push (accounts and guests). |
| `announcements` | Congregation announcements (audience, schedule, reach). |
| `connect_cards` → people | Cards guests fill in from the app. |

### Giving (Finance permission only)
| Table | Purpose |
|---|---|
| `funds` | Funds in sections. |
| `gifts` → people, funds, gift_batches, recurring_gifts | Every gift: online (Stripe) or cash/check, amount and fee in cents. **Sensitive.** |
| `recurring_gifts`, `giving_customers` | Stripe subscriptions and customers. |
| `gift_batches` | Offering counts. |
| `statement_sends` | Year-end statements sent. |

### Events
| Table | Purpose |
|---|---|
| `events` | Calendar events with optional sign-ups, questions, capacity, price. |
| `event_signups` → events, people | Sign-ups (guest key, answers, payment status). |

### Media
| Table | Purpose |
|---|---|
| `media` | The library: YouTube or Mux source, the app's own title/picture/trim/tags, upload state, trimmed copy (`clip_*`), podcast audio (`audio_*`), `status` published / hidden / skipped (left out by a rule) / **review** (“Needs a look”: `skip_reason` holds why). `status` is free text, so adding `review` needed no migration. The playlist, skip words and minimum length are keys inside the `media` settings value (`playlist_id`, `playlist_input`, `playlist_title`, `skip_words`, `min_minutes`). |

### Operations
| Table | Purpose |
|---|---|
| `backups`, `backup_files` | Nightly encrypted backup runs and which uploaded files are in Drive. |

## Protected history

Check-ins and past serving records are part of the church's safeguarding record, so migration 42 (child-safety V1, PR 3)
makes the **database itself** refuse to delete them. Mistakes are marked, not removed: a check-in is **voided** (`voided_at`,
`voided_by`, `voided_by_name`, `void_reason`; Staff and admins may void any check-in at their campuses; a leader with check-in access only one that is still open (not checked out) from today at that campus; an iPad never; a reason is required; audited), and a past service is simply kept.

**What the triggers refuse** (`BEFORE DELETE`, `RAISE(ABORT, <plain sentence>)`; the sentences are listed in `MSG` in
`server/history.js`, and `errorHandler` turns any that reach it into a plain 409):

| Trigger | Refuses to delete | Unless |
|---|---|---|
| `checkins_no_delete` | any check-in | never (void it) |
| `checkins_void_is_final` (`BEFORE UPDATE OF` the four void columns) | un-voiding or editing a voided check-in | never |
| `assignments_keep_history` | an **accepted** assignment on a service that is past | the assignment is pending or declined, or the service is upcoming |
| `assignments_no_restatus` (`BEFORE UPDATE OF status`) | changing an accepted assignment's status once its service began 14+ hours ago (so it can't be declined and then deleted) | the service began less than 14 hours ago, or the status isn't changing |
| `services_no_retime` (`BEFORE UPDATE OF starts_at`) | moving a service that began 14+ hours ago, and has the records below, to a later time (so it can't become "upcoming" and then be deleted) | the new time is still 14+ hours ago (a correction), or the service has no records |
| `services_keep_history` | a service that is past **and** has an accepted or sent assignment, a roll-call mark, a headcount or a check-in | the service is upcoming, or has none of those |
| `positions_keep_history` | a position with an assignment on a past service | nobody served in it at a past service |
| `people_keep_history` | a person with a check-in, a roll-call mark or any assignment | none of those (no route deletes people; they are archived) |

- **Two windows, on purpose.** Deletes use **now + 14 hours** (a service starting within a day is already protected). Updates (retime, status) use **now - 14 hours**, which is past in every US time zone, so leaders can still move tomorrow's service or change a Saturday-night answer without a workaround. Routes: `PATCH /assignments/:id` is refused (409) for any status change once the service began 14+ hours ago; `PATCH /services/:id` for a blocked retime; `PATCH /series/:id` clamps `from_date` to today and leaves a kept service's time alone.
- **Past (for deletes)** means `starts_at <= strftime('%Y-%m-%dT%H:%M','now','+14 hours')`. `starts_at` is campus-local time and no time
  zone is more than 14 hours from UTC, so this is past everywhere. `server/history.js` (`PAST_CUTOFF`, `serviceKeptSql`,
  `assignmentKeptSql`) holds the same rule for the routes, so a route says no politely first; change one and change the other.
- **The triggers fire through cascades** (spike, below): deleting a team stops at its positions, a campus at its services and
  check-ins, a person at their records. The whole statement is aborted, so nothing is half-deleted, and `tx()` rolls back.
- **Not a rebuild:** triggers were chosen over rebuilding `checkins` and `assignments` with `RESTRICT` foreign keys (a 12-step
  copy of every row, and the migration runner can't change `foreign_keys` inside a transaction). **Rule: any migration that
  rebuilds one of these tables must re-create its triggers in the same migration**, because a rebuild drops them silently.
  `test/history-services.test.js` fails if one is missing.
- **Rolling the code back** leaves the triggers; older code that tries to delete a protected row gets a generic error (the safe
  direction). Only a later migration (`DROP TRIGGER`) removes them, which needs the owner's approval.
- **Not guarded in V1** (see [tech-debt.md](tech-debt.md)): roll-call un-marking and headcount edits (**owner decision:** guard them, and should a legal hold freeze them?), and a `SET NULL` on `checkins.service_id` when an upcoming service is deleted.
- **Legal hold:** `checkin_safety.legal_hold` in `settings` (`{on, reason, set_by, set_by_name, set_at, released_at, released_by,
  released_by_name, release_reason}`), changed only through `POST /checkin/legal-hold` and `/release`. While it is on, a
  check-in can't be voided, people can't be merged, Google Drive can't be disconnected and `server/backup.js` deletes no copy
  in Drive (and none on disk that isn't also in Drive); for 7 days after a release backup copies are still kept.

### The spike: every path that deletes protected history

Checked on 2026-11-27 (line numbers are in the code before this change). Triggers verified under `node:sqlite` first: each fires
on a direct delete **and** through `ON DELETE CASCADE` (service, person, position, team, campus), the statement is aborted whole,
and `ON DELETE SET NULL` (an update, not a delete) does not fire them.

| Path (before this change) | Hits a trigger? | What it does now |
|---|---|---|
| `DELETE /checkin/checkins/:id` (`routes/checkin.js:322`) | Yes: `checkins_no_delete` | Returns 405 "can't be deleted, use Void"; `POST /checkin/checkins/:id/void` (staff, not iPads, reason required, audited, blocked by a legal hold) marks it instead; every list ignores voided rows |
| `DELETE /services/:id` (`routes/services.js:192`) | Yes, when past with records (and its cascade into `assignments`) | 409 with the plain sentence; the service page says "kept" instead of showing Delete (`kept` in `GET /services/:id`); upcoming or empty services delete as before |
| `DELETE /series/:id?from=` (`routes/series.js:209`) | Yes: it deleted past dates too | Never deletes before today, and skips (and counts as `kept`) any service the triggers would keep |
| `PATCH /series/:id` with an earlier `ends_on` (`routes/series.js:197`) | Yes: same | Same: only upcoming services after the new end date, skipping kept ones |
| `PATCH /assignments/:id` (`routes/services.js:597`; also the signed link in `routes/app.js`) | Not a delete, but a past accepted answer could be declined and then deleted | 409 once the service began 14+ hours ago; `assignments_no_restatus` backs it |
| `PATCH /services/:id` and `PATCH /series/:id` `from_date` (`routes/services.js:168`, `routes/series.js:182`) | Not a delete, but a past service could be moved to the future and then deleted | 409 for a service with records; `from_date` is clamped to today; `services_no_retime` backs it |
| `DELETE /assignments/:id` (`routes/services.js:612`) | Yes: past accepted | 409 "already served, kept in the record"; the remove buttons are hidden for them; drafts, declines and upcoming still delete |
| `DELETE /positions/:id`, including `force` (`routes/teams.js:160`) | Yes: cascades past assignments | 409 "people have served in this position... rename it instead"; unused or upcoming-only positions delete as before |
| `POST /people/:id/merge` (`routes/people.js:308`) | Yes: it deleted the duplicate's leftover assignments | Leftovers that are past and accepted **stay on the archived duplicate**; other leftovers (duplicates of what the kept person has, upcoming) go as before; check-ins and everything else move as before; blocked by a legal hold |
| Empty-family cleanup `DELETE FROM households` (`routes/people.js:391`) | No: members are `SET NULL`, and only empty families qualify | Unchanged |
| `DELETE /users/:id` (`routes/setup.js:242`) | No: sessions cascade; `assignments.sent_by` is `SET NULL`; the record tables keep plain ids | Unchanged (tested) |
| `DELETE FROM attendance` (`routes/attendance.js:88`, merge duplicates) and headcounts (`routes/checkin.js:380`) | No: not guarded in V1 | Unchanged |
| Deleting a person, team or campus | Yes (cascade) | No route does it; the triggers are the backstop |
| Demo seed and sample reset (`scripts/seed-demo.js`, `server/sample.js`) | No: they delete the whole file, never rows | Unchanged |
| Tests: `api.test.js` fixtures that deleted check-ins | Yes | They void the fixture rows instead (lists ignore voided rows); `app-choices-migration.test.js` also drops the new triggers and columns when it rewinds the schema |

## Append-only tables

Some records must outlive the things they describe, and must never be quietly changed. `checkin_events`
is the first. The pattern:

- **Triggers refuse `UPDATE` and `DELETE`** (`BEFORE UPDATE` / `BEFORE DELETE` ... `RAISE(ABORT, '... is append-only')`).
  Corrections are new rows, never edits.
- **No foreign keys** to people, users, households or devices, so deleting a person, account, family or station
  never cascades into the record (and is never blocked by it). Rows hold plain ids plus a **name snapshot**, so they
  still read correctly after the thing they name is gone. A name is joined from `people` at read time only for display.
- The one reference that stays is `campus_id`, with no `ON DELETE` action: a campus with history can't be deleted.
- Times are set in JavaScript (`new Date().toISOString()`), never `datetime('now')`, so tests can fix the clock.
- Rolling the code back leaves the table in place; nothing else reads it.

## Sensitive data

Where the sensitive data lives, so reviews know where to look (standards in
[security.md](security.md)):

| Class | Tables / columns |
|---|---|
| Pickup holds | `checkin_holds.note` (private, Hub only; staff with check-in access and the named safeguarding lead can read it). Never in `checkin_events`, the audit log, notifications, emails, the roster or any iPad response (the iPad only gets a yes/no `on_hold`). `checkins.checked_out_to_*` names who collected a child, with the kind of ID shown and never its number |
| Children's medical and safety | `people.allergies`, `people.allergy_epi`, `people.allergy_action` (Level 1), `people.medical_notes` (Level 2), `person_care_notes.note` (Level 3, migration 44), `people.medical_sorted_at` (set when staff have sorted a child's details into the levels), `household_pickups`, `checkins.security_code`. `checkin_events` holds ids, codes and name snapshots only: **never allergies, medical notes, phone numbers, addresses or birthdates** (the recorder truncates an oversized `detail` rather than failing, and accepts free text only as `by_claimed` ≤ 100 and `station_label` ≤ 60 characters, and `audit_log` gets ids and actions only for check-in events) |
| Contact details | `people`, `households`, `connect_cards`, `event_signups`, `form_responses` (typed name, email, phone) |
| Pastoral / spiritual | `profile_values` (staff-visibility fields), `households.notes`, `connect_cards.message`, `form_responses.answers` (free text; may be pastoral or medical, staff-only) |
| Giving | `gifts`, `recurring_gifts`, `giving_customers`, `statement_sends` |
| Private communication | `messages`, `message_files`, `task_comments`, `notifications` |
| Credentials | `users.password_hash`, `sessions` (hashed), `login_codes`, `checkin_devices.token_hash`, Drive refresh token in `settings` |
