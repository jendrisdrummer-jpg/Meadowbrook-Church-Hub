# QA review of the child-safety plan (planning review, nothing implemented, no repo file changed)

Reviewer: qa-engineer. Baseline observed: `npm test` 42/42 pass (in-memory DB). `npm run test:ui` not run (planning only).
Read: plan draft, role file, public/js/checkin.js, checkin-rules.js, public/sw.js, server/routes/checkin.js, stations.js, people.js (pickups), db.js (migration loop), test/api.test.js (check-in + stations), rules.test.js, sw.test.js, scripts/ui-smoke.mjs, docs/testing.md.

Legend. Type: API = node:test in test/api.test.js; RULES = pure unit in test/rules.test.js; SW = sw.test.js; BR = Playwright browser; MAN = manual on real device. Priority: M must, S should, C could.
Each case: ID | name | type | pri, then Setup / Steps / Expect.
"New" = not in the plan's section 7 list.

## 0. Findings about the current code that change what must be tested (verified by reading)

1. Server day logic: `POST /checkin/checkins` derives `day` from the record's `checked_in_at` (tablet clock), but `POST /checkin/checkout` by `security_code` uses the server's *today*. So an offline check-in at 23:50 replayed at 00:10, or a tablet with a skewed clock, produces a row whose code can never be found by the code path. Plan bounds `client_at` for check-out only; check-in `checked_in_at` is unbounded (a clock set to 2030 creates rows for a future day).
2. `INSERT OR IGNORE` on id means a re-sent record with a *different* code/room is silently dropped and the response returns the stored row. The tablet's local today-list then shows a code that differs from the server's (sync() merges saved rows by id; need to verify it overwrites the code). New pickup/placeholder logic must keep this.
3. `checkout` by `ids` does no ownership check: nonexistent ids and other-campus ids silently count 0, other-family ids release. Response `{checked_out: n}` is the only signal; old tablets treat 200 as success and mark local rows checked out even if n was 0 or fewer than sent (a partial 409 would leave the old tablet showing "checked out" locally while the child is still open on the server: see 7.x).
4. Old tablet `showMatch` sends ALL ids of the code and `flushCheckouts` retries forever on error and never clears the outbox on 4xx: one 409 from a restriction blocks every later offline check-out in that tablet's outbox (poison message). Same for `sync()` queue if a record is ever rejected with 4xx.
5. Rows of kind `adult`/`volunteer` also carry a security code and are matched by the code path today; the plan's pickup/ambiguity logic must say whether non-kid rows are included.
6. `sync()` sends 200 per batch, server accepts 500: the plan's `pickups[]` plus records must still honour batch limits and the "pickup arrives in a later batch than its records" case.
7. `sw.test.js` runs the SW with `caches: {}` and only exercises push/notification; the `fetch` handler and `install` (addAll) are untested. Plan 7.3 ("non-check-in requests untouched", "new files listed") needs a fake `caches`/`fetch` harness, and `addAll` fails the whole install if ONE listed file 404s (a new file listed but not shipped = SW never installs = no offline app).
8. Migrations run in a loop `for v = user_version..` executing one `db.exec` per migration; need to confirm atomicity (BEGIN/COMMIT around exec + user_version) so a failed migration 31 does not leave half-applied tables with user_version unchanged (re-run would then fail on "table already exists"). Plan says "idempotent re-run" only implicitly.
9. `ALTER TABLE ... ADD COLUMN ... REFERENCES` with a non-NULL default is rejected by SQLite when foreign_keys=ON; plan uses NULL/constant defaults but `released_to TEXT NOT NULL DEFAULT ''` etc. are fine. Test must run migrations with `PRAGMA foreign_keys=ON` as production does.
10. `stationAuth` maps a station to `{id: null, role:'leader'}`; any new `requireCheckin` guard and any `user_id` FK column must handle `req.user.id === null` (events/overrides requested by a station must not insert 0 or crash).
11. `stationMay` allows everything under `/checkin/` including the future `/checkin/history`, `/checkin/live`, `/checkin/overrides/:id` PATCH: default-allow prefix match. The plan lists forbidden routes by description; the safe design is an allow-list of exact method+path. Test must sweep every `/checkin/*` route with a station token.
12. Rate limit helper in stations.js is in-memory `Map`, cleared wholesale at 5000 entries and lost on restart; a device-keyed check-out limit shared with sync traffic could lock a station at 8:55 on Sunday (see 1.x/10.x tests).

## 1. Pickup codes

P1.01 | Online unique per device (prefix + issued list) | RULES | M
 Setup: `pickupCode(prefix, taken, random)` with seeded random. Steps: draw 10,000 codes with `taken` growing. Expect: never in `taken`, always `^P[alphabet]{4}$`, never contains the excluded confusables.
P1.02 | Within-device exhaustion of the 531,441 space | RULES | C
 Setup: `taken` pre-filled with all but 3 codes. Expect: still terminates and returns one of the 3; with all taken throws/returns a defined error (not an infinite loop). Also test that `random` returning exactly 0 or 0.999999 gives valid indexes.
P1.03 | Two stations, different prefixes, can never collide (property) | RULES | M
 Steps: 2..27 simulated devices each 5,000 draws with identical seeds. Expect: zero duplicates across devices.
P1.04 | Two stations SAME prefix (cloned storage / cleared storage / unpaired then re-paired) | BR | M (New)
 Setup: two contexts forced to share lease; both offline; check in 40 families each; go online. Expect: some collisions occur, server flags `conflict=1` on exactly the colliding pairs, no child dropped, nothing re-coded, coordinator notified once per conflict (not once per sync retry).
P1.05 | Multiple stations at ONE campus offline (the headline case) | BR | M
 Setup: 3 paired stations, campus 1, all offline via `context.setOffline(true)`. Steps: 20 families each, interleaved; reconnect in random order. Expect: 60 distinct codes, 0 conflicts, all rows present once, active list on every station converges within one refresh.
P1.06 | Station boots offline with no lease ever fetched | BR | M (New)
 Setup: fresh paired station that has the roster but never called `/lease` (upgrade day, old roster cached). Expect: defined behaviour: either refuses to check in with a clear message, or falls back to legacy 4-char code AND marks it so server treats it as legacy. It must never invent an unleased 5-char code. Test both the first run after upgrade and after localStorage clear.
P1.07 | Lease endpoint: first device, second device, idempotent, 28th device | API | M
 Expect: distinct prefixes, same device_key returns same prefix, 28th gets clear error (and tablet shows it, does not silently use random). Race: two parallel `POST /lease` for same campus return different prefixes (PK on (campus_id,prefix) must not 500).
P1.08 | Lease for signed-in (unpaired) leader tablet keyed by `device_key` | API | S
 Edge: user clears browser data -> new device_key -> new prefix each time; 27 clears exhaust the campus. Test that unused leases of today are not reclaimed and that exhaustion by one noisy user is bounded (rate limit on lease).
P1.09 | Station removed in hub then re-paired same iPad | API | M
 Expect: old prefix not reissued same day (plan), but offline records from the removed device that arrive later (after removal, 401 `station_removed`) are NOT lost: tablet keeps queue (old code forgetPairing keeps `mb.checkin.queue`; new purge-on-unpair in plan 3.11 would DELETE un-synced queue). Test that unpair with unsynced queue warns/refuses or preserves queue until synced. (New, important: data loss of child check-ins.)
P1.10 | Prefix rollover/reclaim after 30 idle days | API | S
 Setup: set `last_used` 31 days ago via direct DB; lease again. Expect: reclaimed only when no open pickups that day with that prefix; code reuse across reclaim yields no cross-day clash (day-scoped).
P1.11 | Code reuse across days | API | M
 Setup: same code `PK7Q3M` used on day D (checked out) and day D+1 at same campus. Expect: no conflict, check-out on D+1 releases only D+1 rows. Same for the same code open at campus 1 and campus 2 same day: not a conflict, and campus 2 station cannot release campus 1 row by code or by ids.
P1.12 | Conflict check ignores closed pickups and voided rows | API | M (New)
 Setup: pickup A code X checked out; later pickup B code X same day. Expect: no conflict flag (A not open). Voided A: same. Conflict only when both open.
P1.13 | Conflict across services (9:00 and 11:00) same day, same code | API | M
 Expect: consistent with plan "campus+day+code": flagged if both still open. If the first service's family left, not flagged.
P1.14 | Conflict sync: three-way and repeated | API | S
 Three pickups same code -> all three flagged, one event each, `GET /checkin/pickup` returns three families. Re-sending the same batch 3 times does not duplicate events or notifications.
P1.15 | Legacy 4-char code on deploy day (open rows before deploy, still open after) | API | M
 Setup: seed 3 checkins with 4-char code and `pickup_id NULL` today; run new code. Expect: `{security_code:'K7XM'}` works as today; mixed day with new 5-char rows: a 4-char input only searches legacy rows, 5-char only pickups; a 5-char code whose last 4 equal a legacy 4-char code does not match it (prefix alignment test: new code `PK7XM` vs legacy `K7XM`).
P1.16 | Old tablet (still on 4-char generator) keeps uploading legacy rows after flag on | API | M
 Expect: accepted as legacy, no pickup session, no conflict flagged against 5-char rows, ambiguity guard works if two old tablets collide (existing real-world 8% case).
P1.17 | Code normalisation: lowercase, spaces, hyphen, `K-7Q3M`, `K 7Q3M`, leading/trailing whitespace, full-width/unicode lookalikes, pasted newline | RULES + API | M (New)
 Expect: one canonical form on both tablet and server (`str(code, 8)` truncation today would cut a 5+hyphen paste wrongly; verify max length is raised and canonicalised BEFORE truncation). Empty string, null, number, array body must 400 not 500.
P1.18 | Ambiguous characters typed by volunteer | RULES + BR | M (New)
 Typing `0`,`O`,`1`,`I`,`L`,`5`,`S`,`2`,`Z`,`B`/`8` : alphabet excludes them, so tablet should either map O->0? or say "no such code" with a hint. Decide and test: no silent mapping that could hit another family. Test near-miss: one-character typo that happens to be another open code -> shows that family's children by name; volunteer must confirm child name vs label (BR: confirm screen always shows child names before release).
P1.19 | 4-char legacy input no longer auto-submits at 4 (new) and 5-char input | BR | M
 Expect: typing 4 chars does not fire a lookup against a 5-char code's prefix; "Find" button works with Enter key on iPad keyboard; maxlength allows 5 (and hyphen paste).
P1.20 | Birthday-bound regression: legacy code collision on same day at current volume | API | S
 Reproduce F4/F5 (2 households same code) on the OLD code first (failing demonstration), then pass on the new. Required by "reproduce first" rule.
P1.21 | Parent tag disabled (`checkin_print_parent_tag=false`) | BR | S
 Expect: with pickups on, forced on (D11) both in roster flag and tablet; if a coordinator turns it off through DB/old settings page the tablet still shows code big on screen and warns.
P1.22 | Reprint / reissue | API | S
 Reissue keeps old code in event detail, new code unique in campus/day, old code no longer finds the child; parent holding old tag gets a clear "tag was reissued" rather than "no such code".
P1.23 | Injectable random/clock on tablet code path | RULES | M
 `pickupCode` takes `random`; `checkIn()` currently hardcodes `crypto.getRandomValues` and `Date`. Needs a test hook (see section 11).

## 2. Check-out

C2.01 | Cross-family release refused by code | API | M
 Setup: families A,B each with a child, same code (forced via legacy rows). `{security_code}` -> 409 listing both; nothing released. After picking family A's pickup_id explicitly: only A's children released.
C2.02 | Cross-family release via ids refused for new-format rows | API | M
 pickup_id=A with B's check-in id -> 409, zero rows changed (atomic: if one of three ids is foreign, none released: assert all-or-nothing, plan only says "refused").
C2.03 | Child-by-child, default unchecked | BR + API | M
 Family of 3 kids: tick 2, release; third stays open; same code still finds the third; Rooms shows 1 left; releasing the third later works; history shows two separate events.
C2.04 | Siblings in different rooms | API + BR | M
 Kids in rooms X and Y; release one: only that room's count drops; Rooms view of other room unchanged; room capacity pills right.
C2.05 | Partial pickup, different adult collects remaining child later | API | M
 Adult 1 takes kid 1, restricted-ness evaluated per adult per child; adult 2 (contact scoped only to kid 2) can take kid 2 but not kid 1 (already out) nor a third kid outside scope.
C2.06 | One child checked in twice (two parents, two stations, same service) | API | M (New)
 No uniqueness on (person, service, day) today. Expect defined behaviour: second check-in flagged `duplicate` (or merged into the same pickup) and not double counted in weekly kids totals and headcount; both codes resolve to the same child; releasing via one code closes both (or the duplicate is voided). This is a real Sunday scenario (mum and dad on two desks).
C2.07 | Same child checked in to two services same day (9:00 then 11:00) | API | S
 Expect: two rows legitimately; releasing 9:00 row does not release 11:00 row; code reuse per family across services handled (pickup is per family-per-day today, plan says "while any child still in").
C2.08 | Lost tag | API + BR | M
 Station alone cannot release (403/409); override requested; coordinator approves; ID check forced; `release_method='lost_tag'`; approval single use, expires 15 min (clock injectable), tied to listed ids only (adding an id after approval fails); a second child of the same family not in the approval is refused.
C2.09 | Code from yesterday / other campus | API | M
 Yesterday's open code at campus 1: 404 today (day-scoped) and Monday's reports unchanged; what does the volunteer see for a child never checked out yesterday: define and test the "still open from a previous day" report so a child is never silently lost (rows with `checked_out_at IS NULL AND day < today`). Other-campus code: 404 / no information leak (error text must not say "belongs to North campus").
C2.10 | Already checked-out child | API | M
 Re-submit: no-op, 200 with `checked_out:0` or 409 with reason? Define; event logged; original `checked_out_at/by/released_to` NOT overwritten (assert unchanged). Via two tabs double-tap: idempotent by `event_id`.
C2.11 | Concurrent check-out from two stations (same child) | API | M
 `Promise.all` two POSTs: exactly one succeeds, the other gets 409 "already released at 10:31 by Lobby"; one `checked_out_at`; no 500 from SQLite busy. Run 50 iterations.
C2.12 | Concurrent check-out vs restriction being added | API | S
 Transaction ordering: restriction commits before release => release denied. Check restriction read and update are in the same `tx`.
C2.13 | Offline check-out then sync | API + BR | M
 Stamped with `client_at`, `released_to`, device; `checked_out_at` = client time bounded (not future, not before check-in, not > 24h old); out-of-order (checkout before its check-in uploaded: held then applied; if the check-in never arrives within N hours, event shows, no infinite retry); duplicate replay x3 idempotent.
C2.14 | Offline check-out of a child the server already released from another station | API | M
 Expect: server keeps FIRST release, logs the second as `duplicate_release` event, notifies coordinator (child was handed over twice = safety signal) - plan only says "no-op, event logged"; add notification and a tablet-side message.
C2.15 | Offline check-out of a child who got a restriction while the tablet was offline | API | M (key)
 Tablet allowed it (stale cache); on sync server cannot undo. Expect: server records the release, flags `released_against_restriction`, high-priority notification to coordinators, not silently accepted as a normal check-out. Plan's "server never drops" conflicts with "hard block": must test that the replay path does not 409-and-poison the outbox (see 7.04) while still raising the alarm.
C2.16 | Time stamps | API | M
 `client_at` in the future, 3 days old, malformed, missing: bounded/ignored per plan; both client and server times stored; tablet clock 1 hour fast/slow: displayed time in history uses which? Test with injected clock; DST day.
C2.17 | Undo an accidental check-out | API + BR | M (New; plan has no un-release)
 Plan only has void for check-IN. Missing flow: volunteer taps check-out on the wrong family / parent returns child to room. Needs coordinator "undo release" within X minutes with reason, event `release_undone`, child shows in room again, weekly totals unaffected. If the owner chooses not to build it, test must pin that nothing else (e.g. re-check-in) double-counts the child.
C2.18 | Check-out wrong child by sight (code right, child wrong) | BR | S
 Per-child names + photo shown with the tick; label match instruction visible; "select all" appears only after the label-check step if plan keeps that wording.
C2.19 | Check-out when the code is correct but all children already out, partially | API | S
 Message distinguishes "all released at 10:31" from "no such code" (helps volunteer, but must not reveal other families).
C2.20 | Check-out for `kind` adult/volunteer rows | API | S
 Legacy path release behaviour unchanged; pickup path ignores non-kid rows; headcounts unaffected.
C2.21 | Void (check-in undo) | API | M
 Void keeps row, excluded from `/active`, `/attendance/weekly` kids total, Rooms, code lookup, conflict detection; void of checked-out row allowed? define; double void idempotent; station 403; helper 403; coordinator in other campus 403; void reason required (400 without).
C2.22 | Race: check-out request arrives while the same child's check-in record is still in another batch | API | S
 Check-in batch 200 limit vs server 500: records split across batches; release arrives between.

## 3. Custody / do-not-release / check-first

R3.01 | `canRelease` matrix | RULES | M
 Household adult / contact in scope / contact out of scope (child_ids) / contact before `starts_on` / after `ends_on` / one-time contact other day / restricted adult by `restricted_person_id` / by name only / by name with different case, accents, middle name, nickname, "Jr" / `check_first` / ended restriction / restriction `starts_on` in future / `ends_on` today (inclusive?) / `ends_on` yesterday. Boundary: date compare uses campus timezone, not UTC.
R3.02 | Name-only matching false negatives and positives | RULES | M (New)
 `restricted_name` "John Smith" vs selected adult "Jon Smith", "J. Smith", "Smith, John", "Johnny Smith", same name different person (positive: blocks innocent grandfather with same name). Define fuzzy policy; at minimum test normalisation (case, whitespace, accents, punctuation) and that "Someone else..." free-text names are matched against ALL active restrictions of that child, not only ones linked by id.
R3.03 | Server enforces on every path (code, ids, pickup, hub) | API | M
 For restricted child: `{security_code}` 409, `{ids}` 409, new shape 409, coordinator hub route 409 (hard block even for admin); each writes `release_denied`. Also the multi-child case: ticked 3 children, 1 restricted for this adult: whole request refused (atomic) or only that one? Pin it, and the UI explains which child.
R3.04 | Restriction added mid-service (online) | API + BR | M
 Child already checked in; coordinator adds restriction on phone; within one refresh (<= 10 min today: too slow) Rooms and check-out show alert; server blocks immediately. Test the tablet check-out re-validates against the server when online (not only cached roster). Measure and set a bound for tablet refresh of restrictions (plan relies on 10-min roster poll).
R3.05 | Restriction added while tablet offline (stale cache) | BR | M (key)
 Tablet offline from before restriction; volunteer releases to restricted adult: tablet cannot know. Expect: UI shows a persistent "restrictions last updated HH:MM, offline" banner; on sync server flags (C2.15); document that offline cannot enforce new restrictions (owner must accept). Also test the staleness limit: roster older than N hours when offline => banner "pickup alerts may be out of date, call coordinator for any alert child".
R3.06 | Restriction ended | API | M
 `ended_at` set: no longer blocks, still stored/visible in history, can't be un-ended silently (new restriction row instead); `ended_reason` required; end by helper 403; end audited.
R3.07 | Restriction dates in timezone | API | S
 `ends_on` = today at 23:30 local vs UTC next day; DST day.
R3.08 | Override with reason: `check_first` | API | M
 No reason (400); reason whitespace-only (400); approved by coordinator of a different campus (403); approved by the requester themself (should be refused when requester is a coordinator? define); expires; used once; second use 409; approval used for different child ids 409; denied override logs; override on a do_not_release to the NAMED person is impossible (hard block) even with approved override row inserted directly.
R3.09 | Who can see what | API | M
 Station/helper roster and `/pickup` JSON contain `station_note`, `kind`, name, photo but NOT `details`, `document_on_file`, `created_by`, `ended_reason`; check by deep-scanning the whole JSON for the `details` string seeded as a canary (`CANARY-DETAILS-XYZ`), for `/roster`, `/active`, `/pickup`, `/live`, push payload, notification inbox, audit log text, event `detail`.
R3.10 | Labels and tags never print restriction info | BR | M
 Child with do_not_release + check_first: capture `[data-print]` HTML: no restriction name, note, "!" unless owner opted in; canary string absent. Also `medical_notes` change (D10): label shows "Medical note - ask a leader" and not the text; allergies strip unchanged (regression).
R3.11 | Restriction visible on parent-facing/other surfaces | API | S
 Member app (`/app`) endpoints for a parent account never include restrictions/pickup data of other households; household page for staff without coordinator flag hides details.
R3.12 | Notifications text | API | M
 Push body generic ("A pickup needs your approval"), no child or adult names; inbox text for coordinators may include names (decide), verify no leakage in `tag`/`url`.
R3.13 | Restricted person is a household adult (implicit authorisation beats) | API | M
 Mum is restricted for child 1 only; she may still collect child 2 (siblings) - per-child scope.
R3.14 | Restriction on child merged into another person | API | M
 Person merge (people.js:189) moves restrictions; merged-away child's restriction still enforced; merging two children with different restrictions keeps both; archived child.
R3.15 | Restriction for a child with NO household / child moved households | API | S
 Moving a child to another household keeps restrictions; roster minimisation (campus-recent) must never drop a household that holds a restricted child (D9): restricted child's household always in roster even if no check-in in 12 months or other campus. (New)
R3.16 | Tablet shows alert at check-in, Rooms, check-out | BR | M
 Banner text exact; alert persists after reload and offline.
R3.17 | Rate-limit/lockout does not block legitimate release | API | S
 31 failed lookups locks 5 min: confirm a typo-prone volunteer at a busy desk (30 per 10 min per DEVICE) is not locked at Easter; locked state shows a coordinator-call message; successful lookups do not count; limit keyed per device not per IP (all iPads behind one church wifi share an IP!). (New: current helper keys by `req.ip`.)

## 4. Authorised pickup contacts and verification

A4.01 | One-time contact valid that day only | API | M
 Add at check-in; usable same day for its pickup session only; next day refused; other child of other family refused; timezone midnight.
A4.02 | One-time contact added at check-out | API | M
 Without override: 403/409; with approved override: ok; the contact is NOT persisted as permanent contact.
A4.03 | ID check policy never/unrecognised/always | API | M
 Each policy x each release_to_kind (household adult, contact, one_time, override, lost_tag, conflict, restricted child). `id_checked=false` where required -> 409; client sending `id_checked:true` is not verifiable: record who ticked; test an old client omitting it under `always` (expected 409 plus message old tablet can show).
A4.04 | Photo missing / broken link | BR | M
 Contact with no photo, directory person without photo, photo URL 404, photo of archived person: UI shows placeholder + "no photo on file - check ID"; check-out still possible per policy; offline photo not cached: placeholder not spinner.
A4.05 | Contact removed (archived) while child checked in | API + BR | M
 Removal on hub mid-service: tablet roster stale (up to 10 min / offline). Server refuses release to archived contact (online). Offline: same staleness case as R3.05. Archived contact remains in history; re-adding creates new row.
A4.06 | Contact scope `child_ids` | API | M
 Scope list with child later archived/merged; NULL = all children including children added later (decide and pin); malformed JSON in `child_ids` (hand-edited) fails closed (nobody authorised), not open.
A4.07 | Contact `starts_on/ends_on` | API | S
 Boundaries inclusive, timezone, `ends_on < starts_on` rejected 400.
A4.08 | Campus check on pickup routes (F11) | API | M
 North staff add/archive pickup on campus-2 household: 403; delete by bare id of other campus: 403; unknown id 404 (currently returns ok); audit rows exist; existing `DELETE` semantic becomes archive: old UI/hub code calling DELETE still works and the row stays.
A4.09 | Households with no campus (campus_id NULL) | API | S
 Define who can edit; `canCampus` treats null as open to all: pin it deliberately.
A4.10 | Contact phone/name duplicates; contact equals a restricted person | API | S
 Contact added with the same name as an active restriction: blocked at creation or at release (restriction wins), warning shown to coordinator.
A4.11 | Existing `household_pickups` rows keep working after migration 31 | API | M
 `created_at NULL`, `child_ids NULL`, `id_required 0`: authorised for all children, no photo, no ID needed under `unrecognised` (note: policy `unrecognised` makes pre-existing contacts "recognised" - confirm that is the intended meaning, else every old contact becomes ID-required).
A4.12 | Contact approved only via "pickup session" id that belongs to a different family | API | M
 `pickup_session_id` of family A used for family B: refused.

## 5. Permissions

P5.01 | Matrix sweep: every new/changed route x {volunteer, helper, leader (leaders mode), leader (explicit mode, no flag), staff, coordinator, admin, campus-limited coordinator (`north`), station, removed station, unauthenticated, guest} | API | M
 Generate table-driven test from a single route list so new routes can't be forgotten; assert status and, for 200s, the field set.
P5.02 | `checkin_access` mode flip | API | M
 `leaders` -> `explicit` flips instantly; auto-leader (`role_auto=1`, leads a team) loses access; a user whose leadership was REMOVED (role_auto demotion) loses it; admin never locked out; flipping back restores; flag set via accounts UI by non-admin 403.
P5.03 | Revoked user mid-session | API | M
 Session cookie of a user whose `checkin` flag/role was removed after login: next request 403 (guard reads DB per request, not cached on session). Tablet signed-in leader mid-checkout: error toast, queue preserved, no loss.
P5.04 | Campus limits | API | M
 `north` coordinator: roster/pickup/events/history/overrides/restrictions of campus 2 => 403 and 404-not-403 for existence leaks (ids guessable); override approval for campus-2 request 403; `restrictions` for a child whose household is at campus 2 but who visits campus 1 (children visit other campus: roster is church-wide today): decide who may see restriction.
P5.05 | Station token | API | M
 Allow-list sweep (finding 11): stations can only call roster, active, pickup, checkins POST, checkout, overrides POST, lease, campuses GET, people POST (guest); everything else under `/checkin/*` incl. `history`, `live`, `overrides/:id` PATCH, DELETE checkins, devices => 403. Station at campus 1 using `campus_id=2` in every route body/query.
P5.06 | Station removed mid-service | API + BR | M
 Removed during an outstanding override and with unsynced queue (see P1.09): pending override still approvable? Offline records from the removed device: accepted when they arrive via a signed-in session? Decide; no silent loss.
P5.07 | Station token in `req.user.id=null` | API | M
 Events and overrides stored with `user_id NULL`, `device_id` set; coordinator list shows station name; approvals by a station impossible.
P5.08 | Station posting `by`/`released_to` spoof | API | S
 Station name in `checked_out_by` is client-supplied: server must overwrite with authenticated identity (device) in new columns; test that a body `by:'Pastor Dan'` does not appear in the trusted column.
P5.09 | Helper vs coordinator vs leader details visibility | API | M
 `details`, document flag only coordinator/admin: canary test (R3.09).
P5.10 | Volunteer / guest | API | M
 403/401 on every check-in route; guest family `POST /people` from station creates records only at the station campus; guest via a volunteer account 403.
P5.11 | CSRF header and token in query | API | S
 New POST/PATCH routes require `x-mb`; station token only in header (never in URL logs).
P5.12 | Permission change does not alter existing users | API | M
 Migration 32 leaves `users` rows intact; default `checkin=''`; a staff/admin behaves identically before/after in `leaders` mode (snapshot of effective access for every seeded account before vs after).

## 6. Data integrity and migrations

D6.01 | Existing rows untouched (hash) | API | M
 Setup: DB at user_version 29 with seeded production-shaped data (see D6.06). Compute SHA-256 over `SELECT <original columns> FROM t ORDER BY id` for checkins, household_pickups, people, households, users, audit_log, settings, headcounts, rooms, services before; run migrations 30-32; recompute: identical. Also total row counts for all 59 tables unchanged, and `PRAGMA foreign_key_check` empty, `PRAGMA integrity_check` ok.
D6.02 | New columns have the expected defaults on old rows | API | M
 `pickup_id IS NULL`, `released_to=''`, `release_method=''`, `id_checked=0`, `voided_at NULL`; `household_pickups.created_at NULL`.
D6.03 | Historical reports unchanged | API | M
 Run `/attendance/weekly`, `/checkin/active?day=<past>`, headcount, any kids report on the pre-migration DB and post: deep-equal JSON (void filter must not change counts when nothing voided; the added `AND voided_at IS NULL` must be in EVERY query touching checkins: grep-based test listing all `FROM checkins` usages so none is missed, incl. person page "attendance history", exports, member app, merge, reports, dashboards).
D6.04 | Void instead of delete | API | M
 `DELETE /checkin/checkins/:id` keeps the row; deleting a campus/person: `checkins.person_id ON DELETE CASCADE` still erases history. Define: person hard-delete or campus delete cascades audit-relevant check-ins; `checkin_events` survive (no FK) but `checkin_ids` dangling: history page must render dangling ids gracefully.
D6.05 | Backfill correctness (plan says none) | API | S
 Confirm nothing writes during migration (row `changes` counts, trigger-free); legacy grouping in history report: (campus, day, code, household) for rows with NULL pickup_id; rows with identical code in two households shown as two groups.
D6.06 | Migration on a copy of production-shaped data | API + MAN | M
 Fixture generator: 40 Sundays x 2 campuses x 300 families, odd data (empty codes, 3-char codes, lower-case codes, `checked_out_by` NULL, orphan person ids, check-ins for archived people, duplicate households, NULL campus household, very long names/emoji). Restore real backup copy (owner) and run the same checks; time the migration (must be sub-second to seconds; `ALTER ADD COLUMN` is O(1) but `CREATE INDEX` is O(n): measure on 500k rows).
D6.07 | Idempotent re-run | API | M
 Run `openDb` twice on a migrated file: no error, user_version 32. Simulate crash between migration 30 and 31 (throw inside 31): DB left at version 30 consistent and a second start applies 31 cleanly (confirms the atomicity gap in finding 8). Partially applied ALTERs (SQLite DDL is transactional; assert it by injecting failure after the 3rd ALTER).
D6.08 | Rollback | API + MAN | M
 Open the migrated DB with the OLD code (checkout of `433475f` in a temp dir, run its `npm test` fixtures against the migrated file): old routes read/write checkins without touching new columns, `INSERT` into checkins works (NOT NULL columns without defaults would break it: all new columns need defaults; assert via inserting with the old statement), old `DELETE /pickups` hard-deletes and doesn't break on new columns, `PRAGMA user_version` 32 > old code's MIGRATIONS.length 29: confirm old code doesn't refuse to start or re-run (loop `v = version; v < length` is a no-op: good, assert).
D6.09 | Flags off = old behaviour (dark deploy) | API | M
 Run the entire pre-existing check-in tests with all new flags off against the new code: identical responses incl. status codes and JSON shape (old tests pass unchanged), and with `checkin_pickups` off, the new routes (`/pickup`, `/lease`) 404/disabled and the roster adds only ignorable fields.
D6.10 | Person merge moves new tables | API | M
 Merge child A into B: `pickup_restrictions.person_id`, `restricted_person_id`, `household_pickups.person_id`, `checkin_pickups.household_id`? (household merge too: plan only covers person merge; household merge/delete: `checkin_pickups.household_id SET NULL` loses the family grouping; test and pin).
D6.11 | Append-only trail | API | M
 No route and no code path updates/deletes `checkin_events`; DB-level trigger (`BEFORE UPDATE/DELETE` RAISE) recommended and tested; ON DELETE CASCADE of campus removes events (campus FK CASCADE contradicts "survives anything": note and test).
D6.12 | FK behaviour | API | S
 Deleting a user/device sets NULL, history intact; deleting a station with leases frees prefix; `PRAGMA foreign_keys=ON` assumed.
D6.13 | `docs/database.md` counts | API/manual | C
 A test asserting table count (64) and migration count (32) matches docs prevents doc drift (docs claim 29/59 today).
D6.14 | Backup/restore includes new tables | API | S
 Settings -> Backups snapshot contains migration-32 tables; restore round-trip keeps restrictions.

## 7. Backward compatibility

B7.01 | Exact v3 payloads against the new server | API | M
 Fixture captured from `git show 433475f:public/js/checkin.js`: check-in records (no pickup fields), `{campus_id, ids, by}`, `{campus_id, security_code}`: status and body deep-equal to the old server for the same seeded state (golden files) with all flags off, then with flags on for non-restricted/non-ambiguous cases.
B7.02 | Old offline queue after upgrade (sunday-night queue replayed Monday) | API | M
 Record `checked_in_at` 2 days old, unknown `room_id`, deleted person, duplicate ids, 500-record batch: all behave as today; no pickups created; conflict detection doesn't fire on legacy rows from different days.
B7.03 | Old tablet and new server restriction denial | API + BR | M
 Old tablet sends `ids` for restricted child -> 409 with message: old `showMatch` handler calls `fail(e)` but ALSO has already been inside try; verify it does NOT mark rows checked out locally (code does `saveToday` after await only: ok on throw). Offline-queued variant (poison, finding 4): old `flushCheckouts` never clears the outbox on error => stuck forever, retrying every 30 s and rate-limit counters inflate => lockout of the whole station. Test and decide server response for old shapes that are denied: return 200 with `{checked_out:0, denied:[...]}` so the old outbox drains? Must be decided with security (200 would make old tablet show "checked out"! worse). Needs a design answer; this is the single hardest compat case.
B7.04 | Old tablet marks child checked out locally though server refused partially | BR | M
 Old `showMatch` sends all ids; new server releases some and refuses others: old UI shows "Checked out X & Y" (it ignores `checked_out` count). Test server's behaviour (all-or-nothing recommended) and check what the old UI displays.
B7.05 | Mixed fleet: old tablet + new tablet on one campus, flag on | BR | M
 Old tablet issues 4-char codes concurrently with new 5-char; both release flows; Rooms shows both; new tablet sees old rows as legacy with no pickup card; conflict counter doesn't count legacy; old tablet displays rows created by new tablet via `/active` merge: code field now 5 chars: its `maxlength=4` input can't type it -> volunteer on old tablet cannot release new-format child by code (planned) but CAN use ... nothing; test that the old tablet's only path for those children is a clear failure and that coordinators know (Stations page "Needs reload").
B7.06 | Old tablet downloads new roster | API + BR | M
 Extra fields ignored; roster size growth doesn't exceed localStorage quota (old tablet `store.set` toasts "out of storage"): measure roster JSON at 3,000 households with photos (photos are data URIs?) and restrictions.
B7.07 | Service worker update | SW + BR | M
 Cache `mb-checkin-v4` replaces v3 and deletes v3; `FILES` list matches files on disk (test reads `public/` and asserts each listed path exists, and each local script imported by checkin.js is listed or still loads offline: new modules imported by checkin.js but missing from FILES break offline start); `skipWaiting` + `clients.claim` swap code under a running page: running page keeps old JS in memory but its next `import()` / lazy script could fetch NEW files (mixed versions in one page): test that checkin.js has no dynamic imports; network-first fetch for `/checkin` HTML while offline falls back to cache; failing `addAll` (404) leaves old SW active.
B7.08 | Version header and min_app | API + BR | S
 No `x-checkin-app` -> counted, "Needs reload"; `min_app` bigger than the tablet's: reload loop protection (reload only once per version, not while offline, not while queue non-empty, not mid-check-in: a forced reload in the middle of the family search loses the form state; test).
B7.09 | Tablet upgrade with unsynced old queue and outbox | BR | M
 `mb.checkin.queue` of N rows and `mb.checkin.outbox` of M ids present, new app starts: flush in old shape exactly once, no duplicates, no loss; new keys v2 created; app killed mid-migration (storage written in the middle) and restarted: idempotent.
B7.10 | Downgrade (rollback) of tablets | BR | S
 New app wrote v2 keys; old app reloaded after rollback ignores them; v2 outbox items would be stranded (data loss) -> document or test reading both.
B7.11 | `GET /checkin/active` extra fields | API | S
 Old merge `{...byId.get(a.id), ...a}` handles added fields; `restrictions` object not clobbering local-only keys (`synced`).

## 8. Regression of what works today (all with flags off AND on)

G8.01 | New family at the desk (station `POST /people` guest) then check in | API + BR | M
G8.02 | Print labels: kid label has allergy strip, name, room, date, code; parent tag per setting; all 5 label sizes render (check `@page` CSS) with 5-char code (longer string overflows 62x29 label: visual check, code font 14pt) | BR + MAN | M
G8.03 | Rooms by age and grade (existing rules test) plus birthday-on-day boundary, grade overrides age, no room fits -> "room to be assigned", archived room; room capacity pill | RULES + BR | M
G8.04 | Allergies and medical notes visible in Rooms and label | BR | M
G8.05 | Headcounts + `/attendance/weekly`: kids total unchanged with duplicates/void rules; weekly bucket across Sunday boundaries | API | M
G8.06 | Reports/exports referencing checkins (person history, attendance report page) | API + BR (ui-smoke pages) | M
G8.07 | Idempotent upload still holds (existing test), unknown person skipped not fatal, 501 records 400, bad id 400 | API | M
G8.08 | Station pairing flow test (existing 1441) unchanged and extended: station gets lease at pairing | API | M
G8.09 | Roster for station other campus 403 | API | M
G8.10 | `npm run test:ui`: all hub/app pages incl. new Live, History, person "Kids safety" card, as admin, `north`, volunteer; desktop + phone; light + dark; no script errors | BR | M
G8.11 | Workflows 1, 2, 6, 15 of docs/testing.md | MAN/BR | M
G8.12 | Roster endpoint response time and size (church-wide today) | API | S
G8.13 | Existing tests' dependence on today's date: new tests use relative dates; add campus timezone tests (campus 2 in a different time zone, if seeded) | API | S

## 9. Browser / device

V9.01 | iPad Safari: add to home screen, run offline (airplane mode), kill app, reopen offline | MAN | M
V9.02 | iPad Safari localStorage eviction (7-day ITP cap for non-home-screen sites; storage pressure) wipes roster/queue/lease: behaviour on next open (lost unsynced queue!) | MAN | M
V9.03 | Offline toggle during an in-flight check-out request (request sent, response lost): tablet retries; idempotent by event_id; local state ends consistent | BR (route abort) | M
V9.04 | Printer failure/unavailable: `window.print()` is fire-and-forget; AirPrint dialog cancelled: child is still checked in, "Print again" works, parent tag missing -> code shown big on screen; no way to detect failure (state this) | MAN | M
V9.05 | Label content on real Brother/Dymo: 5-char code legibility at 14pt on 62x29, no restriction text, medical note wording | MAN | M
V9.06 | Phone-size coordinator approval page (390px): approve/deny buttons reachable, no sideways scroll, shows only station-safe+approval-needed info, works from push tap, from signed-out state (login redirect returns to the override), dark theme | BR | M
V9.07 | Real push to an iPhone (PWA installed): arrival time, tap opens Live page, generic text | MAN | M
V9.08 | Slow network (3G throttle, 2 s latency, 10% loss): check-out lookup spinner, double-tap protection (button disabled after tap), roster refresh doesn't block UI, `sync()` timeouts (no fetch timeout today: a hung request blocks the queue and the 30 s interval stacks calls) | BR (CDP throttle) | S
V9.09 | Tablet orientation 1024x768 / 768x1024: per-child ticks and adult photos fit without scroll for a family of 6; tap targets >= 44px; on-screen keyboard doesn't cover the code box | BR + MAN | M
V9.10 | Two tabs on the same tablet (Safari tab + home-screen app) share localStorage: duplicate sync flush, duplicate issued codes (same device prefix, two JS contexts each with own in-memory state): `issued` list read-modify-write race | BR | M (New)
V9.11 | Tablet idle for hours (screen lock): timers throttled; `online` event fires; sync after wake | MAN | S
V9.12 | Dark theme + light theme screenshots for the alert banners (contrast, red on dark) | BR | S
V9.13 | Accessibility: banner announced (role=alert), focus management in override dialog | BR | C
V9.14 | Browser console clean (no uncaught errors) during all flows | BR | M

## 10. Load / time

L10.01 | Easter surge: 600 families x 2.3 kids across 6 stations, 55 minutes | API (scripted) | M
 Generate 1,400 check-ins in batches of 200 from 6 simulated devices concurrently; then 1,400 check-outs. Expect: all unique, p95 < 500 ms per route, no SQLITE_BUSY 500s (single writer: confirm busy_timeout), conflict detection query uses `checkin_pickups_code` index (EXPLAIN QUERY PLAN), roster endpoint with 3,000 households < 1 s and < size budget, `/active` with 1,400 rows.
L10.02 | Roster payload and localStorage quota | API + BR | M
 Church-wide roster today may exceed ~5 MB iOS localStorage; plus today-lists, issued list, queue: measure bytes; test `store.set` failure path (quota) during check-in: child must still get checked in (today it toasts and continues in memory but the queue write FAILED = the check-in is not persisted for sync: data loss). (New.)
L10.03 | Midnight boundary | API | M
 Check-in at 23:59 local on campus tz, check-out 00:01: day differs; code path uses today => cannot find; test the intended behaviour (late-night services, Saturday evening service, sleepover/lock-in events). Offline check-in at 23:55 uploaded 00:30: `day` from client time (correct) but code lookup `today` mismatch. Pin "open" definition (still open on previous day) and test both online/offline.
L10.04 | Campus timezone different from server and tablet | API | M
 Campus tz `America/Los_Angeles`, server UTC, tablet UTC: 17:30 PST Sunday = Monday UTC; `day`, restrictions `ends_on`, one-time contact day, override expiry, rate-limit windows all use consistent definitions.
L10.05 | DST transitions (spring forward Sunday 2am, fall back) | API | S
 Services at 9:00 unaffected; override 15-minute expiry computed in UTC, not local; `client_at` bounds across the shift; weekly bucket for the DST Sunday.
L10.06 | Tablet clock wrong (hours, days, years) | API + BR | M
 Check-in `checked_in_at` clamped (plan clamps only check-out); `day` wrong -> invisible to code lookup; Stations page shows skew; check-in refused or re-stamped with server time + flag when skew > N min.
L10.07 | Sync backlog after a long outage (Saturday offline, 2,000 queued records) | API + BR | S
 Batches of 200, retries on 5xx, order preserved (check-in before check-out), UI stays responsive, no duplicate toasts.
L10.08 | Rate-limit under load | API | M
 Easter pace: 6 devices each 25 lookups/10 min legit (typos incl.) never locked; 1 device failing 31 times locked, others unaffected; limiter state survives? (in-memory resets on deploy/restart: attacker restarts? no; but a legit restart gives free tries: acceptable, note).
L10.09 | Long-running tablet memory/storage growth: 52 weeks without unpair: purge older than yesterday works, `issued.*` keys purged | BR | S
L10.10 | Large family (9 kids), long names, emoji, RTL | BR | C

## 11. Plan design choices that make testing hard, and fixes

1. Randomness and time are hard-coded in `checkIn()` (`crypto.getRandomValues`, `new Date()`), `localNow`, and server `new Date()`. Fix: `pickupCode(prefix, taken, random)` already in plan; add a clock module `now()` in checkin-rules/server (`app.locals.clock`, settable only when `NODE_ENV=test`), and on the tablet read `window.__test?.random/now` guarded by a build-time constant or a `?test=1` only when server runs in test mode. Override/restriction expiry, rate-limit windows, `client_at` bounds, 30-day lease reclaim, midnight tests all need it.
2. `canRelease` is planned as shared tablet+server code: good, keep it pure (no DOM, no `Date.now`): pass `today` in. Add a golden-table JSON fixture consumed by both RULES and API tests so tablet and server cannot drift.
3. Tablet logic lives in one 500-line DOM module with module-level state: only reachable by Playwright. Fix: move pure parts (queue merge, outbox v2 migration, issued-list management, purge rules, roster minimiser) into checkin-rules.js or a new pure module and unit-test them; keep DOM thin.
4. Offline replay is tested only via browser in the plan. Add a pure "replay simulator" in test/api.test.js: scripted sequence of (device, time, action) events sent to the server in permuted orders (property test: any ordering/duplication of the same event set yields the same final state).
5. Rate limiter is a module-level Map keyed by IP in stations.js: not resettable between tests, shared across test files, keyed wrongly for a church LAN. Fix: factory `makeLimiter({clock})` exported, keyed by device id/user id; tests construct fresh.
6. Notifications (push/inbox) as a side effect inside route handlers: inject a `notify` function so tests assert calls (to whom, text) and run without web-push. Plan's "coordinator notified" cannot be verified otherwise.
7. Feature flags in `settings` read per request via `getSetting`: good (testable with `setSetting` mid-test), but the tablet only reads them at roster refresh: add `flags_version` in roster and a documented max staleness; test with simulated stale roster.
8. `stationMay` prefix allow: change to explicit allow-list array of `[method, pattern]` so the sweep test is generated from the same list.
9. Migrations as one array with no per-migration transaction wrapper visible: confirm and wrap each `exec` + `user_version` in one transaction so D6.07 can be satisfied; expose `openDb(path, {upTo: 29})` to build a v29 fixture and migrate forward in a test (needed for D6.01 to be automated without a real backup).
10. Test hook for "force same lease" (P1.04) and for "force code collision": `forceCode` query param is a security risk; instead the tablet reads codes from `window.__test.codeQueue` only in test builds, or the test seeds `localStorage` with a pre-issued lease before load.
11. Staleness of restrictions offline is a product limitation, not testable away: expose `restrictions_as_of` in the roster so tests and UI can assert the banner.
12. Plan test 22 says "byte-identical `SELECT * FROM checkins`": `SELECT *` gains columns, so compare the explicit original column list.

## 12. What cannot be automated here, and the manual checklist

Cannot run here: real iPad Safari (storage eviction, home-screen app, AirPrint), real label printers (Brother/Dymo sizing and legibility), real push on iPhone, real Wi-Fi drops, Sunday-scale concurrency on the production host (Render CPU/disk), real restored production backup (owner must provide a copy), real tablet clock skew.

Manual device checklist (record device, iOS version, tablet app version, result for each):
 [ ] M1 Pair iPad, add to home screen, airplane mode, check in 3 families, labels print, reconnect: "0 waiting to sync".
 [ ] M2 Two iPads offline at once at one campus, 10 families each: all codes distinct after reconnect; no conflicts.
 [ ] M3 Print 62x29 and 62x100 labels with 5-char code: code readable at arm's length; parent tag shows code; restriction text absent.
 [ ] M4 Printer off/out of paper/dialog cancelled: child still checked in, code visible on screen, Print again works.
 [ ] M5 Restricted adult attempt: tablet blocks, coordinator phone gets push with generic text, Live page shows request, approve/deny works on iPhone Safari (signed in and signed out cases).
 [ ] M6 Offline check-out then reconnect: other iPad updates within refresh; history shows tablet time.
 [ ] M7 Old app left open overnight on an iPad, new version deployed: it keeps working for legacy rows, Stations shows "Needs reload", reload picks up v4, queue intact.
 [ ] M8 Fill iPad storage (or use a Safari private-mode tablet) and check in: failure is visible, child is not lost.
 [ ] M9 Unpair/remove from hub with unsynced check-ins: confirm no loss/warning (see P1.09).
 [ ] M10 Slow Wi-Fi at the real kids' wing: time the full check-out (code, tick, adult, ID) with a volunteer: target under 30 s per family; note line length effects at peak.
 [ ] M11 Child-by-child pickup with a real tag, two kids, one stays.
 [ ] M12 Time zone/clock: set iPad clock 1 hour wrong; check in; confirm flag/skew shown.
 [ ] M13 Restore a real production backup copy to a scratch instance, run migrations, spot-check 10 historical Sundays against old reports.
 [ ] M14 Rollback rehearsal: deploy previous build against migrated copy, run a check-in/out cycle.

## 13. Gaps in the plan's own test list (section 7) summary

See reply. Plus smaller: no test for the existing-rows-untouched on every table (only checkins), no sync/offline poison-message test, no timezone/midnight test, no concurrency test, no dangling/duplicate child check-in test, no tests for notification content, no localStorage quota test, no test for the allow-list of station routes, no test for the lease race, no test that void filter is applied everywhere, no doc/count drift test, no rollback rehearsal against migrated DB (plan says "verify in QA" but lists no test).
