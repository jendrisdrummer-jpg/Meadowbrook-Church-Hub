# Plan: classes and leader training (roadmap L2)

Chief Architect · 27 November 2026 · **Status: draft for the owner's approval. Nothing is built.**
Backlog item L2 in [roadmap.md](../../roadmap.md). Inputs: the owner's ask ("watch-to-the-end sessions, quizzes,
in-person sessions, completion on profiles") and the Church Operations findings summarised in the brief.
Related: C3 (clearance-gated scheduling) in [roadmap.md](../../roadmap.md) is the later "hard" version of the
scheduling link here; this plan only warns.

## In plain words (for the owner)

1. Staff build a **class** as a short list of steps: watch a video, answer a quiz, read and accept a policy, or come
   to an in-person session.
2. People join by a link, or a leader adds them (one by one or "everyone on the Kids team").
3. In the member app, **My classes** shows what's left and picks up a video where they stopped.
4. A video counts as done when they've watched about 90% of it. If the player can't tell us, they get a
   "Finished" button, and the record says it was their word.
5. Quizzes need 80% to pass, with unlimited tries and no "failed" screen, just "not quite, try again".
6. Leaders tick off in-person attendance for a whole group at once; staff can mark someone complete with a note.
7. A class can be "valid for 12 months"; people and leaders see "expires in 30 days" and "expired".
8. A person's page shows their classes. Pastoral classes (baptism, membership) can be staff-only.
9. A team can name a **required class**. Scheduling then warns ("needs Kids Safety (expired)") and autofill skips
   them, but nobody is ever blocked: a scheduler can still pick them and gives a reason.
10. No new services, no new costs, no new software libraries. Four small releases; you'll answer six questions first.

---

## 1. Goals and scope

**V1 goals**
- Classes with ordered steps of four kinds: `video`, `quiz`, `acknowledge` (read a policy, tick "I have read
  this"), `session` (in-person, optionally linked to an event for date, sign-up and capacity).
- Enrol by link, by a leader, or "everyone on team X" (a one-time add, not a rule).
- Member app: My classes, step player with resume, quiz, policy acknowledgement.
- Hub: classes list, builder, roster (enrolled / in progress / complete / expiring / expired), campus filter,
  "who still needs it" with Remind, CSV.
- Completion history on the person's profile, with a staff-only option per class.
- Optional expiry ("valid for N months").
- Optional required class on a team: a scheduling warning, autofill skip, confirm-with-reason override.
- A kids-safety pilot class, delivered as **setup instructions** in `docs/features.md` (not seeded data).

**Out of scope (V2 or later):** anti-skip enforcement, certificates, question banks or random questions,
waitlists, auto-enrol rules, hard blocks on scheduling or check-in, background checks (C3, a paid vendor),
cohort chat, per-position requirements and grace periods, child learner accounts, dashboards, syncing into
the existing "Classes completed" profile field.

## 2. What already exists (reuse, don't rebuild)

| Need | Reuse | Where |
|---|---|---|
| Video playback, YouTube and Mux, with trims | `mountPlayer()` already exposes `time()` and an end callback; Mux uses our own `<video>` element (`timeupdate`, `ended`, `duration`); YouTube uses the IFrame API (`getCurrentTime`, `getDuration`, `onStateChange` ENDED). **Progress is available with no new dependency.** Only when YouTube's script fails to load does it fall back to a bare iframe (`time()` returns null): that's the honour-system case | `public/js/video.js`, `public/js/member/watch.js` |
| Video hosting | The media library (YouTube links, Mux uploads, `status` published/hidden) | `server/routes/media.js`, `media` table |
| Profile display and staff-only visibility | `profile_fields.visibility` leader/staff pattern; Spiritual journey section | `server/routes/fields.js`, `public/js/pages/person.js` |
| In-person session date, sign-up, capacity | Events with sign-ups (`event_signups`). **Events have no attendance today** (roll call is for services only), so session attendance is marked on the class roster, not on the event | `server/routes/events.js` |
| Remind with a 12-hour limit | "Remind people" (#58): `assignments.nudged_at`, skip if nudged or auto-reminded in 12 h | `server/routes/services.js` ~571 |
| Scheduling warning with override | `campusEligibility()` + `allow_other_campus` 409-then-confirm | `server/eligibility.js`, `server/routes/services.js` ~357–426 |
| Team-leader scope | `ledTeamIds`, `seesTeamDetail` | `server/team-scope.js` |
| Campus scoping, roles | `requireRole`, `canCampus`, `campusFilter`; forms' "manages" rule for church-wide items | `server/auth.js`, `server/routes/forms.js` |
| Inbox and push | `notify(db, userIds, msg)` | `server/notify.js` |
| Audit, dates | `audit()`, `localNow(tz, at)` | `server/http.js` |
| CSV | `toCsv()` (already neutralises formula injection) | `server/csv.js` |
| Merge duplicates | Must move class records to the kept person | `server/routes/people.js` `/people/:id/merge` |

The existing "Classes completed" multi-choice profile field stays as it is (historic and imported data). V1 shows
the new Classes card next to it and does not write into it.

## 3. Design

### 3.1 Data model (one migration, "next available at build time")

Migrations 38 (`users.app_editor`) and possibly 39 (staff Home) are in flight on other branches. The classes
migration takes **whatever number is next when PR 1 is rebased**, appended at the end of `MIGRATIONS`, purely
additive. If it collides at merge time, renumber the unshipped one, never a shipped one.

**`classes`**
| Column | Notes |
|---|---|
| `id` INTEGER PK | |
| `title` TEXT NOT NULL, `description` TEXT DEFAULT '' | |
| `campus_id` → campuses ON DELETE SET NULL | NULL = church-wide (same as events, groups, forms) |
| `visibility` TEXT DEFAULT 'leader' | `leader` or `staff` (pastoral classes; mirrors `profile_fields.visibility`) |
| `join_key` TEXT UNIQUE | random, for the join link; can be reset (old link stops) |
| `join_open` INTEGER DEFAULT 1 | link on/off |
| `valid_months` INTEGER NULL | NULL = never expires |
| `archived` INTEGER DEFAULT 0 | classes are archived, never deleted once anyone has enrolled |
| `created_by` → users SET NULL, `created_at`, `updated_at` | |

**`class_steps`**
| Column | Notes |
|---|---|
| `id`, `class_id` → classes ON DELETE CASCADE | cascade only reachable for a class nobody ever joined |
| `sort` INTEGER, `kind` TEXT | `video` / `quiz` / `acknowledge` / `session` |
| `title` TEXT, `body` TEXT | instructions or the policy text |
| `media_id` → media ON DELETE SET NULL | video steps; a deleted video leaves the step "video missing" for staff to fix |
| `questions` TEXT JSON | quiz: `[{id, text, choices[], correct:[i]}]`; `correct` is **never** sent to members |
| `event_id` → events ON DELETE SET NULL | session steps, optional |
| `archived` INTEGER DEFAULT 0 | removing a step that has progress archives it (history stays) |

**`class_enrolments`** (current cycle per person)
| Column | Notes |
|---|---|
| `id`, `class_id` → classes ON DELETE **RESTRICT** | |
| `person_id` → people ON DELETE CASCADE | a hard-deleted person takes their training with them, like `profile_values`; archiving people (the norm) keeps everything |
| `source` TEXT | `link` / `leader` / `team` |
| `enrolled_by` → users SET NULL, `enrolled_at`, `last_activity_at`, `reminded_at` | `reminded_at` drives the 12-hour Remind limit |
| `removed_at` TEXT NULL | un-enrol is soft |
| UNIQUE (`class_id`, `person_id`) | index `class_enrolments_person (person_id)` |

**`class_progress`** (one row per enrolment and step)
| Column | Notes |
|---|---|
| `enrolment_id` → class_enrolments CASCADE, `step_id` → class_steps RESTRICT | PK (enrolment_id, step_id) |
| `state` TEXT | `started` / `done` |
| `method` TEXT | `watched`, `honour` (Finished button), `passed`, `acknowledged`, `attended`, `manual` |
| `position_sec`, `max_sec`, `duration_sec` INTEGER | resume point and furthest point reached |
| `score` INTEGER, `attempts` INTEGER | **best score and count only; answers are not stored** |
| `done_at`, `marked_by` → users SET NULL, `note` TEXT | |

**`class_completions`** (append-only history; this is what profiles and scheduling read)
| Column | Notes |
|---|---|
| `id`, `class_id` → classes **RESTRICT**, `person_id` → people CASCADE | |
| `completed_at` TEXT (date), `expires_at` TEXT NULL | `expires_at` is fixed at completion from `valid_months`; changing the class later doesn't rewrite history |
| `method` TEXT | `steps` or `manual` |
| `by_user` → users SET NULL, `note` TEXT, `revoked_at`, `revoked_by` | revoking is soft and audited |
| index (`person_id`, `class_id`, `completed_at`) | |

Renewal: when a completion is within the warning window or expired, the person's progress rows are cleared for a
new cycle (enrolment kept); old `class_completions` rows stay. Clearing progress deletes only the current cycle's
step state, never completions.

**`teams.required_class_id`** → classes ON DELETE SET NULL (ADD COLUMN, NULL default).

**Settings** (`settings` key `classes`, per church): `{ pass_pct: 80, watch_pct: 90, expiry_warn_days: 30 }`.
No church values in code; defaults live in one place in `server/classes.js`.

### 3.2 "Today" and expiry (testable)

- Pure helper in `server/classes.js`: `classStatus({ enrolment, progress, completion }, today)` →
  `not_started | in_progress | complete | expiring | expired`. Unit-tested with fixed dates.
- The server computes `today` with `localNow(campus tz, now())`, where `now` is a clock passed into the router:
  `createApp({ db, uploadDir, now = () => new Date() })` → `classesRoutes(db, { now })`, and the reminder job
  takes `(db, now)`. Tests pass a fixed clock. **Never** accept "today" from the client.
- Tests build dates from the injected clock, so they pass on any day.

### 3.3 Who can do what (recommendation: no new permission flag in V1)

| Action | Who |
|---|---|
| Create, edit, archive classes; steps; required class on a team | **Staff and admins** at the class's campus; church-wide classes only staff with no campus limit (the forms rule) |
| See a class roster, CSV, Remind, mark sessions, bulk enrol | Staff as above. **Team leaders** (role leader, incl. automatic) for `leader`-visibility classes that a team they lead requires, limited to people on the teams they lead; they see pass / not yet, never scores |
| Manual "mark complete" with note, revoke | Staff only (audited) |
| Enrol themselves by link, do steps, see own scores | The signed-in person (account linked to a person) |
| `staff`-visibility (pastoral) classes | Staff only, everywhere: roster, profile, scheduling reason text ("needs a class" without the title for non-staff) |

A per-account "class editor" flag was considered and **not recommended for V1**: it changes permissions (owner
approval, security review) for a need staff already cover. Revisit if ministry leads who aren't staff build classes.

### 3.4 API (`server/routes/classes.js`, one router; all writes need `x-mb: 1`)

Hub:
| Route | Guard and scoping |
|---|---|
| `GET /classes` | leader+; staff see classes they manage; leaders see classes their led teams require |
| `POST /classes`, `PATCH /classes/:id`, `POST /classes/:id/archive`, `POST /classes/:id/join-key` | staff + manages(campus); audited `class.create/update/archive/key_reset` |
| `PUT /classes/:id/steps` | staff + manages; whole ordered list; steps with progress are archived, not deleted; `class.steps` |
| `GET /classes/:id/roster?campus=&status=`, `GET /classes/:id/roster.csv` | staff (manages) or leader (scope above); `campusFilter` on `people.campus_id`; CSV audited `class.export` |
| `POST /classes/:id/enrol` `{person_ids}` or `{team_id}` | staff; or leader for people on teams they lead (`seesTeamDetail`); every person passes `canCampus`; `class.enrol` |
| `DELETE /classes/:id/enrolments/:personId` | same as enrol; soft (`removed_at`); completions untouched |
| `POST /classes/:id/steps/:stepId/attendance` `{person_ids, present}` | staff, or leader in scope; session steps only; unmarking always allowed (roll-call rule); `class.attendance` |
| `POST /classes/:id/complete` `{person_id, note}` (note required), `POST /classes/completions/:id/revoke` | staff; `class.complete_manual`, `class.revoke` |
| `POST /classes/:id/remind` `{person_ids?}` | roster access; skips anyone reminded in 12 h; reply `{sent, skipped}` |
| `GET /classes/people/:personId` | the person's page: staff see all (campus); leaders see leader-visibility classes for people on teams they lead; scores staff-only |
| `PATCH /teams/:id` gains `required_class_id` | existing team guard, plus staff-only for this field; `team.required_class` |

Member (signed in with a linked person; otherwise the existing "ask the office to link" message):
| Route | Notes |
|---|---|
| `GET /me/classes`, `GET /me/classes/:id` | own enrolments, steps, own progress and scores; quiz questions without `correct` |
| `POST /classes/join/:key` | join link; rate-limited; 404 for a closed or reset key |
| `POST /me/classes/:id/steps/:stepId/progress` `{position, duration}` | heartbeat every ~15 s and on pause; `max_sec` only moves forward; done at `watch_pct`; plausibility cap (max may not advance more than ~2× wall time since the last beat); no audit (too chatty) |
| `POST /me/classes/:id/steps/:stepId/finished` | honour system, **only when the client reports the player can't track** (`method: 'honour'`, labelled in roster and profile) |
| `POST /me/classes/:id/steps/:stepId/quiz` `{answers}` | graded on the server; returns `{score, passed, review: [question ids to revisit]}`; correct answers not revealed; answers discarded |
| `POST /me/classes/:id/steps/:stepId/acknowledge` | stores `acknowledged` with time; the policy text version is the step's `updated_at` |

When the last step is done the server writes `class_completions` in the same transaction (`tx`) and notifies the
person ("You've finished Kids Safety").

### 3.5 Scheduling link

- `server/eligibility.js`: `classEligibility(db, personId, teamId, today)` → `{ ok, reason }`, e.g.
  `Needs Kids Safety (expired)` / `(not started)` / `(expires 12 Jan)` (expiring still counts as ok, with a note).
- `services.js` candidates add `class_ok` and `class_reason`; sort after campus eligibility; autofill skips
  `!class_ok`; `POST /services/:id/assignments` returns 409 for a missing class unless the body has
  `allow_missing_class: true` and a `reason` (required, ≤ 200 chars); audited `assignment.class_override`.
  Any scheduler may override (unlike `allow_other_campus`); this is a warning, not a gate.
- The volunteer never sees a block: accept/decline, My schedule and check-in are unchanged.
- Cost: one indexed lookup per candidate; precompute per request (one query per team) to avoid N+1.

### 3.6 UI (design system, phone first)

- **Hub → Classes** (new page `public/js/pages/classes.js`, route in `ROUTES`): list with campus filter and counts;
  builder (title, campus, visibility, valid for, steps reorder; video picker from the library; quiz editor; policy
  text; session with optional event); roster tabs (Needs it / In progress / Complete / Expiring / Expired), bulk
  select → Mark attended / Remind / Remove, CSV, copy join link.
- **Media**: "Add as training video (hidden from Watch)" so training videos never show on Watch or the podcast.
  `POST /media` currently re-publishes an existing video; the developer must make the hidden path not do that.
- **Teams**: "Required class" picker on the team settings (staff).
- **Scheduling**: candidate line shows the reason in the warning style; picking them opens a confirm with a short
  reason box (same dialog shape as the other-campus warning).
- **Person page**: a Classes card (status, date, expiry, `honour`/`manual` labels; staff see score and note).
- **Member app**: More → My classes (and the join link `#/classes/join/<key>`); class page with a step list and
  ticks; video step with resume and a progress bar; quiz one question per screen, "Not quite. Have another look at
  these and try again."; policy step with "I've read this". UI/UX specialist checks wording and phone layout.

### 3.7 Notifications and reminders

- Leader **Remind** (manual, 12-hour limit per person, `reminded_at`).
- Completion notice to the person.
- Daily job (in the 15-minute loop, run once a day after 8 a.m. church time, idempotent): one notice to the person
  when a completion enters the `expiry_warn_days` window, and one at expiry; tracked with a column
  `expiry_notice_at` on `class_completions` (in the same migration) so it never repeats.
- No email-only channel: `notify()` handles inbox and push as today.

### 3.8 Privacy rules

- Completion: the person, staff (campus-scoped), leaders only for people on teams they lead and only for
  leader-visibility classes. Pastoral classes: staff only.
- Scores and quiz attempts: the person and staff. Leaders see pass / not yet.
- Quiz answers are not kept. Acknowledgements keep the time only.
- Training videos are **unlisted, not private**: a Mux playback id or an unlisted YouTube link can be shared. Fine
  for training; never use it for pastoral or confidential content. Say so in the builder.
- Add `class_completions`, `class_progress.score` and `note` to the sensitive-data table in `database.md`.

### 3.9 Multi-church

All tables hang off `people`, `teams`, `campuses`, `users`; configuration is in `settings`; the reminder job takes
`db` and `now`; join keys are per database. Nothing here closes the database-per-church path.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Losing training history (a safety record) | RESTRICT on class → completions/enrolments; archive instead of delete; soft revoke and un-enrol; merge moves rows |
| Leaders seeing pastoral data | `visibility` checked in one helper used by roster, profile and scheduling; tests for each surface |
| Wrong expiry from time zones or test dates | injected clock, campus `localNow`, pure `classStatus` unit tests |
| Progress spoofing | it's an honour-based church tool; light plausibility cap only; real anti-skip is V2 |
| Training videos leaking onto Watch/podcast | hidden status path, tested against `/watch` and the feed |
| Migration number clash (38/39 in flight) | number at rebase time; DevOps rehearses on made-up data |
| Scheduling slowdown | per-request precompute, indexed lookups |
| Scope creep into C3 hard blocks | warn only; any block is a separate owner decision |
| Rollback | additive migration; old code ignores the new tables and column, so a code rollback is safe |

## 5. Tests (API, `node:test`; QA adds browser/phone checks)

- Class CRUD: volunteer and leader 403; campus-limited staff 403 on another campus and on church-wide classes.
- Enrol: link join (open, closed, reset key), leader enrolling outside their led teams 403, outside campus 403,
  team bulk add.
- Video: progress only moves forward; done at 90%; plausibility cap; honour `finished` labelled.
- Quiz: 79% not passed, 80% passed, unlimited attempts, `correct` never in member responses, answers not stored.
- Session attendance: bulk mark, unmark, leader scope, campus check on every id.
- Completion: auto on last step (transaction), manual needs a note, revoke; audit rows written.
- Expiry with a fixed clock: complete → expiring (30 days before) → expired; renewal starts a new cycle and keeps
  old completions; reminder job sends once per window.
- Privacy: leader can't see staff-only classes on roster, profile or scheduling text; leader never gets scores.
- Scheduling: candidate reason, autofill skips, 409 then override with reason (audited), volunteer accept unaffected.
- Remind: 12-hour skip. CSV: formula-safe. Merge: rows move to the kept person. Archiving a person keeps history.
- Hidden training video absent from `/watch` and the podcast feed.

## 6. Docs to update (per `docs/development.md`)

`database.md` (tables, sensitive data, migration count), `api.md` (routes), `permissions.md` (classes section and
the scheduling override), `features.md` (Classes rows; kids-safety pilot setup instructions; Media hidden path),
`architecture.md` (new job, injected clock), `testing.md` (workflow row), `roadmap.md` via the Product Manager.
**Release checklist applies** (new area, migration, sensitive data).

## 7. PR breakdown

1. **Data and member flow**: migration, `server/classes.js` (status, settings, clock), member routes, class CRUD
   and steps API (no hub UI yet beyond what tests need), merge handling, hidden media path. Tests.
2. **Hub builder and member app UI**: Classes page and builder, My classes, step player, quiz, policy.
3. **Rosters and profile**: roster, enrol, attendance, manual complete/revoke, Remind, CSV, person Classes card,
   expiry job.
4. **Scheduling warning**: required class on teams, candidates, autofill, override; kids-safety setup instructions.

## Steps

| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 1 | Brief check: scope matches L2, stage and timing (not during the kids' check-in pilot freeze) | product-manager | yes | – |
| 2 | Sunday check of the roster, Remind and scheduling-warning wording | church-operations | yes | – (parallel with 1, 3, 4) |
| 3 | Screens: builder, roster, My classes, player, quiz, warning dialog | ui-ux-specialist | yes (proposal) | owner approval |
| 4 | Threats and controls: visibility, leader scope, join links, progress endpoint, CSV | security-specialist | yes | owner approval |
| 5 | PR 1 data and member API | senior-developer | no | 3, 4 |
| 6 | Migration rehearsal on made-up data (number at rebase) | devops-engineer | yes | 5 |
| 7 | PR 2 hub and member UI | senior-developer (ui-ux-specialist may implement approved UI) | no | 5 |
| 8 | PR 3 rosters, profile, expiry job | senior-developer | no | 7 |
| 9 | PR 4 scheduling warning and pilot instructions | senior-developer | no | 8 |
| 10 | Each PR: workflows, `npm test`, `npm run test:ui`, phone checks | qa-engineer | tests only | each PR |
| 11 | Final review against this plan and the release checklist | chief-architect | docs only | 10 |
| 12 | Deploy plan, backup, rollback note | devops-engineer | ops docs | 11 |

Never run two file-editing agents at once. Steps 1–4 only read and may run in parallel.

## Owner decisions (answered 27 Nov 2026)

1. **First class: Life Group Training.** An **in-person class over 6 weeks**. Someone who misses a week is given
   **that week's recording plus a test** for it. This changes the design (see "Changes from the answers" below).
   Still open, for the Life Group leader: whether someone who can't come to *any* week takes a test after each
   recording or one at the end. The design supports both, as a setting on the class, so no code waits on it.
2. **Videos on Mux.** The long-term goal is Mux built in everywhere, with no YouTube player in the hub. Training
   videos use the existing Mux upload (`mux.js`, `js/mux-upload.js`) and are kept off Watch and the podcast.
   Cost for this church's size is small (see the session notes): storage is roughly $0.0024 per minute per month
   at 720p (about $1 a month for six 1-hour recordings), the basic encoding tier is free, and the first 100,000
   minutes watched each month are free. Confirm against mux.com/pricing before relying on these figures.
3. **Staff create and manage classes; team leaders see and remind their own team's people.** Confirmed.
4. **Required classes are optional per team, and only warn.** It probably won't be used for First Steps, but
   it fits team training such as the livestream team: camera training videos plus a test before hands-on training.
5. **Who sees completion.** The person, and **whoever assigned them** the class. Each class also gets **class
   managers** (named accounts, for example the Life Group leader), who see everyone enrolled and their status.
   Staff see all classes. Scores stay with the person, staff and that class's managers; team leaders see "done /
   not yet". Pastoral classes can still be staff-only.
6. **Renewal: owner left it to us.** Each class has an optional "valid for N months", **off by default**. Life
   Group Training doesn't expire. Kids Safety, when built, would use 12 months.

### Changes from the answers

- **Cohort sessions with make-up.** A `session` step gains a date (from its linked event or set directly) and an
  optional **make-up**: a Mux video plus a quiz. If a leader marks someone absent, or the session date passes
  without them being marked present, that person's step shows "Watch the recording and take the test" in My
  classes. Doing the make-up completes the step with method `makeup`. New column on `class_steps`:
  `makeup_media_id` → media SET NULL and `makeup_questions` JSON; `class_progress.method` adds `makeup` and
  `absent`.
- **Remote-only setting.** A class setting `remote_quiz`: `each` (a test after each recording) or `final` (one test
  at the end, from a final quiz step that's only required of people who missed every session). Default `each`.
- **Class managers.** New table `class_managers (class_id → classes CASCADE, user_id → users CASCADE, PK both)`.
  Managers can see the roster, mark attendance, enrol people and send reminders for that class, at any role.
  Only staff add or remove managers. Audited.
- **Assigner visibility.** `class_enrolments.enrolled_by` already records who assigned someone; that account can
  see that person's progress in that class (pass / not yet and, for managers and staff, scores).
- **PR order.** PR 1 builds classes with session, video and quiz steps, make-ups and class managers, so Life Group
  Training can run first. The required-class scheduling warning moves to the last PR.

## Original questions (answered above)

1. Which class should we build first: Kids Safety, or another (membership, life-group leaders)?
2. Where are training videos kept: uploaded to our own video service (Mux, which may add a little to its usage bill), or unlisted on YouTube (free)?
3. Is it fine that only staff create and manage classes, with team leaders seeing and reminding only their own team's people?
4. When someone hasn't done a team's required class, should scheduling just warn (recommended) rather than block?
5. Who sees that someone finished a class: the person, staff, and their team leaders (scores staff-only), with baptism and membership kept to staff only?
6. How long should Kids Safety stay valid before it must be renewed: 12 months?

**Approvals this plan asks for:** the plan itself (a new area); the permission rules in §3.3 (they change who sees
what); no new dependency, service or cost is needed.
