# Database

SQLite through `node:sqlite`, one file per church (`MB_DB`). The schema is defined only by the
`MIGRATIONS` array in `server/db.js` (35 migrations). This page is a map; when it and
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
| `settings` | Key → JSON value: church name, brand colour, app config, media/podcast/mux settings, backup state, live state… |
| `campuses` | Campuses with time zone, colour, address. Most data is campus-scoped. |
| `serving_campuses` → people, campuses | Campuses a volunteer can serve at (migration 32). No rows = home campus only (`people.campus_id`); no rows and no home campus = any campus. Rules in `server/eligibility.js`. |
| `households` → campuses | Families: address, phone, notes. |
| `people` → households, campuses | Everyone in the directory: contact, birthdate, grade, status, photo, **allergies, medical notes**, sign-up/welcome dates. |
| `household_pickups` → households | Who may pick up the kids. |
| `users` → people | Sign-in accounts: `role`, `campus_ids` (JSON or NULL = all), `finance`, `announce`, `role_auto` (leader via team), `password_hash`, `notify` prefs, `theme`, `link_requested_at` (an unlinked account last asked the office to link it). |
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
| `checkins` → people, rooms, services | Kids' check-ins with security codes and check-out. |
| `checkin_devices`, `device_pairings` | iPads paired as check-in stations (token stored as a hash). |

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
| `media` | The library: YouTube or Mux source, the app's own title/picture/trim/tags, upload state, trimmed copy (`clip_*`), podcast audio (`audio_*`), `status` published/hidden/skipped. |

### Operations
| Table | Purpose |
|---|---|
| `backups`, `backup_files` | Nightly encrypted backup runs and which uploaded files are in Drive. |

## Sensitive data

Where the sensitive data lives, so reviews know where to look (standards in
[security.md](security.md)):

| Class | Tables / columns |
|---|---|
| Children's medical and safety | `people.allergies`, `people.medical_notes`, `household_pickups`, `checkins.security_code` |
| Contact details | `people`, `households`, `connect_cards`, `event_signups`, `form_responses` (typed name, email, phone) |
| Pastoral / spiritual | `profile_values` (staff-visibility fields), `households.notes`, `connect_cards.message`, `form_responses.answers` (free text; may be pastoral or medical, staff-only) |
| Giving | `gifts`, `recurring_gifts`, `giving_customers`, `statement_sends` |
| Private communication | `messages`, `message_files`, `task_comments`, `notifications` |
| Credentials | `users.password_hash`, `sessions` (hashed), `login_codes`, `checkin_devices.token_hash`, Drive refresh token in `settings` |
