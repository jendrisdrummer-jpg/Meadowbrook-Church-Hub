# Kids' check-in: cutover from Subsplash (safety-critical release)

2026-11-25 · Planning only; nothing is implemented. This page amends [v1-strategy.md](v1-strategy.md) for a fact
confirmed by the owner: **Meadowbrook uses Subsplash for children's check-in today. The Hub's check-in is built but
not used at the desk.**

The initial migration therefore replaces Subsplash check-in, as **its own release**. Subsplash check-in stays in use
until every V1 safety requirement is implemented and verified and the exit criteria below are met.

The Subsplash **media** replacement is unrelated and stays much later.

**Every V1 safety requirement is unchanged.** That covers v1-strategy.md §2 (what V1 includes), §3 (manual processes),
§7 (testing) and §8 (unacceptable risks). This page changes only the route to launch and adds the cutover work.

Estimated independently by the Chief Architect and the Senior Developer.

## 1. What changes because the Hub's check-in is not live

**Disappears or shrinks:**
- **Interim pickup procedure and the "PR 1 live by 6 December" urgency.** Families are not exposed to the Hub's
  check-out flaws, because Subsplash runs the desk.
- **Converting a live flat offline queue.** No iPads run the old app, so the per-release outbox ships from day one.
- **The staged switch for old app versions.** Version reporting stays, for updates during the rollout. Refusing
  unversioned clients can be on from launch.
- **Cleaning stale data on existing iPads.** The code is still required, but there is nothing to clean.

**Stricter than before:**
- **Accepted risk II-49 is gone.** That risk was "today's label keeps printing full medical notes".
- **The Hub launches with the Level 1 label only.** Sorting every child's medical notes into Levels 1, 2 and 3 is a
  **launch gate for each campus**.

**Unchanged:**
- **V1 contents:**
  - all fourteen V1 items
  - every manual role and procedure
  - the testing definition of done
  - the unacceptable-risk list
- **Shared live code:**
  - **History triggers.** They still need the cascade spike and a rehearsal on a restored backup, because
    `assignments` and `people` are live data.
  - **Access PR.** It still needs the owner's approval, because it changes live roles used across the Hub.

**Still urgent regardless:**
- **The Hub already holds people data that leaders can read.**
- **PR #51 and the interim check-in roster restriction** (master roadmap §3) stay first in line. Neither depends on
  Subsplash.

## 2. Cutover work V1 did not count

| Work | What it involves |
|---|---|
| **Subsplash import** | **Matching.** Match children and adults to Hub people who already exist (imported from Faith Teams) by external id, or name and birthdate. Dry-run diff first; **never create duplicates.** **Data imported:** pickup contacts; Level 1 allergens and EPI; children's medical notes to Level 2; private matters flagged for Level 3. Rejects list and audit row. Tests include canary strings in imported notes |
| **Holds and custody** | **Never bulk-imported.** The safeguarding lead enters each hold by hand from the confidential list, and a second person checks it. Cross-check that no restricted adult is also a listed pickup contact |
| **Export file handling** | Kept off synced laptop folders. Deleted after reconciliation, with the deletion recorded |
| **Human verification** | Staff check each child's Level 1 and pickup contacts against Subsplash, using a reconciliation list that must reach zero. Optionally parents confirm their details at their first Hub check-in |
| **One source of truth** | From the day a campus pilots, the Hub holds that campus's medical and pickup data, and Subsplash edits stop by procedure. Before each further campus: a fresh export and diff |
| **iPads** | Home Screen app, pairing with station letters, Guided Access, passcode, Find My |
| **Label printers** | The Hub prints through Safari, so **every printer must work with AirPrint**. If the current printers only work with Subsplash's own app (Bluetooth or SDK), replacements are a purchase that needs owner approval |
| **Real-device testing** | Every iPad and printer model at every campus. Wi-Fi at each desk. An offline drill and a network cut mid-sync |
| **Volunteer training** | Desk volunteers, coordinators and room leaders at each campus, with the desk card and the paper kit |
| **Parent communication** | About two to three weeks ahead: new tags and codes, and checking their details. Signage at the desk. Whether Subsplash pre-check-in goes away (the Hub has no equivalent in V1; building one is a separate decision) |
| **Rollback** | Subsplash stays paid and ready until the exit criteria are met. A failure during a service falls back to the paper kit; the next Sunday reverts to Subsplash; paper records are entered on Monday. Who decides on a rollback is named in advance |

## 3. Estimate (agent-assisted team hours)

The two estimates agree on the engineering. They differ on how much device, training and rollout work the team
carries.

| Work | Senior Developer | Chief Architect |
|---|---|---|
| **Code** | 48 | 105–130 |
| **Tests** | 32 | 50–60 |
| **Security review** | 16 | 20–28 |
| **Docs, desk card, training material** | 14 | included below |
| **Engineering subtotal** | **about 110** | **about 175–220** |
| **Subsplash import, pickups, holds entry, verification support** | 22 | 15–25 |
| **iPad and printer setup, real-device testing** | 14 | 50–60 |
| **Rehearsal, training, parent communication, pilot, rollback** | 22–26 | 35–40 |
| **Total** | **about 150–185** | **about 280–340** |

**Planning figure: about 200–300 hours.** It is fixed once the owner's facts are in (number of campuses, iPads,
printers and the export format), because those drive the device, import and rollout work.

**Compared with the V1 plan's 205–240 hours:**
- **Shrink:** about 15–40 hours of V1 does not apply, because the Hub is not live at the desk.
- **Addition:** the cutover work above is new.

**Owner and staff time (not in the totals):**

| Who | What | Time |
|---|---|---|
| Owner | PR review and decisions | 15–30 h |
| Staff | Medical sorting and verification, for about 150–250 children | 15–30 h |
| Staff | Holds list | 2–3 h |
| Tech volunteer | Device setup | 3–4 h per campus |
| Volunteers | Training | about 2 h each |
| Dress rehearsal | 6–8 people per campus | 2 h each |

## 4. Calendar

The dates are realistic but not promises. **If a gate fails, the date moves; the gate doesn't.**

| Window | What |
|---|---|
| Now – 18 Dec | **PRs:** V1 PR 1, PR 2 and PR 3 (PR 2 and PR 3 need owner approval). **Owner facts:** collect them, and get a sample Subsplash export |
| 19 Dec – 3 Jan | Freeze: no deploys; branch work only |
| 4 – 29 Jan | **PRs:** PR 4, PR 5, the import PR. **Review:** security review |
| 1 – 14 Feb | **Pilot campus preparation:** import dry run, then the real import, and staff verification to zero. **Setup and people:** devices and printers set up; training; parent notice |
| Sat 20 Feb | Dress rehearsal and paper drill at the pilot campus |
| **Sun 21 Feb – 7 Mar** | **Pilot:** three Sundays (smallest service first, then the busiest), with Subsplash on standby |
| 14 Mar – 11 Apr | **Easter window** (Palm Sunday 21 Mar, Easter 28 Mar). No new campus. The pilot continues only if its Sundays were clean; otherwise it reverts to Subsplash |
| From 18 Apr | One further campus about every two weeks: re-export, diff, verify, rehearse, go live |
| About mid-June 2027 | Subsplash check-in switched off, assuming 2–3 campuses |

**Fastest responsible:** a pilot from 7 February, with the other campuses still after Easter.

**Kids' volunteers are not given the Hub for scheduling and for check-in in the same month.**

## 5. Exit criteria: when Subsplash check-in may stop

All of these must hold:
1. **Clean Sundays:** every campus has had four consecutive Hub Sundays with:
   - zero wrong releases
   - zero code clashes
   - zero lost records

   Each Sunday is reviewed on the Monday after.
2. **Data reconciled:** every campus's reconciliation list is at zero, and holds are verified by two people.
3. **Drills passed:** a paper-kit drill at every campus, and a lost-iPad drill.
4. **Every V1 test passed:** every item in v1-strategy.md §7 passed, with the owner's signed test report saying what
   wasn't tested.
5. **History archived:** a final Subsplash export of check-in history is archived, for records and legal hold, before
   access ends.
6. **Parents told:** parents have been told about any change to pre-check-in.
7. **Sign-off:** the owner and the kids' director sign off in writing.
8. **Rollback month:** Subsplash check-in stays available for one more month as a rollback, then that part is
   cancelled. Subsplash media is unaffected.

## 6. Facts and approvals needed from the owner

**Facts:**
1. **Campuses and services:** which ones, and how many children each Sunday.
2. **Stations:** how many, and each iPad's model and iPadOS.
3. **Printers:** make and model per desk, label sizes, how they connect today, and **AirPrint support**.
4. **Subsplash export:**
   - format (file or API)
   - which fields: allergies, medical notes, authorised pickups, custody flags
   - whether check-in history can be exported
5. **Pre-check-in:** whether parents use Subsplash pre-check-in or a QR code today, and whether that may lapse.
6. **Contract:** the Subsplash renewal date, the notice period, and whether month-to-month is possible.
7. **Pilot:** the pilot campus, and who decides on rollback.
8. **Named people:**
   - the safeguarding lead and a backup
   - duty coordinators
   - a tech volunteer
   - the paper-kit owner

**Approvals:**
- the cutover approach and calendar
- the PR 2 migration and triggers
- the check-in access flag (a permission change)
- any printer purchase
- keeping Subsplash paid until the exit criteria are met
- the export-file handling rules
