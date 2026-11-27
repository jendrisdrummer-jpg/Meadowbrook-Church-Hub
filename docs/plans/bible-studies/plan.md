# Plan: Bible studies (study tracking)

Chief Architect · 27 November 2026 · **Status: draft for the owner's approval. Nothing is built.**
Owner's ask: "an area for Bible studies … see how many we have going on, who's teaching and who's in them, and
what Bible studies people have completed, maybe on their profiles, but a Bible studies page would be great."
Related: small groups (#57, migration 33), Classes (plan PR #118, build PR #122, held until January),
roadmap C5 (small-group meetings with roll call) and L2 (classes).

## In plain words (for the owner)

1. A Bible study is a **small group with a little more information**: what it's studying (a book of the Bible or
   a topic), a term (for example "Spring 2027"), start and end dates, and its teachers.
2. It keeps everything small groups already have: a roster, a private group chat, "My groups" in the app.
3. A new **Bible studies** page shows how many studies are running, who's teaching, who's in each one, with
   campus and term filters, and an archive of past studies.
4. When a study ends, the teacher (or staff) ticks who **completed** it. That record stays on the person for good,
   even if they leave the roster or the study is archived.
5. A person's page gets a **Bible studies** card: studying now, studies completed, studies taught.
6. Weekly attendance is **optional** and comes in a later step, only if you want it.
7. Past history can be typed in by staff, or loaded from a spreadsheet (CSV).
8. No new services, no costs, no new software libraries. About five small releases.

---

## 1. Goal and scope

**V1:** studies as a kind of small group; Bible studies page (counts, teachers, rosters, campus and term filters,
past archive); per-person completions that outlive the roster; profile card; member app "Studies completed";
simple reports and CSV export; manual entry of past studies; CSV import of history.

**Optional V1.5 (owner's answer decides):** weekly meetings with attendance, built for all small groups (it is
roadmap C5's "meetings with roll call"), not just studies.

**Out of scope:** member sign-up and join requests (an owner question; groups deliberately have none today),
a group finder, curriculum or lesson content, videos and quizzes (that is Classes), certificates, reading plans or
a Bible reader, children's or teen studies with minors (groups are adults only in Stage 1), automatic completion.

## 2. Overlap check and recommendation

| Need | Small groups (milestone-1) | Classes (#122, unmerged) |
|---|---|---|
| Roster, leaders, campus scoping | Yes (`group_members.is_leader`, `staffOf`, `canCampus`) | Enrolments; managers are *accounts* (`class_managers`), not people |
| Private group chat, "My groups" in the app | Yes | No |
| Topic, book, term, dates | No (name, description only) | Session steps have dates |
| Per-session attendance | No (C5, not built) | Yes, per session step |
| Completion history | No | Yes (`class_completions`, soft revoke) |
| Videos, quizzes, expiry, team requirements | No | Yes (training and compliance) |
| Shipped? | Yes (#57) | No; held until January; its migration is numbered 40, which milestone-1 already uses (`checkin_events`), so it must renumber |

**Recommendation: (a), a kind of small group.** A Bible study is people who meet together over weeks with a
teacher and a chat; migration 33's own comment names "Bible study" as a small group. The missing pieces (topic,
term, dates, completions, optional attendance) are small and additive. Classes (b) is a step-and-quiz engine for
training and compliance: it would bring in machinery studies don't need, has no chat, models teachers as accounts
rather than people, and would leave this blocked until January behind an unmerged branch. New (c) would duplicate
rosters, chat and scoping.

**Seam for later:** completions are kept in their own table shaped like `class_completions`, so a future
"Classes & studies" view (one "Completed" card on the profile) is a read-side union, not a data migration.

## 3. Reuse (don't rebuild)

| Need | Reuse | Where |
|---|---|---|
| Roster, teachers, add/remove, candidates (adults at the campus), 30 adds a day | Small groups | `server/routes/groups.js`, `public/js/pages/group.js` |
| Group chat that follows the roster | `chats.kind = 'smallgroup'` | `server/routes/chat.js` |
| Staff-of-group rule (church-wide = staff with no campus limit) | `staffOf`, `open()` | `groups.js` lines 32–43; extract to a shared helper (below) |
| Member app list | "My groups" | `public/js/member/main.js` `myGroups` |
| Merge duplicates | group_members move already | `server/routes/people.js` ~301 (add completions and attendance) |
| Today in the church's time zone, injectable clock | `localNow(tz, at)`; the `now` option pattern from the Classes plan §3.2 | `server/http.js` |
| CSV read and write (formula-safe) | `parseCsv`, `toCsv` | `server/csv.js`; preview-then-commit like `POST /import/preview` |
| Roll-call style marking (unmark always allowed) | Take attendance | `public/js/rollcall.js` patterns |
| Audit | `audit()` | `server/http.js` |

## 4. Design

### 4.1 Data model (PR 1: one additive migration)

**`groups` gains** (ALTER TABLE ADD COLUMN, constant defaults; existing groups become `kind = 'group'`, nothing
rewritten):
| Column | Notes |
|---|---|
| `kind` TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group','study')) | A study is a group with `kind = 'study'`. Changing kind later is staff-only and audited |
| `topic` TEXT NOT NULL DEFAULT '' | Book of the Bible or topic, free text ("Romans", "Prayer"). No hard-coded book list |
| `term` TEXT NOT NULL DEFAULT '' | Free label ("Spring 2027"); the form suggests terms already used, so spelling stays consistent |
| `starts_on`, `ends_on` TEXT NULL | Church dates `YYYY-MM-DD`; `ends_on` NULL = ongoing |
| `meets` TEXT NOT NULL DEFAULT '' | "Wednesdays 7 pm, Room 2" (display only) |

Teachers are `group_members.is_leader = 1` (shown as "Teacher" on a study). No new role and no account access:
a group still never touches `users.role`.

**`study_completions`** (new; the record that outlives the roster)
| Column | Notes |
|---|---|
| `id` INTEGER PK | |
| `person_id` → people ON DELETE CASCADE | Like `profile_values` and `class_completions`; archiving a person (the norm) keeps it |
| `group_id` → groups ON DELETE SET NULL | NULL for imported history with no study row |
| `role` TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant','teacher')) | Records "taught" history too |
| `title`, `topic`, `term` TEXT | **Snapshots** at completion, so the record reads correctly after renames or for imports |
| `campus_id` → campuses ON DELETE SET NULL | For campus scoping of history |
| `completed_on` TEXT NOT NULL | Church date |
| `source` TEXT NOT NULL CHECK (source IN ('teacher','staff','import')) | |
| `by_user` → users ON DELETE SET NULL, `note` TEXT DEFAULT '', `created_at` | |
| `revoked_at`, `revoked_by` → users SET NULL | Soft undo, audited; never a hard delete from the app |
| Indexes | `(person_id, completed_on)`; UNIQUE `(group_id, person_id, role)` WHERE `group_id IS NOT NULL AND revoked_at IS NULL` |

**Settings** (key `studies`, per church, its own defaults in one place in a small `server/studies.js`):
`{ label: 'Bible studies' }`; a church may call them "Life Groups" or "Courses". If V1.5 ships, add
`suggest_complete_pct` (null = off). No church values in code.

**V1.5 (separate, later migration, only if approved):** `group_meetings (id, group_id → groups CASCADE, met_on,
note, created_by → users SET NULL, UNIQUE(group_id, met_on))` and `group_attendance (meeting_id → group_meetings
CASCADE, person_id → people CASCADE, PK both)`. For every small group, not only studies (C5). Attendance only
*suggests* completion (pre-ticks), never decides it.

Status is computed, never stored: `upcoming` (starts_on > today), `running`, `finished` (ends_on < today),
`archived`. A pure helper `studyStatus(group, today)` with unit tests on fixed dates; `today` from the campus
time zone and an injected clock, never from the client.

### 4.2 Routes and guards

Studies are groups, so roster, chat, add/remove and archive stay in `routes/groups.js` unchanged in behaviour.
The new reading and completion endpoints go in **one new router, `server/routes/studies.js`**. The access rule
moves to **`server/group-access.js`** (`staffOf`, `openGroup`), used by both routers so they can't drift.

| Route | Guard and scoping |
|---|---|
| `POST /groups`, `PATCH /groups/:id` | Unchanged guard (staff, `staffOf`). Accept `kind`, `topic`, `term`, `starts_on`, `ends_on`, `meets` (validated `isDate`, `ends_on ≥ starts_on`, lengths capped). Audited `group.create`/`group.update` with kind |
| `GET /groups?kind=` | Unchanged visibility; `kind` filter so the Groups page can leave studies out (or show them, owner choice) |
| `GET /studies?campus=&term=&status=` | **Staff+**, `campusFilter` on `groups.campus_id` plus the church-wide rule. Lists studies with teacher names, member count, status. Volunteers and leaders: only studies they're in (same as `/groups`) |
| `GET /studies/summary?campus=&term=` | Staff+, same scoping. Counts below (§4.5) |
| `GET /studies/terms` | Staff+; distinct terms (for the filter and suggestions) |
| `POST /studies/:id/completions` `{person_ids, role?, completed_on?}` | Staff of the study, or a **teacher of that study**. Every person must be on the roster (teachers) or pass `canCampus` (staff). Default date = study `ends_on`, else today. Audited `study.complete` (ids and count) |
| `POST /study-completions/:id/revoke` | Staff of the study's campus, or the teacher who recorded it within 30 days. Audited `study.revoke` |
| `GET /people/:id/studies` | Current (roster rows of running/upcoming studies), completed, taught. Staff who can see the person (`canCampus`). A teacher sees only rows for studies they teach. The person themself via `/me/studies`. See owner question 6 for leaders |
| `GET /me/studies` | Signed in with a linked person; own current and completed |
| `POST /studies/past` | Staff; records a finished study typed in by hand: creates an archived `kind='study'` group **without a chat** and its completions in one `tx`. Campus rules as `POST /groups` |
| `POST /studies/import/preview`, `POST /studies/import` | **Admin, all campuses** (`requireAllCampuses`), like people import. Audited `study.import` (counts only) |
| `GET /studies/export.csv` | Staff+, campus-scoped; audited `study.export` (row count) |

All writes need `x-mb: 1`; parameterised SQL only; plain-English errors.

### 4.3 Pages (UI/UX Specialist first; phone first, design system)

- **Hub → Bible studies** (`#/studies`, `public/js/pages/studies.js`; nav label from the `studies.label` setting;
  staff and up see the overview, others see "Your studies"):
  - Top tiles: Running now · People in a study (this term) · Teachers · Completed this term.
  - Filters: campus (sidebar campus, as elsewhere), term, status (Running, Upcoming, Finished).
  - Rows: title, topic, term, dates, campus, teachers, member count, Open. Tapping opens the existing group
    page, which shows study details, the roster with "Teacher" labels, and a **Finish study** action.
  - **Past studies** tab: finished and archived studies, including hand-entered ones, searchable by title or topic.
  - "Add a past study" and "Import from a spreadsheet" (admin) under a "…" menu. Download CSV.
- **Finish study** (teacher or staff): a checklist of the roster, all ticked, untick anyone who didn't finish;
  teachers recorded as "taught". Then optionally archive. Plain wording: "Who finished Romans?".
- **Person page:** a **Bible studies** card: Studying now, Studies completed (title, term, date), Taught. Empty
  state folds into the Profile card as the page already does.
- **Groups page:** studies shown with a "Study" pill, or left out (owner choice; default: shown, with a filter).

### 4.4 Member app

- "My groups" already lists studies (they are groups); add the topic and term under the name.
- More → My info (or a "My studies" row): **Studies completed**, read-only.
- **Sign-up in the app: not in V1** (recommended). Groups deliberately have no finder or join requests yet. If the
  owner wants it, V2 adds `groups.open_signup` and a request a teacher approves (never instant joining: rosters
  open the private chat).

### 4.5 Reports

From `GET /studies/summary` (campus and term filters):
- studies running now, upcoming, finished this term;
- distinct people on a running study's roster this term (adults, not archived), and per campus;
- distinct teachers;
- completions this term and this year (not revoked), per study;
- CSV: one row per person per study (name, campus, study, topic, term, role, completed on).
Deeper reports ("who has never been in a study") are later.

### 4.6 Importing past history

1. **By hand** (staff): "Add a past study" with title, topic, term, dates, campus, teachers and who completed it
   (person picker). Good for a handful.
2. **CSV** (admin, all campuses): columns `person_id` (from the People export) or `email`, `first_name`,
   `last_name`, `study`, `topic`, `term`, `completed_on`, `role`. Preview shows matched, unmatched and duplicate rows;
   matches are by People id or **exact, unique email only**; anything else is listed for the admin to pick or skip.
   **Never creates people, never links accounts.** Rows sharing study and term become one archived past study.
   Re-running skips rows already recorded.
3. The existing "Classes completed" profile field is left alone (no automatic copying). Owner question 9.

### 4.7 Permissions (follows `docs/permissions.md`; needs Security review and owner approval)

| Action | Who |
|---|---|
| Create, edit, archive studies; set teachers | Staff and admins at the study's campus; church-wide studies only staff with no campus limit (the groups rule) |
| Manage roster, Finish study, record completions for their own study | Teachers (`is_leader`) of that study, plus staff as above |
| Bible studies overview, reports, all rosters, CSV export | Staff and admins, campus-scoped |
| Import CSV | Admins with all campuses |
| See their own studies and completions | Every signed-in person with a linked account |
| Leaders (role leader) | As today for groups: only studies they're in or teach. Not the overview, unless the owner says so (question 6) |
| Contact details on rosters | Staff only (unchanged from groups) |

Nothing here changes `users.role` or adds a permission flag.

### 4.8 Multi-church

All new data hangs off `groups`, `people`, `campuses`, `users`; the label lives in `settings`; terms and topics are
data, not code; no book list or term names in code; the router takes `db` and `now`. Keeps the database-per-church
path open.

## 5. Migration numbering

The migration number is **its position in `MIGRATIONS`**, so there can be no gaps and no reserved numbers.
Today milestone-1 ends at **40** (`checkin_events`). Child-safety PRs #130/#131/#136/#137/#138 hold **41–45** on a
stack. Classes (#122) is also written as 40 and must renumber anyway.

Rule for the Senior Developer:
1. Write the migration last in `MIGRATIONS` with a placeholder comment number, and build against milestone-1.
2. **Just before merge**, rebase on milestone-1 and number it `MIGRATIONS.length` after appending. Also update
   the comment, the count in `docs/database.md` and any test that counts migrations (for example
   `test/app-choices-migration.test.js`).
3. **Default order: merge Bible studies after the child-safety stack (41–45).** Then studies is 46, V1.5
   attendance is the next number, and Classes takes whatever is next in January. Renumbering stacked
   child-safety PRs is the costliest option; avoid it.
4. If the owner wants studies before child-safety merges, studies takes 41 and the five child-safety PRs each shift
   by one. The owner chooses this knowingly; DevOps re-rehearses.
5. Before merge, list open PRs that touch `server/db.js` (`gh pr list` then check each diff) and name in the PR which
   ones will need renumbering. Never renumber a shipped migration.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Losing completion history | Separate table with snapshots; group delete → SET NULL; soft revoke; merge moves rows; tests for roster removal and archive |
| Teachers marking people they don't teach | Completion route checks the roster for teachers; campus check for staff; tests |
| Leaders seeing other studies' rosters | Reuse the groups rule via one shared helper; tests for leader, volunteer, campus-limited staff |
| CSV import attaching history to the wrong person | Id or exact unique email only; preview; admin; audited; never creates people |
| Groups page and chat changing for existing groups | `kind` defaults to `group`; no behaviour change for existing groups; regression tests on groups |
| Past studies created without a chat | `chat_id` is already nullable in `summary`; test archived-without-chat paths |
| Date bugs | Pure `studyStatus` with fixed dates; injected clock; no "today" assertions |
| Migration clash | §5 |
| Rollback | Additive only; old code ignores the new columns and table |
| Overlap with Classes later | Completions shaped alike; "Classes & studies" view is read-side only |

## 7. Tests (API, `node:test`)

Create/edit study with fields (staff 201, leader and volunteer 403, campus-limited staff on another campus and on
church-wide 403); `/studies` scoping by role and campus; summary counts on fixed data; Finish study by teacher
(own roster only; outsider 403); completion survives removal from the roster and archive; revoke rules; profile
card visibility (staff, teacher, other leader, the person); `/me/studies`; past study without a chat; CSV preview
and import (matching, unmatched, duplicates, rerun idempotent, non-admin 403, campus-limited admin 403); merge
moves completions; existing groups unchanged. QA adds browser and phone checks (`npm run test:ui`).

## 8. Docs to update (same PRs)

`features.md` (new row; small groups row), `database.md` (columns, `study_completions`, count, sensitive-data
table: completions as pastoral/spiritual), `api.md` (routes), `permissions.md` (§4.7 table),
`design-system.md` if a new pattern appears, `help-content.js` and `docs/guides/` (Training Writer),
`merge-log.md` on merge. The **release checklist applies** (new area, migration, permissions).

---

## Steps

| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 0 | Owner answers the questions below and approves this plan | owner | — | — |
| 1 | Product check: worth doing now, against the beta order; confirm V1 vs V1.5 | `product-manager` | Yes (may edit roadmap docs) | 0 |
| 2 | Sunday reality: how studies run (terms, teachers, who records completion) | `church-operations` | Yes | 0 (parallel with 1, 3, 4) |
| 3 | Screens and wording: studies page, Finish study, profile card, app | `ui-ux-specialist` | Yes (proposal) | 0 (parallel) |
| 4 | Threats and controls: teacher scope, leader visibility, CSV import | `security-specialist` | Yes | 0 (parallel) |
| 5 | **PR 1 Data + API:** migration, `group-access.js` helper, `groups.js` fields, `studies.js` (list, summary, terms, completions, revoke, `/people/:id/studies`, `/me/studies`), merge, tests, docs | `senior-developer` | No | 1–4 |
| 6 | **PR 2 Hub UI:** Bible studies page, filters, past archive, Finish study, study fields on the group page, person card, CSV export | `senior-developer` (with `ui-ux-specialist` for polish) | No | 5 |
| 7 | **PR 3 Member app:** topic and term in My groups, Studies completed | `senior-developer` | No | 5 |
| 8 | **PR 4 History:** Add a past study; CSV import (admin) | `senior-developer` | No | 5 |
| 9 | Security re-review of PRs 1 and 4 | `security-specialist` | Yes | 5, 8 |
| 10 | QA: workflows, `npm test`, `npm run test:ui`, phone checks | `qa-engineer` | No (tests) | 6–8 |
| 11 | Accessibility pass on the new screens | `accessibility-specialist` | Yes | 6, 7 |
| 12 | Help and guide text | `training-writer` | No (guides) | 6–8 |
| 13 | Final review against this plan and the release checklist | `chief-architect` | Yes (docs) | 9–12 |
| 14 | Migration rehearsal and deploy plan | `devops-engineer` | No (ops docs) | 13 |
| 15 | **PR 5 (V1.5, only if approved):** meetings and attendance for all small groups; suggests completion | `senior-developer` → `qa-engineer` → `chief-architect` | No | 13 and owner |

Never run two editing agents at once. PRs 2–4 can be built one after another in any order once PR 1 is merged.

## Owner approvals needed

1. **Architecture:** Bible studies as a kind of small group (option a), not on Classes and not a separate area.
2. **Permissions:** the §4.7 table (teachers record completions for their own study; overview is staff-only).
3. **Merge order** for migrations (§5): default after the child-safety stack.
4. **CSV import** of history by admins (personal data coming in from a spreadsheet).
No new dependencies, services or costs.

## Questions for the owner (plain language)

1. Is a Bible study a **course with an end date** (say 8 weeks), an **ongoing group**, or both?
2. **Who teaches?** Always people on staff, or volunteers too? Can a study have more than one teacher? Is the
   teacher always part of the group?
3. Do you want **attendance each week**, or just "who's in it" and "who finished"?
4. What counts as **"completed"**? The teacher says so, attending most weeks (how many?), or simply being in it
   when it ended?
5. Should people **sign up in the app**, or does the office or teacher add them?
6. Should **leaders** (not staff) see the Bible studies page and other studies' rosters, or only their own?
7. Should **Classes and Bible studies** become one "Classes & studies" area later? (Recommendation: separate
   screens now, one "Completed" list on the profile later.)
8. Do you run **terms** (Fall, Spring), and what do you call them? Is "Bible studies" the right name in the menu?
9. Where is past history today (Faith Teams' "Classes completed" field, a spreadsheet, memory)? Should we copy
   anything from the existing profile field?
10. Should Bible studies also appear on the **Groups** page, or only on their own page?
11. Any **youth or teen** studies? Groups are adults-only today; teens would need the child-safety rules first.
