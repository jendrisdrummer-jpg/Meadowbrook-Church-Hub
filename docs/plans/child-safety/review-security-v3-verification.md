# Security verification: child-safety plan, revision 3

Security Specialist · 2026-11-25 · Read-only. No repository file was changed.

**Checked:**
- `plan.md` (revision 3), `operational-policy.md` and `approval-checklist.md` (128 items), against the 19 must-fix items in `review-security-rev2.md`.
- I read the plan's body text, not only the change summary (§00), and compared it with the code on `main` @ `03b094f`.

## Verdict: ready for owner sign-off, with minor notes

- All 19 must-fix items are addressed in the body text, consistently across the plan, the policy and the checklist.
- The fixes introduce two new Medium issues (N1, N2) and six Low issues (N3–N8). None needs a redesign.
- N1 and N2 are one-line text changes inside Phase 1. Apply them before the P1 build; they don't need another Security pass.

## The 19 items

| # | Item | Result | Where verified |
|---|---|---|---|
| 1 | H1 history rewrite | **Pass** (see N1) | §4.2: `services_no_retime` and `assignments_no_restatus` triggers; `PATCH /assignments` gives 409 on past services; `removed_at` for corrections; `PATCH /series` clamps both dates; grep test; §4.4 says "delete or retroactively alter" |
| 2 | H2 `SELECT *` leak | **Pass** | §3.12 and §4.3: `person_care_notes` and `pickup_contact_notes` tables; `PERSON_PUBLIC_FIELDS` allow-list covering `people.js:24`, `:116`, `finance.js:108` and the roster; grep test; router-wide canary sweep including the station's `POST /people` and its 409 body; 73 tables, consistent in §4.2 and §4.3 |
| 3 | H3 PIN scope | **Pass** | §3.7.1: 409 "Phone approval needed" for any alert child; notice in the same request; 90-day rotation and rotation on "Not you?"; no digit echo. §3.3 and policy §10 match. II-47 added |
| 4 | M1 kill switch | **Pass** (see N4) | §4.8: never lifts `do_not_release`; two different people; at most 4 h. Policy §7, III-27 and I-51 match |
| 5 | M2 single-admin bypasses | **Pass** (see N7) | §4.2 permits: two-person, hold check inside the trigger, `history_deletions` tombstone. §4.9: two-person release, 7-day `deletion_resume_at`. §3.4: a *different* person confirms, never the requester or the child's household |
| 6 | M3 trigger durability | **Pass** | §4.2: trigger-list invariant test, rebuild rule, plain-integer ids in append-only tables, new guards, guards counted in `people_keep_history`. A18 marked verified. II-44 |
| 7 | M4 secret rotation | **Pass** | §3.7.2: `kid:` formats, `_PREV` for 14 days (validation only), runbook, `secret_kid`. §3.7.4: `kid` in `env` and in the HKDF info. II-42 |
| 8 | M5 approval binding | **Pass** | §3.7.4: the report cites `approval_id` and must equal `E`; one approval covers one release; `E.device_id` and `E.campus_id` match the uploader (check 1 and 5a) |
| 9 | M6 revoked-token rule | **Pass** | §3.9.4 single table (lost or stolen and "other" are quarantined; replaced is applied with no time limit); §3.7.4 check 1, §3.7.7 and policy §11 match; "7 days" removed |
| 10 | M7 offline tag holder and lost tag | **Pass** | §3.3, §3.5 step 7, §3.7.5 (`tag_holder_offline`, `lost_tag_offline`), §3.8, §3.3 rule 4; policy and I-53 match |
| 11 | M8 old, migrating and old-host tokens | **Pass** | §3.9.3: `migrating_at` drain-only, server-enforced; day-60 drain-only; sensitive data only to `host = checkin`; Replace gated on server-side pending = 0 and fresh prefix. §3.9.2: no `x-station` on the check-in host. II-43 |
| 12 | M9 Level 2 gating | **Pass** (see N5) | §3.12: fetched on tap from `/checkin/care-note/:child`, server checks and logs; never in the roster or `/changes` (§3.8); Level 1 always cached; I-52; policy §9 matches |
| 13 | M10 disk safety under a hold | **Pass, with a gap** (N2) | §4.9: Drive copies kept; local copies pruned to 3 only when safe in Drive; Drive disconnect refused. The branch without Drive can still fill the disk |
| 14 | M11 paper fallback | **Pass** (see N6) | §3.2 and policy §12: who's collecting first, names first, tag half kept, tag-holder rules with a coordinator, under-18 limit |
| 15 | M12 kiosk sessions | **Pass** (see N3) | §3.9.1: both credentials present ends the session server-side and audits it; III-03 |
| 16 | L1 promise wording | **Pass** | §3.2 and policy §1 use the new wording; the offline single-match case is explained |
| 17 | L2 audits | **Pass** | §4.2: `attendance.unmark` and `headcount.update` (old → new) added in P1; the within-day limit is stated |
| 18 | L3 two-person wording | **Pass** | Policy §10 is universal; §3.3 says "The requester can never be the approver" |
| 19 | L4 status-quo acceptance | **Pass** | II-41 (about 10–13 weeks) |

## New issues introduced by the fixes

### N1 · Medium · The H1 update guards block legitimate declines and reschedules for the next day
**Where:** §4.2 `assignments_no_restatus` and `services_no_retime`, both keyed on `starts_at <= now+14h`.

**What happens:**
- `now+14h` is the right threshold for the **delete** guards: blocking is the safe direction, and cancelling is the alternative.
- For **updates** it also blocks services that are up to about 14–26 hours in the future, depending on the campus time zone.
- Two ordinary actions then fail:
  - A volunteer who is sick on Saturday at 8 pm can't decline their 9 am Sunday slot (`services.js:514-522` → trigger abort → 500).
  - Staff can't move tomorrow morning's service by a day or a few hours, for example for snow.
- These are routine flows, and the plan's route text says "past services" only.

**Fix:**
- In the two **update** triggers, use the "definitely past for every time zone" threshold, `starts_at <= strftime('%Y-%m-%dT%H:%M','now','-14 hours')`.
- The routes enforce the exact campus-local "has started" check, using `localNow(campus.timezone)`, with a friendly 409.
- Keep `now+14h` for the delete guards.

**Test:**
- A decline for a service starting in 10 h → 200.
- A decline 2 h after the start → 409 from the route.
- A decline 20 h after the start → the trigger aborts.
- Retiming tomorrow's service → 200.

### N2 · Medium · A hold without Drive can still fill the disk that holds the live database
**Where:** §4.9 effect 1, "If Drive isn't connected"; `backup.js:204-211`.

**What happens:**
- Local pruning pauses, and alerts fire at 60% and 80%.
- Acknowledging the disk risk doesn't prevent anything. Nightly copies keep accumulating until SQLite writes fail, which is a check-in outage.

**Fix:** under a hold, at ≥ 85% disk usage, **skip creating new backups** rather than deleting held ones. The held copies are the evidence. Send an urgent alert to all admins: "Backups paused: connect Drive or move copies off the server." Also align A16, which still says "80% alert", with 60%/80%/85%.

**Test:** a hold without Drive on a simulated 85% disk → no new backup file, held files intact, the alert is sent.

### N3 · Low · The P2 sign-out step depends on data the server doesn't keep
**Where:** §3.9.1 item 1 and III-03, "sessions seen from a station device's user agent or IP".

**What happens:** `sessions` stores only `token`, `user_id` and `expires_at` (`db.js:84-88`), so those sessions can't be found that way.

**Fix:** rely on the new server rule. A kiosk sends both its cookie and `x-station` on its first check-in call after deploy, which ends the session. The deployment step becomes:
1. Open each kiosk once after the deploy.
2. Confirm a `kiosk_session_ended` audit row, or none.
3. Use "sign out everywhere" for anyone known to have signed in on a kiosk.

### N4 · Low · The relaxation switch's effect is undefined
**Where:** §4.8 versus §3.3, lines 340-341.

**What happens:** fuzzy matches and `check_first` already need "coordinator approval by phone". Turning them "into coordinator approval by phone" changes nothing.

**Fix:** state the concrete effect, for example "fuzzy-name matches are ignored and `check_first` may also be approved by PIN", or drop the switch.

### N5 · Low · Wording around Level 2
- **Where:** §3.12, `?operator=`. The server checks that the *claimed* operator is an adult; the operator pick is self-attested (II-36). Add "(attested operator)".
- **Where:** label text. "MEDICAL: see room list" is misleading while offline. Use "MEDICAL: full note on Rooms when online, or ask coordinator".
- **Where:** A14. It still mentions "today's Level 2 notes" on iPads; remove that.

### N6 · Low · The paper rule refers to "an adult on the family's list", but the paper kit has no lists
**Where:** policy §12, step 5.

**Fix:**
- On paper, only the parent written on the sheet collects without a coordinator.
- A "listed adult" is confirmed by the coordinator, by phone or from the hub.
- "List only" households always need the coordinator.

### N7 · Low · The hold check inside the trigger must match the two-step release columns
**Where:** §4.2 says `released_at IS NULL`; §4.3 m30 has `release_approved_at`.

**Fix:** the trigger and `backup.js` test "active" as `release_approved_at IS NULL OR deletion_resume_at > now`, so permits also wait out the 7-day cooling-off.

### N8 · Low · The `_PREV` key window needs a recorded rotation time
**Where:** §3.7.2 and §3.7.4.

**What happens:** the server can't know when a `_PREV` environment value was set.

**Fix:** record `kid` first-seen and rotated-at times in a settings row, and refuse `_PREV` after 14 days on that basis.

## Specific questions checked

**H3, notice reliability:**
- The PIN is online-only, so the notice is always generated server-side in the same request.
- The inbox row is durable; push is best effort (A12). Acceptable.
- Alert children fail closed to phone-only, so if the network is down they wait. That is consistent with §3.8.

**M9, offline safety for helpers:**
- Level 1 (allergy, EpiPen, action, where the medicine is) is always cached and printed.
- Children who need more have "print full note on label".
- Coordinators can fetch the full note on a phone with cellular data.
- Acceptable, with the owner's I-52 acceptance.

**Triggers versus legitimate operations:**
- **Merge** (`people.js:183-208`): `UPDATE OR IGNORE … SET person_id` doesn't touch `status`, so the guards don't fire. The leftover-duplicate `DELETE FROM assignments` would abort, and the plan changes the route to leave those rows on the archived duplicate (§4.2). The attendance delete in merge is unguarded and acceptable.
- **CSV import** (`people.js:326-360`): only inserts, so it is unaffected.
- **`DELETE /users/:id`:** unaffected now that append-only tables carry no foreign keys.
- **`ensureServices`:** only inserts.
- **`PATCH /series` clamped to today:** may still retime *today's* already-held service within the same day. That is allowed by design and audited.

**Counts:**
- 14 new tables, giving 73, consistent in §4.2 and §4.3.
- 182 leasable prefixes, with `99` reserved.
- The checklist totals 128.
- Effort is 58.5 days.

## Handoff
- **To the `chief-architect`:** apply N1 and N2 (one line each) before P1 starts, and N3–N8 at any time.
- **To the `qa-engineer`:** add the tests for N1 and N2 to N2-55 and N2-61.
