# Security review: kids' check-in child-safety plan, revision 2

Security Specialist · 2026-11-25 · Read-only review. No repository file was changed.

**Reviewed:** `plan.md` (primary), `operational-policy.md`, `approval-checklist.md`.

**Compared against:**
- the sources: `security-credentials-and-isolation.md`, `followup-architect-codes-checklist.md`, `followup-security.md`, and `review-security.md` (first round)
- the code on `main` @ `03b094f`. The plan cites `433475f`; the only change since then is `docs/roadmap.md`, so the code claims still apply.

**Empirical check:** SQLite trigger behaviour was tested with `node:sqlite` on Node 22.23.5, using an in-memory database in a throwaway location only. The results are under "Checked and sound".

---

## 1. Verdict

**Approve with required changes. The plan is not ready for owner sign-off until the 19 "must fix before approval" items in §3 are applied to the text.**

The architecture is sound and needs no redesign:
- codes only select candidates
- the careful lane handles ambiguity
- the dedicated check-in host
- server-derived day codes behind PBKDF2 and a device-bound wrap, plus an encrypted proof
- delete-guard triggers and a legal hold

Most of the revision-1 and Part 1/Part 2 findings are correctly adopted.

The three High findings are gaps in guarantees the owner is being asked to approve:
1. History can still be rewritten and then deleted, by editing the columns the triggers key on.
2. Level 3 notes stored as a `people` column would leak through existing `SELECT *` responses.
3. The permanent online PIN, typed on a shared kiosk, can approve releases of children with pickup alerts.

**Counts:**

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 14 |
| Low | 21 |

19 findings are marked **must fix before approval**: 3 High, 12 Medium and 4 Low wording fixes. The rest can be fixed during implementation.

---

## 2. Findings

Severity follows `docs/security.md`:
- **High:** an account acting beyond its role, or a sensitive path that isn't guarded.
- **Medium:** a defence-in-depth gap.
- **Low:** hygiene or wording.

### H1 · High · Must fix: history can be rewritten, then deleted, around the time- and status-based triggers

**Where:**
- Plan §4.2 "Migration m30: guards" (lines 863-875) and §4.4, which says "no route can hard-delete history"
- `server/routes/services.js:151-169` (`PATCH /services/:id` updates `starts_at`, staff)
- `server/routes/services.js:514-522` (`PATCH /assignments/:id`: **the volunteer themself**, or any scheduling leader, sets `status` with no time check)
- `server/routes/series.js:137-176` (`PATCH /series/:id`: `ends_on` in the past deletes past services at line 173; `from_date` in the past rewrites the times of past services at 152-155)

**What could happen:**
- `services_keep_history` and `positions_keep_history` refuse only when `starts_at <= now+14h`.
- `assignments_keep_history` refuses only for `status = 'accepted'`.
- Both columns are freely editable:
  1. A staff member moves a past service's `starts_at` to next year, then deletes it. The triggers pass, and assignments, attendance and headcounts cascade away.
  2. A volunteer marks their own past accepted assignment as "declined". That falsifies the serving record with no delete at all. A leader can then hard-delete it.
- This is exactly the insider R4 and the legal hold exist for: someone named in an allegation erasing that they served on a date.
- `PATCH /series` with a past `ends_on` is not in the plan's route list. The trigger blocks it (once H1 is fixed), but staff get a generic 500.

**How to reproduce (safely):** on a test database after m30 as designed:
1. `PATCH /services/:id {starts_at: '2030-01-01T09:00'}` on a past service with assignments.
2. `DELETE /services/:id` → 200, and the assignments are gone.

Also `PATCH /assignments/:id {status:'declined'}` as the assigned volunteer on last month's accepted assignment → 200.

**Required change to the plan text (§4.2, m30):**
- Add `BEFORE UPDATE OF starts_at ON services`:
  - abort when `OLD.starts_at <= now+14h`, history exists, and `NEW.starts_at > now+14h` (corrections that stay in the past are allowed)
  - abort when `NEW.starts_at` moves a future service with history into the past
- Add `BEFORE UPDATE OF status ON assignments`: abort when the service is past and `OLD.status = 'accepted'`. Corrections go through `removed_at/removed_by/remove_reason`, leader or above, with a reason, audited.
- The `PATCH /assignments/:id` route refuses status changes on past services for the volunteer (409 "This service has already happened").
- Add `PATCH /series/:id` to the soft-alternative list:
  - clamp `ends_on` and `from_date` to today or later
  - past services are never retimed or deleted by a series edit
- Change "no route can hard-delete history" to "no route can delete **or retroactively alter** serving and check-in history".

**Test:**
- N2-54 and N2-55 extended: move-then-delete is refused at the `PATCH` step.
- A volunteer's self-decline of a past accepted assignment → 409.
- A leader's correction sets `removed_at` with a reason.
- `PATCH /series` with a past `ends_on` or `from_date` → past services unchanged (row hash before and after).
- The grep test lists every `UPDATE services|assignments` statement.

### H2 · High · Must fix: Level 3 as a `people` column leaks through existing `SELECT *` responses

**Where:**
- Plan §3.12 and §4.3 m36 (`people` + `private_care_notes`)
- `server/routes/people.js:24`: `getPerson = SELECT * FROM people`, returned by:
  - `GET /people/:id` (leader, line 111, `...p`)
  - `POST /people` (leader **and stations**, line 159)
  - `PATCH /people/:id` (staff, line 179)
  - merge (line 208)
- `server/routes/finance.js:108` (`SELECT p.*`)
- The same pattern applies to the new contact `notes` ("coordinator-only") on `household_pickups`, which `people.js:116` and `checkin.js:30` return with `SELECT *` to any leader or station.

**What could happen:**
- §3.12 only removes `medical_notes` from `GET /people/:id`.
- As soon as m36 adds `private_care_notes` to `people`, every leader who opens a person sees it in the JSON. So does every staff member who edits one, and every response to a station-created guest.
- That is a signed-in account reaching data beyond its role (High), in the category the owner decided is coordinator and admin only (II-28).
- N2-46 lists some surfaces by name. It misses the `POST`, `PATCH` and merge responses, finance statements, and `household.pickups` inside `GET /people/:id`.

**How to reproduce (safely):** on a branch with m36, set a canary in `private_care_notes`, then call `PATCH /people/:id {nickname:'x'}` as staff, or `GET /people/:id` as a leader → the canary is present.

**Required change to the plan text:**
- Store Level 3 (and the contact `notes`) **in their own tables**, for example:
  - `person_care_notes(person_id, private_text, updated_by, updated_at)`
  - `household_pickups.notes` moved to `pickup_contact_notes`
- They are then out of every `SELECT *` and `p.*` by construction.
- **And** replace `SELECT *` in `getPerson` and in the household pickup queries with explicit column allow-lists.
- Make the canary test **router-wide**: hit every registered GET, POST and PATCH route as each role, plus a station, with canaries in `private_care_notes`, contact notes and `medical_notes`. Assert absence except on the two care-note endpoints for permitted roles.
- Update the table count (71).

**Test:** N2-46 rewritten as the router sweep above, including `POST /people` from a station and the 409 `duplicate` body.

### H3 · High · Must fix: the permanent 8-digit PIN typed on a shared kiosk can approve releases of alert children

**Where:**
- Plan §3.7.1 (lines 432-444)
- §3.3 careful lane (lines 277-278): `check_first`, `court_order`, conflicts and mismatches "need a coordinator (§3.7)"
- Checklist II-17

**What could happen:**
- The PIN is typed at the desk in front of volunteers and families every Sunday.
- It never expires: revision 1's 90-day rotation was dropped.
- It works at every station of the coordinator's campuses.
- It can approve a `check_first` release to the named person.
- A volunteer who has watched it (attacker A3) can approve, online, the release of a child with a pickup alert to someone working with them. They pick another name as operator, which is self-attested (§3.10), so "requester ≠ approver" doesn't stop them.
- Nothing tells the coordinator: real-time notification is specified only for offline approvals (§3.7.4 step 9).
- An A4 script on the iPad gets the same power by keylogging.

**Required change to the plan text (§3.7.1):**
1. A PIN may approve **only the kinds the offline code may approve** (§3.7.5), meaning children with no pickup alert. Any child with a pickup alert needs **phone approval**: the coordinator's own signed-in device, bound to the override id.
2. **Every PIN approval sends the coordinator a real-time push and inbox message** ("Approved with your PIN at North Desk 2, 10:42. Not you? Tap to report"). It counts in the weekly digest, like offline approvals.
3. The PIN rotates automatically every 90 days, and after any "Not you?" report.
4. PIN entry shows a privacy cover on the keypad (no digit echo).
5. Update II-17's description to include the scope limit.

**Test:**
- N2-33 extended: a PIN approval for a child with `check_first`, `court_order` or `pending_end` → 409 "Phone approval needed".
- A PIN approval for an allowed kind → notification row for the approver within the same request.
- A PIN older than 90 days → refused, with "Generate a new PIN".

### M1 · Medium · Must fix: the kill switch contradicts "do-not-release: no override by anyone", and one admin can use it

**Where:**
- Plan §4.8 "Emergency kill switch for restriction enforcement" (lines 987-991)
- §3.3 (line 274): "hard block with no override"
- Policy §7: "Nobody can override it: not … an admin"
- Checklist III-27

**What could happen:**
- One admin, with a typed reason, switches off restriction enforcement for 24 hours. It can be renewed.
- During that time a `do_not_release` child can be released to the named person.
- It is notified, so not silent, but it is still a single-person override of the one control the policy promises nobody can override.

**Required change:**
- Define the switch narrowly. It **never** lifts `do_not_release`.
- It only downgrades fuzzy-name matches and `check_first` to "coordinator approval", for the case where a bad restriction record blocks every release.
- It needs **two admins**, or an admin plus a coordinator who is not the requester.
- It lasts at most 4 hours, and can't be renewed without a new two-person approval.
- Add one sentence to policy §7 saying so.

**Test:**
- With the switch on, `do_not_release` still gives 409 on every path (R3.03 extended).
- Switching it on with one admin → 409.
- A second distinct admin → on; it expires on the injected clock.

### M2 · Medium · Must fix: single-admin bypasses of the legal hold, permits and ending a restriction

**Where:**
- Plan §4.9 (lines 997-1000)
- §4.2 permits (lines 877-880)
- §3.4 "Rules" (line 300)

**What could happen:**
1. **Hold release:** one admin releases a hold with a reason. That night `prune()` (`backup.js:195-201`) and `pruneLocal()` (`backup.js:204-211`) delete every copy outside "newest 14 plus monthly", including the copies the hold was preserving.
2. **Permit:** one admin can hard-delete a check-in row. Nothing keeps the deleted content: the permit stores only `table_name` and `row_id`. A permit created just before a hold is set stays valid for its 10 minutes, because the hold check happens only when the permit is created.
3. **Ending a restriction:** "a second coordinator **or an admin** confirms" doesn't say the admin must be a different person from the one who requested the end.

**Required change:**
- **Hold release:** needs a second admin, or the owner. Deletion of copies made during the hold resumes only after a **7-day cooling-off**, with a reminder to all admins on day 1 and day 6.
- **Permits:**
  - need a second admin to approve
  - the trigger also refuses when any active hold exists (checked inside the trigger), so the order of permit and hold doesn't matter
  - before the delete, the row is copied as JSON into an append-only `history_deletions(table, row_id, row_json, permit_id, at)` tombstone
- **Ending a restriction:** "confirmed by a **different** coordinator or admin; never by the person who requested the end, and never by anyone in the child's household".

**Test:**
- N2-61 extended: hold release by one admin → pending. Rotation deletes nothing for 7 days after the second approval (injected clock).
- N2-57 extended: a permit created before a hold → delete refused once the hold is set; the tombstone row exists after a permitted delete.
- R3.06 extended: the requester can't confirm their own end request, even as an admin.

### M3 · Medium · Must fix: trigger durability and coverage

**Where:** Plan §4.2, §4.3, §4.4, A18.

**What could happen:**
1. **Triggers are silently dropped when a table is rebuilt.** Verified: the 12-step `CREATE new; INSERT…SELECT; DROP; RENAME` leaves no trigger on the new table. A later, unrelated migration that rebuilds `checkins` or `assignments` would remove the protection with no error. §4.11 says "triggers can only be dropped by a new migration", which is true but not visible in review.
2. **Append-only tables and foreign keys:** `ON DELETE SET NULL` from an append-only table aborts the parent delete (verified). If `checkin_events`, `sensitive_access_log`, `checkin_overrides` or `retention_holds` reference `users` or `people` with SET NULL or CASCADE, the existing `DELETE /users/:id` (`setup.js:162-169`) starts failing with a 500. The plan specifies the FK policy only for the `campus_id` on `checkin_events`.
3. **Coverage:** these tables have no delete guard, and the `people` guard doesn't count them:
   - `pickup_restrictions`, which the retention draft keeps "long-term, including ended ones"
   - `household_pickups` (archive-only by route)
   - `checkin_pickups`
   - `checkin_overrides`

**Required change:**
- Add a **schema invariant test** run by `npm test`: after `openDb(':memory:')`, the exact list of required triggers exists in `sqlite_master` (name and table), and so do the 70 or 71 tables.
- Add to `docs/database.md`: any table rebuild must re-create its triggers in the same migration.
- Append-only tables store `user_id`, `person_id` and `device_id` as **plain integers with no FK**, plus a name snapshot.
- Add `BEFORE DELETE` guards (permit-only) on `pickup_restrictions`, `household_pickups` (rows with `created_at` set or ever used in a release), `checkin_pickups` and `checkin_overrides`.
- Add `pickup_restrictions`, `household_pickups` and `checkin_pickups` to `people_keep_history`.
- Mark A18 as **verified** (see "Checked and sound").

**Test:**
- The trigger-list invariant.
- `DELETE /users/:id` for a user with events and access-log rows → 200, with the events intact.
- A direct `DELETE FROM pickup_restrictions` → abort.
- Deleting a child with only a restriction (no check-ins) → abort.

### M4 · Medium · Must fix: rotation of the two secrets is undefined, and the envelope carries no key id

**Where:**
- Plan §3.7.2 "Secrets" (lines 447-450)
- §3.7.4 (lines 522-525): "SERVER_PUB from GET /checkin/station, with kid", but `env: {eph_pub, iv, ct}` has no `kid`
- Checklist II-20

**What could happen:**
- **`MB_CHECKIN_SYNC_KEY`:**
  - Replacing it while any iPad holds unsynced envelopes makes every one of them fail to decrypt. Each failure is `offline_approval_invalid` (critical), and 3 quarantine the device: a false incident on the morning after an outage.
  - Without `kid` in the envelope, the server can't choose the key.
- **`MB_CHECKIN_CODE_SECRET`:**
  - It is the root of every day code. Rotating it changes every live code at once, and the server can no longer rebuild the code for envelopes made under the old secret.
  - A leak of the secret together with a backup (which holds the nonces) exposes today's codes, and there is no procedure for that.

**Required change (§3.7.2 and §3.7.4):**
- Add a `kid` to both secrets.
- Add `MB_CHECKIN_SYNC_KEY_PREV` and `MB_CHECKIN_CODE_SECRET_PREV`, each with its kid, accepted for envelope validation only, for 14 days (twice the 7-day revoked-report window).
- `checkin_offline_codes` gets `secret_kid`.
- The envelope becomes `env: {kid, eph_pub, iv, ct}`. Put `kid` in the HKDF `info` (`"mb-oc-envelope-v1\0" || kid`) so a wrong key can't be selected silently.
- **Runbook:**
  - Rotation: set NEW as current, move the old one to PREV, bump every gen.
  - Suspected leak: as above, and treat today's codes as compromised (the same as "Rotate today's codes" for every campus).
  - Never log either value.
- Add both to the README settings list.

**Test:**
- An envelope sealed under the PREV sync key → accepted.
- Under an unknown kid → `offline_approval_invalid`.
- An envelope for a code derived under the PREV code secret → accepted until PREV is removed.
- Tampering with `kid` → decrypt failure.

### M5 · Medium · Must fix: what an offline approval is bound to

**Where:** Plan §3.7.4 "Server checks on sync" (lines 529-551).

**What could happen:**
- The envelope binds `E` (children, pickup, collector, kind) to the typed code.
- But the plan doesn't require that:
  - the **release report** that uses the approval matches `E`
  - `E.device_id` and `E.campus_id` match the **authenticated uploader**
- A script on the iPad, or a crafted outbox, could reuse a valid approval for child X to cover a report releasing child Y, or replay a captured envelope from another station.
- `approval_id` de-duplication doesn't catch the first misuse.

**Required change (add a check):**
- The report must cite `approval_id`.
- Its `pickup_id`, `child_ids` (as a set), `released_to_ref` or `released_to_name`, and `kind` must equal `E`. Otherwise `release_violation`.
- `E.device_id` must equal the authenticated station, and `E.campus_id` its campus.
- Each `approval_id` covers exactly one release report.

**Test (N2-27 extended):**
- A report citing a valid approval with a different child → `release_violation`.
- An envelope uploaded by another station → invalid.
- Two reports citing one approval → the second is a violation.

### M6 · Medium · Must fix: reports from revoked tokens contradict each other and can be backdated

**Where:**
- §3.7.4 check 1 (lines 530-532): revoked after `client_at` → accepted
- §3.7.7 T+2 (line 609): "Its later reports are quarantined"
- §3.9.1 item 2 (lines 671-672): accepted "for 7 days"
- §3.9.3 "Safety nets" (line 721): "recorded and alerted, never lost"

**What could happen:**
- For a **lost or stolen** device, `client_at` is set by the attacker's clock.
- Reports dated between the last contact and `revoked_at` are *accepted*: children are marked out on the server. Check 4 even permits that window.
- For a **replaced** device, reports after 7 days are either lost or kept, depending on which section you read.

**Required change:** one rule, stated once.
- **Revoke reason lost/stolen:** every upload after the revoke is **recorded and quarantined, never applied**. A coordinator reviews and applies it by hand.
- **Revoke by replacement or migration:** uploads are recorded and applied as reports, with an alert, **with no time limit**. Records are never lost.
- Remove "for 7 days" from §3.9.1.

**Test:**
- A revoked-as-lost device uploads a release with a backdated `client_at` → recorded, not applied.
- A replaced device uploads after 30 days → applied as a report and alerted.

### M7 · Medium · Must fix: the R2 tag-holder safeguards and lost-tag revocation don't hold offline

**Where:**
- §3.8 table (line 648): Tier A and B "works" offline
- §3.5 tag-holder steps 7-8 (lines 359-364)
- §3.3 lost tag: "the code is revoked"
- Owner decision I-08: "coordinator alerted immediately"

**What could happen:**
- **Tag-holder release:** with the Wi-Fi down, it goes ahead with no immediate coordinator push and no household message. Both are queued until sync, possibly hours later.
- **Lost tag:** a lost-tag release on iPad 1 revokes the code only on iPad 1. Whoever found the lost tag can present it at iPad 2, which is also offline, and use the tag-holder path for the children still in rooms. The safeguard the owner approved is silently weaker in exactly the conditions where it matters.

**Required change:**
- **Offline, a tag-holder release (not on the list) needs an offline day-code approval.** The coordinator is then physically present, which meets "alerted immediately".
- A lost-tag Tier B release offline also needs a day code. It is already allowed as `lost_tag_c` in §3.7.5.
- §3.8 states: "Offline: tag-holder and lost-tag releases need a coordinator at the desk (day code)."
- Add the kinds `tag_holder_offline` and `lost_tag_offline` to the §3.7.5 table.

**Test:** with the network cut, a tag-holder flow without a day code → refused on the iPad, and `release_violation` if a forged report reaches the server. With a day code → allowed, and the approver is notified on sync.

### M8 · Medium · Must fix: the server must limit unmigrated, migrating and old-host tokens, not just their screens

**Where:** §3.9.2-3.9.3 (lines 697, 712-724); §3.2 "Replace" keeps the lease (line 716).

**What could happen:**
1. **What the old host may receive.** "Before codes, offline verifiers and restriction data reach iPads" is enforced by a test only for restrictions (N2-10). Nothing stops verifiers or Level 2 notes going to an old-host token, whose storage is the hub origin.
2. **After "Move" is pressed.** The wipe is client-side only. The old token can still download the full roster from the hub origin until Replace. If staff abandon the move halfway, it can do so indefinitely.
3. **After day 60.** "Shows only the move screen" is UI. The token still has full API capability on the hub origin, from localStorage.
4. **Replace gate.** Replace trusts the client-side drain. If staff drained the wrong container (Safari versus the Home Screen app), queued items are orphaned, and the token is then revoked.
5. **Inherited prefix.** "Keeps the lease": after P4, replacing a dead iPad on a Sunday gives the new device a prefix already used today, with no issued list. That breaks the rule "never reassigned on a day it was used".
6. **`x-station` on the new host.** "Accepted only during migration" doesn't say on which host. If it is accepted on the check-in host, the token can live in localStorage there, and the HttpOnly benefit is lost.

**Required change (§3.9.3):**
- The server records `migrating_at` when "Move" is pressed. From then on, and for every unmigrated token after day 60, the token is **drain-only**:
  - `POST /checkin/checkins` and `/checkout` as reports, and `GET /checkin/station`
  - roster, active, pickup, photo, changes, approvers and care notes → 403
- Verifiers, restriction data and Level 2 notes are served **only to tokens with `host = checkin`**.
- **Replace** is refused unless the old device's last server-recorded `pending_queue` and `pending_outbox` are 0, reported after `migrating_at`.
- **Replace** gives a fresh prefix whenever the old prefix was used today or yesterday.
- `x-station` is **never** accepted on the check-in host. It is accepted on the old host only.

**Test:**
- N2-40 and N2-41 extended: after Move, roster → 403.
- Replace with server-side pending > 0 → 409.
- Replace on a day the prefix was used → new prefix.
- Day 61 (injected clock): roster → 403, uploads → 201.
- `x-station` on the check-in host → ignored.
- Verifiers and Level 2 for an old-host token → absent.

### M9 · Medium · Must fix: Level 2 on stations can't be gated or logged by the server as written

**Where:**
- §3.12 table (line 785): Level 2 "sent by `/changes`"
- §3.12 logging (line 788): iPad views "queued offline and uploaded"
- N2-48: "refused … in the server response"
- Policy §9: "Every time someone opens … it is recorded"

**What could happen:**
- `/changes` is a bulk download to the station, before any operator taps anything.
- So the server can't refuse a teen operator, and the view log is whatever the client chooses to send. A modified client, or a script on the iPad, logs nothing.
- The plan and the policy promise an authoritative log that the design doesn't provide.

**Required change.** Pick one and state it:
- **(a), recommended:** Level 2 on stations is **fetched on tap**, online only, via `GET /checkin/care-note/:child?operator=` (operator adult-checked, logged server-side, `no-store`). Offline, Rooms shows the Level 1 line plus "Full note needs a connection". Level 1 already covers the life-critical part offline (R3 note).
- **(b):** keep the bulk delivery. Reword so that the **server logs delivery** (device, child, day) as the authoritative record, and iPad view logs are "client-reported". The teen gate on stations is client-enforced. Remove "in the server response" from N2-48. Record it as an accepted risk (II-36).

**Test:**
- (a) A teen operator → 403. A view → log row written by the server.
- (b) A delivery-log row for every child note sent; the access-log page labels client-reported views.

### M10 · Medium · Must fix: the hold's pause on local copies can fill the live database's disk

**Where:** §4.9 effect 1 (lines 1003-1005); `backup.js:204-211` (`pruneLocal`, keeps 3); A16.

**What could happen:**
- "Nothing is deleted" includes **local** copies on the Render persistent disk, which also holds `meadowbrook.db`.
- A hold lasting weeks grows the disk until SQLite writes fail. That is a check-in outage, on a Sunday.
- The 80% alert needs someone to act.

**Required change:**
- Under a hold, keep **all Drive copies**, but keep local pruning at 3 **when the Drive copy of each pruned file exists**.
- Only when Drive isn't connected does local pruning pause. In that case:
  - alert at 60% and 80%
  - refuse to start or continue a hold without Drive, unless an admin acknowledges the disk risk
- Under a hold, also skip the Drive delete of the previous version of a changed uploaded file (`backup.js:165`).
- `DELETE /backups/drive` (disconnect) is refused while a hold is active.

**Test:** N2-61 extended:
- hold + Drive → local copies stay at 3 and Drive copies are kept
- hold without Drive → local copies kept, with alerts at 60% and 80%
- disconnect during a hold → 409

### M11 · Medium · Must fix: the paper fallback releases on a matching number plus "I know them"

**Where:** Policy §12 "Pickup"; plan §3.2 "Paper pads"; §4.7 (the paper kit is *the* soak fallback).

**What could happen:**
- Policy §12 lets anyone release when "the numbers must match" and the person is "known".
- There is no "who's collecting first", no "name the child first", no adult-operator rule, no tag-holder rule (record, alert), and no "keep the tag".
- That is a code-led release on the path used exactly when the iPads fail. It contradicts R1 and I-02.

**Required change (policy §12, plus a line in plan §3.2):** on paper:
- ask who is collecting, and the adult names the children first
- **keep the tag half**
- only the parent or adult written on the sheet, or a listed adult, collects without a coordinator
- anyone else is a tag holder: an adult volunteer, ID name and type written on the sheet, and the coordinator called before release
- volunteers under 18 release only to the parent written on the sheet

**Test:** a desk-card review (church ops) and a soak observation item (O-x): a paper pickup by a non-listed adult is escalated.

### M12 · Medium · Must fix: hub sessions already on kiosks survive the quick wins

**Where:** §3.9.1 item 2; Phase 2; today's `checkin.js:127`, `:193` and `auth.js:16` (30-day sessions).

**What could happen:**
- Kiosks where someone used "Sign in to sync" or "sign in as a leader" before P2 keep that person's hub session for up to 30 days.
- "Station token wins" ignores it only on check-in routes. Anyone at the kiosk who reaches the address bar, or any script in the shared origin, can still use the hub as that person until P3.

**Required change:** add to P2 deployment (III-03) a step: "Sign out every check-in iPad", meaning end the sessions seen with an iPad user-agent on station devices. Also add a server rule: on `/checkin` pages and `/api/checkin/*`, a request carrying both a session cookie and `x-station` gets `Set-Cookie: mb_session=; Max-Age=0` (the session on the kiosk is ended), and the event is audited.

**Test:** N2-35 extended: both credentials present → the session row is deleted and the cookie cleared.

### L1 · Low · Must fix (wording): the plan's promise is not true offline

**Where:** §3.2 "Accurate promise" (lines 206-209); policy §1; checklist I-03.

**What could happen:** if a cloned iPad and the original are both offline, each sees **one** match for the repeated code. "The desk sees both families" is then false. Safety still holds, because a single match isn't proof: a photo match to that pickup's adults, or names-first for a tag holder, is required.

**Required change:** use this wording: "…the server notices as soon as the iPads are online. At any time, a code only finds a family: the volunteer still checks that the person collecting belongs to that family, with their photo or ID, before anyone leaves."

**Test:** none; this is wording (N-Q1 clone simulation already covers the behaviour).

### L2 · Low · Must fix (wording): attendance and headcount edits are said to be "audited" but are not

**Where:**
- §4.2 "Not guarded" (line 896)
- `server/routes/attendance.js:39-49` (`POST /services/:id/roll` deletes rows, with no `audit()`)
- `server/routes/checkin.js:121-135` (headcounts, no audit)

**Required change:** either add `audit()` with the old value (`attendance.unmark`: service, person, who) and `headcount.update` (old → new) in P1, or remove "audited". Under a hold, state that the held copies are the nightly backups, so edits made within a day are not preserved.

**Test:** un-marking a person writes an audit row with the service and person id.

### L3 · Low · Must fix (wording): the policy weakens the two-person rule

**Where:** Policy §10, last bullet: "…or your own request on a child with a pickup alert".

**Required change:** "You may never approve your own request, or a release to yourself or your own family." This matches plan §3.3 ("The requester can't be the approver") and §3.7.4 check 7.

**Test:** none (N2-32 already covers it).

### L4 · Low · Must fix (approval): today's code-only release continues through P1-P3, and no item records its acceptance

**Where:** §2 R1 row; checklist (none).

**Required change:** add an item to group II: "Accept today's code-only check-out until pickup sessions are enabled (P4). The Phase 2 ambiguity guard is the only change before then. Expected duration: about 8-12 weeks."

**Test:** none.

### Medium findings to fix during implementation

**M13 · False clone and logout alarms from epoch and cookie rotation on flaky Wi-Fi**
- **Where:** §3.2 "lease_epoch increases on every online contact" (line 189); §3.9.2 item 3 "old token valid until the new one is first used".
- **What could happen:** concurrent or retried requests that carry the previous epoch or token arrive after the new one has been used. That triggers `lease_cloned`, moves prefixes, flags every open pickup on that prefix for the careful lane, or gives a 401 mid-service.
- **Change:**
  - The epoch advances only on an explicit, single-in-flight `lease/renew` call.
  - The server accepts epoch n−1 for 2 minutes after n is first seen, and alarms only when **both** n and n−1 keep being used after that.
  - The same 2-minute grace applies to the old station token.
  - A 401 from a stale token never clears the queue or outbox.
- **Test:** a replay simulator sends interleaved retries → no `lease_cloned`. A true clone (two devices alternating for 10 minutes) → one alarm.

**M14 · Recomputing verifiers on the server is a CPU and threadpool denial-of-service lever**
- **Where:** §3.7.3: "V itself is not stored; it can be recomputed", about 100 ms per verifier.
- **What could happen:** a station, or a script on it, re-requests approvers in a loop, or a coordinator spams "Rotate today's codes". Each request costs one PBKDF2 at 600k per coordinator on libuv's 4-thread pool. That pool is shared with other async crypto and filesystem work, so sign-ins, the online reserve and uploads slow down on the single instance (A15).
- **Change:**
  - Issue each (device, code_id) verifier at most 3 times a day, with a 304 otherwise; the device keeps W.
  - Limit manual rotations to 3 per campus per hour.
  - Run PBKDF2 asynchronously only, at most 2 at a time (a semaphore).
  - Add A27: one Render instance with the default threadpool.
- **Test:** 50 rapid approvers calls → at most 3 PBKDF2 runs, and p95 latency of `/healthz` and check-in unchanged (L10).

### Low findings to fix during implementation

| # | Where | Issue | Change | Test |
|---|---|---|---|---|
| L5 | §3.2 (line 151) | "183 leasable prefixes" includes `99`, which is reserved for server codes | Use 182 leasable; `99` is never leased | Lease allocator refuses `99` |
| L6 | §7 totals | The phase efforts add up to 52.5 days, not 52 (and 56 with P9) | Correct the totals | — |
| L7 | §3.7.8-3.7.9 | At the 310k fallback, the attacker cost halves (about $37 and 1.5 h) | Say so in the residual-risk text | — |
| L8 | §3.7.3 | A same-origin script captures **V** at verifier download, which is testable offline without K_dev. K_dev doesn't help against A4 at all. The plan's assumption already covers this; the text should say it. Optional hardening: deliver V wrapped to a device ECDH key and `unwrapKey` it as a non-extractable HMAC key, so V never reaches JS | Add the sentence; optionally adopt the wrap | N2-21 dump |
| L9 | §3.7.4 checks 4-5 | "The device's last contact" is ambiguous, and must mean before this sync. Out-of-order upload makes a lower `seq` look invalid and counts toward quarantine | Define it as the last contact before this sync; the client uploads in `seq` order; the server sorts each batch by `seq` | Shuffled batch → all accepted |
| L10 | §3.7.4 | The server must hash the **received E string**, not a re-serialisation, and must reject invalid curve points | Specify both (Node `ECDH.computeSecret` validates the point) | A point not on the curve → invalid |
| L11 | §3.5 photo endpoint | "Roster scope" lets one station fetch photos of every adult and child in 12 months of families | Limit to people in **today's open pickups** at that campus (children, household adults, contacts), and rate-limit | Photo of someone not in today's pickups → 404 |
| L12 | §3.7.3 | Verifiers are "sent during check-in hours", so an iPad that is offline from Sunday start has none. "Admins" get codes everywhere, so every iPad carries every admin's verifier | Fetch from 18:00 the day before, whenever online, outside hours too (A28: iPads stay powered and online overnight, or boot online). Admins only when on the rota | N2-24 |
| L13 | §3.9.2 | `checkin.<domain>` is **same-site** with the hub, so SameSite doesn't separate them; CORS and `x-mb` do. A hub script could toss `Domain=` cookies | Server reads only `__Host-mb_station` there; a tossed `mb_session` is ignored | N2-37: `mb_session` with `Domain=parent` → `req.user = null` |
| L14 | I-04, §3.2 | Signed-in laptops kept on the hub host would hold leases and caches on the unisolated origin | If kept: online-only, no roster cache, no verifiers, no restriction data | Hub-host session check-in → no approvers, no restrictions |
| L15 | §3.9.1 item 6 | `no-store` is missing on `/checkin/pickup`, `/checkin/active` and `/checkin/station` | Add them | Header test |
| L16 | `public/js/checkin.js:37,94-96` | Today's client drops the token on `station_removed`. The new reports-after-revoke path needs a distinct response (`reports_only`), and the cookie must not be cleared | Specify the response | Revoked device uploads its queue |
| L17 | `auth.js:166,174` | `scryptSync` blocks the event loop. The PIN verify path should use async `crypto.scrypt` | Specify async | — |
| L18 | §3.12 | The existing free-text `allergies` becomes Level 1, which teens see, and may contain private material | Add `allergies` to the coordinators' manual review list (A17) | — |
| L19 | §4.9 | A Drive owner can delete held copies in Google Drive outside the app, silently. That is residual risk | State it. The hold notice tells the Drive account owner not to delete, and offers "Download a copy now" | — |
| L20 | §3.3 rule 4, §3.1 | Tag kept, ID checked, age confirmed and the operator are **client-attested**. The server checks consistency, not truth | Reword: "checks every release for consistency and records it" | — |
| L21 | §3.7.7 T+15 and policy §11 | "Today's care notes" is true only after P7. Before that, the roster holds every family's `medical_notes` (`checkin.js:28-29`) | Phase-dependent wording | — |

**Further inconsistency:** policy §9 gives Level 2 to "leaders", but plan §3.6 and §3.12 give it to helpers 18+, coordinators, staff and admins. The two need aligning.

---

## 3. Must fix before owner approval (19)

1. **H1:** guard the edits that defeat the triggers: `services.starts_at`, past `assignments.status` (including a volunteer's self-decline) and `PATCH /series`. Reword the claim to "can't be deleted or retroactively altered".
2. **H2:** keep Level 3 and contact notes out of `people` and `household_pickups` (separate tables), replace `SELECT *` in person and pickup responses with allow-lists, and make the canary test router-wide.
3. **H3:** an online PIN can't approve releases of children with pickup alerts (phone only); every PIN approval notifies the coordinator in real time; the PIN rotates every 90 days.
4. **M1:** the kill switch never lifts `do_not_release`, needs two people, and lasts at most 4 hours; update policy §7.
5. **M2:** hold release, history-delete permits and ending a restriction each need a second distinct person. Add a 7-day cooling-off before rotation deletes, a hold check inside the trigger, and a deletion tombstone.
6. **M3:** a trigger-existence invariant test and a rebuild rule; no FKs from append-only tables; delete guards on restrictions, contacts, pickups and overrides; A18 marked verified.
7. **M4:** rotation and leak procedure for `MB_CHECKIN_CODE_SECRET` and `MB_CHECKIN_SYNC_KEY` (kid, PREV keys for 14 days); `kid` in the envelope and in the HKDF info.
8. **M5:** a release report must equal its approval's `E`, the envelope's device and campus must equal the uploader's, and each approval covers one release.
9. **M6:** one rule for reports from revoked tokens: lost or stolen → quarantined and never applied; replaced → applied with no time limit; drop "7 days".
10. **M7:** offline tag-holder and lost-tag releases need an offline day-code approval.
11. **M8:** server-side limits: drain-only after Move and after day 60; verifiers, restrictions and Level 2 only to check-in-host tokens; Replace gated on server-side pending = 0 and given a fresh prefix if the old one was used; `x-station` never on the check-in host.
12. **M9:** Level 2 on stations fetched on tap with server-side operator check and logging, or explicitly reworded as client-enforced with a delivery log.
13. **M10:** under a hold, keep Drive copies but keep local pruning (disk shared with the live DB); refuse a Drive disconnect during a hold.
14. **M11:** paper-kit release rules match R1 (who's collecting first, keep the tag, tag-holder rules, teen limits).
15. **M12:** sign out the hub sessions already on kiosks at P2, and clear the session server-side when both credentials arrive.
16. **L1:** fix the family promise wording (the desk may see only one family offline; the code still never suffices).
17. **L2:** attendance and headcount edits are not audited today; add the audit or remove the claim.
18. **L3:** policy §10: never approve your own request, whatever the child.
19. **L4:** add a checklist item accepting today's code-only check-out until P4.

## 4. Fix during implementation
M13, M14, L5-L21, and the Level 2 wording mismatch between policy §9 and plan §3.6.

---

## 5. Checked and sound

**SQLite trigger semantics (A18 is resolved).** Tested with `node:sqlite` on Node 22.23.5, `foreign_keys = ON`, `recursive_triggers = 0`:
- A child table's `BEFORE DELETE … RAISE(ABORT)` **does fire on rows removed by `ON DELETE CASCADE`**, including through two cascade levels.
- It **aborts the whole statement**: parent, child and grandchild all stay.
- Inside a transaction, the statement is rolled back and the transaction stays open, so the existing `tx()` (`db.js:878-888`) rethrows and rolls back. The safe direction.
- `ON DELETE SET NULL` into a table with a `BEFORE UPDATE` abort trigger aborts the parent delete.
- Today there are 29 migrations, 59 tables and 0 triggers, as the plan says.

**Choosing triggers over a table rebuild** is correct:
- `migrate()` wraps each migration in `tx()` (`db.js:867-875`).
- `PRAGMA foreign_keys` can't change inside a transaction.
- A rebuild would copy every row.

**Code claims match the code:**
- `services.js:171-180`, `teams.js:102-110`, `series.js:180-186`, `db.js:176-180, 264-266`
- `checkin.js:71` (server `securityCode()`)
- `public/js/checkin.js:127, 193` (kiosk sign-in links)
- `stations.js:36` (`req.user` beats the station)
- `index.js:52` (`SAMEORIGIN`)
- `video.js:61` (hls.js with no SRI)
- `auth.js:33` (host-only, `SameSite=Lax`)
- `auth.js:166` scrypt parameters (N=16384, r=8, p=1, 16-byte salt, 32-byte key)
- `backup.js` rotation in `prune` and `pruneLocal`
- the `/people/export.csv` column allow-list has no `medical_notes` (`people.js:102`)
- search returns no medical fields (`search.js:24-28`)

**Day-code cryptography matches the spec, and its numbers are consistent:**
- HMAC derivation with a version and domain-separation string and NUL separators; the nonce comes from the CSPRNG; modulo bias is about 5·10⁻¹⁰
- the code is never stored, and rebuilding it needs both the database and the environment secret
- PBKDF2-HMAC-SHA256 at 600k (310k fallback), `dkLen = 32`, a 32-byte salt per device, coordinator, day and gen, with the device id in the salt string
- W = HMAC(K_dev, V); the statements about what K_dev does and doesn't do are accurate
- the comparison has no early exit
- the envelope is ECIES-style: a fresh ephemeral ECDH key per message, so there is a unique AES-GCM key per message and **IV reuse is impossible**; HKDF with a salt and info; AAD = SHA-256(E) binds the context
- the envelope is randomised, so it adds no offline brute-force target
- `timingSafeEqual` on the server
- `approval_id` plus `seq` give replay protection
- these figures are arithmetically correct and match the spec:
  - 7.7 days on 1 GPU, 2.1 years on a 16-core CPU, 2.9 h on 64 GPUs, about $75
  - 2·10⁻⁹ through the UI and 3·10⁻¹⁰ through the server
  - about 720 PIN guesses a day, about 7·10⁻⁶
- the offline allowed-kinds table, the limits (5/15 min, 20 a day, 10 approvals), expiry, the rotation triggers and the lost-iPad timeline all match the spec

**The online PIN is never stored on any device.** Day codes are never accepted online (router sweep N2-20).

**Origin isolation design:**
- A separate origin gives separate localStorage, IndexedDB, Cache Storage and service worker.
- A host-only hub cookie is never sent to the check-in host.
- `__Host-` rules out `Domain` and cookie tossing of the station cookie.
- HttpOnly stops exfiltration of the token.
- `x-mb` with no CORS blocks same-site writes.
- `frame-ancestors 'none'` and COOP stop framing and opener access.
- The quick wins target the right lines, and the CSP values are correct for `checkin.html` (no inline script; inline styles needed).

**Every check-out path after P4 was checked for a code-only release, and none was found except the two already listed (paper, M11; P1-P3, L4):**
- Fast lane: needs a photo match to *that* pickup's adults.
- Multiple matches: careful lane, names first, ID, coordinator.
- Old app: `{security_code}` and `{ids}` → 409 plus a `legacy_release_attempt` record. The old client only ever sends `ids` (`public/js/checkin.js:415,433`), and nothing else in `public/` calls `/checkin/checkout`.
- `code_unknown` and `mismatch`: coordinator only.
- Lost tag: a name or phone search, then a photo or ID.
- Tag holder: names first, tag kept, ID.
- "List only": phone call to a parent, or refuse.
- Undo: coordinator, within 30 minutes.
- Duplicates: close both rows.

**Other points that are sound:**
- Enabling pickups is gated server-side on every station having migrated, so an old-app iPad can only be a forgotten one.
- Restriction `details` never go to push, audit, search or the roster.
- Teens seeing restriction names is the right trade-off, so the hard block is visible at the desk.
- The access log stores no note content.
- Backups are AES-256-GCM encrypted before they leave for Drive.
- Treating "operator under 18 if the birthdate is missing" and "Someone else" as not adult is the right default.
- The `attested` operator is recorded as an accepted residual (II-36). I recommend `phone` mode at least for tag-holder releases (I-27, owner decision).

## 6. Owner decisions arising
1. M1: the scope of the kill switch, and the two-person rule for it.
2. H3: a PIN can't approve releases of alert children (phone only); 90-day PIN rotation.
3. M9: option (a), fetching Level 2 on tap (Level 2 is then unavailable offline), or option (b), client-enforced with a delivery log.
4. I-27: require `phone` operator confirmation for tag-holder releases even in `attested` mode.
5. M2: who is the second person for hold release and permits (a second admin, or the owner).

## 7. Handoff
- **To the `chief-architect`:** apply §3 items 1-19 to `plan.md`, the policy and the checklist. New items: II-41 (L4), plus the M4 secrets runbook and A27 and A28.
- **To the `senior-developer` (later phases):** M13, M14, L5-L21.
- **To the `qa-engineer`:** the tests listed for each finding. The trigger-list invariant test (M3) and the router-wide canary sweep (H2) are the two new suites.
