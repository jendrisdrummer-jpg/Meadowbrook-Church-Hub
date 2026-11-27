# Plan: Bible studies

Chief Architect · 27 November 2026 · **Status: revision 2, draft for the owner's approval. Nothing is built.**
Revision 2 follows the owner's answers (below). Revision 1 made a study a kind of small group; that is dropped.

Owner's ask: "an area for Bible studies … see how many we have going on, who's teaching and who's in them, and
what Bible studies people have completed, maybe on their profiles, but a Bible studies page would be great."

What the owner told us, in short:
- Studies are personal: mostly one-on-one, sometimes a few people, occasionally larger. They are very different
  from life groups.
- Anyone can teach. A Bible study team leader keeps track and approves the material teachers use.
- Studies meet whenever and wherever suits them. Missing a week is normal. There's no "attendance".
- "Completed" means the person finished a particular study material.
- In the app, people **express interest** and the coordinator connects them with a teacher. They don't browse
  or join running studies.
- Classes is a separate "courses" area. Life groups are another future area, organised by semester.
- Past history comes in from a spreadsheet, or is added straight onto someone's profile.

## In plain words (for the owner)

1. The **Bible study coordinator** keeps a list of **approved materials**. Teachers only teach from that list.
2. A **study** is one or more teachers, one or more students and one material. It can be **active, paused or
   finished**. You can add when and where it meets ("Tuesdays, coffee shop") and how far along it is ("lesson 3 of 8").
3. In the app, anyone can tap **"I'd like to do a Bible study"** and say what they'd prefer. The coordinator sees
   the request, finds a teacher and starts the study.
4. When a student finishes a material, it is recorded. Their profile shows **Studies completed** for good, and
   the teacher's profile shows **Studies taught**.
5. Teachers with an account see and update only their own studies. A teacher with no account is fine; the
   coordinator updates their study for them.
6. The **Bible studies page** (coordinator and staff only) shows what's active, who's teaching, who's waiting for
   a match, and completions by material.
7. Nobody else sees who is studying with whom. There are no reminders for missed weeks.
8. Past studies can be added on a profile, or loaded from a spreadsheet.
9. No new services, no costs, no new software libraries. About five small releases.

---

## 1. Goal and scope

**V1:** approved-materials catalogue; studies (teachers, students, material, status, rhythm and place, progress);
per-student completions that outlive the study; profile cards (completed, taught); interest requests from the
member app and a coordinator queue; "My Bible studies" for teachers and students; the coordinator's Bible studies
page with counts and filters; adding history on a profile; CSV import with a preview.

**Out of scope:** attendance or meeting logs; reminders or nags; members browsing or joining studies; study
chats (people use their own messages, or an ordinary chat group if they want one); lesson content, files or
videos (that is Classes territory); teacher training or certification (owner question 2 may add a simple
"approved teacher" mark); pastoral notes; **life groups** (below).

**Life groups (roadmap item, not this plan).** A future semester-based section, built on **small groups** (rosters,
leaders, chat already exist), with a semester or term on each group and the roster changing each semester. It
fits roadmap C5. Hand it to the Product Manager to file; it shares nothing with this plan.

## 2. Why its own small module

| Option | Fit now |
|---|---|
| A kind of small group (revision 1) | **No.** Groups have a visible roster, a group chat everyone on the roster sees, leaders who add people, and "My groups". Studies are private, mostly one-on-one, matched by a coordinator, and tied to an approved material. Each of those would have to be switched off or worked around |
| Built on Classes | **No.** The owner says Classes is a courses section. It is step, video and quiz based, its managers are accounts, and it isn't merged |
| **Own module** | **Yes.** Five small tables and one router. People are the only shared root |

**Shared:** links to `people` (teachers and students are people, accounts optional), `campuses` for scoping,
the person picker, `audit()`, `csv.js`, the injected-clock and `localNow` pattern, and `notify()` for the coordinator's
new-request notice. **Not shared:** no group rows, no chats and no class tables. `study_completions` keeps a shape
close to `class_completions` (date, by whom, soft revoke) so one "Completed" list on the profile stays possible
later, but nothing depends on it.

**Why not Forms for the interest request:** a form response is staff-only, has only new/done status, and links to
nobody unless the person is signed in. The queue needs a link to the person, a matched/declined state, a
link to the study it became, and coordinator (not staff-only) access. A small dedicated table is simpler than
bending Forms.

## 3. Design

### 3.1 Data model (PR 1: one additive migration)

**`study_materials`**: the approved catalogue
| Column | Notes |
|---|---|
| `id` PK, `title` TEXT NOT NULL | |
| `author` TEXT DEFAULT '' | Author or publisher |
| `lessons` INTEGER NULL | Number of lessons, optional |
| `teacher_notes` TEXT DEFAULT '' | Shown to teachers (how to use it, where to get it) |
| `active` INTEGER DEFAULT 1 | Retired materials stay on history but can't start new studies |
| `created_by` → users SET NULL, `created_at`, `updated_at` | Never deleted once used (RESTRICT from studies and completions) |

Materials are church-wide (one coordinator approves for every campus). There are no built-in titles; each
church enters its own.

**`studies`**
| Column | Notes |
|---|---|
| `id` PK, `material_id` → study_materials RESTRICT | |
| `campus_id` → campuses SET NULL | Defaults to the first student's campus; NULL = church-wide |
| `status` TEXT CHECK IN ('active','paused','finished') DEFAULT 'active' | |
| `started_on` TEXT NOT NULL, `finished_on` TEXT NULL | Church dates |
| `rhythm` TEXT DEFAULT '' | Free text, ≤ 120: "Tuesdays, coffee shop" |
| `lesson` INTEGER NULL | Progress "lesson 3 of {material.lessons}" |
| `coordinator_note` TEXT DEFAULT '' | ≤ 280, **coordinator and staff only**, practical only (see §3.6) |
| `request_id` → study_requests SET NULL | The request this study came from |
| `created_by` → users SET NULL, `created_at`, `updated_at` | |

**`study_people`**
| Column | Notes |
|---|---|
| `study_id` → studies CASCADE, `person_id` → people CASCADE | PK both |
| `role` TEXT CHECK IN ('teacher','student') | A study needs at least one of each (checked in code) |
| `added_at`, `removed_at` NULL | Leaving is soft, so "taught" history stays |

A hard-deleted study would cascade its people, so **studies are never hard-deleted in the app** (finish, or
admin-only delete for a study created by mistake with no completions).

**`study_completions`**: what profiles read; outlives the study
| Column | Notes |
|---|---|
| `id` PK, `person_id` → people CASCADE | Like `profile_values`; archiving a person keeps it |
| `material_id` → study_materials RESTRICT | |
| `study_id` → studies SET NULL | NULL for history added by hand or imported |
| `material_title` TEXT, `teacher_names` TEXT | **Snapshots**, so it reads right after renames, or when the teacher isn't in People (imports) |
| `teacher_ids` TEXT JSON DEFAULT '[]' | People ids at completion, for "Studies taught" |
| `completed_on` TEXT NOT NULL | |
| `source` CHECK IN ('teacher','coordinator','profile','import') | |
| `by_user` → users SET NULL, `created_at`, `revoked_at`, `revoked_by` | Soft undo, audited |
| Indexes | `(person_id, completed_on)`, `(material_id)`; UNIQUE `(study_id, person_id)` WHERE `study_id IS NOT NULL AND revoked_at IS NULL` |

"Studies taught" is read from `study_people` (role teacher), plus completions whose `teacher_ids` contain the
person (hand-added history).

**`study_requests`**: the interest queue
| Column | Notes |
|---|---|
| `id` PK, `person_id` → people CASCADE | Always the signed-in person's linked record; never from typed details |
| `campus_id` → campuses SET NULL | From the person |
| `format` CHECK IN ('one_on_one','small_group','either') DEFAULT 'either' | |
| `material_id` → study_materials SET NULL, `topic` TEXT ≤ 200 | Optional preference |
| `times` TEXT ≤ 200 | "Weekday evenings" |
| `status` CHECK IN ('waiting','matched','closed') DEFAULT 'waiting' | |
| `study_id` → studies SET NULL, `handled_by` → users SET NULL, `handled_at`, `created_at` | |

**Users:** `users.studies` INTEGER DEFAULT 0, the coordinator flag (§3.4, owner decision).

**Settings** (key `studies`): `{ label: 'Bible studies' }` and `{ notify_user_ids: [] }`, defaulting to every
coordinator at the campus. No church values in code.

### 3.2 Who can do what (needs Security review and owner approval)

| Action | Who |
|---|---|
| Manage materials (add, edit, retire) | Coordinators; staff and up can read |
| See the Bible studies page, queue, every study, reports | Coordinators and staff, at their campuses (`campusFilter` on `studies.campus_id` / `study_requests.campus_id`); church-wide studies only for accounts with no campus limit, as for groups and forms |
| Create a study, match a request, add people to an existing study, change teachers or students | Coordinators and staff at the campus |
| Update progress, status, rhythm; mark a student complete | Coordinators, staff, and **the study's own teachers** (account linked to a teacher person on it) |
| Add or revoke completion on a profile; CSV import | Coordinators and staff (profile); import: coordinators with no campus limit, or admins with all campuses |
| See their own studies (as teacher or student) and completions | Any signed-in account with a linked person |
| Request a study | Any signed-in account with a linked person; unlinked accounts get the "ask the office to link" message |
| Leaders (role leader), volunteers | **Nothing beyond their own.** People pages show the Bible studies card only to coordinators, staff, and the person |

Students see their teacher's name and their own progress, never other students' contact details. Teachers see
their students' names and photos, plus phone and email only if owner question 7 says yes (default: name only,
because the coordinator makes the introduction).

### 3.3 Routes (`server/routes/studies.js`, one router)

| Route | Guard |
|---|---|
| `GET/POST /studies/materials`, `PATCH /studies/materials/:id` | read: coordinator or staff; write: coordinator. Audited `study.material_*` |
| `GET /studies?campus=&status=&teacher=&material=` | `requireStudies` (coordinator or staff) + campus scope |
| `GET /studies/summary?campus=` | same; counts in §3.5 |
| `POST /studies`, `PATCH /studies/:id`, `PUT /studies/:id/people` | coordinator/staff at the campus; every person passes `canCampus` (people with no campus open, as elsewhere); `study.create/update/people` |
| `POST /studies/:id/progress` `{lesson, status, rhythm}` | coordinator/staff, or a teacher on that study |
| `POST /studies/:id/complete` `{person_ids, completed_on?}` | same; each id must be a current student; `study.complete` (ids, count) |
| `POST /study-completions` (on a profile), `POST /study-completions/:id/revoke` | coordinator/staff, campus of the person; `study.completion_add/revoke` |
| `GET /studies/requests`, `POST /studies/requests/:id/match` `{study_id}` or create-and-match, `.../close` | coordinator/staff, campus |
| `POST /me/study-requests`, `GET /me/studies` | signed in, linked person; 1 open request per person, rate-limited; notifies coordinators ("Someone would like a Bible study"; no name in push text) |
| `PATCH /me/studies/:id` (teacher's progress), `POST /me/studies/:id/complete` | teacher on that study |
| `GET /people/:id/studies` | coordinator/staff (campus), or the person themself |
| `POST /studies/import/preview`, `POST /studies/import` | as §3.2; `study.import` (counts only) |
| `GET /studies/export.csv` | coordinator/staff, campus; `study.export` (count) |

`requireStudies` and `canStudies(user)` live in `server/auth.js` next to `requireAttendance`, so the rule is in
one place. All writes need `x-mb: 1`; parameterised SQL; `today` from the campus time zone and an injected clock.

### 3.4 Granting coordinator access (recommendation; owner decision)

| Option | For | Against |
|---|---|---|
| Lead a "Bible study team" named in settings | No extra step | Team leadership can be changed by leaders and campus staff, and it already grants leader access automatically. Access to private study data would then change as a side effect of roster edits. Ties a non-serving role to serving teams |
| **Per-account flag `users.studies`, like Attendance** | Explicit, audited, follows the existing `attendance` and `app_editor` pattern, works for any role, campus list from the account | An admin must switch it on |

**Recommend the flag.** It is labelled "Bible studies coordinator" in Settings → Accounts and the person's access
dialog. Only an admin grants it. A campus-limited admin may grant it only inside their own campuses, the same as
Attendance. Every change is audited. On a multi-campus church, an account with the flag needs a campus list or
"All campuses"; one coordinator covering both campuses simply gets "All". Staff and admins have the same access
by role, scoped to their campuses. This is a permission change, so the owner decides.

### 3.5 Bible studies page (`#/studies`, coordinator and staff)

- **Tiles:** Active · Paused · Finished this year · **Waiting for a match** (opens the queue).
- **Waiting** tab: requests oldest first with preferences; "Start a study" (prefilled) or "Add to an existing
  study"; "Close" with a reason picked from a short list (not free text).
- **Studies** tab: filter by campus and status; group by **teacher** (default) or material. Rows: students,
  material, lesson x of y, rhythm, started.
- **Teachers** tab: who's teaching, number of active studies each, studies taught all time.
- **Materials** tab: the catalogue (coordinator edits) with **completions per material**, filterable by year.
- Download CSV. Phone first; the UI/UX Specialist designs the layout.

### 3.6 Profiles, member app and privacy

- **Person page:** a Bible studies card (coordinator, staff, the person): Studying now, Studies completed
  (material, date, teacher), Studies taught. "Add a completed study" for past history.
- **Member app:** More → **My Bible studies**. Students see their studies (material, teacher, lesson x of y, per
  owner question 4) and Studies completed. Teachers also get each study they teach with lesson, status and Mark
  finished. **"I'd like to do a Bible study"** form: one-on-one, small group or either; a material from the
  active list or a topic; good times. Confirmation: "Thanks. Someone will be in touch." No list of running studies.
- **Privacy:** no pastoral notes. The only free text is `coordinator_note` (≤ 280, coordinator and staff only),
  with the hint "Practical notes only, like 'prefers mornings'. Keep personal matters out of the hub." Recommendation:
  keep it, because the coordinator needs somewhere for scheduling notes and a hard limit stops it becoming a
  pastoral file. Leaving it out is also fine. Add `studies`, `study_requests` and `study_completions` to the
  **pastoral/spiritual** row of the sensitive-data table. No reminders, no "missed" states.

### 3.7 Past history

1. **On a profile:** "Add a completed study": material (or add a retired material), date, teacher (person
   picker, or a typed name for someone not in People).
2. **CSV** (preview, then import): `person_id` or `email`, `first_name`, `last_name`, `material`, `completed_on`,
   `teacher`. Matching uses People id or an **exact, unique email only**. The preview lists matched, unmatched and
   duplicate rows, and unknown materials (which can be created as retired). It **never creates people and never
   links accounts**. Re-running skips rows already there. Audited.

### 3.8 Multi-church

Every table hangs off `people`, `campuses` or `users`. Materials are data, the label is in `settings`, and the
router takes `db` and `now`. Nothing church-specific is in code. The database-per-church path stays open.

## 4. Migration numbering

A migration's number is **its position in `MIGRATIONS`**, so there are no gaps and no reserved numbers.
milestone-1 ends at **40** (`checkin_events`). Child-safety PRs #130/#131/#136/#137/#138 hold **41–45** on a stack.
Classes (#122) is also written as 40 and must renumber when it merges.

1. Build PR 1 with the migration last in `MIGRATIONS` and a placeholder number in its comment.
2. **Just before merge**, rebase on milestone-1 and take the next number. Update the comment, the count in
   `docs/database.md`, and any test that counts migrations (`test/app-choices-migration.test.js`).
3. **Default: merge after the child-safety stack**, which makes studies 46; Classes takes the next free number in
   January. If the owner wants studies first, it takes 41 and all five child-safety PRs shift by one (DevOps
   re-rehearses).
4. Before merging, list the open PRs touching `server/db.js` and name in the PR any that will need renumbering.
   Never renumber a shipped migration.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Private study data leaking to leaders or other students | One `canStudies` helper; profile card guarded; tests per role; no names in push text |
| The coordinator flag widening access unexpectedly | Admin-granted, campus-limited like Attendance, audited; Security review |
| Teachers editing studies they don't teach | Teacher check is by `study_people` and the account's linked person; tests |
| Losing completion history | Separate table, snapshots, RESTRICT on materials, soft revoke, studies never hard-deleted with completions; merge-duplicates moves `study_people`, `study_completions`, `study_requests` |
| Spam requests | One open request per person, signed in only, rate limit |
| CSV attaching history to the wrong person | Id or exact unique email only; preview; audited; never creates people |
| Date bugs | Injected clock; fixed dates in tests |
| Migration clash | §4 |
| Rollback | Additive; old code ignores the new tables and column |

## 6. Tests (API, `node:test`)

Materials: coordinator writes, staff reads, others 403; retired materials can't start studies. Studies: create and
match (coordinator and staff 201; leader, volunteer and campus-limited staff on another campus 403); church-wide
rule. Teacher updates their own study (200) and another study (403). Completion: current students only; it
survives the study finishing and a student leaving; revoke. Profile card visibility (coordinator, staff, the person
200; leader 403 or no card). `/me/studies` for a student and a teacher; students never see other students' contact
details. Requests: one open per person, unlinked 403, notification without a name, match links the study. Flag
grant: admin only, campus-limited admin inside own campuses, audited. CSV preview and import (matching, unmatched,
rerun, no people created). Merge moves rows. QA adds browser and phone checks.

## 7. Docs to update (same PRs)

`features.md`, `database.md` (tables, `users.studies`, count, sensitive data), `api.md`, `permissions.md` (the
flag and §3.2), `design-system.md` if a new pattern appears, `help-content.js` and `docs/guides/` (Training
Writer), `merge-log.md`. Life groups go to `roadmap.md` (Product Manager). The **release checklist applies**.

---

## Steps

| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 0 | Owner answers the questions below and approves this plan, including the coordinator flag | owner | — | — |
| 1 | File "Life groups (by semester)" on the roadmap; confirm scope and timing against the beta order | `product-manager` | Yes (roadmap docs only) | 0 |
| 2 | How matching and teaching really run; edge cases (teachers without accounts, both campuses) | `church-operations` | Yes | 0 (parallel with 1, 3, 4) |
| 3 | Screens and wording: studies page, request form, My Bible studies, profile card | `ui-ux-specialist` | Yes (proposal) | 0 (parallel) |
| 4 | Threats and controls: the flag, teacher scope, request spam, CSV | `security-specialist` | Yes | 0 (parallel) |
| 5 | **PR 1 Data + access + API:** migration, `users.studies` flag in Settings and the access dialog, `canStudies`, materials, studies, completions, `/people/:id/studies`, merge, tests, docs | `senior-developer` | No | 1–4 |
| 6 | **PR 2 Hub page:** Bible studies page (tiles, studies by teacher and material, teachers, materials), profile card with Add a completed study, CSV export | `senior-developer` (`ui-ux-specialist` for polish) | No | 5 |
| 7 | **PR 3 Requests:** app request form, queue, match and close, coordinator notice | `senior-developer` | No | 5 |
| 8 | **PR 4 Member app:** My Bible studies for students and teachers | `senior-developer` | No | 5 |
| 9 | **PR 5 History import:** CSV preview and import | `senior-developer` | No | 5 |
| 10 | Security re-review of PRs 1, 3 and 5 | `security-specialist` | Yes | 5, 7, 9 |
| 11 | QA: workflows, `npm test`, `npm run test:ui`, phone checks | `qa-engineer` | No (tests) | 6–9 |
| 12 | Accessibility pass on the new screens | `accessibility-specialist` | Yes | 6–8 |
| 13 | Help text and a short coordinator guide | `training-writer` | No (guides) | 6–9 |
| 14 | Final review against this plan and the release checklist | `chief-architect` | Yes (docs) | 10–13 |
| 15 | Migration rehearsal and deploy plan | `devops-engineer` | No (ops docs) | 14 |

Never run two editing agents at once. PRs 2–5 follow PR 1 one at a time, in any order.

## Owner approvals needed

1. **Architecture:** Bible studies as their own small module (five tables and one router), separate from small
   groups and Classes.
2. **Permissions:** a new **Bible studies coordinator** flag (`users.studies`), granted by admins like Attendance,
   and the §3.2 table. This is a sign-in and permissions change.
3. **Privacy:** the optional short coordinator-only note (keep it, or leave it out).
4. **Merge order** for the migration (§4; default after child-safety 41–45).
5. **CSV import** of history.
No new dependencies, services or costs.

## Owner answers (27 Nov 2026)

The owner approved the plan and gave these answers:
1. **Coordinator access:** an admin switches on the "Bible studies coordinator" flag for that person (`users.studies`). More than one coordinator is allowed. There is one today, and that may change.
2. **Teachers** need no separate approval step. The coordinator can pick anyone.
3. **Material:** usually picked by the teacher. The teacher (on their own study) or a coordinator sets it, and the person asking can suggest one in their request.
4. **Progress:** shown to students in the app when a study has a planned number of lessons. Many studies have no end date and no set number of lessons; those show "Active since <month>", or a session count if the teacher records one. Neither field is required.
5. **Teachers without accounts** are allowed, but everyone should ideally have one, especially teachers. When a study is set up for a teacher with no account, prompt the coordinator to invite them.
6. **Campuses:** studies belong to the whole church (campus is optional and only used for reporting). One coordinator currently covers both campuses.
7. **Contact details:** a teacher sees a student's phone and email only if the student agrees, by ticking "share my contact details with my teacher" in the request or when added. Otherwise the coordinator makes the introduction.
8. **New requests:** every coordinator is notified.
9. **A short coordinator-only note** on each study is kept, capped at 280 characters.
10. **Finishing:** a teacher can mark a student finished, and a coordinator can undo it (soft revoke, audited).
11. **Name:** "Bible studies".

**Migration number:** Bible studies will probably ship before the child-safety pilot, so it takes the next free number on `milestone-1` (41). The held child-safety stack (#130–#140) renumbers at merge, following the rule that the unshipped one renumbers.

## Questions for the owner (plain language)

1. **Who is the coordinator?** Shall an admin switch on "Bible studies coordinator" for that person (recommended),
   or should it follow whoever leads the Bible study team? Can there be more than one?
2. **Do teachers need approving** before they can teach, or can the coordinator pick anyone?
3. When someone asks for a study, **do they pick the material**, or does the coordinator choose it with them?
4. Should **students see their progress** ("lesson 3 of 8") in the app, or just that they're in a study?
5. Is it OK for **teachers to have no Hub account**, with the coordinator updating their studies for them?
6. **Campuses:** will one coordinator cover both campuses? Should studies belong to a campus at all, or be
   church-wide?
7. Should teachers see their students' **phone and email** in the app, or does the coordinator make the
   introduction?
8. Who should **hear about a new request**: every coordinator, or one named person?
9. Do you want the short **coordinator-only note** on a study ("prefers mornings"), or no notes at all?
10. Can a teacher **mark a student finished** themselves, or should the coordinator confirm it?
11. Is **"Bible studies"** the right name in the menu and the app?
