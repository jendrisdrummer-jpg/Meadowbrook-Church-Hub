# Kids' check-in child-safety plan — revision 3.1, amended by revision 3.2 (for owner approval)

Chief Architect · 2026-11-25 · Planning only. **Nothing is implemented; no application code, schema, migration or production setting was changed.**

Revision 3 applies all 19 "must fix before owner approval" items from the Security review of revision 2
(`review-security-rev2.md`: 0 Critical, 3 High, 14 Medium, 21 Low). The review's other findings are listed in §10 to be
fixed during implementation.

**Repo state:** `main` @ `433475f`, 29 migrations, 59 tables, `npm test` 42/42.

**Companion files:**
- `operational-policy.md`: church-facing policy for staff and volunteers.
- `approval-checklist.md`: 128 items in three groups, with a one-page owner decision sheet at the top.

**Sources:**
- Revision 1: revision 1 (git history of `plan.md`).
- Reviews: `review-security.md`, `review-qa.md`, `review-operations.md`.
- Follow-ups:
  - `followup-architect-codes-checklist.md` (codes, checklist)
  - `followup-security.md` and `followup-operations.md` (tag holders, medical, retention)
  - `security-credentials-and-isolation.md` (offline credentials, check-in host)
- Owner requirements of 2026-11-25 (items R1–R7 below).

---

## 0000. Revision 3.2 (binding)
[revision-3.2.md](revision-3.2.md) answers the owner's four questions of 2026-11-25 and **governs over this file where
they differ**. In short:
- a new first code phase **P0.5 "Interim guard"**: two-family stop, child-by-child check-out, a server guard on both
  check-out paths (closing a gap found in the 3.1 guard), a safe outbox migration, and label and tag privacy now
- a **temporary pickup procedure** from next Sunday
- an **approved release roster** with confirmation on the volunteer's own phone for every Tier B release
- the exact **label content**, with the reason for each item
- **hardware and costs**: no paid service, subscription or new hardware required
- effort is now **about 61.5 working days core** (65 with P9). The calendar is revised in
  [schedule-review.md](schedule-review.md): about 15 weeks recommended, about 11–12 accelerated, with no requirement
  changed

Security ("approve with changes", all applied) and Church Operations ("workable with changes", applied) reviewed it.

## 000. Revision 3.1: final Security verification notes (N1–N8, binding)
The Security Specialist verified revision 3: all 19 must-fix items pass; verdict "ready for owner sign-off with minor
notes" (`review-security-v3-verification.md`). These eight notes are applied in the text below; **where any older
wording differs, this section governs.**

| # | Sev | Change |
|---|---|---|
| N1 | Medium | Update guards use `now−14h` (past in every time zone); routes check the exact campus-local start; delete guards keep `now+14h`. Ordinary next-day changes (declining Sunday 9 a.m. on Saturday evening, moving tomorrow's service) are never blocked. (§4.2) |
| N2 | Medium | Under a hold **without Drive**, at 85% disk the hub **stops making new local backups** (held copies kept), sends an urgent alert to admins, and shows a banner until Drive is connected or space is freed. The live database is never put at risk by held backups. (§4.9) |
| N3 | Low | Kiosk sessions are ended by the server rule on the first check-in request plus a manual "Sign out" at the P2 visit; no lookup by user agent or IP (the sessions table has neither). (§3.9.1) |
| N4 | Low | The relaxation switch's effect is defined: coordinator online-PIN approval at the desk instead of phone approval for fuzzy matches and `check_first`; never offline, never `do_not_release`. (§4.8) |
| N5 | Low | The Level 2 endpoint relies on the operator the desk names (self-attested) and the text says so; label wording "MEDICAL NOTE: ask the room leader"; assumption A14 corrected (Level 2 never stored on iPads). (§3.12, A14) |
| N6 | Low | Paper pickup: only the adult written on the sheet collects without a coordinator; "list only" households always need one. (policy §12) |
| N7 | Low | Trigger hold check uses `release_approved_at` and honours the 7-day cooling-off. (§4.2) |
| N8 | Low | Key rotation time is recorded in Settings; `_PREV` keys accepted only within 14 days of it. (§3.7.2) |

## 00. Changes in revision 3 (Security must-fix items)

| # | Finding | Change | Where |
|---|---|---|---|
| 1 | **H1** History could be rewritten, then deleted | `BEFORE UPDATE` guards: a past service's `starts_at` can't move into the future (or a future one with history into the past); a past accepted assignment's `status` can't change; corrections go through `removed_at` (leader+, reason). Volunteers can't change past assignments (409). `PATCH /series` clamps `ends_on` and `from_date` to today or later. Claim reworded to "can't be deleted **or retroactively altered**". | §4.2, §4.4 |
| 2 | **H2** Level 3 and contact notes would leak through `SELECT *` | Level 3 lives in its own table `person_care_notes`; contact notes in `pickup_contact_notes`. `getPerson`, household pickup queries and `finance.js` `p.*` switch to explicit column allow-lists. The canary test becomes a **router-wide sweep**. | §3.5, §3.12, §4.3, §5 |
| 3 | **H3** The permanent PIN on a shared kiosk could approve alert children | The PIN may approve only what an offline code may (children **with no pickup alert**). Alert children need **phone approval** bound to the override. Every PIN use sends the coordinator a real-time notice. The PIN rotates every 90 days and after any "Not you?" report. The keypad shows no digits. | §3.7.1 |
| 4 | **M1** The kill switch contradicted "no override" | It **never** lifts `do_not_release`. It only turns fuzzy-name matches and `check_first` into "coordinator approval". It needs two different people (two admins, or an admin plus a coordinator) and lasts at most 4 hours. | §4.8, policy §7 |
| 5 | **M2** One admin could release a hold, delete under a permit, or confirm ending a restriction | A second, different person is needed for each. After a hold is released, backup rotation waits 7 days before deleting anything. The hold check also runs **inside the delete trigger**. Each permitted delete copies the row into `history_deletions` first. Ending a restriction is never confirmed by the person who asked for it. | §3.4, §4.2, §4.9 |
| 6 | **M3** Triggers could disappear silently; append-only tables could break user deletion; some tables unguarded | A schema invariant test checks every required trigger and the table count. New rule: any table rebuild re-creates its triggers. Append-only tables keep user, person and device ids as plain integers (no FK) plus a name snapshot. Delete guards added on restrictions, contacts, pickups and overrides; the person guard counts them. A18 marked verified. | §4.2, §4.3, §9 |
| 7 | **M4** No rotation plan for the two secrets; no key id in the envelope | Both secrets get a key id and a `_PREV` companion accepted for validation for 14 days. `kid` is in the envelope and in the HKDF info. `checkin_offline_codes.secret_kid`. Rotation and leak runbook added. | §3.7.2, §3.7.4 |
| 8 | **M5** Offline approvals weren't bound to the release they cover | The release report must cite `approval_id` and match its pickup, children, collector and kind. The envelope's device and campus must match the uploader. One approval covers one release. | §3.7.4 |
| 9 | **M6** Reports from revoked tokens had conflicting rules | One rule. Lost or stolen: every upload after the revoke is **recorded and quarantined, never applied**. Replaced or migrated: applied as reports, with an alert, **with no time limit**. "7 days" removed. | §3.7.4, §3.7.7, §3.9 |
| 10 | **M7** Tag-holder safeguards and lost-tag revocation didn't hold offline | Offline, a tag-holder release and a lost-tag release both need a coordinator's **offline day code** (the coordinator is at the desk). | §3.5, §3.7.5, §3.8 |
| 11 | **M8** Old, migrating and old-host tokens were limited only on screen | The server makes them **drain-only** after "Move" and after day 60. Verifiers, restriction data and Level 2 are served only to check-in-host tokens. Replace is refused unless the server's last recorded pending count is 0, and gives a fresh prefix if the old one was used today or yesterday. `x-station` is never accepted on the check-in host. | §3.9.2, §3.9.3 |
| 12 | **M9** Level 2 on stations couldn't be gated or logged by the server | **Chosen: fetch on tap** (option a). Level 2 is fetched online only, per child, with the server checking the operator is an adult and writing the log. Offline, Rooms shows the always-cached Level 1 safety line (allergy, EpiPen, action, where the medicine is) plus "Full note needs a connection". | §3.12, §3.8 |
| 13 | **M10** Pausing local backup pruning under a hold could fill the live database's disk | Under a hold, all **Drive** copies are kept, but local pruning carries on (keep 3) for files already safe in Drive. Without Drive, local pruning pauses, with alerts at 60% and 80%, and a hold needs an admin to acknowledge the disk risk. Disconnecting Drive is refused during a hold. | §4.9 |
| 14 | **M11** The paper fallback released on a matching number alone | Paper pickup follows the same rules: who's collecting first, the adult names the children, the tag half is kept, tag holders follow the tag-holder rules with a coordinator called, under-18 volunteers release only to the parent on the sheet. | §3.2, policy §12 |
| 15 | **M12** Hub sessions already on kiosks would survive P2 | P2 deployment step: sign out every check-in iPad. Server rule: a request carrying both a session cookie and a station credential on check-in routes ends the session (row deleted, cookie cleared, audited). | §3.9.1, III-03 |
| 16 | **L1** The family promise wasn't true offline | New wording: the server notices when the iPads are online; at any time a code only finds a family, and the volunteer still checks the collector belongs to it. | §3.2, policy §1 |
| 17 | **L2** Attendance and headcount edits were called "audited", but aren't | P1 adds `audit()` for roll-call un-marking (`attendance.unmark`) and headcount edits (old → new). Within-day edits under a hold are preserved only by the nightly backups (stated). | §4.2 |
| 18 | **L3** Policy weakened the two-person rule | "You may never approve your own request, or a release to yourself or your own family", whatever the child. | policy §10 |
| 19 | **L4** Today's code-only check-out until P4 wasn't recorded as accepted | New checklist item II-41. | §2, checklist |

**Also in revision 3:**
- The other review findings (M13, M14, L5–L21, and the Level 2 wording mismatch) are in §10 "Fix during
  implementation".
- Inconsistencies between the plan, policy and checklist are resolved: Level 2 audience, kill switch, revoked-token
  rule, PIN scope, paper rules.
- Effort is recomputed (the revision-2 total of 52 was an arithmetic slip; it was 52.5). New total: **58.5 days core**
  (§7).
- New owner decision sheet at the top of the checklist.

---

## 0. Changes in revision 2

| # | What changed | Why | Where |
|---|---|---|---|
| C1 | **Pickup codes redesigned.**<br>• Prefixes come only from server leases: a letter gives 5 characters, a digit-led pair gives 6. No random prefixes.<br>• Online codes are confirmed by the server before the label prints.<br>• Each iPad has one issuing window (Web Lock).<br>• Copied iPads are detected (`lease_epoch`).<br>• The server no longer invents codes.<br>• An iPad with no lease that is offline uses the paper kit. | R1. The revision-1 random 6-character fallback, copied iPads and auto-submit truncation could each produce clashes (Q1 §1.3). | §3.2 |
| C2 | **"Codes can never clash" replaced everywhere** by an accurate statement:<br>• codes are unique unless an iPad's stored state was copied or corrupted;<br>• that case is detected;<br>• release safety never depends on uniqueness. | R1 (Q1 §1.4) | §1, §3.2, policy |
| C3 | **A code is never the sole authorisation.**<br>• Every lookup returns every matching pickup.<br>• More than one match always goes to the careful lane: nothing pre-ticked, adult names the children first, ID, coordinator.<br>• The server refuses releases to adults not linked to the pickup. | R1 | §3.3 |
| C4 | **No legacy fallback iPad during the soak; old-app code-only releases refused once pickups are on.** The old app releases on the code alone, which R1 forbids. The fallback is now the paper kit plus a spare new-app iPad. | Technical consequence of R1, stated explicitly | §3.3, §4.6, §4.7 |
| C5 | **Tag-holder release (D5) kept, with safeguards:**<br>• physical tag required and kept;<br>• adult (18+) operator;<br>• collector at least 16 (church-set);<br>• adult names the child first;<br>• ID name and type recorded (no number) and relationship;<br>• coordinator alerted immediately;<br>• household adults notified (restricted persons excluded);<br>• coordinator daily review;<br>• new per-household "Only people on our list may collect". | R2 | §3.5 |
| C6 | **Operator identity ("Who's on this desk?") and age**: picked from today's kids-team schedule or accounts with a check-in level, with age from `people.birthdate`. A missing birthdate means the under-18 view. | R2 and R3 need adult vs teen at the desk | §3.10 |
| C7 | **Three medical levels:**<br>• Level 1, safety line: everyone serving; teens see only this.<br>• Level 2, full care note: adult helpers and above, children checked in today only.<br>• Level 3, private care notes: coordinators and admins, never sent to iPads.<br>All full-note and private-note views are logged and reviewable. | R3 | §3.12 |
| C8 | **History protection first** (new Phase 1):<br>• `BEFORE DELETE` triggers block deleting people, services, positions, campuses and teams that carry check-in or serving history, and block deleting check-ins and past accepted assignments.<br>• The routes get soft alternatives: cancel a service, archive a position, mark an assignment "removed", void a check-in.<br>• **New finding:** today `DELETE /services/:id` (staff), `DELETE /positions/:id` (leader) and `DELETE /series/:id?from=<past date>` can erase past serving records by cascade. | R4. Verified in `services.js:171-180`, `teams.js:102-110`, `series.js:181-186`, `db.js:176-180, 264-266`. | §4.2, P1 |
| C9 | **Legal hold** (`retention_holds`) before any cleanup automation. It also **pauses the existing nightly backup rotation** (`backup.js` deletes old copies today). | R4 | §4.9, P1 |
| C10 | **Retention policy drafted** and marked "requires insurer and attorney review". Purge jobs are not enabled in this plan; each is approved separately later. | R4 | §4.10, policy §9 |
| C11 | **Offline coordinator credential replaced:**<br>• 10-digit server-derived day codes per coordinator, campus and day;<br>• the iPad stores only `HMAC(K_dev, PBKDF2(code))` with a non-extractable key;<br>• an encrypted proof is sent to the server and re-checked on sync;<br>• lost-iPad runbook.<br>The personal PIN becomes **online-only** and server-generated. | R5. Security Part 1 replaces the revision-1 offline PIN hashes (High risk). | §3.7 |
| C12 | **Browser isolation:**<br>• Quick wins in Phase 2 (station token wins, no sign-in on kiosks, CSP, `frame-ancestors 'none'`, SRI, no-store).<br>• A **dedicated check-in host** (`checkin.<domain>`) in Phase 3, before codes, offline verifiers and restriction data reach iPads.<br>• Safe iPad migration ("Replace station", old host 60 days).<br>• "Coordinator signs in on the tablet" is **removed**. | R6. Security Part 2. | §3.9, P2, P3 |
| C13 | **Phases resequenced: 9 phases (+1 optional), 52 working days core.** Revision 1 had 30 days. | R4–R6 add history protection, host isolation and the crypto credential. | §7 |
| C14 | **Checklist rebuilt in three groups** (118 items in revision 2, 128 in revision 3), with decided items marked. | R7 | checklist file |
| C15 | **New section: assumptions and open items**, each with how it is resolved. | Owner request | §9 |

Revision-1 content that is unchanged is restated here, so this document stands alone.

---

## 1. Executive summary (plain English)

**What's wrong today**
- Pickup codes are 4 characters made up by each iPad on its own. At about 300 families a campus, two families get the
  same code roughly **one Sunday in twelve**.
- When that happens, the pickup screen shows both families' children with one "Check out all" button.
- There is nowhere to record "do not release to this person".
- Anyone who leads any team can open check-in and read every child's medical notes.
- The iPads keep the whole church's family list and never clear it.
- We also found that **past serving records can be deleted today**: deleting a service or a position quietly removes
  who served at past services.

**What we will build, in order**
1. **Protect history first.**
   - The database will refuse to delete, or change after the fact, check-in and serving history. Services are
     cancelled instead, positions archived, mistakes marked "removed" with a reason.
   - A **legal hold** pauses clean-up the moment a concern is raised, including deletion of old backups from Google
     Drive.
   - Releasing a hold, or any approved deletion, needs two different people.
2. **Lock down the iPads.**
   - They get their own address (`checkin.<your domain>`), separate from the staff hub. Nothing else on the website
     can read their data.
   - Nobody signs in to the hub on an iPad.
   - Each iPad is moved over carefully, without losing anything waiting to sync.
3. **Better codes, and codes are never enough on their own.**
   - Each iPad gets its own letters from the server, so codes don't repeat. If an iPad's memory was ever copied or
     damaged and a code repeats, the server notices as soon as the iPads are online.
   - **More importantly, a code only finds a family; the volunteer still checks that the person collecting belongs to
     it, by photo or ID.** If a code matches two families, the desk sees both, checks ID and calls a coordinator.
4. **Two lanes at pickup.**
   - Ordinary children move almost as fast as today.
   - Children with a pickup alert, or anything unusual, get ID checks and a coordinator.
   - Someone holding the parent's tag who isn't on the family's list can collect a child without a pickup alert, but:
     - only an adult volunteer may do it;
     - the person must be 16 or over;
     - they hand over the tag, name the child, and show ID;
     - the coordinator and the parents are told at once.
   - Families can choose "only people on our list".
5. **Pickup alerts.** "Do not release to this person" is a hard stop. "Check with a coordinator first" is also
   available. Alerts are never printed on labels.
6. **Coordinators can approve offline.**
   - Each day the hub gives each on-duty coordinator a 10-digit code. It works only on that campus's iPads, only that
     day, only while offline, and only for children without a pickup alert.
   - Offline, tag-holder and lost-tag pickups need this coordinator code too.
   - Every use is checked by the server later and reported to the coordinator.
   - A coordinator's personal PIN works only online, only for children without a pickup alert, and they are told
     every time it is used. Children with a pickup alert need the coordinator's own phone.
7. **Medical information in three levels.**
   - A short safety line (allergy, EpiPen, what to do, where the medicine is) goes to everyone serving, including
     teens. It is always on the iPad, even offline.
   - The full care note is shown to adult helpers only for children here today, fetched from the server when they
     tap, while online.
   - Private notes are for coordinators only, kept in a separate place, and never go on an iPad.
   - Every time someone opens a full or private note, the server logs it.
8. **Retention.** We keep safety records long-term. A draft policy says what could be trimmed later (for example,
   one-time pickup people's phone numbers). **Nothing is deleted automatically** until the church's insurer and
   attorney have reviewed the policy and the owner approves each clean-up job.

**Cost and time**
- About **58.5 working days** of build and testing in 9 pull requests, plus an optional 3.5-day add-on for adding
  first-time families offline.
- About **5–5½ months** on the calendar, with trial Sundays, visits to each iPad and a Christmas freeze.
- Until the new pickup flow is switched on (about 10–13 weeks in), today's code-only check-out continues, with one
  extra guard against codes that match two families.
- No new software packages and no paid services.
- The owner needs to provide a subdomain (DNS).

---

## 2. Owner requirements (R1–R7) and how they are met

| Req | Met? | Notes |
|---|---|---|
| R1 codes | **Yes, with two consequences.** | (1) A legacy fallback iPad can't be used during the soak, because the old app releases on the code alone. Old-app *live* check-outs are refused once pickup sessions are on (refused attempts are still recorded). (2) Before pickup sessions are on (P1–P3, about 10–13 weeks), today's code-only flow is the status quo, with only the Phase 2 ambiguity guard added. **The owner accepts this explicitly in checklist item II-41.** The paper kit follows R1 too (§3.2, policy §12). |
| R2 tag holder | **Yes.** | Needs operator identity and age (C6). Household notifications need the household's adults to have app accounts; coverage measured in Phase 0 (A13). |
| R3 medical | **Yes.** | "Adult" at a shared iPad is self-attested in default mode (picked from the schedule). Strong confirmation from the volunteer's own phone is a setting (I-27). Level 2 is **fetched on tap**, online only, with the server checking the operator the desk names (self-attested, N5) and writing the log (M9 option a). Offline, the always-cached Level 1 safety line covers the life-critical part. Level 3 is in its own table and never leaves the hub. |
| R4 retention | **Yes.** | Chosen method: **triggers, not a table rebuild** (§4.2), guarding deletes **and** the edits that would defeat them (H1). This changes existing behaviour for deleting or retiming past services, positions and assignments; listed for approval (II-02). |
| R5 offline credential | **Yes.** | iPad timing is an estimate. Phase 0 measures it on the slowest real iPad, falling back to 310,000 iterations (A1). |
| R6 isolation | **Yes, if** Render accepts a second custom domain on the existing service and the owner provides DNS (A4, A5). Otherwise only quick wins apply, and the offline-credential residual risk stays Medium (§3.7.9). | |
| R7 checklist | **Yes.** | 128 items (revision 3), with an owner decision sheet. |

---

## 3. Final design

### 3.1 Principles
1. A code **selects candidates only**. The server checks every release, request or report, for consistency against
   the pickup's household, contacts, restrictions and recorded verification, and records it. Desk attestations ("tag
   kept", "ID checked", "age confirmed", the operator pick) are recorded as attested; the server checks they are
   present and consistent, not that they are true.
2. **Fast lane for ordinary children, careful lane for anything unusual.** The lane is chosen by data, never by the
   volunteer.
3. **The server never drops a check-in or a reported release.** It records it, flags it and alerts.
4. **Fail closed where a child is at risk**: restrictions, ambiguity, a stale offline safety list. It stays operable
   through a coordinator.
5. **Additive data only; history can't be deleted; enforcement is never behind a flag.**
6. One shared pure rules module, `checkin-rules.js`, used by the iPad and the server:
   - `codeLength`, `normaliseCode`, `pickupCode`
   - `laneFor`, `canRelease`, `medicalView`
   - Inputs (`today`, `random`, `operator`) are passed in, so it can be tested.

### 3.2 Pickup codes (adopted from Q1 §1.7)

**Alphabet:** 27 characters, `346789ABCDEFGHJKMNPQRTUVWXY` (6 digits and 21 letters).

**Format: the first character decides the length.**
- **Letter prefix + 4 random characters = 5**, shown as `K 7Q3M`.
- **Digit-led two-character prefix + 4 = 6**, shown as `7K 3Q4M`. There are 162 of these. They are used after a
  campus has 21 leased devices, for backup prefixes, and for server-issued codes (prefix `99`).
- Legacy 4-character codes are looked up **only with Find** while legacy rows exist.
- Auto-submit happens at 5 if the first character is a letter, and at 6 if it is a digit.
- Characters outside the alphabet are rejected with a hint, never silently mapped.

**Every code comes from a server lease. Nothing is ever made from a random prefix.**
- Each campus has **182** leasable prefixes (21 letters plus 161 digit-led pairs). `99` is reserved for
  server-issued codes and is never leased.
- The lease comes **with pairing**. Signed-in check-in on kiosks is removed (§3.9). If the owner keeps signed-in
  laptops on the hub host (I-04), their lease comes with that sign-in, max 2 per user.
- Each lease carries:
  - a primary prefix
  - a digit-led backup prefix
  - `valid_until` (today + 14 days, renewed on every online contact)
  - `lease_epoch`
- An expired lease never issues a code.
- A prefix is reassigned only after it was released, or `valid_until` passed more than 7 days ago, **and** no pickup
  with that prefix exists at the campus today or yesterday. It is never reassigned on a day it was used.

**Online check-in: the server confirms the code before the label prints.**
1. The iPad sends the pickup.
2. In one SQLite write transaction, the server checks `(campus, code)` against open pickups for today and yesterday,
   then inserts it.
3. If the code is taken, the server returns `409 code_taken`. The iPad redraws, and nothing has printed.
4. If there is no answer within 1.5 s, the iPad prints its own lease code and uploads it later.
5. A device online with no free prefix gets server-issued `99` codes in the same transaction, and can't check in
   offline.

**Offline check-in**
- Only with a valid lease obtained online.
- The suffix comes from `crypto.getRandomValues`. It is checked against the device's issued codes for **today and
  yesterday**, for both prefixes, whatever the device clock says.
- The code, the issued list and the queue entry are written in **one IndexedDB transaction** before printing. If the
  write fails, nothing prints and the screen says "Use the paper kit".
- If the issued state looks unreliable (the list is unreadable, or today's queue has records with no issued list), the
  device switches to its **backup prefix** for the day and flags `backup_prefix`.
- **No lease and offline:** "This iPad can't check in until it has been online. Use another iPad or the paper kit."
  Paper pads are pre-numbered with a desk letter, so paper numbers never repeat.
- **Paper releases follow R1 (M11):** a matching number only finds the family.
  - Ask who is collecting first; the adult names the children; the tag half is kept.
  - Without a coordinator, only the parent or adult written on the sheet, or a listed adult, may collect.
  - Anyone else is a tag holder: an adult volunteer, the ID name and type written on the sheet, and the coordinator
    called before release.
  - Volunteers under 18 release only to the parent written on the sheet.
  - Full text in policy §12.

**One issuing window per iPad.**
- Check-in holds the Web Lock `mb-checkin-issuer` (`navigator.locks`). Where that isn't available, a BroadcastChannel
  plus a heartbeat is used instead.
- A second window opens Rooms and check-out only, and says "Check-in is open in another window".

**Clone detection.**
- `lease_epoch` increases on every online contact, and the device stores the new value.
- A request with an older epoch after a newer one was used triggers:
  - a `lease_cloned` event and an urgent alert
  - both copies moved to new prefixes
  - that prefix's open pickups for today and yesterday flagged `conflict` (careful lane)
- The station-cookie rotation (§3.9) gives the same signal.

**Server backstop on sync.**
- Triggered when: the prefix isn't leased to the uploader, the epoch is stale, or the code matches another open pickup
  today or yesterday.
- Result: both pickups get `conflict = 1`, a `code_conflict` event is written, and one de-duplicated alert is sent.
- The server **never changes a code a parent holds**. A coordinator may reissue.

**The server never invents a code.**
- An upload with no code becomes a `code_unknown` placeholder, which only a coordinator can release.
- The `securityCode()` call in `server/routes/checkin.js:71` is removed.

**Accurate promise (use this wording everywhere):**
> Each iPad has its own letters, so codes don't repeat. If an iPad's memory was copied or damaged and a code ever
> repeats, the server notices as soon as the iPads are online. At any time, a code only finds a family: the volunteer
> still checks that the person collecting belongs to that family, with their photo or ID, before anyone leaves.

(When both copies of a cloned iPad are offline, each may show only **one** family for a repeated code. Safety still
holds, because one match is never proof: the collector must match that pickup's adults by photo or ID, or go through
the tag-holder steps, which offline need a coordinator's day code.)

### 3.3 Pickup sessions and check-out

**Pickup session** (`checkin_pickups`): one household, one tag, one day, one campus.
- The **server derives `household_id` from the children**.
- A child from another household gives `mismatch` (coordinator only).
- A re-sent pickup with a different campus, day, code or household is refused per record and logged; the original is
  unchanged.
- An unknown pickup becomes a `code_unknown` placeholder.
- Old-app uploads become server-made pickups (`origin = 'server'`) when `checkin_pickups` is on.
- The same child open twice gets `duplicate_of`: counted once, and releasing either row closes both.

**Lookup rules (release safety never depends on uniqueness)**
1. A lookup returns **all** open matching pickups. That covers today plus yesterday's still-open pickups, legacy rows,
   and pickups flagged `conflict`, `mismatch`, `code_unknown` or `lease_cloned`.
2. **More than one match always goes to the careful lane.**
   - Banner: "This code matches 2 families."
   - Families side by side, children **unticked**.
   - "Who's collecting?" first, and the adult must belong to exactly one family (photo plus ID).
   - The adult **names the children before they're shown**.
   - The volunteer ticks child by child, checking label initials and time against the tag.
   - Coordinator approval (`conflict`).
   - The iPad never chooses between families.
3. **One match is not proof.** The adult must be a household adult or contact **of that pickup** (photo match). The
   only other routes are a Tier B tag holder (§3.5) or a coordinator.
4. **The server checks every release for consistency**, request or report, and records it:
   - `released_to_ref` is linked to the pickup's household for those children; or
   - the kind is `tag_holder` with tag kept, ID checked, age confirmed and an adult operator recorded (attested at the
     desk), and, offline, an offline day-code approval; or
   - it is an approved override.
   - Otherwise a live request gets 409, and a report becomes `release_violation` with an urgent alert.

**Lane** (`laneFor`)
- **Fast:** no child has an active restriction, the pickup is unflagged and has a single match, and the safety list is
  fresh.
- **Careful:** everything else, including households set to "list only" when the collector is not on the list.

**Fast-lane check-out**
1. Code auto-submits.
2. One family card appears, children **pre-ticked**, each with photo, first name and room. The volunteer matches each
   child's label and unticks anyone staying.
3. "Who's collecting today?" The adult says their name, and the volunteer taps their photo tile. A single known adult
   shows as "Yes, that's them".
4. Tiers:
   - **Tier A, no extra step.** A household adult on file (more than 14 days, not added by a station or helper) or a
     standing contact, with a matching photo.
   - **Tier B, an adult operator, no coordinator, recorded:**
     - Known adult with no photo: ID tick. "Remember ID seen" lasts 12 months.
     - Tag holder not on the list (§3.5).
     - Lost tag. "No tag?" searches by the adult's own name or phone. The adult names the children. Allowed only for a
       household adult on file, with photo or ID. The code is revoked, and children still in rooms get a reissued tag.
       **Offline (M7),** a lost-tag release needs a coordinator's offline day code, because the revocation can't
       reach the other iPads.
     - Newly added household adult: ID tick.
     - Teen operators can do Tier A only. For anything else they press "Get an adult helper".
   - **Tier C, coordinator:**
     - lost tag for anyone else
     - "ID doesn't match" (one red button)
     - a revoked code presented
     - `mismatch` or `code_unknown`
5. Targets, timed in QA: Tier A ≤ 8 s, Tier B ≤ 20 s.

**Careful-lane check-out**
- Red banner at the top: restricted names, photo if linked, station note. Children start **unticked**.
- "Who's collecting?" first. The restricted person's tile is greyed out "Not allowed". A typed name that
  fuzzy-matches a restriction is treated as `check_first`.
- **ID check and photo match for every release**, household adults included.
- `do_not_release` to the named person is a **hard block with no override**. The screen says "Do not release. Keep the
  child with you. Press Alert coordinator. Stay calm." The **Alert coordinator now** button sends an urgent
  notification.
- `check_first`, `court_order` (anyone other than the named person) and anything else for a child with a pickup
  alert need **phone approval** from a coordinator (§3.7). The PIN and the offline day code can't approve these.
- Conflicts and mismatches for children with no pickup alert can be approved by phone, PIN or (offline) day code.
- **The requester can never be the approver**, whatever the child.

**Always on (no flag):**
- the pickup binding
- live requests are all-or-nothing
- restriction checks on every path
- already-released rows are a no-op that keeps the first release (`duplicate_release` alert)
- **undo release**: coordinator, within 30 minutes, with a reason
- **void instead of delete**: coordinator, open rows only, reason required; stations get 403

### 3.4 Custody, do-not-release, check-first

**`pickup_restrictions`**, one row per child:
- `kind`: `do_not_release` | `court_order` | `check_first`.
- `basis`: `court_order_on_file` | `parent_request`.
- Named person: a forced directory link when the name matches someone, or a name only.
- Optional dates, in the campus time zone, inclusive.
- `station_note`: up to 120 characters ("who to call, not why").
- `details`: coordinators and admins only. Never in audit text, notifications, search, exports or the roster.

**Rules**
- Creating or strengthening a restriction takes effect immediately.
- **Ending or weakening** sets `pending_end` until a **different** coordinator or admin confirms. It is never
  confirmed by the person who asked for the end, and never by anyone in the child's household (M2).
- Restrictions can't be deleted (permit-only delete guard, §4.2); they are only ended.
- Every change notifies the campus's coordinators and admins, with generic push text.

**Alerts and review**
- A restriction added for a child who is **in a room now** sends an urgent alert to the desk.

**Where alerts show**
- Check-in banner, check-out and Rooms banners, and the hub "Kids safety" card.
- A printed daily sheet.
- **Never** on labels or tags, in push text, or to unflagged accounts.
- Pickup alerts can be switched on **only in `explicit` mode**, and only once every iPad has moved to the check-in host
  (§3.9).

**Staff tools**
- A quick 3-field form for phones, with household-level entry.
- A weekly list of alerts that are about to expire.
- Coordinator incident notes.

### 3.5 Authorised contacts, tag holders, "list only", verification

**Authorised contacts**
- `household_pickups` is extended:
  - a directory link or a photo
  - `child_ids` scope (NULL = all children; malformed values fail closed)
  - dates, `id_required`
  - created by and at
  - **archive instead of delete** (and a permit-only delete guard)
- Coordinator-only contact notes live in a **separate table**, `pickup_contact_notes`, so no `SELECT *` on
  `household_pickups` can reach them (H2). Pickup queries in `people.js:116` and the roster use explicit column
  allow-lists.
- Contacts for a household with a restricted child can be changed by coordinators only.

**Household adults "on file":** `people.household_set_at` is NULL (they existed before this change), or more than 14
days old and set by staff. Otherwise the adult is "not yet known".

**One-time pickup person at check-in**
- An optional link. The adult checking in is tapped from the authorised list first.
- Records name, phone and relationship, valid only for that pickup's children, expiring at the campus's end of day
  (set by the server).
- ID is always checked at pickup.
- For a restricted child: coordinator only.
- In a "list only" household, a person added by the parent at check-in counts as on the list for that day.

**Tag holder not on the list (D5, R2)**
1. Only for children with **no pickup alert**, in a household **not** set to "list only".
2. **The physical tag is required and kept.** The operator ticks "Tag handed over". Photos, screenshots and written
   codes are refused.
3. **The operator must be an adult (18+)**, using operator identity (§3.10). A teen sees "Get an adult helper".
4. **The collector must be at least the church's minimum age** (setting `checkin_collector_min_age`, default 16). It is
   checked on the ID; the operator ticks "Age confirmed". Anyone younger needs a coordinator, who must reach a
   household adult.
5. **The adult names each child before any child is shown.** The card stays hidden behind "Names given ✓".
   Babies and children who don't speak: the room leader watches that the child recognises the adult (on-screen
   prompt).
6. **Record:**
   - the name as printed on the ID
   - the ID type (driver's licence, passport, state ID, other)
   - "matches the person in front of me"
   - relationship (pick-list)
   - operator, device, time
   - **no ID number**
7. **The on-duty coordinators get an immediate push**: "Tag-holder pickup at North Desk 1". No names in the push; names
   are on the Live page.
   - **Offline (M7):** a tag-holder release needs a coordinator's **offline day code** at the desk. The coordinator
     is then present, which meets "alerted immediately". The household message goes out when the iPad syncs.
8. **The household's adults are notified straight after**, by push and inbox, through the existing free channel:
   "Mia was collected at 11:52 by Jane Smith (Grandmother). Not expected? Call [coordinator on duty]."
   - **Anyone named in a restriction on that household's children is excluded**, even a household adult.
   - Households where no adult has an account get no message. The coordinator's daily review covers them (A13).
9. **Daily review:** "Today's tag-holder pickups" on the Live page must be ticked "reviewed" by a coordinator by the
   end of the day. Anything unreviewed reminds the admins the next morning.
10. **Pattern alerts:** a second tag-holder release in the same household within 30 days, or the same collector name
    across several households.

**"Only people on our list may collect"**
- New setting `households.pickup_list_only`. Staff or a coordinator sets it at a parent's request, and it is audited.
- **Effect:** a tag holder or anyone not on the list goes to the careful lane. The behaviour depends on
  `households.list_only_mode`:
  - **`coordinator` (default):** a coordinator approves **only after speaking to a household adult by phone**. The
    adult's name and the time are recorded. If no household adult is reached, the child is **not released** and stays
    with the room leader.
  - **`refuse` (family's choice):** nobody outside the list can collect. A coordinator can't override. A household
    adult must come, or add the person through staff first.
- Household adults and standing contacts still use the fast lane. Lost tags for household adults on file stay Tier B.
- **Offline:** a "list only" household's not-on-list release can't use an offline day code. It waits for a
  coordinator with a phone signal.

**ID check policy** (`checkin_id_check = 'unrecognised'`). An ID check is needed for:
- no photo, unless ID was seen in the last 12 months
- an adult who is "not yet known"
- contacts marked `id_required`
- one-time people and tag holders
- lost tags
- restricted children
- conflicts

**Photos for stations:** `GET /api/checkin/photo/:person_id`, limited to people in **today's open pickups** at that
campus (children, household adults, contacts), rate-limited, with `Cache-Control: no-store, private` (L11). Photos are cached on the iPad only for the day, in the check-in host's Cache
Storage, and purged.

### 3.6 Permissions
**Per-account check-in level:** `users.checkin` = `''` | `helper` | `coordinator`.
- Only admins grant coordinator. It is audited and notified.

**Access mode:** `checkin_access` = `leaders` | `explicit`.
- `leaders` is today's behaviour, except that restriction data and day-code verifiers are never sent.
- Pickup alerts need `explicit`, and the server enforces this.

**Guard:** `requireCheckin(level)`.
- It handles stations first: a station counts as a helper at its own campus, for today only.
- Campus limits apply.
- Station `user.id` is null, and that is handled everywhere.

| Capability | Teen operator | Adult helper / station with adult operator | Coordinator | Admin |
|---|:-:|:-:|:-:|:-:|
| Check in; Tier A release; Rooms with Level 1 | ✓ | ✓ | ✓ | ✓ |
| Tier B (tag holder, lost tag, ID tick) | | ✓ | ✓ | ✓ |
| Level 2 full care note (children checked in today; fetched on tap, online; server-checked and logged) | | ✓ | ✓ | ✓ |
| Level 3 private care notes (hub only), logged | | | ✓ | ✓ |
| Restriction names and station note | ✓ | ✓ | ✓ | ✓ |
| Restriction details; add a restriction; contacts of restricted households | | | ✓ | ✓ |
| Confirm ending a restriction | | | ✓ (not own household) | ✓ |
| Approve overrides (alert children: phone only); reissue tags; undo; void; review tag-holder list | | | ✓ | ✓ |
| Grant levels; legal holds; relaxation switch; history-delete permits (each two-person, §4.2, §4.8, §4.9) | | | (second person for the relaxation switch) | ✓ |

Teens see restriction names and notes because the hard block must be visible to whoever is at the desk.

### 3.7 Coordinator credentials (adopted from Security Part 1)

**Three approval routes:**
1. **Phone:** the coordinator's own signed-in hub app or Live page (online), bound to the override id. **The only
   route for any child with a pickup alert.**
2. **Online personal PIN** typed on the iPad and checked by the server. Children with no pickup alert only.
3. **Offline day code** typed on the iPad and checked on the iPad. Children with no pickup alert only (§3.7.5).

There is no hub sign-in on kiosks (§3.9).

#### 3.7.1 Online personal PIN
- **8 digits, generated by the server**, never chosen by the coordinator (no reuse risk). Shown once in the hub, and
  can be regenerated.
- Stored as a scrypt hash, using the same parameters as passwords (`auth.js`: N=16384, r=8, p=1, 16-byte salt,
  32-byte key). Verified with **async** `crypto.scrypt`, so the event loop isn't blocked (L17).
- Accepted **only** by `POST /checkin/pin-verify` on the server, and **never sent to any device**.
- **Scope (H3):** a PIN may approve **only the kinds an offline day code may approve** (§3.7.5), meaning children
  with **no pickup alert**. For a child with any pickup alert (`check_first`, `court_order`, `pending_end`, a fuzzy
  name match) the server answers 409 "Phone approval needed".
- **Real-time notice:** every PIN approval sends the coordinator a push and inbox message in the same request
  ("Approved with your PIN at North Desk 2, 10:42. Not you? Tap to report"). PIN approvals count in the weekly digest.
- **Rotation:** automatic every 90 days ("Generate a new PIN" after that), and immediately after any "Not you?"
  report.
- **Entry:** the keypad shows no digits (dots only, no echo) and has a privacy cover.
- **Rate limits:**
  - Per coordinator per station: progressive delay of 1/2/5/10 s. After 10 failures in 10 minutes, blocked on that
    station for 15 minutes, with an alert.
  - Per coordinator across all stations: 30 failures an hour pauses PIN entry for 1 hour.
  - Per station across coordinators: 30 failures an hour pauses that station for 15 minutes.
  - **No account lockout.** Phone approval is never blocked.
- A PIN can't sign in to the hub.

#### 3.7.2 Offline day code: generation (server)
**Secrets** (Render environment variables only, never logged or returned):
- `MB_CHECKIN_CODE_SECRET` = `<kid>:<32 random bytes, base64>`.
- `MB_CHECKIN_SYNC_KEY` = `<kid>:<P-256 private key, PKCS#8 PEM>`.
- **Previous keys (M4):** `MB_CHECKIN_CODE_SECRET_PREV` and `MB_CHECKIN_SYNC_KEY_PREV`, each with its own kid.
  - They are accepted **only for validating envelopes**, for 14 days after a rotation. That is twice the 7-day
    outage window.
  - They are never used to issue codes or verifiers.
- If either current secret is missing, **offline codes are off** (fail closed).
- Both, and their `_PREV` companions, are added to the README settings list.

**Rotation and leak runbook (M4):**
1. **Planned rotation:**
   - Generate the new value.
   - Set it as current with a new kid, and move the old value and kid to `_PREV`.
   - Bump every live `gen`, so new codes and verifiers are issued under the new secret.
   - Remove `_PREV` after 14 days. **The rotation time is recorded (N8):** the admin records each rotation in Settings (kid and time, stored in `settings`), and the server accepts `_PREV` only within 14 days of that recorded time, because it can't tell when an environment value was set.
2. **Suspected leak** of either secret, or of a backup together with the secret: do a planned rotation **and** treat
   today's codes as compromised. That means "Rotate today's codes" for every campus, coordinators told, and an
   incident logged.
3. Never paste either value into chat, tickets or logs.

**Table:** `checkin_offline_codes(id, user_id, campus_id, day, gen, secret_kid, nonce BLOB(16), issued_at, rotated_at, rotated_by, rotate_reason)`,
unique `(user_id, campus_id, day, gen)`, with `nonce = crypto.randomBytes(16)`. Validation rebuilds the code with the
secret named by `secret_kid` (current or `_PREV`).

**Derivation:**
```
mac  = HMAC-SHA256(MB_CHECKIN_CODE_SECRET,
         "mb-offline-code-v1\0" || user_id || "\0" || campus_id || "\0" || day || "\0" || gen || "\0" || nonce)
code = (first 8 bytes of mac as unsigned 64-bit) mod 10^10, zero-padded to 10 digits   // bias ≈ 5·10⁻¹⁰
```
The code is never stored. Rebuilding it needs both the database nonce and the environment secret.

**Format:** 10 decimal digits, shown as `483 291 7706`, with no check digit. That is 33.2 bits.

**Issuing:**
- Only to coordinators and admins **listed on the duty rota** (`checkin_duty`) for that campus and day.
- Available from 18:00 the day before until 23:59 on the day, in the **campus** time zone.
- `GET /checkin/my-offline-code`:
  - `no-store`
  - needs a session signed in within the last 12 h
  - writes the audit event `offline_code.view` without the code
- **Never** sent by email, SMS, push, inbox or logs.
- Masked until **Show** is tapped, and re-masked after 60 seconds. No copy button.
- Opt-in "keep on this phone until midnight".

#### 3.7.3 Verifier on the iPad
**Server side**, for each (device, coordinator, day, gen), sent only to `explicit`-mode stations **on the check-in
host** (§3.9.3) at that campus, whenever they are online, from 18:00 the day before. That includes outside check-in
hours, so an iPad that boots offline on Sunday still has them (L12, A28). Admins get verifiers only when they are on
the rota.
```
salt = crypto.randomBytes(32)
S    = "mb-oc-v1\0" || device_id || "\0" || user_id || "\0" || campus_id || "\0" || day || "\0" || gen || "\0" || salt
V    = PBKDF2-HMAC-SHA256(ASCII(code10), S, c = 600000, dkLen = 32)   // async crypto.pbkdf2; dkLen must stay 32
```
- The server keeps `checkin_offline_verifiers(device_id, code_id, salt, iter, issued_at)`. V itself is not stored; it
  can be recomputed.
- Estimated server cost: about 100 ms each, about 6 s of CPU a day (measured at 108 ms in Security's environment).
- The response is `no-store` and never cached by the service worker.

**iPad side.** At pairing, the iPad creates a key that can't be read back:
```
K_dev = crypto.subtle.generateKey({name:'HMAC', hash:'SHA-256', length:256}, false, ['sign'])
```
- K_dev is stored in IndexedDB `mb-checkin-secure`, store `keys`.

When a verifier arrives:
- The iPad computes `W = HMAC(K_dev, V)` and stores `{user_id, display_name, campus_id, day, gen, salt, iter, W, valid_from, valid_until}` in the `approvers` store.
- **V is discarded at once.** Plaintext codes, V, V′ and W′ exist only in memory.

**Verifying a typed code:**
1. The coordinator taps their name, so only one record is tried.
2. Check the lock state and the clock window, including the high-water clock.
3. Compute `V′ = deriveBits(PBKDF2, code, S, iter, 256)`, then `W′ = sign(K_dev, V′)`.
4. Compare all 32 bytes with no early exit.

**Iterations:**
- 600,000 (current OWASP guidance).
- **Estimate:** 0.15–0.3 s on an A10/A12 iPad (this is an estimate, not a measurement).
- **Phase 0 measures** 5 attempts on the slowest real desk iPad. If the median is over 800 ms, use **310,000**.
- `iter` travels with each record, so it can change without a release.

**What the non-extractable key does and does not do:**
- **Does:** page script can never read the key bytes.
- **Does not:** it does not stop a script running on the iPad from *using* the key, and the Keychain wrapping is a
  WebKit implementation detail with no guarantee.
- **It is treated as defence in depth only.** The brute-force figures below assume the attacker has the key.
- A script running in the check-in origin when verifiers download can capture **V** itself, which can be tested
  offline without K_dev. So K_dev gives no protection against that attacker (A4); the check-in host (§3.9) and CSP
  are what keep such scripts out (L8).
  - Optional hardening during implementation: deliver V wrapped to a device ECDH key and `unwrapKey` it straight
    into a non-extractable HMAC key, so V never reaches JavaScript.

#### 3.7.4 Proof on sync (encrypted envelope)
```
E   = canonical JSON {v:1, approval_id(128-bit random), device_id, seq (per-device monotonic), user_id, campus_id,
      day, gen, kind, child_ids (sorted), pickup_id, released_to_ref|released_to_name, operator_name, client_at}
eph = ECDH P-256 key pair (non-extractable, never stored)
Z   = ECDH(eph.private, SERVER_PUB[kid])     // SERVER_PUB and its kid from GET /checkin/station
k   = HKDF-SHA256(Z, salt = eph.public raw, info = "mb-oc-envelope-v1\0" || kid) → AES-256-GCM key
ct  = AES-256-GCM(k, iv = 12 random bytes, plaintext = ASCII(code10), AAD = SHA-256(E))
outbox entry = { E, env: { kid, eph_pub, iv, ct } }
```
- The envelope is randomised public-key encryption, so it gives an attacker **no new value to test guesses against**.
- Because `kid` is in the HKDF info, a wrong or tampered `kid` fails to decrypt instead of selecting a key silently.
- The server hashes the **received** `E` string (not a re-serialisation), and rejects points that aren't on the
  curve; Node's `ECDH.computeSecret` validates them (L10).

**The release report that uses an approval (M5):**
- It must cite `approval_id`.
- Its `pickup_id`, `child_ids` (as a set), `released_to_ref` or `released_to_name`, and `kind` must **equal** those in
  `E`.
- **Each `approval_id` covers exactly one release report.** A second report citing it is a `release_violation`.

**Server checks on sync.** Any failure means `offline_approval_invalid` (critical); **the event is still recorded**.
1. **Station:** follows the single revoked-token rule in §3.9.4.
   - Token valid: continue.
   - Revoked as **lost or stolen**: recorded and **quarantined, never applied**, whatever `client_at` says.
   - Revoked by **replacement or migration**: applied as a report, with an alert, with no time limit.
   - **`E.device_id` must equal the authenticated station, and `E.campus_id` its campus (M5).**
2. **Envelope:**
   - `kid` is current or `_PREV` (within 14 days)
   - it decrypts
   - the AAD equals `SHA-256(E)` over the received string
   - the code equals the code rebuilt with the secret named by `secret_kid` (`timingSafeEqual`)
3. **Generation:**
   - `gen` is current
   - or the code was rotated after the device's last contact (accepted, `rotated_offline`)
   - otherwise critical
4. **Time:**
   - `client_at` falls on `day`, inside the validity window
   - it is no earlier than the device's **last server contact before this sync** minus 5 minutes, and no later than
     the upload plus 5 minutes (L9)
5. **Sequence:**
   - the client uploads in `seq` order, and the server sorts each batch by `seq` before checking (L9)
   - `seq` is strictly increasing; gaps are flagged
   - duplicate `approval_id`s for the same envelope are ignored
5a. **Binding (M5):** the release report citing the approval matches `E` exactly, and no other report has used this
   `approval_id`. Otherwise `release_violation`.
6. **Kind:** re-check allowed kinds against the restrictions in force at `client_at`. If not allowed:
   `release_violation`.
7. **People:**
   - the approver was a coordinator at that campus at `client_at`
   - not the requester, the released-to person, or in either household
8. **Rate:** within the daily cap.
9. **Notify:** **always** notify the approving coordinator ("You approved an offline release at North Desk 2, 10:42,
   1 child. Not you? Tap to report."), and include it in the weekly digest.

#### 3.7.5 What an offline code may approve
| Kind | Offline code |
|---|---|
| Stale safety list (> 180 min or another day) for a child with no pickup alert | ✓ |
| `lost_tag_c` for a child with no alert (code revoked) | ✓ |
| `lost_tag_offline`: a Tier B lost-tag release while offline (M7) | ✓ (required offline) |
| `tag_holder_offline`: a tag-holder release while offline, child with no alert, household not "list only" (M7) | ✓ (required offline) |
| `conflict`, `mismatch`, `code_unknown` for children with no alert | ✓ |
| Anything for a child with **any** pickup alert | ✗ (phone, or a coordinator on a hotspot) |
| "List only" household, not-on-list collector | ✗ |
| `check_first` to the named person, `court_order`, `id_mismatch`, `not_on_list_restricted`, `revoked_code` | ✗ |
| `do_not_release` | ✗ (never, by anyone) |

#### 3.7.6 Limits
**On the iPad:**
- Per coordinator per iPad: 5 failures lock that coordinator for 15 minutes. The lock persists, and setting the clock
  back by more than 2 minutes keeps it until the iPad is online.
- Per iPad: 20 failures a day stops all offline approvals ("Use the paper process or call") and syncs a `pin_failure`
  alert.
- At most **10 accepted offline approvals per coordinator per iPad per day**.

**On the server:**
- Day codes are **never accepted online**. A router sweep proves it.
- 3 invalid envelopes from one device in a day quarantines it: no new verifiers, reports still recorded, admins
  alerted.

**Expiry and rotation:**
- Validity is from 05:00 to 23:59 on the day, in the campus time zone. It can be narrowed to check-in hours plus 2 h.
- Codes rotate:
  - daily, automatically
  - by hand ("Rotate my code" / "Rotate today's codes" for a campus)
  - **automatically when a station is revoked as lost or stolen**
  - when a coordinator's flag is removed or their account disabled
- Rotation means `gen+1` and a new nonce. `offline_codes_version` is pushed through `/checkin/changes`, and iPads
  that are online drop old verifiers within about 45 s.
- **Residual window:** an iPad that stays offline keeps the old verifier until it reconnects. Approvals made in that
  window are flagged `rotated_offline`.

**iPad storage:**

| Item | Where | Never |
|---|---|---|
| K_dev | IndexedDB `mb-checkin-secure/keys` | exported |
| Verifier records (W) | `mb-checkin-secure/approvers`, keyed by campus, day and user | localStorage, the roster, the service-worker cache |
| Locks and counters, high-water clock | `mb-checkin-secure/limits` | — |
| Envelopes | outbox v2 (IndexedDB `mb-checkin-outbox`) | plaintext code |

- The secure stores are cleared on: a new day (`max(now, high-water)`), expiry, unpair/revoke/re-pair (K_dev too), a
  rotation push, or leaving explicit mode.
- **The outbox and queue are kept** until they have been sent.

#### 3.7.7 Lost or stolen iPad: aim to contain within 15 minutes
| Time | Who | Action |
|---|---|---|
| T+0 | Anyone | Tell a coordinator. |
| T+2 min | Coordinator or staff | Stations → **Revoke, reason "Lost/stolen"**. The token is refused on its next request. If the iPad ever connects, it wipes the roster, verifiers and K_dev. **Everything it uploads after the revoke is recorded and quarantined, never applied**, whatever time it claims. A coordinator reviews and applies items by hand. |
| T+2 min | Server (automatic) | Rotates the campus's day codes for today and tomorrow, and notifies that campus's coordinators. |
| T+5 min | Admin | MDM Lost Mode, then Erase (or Find My on the church Apple ID). |
| T+10 min | Coordinator | "Since last sync" report for the device (last contact, its pending counts, today's uploads), plus a room headcount compared with open check-ins. |
| T+15 min | Admin | Log an incident. What the device held depends on the phase (L21):<br>• before P7: every in-scope family's `medical_notes` and phones, as today<br>• from P7: children's names, allergies and Level 1 safety lines, and the last 4 digits of phones; no Level 2 (fetched on tap, not cached)<br>Ask the insurer or attorney whether notification is required (A6). |

Online PINs never need resetting, because none were on the device.

**Coordinator phone or account compromised:**
1. Disable the account (`users.active = 0`), which ends sessions.
2. Day codes rotate automatically.
3. Remove the coordinator level and regenerate the PIN.
4. Review their last 30 days of approvals.

#### 3.7.8 Brute-force estimates
These are **estimates** from public hashcat benchmarks plus one CPU measurement.
- GPU rate: about 15,000 guesses/s for one RTX 4090 at 600k iterations.
- **10-digit code:** about 7.7 days with one GPU, about 2.1 years on a 16-core CPU, about 2.9 h on 64 rented GPUs
  (about US$75).
- Through the UI: at most 20 guesses per iPad per day, a 2·10⁻⁹ chance.
- Through the server: 3 envelopes per device per day, about 3·10⁻¹⁰.

#### 3.7.9 Residual risk (owner accepts)
> If someone gets hold of a check-in iPad **and** can run code on it or copy its storage including the system
> keychain, **and** spends about $75 renting computers, they could work out a coordinator's offline code within a
> few hours. With it they could, **only on that campus's iPads, only while those iPads are offline, and only that
> day**, approve releases for children who have no pickup alert (lost tags, code mix-ups, an old safety list). They
> could never release a child with a pickup alert, a "list only" household's child to someone off the list, or
> override a do-not-release. Every such approval is checked when the iPad reconnects, and the real coordinator is told
> straight away.

- **Rated Low** with the device policy (I-46) and the check-in host (§3.9).
- **Rated Medium** without the host.
- At the 310,000-iteration fallback, the attacker's cost roughly halves: about $37 and about 1.5 h on 64 rented GPUs
  (L7).
- The online PIN can't approve alert children at all (§3.7.1), so it doesn't widen this risk for them.

### 3.8 Offline behaviour
| Situation | Behaviour |
|---|---|
| Check-in, leased device | Works. One-transaction write before print. |
| Check-in, no lease | Paper kit. |
| Fast-lane release, safety list ≤ 180 min old and from today | Tier A works. Tier B ID-tick releases of known adults work. Outbox v2 report. |
| **Tag-holder or lost-tag release offline (M7)** | **Needs a coordinator at the desk with their offline day code** (`tag_holder_offline`, `lost_tag_offline`). |
| Level 2 full care note offline (M9) | Not available. Rooms shows the cached **Level 1** safety line (allergy, EpiPen, action, where the medicine is) plus "Full note needs a connection". |
| Safety list stale | Every release goes to the careful lane: an offline day code for children with no alert; others wait for a coordinator's phone. |
| Restricted child | Named person is blocked. Everything else waits for a coordinator's phone (never a day code). |
| "List only" household, collector not on the list | Waits for a coordinator's phone and a call to the parent. |
| Device roster older than 7 days | Purged; "Connect to update". |

- `GET /checkin/changes?since=` is polled every 45 s while online. It returns:
  - check-ins and releases
  - the restriction version, flag version, `offline_codes_version` and `min_app`
  - override status
  - and it receives the device's pending counts
  - It **never** carries Level 2 notes (M9).
- Midnight: lookups include yesterday's pickups opened in the last 8 hours. Replays use the pickup's own day.

### 3.9 Browser and storage isolation (adopted from Security Part 2)

#### 3.9.1 Quick wins (Phase 2)
1. **Station token wins.** If a valid station credential is present on a check-in route, the session cookie is
   ignored. If both are present on a non-station route, the request is refused.
   - **Session ended (M12):** on `/checkin` pages and `/api/checkin/*`, a request carrying **both** a session cookie
     and a station credential deletes that session row server-side and answers `Set-Cookie: mb_session=; Max-Age=0`.
     The event is audited (`kiosk_session_ended`, with user and device).
   - **Deployment step (III-03):** when P2 goes live, the rule above ends any hub session on a kiosk at that iPad's
     first check-in request (the sessions table records no device, user agent or IP, so sessions can't be picked out
     in advance). Staff also tap "Sign out" on each check-in iPad during the P2 visit, and affected users are told.
2. **No hub sign-in on kiosks.**
   - Remove "Or sign in as a leader instead" (`checkin.js:127`) and "Sign in to sync" (`checkin.js:193`) from paired
     stations.
   - Approval route "coordinator signs in on the tablet" is **dropped**.
   - A revoked iPad's queued items follow the single revoked-token rule (§3.9.4). Nobody signs in on the kiosk.
   - A revoked device gets a distinct `reports_only` response. The client keeps its queue and cookie, and doesn't
     forget the pairing (L16).
3. **Headers on `/checkin`:**
   - CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
     connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none';
     frame-ancestors 'none'; object-src 'none'`
   - COOP `same-origin`, CORP `same-origin`
   - `Permissions-Policy: camera=(self), geolocation=(), microphone=()`
   - `X-Frame-Options: DENY`
4. **HSTS** (`max-age=31536000`) on every response.
5. **SRI** on hls.js (`video.js:61`), or self-host it.
6. `Cache-Control: no-store` on roster, approvers, photo, my-offline-code, care-note, changes, pickup, active and
   station (L15).

#### 3.9.2 Dedicated check-in host (Phase 3): `checkin.<church domain>` on the same Render service
New environment variable `MB_CHECKIN_URL`.

1. **Host gate.** On that host, only these are served; everything else is 404:
   - `/`, `/checkin`, `/checkin.webmanifest`, `/sw-checkin.js`
   - the check-in static files
   - the station API allow-list, plus pairing
   - `/healthz`
2. **No cookie authentication on that host.** `loadUser` gives `null` there, and `mb_session` is never set.
3. **Station credential cookie:** `__Host-mb_station=<token>; Path=/; Secure; HttpOnly; SameSite=Strict`, set at
   pairing and rotated.
   - Rotation: on the first request of the day the server sets `token_next`. The old token stays valid until the new
     one is first used, for at most 7 days, plus a 2-minute grace afterwards for in-flight retries (M13).
   - **`x-station` is never accepted on the check-in host (M8).** It is accepted on the old host only, for unmigrated
     iPads. `x-mb` still guards writes.
   - The check-in host reads only `__Host-mb_station`. A tossed `mb_session` cookie, even with `Domain=` the parent
     domain, is ignored (L13; the two hosts are same-site, so SameSite doesn't separate them).
4. **Own service worker** `/sw-checkin.js`, with no push handlers, and its own manifest (`start_url /checkin`,
   standalone). The hub's `/sw.js` drops the check-in files after migration.
5. **Strict headers** on the whole host, from §3.9.1.
6. **Hub host:** `/checkin` shows "This page moved", plus the migration path. Pairing UI in the hub is unchanged.
7. No CORS is needed.

#### 3.9.3 Migrating each iPad without losing anything
Done mid-week, outside check-in hours, by staff at each iPad (about 10 minutes per iPad):
1. **Release N:** the old app reports queue and outbox counts with every poll. The hub Stations page shows pending
   counts and migration status.
2. **Freeze:** "Move this iPad" is enabled only when the iPad is online. Pressing it stops new check-ins and
   check-outs, and the server records `migrating_at`.
   - **From then on the token is drain-only, enforced by the server (M8):**
     - allowed: `POST /checkin/checkins` and `POST /checkin/checkout` as reports, `GET /checkin/station`
     - refused with 403: roster, active, pickup, photo, changes, approvers and care-note
3. **Drain:** sync until the queue and outbox are **empty and acknowledged by the server**. If anything can't be sent,
   it stops and shows "N items need a coordinator". **Nothing is wiped.**
4. **Wipe:** only when both are empty. Remove the roster, day lists, photos, verifiers and K_dev. Show a QR code and
   the new address. **The old token is kept until the replacement is paired.**
5. **Re-add:** open the new address in Safari, Add to Home Screen (or update the MDM web clip), and open it from the
   Home Screen.
6. **Replace:** in the hub, choose **"Replace North Desk 2"**.
   - **Refused (409)** unless the old device's last **server-recorded** `pending_queue` and `pending_outbox` are both
     0, reported after `migrating_at` (M8). That catches draining the wrong container.
   - The new device keeps the name, campus and print settings, and records `replaces_device_id`.
   - It keeps the lease prefix **only if that prefix was not used today or yesterday**; otherwise it gets a fresh
     prefix (M8).
   - **Only now is the old token revoked** (reason `replaced`).
   - The new iPad gets a fresh K_dev.
7. Point Guided Access or Single App Mode at the new web clip.

**Safety nets**
- Uploads from the old token after replacement are recorded, applied as reports and alerted, **with no time limit**
  (§3.9.4). Nothing is lost.
- The old host keeps serving check-in to unmigrated tokens for **60 days**. After that, those tokens are
  **drain-only, enforced by the server** (as in step 2), and the screen shows only the move screen. The move screen
  stays available indefinitely.
- **Verifiers, restriction data and Level 2 notes are served only to tokens with `host = checkin`** (M8). Old-host
  tokens never receive them, whatever flags are on.
- The move button is disabled during check-in hours.

#### 3.9.4 The single rule for revoked tokens (M6)
| Revoke reason | Uploads after the revoke |
|---|---|
| **Lost or stolen** | Every upload is **recorded and quarantined, never applied**, whatever `client_at` says, and alerted. A coordinator reviews and applies items by hand. |
| **Replaced or migrated** | Applied as reports with an alert, **with no time limit**. Never lost. |
| Other (staff removed it) | Treated as lost or stolen (quarantined), unless an admin re-classifies it, which is audited. |

Earlier text that mentioned "accepted for 7 days" is removed.

**Owner must provide:** DNS for the subdomain (a CNAME to Render) and confirm that Render allows the custom domain
(A4, A5).
- **Fallback if not possible:** keep the quick wins only. Pickup alerts and offline codes then run with **Medium**
  residual risk, which needs an explicit owner acceptance (II-19).

### 3.10 Operator identity and age ("Who's on this desk?")
**Operator pick-list on a station:**
- people with an accepted assignment today on the teams set in `checkin_kids_team_ids` at that campus
- accounts with a check-in level at that campus
- "Someone else", typed. That person is treated as under 18.

The roster sends `{person_id, display_name, is_adult}` only, never birthdates.

**Adult:** `people.birthdate` shows 18 or over on today's date in the campus time zone. **A missing birthdate means
not adult.** The screen asks the office to add it (A8).

**Verify mode** (`checkin_operator_verify`):
- **`attested` (default):** pick from the list. Fast, but a teen could pick an adult's name. Every adult-only action
  and every Level 2 view is logged with the operator.
- **`phone`:** an adult confirms "I'm on North Desk 2" from their own signed-in app. This is needed online once per
  shift. Offline it falls back to the cached attested pick with a "not confirmed" flag.

**During use:**
- The pick lasts until "Change person" or 20 minutes idle.
- Every event stores `operator_person_id`, `operator_name` and `operator_verified`.
- **Adult-only actions:** Tier B releases, tag-holder releases, opening Level 2 notes.

### 3.11 Audit, alerts, rate limits
**`checkin_events`** (append-only by trigger) records:
- check-ins and releases, with tier, kind, ID type, tag kept, collector age confirmed, operator
- reports and violations
- void, undo, reissue, revoke, reprint
- conflict, mismatch, `lease_cloned`, `backup_prefix`, `clock_skew`
- lease and roster events
- override request and decision, `offline_approval` (fields from Security §1.5), `pin_failure`
- alert button, incident note
- restriction change (never `details`)
- tag-holder review
- migration steps

Each event stores device id and name, user id and name, operator, client time and server time. Events never copy
medical text.

**`sensitive_access_log`** (append-only) records every Level 2 or Level 3 view (§3.12).

**Notifications:**
- New kind `checkin_alert`; coordinators can't mute it.
- Generic text, de-duplicated per pickup or child per 10 minutes, plus a digest.
- Household tag-holder messages contain only their own child's first name and the collector.

**Rate limits:**
- A shared factory keyed by device or user, with least-recently-used eviction.
- Stations get a progressive delay. Users get 429.
- Only failures count. "Not found" looks the same for unknown and already-released codes.

### 3.12 Medical information: three levels (R3)
| Level | Content | Who sees it | Where | Stored on iPads? |
|---|---|---|---|---|
| **1 Safety line** | `allergies`, EpiPen yes/no (`safety_epipen`), a one-line action (`safety_action`, ≤ 100 characters), where medicines are (`safety_meds_location`, ≤ 60 characters) | **Everyone serving kids, teens included** | Labels (allergy strip, "EPI: YES", "MEDICAL NOTE: ask the room leader" when Level 2 exists (N5: the room list shows Level 2 only online)); Rooms; check-in card; hub | Yes: the roster, for children in scope (needed offline) |
| **2 Full care note** | `medical_notes` (existing field, unchanged) | Adult operators on stations; helpers 18+, coordinators, staff and admins in the hub | Rooms ("Show care note" on tap), **children checked in today only**; hub person page ("Show care note") | **Not stored.** Fetched on tap, online only, from `GET /checkin/care-note/:child?operator=`, with `no-store`. The server checks the child is checked in today at the station's campus, the operator is an adult, and the token is on the check-in host. Shown in memory and discarded. **Never in the roster or `/changes`.** |
| **3 Private care notes** | new table **`person_care_notes(person_id PK, private_text, updated_by, updated_at)`**, not a `people` column (H2) | Coordinators and admins only | Hub only ("Show private notes") | **Never.** Kept out of every `SELECT *` and `p.*` by construction, plus column allow-lists and a router-wide canary sweep. |

**Why fetch on tap (M9, option a), and the offline trade-off**
- **Option (a), chosen:** the server decides who sees the full note and writes the log. A modified client or a
  script on the iPad can't skip either.
- **Option (b), rejected:** bulk delivery to the iPad with client-side gating. The teen gate and the view log would
  be whatever the client chooses, which is weaker than what the policy promises.
- **Offline cost:** a room helper offline can't open the full note.
  - The life-critical part, the **Level 1 safety line**, is always cached and shown: allergy, "EPI: YES", the
    one-line action ("give EpiPen in the thigh, call 911, call parent") and where the medicine is.
  - It is also printed on the label. Per-child "print full note on label" covers the few children whose plan needs
    more.
  - So a helper never has to go without the EpiPen plan offline.
- Owner decision I-52 confirms this trade-off.

- **Logging:** every "Show care note" (iPad or hub) and every "Show private notes" is **written by the server** to
  `sensitive_access_log` when it serves the note: who, device, operator, child, level, surface and time. There are no
  client-reported views, because notes are never served offline.
  - **Review:** Kids safety → "Medical access log" for coordinators, admins and the safeguarding lead. A monthly
    review is suggested (I-30).
- **Per-child "print full note on label"** (`label_medical`) for life-critical plans. It needs re-confirming each term
  (`label_medical_confirmed_at`; expired means the label stops printing the note and the coordinator is reminded).
- **Existing notes are not moved automatically** (no rewrite). The hub lists children with a Level 2 note and no
  safety line, so coordinators can add the safety line and move private material to Level 3 by hand.
  - Parents and staff get guidance on what goes where.
- **Hub today:** `getPerson = SELECT * FROM people` (`people.js:24`) is returned by `GET /people/:id` (leader),
  `POST /people` (leader and stations), `PATCH /people/:id` (staff) and merge. `finance.js:108` uses `p.*`.
  - **Change (H2):** these switch to an **explicit column allow-list** (`PERSON_PUBLIC_FIELDS`) that excludes
    `medical_notes`, so no `SELECT *` on `people` remains in any response. A grep test enforces this.
  - Level 2 is fetched by `GET /people/:id/care-note` (helper 18+, coordinator, staff, admin; logged).
  - Level 3 is fetched by `GET /people/:id/private-care-notes` from `person_care_notes` (coordinator or admin;
    logged).
  - The `/people` export keeps allergies only, as today.
- **Router-wide canary sweep (H2):**
  - Put canaries in `medical_notes`, `person_care_notes.private_text` and `pickup_contact_notes.text`.
  - Call **every registered GET, POST and PATCH route** as each role (volunteer, helper, leader, staff, coordinator,
    admin, campus-limited staff) and as a station. That includes `POST /people` from a station, its 409 `duplicate`
    body, merge, finance statements and `household.pickups`.
  - Assert the canaries are absent everywhere except the two care-note endpoints, for the permitted roles.
- `allergies` free text becomes Level 1, which teens see. It is added to the coordinators' manual review list, in case
  it holds private material (L18).

### 3.13 Roster cache minimisation
**Scope:** this campus, plus any household with a check-in anywhere in the last 12 months. An online "Search all
campuses" fetches one household when needed.

**Fields (allow-list with a shape test):**
- children: Level 1 only (never Level 2 or 3)
- adults: no medical data
- member phones: last 4 digits only; the household's main phone is kept
- contacts: name, relationship, photo flag, scope, dates
- restrictions: station-safe fields, explicit mode only
- operators: `is_adult` only

**Purges:**
- Day lists, issued lists older than yesterday, and photos: on start.
- The roster: after 7 days without a refresh.
- Unpair or revoke: roster, photos, verifiers and K_dev. **The queue and outbox are kept.**

At-rest encryption of the roster is deferred: the key would have to live on the same iPad. The check-in host and the
device policy cover the main risk.

### 3.14 Labels and tags
**Child label:**
- allergy strip, unchanged
- "EPI: YES" when set
- name, room, date, **check-in time HH:MM**, code
- "MEDICAL NOTE: ask the room leader" when a Level 2 note exists (N5)
- the full note only if `label_medical` is set and still confirmed
- **no restriction marker**

**Parent tag:**
- code in large type (`K 7Q3M` / `7K 3Q4M`), date, **check-in time**, number of children and their initials
- "Keep this tag. You hand it over at pickup. We may ask for ID."
- no household name
- always printed while pickup sessions are on

---

## 4. Data integrity

### 4.1 Inventory (read-only, run on a restored backup copy in Phase 0)
| Table | What we measure | Touched by this plan |
|---|---|---|
| `checkins` | Rows per campus; codes that aren't 4 characters; past open rows; historical same-day clashes across households | New columns only. Delete is blocked; void instead. |
| `assignments`, `attendance`, `headcounts`, `services`, `positions` | Past services with history; positions with past assignments; count of past services deleted (from `audit_log` `service.delete`) | New columns plus delete guards |
| `household_pickups` | Counts | New columns; delete becomes archive |
| `people` | Adults in child households with and without a photo; **kids-team volunteers with no birthdate**; children with `medical_notes` | New columns plus delete guard |
| `households` | Households with children; households whose adults have no app account (notification coverage) | New columns |
| `users` | `role_auto` leaders | New columns |
| `checkin_devices` | iPads per campus; model and iPadOS (by hand) | New columns; delete becomes revoke |
| Backups | Drive and disk usage; growth per day (to size the effect of a legal hold) | Rotation pauses under a hold |

### 4.2 Protecting history: method chosen
**Options weighed:**

| Method | Risk | Verdict |
|---|---|---|
| **A. `BEFORE DELETE` triggers that `RAISE(ABORT)` when a row has history** | Additive (no data touched). It can be removed by a later migration (`DROP TRIGGER`). Cascades never start, because the parent trigger aborts the whole statement. Existing routes that delete such rows start getting an error, so the routes must change to soft alternatives (II-02). | **Chosen** |
| B. Rebuild `checkins` and `assignments` to change their FKs to `RESTRICT` or `SET NULL` | SQLite needs the 12-step rebuild, which means copying every row (a destructive-class change under `docs/database.md` rule 3). `PRAGMA foreign_keys` can't be changed inside a transaction, and `migrate()` wraps every migration in `tx()`, so the migration runner itself would have to change. There is also a risk of losing indexes or triggers, and a long lock. | Rejected |
| C. Application checks only | Doesn't protect against new routes, scripts or bugs | Not enough on its own; used as well, for friendly messages |

**Migration m30: guards** (`now+14h` means `strftime('%Y-%m-%dT%H:%M','now','+14 hours')`; it covers any campus time
zone, because `starts_at` is local time):
- `people_keep_history BEFORE DELETE ON people`: refuse if the person has rows in `checkins`, `assignments` or
  `attendance`, unless a permit exists.
- `services_keep_history BEFORE DELETE ON services`: refuse if `starts_at <= now+14h` **and** there are assignments
  (accepted or sent), attendance, headcounts or check-ins, unless a permit exists.
- `positions_keep_history BEFORE DELETE ON positions`: refuse if any assignment for a service with
  `starts_at <= now+14h` exists.
- `assignments_keep_history BEFORE DELETE ON assignments`: refuse when the service has `starts_at <= now+14h` and the
  status is `accepted`, unless a permit exists.
- `checkins_no_delete BEFORE DELETE ON checkins`: refuse unless a permit exists.
- `teams_keep_history` and `campuses_keep_history`: refuse when dependent history exists. No route deletes these
  today; the triggers are a backstop.
- **Added in revision 3 (M3), permit-only delete guards on:**
  - `pickup_restrictions`
  - `household_pickups` (rows with `created_at` set, or ever cited in a release)
  - `checkin_pickups`
  - `checkin_overrides`
  - `person_care_notes`, `pickup_contact_notes`: emptying the text is an audited edit; deleting the row needs a permit
- `people_keep_history` also counts `pickup_restrictions` (as the child or the restricted person),
  `household_pickups.person_id` and `checkin_pickups`. A child with only a restriction can't be deleted.

**Update guards, so history can't be retroactively altered (H1):**
- **Threshold (N1):** the update guards use `now−14h` (`strftime('%Y-%m-%dT%H:%M','now','-14 hours')`), which is
  in the past in every campus time zone, so ordinary changes to services up to a day ahead (a Saturday-evening
  decline for Sunday 9 a.m., moving tomorrow's service for snow) are never blocked. The routes check the exact
  campus-local start time. The delete guards keep `now+14h`.
- `services_no_retime BEFORE UPDATE OF starts_at ON services`: refuse when
  - `OLD.starts_at <= now−14h`, history exists (as above) **and** `NEW.starts_at > now−14h` (moving a past service
    into the future); or
  - a future service with history would move into the past.
  - Corrections that keep a past service in the past (for example 09:00 → 09:30 on the same day) are allowed and
    audited.
- `assignments_no_restatus BEFORE UPDATE OF status ON assignments`: refuse when the service has
  `starts_at <= now−14h` and `OLD.status = 'accepted'`.
  - Corrections go through `removed_at / removed_by / remove_reason`: leader or above, reason required, audited.
- **Routes:**
  - `PATCH /assignments/:id` refuses status changes on past services with 409 "This service has already happened".
    Today the volunteer themself can change it (`services.js:514-522`).
  - `PATCH /services/:id` gives a friendly 409 for a blocked retime.
  - `PATCH /series/:id` clamps `ends_on` and `from_date` to today or later (`series.js:137-176`). Past services are
    never retimed or deleted by a series edit.
- A grep test lists every `UPDATE services` and `UPDATE assignments` statement, and every `DELETE FROM` on a guarded
  table, and checks each against the guards.

**Permits:** `history_delete_permits(id, table_name, row_id, reason NOT NULL, requested_by, approved_by, created_at, approved_at, expires_at)`.
- Admin-only maintenance path, with a typed reason, audited.
- **Two different people (M2):** requested by one admin, approved by a **second, different** admin (or the owner).
  The permit is valid for 10 minutes after the second approval.
- **The trigger itself also refuses while any legal hold is active**, checked inside the trigger with
  `NOT EXISTS (SELECT 1 FROM retention_holds WHERE release_approved_at IS NULL OR release_approved_at > datetime('now','-7 days') …)` (N7: a hold counts until its two-person release is approved **and** the 7-day cooling-off has passed). So the order of permit and hold doesn't
  matter.
- **Before the delete,** the route copies the whole row as JSON into the append-only
  `history_deletions(id, table_name, row_id, row_json, permit_id, deleted_by, at)` tombstone.
- No UI button in this plan; it is a documented maintenance route only.

**Durability (M3):**
- **Schema invariant test** (run by `npm test`): after `openDb(':memory:')`, the exact list of required triggers exists
  in `sqlite_master` (name and table), and the table count is **73**.
- **Rule in `docs/database.md`:** any migration that rebuilds a table must re-create its triggers in the same
  migration. A table rebuild drops triggers silently; this was verified by Security.
- **Append-only tables have no foreign keys to users, people or devices:** `checkin_events`,
  `sensitive_access_log`, `history_deletions`, and the decision columns of `checkin_overrides` and
  `retention_holds`.
  - They store `user_id`, `person_id` and `device_id` as plain integers, plus a name snapshot.
  - Reason: an `ON DELETE SET NULL` into a row protected by an abort trigger would abort the existing
    `DELETE /users/:id`.

**Soft alternatives (additive columns, same migration):**
- `services.cancelled_at / cancelled_by / cancel_reason`.
  - `DELETE /services/:id` on a protected service gives 409 "This service has already happened (or has people
    scheduled), so it's kept. Cancel it instead."
- `positions.archived`. `DELETE /positions/:id` on a protected position archives it.
- `assignments.removed_at / removed_by / remove_reason`.
  - `DELETE /assignments/:id` on a past accepted assignment marks it removed. Future ones still hard-delete as today.
- `DELETE /series/:id?from=` clamps `from` to today or later, and so does `PATCH /series/:id` (`ends_on`,
  `from_date`).
- Person merge: duplicate past assignments stay on the archived duplicate (no delete), and the rest moves as today.
- `checkins.voided_at / voided_by / void_reason`. `DELETE /checkin/checkins/:id` becomes void.
- **Every query** that lists services, positions, assignments or check-ins filters cancelled, archived, removed or
  voided rows where it should. A grep test lists every `FROM services|positions|assignments|checkins` and checks the
  filter (QA D6.03 style).

**Not guarded, but audited from P1 (L2):**
- Attendance un-marking (a roll-call correction, `attendance.js:39-49`) and headcount edits (`checkin.js:121-135`)
  stay possible. Parent deletes are guarded.
- **P1 adds** `audit()` for both: `attendance.unmark` (service, person, who) and `headcount.update` (area, old → new,
  who). Today neither writes an audit row.
- Under a legal hold, the preserved copies are the nightly backups. An edit made and reversed within one day is
  visible only in the audit log, not in a backup.

### 4.3 Migrations (append-only, each atomic: `migrate()` runs exec plus `user_version` in one `tx()`, verified)
Only `CREATE TABLE/INDEX/TRIGGER` and `ALTER TABLE ADD COLUMN` with a constant or NULL default. **No UPDATE or
DELETE of existing rows. No back-fill.**

| # | Phase | Content |
|---|---|---|
| **m30** | P1 | `retention_holds` (with `release_requested_by/at`, `release_approved_by/at`, `deletion_resume_at`; decision columns as plain integers); `history_delete_permits` (two-person columns); `history_deletions` tombstone (append-only, no FKs); the delete-guard **and update-guard** triggers (§4.2), with a hold check inside the permit path; soft columns on `services`, `positions`, `assignments`, `checkins` (void) |
| **m31** | P2 | `checkin_events`, with `BEFORE UPDATE`/`BEFORE DELETE` abort triggers, a campus FK without cascade, and **no FKs to users, people or devices** (plain integers plus name snapshots); `checkins` + device/user/operator, release columns (`released_to`, `released_to_kind`, `release_method`, `id_checked`, `released_to_id_type`, `tag_retained`, `collector_age_ok`, `operator_person_id`, `operator_verified`, `client_checked_out_at`, `flags`); `checkin_devices` + `revoked_at/by`, `app_version`; `people` + `household_set_at`, `household_set_by_kind` |
| **m32** | P3 | `checkin_devices` + `replaces_device_id`, `migrated_at`, `host`, `token_next_hash`, `token_rotated_at`, `pending_queue`, `pending_outbox`, `last_contact_at` |
| **m33** | P4 | `checkin_code_leases` (`campus_id`, `prefix`, `kind` primary/backup/server, `device_id`, `user_id`, `valid_until`, `lease_epoch`, `leased_at`, `last_used`, `released_at`; PK `(campus_id, prefix)`); `checkin_pickups` (`id`, `campus_id`, server-derived `household_id`, `day`, `code`, `device_id`, `user_id`, `station`, `origin`, `flags` (`conflict`/`mismatch`/`code_unknown`/`backup_prefix`/`lease_cloned`/`server_issued`), `code_revoked_at`, `restrictions_snapshot`, `created_at`, `received_at`; index `(campus_id, code, day)`); `checkins` + `pickup_id`, `duplicate_of`; `households` + `pickup_list_only INTEGER DEFAULT 0`, `list_only_mode TEXT DEFAULT 'coordinator'`; `people` + `pickup_verified_at/by` |
| **m34** | P5 | `users` + `checkin TEXT DEFAULT ''`, `checkin_pin_hash`, `checkin_pin_set_at`; `checkin_duty(campus_id, day, service_id, user_id, role, created_by, created_at)` unique; `checkin_offline_codes` (§3.7.2, with `secret_kid`); `checkin_offline_verifiers(device_id, code_id, salt, iter, issued_at, issue_count)`; `checkin_devices` + `quarantined_at`, `last_seq`, `migrating_at`, `revoke_reason`; `users` + `checkin_pin_expires_at` |
| **m35** | P6 | `pickup_restrictions` (with `pending_end_requested_by/at`, `pending_end_confirmed_by`); `household_pickups` + `person_id`, `photo`, `child_ids`, `starts_on`, `ends_on`, `pickup_session_id`, `one_time`, `id_required`, `created_by`, `created_at` (NULL for old rows), `archived_at/by`; **`pickup_contact_notes(pickup_id PK, text, updated_by, updated_at)`** (H2; no notes column on `household_pickups`); `checkin_overrides` (random text id, binding fields, `decided_via` phone/pin/offline_code; decision columns as plain integers); permit-only delete guards on restrictions, contacts, pickups and overrides (M3) |
| **m36** | P7 | `people` + `safety_epipen`, `safety_action`, `safety_meds_location`, `label_medical`, `label_medical_confirmed_at`; **`person_care_notes(person_id PK, private_text, updated_by, updated_at)`** (H2; not a `people` column); `sensitive_access_log`, with append-only triggers and no FKs |

**Result:** 36 migrations and **73 tables** (14 new). `docs/database.md` is updated, with a count test and the
trigger-list invariant (§4.2).

**Also:**
- Person merge moves the new references: restrictions, contacts, verification and overrides.
- New settings keys are added to the `SETTINGS` allow-list in `setup.js`, and changes are audited old → new.

### 4.4 Preservation guarantees
- The original columns of every existing table hash the same before and after each migration (D6.01). Row counts,
  `foreign_key_check` and `integrity_check` all pass.
- Historical 4-character codes are never rewritten.
- After P1, **no route can delete or retroactively alter serving and check-in history** (§4.2). Corrections are
  recorded as cancelled, archived, removed or voided, with who and why. Nothing in this plan purges data. Purges are
  separate, later approvals (§4.10).
- Remaining residual: `checkins.person_id ON DELETE CASCADE` stays in the schema, but is neutralised by the trigger.
  Recorded in `tech-debt.md`.

### 4.5 Upload and check-out compatibility
- `POST /checkin/checkins` accepts the v3 shape forever.
  - Before `checkin_pickups` is on: a legacy row.
  - After: a server-made pickup.
  - Records with an empty code: `code_unknown`.
- `POST /checkin/checkout`:
  - v2 `request`: all-or-nothing.
  - v2 `report`: recorded per id; violations are still recorded, with an alert.

### 4.6 Old iPads and outboxes (never poison a queue)
- Old app = no `x-checkin-app` header, so the iPad shows as "Needs reload".
- **Before `checkin_pickups` is on:** today's behaviour, plus the ambiguity guard: a legacy code that matches more
  than one household gives 409 with the families listed.
- **After it is on (R1):** the old app's *live* `{security_code}` and `{ids}` requests are code-only releases.
  - The server gives 409 "Reload this iPad". The old UI shows an error and does not mark children out.
  - Old outbox flushes can't be told apart from live requests, so the same 409 applies.
  - **The information is still kept:** every refused old-shape body is stored as a `legacy_release_attempt` event,
    with the ids, the device and the server time, idempotent by device and id set. The rows stay "in" on the server.
    The old outbox keeps retrying harmlessly; repeats are de-duplicated.
  - One de-duplicated urgent alert per device: "An iPad running the old app tried to check children out; check the
    rooms".
  - The coordinator reconciles from the Live page. "Confirm this child has left" releases the row with
    `release_method = 'legacy_confirmed'`, a reason and the coordinator's id.
  - Because the host migration (P3) happens before P4, every iPad already runs the new app. This case only arises for
    a forgotten iPad on the old host.
- The new app sends its own old-format `mb.checkin.queue` and `mb.checkin.outbox` once, as v2 reports with
  `origin: legacy_local`, before the first move. This happens during P3 migration, while the server still accepts
  them, because it is before `checkin_pickups`.

### 4.7 Active check-ins at deploy
- Deploys happen on **weekday mornings with no kids' programme**, with flags off.
- "Open" is day-scoped. Yesterday's rows that were never checked out are listed for coordinators, never closed
  automatically.
- **Enabling pickup sessions** happens on a weekday, once every iPad is on the check-in host and shows the new
  version. **There is no legacy fallback iPad**, because the old app releases on the code alone (R1). The fallback is
  the paper kit plus a spare new-app iPad per campus.
- Legacy 4-character rows can only exist from before enabling. They are handled in the careful lane if more than one
  matches.

### 4.8 Feature flags
| Flag | Turns on | Can it be switched off? |
|---|---|---|
| `checkin_pickups` | Prefix codes, sessions, lanes | Yes (soft rollback), but code-only release is not restored: the new app keeps verified check-out. |
| `checkin_access` | `explicit` mode | Yes, back to `leaders`. Restriction display then goes to stations only. |
| `checkin_restrictions_ui` | Management screens | Hides the screens; **enforcement stays**. |
| `checkin_offline_codes` | Day codes (also needs the env secrets) | Yes. Removing the secret also turns them off (fails closed). |
| `checkin_id_check`, `checkin_hours`, `checkin_offline_max_age_min`, `checkin_collector_min_age`, `checkin_operator_verify`, `checkin_kids_team_ids`, `checkin_roster_scope` | — | Yes, changeable; changes are audited old → new. |

**Never behind a flag:**
- delete guards
- legal hold checks
- the pickup binding and "a code alone never releases" (once enabled)
- the ambiguity rule
- restriction enforcement whenever any active restriction exists
- append-only events and access log
- the station allow-list
- campus checks
- Level 3 never reaching iPads

**Emergency relaxation switch (M1).** This is not a kill switch.
- **It never lifts `do_not_release`.** Releasing to a named do-not-release person stays a hard block on every path,
  whatever this switch says.
- **What it changes (N4):** normally a fuzzy-name match or `check_first` needs a coordinator's phone approval for
  each release. With the switch on, a coordinator at the desk may approve those releases with their **online PIN**
  instead (still one approval per release, still recorded, notice to all coordinators), so one bad restriction record
  can't stall every pickup while the phone holder is unreachable. It never applies offline and never to
  `do_not_release`.
- **Two different people:** two admins, or an admin plus a coordinator who is not the requester. Typed reason.
- Lasts **at most 4 hours**. It can't be renewed without a fresh two-person approval.
- Notifies all admins and coordinators. Banners still show while it is on.

### 4.9 Legal hold (P1, before any cleanup automation)
**Table:** `retention_holds(id, scope 'all'|'person'|'household'|'campus'|'dates', person_id, household_id, campus_id,
from_day, to_day, reason NOT NULL, set_by, set_at, released_by, released_at, release_reason)`.

**Setting and releasing:**
- **Setting:** any one admin (or the safeguarding lead, if an admin), at once. Setting is the safe direction.
- **Releasing (M2):** requested by one admin with a reason, then approved by a **second, different** admin or the
  owner. Until then the hold stays active.
- **Cooling-off:** after the second approval, backup copies made during the hold may be deleted by rotation only
  after **7 days** (`deletion_resume_at`). All admins are reminded on day 1 and day 6.
- Every action is audited and notified to every admin.
- A hold can't be edited, only released.

**Effects:**
1. **Backup rotation (exists today, M10):** `backup.js` normally deletes old copies. `prune()` keeps the newest 14
   plus one a month for 12 months in Drive; `pruneLocal()` keeps 3 on disk.
   - **While a hold is active:**
     - **every Drive copy is kept**
     - the previous Drive version of a changed uploaded file isn't deleted (`backup.js:165`)
     - **local pruning continues (keep 3), but only for files whose Drive copy exists**. The Render disk also holds
       the live database, so it must not fill.
   - **If Drive isn't connected:** local pruning pauses, alerts fire at 60% and 80% disk, **at 85% new local backups stop (held copies kept) with an urgent admin alert and a banner until Drive is connected or space is freed (N2)**, and setting or continuing
     the hold needs an admin to acknowledge the disk risk.
   - **`DELETE /backups/drive` (disconnecting Drive) is refused while a hold is active.**
   - Residual risk: the Drive account owner can still delete held copies in Google Drive itself, outside the app.
     The hold notice asks them not to, and offers "Download a copy now" (L19).
2. History-delete permits are refused while any hold is active. **The check runs inside the trigger as well as at
   permit creation** (§4.2).
3. Any future purge job must call `heldScope()` and skip held rows, or stop entirely for scope `all`. A test-enforced
   contract: every job module is registered and tested against a hold.
4. Transient technical clean-up is not covered, because it holds no records: expired pairings, sessions, login codes,
   device caches. The policy lists them.

**Runbook rule:** "When an allegation, claim or subpoena arrives: set a hold first, before anything else."

### 4.10 Retention policy: DRAFT, requires insurer and attorney review before any purge is enabled
Combined from Security Q4 and Operations Q4. **Not legal advice.**

| Data | Proposed keep | Then |
|---|---|---|
| Release, refusal, override, undo, void, alert, incident and conflict events; who released to whom (ID name and type) | Long-term: at least until the youngest child named turns 18 plus the local limitation period; in practice indefinitely, reviewed every 5 years | Review |
| Restrictions, including ended ones and their details | Long-term | Review |
| Check-in and check-out rows (attendance) | Long-term | Review |
| Serving records (assignments, roll call) | Long-term | Review |
| Court-order paper | Locked paper. While active, plus a period the attorney sets | Attorney |
| One-time pickup person's phone | 90 days | Phone cleared; name, relationship, ID type and date kept |
| Contact photos | Until the contact ends, + 90 days | File deleted, record kept |
| Level 2 and 3 notes | While the child is active | Cleared after 24 months with no check-in (staff warned first); "had a flag" is kept only in incident records |
| Visitor contact details (never returned) | 12–24 months | Minimised; check-in events kept |
| Security logs (roster downloads, leases, PIN and code failures) | 2 years | Purged or turned into counts |
| `sensitive_access_log` | Long-term (safeguarding evidence) | Review |
| Notification copies of alerts | 1 year | Purged |
| Device caches | Daily / 7-day TTL | Wiped |

**Access to records older than 13 months:** coordinators, admins and the safeguarding lead only. Exports need a
reason and are audited.

**Process:**
- **No purge job is built to run in this plan.** P8 ships a **dry-run "what would be purged" report** only.
- Each purge job is later a separate PR, enabled by a separate owner approval **after the insurer and attorney have
  signed off** (III-25, III-26). Dry-run counts come first, and every purge is logged.

### 4.11 Rollback per phase
| Phase | Soft rollback | Hard rollback (revert the PR outside service hours) | Caveat |
|---|---|---|---|
| P1 | — | Code revert is safe. **Triggers stay**, so old code deleting or retiming a protected row gets a generic 500 (the safe direction). Triggers can only be dropped by a new migration, which needs owner approval. The invariant test makes any drop visible. | The legal hold UI disappears, but held rows stay recorded. Old `backup.js` would resume full pruning, so **don't revert P1 while a hold is active.** |
| P2 | — | Safe. Old code ignores the new columns and triggers (D6.08). | The headers and kiosk sign-in links return. |
| P3 | Per iPad: the old host still serves check-in for 60 days | Re-pair the iPads on the old host, using the same drain-first flow in reverse | DNS can be left in place |
| P4 | `checkin_pickups` off | Only on a day with no open session check-ins. The old app can't type 5/6-character codes. | Reload the iPads |
| P5 | `checkin_access = leaders`; offline codes off (or remove the secret) | Safe | Day-code verifiers are wiped on the next poll |
| P6 | Screens off; **enforcement stays** | Old code doesn't enforce restrictions. Print the alerts sheet first and use the paper procedure. | Never drop tables |
| P7 | — | The old code sends `medical_notes` in the person payload again, and access logging stops. `person_care_notes` stays in its own table, which old code never reads. | Level 3 stays out of every response |
| P8/P9 | — | Safe | — |

---

## 5. Testing and verification

### 5.1 Test list
IDs: QA (`Pn.xx`, `C2`, `R3`, `A4`, `P5`, `D6`, `B7`, `G8`, `V9`, `L10`), Security (`S-`), Q1 (`N-Q1.xx`), new in
revision 2 (`N2-`).

**Pickup codes (P4)**
- **Must:**
  - P1.01 unique per device
  - P1.03 cross-device property
  - P1.04 same-lease clash flagged once
  - P1.05 3 offline stations, 0 conflicts
  - P1.06 (updated) no lease plus offline gives the paper-kit message
  - P1.07 (updated) the 22nd device gets a 2-character leased prefix; exhaustion gives server mode
  - P1.09 revoked device: no prefix reuse that day, queue kept
  - P1.11 day and campus scoping
  - P1.12 closed or voided pickups ignored
  - P1.13 across services
  - P1.15 legacy day mixed with new codes
  - P1.17 normalisation
  - P1.18 confusable characters rejected
  - P1.19 input lengths
  - P1.23 injectable random
  - N-Q1.01–N-Q1.12: length by first character, `NO_LEASE`, lease allocation and race, online reserve 409, clone,
    paper kit, Web Lock, quota or unreadable list gives backup prefix, auto-submit rule, forced clash on every path
    goes to the careful lane, no server-invented codes, simulation with clones detected
  - S-M1 lease cap
  - S-H2c prefix not leased gives `conflict`
- **Should:** P1.02, P1.10, P1.14, P1.20, P1.21, P1.22, N-Q1.13 (midnight).

**Check-out, lanes and tag holders (P4, P6)**
- **Must:**
  - C2.01, C2.02, C2.03, C2.04, C2.05, C2.06, C2.08, C2.09, C2.10, C2.11 (×50), C2.13, C2.14, C2.15, C2.16, C2.17,
    C2.21
  - S-H2a/b, S-H6, S-M9
  - N-1 lane table
  - N-3 no photo means ID
  - O-1 timing (Tier A ≤ 8 s, Tier B ≤ 20 s)
  - **N2-01** a code alone never releases: every release without a linked adult, tag-holder record or override →
    409 (request) or `release_violation` (report)
  - **N2-02** the old app's live `{security_code}` and `{ids}` after enabling → 409 "Reload", nothing released, one
    alert per device, a `legacy_release_attempt` event stored once per device and id set; coordinator "confirm left"
    releases with `legacy_confirmed`
  - **N2-03** tag holder: tag kept, ID name and type, relationship and age confirmed are all required; an ID-number
    field is absent; an operator under 18 → refused; a collector under the minimum age → coordinator
  - **N2-04** tag holder: the card stays hidden until "Names given"
  - **N2-05** household notification after a tag-holder release goes to the household adults with accounts, and
    **not** to anyone named in a restriction on those children; push text carries no other family's data
  - **N2-06** coordinator push sent immediately; daily review list; unreviewed items remind admins the next day
    (injected clock)
  - **N2-07** "list only" in `coordinator` mode: an approval without a recorded parent call → 409; with one → 200
  - **N2-08** "list only" in `refuse` mode: even a coordinator → 409; an offline day code → refused; household adults
    and contacts still use the fast lane; a one-time person added at check-in is allowed
  - **N2-09** pattern alerts (second tag holder within 30 days; same collector across households)
- **Should:** C2.07, C2.12, C2.18, C2.19, C2.20, C2.22.

**Restrictions (P6)**
- **Must:**
  - R3.01 golden fixture
  - R3.02 name matching
  - R3.03 every path, hard block even for admins
  - R3.04 alert for a child already in a room
  - R3.05 stale list → coordinator
  - R3.06 ending needs a second person
  - R3.08 override binding
  - R3.09 `details` canary
  - R3.10 labels
  - R3.12 notification text
  - R3.13, R3.14, R3.16
  - S-H1a/b/c, S-H7, S-H8, S-M10, S-M12
  - N-5 Alert button
  - **N2-10** pickup alerts can't be switched on until every station has migrated to the check-in host and explicit
    mode is on
- **Should:** R3.07, R3.11, R3.15, R3.17.

**Contacts (P6)**
- **Must:** A4.01, A4.02, A4.03, A4.04, A4.05, A4.06, A4.08, A4.11, A4.12, S-H5, S-M11.
- **Should:** A4.07, A4.09, A4.10.

**Permissions and operator identity (P2, P4, P5)**
- **Must:**
  - P5.01 matrix, P5.02 mode flip, P5.03, P5.04, P5.05 station allow-list router sweep, P5.06, P5.07, P5.09, P5.10,
    P5.12
  - S-L6
  - **N2-11** operator list = today's kids-team assignments plus flagged accounts; `is_adult` from birthdate in the
    campus time zone; missing birthdate → not adult; typed "Someone else" → not adult; birthdays at the day boundary
  - **N2-12** adult-only actions refused for a teen operator, on the iPad **and** on the server (operator id checked
    against birthdate)
  - **N2-13** `phone` verify mode: confirmation on the phone binds the operator; offline falls back to "not
    confirmed", which is logged
  - **N2-14** the roster contains `is_adult` and never birthdates
- **Should:** P5.08, P5.11, S-L5.

**Coordinator credentials (P5)**, from Security §1.11, all must:
- **N2-15** codes are 10 digits, uniform (chi-square over 10⁵ draws), deterministic for the same inputs
- **N2-16** missing `MB_CHECKIN_CODE_SECRET` or `MB_CHECKIN_SYNC_KEY` → no verifiers; the iPad shows "Offline
  approvals unavailable"
- **N2-17** issued only to on-duty coordinators of that campus; helper, leader, other campus and off duty → 403; a
  session older than 12 h → re-authenticate
- **N2-18** never in email, push, logs or audit: grep test plus log capture during a full flow, with no 10-digit run
  equal to the code
- **N2-19** `no-store` headers; the approvers URL is never cached by the service worker
- **N2-20** never accepted online: router sweep with the code in body, query and headers; `pin-verify` with a day
  code fails
- **N2-21** WebKit browser test: after verifiers load and an approval is made, a dump of localStorage, IndexedDB and
  Cache Storage contains no code and no V, only W
- **N2-22** `exportKey` on K_dev rejects, and `extractable` is false
- **N2-23** one `deriveBits` call per try; `iter` taken from the record
- **N2-24** day and clock bounds with an injected clock, including the clock set back during a lock
- **N2-25** per-coordinator lock (5) doesn't affect another coordinator; the 20th failure that day stops everything;
  the lock survives a reload
- **N2-26** allowed-kinds golden fixture: never-allowed kinds are refused on the iPad and become `release_violation`
  on sync
- **N2-27** envelope: valid → accepted; tampered `E` → AAD failure; wrong code, replayed `approval_id`, lower `seq`,
  missing or forged envelope → `offline_approval_invalid`, **and the event is still stored**
- **N2-28** two envelopes of the same code differ, and no hash of the code exists in the outbox
- **N2-29** rotation: an old `gen` after contact → critical, before contact → `rotated_offline`; revoking as lost
  rotates the campus's codes; disabling a user rotates theirs
- **N2-30** 3 invalid envelopes → quarantine; reports still recorded
- **N2-31** every accepted approval notifies the approver; the weekly digest counts them
- **N2-32** two-person rule enforced on sync
- **N2-33** online PIN: server-generated, 8 digits, never in any station response; the rate limits in §3.7.1; no
  account lockout; async scrypt (scope and notice tests are N3-05 and N3-06)
- **N2-34** (MAN) PBKDF2 timing on the slowest iPad, recorded; switch to 310k if the median is over 800 ms

**Host isolation and migration (P2, P3)**, all must:
- **N2-35** quick wins: a station credential beats a session; both present on a non-station route → refused; no
  sign-in links on paired stations
- **N2-36** headers: CSP, `frame-ancestors 'none'`, XFO DENY, COOP, CORP, HSTS; SRI grep test for dynamic
  third-party scripts
- **N2-37** host gate router sweep on both hosts; a hub cookie sent to the check-in host → `req.user = null`
- **N2-38** station cookie is `__Host-`, HttpOnly, Secure, SameSite=Strict, unreadable by `document.cookie`;
  rotation, with the old token valid until the new one is first used
- **N2-39** WebKit: the hub can't read the check-in host's storage; framing is blocked; `window.open` gives
  `opener === null`
- **N2-40** migration is refused while the queue or outbox isn't empty, while offline, or during check-in hours
- **N2-41** replacement keeps name and lease, and revokes the old token only at pairing
- **N2-42** uploads from the old token after replacement are recorded and alerted
- **N2-43** fault injection (network drop mid-drain) → nothing lost; a 409 mid-drain → stop, nothing wiped
- **N2-44** the old host serves unmigrated tokens for 60 days (injected clock), then only the move screen
- **N2-45** old-format local queue and outbox sent once as v2 reports before wiping

**Medical levels (P7)**, all must:
- **N2-46 (rewritten, H2): router-wide canary sweep.** Canaries go in `medical_notes`,
  `person_care_notes.private_text` and `pickup_contact_notes.text`. Every registered GET, POST and PATCH route is
  called as every role and as a station, including `POST /people` from a station and its 409 `duplicate` body, the
  `PATCH /people/:id` response, merge, finance statements and `household.pickups`. The canaries must be absent
  everywhere except the care-note endpoints for permitted roles. The sweep also covers labels, events, notifications,
  search, CSV exports, the member app, and the WebKit storage dump of a station.
- **N2-46b** a grep test finds no `SELECT *` or `p.*` on `people` or `household_pickups` in any route
- **N2-47 (M9)** `GET /checkin/care-note/:child` returns only for a child checked in today at that campus, to a
  check-in-host token, and never from `/changes` or the roster; responses are `no-store`; nothing is written to the
  iPad's storage (WebKit dump)
- **N2-48 (M9)** a teen, unknown or "Someone else" operator → 403 from the server; offline, Rooms shows Level 1 plus
  "Full note needs a connection"
- **N2-49** every served care note and private note writes a `sensitive_access_log` row **from the server** in the
  same request; hub `GET /people/:id` no longer contains `medical_notes`
- **N2-50** the access log is append-only (triggers) and its review page is limited to coordinators and admins
- **N2-51** `label_medical` prints the full note only while confirmed; an expired confirmation stops it and sends a
  reminder
- **N2-52** labels contain the Level 1 elements and check-in time; no restriction marker

**History protection and legal hold (P1)**, all must:
- **N2-53** deleting a person with check-ins, assignments or attendance aborts and nothing is removed (cascade
  prevented); without history it is allowed
- **N2-54** `DELETE /services/:id` for a past service with history → 409 with the cancel offer, rows intact; a future
  service with no history → deleted as today; a past service with no history → deleted
- **N2-55** `DELETE /positions/:id` with past assignments → archived; `DELETE /assignments/:id` past accepted →
  marked removed; future ones → deleted as today
- **N2-56** `DELETE /series/:id?from=<past>` → clamped to today; past services intact
- **N2-57** direct SQL `DELETE FROM checkins` aborts; a permit (admin, reason, 10 minutes) allows exactly that row;
  a permit is refused under a matching hold
- **N2-58** merge with duplicate past assignments succeeds and leaves them on the archived duplicate
- **N2-59** the triggers fire through FK cascades; time-zone edge at `now+14h` for campuses in different zones
- **N2-60** listing queries hide cancelled, archived, removed and voided rows (grep test plus API checks);
  scheduling regression (testing workflows 4 and 5)
- **N2-61** legal hold: set and release are admin-only, audited and notified; can't be edited; a hold of any scope
  stops backup rotation (keepers delete nothing); rotation resumes after release; the 80% usage alert fires
- **N2-62** every registered purge job (none enabled in this plan) skips held rows; the dry-run report respects holds;
  a job that isn't registered fails the contract test

**Revision 3 additions (all must)**
- **N3-01 (H1)** `PATCH /services/:id` moving a past service with history into the future → 409; then the delete is
  still refused; a same-day correction that stays in the past → allowed and audited
- **N3-02 (H1)** a volunteer self-declining a past accepted assignment → 409; a leader correction sets `removed_at`
  with a reason; a direct SQL status update → abort
- **N3-03 (H1)** `PATCH /series/:id` with a past `ends_on` or `from_date` → past services unchanged (row hashes before
  and after)
- **N3-04 (H1)** grep test covering every `UPDATE services`, `UPDATE assignments` and `DELETE FROM` on guarded tables
- **N3-05 (H3)** a PIN approval for a child with `check_first`, `court_order`, `pending_end` or a fuzzy-name match →
  409 "Phone approval needed"
- **N3-06 (H3)** a PIN approval of an allowed kind writes the approver's notification in the same request; a PIN older
  than 90 days → refused with "Generate a new PIN"; a "Not you?" report rotates the PIN; the keypad has no digit echo
  (browser)
- **N3-07 (M1)** with the relaxation switch on, `do_not_release` still gives 409 on every path; switching it on with
  one person → 409; a second distinct person → on; it expires at 4 h (injected clock); renewal needs two people again
- **N3-08 (M2)** hold release by one admin → pending; after the second approval, rotation deletes nothing for 7 days;
  reminders on day 1 and day 6
- **N3-09 (M2)** a permit created before a hold → the delete is refused once the hold is set (the trigger checks); a
  permit needs two different admins; a permitted delete leaves a `history_deletions` tombstone with the row JSON
- **N3-10 (M2)** ending a restriction: the requester can't confirm their own request (even as an admin), and nobody in
  the child's household can confirm
- **N3-11 (M3)** trigger-list invariant: every required trigger exists, and the table count is 73
- **N3-12 (M3)** `DELETE /users/:id` for a user with events, access-log rows, override decisions and holds → 200, with
  those rows intact and their name snapshots present
- **N3-13 (M3)** direct `DELETE FROM pickup_restrictions`, `household_pickups` (used), `checkin_pickups` or
  `checkin_overrides` → abort; deleting a child that has only a restriction → abort
- **N3-14 (M4)** an envelope sealed under the `_PREV` sync key → accepted within 14 days; an unknown kid →
  `offline_approval_invalid`; a code derived under the `_PREV` code secret → accepted until `_PREV` is removed;
  tampering with `kid` → decrypt failure
- **N3-15 (M5)** a report citing a valid approval with a different child, collector or pickup → `release_violation`;
  an envelope uploaded by a different station → invalid; two reports citing one approval → the second is a violation
- **N3-16 (M6)** a device revoked as lost uploads a release with a backdated `client_at` → recorded and quarantined,
  not applied; a replaced device uploads after 30 days → applied as a report, alerted
- **N3-17 (M7)** network cut: a tag-holder or lost-tag release without a day code → refused on the iPad; a forged
  report reaching the server → `release_violation`; with a day code → allowed, and the approver is notified on sync
- **N3-18 (M8)** after Move: roster, pickup, care-note and approvers → 403, uploads → 201; Replace with server-side
  pending > 0 → 409; Replace on a day the prefix was used → new prefix; day 61 (injected clock) → drain-only;
  `x-station` on the check-in host → ignored; old-host tokens never receive verifiers, restrictions or Level 2
- **N3-19 (M10)** hold with Drive connected → local copies stay at 3 and Drive copies are all kept; hold without Drive
  → local copies kept, alerts at 60% and 80%, an acknowledgement required; Drive disconnect during a hold → 409; the
  previous version of a changed upload is kept in Drive
- **N3-20 (M12)** a request with both a session cookie and a station credential on a check-in route → session row
  deleted, cookie cleared, `kiosk_session_ended` audited
- **N3-21 (L2)** roll-call un-marking writes `attendance.unmark`; a headcount edit writes `headcount.update` with old →
  new
- **N3-22 (M11)** desk card review by church operations, plus a soak observation: a paper pickup by an adult not on
  the sheet is escalated to a coordinator

**Data integrity (every migration PR)**
- **Must:** D6.01 (hashes of original columns on all tables), D6.02, D6.03 (+ cancelled/removed filters), D6.04,
  D6.06 production-shaped fixture, D6.07 failure injection, D6.08 old code on the migrated database, D6.09, D6.10,
  D6.11, S-M7, N3-11.
- **Should:** D6.05, D6.12, D6.13 (36 migrations, 73 tables), D6.14.

**Backward compatibility**
- **Must:** B7.01, B7.02, B7.03 (updated to the N2-02 behaviour), B7.04, B7.05 (P3 to P4 window), B7.06, B7.07
  (`sw-checkin.js` plus the trimmed hub `sw.js`), B7.09.
- **Should:** B7.08, B7.10, B7.11.

**Regression:** G8.01–G8.11 must; G8.12–G8.13 should.

**Browser and device:** V9.01–V9.07, V9.09, V9.10, V9.14 must; V9.08, V9.11, V9.12 should.

**Load:** L10.01 (Easter surge, including the 1.5 s reserve under load), L10.02, L10.03, L10.04, L10.06, L10.08
must; L10.05, L10.07, L10.09 should.

### 5.2 Testability hooks (P2)
- **Server clock:** `app.locals.clock`, test mode only.
- **Shared rules:** pure functions in `checkin-rules.js`, with a golden fixture shared by the rules tests and the API
  tests.
- **Injection:** `notify` is injected, and the limiter comes from a factory.
- **Old schema in tests:** `openDb(path, {upTo})`.
- **Crypto:** functions take the clock and random source as parameters. The server secret comes from the test
  environment.
- **Browser runs:** WebKit Playwright runs for storage dumps.
- **Offline:** a replay simulator.

### 5.3 Manual device checklist
QA M1–M14, O-2 to O-5, plus:
- PBKDF2 timing (N2-34)
- the label printer layout with 6-character codes, check-in time and EPI on every printer model
- Home Screen re-add on the new host
- Guided Access or Single App Mode
- a household push on iPhone after a tag-holder release
- a lost-iPad drill, timed against the 15-minute target

### 5.4 Rehearsals and soaks
- **Migration rehearsal** on a restored backup copy before each migration PR (D6.01–D6.08). This includes deleting a
  past service, to check the guard.
- **Host-migration pilot** on one iPad, then one campus.
- **Two-Sunday soak** after pickup sessions are enabled, with the paper kit and a spare new-app iPad as fallback.
  Targets:
  - conflicts, `backup_prefix` and `lease_cloned`: 0
  - `server_issued` codes: counted
  - Tier A/B/C counts and timings sampled
  - tag-holder reviews done
- **One Sunday** after pickup alerts.

---

## 6. Operations readiness
The full text is in `operational-policy.md`. Summary:
- **People:** a duty rota per campus per service (two approvers and a runner, entered in the hub, because it drives
  offline codes).
- **Training:**
  - lanes and tiers
  - the tag-holder steps and the household "list only" option
  - the hard-block script
  - the medical levels ("details are for care only")
  - offline codes: how to get one, never share it, what to do if it's lost
  - the lost-iPad drill
- **Materials:** a desk card; signs ("You'll hand your tag over at pickup"); family communication two weeks ahead
  (5- and 6-character codes, tag kept at pickup, ID, the "list only" option, household notifications); the paper kit;
  the daily pickup-alerts sheet; a pre-service checklist.
- **Device policy:** supervised iPads, passcode, Guided Access or Single App Mode, iCloud Backup off, Web Inspector
  off, automatic time, a Home Screen web clip on the check-in host.
- **Records:** coordinator end-of-day review of tag-holder pickups; monthly medical access review; an annual retention
  review.

---

## 7. Implementation sequence (one PR per phase, deployed with flags off)

| Phase | Content | Size | Effort | Depends on | Main risk → mitigation |
|---|---|---|---|---|---|
| **P0** Prep (read-only) | Inventory on a backup copy (§4.1); **PBKDF2 timing on the slowest iPad**; iPad model, iPadOS and WebCrypto capability probe (static test page on a scratch instance); label print tests on each printer model; confirm Render custom domain and DNS (owner); designs (check-out card, tag-holder flow, operator pick, medical levels, migration screens); operations drafts; policy text; owner decisions | M | 2.5 d | — | Late answers → P1 doesn't depend on them |
| **P1** History protection and legal hold | m30; delete **and update** guard triggers (H1); soft alternatives in the services, positions, assignments, series and merge routes; volunteer past-status lock; void; listing filters; trigger-list invariant test (M3); legal hold UI with two-person release, 7-day cooling-off and Drive-aware pruning (M2, M10); two-person permits with tombstone and in-trigger hold check (M2); audit for roll-call un-marking and headcount edits (L2); tests N2-53–N2-62, N3-01–N3-04, N3-08–N3-09, N3-11, N3-19, N3-21 | L | 5 d | P0 inventory | Scheduling regressions → grep test, workflows 4 and 5; disk filling under a hold → Drive-aware pruning |
| **P2** Foundation and quick wins | m31; events and triggers (no FKs from append-only tables, M3); device/user/operator on rows; revoke with reason and a `reports_only` response; the `[method, path]` station allow-list and `requireCheckin` skeleton; `POST /people` household campus check and audit; pickup-route campus checks (F11); **column allow-lists replacing `SELECT *` on people and pickups, including `finance.js` (H2)**; client time bounds; ambiguity guard; per-id reports; limiter factory; **quick wins** (station token wins, no kiosk sign-in, **kiosk sessions ended server-side and at deploy (M12)**, headers, HSTS, SRI, no-store); version header; testability hooks | L | 6.5 d | P1 | Breaking old iPads → B7.01 golden tests |
| **P3** Check-in host and iPad migration | m32; `MB_CHECKIN_URL`; host gate; no cookie auth; `__Host-` station cookie with rotation; `x-station` refused on the check-in host; `sw-checkin.js` and manifest; hub `sw.js` trim; drain-then-replace flow with **server-enforced drain-only tokens, Replace gated on server-side pending = 0, fresh prefix when needed, and host-only delivery of sensitive data (M8)**; single revoked-token rule (M6); Stations pending counts and QR; 60-day old-host window; tests N2-37–N2-45, N3-16, N3-18; **owner:** DNS and Render domain (0.5 d ops); on site about 10 min per iPad | L | 7 d | P2; DNS ready | DNS/TLS on a Sunday → go live mid-week; old host kept |
| **P4** Codes, sessions, fast lane, tag holders | m33; leases (5/6 characters, 182 leasable, backup prefix, epoch with retry grace); online reserve; Web Lock; clone detection; one-transaction IndexedDB writes; paper-kit state and paper rules (M11); server-derived household and flags; `/pickup`, `/changes`, `/photo` (today's pickups only); lanes and tiers; multi-match careful lane; operator identity and age; tag-holder safeguards; household notifications; daily review; "list only" flag (coordinator step until P5 is "find a staff member"); lost tag, revoke and reissue; **offline tag-holder and lost-tag releases blocked until P5 provides day codes (M7)**; duplicates; undo; outbox v2; Rooms refresh and last-two-character code; labels and tag content | L | 10.5 d | P3 (all iPads migrated) | Line speed → O-1 gate; tag-holder misuse → R2 safeguards |
| *Soak* | Two Sundays, paper kit plus a spare iPad | — | calendar | P4 enabled | §5.4 go/no-go |
| **P5** Permissions and coordinator credentials | m34; `users.checkin`; explicit mode; duty rota UI; online PIN (server-generated, server-only, **scoped to no-alert children, real-time notice, 90-day rotation, no echo (H3)**); **offline day codes** (derivation, verifiers issued from 18:00 the day before, K_dev, envelope with **kid and `_PREV` keys (M4)**, server checks with **report-to-approval binding and uploader match (M5)**, limits, rotation, quarantine, verifier issue cap, "Rotate today's codes", lost-iPad report); `tag_holder_offline` and `lost_tag_offline` kinds (M7); Live page; `checkin_alert`; "list only" coordinator flow; check-in hours; tests N2-15–N2-34, N3-05, N3-06, N3-14, N3-15, N3-17; **owner sets the secrets** | L | 10 d | P4 | Crypto mistakes → Security pre-review of the code, property tests, Phase 0 timing |
| **P6** Child protection | m35; restrictions (quick form, forced linking, fuzzy match, ending confirmed by a **different** person (M2), expiring list, incident note); contacts extended, with notes in `pickup_contact_notes` (H2); delete guards on restrictions, contacts, pickups and overrides (M3); one-time people; ID policy; overrides with binding (alert children: phone only); careful-lane UI and Alert button; **two-person, 4-hour relaxation switch that never lifts do-not-release (M1)**; stale-list fail-closed; snapshot on the pickup; alert for a child already in a room; daily alerts sheet; enforcement on all paths; preconditions (explicit mode plus all iPads migrated); tests N3-07, N3-10, N3-12, N3-13 | L | 8 d | P5 | Leaking custody data → canaries, H7 precondition |
| *Soak* | One Sunday | — | calendar | P6 enabled | — |
| **P7** Medical levels, roster, labels | m36; Level 1 fields and UI; **Level 2 fetched on tap, online only, server-checked and server-logged (M9)**; Level 3 in `person_care_notes`, hub-only (H2); care-note endpoints; **router-wide canary sweep (H2)**; `sensitive_access_log` and review page; operator gating; review list for existing notes (including `allergies`); roster scope, minimisation and purges; all-campus search; label changes and per-term confirmation | M | 5.5 d | P4 (operator identity), P5 | Hiding a life-critical note → Level 1 always cached and printed; Level 2 needs a connection |
| **P8** History, dry-run retention, docs, release | History page and export (reason required, audited); "older than 13 months" access rule; retention **dry-run report** (no purges); docs (`database`, `permissions`, `security`, `api`, `features`, `testing`, `roadmap`, `tech-debt`); release checklist; full regression; Easter load test; rehearsals; device checklist | M | 3.5 d | P7 | — |
| **P9** (optional) Offline quick-add for first-time families | Client-made guest records, reconciled, with duplicate handling; added adults are "not yet known" | M | 3.5 d | P4 | Duplicates → reconcile screen |
| *Later, each separately approved* | Retention purge jobs (one-time phones, contact photos, lapsed medical notes, security logs, notification copies) | S each | 0.5–1 d each | P8 + insurer and attorney sign-off | Over-deletion → dry run, holds, logs |

**Totals**
- **Core: 58.5 working days** (P0–P8: 2.5 + 5 + 6.5 + 7 + 10.5 + 10 + 8 + 5.5 + 3.5), dev plus QA plus a half-day Security review per phase P1–P7, plus a Security
  pre-review of the P5 crypto code.
- **62 days with P9.** Purge jobs are not included. (Revision 2's "52" was a slip for 52.5. Revision 3 adds 6 days for the Security must-fix items.)
- Owner and operations time: 0.5 day DNS and Render; about 10 minutes per iPad to migrate; training sessions.
- Calendar: about **20–24 weeks**, including two soak windows, the iPad migration visits and a Christmas freeze.

### Steps (agents)
| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 1 | Inventory on a backup copy; iPad timing and capability probe; print tests | qa-engineer (owner restores the backup and provides iPads) | Yes | — |
| 2 | Designs: check-out card, tag holder, operator pick, medical levels, migration screens | ui-ux-specialist | Yes (designs) | — |
| 3 | Policy text, desk card, signage, family message, paper kit, duty rota format | church-operations | Yes | — |
| 4 | Owner decisions and approvals (checklist groups I and II); DNS | owner via the main session | — | 1–3 |
| 5 | P1 build → Security review → QA | senior-developer → security-specialist → qa-engineer | No → Yes → tests only | 4 |
| 6 | P2 build → Security review → QA | same | same | 5 |
| 7 | P3 build → Security review → QA → pilot migration → all iPads | same + owner and staff on site | same | 6, DNS |
| 8 | P4 build → Security review → QA (O-1 timing, N2-01 to N2-14) | same | same | 7 |
| 9 | Enable P4, two-Sunday soak | owner + church-operations (observe) | Yes | 8 |
| 10 | P5 build (Security pre-review of the crypto design and code) → Security review → QA | same | same | 8 |
| 11 | P6 build → Security review → QA → enable → soak Sunday | same | same | 10, 9 |
| 12 | P7 build → Security review → QA | same | same | 11 |
| 13 | P8 build → full regression, load, rehearsals | senior-developer → qa-engineer | No → tests only | 12 |
| 14 | Final review against this plan and the release checklist | chief-architect | Yes | 13 |
| 15 | (optional) P9 | senior-developer → security-specialist → qa-engineer | No → Yes → tests | 8 |
| 16 | (later) Each purge job, after insurer and attorney sign-off | senior-developer → security-specialist → qa-engineer, owner approval each | — | 13 |

Never two editing agents at once. Steps 1–3 run in parallel.

### Risks (summary)
| Risk | Mitigation |
|---|---|
| Delete guards break scheduling flows staff rely on (deleting old services) | Friendly 409 with a cancel offer; regression workflows 4 and 5; inventory of how often past services get deleted |
| Legal hold fills disk or Drive | 80% alert; holds are rare and scoped; the owner can move old copies off by hand (manual, audited) |
| DNS or Render custom domain not available | P0 check; fallback to quick wins with Medium risk accepted explicitly |
| iPad too slow for PBKDF2 at 600k | P0 measurement; 310k fallback; `iter` is per record |
| Teen picks an adult's name in `attested` mode | Logged; `phone` mode available; adult-only actions are audited and reviewed |
| Household adults without app accounts get no tag-holder message | Daily coordinator review; P0 coverage figure |
| Migration visits miss an iPad | Stations page status; old host 60 days; the move screen stays forever; alerts on old-token use |
| Old-app releases refused after enabling (forgotten iPad) | Enabling requires every station migrated (server-checked), so only a forgotten old-host iPad can hit this, and it is alerted |
| Crypto implementation error | Security pre-review; property tests N2-15 to N2-33; no hand-rolled primitives (WebCrypto and Node `crypto` only) |
| Policy and legal uncertainty (minimum age, retention, breach notification) | Insurer and attorney review items in the checklist; nothing destructive enabled before sign-off |

---

## 8. Owner decisions and approvals
All decisions, technical approvals and deployment approvals are in **`approval-checklist.md`**: 128 items in
revision 3 (group I church policy, 53; group II technical, 47; group III deployment, 28).
- 17 are already decided by the owner on 2026-11-25.
- **118 still need an owner decision or approval** (with the 7 items added in revision 3.2): 89 now, and 29 deployment approvals given at the time.
- Most of the 89 are routine. The **owner decision sheet** at the top of the checklist lists the 29 that need the
  owner's judgement, plus one line accepting all the other recommended defaults.

**Project-rule approvals in brief:**
- migrations m30–m36
- route behaviour changes from the delete guards
- roles, levels and explicit mode
- the online PIN and offline day codes, with two new environment secrets (and their `_PREV` companions)
- accepting today's code-only check-out until P4 (II-41)
- the check-in host and its environment variable
- residual risks
- each purge job

**Not needed:** no new dependencies, and no paid services. MDM is optional; if it costs money, it is a separate
approval (I-46).

---

## 9. Assumptions, open items and how each is resolved
| # | Assumption / open item | Resolved by | When |
|---|---|---|---|
| A1 | PBKDF2-SHA256 at 600k takes 0.15–0.3 s on the oldest desk iPad (**estimate**) | QA measures 5 attempts on the slowest real iPad; over 800 ms median means 310k | P0 |
| A2 | Every desk iPad's iPadOS supports WebCrypto ECDH P-256, HKDF, AES-GCM, PBKDF2 `deriveBits`, non-extractable keys in IndexedDB, and Web Locks | Capability probe page on a scratch instance, run on each iPad model; record models and versions. Fallback: a BroadcastChannel lock; older iPads are retired from desks | P0 |
| A3 | Label printers fit and print 6-character codes, check-in time and EPI legibly on 62×29 and other sizes; `window.print()` failure can't be detected | Print tests on each printer and label size; adjust font sizes; the "Print again" procedure | P0 |
| A4 | The church controls DNS for its domain and can add `checkin.` | Owner confirms and adds the CNAME | P0 (owner), before P3 |
| A5 | Render allows another custom domain with managed TLS on the existing service, at no cost, within plan limits | Owner checks the Render dashboard or plan; if blocked, owner decides on the fallback (quick wins only, Medium risk) | P0 |
| A6 | Legal duties: breach notification for a stolen iPad, retention periods, collector minimum age, recording ID type | Owner asks the insurer and attorney (and the denomination's safeguarding advisor if there is one) | Before enabling P4 (age, ID) and before any purge |
| A7 | Photo coverage of adults in child households (decides how often Tier A vs Tier B) | Inventory query | P0 |
| A8 | Kids-team volunteers have birthdates in the hub (needed for adult and teen) | Inventory count; staff fill gaps before P4 enabling; missing means the under-18 view | P0, then staff |
| A9 | Kids volunteers are scheduled in the hub on identifiable teams (operator pick-list) | Owner names the teams (`checkin_kids_team_ids`); church ops confirms the schedule is entered | P0 |
| A10 | Coordinators' phones usually have cellular data at church (phone approvals when Wi-Fi is down) | Church ops survey per campus; otherwise a hotspot plan | P0 |
| A11 | Device policy is achievable (supervised, Guided Access or Single App Mode, iCloud Backup off), and whether MDM costs money | Owner chooses Guided Access (free) or MDM (cost approval) | P0 |
| A12 | Push to iOS Home Screen apps is reliable enough for coordinator alerts and household messages | Real-device tests; fallback is the inbox, the runner and the daily review | P0/P4 |
| A13 | Enough household adults have app accounts to receive tag-holder notifications | Inventory figure; family communication encourages app sign-up | P0 |
| A14 | The roster (Level 1 safety lines only; Level 2 is fetched on tap and never stored, N5) fits iPad storage | Measure roster sizes per campus; L10.02 | P0/P4 |
| A15 | One Render instance (in-memory rate limits, SQLite single writer for the online reserve) | Owner confirms no horizontal scaling; recorded in architecture docs | P0 |
| A16 | Drive and disk space can absorb paused rotation during a hold | Measure backup sizes and growth; set the 80% alert | P0/P1 |
| A17 | How much of the existing `medical_notes` is private and should move to Level 3 | A coordinator samples by hand (not a developer); sets the effort for the manual review | P0 (staff) |
| A18 | SQLite `BEFORE DELETE` triggers fire and abort through FK cascades under `node:sqlite` | **Verified** by Security on Node 22 (two cascade levels; whole statement aborted; `tx()` rolls back). Test N2-59 keeps it true. | Done |
| A19 | Home Screen re-add and the new service worker work on each iPadOS version | Pilot migration on one iPad | P3 |
| A20 | Day codes use the **campus** time zone (the spec says "church"; campuses may differ) | Design decision recorded here; test N2-24 | P5 |
| A21 | Which iPads are not run from the Home Screen (Safari's 7-day storage eviction) | Stations page app version and host after P2; migration enforces the Home Screen | P2/P3 |
| A22 | Midweek programme times per campus (deploy windows) | Owner lists them | P0 |
| A23 | Volunteers are screened through the church's own process; the hub doesn't track background checks | Owner confirms; out of scope | P0 |
| A24 | iPads keep automatic date and time on | Device policy; skew warning in the app | P0 |
| A25 | The parent tag is handed over and kept at pickup (operational change for families) | Family communication; signage; soak feedback | P4 soak |
| A26 | Insurer and attorney review of the retention policy and the "list only" refuse mode | Owner | Before III-25 |
| A27 | One Render instance with the default libuv threadpool, so PBKDF2 verifier work must be capped (at most 2 at a time, at most 3 issues per device and code per day) | Owner confirms the instance count; L10 latency test | P0/P5 |
| A28 | Desk iPads stay powered and online overnight, or boot online before the service, so they pick up the next day's verifiers from 18:00 | Church operations procedure; pre-service checklist shows "Offline approvals ready" | P0/P5 |

---

## 10. Fix during implementation (from the revision-2 Security review)
These are not blockers for owner approval. Each is assigned to the phase that builds the area, and checked at that
phase's Security review.

| # | Phase | Issue | Change | Test |
|---|---|---|---|---|
| M13 | P3, P4 | False clone and logout alarms from epoch and cookie rotation on flaky Wi-Fi | The epoch advances only on an explicit single-in-flight `lease/renew`. Epoch n−1 is accepted for 2 minutes after n is first seen, and an alarm fires only if both keep being used after that. The old station token gets the same 2-minute grace. A 401 from a stale token never clears the queue or outbox. | Interleaved retries → no `lease_cloned`; a true clone alternating for 10 min → one alarm |
| M14 | P5 | Recomputing verifiers is a CPU and threadpool lever | At most 3 issues per (device, code) per day (304 otherwise); at most 3 manual rotations per campus per hour; PBKDF2 async with a semaphore of 2; A27 | 50 rapid approver calls → at most 3 PBKDF2 runs; `/healthz` p95 unchanged |
| L5 | P4 | "183 leasable" included `99` | 182 leasable; `99` never leased (applied in §3.2) | Allocator refuses `99` |
| L6 | — | Effort total was 52.5, not 52 | Corrected; revision 3 total is 58.5 (§7) | — |
| L7 | — | Cost at the 310k fallback | Stated in §3.7.9 | — |
| L8 | P5 | A script capturing V at download | Stated in §3.7.3; optional wrapped delivery of V | N2-21 dump |
| L9 | P5 | Meaning of "last contact", and out-of-order `seq` | Defined in §3.7.4; client uploads in order, server sorts | Shuffled batch → accepted |
| L10 | P5 | Hash the received `E`; reject invalid curve points | Specified in §3.7.4 | Off-curve point → invalid |
| L11 | P4 | Photo endpoint scope too wide | Today's open pickups only, rate-limited (applied in §3.5) | Not in today's pickups → 404 |
| L12 | P5 | Verifiers only during check-in hours; every admin's verifier on every iPad | From 18:00 the day before, whenever online; admins only when on the rota (applied in §3.7.2–3.7.3); A28 | N2-24 |
| L13 | P3 | The check-in host is same-site with the hub | Read only `__Host-mb_station`; ignore a tossed `mb_session` (applied in §3.9.2) | N2-37 with `Domain=parent` |
| L14 | P2, P4 | Signed-in laptops on the hub host, if kept (I-04) | Online-only, no roster cache, no verifiers, no restriction data | Hub-host session check-in → none of these |
| L15 | P2 | `no-store` missing on pickup, active, station | Added (applied in §3.9.1) | Header test |
| L16 | P2 | Today's client drops the token on `station_removed` | Distinct `reports_only` response; cookie kept (applied in §3.9.1) | Revoked device uploads its queue |
| L17 | P5 | `scryptSync` blocks the event loop | Async `crypto.scrypt` for PIN verify (applied in §3.7.1) | — |
| L18 | P7 | Free-text `allergies` becomes Level 1, which teens see | Added to the coordinators' manual review list (applied in §3.12) | — |
| L19 | P1 | Drive owner can delete held copies in Drive itself | Residual risk stated; notice and "Download a copy now" (applied in §4.9) | — |
| L20 | — | Desk attestations are client-attested | Wording applied in §3.1 and §3.3 | — |
| L21 | — | "Today's care notes" on a lost iPad depends on the phase | Phase-dependent wording applied in §3.7.7 and policy §11 | — |
| Consistency | — | Policy §9 gave Level 2 to "leaders" | Aligned: adult helpers (18+), coordinators, staff and admins (plan §3.6, §3.12, policy §9) | — |

