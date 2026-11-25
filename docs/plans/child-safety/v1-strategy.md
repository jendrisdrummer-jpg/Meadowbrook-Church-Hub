# Kids' check-in: Version 1 strategy (build what Meadowbrook needs first)

2026-11-25 · Planning only; nothing is implemented. The owner asked for the smallest version of kids' check-in that
Meadowbrook can responsibly use, then a plan to improve it, without the child-safety project taking over the whole
Church Hub schedule.

**How this was made:**
- The Chief Architect, Security Specialist, Church Operations, QA Engineer and Senior Developer each reviewed every
  item in revision 3.2 independently, against today's code.
- Each then read the other four positions and challenged them.
- This page is the consolidated result.
- Where they still differ, the stricter safe choice was taken, and the difference is noted.

**Amended by [subsplash-cutover.md](subsplash-cutover.md):** Meadowbrook uses Subsplash for check-in today, so the Hub's
check-in is not yet live at the desk. That page changes the route to launch and adds the cutover work; **every safety
requirement on this page stands.** Where the two differ on timing or interim steps, the cutover page governs.

**If the owner approves this page,** it sets the scope of the **first release (V1)**. The revision 3.2 design
([revision-3.2.md](revision-3.2.md), [plan.md](plan.md)) stays as the reference for Version 2 and 3. **No child-safety
requirement is weakened.** Some are now met by a simpler mechanism or by a documented manual step with a named owner.

---

## 1. The headline
- **Most of revision 3.2's cost was infrastructure for rare cases:** offline cryptographic codes, leased code
  prefixes, a second web address and storage isolation, plus full automation of approvals and notifications.
- **The real child-safety failures are in today's code, and they are cheap to fix.** Verified in the code:
  1. **One code can release two families' children together.** The check-out screen offers "Check out all" across
     households (`public/js/checkin.js` `showMatch`). The server's `{ids}` path checks nothing.
  2. **Codes clash:** 4 random characters made on each iPad independently. That is about an 8 % chance of a clash
     each Sunday at 300 families.
  3. **History can be deleted:**
     - Stations and leaders can hard-delete check-ins.
     - Deleting a service, a position (with force) or a series "from" a date deletes the history with it.
     - Deleting a person cascades.
  4. **Any team leader can read the whole church's check-in roster:**
     - Leading a team makes you a leader with no campus limit (`server/routes/teams.js` ~139).
     - The roster sends every household with a child, including **adults'** medical notes, phones and birthdates
       (`server/routes/checkin.js` ~23–44).
  5. **A station or leader can add an adult to an existing household.** That adult then appears under "Allowed to
     pick up" (`server/routes/people.js` ~133–145).
  6. **Data piles up on the iPads:**
     - Daily lists are never cleared.
     - Unpairing leaves the roster.
     - Offline check-outs get the time they were synced, not the time they happened.
  7. **No do-not-release flag exists.**
  8. **Sessions and labels:**
     - A hub session on a kiosk overrides the station.
     - Labels print full medical notes and the family name.
- **V1 fixes all of these, adds a small number of essential features, and leaves the rest manual or for later.**

---

## 2. What V1 includes (P0: required before use)

| # | Need | V1 mechanism (simplest correct) | Reuses |
|---|---|---|---|
| 1 | Unique, reliable pickup codes | **5 characters: a station letter fixed at pairing (unique per campus; a replacement iPad keeps it) plus 4 random characters.** The iPad avoids codes already in its list for today. The server flags any clash on upload as a backstop. Works offline with no wait. The existing alphabet already excludes look-alikes (0/O, 1/I/L, 2/Z, 5/S). | Pairing, alphabet, upload |
| 2 | Correct child-by-child check-out | **The two-family stop:** a code matching more than one household shows each family separately. **"Check out all" is removed;** each child is ticked. **Server guard:** a 409 on both check-out paths, recorded with the server-known identity. **Outbox:** one entry per release, carrying the real check-out time; replays are recorded, never refused. | Check-out screen, outbox, server route |
| 3 | Authorised pickup | **What the iPad may do:** release only to a household adult or a listed pickup contact, with the tag. **Everyone else** (someone holding the tag but not listed, a lost tag, unclear matches): the **coordinator comes to the desk, checks ID and phones a parent on file.** The release records who collected (`checked_out_to`: name, relationship, ID type). **Adding adults:** stations and leaders can no longer add an adult to an existing household; pickup-contact changes get campus checks and an audit row. | Household pickup contacts |
| 4 | Do-not-release / custody | **The hold:** a staff-set **"Hold: see coordinator"** flag on the child. The iPad shows it in red and **blocks release online and offline**, with no override on the iPad. Only staff with check-in access can release a held child, in the hub, and it is audited. **Details:** no details go to the iPad; they stay on the confidential paper list kept by the safeguarding lead. **Offline:** release only if the roster was refreshed today. | — (new, small) |
| 5 | Volunteer permissions | **A check-in access flag** (like the Finance flag) for anyone using check-in from a hub account. Leading a team no longer grants the roster. **Stations:** they keep working as now; the station token always wins over a hub session; no sign-in on kiosks. | Station tokens, guards |
| 6 | Necessary medical information | **Level 1** (always on the iPad and the label): allergen words, an **EPI yes/no** flag and a one-line action, never cut short (if it doesn't fit: "ALLERGIES: SEVERAL, SEE ROOM LEADER"). **Level 2:** the existing `medical_notes`, children only, **shown on tap while online and logged on the server**; never printed; offline it shows "needs a connection". **Level 3:** a new hub-only `care_notes` field for private matters, never sent to iPads. **The switch is gated:** labels stop printing full notes only once staff have sorted every child's existing notes (zero left to review). Until then today's label stays: accepted risk II-49. | `allergies`, `medical_notes`, Rooms view |
| 7 | Protection of history | **Voiding instead of deleting** check-ins (stations can't void). **Database triggers** that refuse deletes on `checkins` and on past `assignments`. A one-hour spike first proves they fire on cascaded deletes, so deleting a person or past service then fails safely. **Route fixes:** past-service delete, series "stop from" over past dates, and position force-delete now archive instead. | Existing routes |
| 8 | Legal hold | **A church-wide hold setting** that really blocks void, merge and history deletes, and pauses backup pruning. Plus a **written procedure**: on an allegation, the named admin copies the current backup to an unmanaged "Legal hold" folder the same day and records it in a register. **No retention automation ships until then (R4).** | Backups |
| 9 | Safe offline behaviour | **Check-in:** works offline as today, with 5-character codes. **Check-out offline:** the iPad releases only when the code matches exactly one household, no child has a hold, the adult is a household adult or a listed contact with the tag, and the roster is from today. Otherwise it's the paper procedure. **No offline approvals of any kind.** | Outbox, cached roster |
| 10 | Data on iPads | **Roster minimised:** children and their household adults' names and contacts only; Level 1 medical only; no adult medical notes or birthdates. **Clean-up:** old days' lists are cleared once synced; unpairing wipes everything except unsent records. **Headers:** `no-store` on roster responses; `frame-ancestors 'none'` and a CSP on the check-in page. | — |
| 11 | Manual fallback | **A printable "who's in the building" sheet,** made from the cached list, that works offline. **The paper kit:** numbered tags and sign-out sheets. **A rehearsed procedure** with a named owner. | Cached list |
| 12 | Rollout safety | **Each station reports its app version** on the Stations page. Mixed-family requests from old app versions are recorded and alerted. An admin switch turns on refusal for old versions once every iPad shows the new one, because Guided Access keeps old code in memory. | Stations page |
| 13 | Labels and tags | **Child label:** first name, last-name initial, room, date and time, code, Level 1. **Parent tag:** code, date and time, number of children and their initials. **Not printed:** family name, full last name or full notes. | Label templates and sizes |
| 14 | Testing | See §7. | `test/`, `npm run test:ui` |

---

## 3. What stays manual in V1 (safe only with the owner and procedure named)

| Process | Owner (role) | Procedure and frequency | What failure looks like, and the guard |
|---|---|---|---|
| Release to anyone not on the list, or with a lost tag | Duty coordinator (one named per service, never approving their own family) | Comes to the desk. Checks ID. Phones a parent on file while the child stays in the room. Records it on the paper log; the iPad records who collected | No coordinator named → no release. The desk card names them each Sunday |
| Family told after such a pickup | Duty coordinator | Texts or calls a parent within the hour (a tick box on the desk card) | Forgotten on a busy day → the Monday review catches it |
| Review of unusual pickups | Safeguarding lead (backup named) | Every Monday: the paper log plus the hub's check-out list for the weekend (splits, holds, refusals, non-household releases) | Lead away → the backup does it |
| Pickup-alert details (custody, court orders) | Safeguarding lead; the pastor decides who is listed | The system flag blocks release. The details are on a confidential paper list: the restricted adult's name and description, the child, the room. Numbered copies for the desk and the affected rooms, collected and shredded after each service, updated when a case changes | A copy lost → the lead is told the same day. If listed children exceed about 10, move the details into the system (V2) |
| Approved check-in people | Children's pastor plus an admin | Keep the check-in access flag list (about 8–15 adults per campus). Review each term; remove people the week they step down; screening is under church policy, recorded outside the hub | Stale list → the term review is in the church calendar |
| Paper fallback | Campus kids' director | The kit is checked every Sunday before doors open. A 10-minute drill before launch and once a term. Paper records are entered in the hub on Monday | No drill → no launch |
| Device policy | Tech volunteer or admin | Guided Access, a passcode, Web Inspector off, Find My on the church Apple ID, no personal iCloud backup. Each iPad reloaded after an app update; versions checked on the Stations page | Lost iPad → removed in Stations within 15 minutes (drill before launch) |
| Records and retention | Admin | **Delete nothing.** No automated retention. Back up before bulk edits. The policy goes to the insurer and attorney | — |
| Medical-note sorting before the label switch | Kids' director plus office staff | One pass through a review list: move allergens and EPI into Level 1, private matters into Level 3, the rest stays Level 2. Check that no allergy exists only inside the notes | Not finished → labels keep today's notes (II-49) until it is |

---

## 4. Technical items postponed, and the real risk

| Item | V1 | Real risk if postponed | Why that's acceptable for V1 |
|---|---|---|---|
| Separate check-in web address and storage isolation | **V2** | A script injected anywhere on the hub that runs **on a kiosk** could read the station token and roster | Kiosks never sign in to the hub and run only the check-in Home Screen app under Guided Access. The roster is minimised, a CSP and `frame-ancestors` are on the check-in page, and the token reaches check-in at one campus only. Recorded as High tech debt; revisit if kiosks can't be locked down |
| Offline coordinator credentials (day codes, PBKDF2, the encrypted envelope) | **V3** (P3 for Meadowbrook) | An offline exception (lost tag, a non-listed collector) waits for the paper procedure | **R5 is met by not having offline approvals.** Nothing to steal, nothing to crack. Rare, and safe |
| Leased code prefixes, epochs, clone detection | **V3** | A restored or cloned iPad repeats codes | Never restore an iPad from backup; re-pair it. The server flags clashes, and the two-family stop fails safe |
| Phone confirmation and the approved-release roster automation | **V2** | Approval relies on the coordinator being physically present | The coordinator at the desk plus a parent call is stronger in person than a tap |
| Device management (MDM) | **V3** | Settings drift; a lost iPad's settings can't be wiped remotely | Guided Access plus the Sunday check plus the lost-iPad drill. The token is revoked from the hub |
| Automated retention | **V3**, after insurer and attorney sign-off | Data is kept longer (privacy, not safety) | Nothing is deleted at all |
| Scoped legal holds, two-person release, cooling-off | **V2** | One admin could clear the church-wide hold | It is audited, the owner is told, and there is the written register |
| Advanced audit reporting (exceptions page, access-log page) | **V2** | Patterns are spotted on Monday rather than live | Every release, refusal, void, hold change and medical view is still **written** to the audit log in V1 |
| More notifications (household push after a tag-holder release, alert routing) | **V2** | Families hear later | The coordinator calls or texts the same day (manual) |
| Update guards (no rewriting of past records) | **V2** | A quiet edit of a past record | Rare; nightly backups. Admin spot-check each quarter |
| HSTS, SRI on the media player, the full CSP across the hub | **V2** (early) | Hardening rather than an open hole | HTTPS on Render; the media player isn't loaded on the check-in page |

---

## 5. Version 2 and Version 3

**Version 2: Improved Meadowbrook release** (after V1 has run for 4–6 Sundays; built in slices, alternating with other
Church Hub work):
- **Security and isolation:**
  - the separate check-in address, with each iPad migrated
  - the station token in a secure cookie
  - HSTS, SRI and the full CSP
- **Releases:**
  - coordinator approval from their own signed-in phone, with the release roster (review dates, the screening tick)
    and phone confirmation of tag-holder releases
  - the "list only" family setting with a strict mode
  - the Monday review page and the exceptions page
  - the household notification after a tag-holder pickup
- **Records:**
  - the medical access-log page
  - scoped legal holds with two-person release
  - update guards
  - the history page and export
- **Restrictions:** restriction details in the system (when paper stops scaling), fuzzy name matching, and ending a
  restriction needing a second person.
- **Operator identity:** "Who's on this desk?" with an adult check.
- **Effort:** roughly **150–200 team hours** (Senior Developer: about 230–250 at human pace), as 5–7 PRs over about
  2–3 months of alternating weeks.

**Version 3: Mature platform** (only when needed, or for other churches):
- offline coordinator day codes (the full design already exists in
  [security-credentials-and-isolation.md](security-credentials-and-isolation.md))
- leased prefixes and clone detection
- MDM integration
- retention purge jobs (after legal sign-off)
- per-church policy settings (age limits, ID rules, label fields) in `settings`
- tenancy-aware audit
- a native app only if the web app's limits really bite

Nothing in V1 blocks this path: station letters, holds and check-in access all carry `campus_id`, and church-level
values live in `settings`.

---

## 6. V1 pull requests, effort and calendar

| PR | Contents | Depends on |
|---|---|---|
| **1. Check-out guard** | Two-family stop, child by child, server 409 on both paths, per-release outbox with the real time, replays recorded, version report, stale-data clean-up, tag and label privacy (no family name, last initial) | — |
| **2. History** | Spike, then the `checkins` and past-`assignments` triggers, void, route fixes, the hold setting | Built alongside PR 1; merged after it |
| **3. Access** | Check-in access flag (owner approval), station token wins, no kiosk sign-in, household-adult fix, pickup-contact checks and audit, roster minimised, `no-store`, `frame-ancestors`, CSP on check-in | PR 2 (both touch `people.js`) |
| **4. Codes and medical fields** | 5-character station-letter codes, server clash flag, Level 1 fields and new label, Level 2 on tap (online, logged), Level 3 `care_notes`, the staff review list | PR 1, PR 3 |
| **5. Holds and release record** | "Hold: see coordinator" with the hard block online and offline, `checked_out_to`, printable building sheet, the gated label switch | PR 4 |
| **6. Release** | Regression, dress rehearsal, soak Sunday, docs, release checklist | PR 5 |

**Effort:**
- **Development:** about 95–115 h.
- **QA:** about 75–85 h. About 45 h is agent-written tests; about 30 h needs people with real iPads and printers,
  including rehearsals.
- **Security review:** about 15–20 h.
- **Docs, desk card and training material:** about 20 h.
- **Team total: about 205–240 hours.**
- **Plus:** about 20 h of owner PR review, about 6–10 h of staff medical-note sorting, and one volunteer briefing.
- **Compared with revision 3.2:** 600 hours at human pace, or 320 agent-assisted.

**Calendar.** It assumes a deploy freeze from 19 December to 3 January, which the owner should confirm.

| Milestone | Recommended | Fastest responsible |
|---|---|---|
| Temporary pickup procedure (no code) | Sun 29 Nov | Sun 29 Nov |
| PR 1 live (mixed-family release closed) | Sun 6 Dec | Sun 6 Dec |
| PR 2 live (history protected) | Sun 13 Dec | Sun 13 Dec |
| PR 3 live (access) | Tue 5 Jan | Wed 16 Dec (server only, before the freeze) |
| PR 4 live (codes, medical fields) | Sun 10 Jan | 5 Jan (built during the freeze) |
| PR 5 live (holds) | Sun 17 Jan | 7 Jan |
| Dress rehearsal, then soak Sunday | Sat 23 / Sun 24 Jan | Sat 9 / Sun 10 Jan |
| **V1 complete** | **about 26 Jan (about 9 weeks; about 6 working weeks given the freeze)** | **about 12 Jan (about 7 weeks)** |

**Is 3–4 weeks realistic? Not for the whole of V1.** The engineering would nearly fit. What doesn't fit is:
- the Christmas services, when changing the desk process is a bad idea
- the owner's approval of the permission change
- the staff sorting of medical notes before labels change
- a dress rehearsal and a soak Sunday

**But the two most dangerous problems are closed within 2½ weeks:** the mixed-family release (6 Dec) and deletable
history (13 Dec). The temporary procedure covers the rest from this Sunday.

**If a gate fails** (a required test, the security review, the rehearsal), the date moves; the gate doesn't.

**Biggest risks:**
1. A permission change that locks out a kids' director on the first Sunday. Grant the flag to named people before
   the switch.
2. Triggers on live data. The spike, the rehearsal on a restored backup, and the owner's approval of the migration.
3. iPads still running old code. Version reporting and the switch.
4. The medical switch hiding something. It is gated on the review list reaching zero.

---

## 7. Minimum testing (definition of done)
**About 45 automated cases, each written with its PR, in new `test/checkin-*.test.js` files and never depending on
today's date:**
- **Codes:** station letters unique, normalisation, look-alikes, cross-day and cross-campus, the server clash flag.
- **Check-out:**
  - the two-household stop on both paths
  - one child of several
  - a code alone never releases
  - replays recorded, never refused
  - an old-format outbox
  - the real check-out time kept
- **Authorisation:**
  - only household adults and listed contacts on the iPad
  - adding an adult to an existing household refused for stations and leaders
  - pickup-contact campus checks and audit
- **Holds:** blocked on every path (station, leader, admin, offline replay).
- **Medical:**
  - a canary string in `medical_notes` and `care_notes` never appears in any station-reachable response or label
  - each Level 2 view writes a log row
- **Permissions:**
  - no check-in flag means no roster
  - campus limits
  - the station token wins
  - stations can't void
- **History:**
  - the station delete refused
  - past-service, series and position deletes archive
  - the triggers fire on cascades
  - the hold blocks void and merge
- **Migrations:** rehearsed on a restored backup.

**Before the first live Sunday:**
1. `npm test` and `npm run test:ui` are green. The mixed-family and station-delete tests are shown failing on the old
   code and passing on the new.
2. Two real iPads and every label printer model are used by a coordinator and a volunteer. They cover a same-code
   attempt, a multi-child family, an offline check-out that syncs, and a network cut mid-sync.
3. The paper kit is rehearsed by people who didn't build it, including the Monday entry.
4. A dress rehearsal, then one soak Sunday, with zero clashes and zero wrong releases, reviewed on Monday. A second
   soak Sunday is only needed if the first had an incident. (Church Operations would prefer a short second one at
   the busiest service; owner's choice.)
5. The owner signs a test report that says what wasn't tested.

---

## 8. Risks that cannot be accepted for launch
Agreed by all five reviewers:
- **Releases:**
  - Two households' children released together, anywhere, including on offline replay.
  - An outbox that refuses or loses a release that already happened.
- **Kiosks:** a hub session overriding the station, or any sign-in on a kiosk.
- **Access:**
  - Stations or leaders adding an adult to an existing household.
  - Team leaders reading the church-wide medical roster.
- **History:** check-ins or past serving records deletable, or voided with no known person.
- **Records and codes:**
  - Pickup contacts or holds changed with no campus check and audit.
  - Codes that can clash between stations.
- **Holds and offline:**
  - No system hold that blocks release, online and offline.
  - Offline release to anyone but a household adult or listed contact, or from an out-of-date roster.
- **Data on iPads:** roster or old daily lists kept indefinitely, or left after unpairing.
- **Medical:** notes removed from rooms before staff have sorted them, or allergy text cut short.
- **Page protection:** no `frame-ancestors` or CSP on the check-in page.
- **Operations:** no device policy, lost-iPad drill, rehearsed paper kit, named coordinators and safeguarding lead,
  or signed legal-hold procedure.
- **Testing:** any of the above without its test.

---

## 9. Keeping the rest of Church Hub moving
- **One parallel stream at most**, outside check-in files and in the agreed migration order (the roadmap's "one step
  at a time" rule).
- **During V1 (now to late January):**
  - **H12 first:** GitHub Actions running `npm test` on every PR (a day; it makes V1 safer).
  - **Items that don't touch check-in:**
    - **C6** follow-up inbox
    - **H11** prayer requests
    - **H10** events: repeat, duplicate, `.ics`
    - **H8** Monday digest and reports
    - **M2–M4** giving
  - **H6** "Message people" once the owner picks an email provider.
- **After PR 2 merges** (it adds the assignment trigger): scheduling items **H1** day-of replacement and **H3**
  recurring availability.
- **After V1:**
  - **C3** clearance-gated kids' scheduling. It builds directly on the check-in access flag.
  - **C4** team-scoped leader access and private pastoral notes (permissions).
  - **H4** roll-call-only permission, **H5** grade rollover, **M1** duplicate prevention at check-in.
- **Then alternate:** one V2 child-safety slice, then one roadmap item, so neither stalls.

---

## 10. Decisions for the owner
1. **Approve this V1 scope** as the first release, with revision 3.2 kept as the V2/V3 reference.
2. **Check-in access flag** (a permission change, rule 7): approve it, and name who gets it on day one.
3. **5-character codes** with a station letter.
4. **No offline approvals in V1.** Non-listed pickups are handled by the coordinator in person plus a parent call.
5. **Medical:** Level 1, 2 and 3 as above, with the label switch gated on staff review. Accept II-49 until then.
6. **Legal hold:** the church-wide setting plus the written procedure. Name the admin who runs it.
7. **Freeze dates,** and whether the server-only access PR may deploy before the freeze (the fastest timeline).
8. **Name the people:** safeguarding lead and backup, a duty coordinator per service, the paper-kit owner, the tech
   volunteer for iPads.
9. **One Church Hub stream in parallel,** starting with H12.

The 135-item checklist ([approval-checklist.md](approval-checklist.md)) now mostly concerns V2. After approval, the
Chief Architect re-cuts it to the V1 items above.
