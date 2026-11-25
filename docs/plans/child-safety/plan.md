# Kids' check-in child-safety plan (FINAL, for owner approval)

Chief Architect · 2026-11-25 · Consolidates the first draft with three independent reviews:
Security ([review-security.md](review-security.md): 0 Critical / 9 High / 13 Medium / 6 Low), QA ([review-qa.md](review-qa.md): 138 cases),
Church Operations ([review-operations.md](review-operations.md): "works with friction").
**Nothing has been implemented, and no repository file was changed.** Repo state: `main` @ `433475f`, 29 migrations,
59 tables, `npm test` 42/42.

---

## 1. Executive summary (for the pastor and owner)

**The problem today**
- Every pickup tag carries a 4-character code that each iPad makes up on its own. Nothing stops two families getting
  the same code. At about 300 families a campus, that happens on roughly **1 Sunday in 12**.
- When it does, typing the code at pickup shows **both families' children** with one "Check out all" button. One
  parent's tag could release another family's child.
- There is nowhere to record that a particular adult must not collect a child.
- Anyone who leads any team (worship, tech, hospitality) can open check-in. That shows every child's medical notes
  and lets them check children out.
- The iPads keep the whole church's family list, including medical notes, and never clear it.

**What we will build**
1. **Codes that can never clash, even with no internet.** Each iPad gets its own first letter from the server, so a
   code looks like `K 7Q3M`. Two iPads can't make the same code, and the server double-checks when they sync.
2. **A tag releases only its own children.** A code now belongs to one family's check-in. Volunteers release children
   one by one and tap who is collecting.
3. **Pickup alerts.**
   - Staff can mark "do not release to this person": this is a hard stop.
   - They can mark "check with a coordinator first".
   - Pickup alerts are shown to the desk but never printed.
4. **Two lanes at pickup, so lines stay fast.**
   - **Ordinary children** go through the fast lane. A tag plus a known adult takes about as long as today. Someone not
     on the list, or a lost tag, needs an ID check, and a trained desk volunteer can handle it.
   - **Children with a pickup alert** go through the careful lane. Every release needs an ID check, and anything
     unusual needs a coordinator (in person, by phone, or with their personal PIN when the internet is down).
5. **The right people, and a record of everything.**
   - Check-in access becomes a separate "kids helper" or "kids coordinator" permission, no longer automatic for team
     leaders.
   - iPads work only during check-in hours.
   - Removing an iPad keeps its history.
   - Every check-in, release, refusal and approval is recorded permanently: who, to whom, when and on which iPad.
6. **Less data on the iPads.** Adults' medical data comes off the iPads, only needed families stay on them, and old
   days are wiped. Children's full medical notes stay visible to room helpers, as today.
7. **Nothing old is changed or lost.** The database only gains new tables and columns, and past check-ins stay
   exactly as they are. Old iPads keep working until they are reloaded. Each part can be turned on, and back off,
   from Settings, except do-not-release enforcement, which can never be switched off quietly.

**Effort and decisions**
- About **30 working days** of build and testing in 6 pull requests, plus an optional 3.5-day add-on for adding
  first-time families offline.
- Spread over about **10–12 weeks**, because there are two trial Sundays after the code change and one after pickup
  alerts.
- It needs 20 owner decisions (§8). Most are confirmations of a recommendation.
- Alongside the software: volunteer training, a laminated desk card, signs for parents, a paper fallback kit and a
  printed daily "pickup alerts" sheet (§6).

---

## 2. What changed from the draft, and why

### 2.1 Adopted

| Review finding | Decision | Where |
|---|---|---|
| **Sec H1** Anyone adding a household adult becomes "authorised"; name-only restrictions are missed | Adults added to a household in the last 14 days, or by a station or helper, are "not yet known" (ID check; careful lane if the child is restricted). New `people.household_set_at/by_kind`. Fix `POST /people` household campus check and audit. When a restriction is created, the hub forces linking to a directory person if a name matches. Name-only restrictions are fuzzy-matched at release, and a match goes to a coordinator. | §3.4, §3.5, §4.3 (m30, m33), P1/P4 |
| **Sec H2** Tablet asserts the pickup's household | The server derives the household from the children. Mismatch: stored, `pickup_mismatch`, coordinator only. Re-sent pickups must match. Placeholder pickups are flagged `code_unknown`. Prefix-to-lease check. | §3.2, §3.3, P2 |
| **Sec H3** Stale restriction list fails open offline | Safety list carries `as_of` and a version. Light `GET /checkin/changes` polled every 45 s. Offline releases allowed only if the list is ≤ 180 min old and from today; beyond that every release needs a coordinator PIN (fail closed, still operable). Restrictions are copied onto the pickup at check-in. A restriction added for a child who is in a room alerts coordinators immediately. | §3.9, P4 |
| **Sec H4 / QA B7.03** Old-tablet outbox poisoning on a 409 | Requests are separated from *reports of releases that already happened*. Server processes per id and is idempotent. Alerts are de-duplicated. New outbox v2 is always accepted and recorded. For the old shape, allowed ids are applied on every retry (nothing lost). A restricted id is refused with one urgent alert. Pickup alerts can't be enabled until no old app has been seen for 7 days, so the case is designed out. | §4.6, P1/P2/P4 |
| **Sec H5** Photos don't load on stations or offline | New `GET /checkin/photo/:person_id` for stations and helpers, limited to today's pickups and roster scope. Day-scoped photo cache, purged. No photo means an ID check, remembered once seen ("ID seen" memory). | §3.5, P2 |
| **Sec H6** Code isn't a secret; adult names shown before the adult speaks | Volunteer asks "Who are you, and who are you collecting?" Adult tiles are photo-first, and the screen faces the volunteer. Rooms screen shows only the last 2 characters. `/checkin/active` gives codes only to stations and coordinators. Parent tag drops the household name. | §3.3, §3.12, P2 |
| **Sec H7** Every team leader would see custody data | `checkin_access = explicit` is enforced in code as a precondition for pickup alerts. In `leaders` mode no restriction data is sent to unflagged accounts. | §3.7, P3/P4 |
| **Sec H8** One coordinator can do everything alone | No approving a release to yourself or your household. Careful-lane overrides need someone other than the requester. Ending or weakening a restriction needs a second coordinator or an admin. Only admins grant coordinator. Every change is notified. | §3.4, §3.6, P4 |
| **Sec H9** Station tokens never expire; delete loses attribution | Campus check-in hours plus "Open check-in now". Token rotation, with the old token valid until the new one is used (max 7 days). Revoke instead of delete. Device roster time-to-live of 7 days. Roster downloads audited. Optional allowed networks. | §3.8, P3 |
| **Sec M1 / QA P1.06–08** Lease exhaustion, same-day reuse, no lease offline | Leases only for paired stations and helper+ accounts (max 2 per user). Foreign key `SET NULL` plus revoke; never reclaimed the same day. When exhausted, or a device has no lease, it falls back to a 2-letter prefix, giving a 6-character code. Check-in is never blocked. | §3.2, P2 |
| **Sec M2 / QA R3.17, L10.08** Lockouts as denial of service; per-IP limiter | Stations get a progressive delay (no lock), keyed by device, not IP (one church Wi-Fi). Users get 429. Only failures count. Least-recently-used eviction replaces `clear()`. Factory with an injectable clock. | §3.10, P1 |
| **Sec M3** Conflict and notification floods | Conflicts flagged only on prefix or lease anomalies. One notification per pickup or child per 10 min, plus a digest. The safety notification kind can't be muted. Pending override requests capped per device. | §3.10, P2/P3 |
| **Sec M4** Legacy paths stay weak | Server groups legacy-shaped check-ins into server-made pickups once the flag is on. Legacy sunset date (default 14 days after enabling). "Needs reload" on the Live and Stations pages. | §4.6, P2 |
| **Sec M5 / QA P5.05** Station prefix allow-by-default | `stationMay` becomes an explicit `[method, path]` allow-list. `requireCheckin` handles stations first. Stations limited to today. Router-sweep test. | §3.8, P1 |
| **Sec M6** `SELECT *` leaks new columns | Explicit field allow-lists for roster, active and person page. Shape snapshot test. | §3.11, P1 |
| **Sec M7 / QA D6.11** Trail not really append-only | `checkin_events`: campus foreign key with no cascade, `BEFORE UPDATE/DELETE` triggers that abort, server-namespaced ids, stored device and user names. `audit()` records the station. `checkin_*` settings changes logged old→new. | §4.3 (m30), P1 |
| **Sec M8 / QA L10.03–06** Tablet clock decides the day | Client times bounded (not more than 10 min ahead, flagged if older than 72 h). Server sets one-time expiry. Lookups search today plus yesterday's still-open pickups. Replays use the pickup's own day. Skew shown on tablet and Stations. | §3.9, P1/P2 |
| **Sec M9** Lost tag stays valid | Lost-tag release revokes the code. Remaining children get a reissued tag. A revoked code shows "reported lost" plus an alert. Same-code reprint only within 5 min of check-in (printer failure). | §3.3, P2 |
| **Sec M10** One switch turns off do-not-release | Enforcement is not behind a flag once any restriction exists. The flag only hides the management screens. Any kill switch needs a typed reason and notifies admins and coordinators. | §4.8 |
| **Sec M11** One-time pickup added by whoever is at the desk | The adult checking in is tapped from the authorised list. Restricted child: coordinator only. Scoped to that pickup's children. ID check always. Server-set expiry. Phone purged after 90 days (D17). | §3.5, P4/P5 |
| **Sec M12** Override binding, IDOR, replay | Campus check. Binding to device or user, ids, adult and kind. Atomic single use. Random ids. | §3.6, P4 |
| **Sec M13** Privacy of details | `details` is never in audit, notifications, search, exports or roster. Generic push text. `station_note` ≤ 120 characters ("who to call, not why"). No document uploads. Canary tests. | §3.4, P4 |
| **Sec L1–L6** | No "!" on labels. Minimum app version on every response. No `/api` caching in the service worker. Void only for open rows. Archived or non-child uploads flagged. Content Security Policy on `/checkin`. `PATCH /users` allow-list for `checkin`. | §3.12, P1–P5 |
| **QA §0.4/B7.04** Old UI shows success after a partial refusal | All-or-nothing for live *requests*; per-id only for *reports*. | §3.3 |
| **QA C2.06** Same child checked in twice | `checkins.duplicate_of`. Releasing one closes both. Counted once. | §3.3, P2 |
| **QA C2.17** No undo of an accidental release | Coordinator "undo release" within 30 min, with a reason and an event. | §3.3, P2 |
| **QA P1.09, L10.02, V9.02** Data loss on unpair or a full device | Unpair or revoke never deletes an unsynced queue; a coordinator signs in on the iPad to send it. Check-in is refused visibly if the queue can't be saved. Photos go in Cache Storage, not localStorage. | §3.9, P1/P5 |
| **QA D6.01–D6.14** Migration evidence | Hashes over the original columns of every table. v29 fixture via `openDb(path, {upTo})`. Failure injection. Old code run against the migrated database. Void filter on every `FROM checkins` (grep test). Rehearsal on a backup copy. | §5 |
| **QA §11** Testability | Injectable clock and random (server `app.locals.clock` in test only; tablet `pickupCode(random)`, `canRelease(today)`). Pure modules split out of `checkin.js`. Injected `notify`. Limiter factory. Golden release-rule fixture shared by rules and API tests. Replay simulator. | §5.2, P1 |
| **QA B7.07** Service worker breaks if a listed file 404s | Test that `FILES` exist on disk and that no dynamic imports exist; fake `caches` harness. | §5, P2 |
| **Ops 2.4** Check-out doubles in taps | Auto-submit at 5/6 characters. Children pre-ticked in the fast lane. One adult tap (single tile when one known adult). Large child photo and room. Target ≤ 8 s. | §3.3 |
| **Ops 2.5** Non-household person with a tag needs an override | Fast lane, Tier B: tag + names the child + ID check, recorded; helper releases; coordinator notified afterwards. Restricted children stay in the careful lane. | §3.3 |
| **Ops 2.8** Lost tag through a coordinator breaks Sundays | Tiered: household adult already on file + photo/ID + names child + unrestricted → helper. Otherwise coordinator. | §3.3 |
| **Ops D6** Phones silenced; no offline approval | Per-coordinator PIN (online and offline). Two named approvers per campus per service. "Coordinator notified at 11:42" plus tap-to-call. Safety runner. | §3.6, §6 |
| **Ops D10** Full medical notes must stay visible | Full notes stay on Rooms and the check-in card for helpers and stations. Label prints the allergy strip plus "MEDICAL: see room list"; per-child "print full note" for life-critical cases. | §3.12 |
| **Ops D9** Visitors from other campuses become duplicates | Roster = this campus + any household with a check-in anywhere in 12 months, plus an online "search all campuses" button. | §3.11 |
| **Ops 2.12** Audit says "Welcome desk iPad", not a person | "Who's on this desk?" pick at shift start (from today's kids-team schedule or a typed name), stored as `operator_name` (display only, not authentication). | §3.10, P2 |
| **Ops 2.10, 2.11, 4.9–10** | Big "Alert coordinator now" button and calm on-screen script. Quick 3-field restriction form on phone. Household-level restriction entry. Weekly "alerts expiring" list. Coordinator incident note. | §3.4, P4 |
| **Ops 2.14** Rooms stale | Rooms refreshes from `/checkin/changes` every 45 s online. | §3.9 |
| **Ops 2.13, D14** Forgotten tablets | App version in the tablet header. "Needs reload" list. Two-Sunday soak with one untouched legacy tablet per campus. | §4.7, §6 |
| **Ops §4** Paper fallback, training, signage, communication | Operations readiness work stream. | §6 |

### 2.2 Not adopted, or adopted differently

| Finding | Why not, or what instead |
|---|---|
| Sec H3 fail-closed after **120 min** offline for *any* child | 120 min would trip during an ordinary 9:00–11:45 morning on a tablet that lost Wi-Fi early. Chosen: **180 min and same day**, configurable. Past the limit releases still work, with a coordinator PIN. The gap (a restriction added while a tablet is offline) is covered by the immediate coordinator alert for in-room children, plus the printed daily sheet. |
| Sec H6 hide adult names behind "Who are you?" in every case | Fast lane shows **photos first with small first names**, the screen faces the volunteer, and the volunteer asks before tapping. Fully hidden lists cost a tap on every pickup; the impostor risk is covered by the photo match and the ID check whenever no photo exists. |
| Sec H6 remove codes from `/active` entirely | Stations need other stations' codes to look up offline, so codes go to stations and coordinators only; helpers' and leaders' phones get none. Rooms shows the last 2 characters. |
| Sec H9.3 rotate tokens daily with a 10-min grace | A lost response would lock out an offline iPad on Sunday. Instead the old token stays valid **until the new one is first used** (max 7 days). |
| Sec H9.2 allowed networks (IP list) on by default | Offered as an optional per-campus setting (D13), off by default. Church networks change, and a wrong list breaks Sunday. |
| Sec H8.2 alternative: "ending takes effect after 24 h" | Using second-person confirmation only (clearer). If a campus has one coordinator, an admin confirms. |
| Sec M4 sunset makes legacy `{security_code}` return 409 | Done only after the sunset date. Before it, unrestricted single-household legacy codes work as today, so the fallback tablet in the soak keeps working. |
| QA M8 "server day if skew > 12 h" | Legitimate offline batches are often synced the next morning. Instead: reject future times, flag older than 72 h, keep the client day. Lookups include yesterday's open pickups. |
| Ops 2.3 find family "by tapping the child's name in Rooms" | Reveals names to whoever is at the counter. Instead "No tag?" searches by the **adult's** name or phone, and the adult must name the children. |
| Ops D6 "no PIN later" vs draft "no PINs" | PIN adopted (per coordinator, never shared, hashed, rotated) because a coordinator in a teaching room with a silenced phone is the normal case. Security re-review required (§7). |
| Ops 2.5 parent self-service pickup contacts in the member app; "text me" pickups; VBS wristbands; special-needs paging | Valuable, but new surfaces with their own security design. Roadmap (D20). |
| Ops 2.2 offline quick-add for first-time families | Adopted as **optional Phase 7** (D19): offline-created records need reconciliation and duplicate handling. Recommended before Easter. |
| QA "two parents' codes both release the duplicate" | Releasing either pickup closes both rows of the same child (`duplicate_of`). The second code doesn't release siblings outside its own pickup. |
| Sec D2 "unpaired tablets online-only" | Signed-in helpers get a lease (max 2). Offline uniqueness also holds for them, and the 6-char fallback removes the exhaustion risk. |

---

## 3. Final design

### 3.1 Principles
1. A code finds **one family's** pickup. A release names **who** collected. The server checks both on every path.
2. **Fast lane for ordinary children, careful lane for children with a pickup alert.** Lanes are chosen by data, not
   by the volunteer.
3. **The server never drops a check-in or a reported release.** It records it, flags it and alerts.
4. **Fail closed only where a child is at risk:** restricted children, or a stale offline safety list. Even then it
   stays operable through a coordinator PIN.
5. **Additive data only. Flags for features; no flag for enforcement.**
6. One shared rules module (`checkin-rules.js`: `pickupCode`, `normaliseCode`, `laneFor`, `canRelease`) decides the
   same way on the tablet and the server, like `roomFor` does today.

### 3.2 Pickup codes
- **Format:** device prefix + 4 random characters from the existing 27-character alphabet. Printed and shown as
  `K 7Q3M`. Typed with or without the space or hyphen, any case.
  - Fallback: 2-letter prefix + 4 = 6 characters, `KM 7Q3M`.
  - Legacy 4-character codes are still accepted while legacy rows exist.
  - Characters outside the alphabet are rejected with a hint; never silently mapped (QA P1.18).
- **Lease:** `POST /checkin/lease` gives one prefix per device per campus (paired station, or helper+ account
  `device_key`, max 2 per user). Never reclaimed on a day it was used, and only after 30 idle days. Revoke keeps it.
  - 28th device, or a device that never got a lease (offline first boot): random 2-letter prefix → 6-character code,
    flagged `unleased` on sync. 27² = 729 prefixes, so collisions are negligible, and the server still detects them.
- **Uniqueness:** a device checks its own issued list (`mb.checkin.issued.<campus>.<day>`, rebuilt from the server's
  list on refresh).
  - Different devices can't collide (distinct prefixes). This holds offline.
- **Server backstop on sync:**
  - Pickup with a prefix not leased to the uploader, or `(campus, day, code)` equal to another **open** pickup → both
    `conflict = 1`, a `code_conflict` event and one de-duplicated coordinator alert. Closed and voided pickups are
    ignored (QA P1.12).
  - The server **never changes a code a parent holds**. A coordinator may "reissue tag" (new code, reprints parent tag
    and child labels; old code kept in the event).
- **Validation:** pickup ids and check-in ids `^[\w-]{8,64}$`. Code normalised **before** length checks (QA P1.17).

### 3.3 Pickup sessions and check-out lanes
**Pickup session** (`checkin_pickups`): one family, one tag, one day, at one campus.
- The tablet creates it at check-in. The **server derives `household_id` from the children** and ignores the client.
- A record whose child's household differs from the pickup's → stored, `pickup_mismatch`, release through a
  coordinator only.
- A re-sent pickup id with different campus, day, code or household → 409 for that record plus an event; the
  original is unchanged.
- Unknown pickup referenced by a record → placeholder `code_unknown = 1`, coordinator release only, until the owning
  device uploads it.
- Legacy-shaped uploads (old app) after `checkin_pickups` is on → server-made pickup
  `(campus, day, code, household)`, `origin = 'server'`.
- Same child already open the same day and service → new row `duplicate_of` the first. Counted once, and releasing
  either closes both.

**Lane** (computed by `laneFor(pickup, children, restrictions, safetyListAge)`):
- **Fast lane:** no child in the pickup has an active restriction, and the safety list is fresh.
- **Careful lane:** any child has a restriction, the pickup is `conflict`/`mismatch`/`code_unknown`, or the offline
  safety list is stale.

**Fast lane check-out**
1. Type the code. It auto-submits at 5 characters (6 for fallback; 4 only after "Find", while legacy rows exist).
2. The card shows the family's children **pre-ticked**, each with a large photo, first name and room. The volunteer
   matches the label on each child and unticks any child staying.
3. Volunteer asks "Who's collecting today?" The adult says their name, and the volunteer taps the tile.
   - Tiles show photos with small first names: household adults on file and active contacts for those children.
   - A household with one known adult shows a single tile; tap "Yes, that's them".
4. Release. Tier rules:
   - **Tier A** (no extra step): a household adult on file more than 14 days and not added by a station or helper, or
     a standing contact, **with a photo that matches**.
   - **Tier B** (a trained helper or station does it, no coordinator; recorded; coordinator sees it on the Live page
     afterwards):
     - *Known adult with no photo, or photo won't load* → ID check tick; "Remember ID seen" sets `pickup_verified_at`.
     - *Someone not on the list who holds the matching tag* → they name the child before it's shown, ID check, name
       and relationship from a pick-list → `released_to_kind = 'tag_holder'`.
     - *Lost tag* → "No tag?", search by the adult's name or phone, the adult names the children.
       - Allowed only for a household adult on file, with photo match or ID check.
       - The code is revoked; remaining children get a reissued tag.
       - Reason from a pick-list.
     - *Newly added household adult* (H1) → ID check.
   - **Tier C** (coordinator): lost tag for anyone not a household adult on file, "ID doesn't match" (one red button),
     revoked code presented, mismatch or unknown pickups.
5. Targets (timed in QA): Tier A ≤ 8 s, Tier B ≤ 20 s.

**Careful lane check-out** (restricted children, or conflict/mismatch, or stale offline list)
- Red banner at the top with restricted name(s), photo if linked, and the station note. **Children start unticked.**
- "Who's collecting?" first. The restricted person's tile is greyed "Not allowed". Choosing "Someone else" and typing
  a name that fuzzy-matches a restriction → treated as `check_first`.
- **Every release needs an ID check plus photo match**, whoever the adult is, household adults included.
- `do_not_release` to the named person (by id, or by name match confirmed by the coordinator): **hard block**. No
  override anywhere.
  - Screen: "Do not release. Keep the child with you. Press Alert coordinator. Stay calm."
  - Big **Alert coordinator now** button (urgent event + notification).
- `check_first`, `court_order` (anyone other than the named person), conflict, mismatch: a coordinator approves on the
  tablet with their PIN, or from their phone. Requester ≠ approver (§3.6).
- One-time people for a restricted child: coordinator only.

**All paths, always on (not behind a flag):**
- Ids outside the pickup → 409.
- Live requests are all-or-nothing.
- Restriction checks on every path (pickup, legacy code, legacy ids, hub).
- Already-released ids → no-op; the first release is kept and the second is logged as `duplicate_release` with an alert.
- **Undo release:** coordinator, within 30 min, with a reason. Sets the row open again and writes a `release_undone`
  event. This is the only same-day row change besides void.
- **Void** (replaces DELETE): coordinator, open rows only, reason required. Excluded from active, rooms, lookups,
  conflicts and totals. Stations get 403.

### 3.4 Custody, do-not-release, check-first
- **`pickup_restrictions`** per child:
  - `kind`: `do_not_release` | `court_order` (document kept on paper) | `check_first`.
  - Named person by directory link (forced when a name matches a household adult, contact or directory person) or by
    name.
  - Optional dates (campus timezone, inclusive).
  - `station_note` ≤ 120 characters ("who to call, not why").
  - `details`: coordinators and admins only; never in audit text, notifications, search, exports or roster.
  - `basis`: `court_order_on_file` | `parent_request`, to steer pastoral follow-up.
- **Setting:**
  - Coordinators and admins.
  - Quick 3-field form on phone (child or "all children in household", person, note); details later.
  - Creating or strengthening takes effect at once.
  - **Ending or weakening** (end, shorten, `court_order`→`check_first`) is `pending_end` until a **second coordinator
    or an admin** confirms.
  - Nobody can end a restriction on a child in their own household.
  - Everything is notified to the campus's coordinators and admins (generic push text) and audited (fields changed,
    not `details`).
- **Restriction added for a child who is in a room now** → immediate urgent alert: "A pickup alert was added for a
  child who is in a room now. Tell the desk."
- **Shown:**
  - Check-in: banner on the family.
  - Check-out and Rooms: banner plus name and note.
  - Hub: "Kids safety" card on child and household.
  - Daily printed sheet.
  - **Never** on labels or tags, in push text, or to unflagged accounts.
- **Who sees:** stations, helpers and coordinators see station-safe fields (only in `explicit` mode, or for paired
  stations). Details: coordinators and admins.
- **Weekly list** of restrictions expiring soon. Coordinator **incident note** after a denied release.

### 3.5 Authorised contacts and verification
- `household_pickups` extended: directory link (photo from directory), own photo path, `child_ids` scope (NULL = all,
  malformed fails closed), `starts_on/ends_on`, `id_required`, notes (coordinator-only), created by and at, **archive
  instead of delete**.
  - Adding or changing contacts for a household with a restricted child: coordinators only, notified.
- **Household adults on file** = adults whose `household_set_at` is NULL (existed before this change) or more than 14
  days old, set by staff (not by a station or helper). Others are "not yet known".
- **One-time pickup person at check-in:** an optional small link "Someone else picking up today?".
  - The adult checking in is tapped from the authorised list first.
  - Name, phone, relationship (pick-list).
  - Valid for that pickup's children, expiring at campus end-of-day (server-set).
  - **ID check always.**
  - Restricted child → coordinator.
  - Phone purged after 90 days (D17).
- **ID check policy** (`checkin_id_check`): `unrecognised` (recommended). An ID check is needed for:
  - no photo or photo won't load, unless "ID seen" in the last 12 months
  - a "not yet known" adult
  - contacts with `id_required`
  - one-time people and tag holders
  - lost tags
  - any restricted child
  - conflicts

  Other options: `always`, or `never` (which still forces ID in the careful lane).
- **Photos for stations:** `GET /api/checkin/photo/:person_id` (station or helper), only for people in today's
  pickups or roster scope at the caller's campus, `Cache-Control: private`.
  - Tablet caches today's families' photos in `mb-checkin-photos-<day>` (Cache Storage), deleted on day purge, unpair
    and sign-out.
- Verification memory: `people.pickup_verified_at/by` set by "Remember ID seen". Recorded in events.

### 3.6 Overrides and coordinator PINs
- **`checkin_overrides`** (random text id):
  - Kinds: `lost_tag_c`, `check_first`, `court_order`, `not_on_list_restricted`, `conflict`, `mismatch`,
    `revoked_code`, `id_mismatch`.
  - Bound to campus, requesting device or user, exact ids, adult (`released_to_ref`/name) and kind.
  - Expires in 15 min; consumed atomically (`UPDATE … WHERE status='approved' AND expires_at > now`, `changes = 1`).
  - Max 10 pending per device.
- **Approval routes:**
  1. Coordinator types their **personal PIN** on the tablet (online: verified by the server, rate-limited; offline:
     verified on the tablet against a scrypt hash in the station roster, 5 tries then a 15-min lock on that tablet).
  2. Coordinator taps the push or Live page on their phone.
  3. Coordinator signs in on the tablet.
- **Two-person rule:**
  - The approver can't be the requester for careful-lane kinds, the released-to person, or in that person's or the
    child's household.
  - PIN approvals record the coordinator's id.
  - Offline PIN approvals sync as events and are listed on the Live page.
- PIN: 6 digits, set in the hub by the coordinator after signing in, rotated every 90 days.
  - Hashes are sent only to paired stations at that campus, and only in `explicit` mode.
  - A PIN can't sign in to the hub.
- **Tablet screen while waiting:** "Coordinator notified at 11:42 · Tap to call [on-duty name]", plus a script for
  the parent.

### 3.7 Permissions
- **`users.checkin`**: `''` | `helper` | `coordinator`. Only admins grant coordinator. Audited, admins notified.
- **`checkin_access`**:
  - `leaders` (today: leader+ acts as helper, staff+ as coordinator for non-restriction actions; **no restriction data
    or PIN hashes to unflagged accounts**).
  - `explicit` (only flagged accounts plus admins, and paired stations).
  - **Pickup alerts can be enabled only in `explicit` mode** (server refuses otherwise).
- **`requireCheckin(level)`** in `auth.js`: handles `req.user.station` first (= helper at its campus, today only),
  then the flag or mode. Campus limits apply. Station `user.id` is null, handled everywhere.

| Capability | Helper | Coordinator | Station | Admin |
|---|:-:|:-:|:-:|:-:|
| Check-in, fast-lane check-out (Tier A/B), Rooms, full medical notes of checked-in children | ✓ | ✓ | ✓ | ✓ |
| Restriction names and station note | ✓ (explicit) | ✓ | ✓ | ✓ |
| Codes in `/active` (own and other stations) | | ✓ | ✓ | ✓ |
| Restriction details; add restrictions; manage contacts of restricted households | | ✓ | | ✓ |
| Confirm ending a restriction (second person) | | ✓ (not own household) | | ✓ |
| Approve overrides (PIN or phone), reissue or revoke tags, undo release, void | | ✓ | | ✓ |
| Live page, History, incident notes | | ✓ | | ✓ |
| Grant helper or coordinator | | | | ✓ |

### 3.8 Stations
- **Allow-list** (`[method, path]`): `GET /checkin/station`, `GET /checkin/roster`, `GET /checkin/changes`,
  `GET /checkin/active` (today only), `GET /checkin/pickup`, `GET /checkin/photo/:id`, `POST /checkin/lease`,
  `POST /checkin/checkins`, `POST /checkin/checkout`, `POST /checkin/overrides` (request), `POST /checkin/pin-verify`,
  `GET /campuses`, `POST /people` (guest family).
  - Everything else is 403, proven by a router-sweep test.
- **Check-in hours** per campus (settings), with a 2-hour grace after the window. Plus a coordinator "Open check-in
  now" (4 h) for ad-hoc events.
  - Outside hours: roster, lookup and check-out 403. Uploads and **reports are always accepted**. A notification
    fires on outside-hours use.
- **Token rotation:** first request of each day returns a new token; the old token works until the new one is first
  used (max 7 days).
- **Revoke, not delete** (`revoked_at/by`). The name stays in history and the lease is kept that day.
  - A revoked iPad keeps its unsynced queue and shows "Ask a coordinator to sign in on this iPad to send N check-ins".
- Roster downloads recorded (`roster` events). Optional allowed networks per campus (D13).
- Tablet header shows app version, Online/Offline and "Safety list 9:12". Skew warning from the server's `Date`.

### 3.9 Offline behaviour
| Situation | Behaviour |
|---|---|
| Check-in | Works as today (prefix codes). Restrictions copied onto the pickup at check-in. Refused visibly if the queue can't be saved (quota). |
| Fast-lane release, safety list ≤ 180 min and today | Works (Tier A/B). Outbox v2 report with `client_at`, adult, ID tick, operator. |
| Any release, safety list older than 180 min or from another day | Careful lane: coordinator PIN required (fail closed, operable). |
| Restricted child | `do_not_release` named person: blocked. Others: coordinator PIN. |
| Lost tag Tier C, conflicts, mismatch | Coordinator PIN. |
| No lease ever (first boot offline) | 6-character code, flagged on sync. "A tablet that has never been online can't check in" stays true for the roster. |
| Device roster older than 7 days | Roster and day lists purged on start; "Connect to update". |
- `GET /checkin/changes?since=` every 45 s online returns new check-ins, releases, restriction version, flags
  version, `min_app` and override status. Rooms refreshes from it, and an online check-out refreshes it first.
- **Midnight:** lookups search today plus yesterday's pickups opened in the last 8 h. Replays use the pickup's day.

### 3.10 Audit, alerts, rate limits
- **`checkin_events`**, append-only (database triggers), for:
  - check-in and check-out (with `released_to`, kind, tier, ID tick, operator)
  - report and `release_violation`
  - void, undo, reissue, revoke, reprint
  - conflict, mismatch, `clock_skew`
  - lease, roster
  - override request and decision, PIN failure
  - alert button, incident note
  - restriction change (no details)
- Each event stores device id and name, user id and name, client time and server time.
- **Notifications:** new kind `checkin_alert`, not mutable by coordinators. Generic text ("A pickup needs your
  attention at North"). De-duplicated per pickup or child per 10 min, plus a digest. Inbox body without children's
  names; names only on the Live page.
- **Rate limits:** shared factory (closes tech-debt #7), keyed by device or user, least-recently-used eviction.
  Stations: progressive delay 1/2/5/10 s after failures, plus an alert at 30. Users: 429 after 30 failures in 10 min.
  Uniform "not found" for unknown and released codes.
- `audit()` records station id and name. `checkin_*` settings logged old→new.

### 3.11 Roster cache minimisation
- **Scope:** this campus's households + any household with a check-in anywhere in the last 12 months. Online "Search
  all campuses" fetches one household on demand.
- **Fields (allow-list, shape test):**
  - children: allergies and full medical notes
  - adults: no allergies or medical data
  - member phones: last 4 digits only, for search; household main phone kept for calling a parent (D11)
  - contacts: name, relationship, photo flag, scope, dates (no notes)
  - restrictions: station-safe only, `explicit` mode
- **Purge:** day lists, issued lists and photo caches older than yesterday on start. Roster TTL 7 days. On
  unpair/revoke/sign-out: roster, photos and lease are wiped; **unsynced queue and outbox are kept** until sent.
- At-rest encryption deferred: the key would live on the same iPad. Procedure instead: passcode-locked, supervised
  iPads that open only `/checkin`.

### 3.12 Labels, tags, screens
- **Child label:** allergy strip (unchanged), name, room, date, code.
  - "MEDICAL: see room list" when a note exists.
  - Full note only where a coordinator ticks "Print full medical note on label" (`people.label_medical`, for
    epi-pen or seizure plans).
  - No restriction marker.
- **Parent tag:** code (large, `K 7Q3M`), date, number of children, children as initials (D10), "Show this tag to
  collect. We may ask for ID."
  - No household name. Always printed while pickup sessions are on (setting locked).
- **Rooms:** names, allergies, full medical notes, alert icon, last 2 code characters.
- Content Security Policy on `/checkin` (`script-src 'self'`; inline style attributes allowed).

---

## 4. Data integrity

### 4.1 Inventory of affected data (read-only, on a restored backup copy; Phase 0)
| Table | What we look at | Changed by this plan? |
|---|---|---|
| `checkins` | Rows per campus, day range; codes not 4 chars; open rows from past days; historical same-day code collisions across households; `kind` mix; `checked_out_by` values | New columns only. Old rows untouched. |
| `household_pickups` | Count; households with children and no contacts | New columns only. Delete → archive. |
| `people` | Adults in child households with or without photo (decides Tier A coverage); archived children; duplicates | New columns only. |
| `households` | Households with NULL campus; with children | Untouched. |
| `users` | `role_auto = 1` leaders who would lose access in `explicit` mode; staff per campus | New columns only. |
| `checkin_devices` | Stations per campus (prefix headroom), last seen | New columns only. Delete → revoke. |
| `audit_log`, `settings` | Unchanged; new keys added | — |
| Roster JSON | Size per campus today vs after minimising (localStorage headroom) | — |

### 4.2 Rules
- Migrations are appended (30–34), each one string in `MIGRATIONS`.
  - Already **atomic per migration**: `migrate()` wraps `exec` and `PRAGMA user_version` in `tx()`
    (`server/db.js`, verified), and SQLite DDL is transactional. Failure-injection test D6.07 proves it.
- Only `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER`, `ALTER TABLE … ADD COLUMN` with a constant default or NULL.
  **No `UPDATE`/`DELETE` of existing rows. No back-fill.** Foreign-key columns default NULL, as SQLite requires with
  foreign keys on.
- New settings keys added to the `SETTINGS` allow-list in `server/routes/setup.js` (typed); no migration needed.

### 4.3 Migrations
**m30 · Phase 1 · foundation and audit**
- `CREATE TABLE checkin_events`:
  - `id TEXT PK` (server-namespaced `d<device>:`/`u<user>:`/`s:` + uuid)
  - `campus_id INTEGER NOT NULL REFERENCES campuses(id)` (no cascade)
  - `action TEXT NOT NULL`, `checkin_ids TEXT DEFAULT '[]'`, `pickup_id TEXT` (no FK)
  - `device_id INTEGER`, `device_name TEXT DEFAULT ''`, `user_id INTEGER`, `user_name TEXT DEFAULT ''`
  - `operator_name TEXT DEFAULT ''`, `client_at TEXT`, `at TEXT DEFAULT (datetime('now'))`
  - `detail TEXT DEFAULT '{}'`
  - indexes `(campus_id, at)`, `(pickup_id)`
- `CREATE TRIGGER checkin_events_no_update BEFORE UPDATE ON checkin_events BEGIN SELECT RAISE(ABORT,'append-only'); END;`
  and `…_no_delete BEFORE DELETE`.
- `checkins` + `device_id`, `user_id`, `checked_out_device_id`, `checked_out_user_id` (INTEGER, NULL, FK
  `SET NULL`); `released_to TEXT DEFAULT ''`, `released_to_kind TEXT DEFAULT ''`, `release_method TEXT DEFAULT ''`,
  `id_checked INTEGER DEFAULT 0`, `operator_name TEXT DEFAULT ''`, `client_checked_out_at TEXT`, `voided_at TEXT`,
  `voided_by INTEGER`, `void_reason TEXT DEFAULT ''`, `flags TEXT DEFAULT ''` (`clock_skew`, `unleased`, …).
- `checkin_devices` + `revoked_at TEXT`, `revoked_by INTEGER`, `token_next_hash TEXT`, `token_rotated_at TEXT`,
  `app_version TEXT DEFAULT ''`.
- `people` + `household_set_at TEXT`, `household_set_by_kind TEXT DEFAULT ''` (NULL/'' = on file before this
  change).

**m31 · Phase 2 · codes and pickup sessions**
- `CREATE TABLE checkin_code_leases`:
  - `campus_id NOT NULL FK campuses CASCADE`, `prefix TEXT NOT NULL`
  - `device_id FK checkin_devices SET NULL`, `device_key TEXT`, `user_id FK users SET NULL`
  - `leased_at`, `last_used`, `released_at`
  - `PRIMARY KEY (campus_id, prefix)`
- `CREATE TABLE checkin_pickups`:
  - `id TEXT PK`, `campus_id NOT NULL FK`, `household_id FK SET NULL` (server-derived), `day TEXT NOT NULL`,
    `code TEXT NOT NULL`
  - `device_id`, `user_id`, `station TEXT`
  - `origin TEXT DEFAULT 'tablet'` (`tablet|server`), `conflict`, `mismatch`, `code_unknown INTEGER DEFAULT 0`
  - `code_revoked_at TEXT`, `restrictions_snapshot TEXT DEFAULT '[]'`
  - `created_at TEXT NOT NULL`, `received_at DEFAULT now`
  - index `(campus_id, day, code)`
- `checkins` + `pickup_id TEXT REFERENCES checkin_pickups(id) ON DELETE SET NULL`, `duplicate_of TEXT`, index
  `(pickup_id)`.

**m32 · Phase 3 · permissions and stations**
- `users` + `checkin TEXT NOT NULL DEFAULT ''`, `checkin_pin_hash TEXT`, `checkin_pin_set_at TEXT`.

**m33 · Phase 4 · child protection**
- `CREATE TABLE pickup_restrictions`:
  - `id`, `person_id NOT NULL FK people CASCADE`, `kind`, `basis`
  - `restricted_person_id FK SET NULL`, `restricted_name`, `station_note`, `details`
  - `starts_on`, `ends_on`
  - `created_by`, `created_at`, `pending_end_at`, `pending_end_by`, `ended_at`, `ended_by`, `ended_reason`
  - index `(person_id)`
- `household_pickups` + `person_id FK SET NULL`, `photo`, `child_ids`, `starts_on`, `ends_on`, `pickup_session_id`,
  `one_time INTEGER DEFAULT 0`, `id_required INTEGER DEFAULT 0`, `notes TEXT DEFAULT ''`, `created_by`,
  `created_at` (NULL for old rows), `archived_at`, `archived_by`.
- `CREATE TABLE checkin_overrides`:
  - `id TEXT PK`, `campus_id NOT NULL FK`, `kind`, `checkin_ids`, `pickup_id`
  - `released_to`, `released_to_ref`, `reason`
  - `requested_device_id`, `requested_user_id`, `requested_at`
  - `status DEFAULT 'pending'`, `decided_by`, `decided_via` (`pin|phone|tablet`), `decided_at`, `decision_note`,
    `expires_at`
- `people` + `pickup_verified_at TEXT`, `pickup_verified_by INTEGER`.

**m34 · Phase 5 · labels**
- `people` + `label_medical INTEGER NOT NULL DEFAULT 0`.

Result: 34 migrations and 64 tables (`docs/database.md` updated, with a count test D6.13).
Also: person merge (`people.js:189`) moves `pickup_restrictions.person_id`/`restricted_person_id`,
`household_pickups.person_id`, `checkin_overrides.released_to_ref`, `pickup_verified_*`.

### 4.4 Preservation guarantees
- Original columns of **every** existing table hash-identical before and after migration (D6.01). Row counts of all
  59 tables unchanged. `foreign_key_check` and `integrity_check` clean.
- Historical 4-character codes stay as stored. Legacy rows read as `pickup_id NULL`. History groups them by
  (campus, day, code, household).
- Nothing in this plan hard-deletes a check-in, contact, restriction, station or event. Retention purges (D17) touch
  only one-time contacts created after deploy, and are a separate owner decision.
- Residual risk recorded in tech-debt: `checkins.person_id ON DELETE CASCADE` remains (changing it needs a table
  rebuild). There is no person or campus hard-delete route today (verified: only archive and merge).

### 4.5 Upload and check-out compatibility (summary)
- `POST /checkin/checkins` accepts the v3 shape forever. It becomes a legacy row, or a server-made pickup when the
  flag is on. Unknown person → skipped plus event; archived person → skipped plus event; adult as kid → flagged.
- `POST /checkin/checkout`:
  - v2 `{mode:'request'}` → all-or-nothing, 409 with reason.
  - v2 `{mode:'report'}` (outbox, `client_at`) → always recorded per id: allowed → released at the bounded client
    time; violation → released (it already happened) plus one urgent `release_violation` alert. Per-id results.
  - v3 `{ids}` / `{security_code}` → see 4.6.

### 4.6 Old tablets and outboxes (never poison a queue)
- Old app = no `x-checkin-app` header. Counted per device; "Needs reload" on Stations and Live.
- v3 `{ids, by}`: processed **per id**.
  - Allowed ids are applied idempotently on every retry, so later offline releases in the same outbox are never
    lost.
  - A restricted id (only possible if pickup alerts are on, which requires no old app for 7 days) is not applied:
    one de-duplicated urgent alert "An old iPad tried to release a child with a pickup alert. Check the room", and
    409 "Reload this iPad" so the old live UI shows an error rather than "checked out".
  - Retries of the same ids produce no new alerts.
- v3 `{security_code}`: ambiguous across households → 409 listing families. Single household → works as today
  until the legacy sunset date, then 409 "Reload this iPad".
- New app first start: sends the old `mb.checkin.queue` and `mb.checkin.outbox` once in their old shape (as
  reports), then switches to v2 keys. Safe if killed half-way (idempotent).
- Service worker `mb-checkin-v4`; `FILES` verified by test; no dynamic imports in `checkin.js`. `min_app` on every
  `/checkin/*` response. Self-reload only when online, the queue is empty and no dialog is open.

### 4.7 Active check-ins at deploy
- Deploy each phase on a **weekday morning with no kids' programme** at any campus (owner confirms midweek times).
  Flags stay off at deploy.
- Day-scoped "open" means Sunday's legacy codes are inert by Monday. Yesterday's still-open rows are shown on a
  "Not checked out yesterday" list for coordinators; never auto-closed.
- Enabling pickup sessions: on a weekday after **every tablet shows the new version**, except one untouched
  **legacy fallback tablet per campus**, kept for two Sundays (the soak). The fallback works throughout (legacy
  rows, unrestricted).
- Legacy sunset = 14 days after enabling (owner can extend). Pickup alerts are enabled only after the sunset and
  `explicit` mode.

### 4.8 Feature flags, and what can never be silently disabled
| Flag (`settings`) | Turns on | Off again? |
|---|---|---|
| `checkin_pickups` | Prefix codes, pickup sessions, lane UI | Yes (soft rollback): tablets go back to legacy generation within one `changes` poll. Existing pickups still enforced. |
| `checkin_access` | `leaders` → `explicit` | Yes, back to `leaders`. Pickup alert data then stops going to unflagged accounts, so restriction *display* goes to stations only. |
| `checkin_restrictions_ui` | Hub management screens and alert display | Hides screens only. **Enforcement stays.** |
| `checkin_id_check` | Policy | Changeable. The careful lane always forces ID. |
| `checkin_hours`, `checkin_offline_max_age_min`, `checkin_legacy_until`, `checkin_roster_scope` | — | Changeable; changes audited old→new. |

**Always on once shipped (no flag):**
- the pickup binding (ids must belong to the pickup)
- the legacy ambiguity guard
- restriction enforcement on every path once any active restriction exists
- the append-only events
- the station allow-list
- campus checks

The only off-switch for enforcement is an emergency kill switch: admin only, typed reason, notifies all admins and
coordinators, auto-expires after 24 h, banners still shown.

### 4.9 Rollback per phase
| Phase | Soft rollback | Hard rollback (revert PR, outside service hours) | Caveats |
|---|---|---|---|
| P1 | None needed (no UI change) | Safe: old code ignores new columns and triggers (D6.08 runs old code on the migrated DB). | Void and revoke revert to hard delete in old code. |
| P2 | `checkin_pickups` off | Only on a day with **no open pickup-session check-ins**; old tablets can't type 5–6 characters. | Reload tablets after revert. Outbox v2 entries: the new app flushes them before the revert (procedure: "0 waiting" on all tablets first). |
| P3 | `checkin_access = leaders` | Safe after soft rollback. | Coordinator PINs unused. |
| P4 | Screens off; enforcement continues | **Restrictions are not enforced by old code.** Before reverting, print the pickup-alerts sheet, brief desks, run paper procedure. | Never drop tables; a re-deploy reuses them. |
| P5 | `checkin_roster_scope = all` | Safe. | Old code shows the full roster again. |
| P6/P7 | — | Safe. | — |

---

## 5. Testing and verification

### 5.1 Consolidated test list
IDs follow the QA review; `S-` are Security, `O-` Operations, `N-` new here. **M** = must (blocks the phase PR),
**S** = should. Type: API, RULES, SW, BR (Playwright), MAN (device).

**Pickup codes (P2)**
- M: P1.01 unique per device (RULES) · P1.03 cross-device property (RULES) · P1.04 same-lease collision flagged once
  (BR) · P1.05 3 stations offline, 60 codes, 0 conflicts (BR) · P1.06 no lease → 6-character code, flagged (BR) ·
  P1.07 leases distinct, idempotent, 28th device fallback, parallel race no 500 (API) · P1.09 revoked or re-paired
  device: no prefix reuse that day, queue kept (API) · P1.11 day and campus scoping (API) · P1.12 closed/voided
  ignored (API) · P1.13 across services (API) · P1.15 legacy day mixed with new (API) · P1.16 old tablet after flag
  (API) · P1.17 normalisation, bad body 400 (RULES+API) · P1.18 confusable characters rejected, near-miss shows names
  (RULES+BR) · P1.19 input lengths and auto-submit (BR) · P1.23 injectable random (RULES) · S-M1 lease cap per user,
  revoke keeps lease (API) · S-H2c prefix not leased → conflict (API).
- S: P1.02 exhaustion terminates · P1.08 device-key churn bounded · P1.10 reclaim after 30 days · P1.14 three-way
  conflict de-duplicated · P1.20 reproduce F4/F5 on old code first · P1.21 parent tag locked on · P1.22
  reissue/reprint.

**Check-out and lanes (P2/P4)**
- M: C2.01 cross-family by code refused · C2.02 cross-family ids, all-or-nothing · C2.03 child-by-child · C2.04
  siblings in different rooms · C2.05 partial pickup with scoped contact · C2.06 duplicate child check-in ·
  C2.08 lost tag Tier B and C · C2.09 yesterday/other campus, no leak · C2.10 already released, first release kept ·
  C2.11 concurrent release ×50 · C2.13 offline report replay ×3, out of order · C2.14 double release alert ·
  C2.15 offline release vs restriction added offline → recorded + `release_violation` + one alert · C2.16 time
  bounds, DST · C2.17 undo release · C2.21 void rules · S-H2a/b pickup household derived, mismatch flagged ·
  S-H6 `/active` has no codes for helpers; `?day=` 403 for stations · S-M9 revoked code refused, alert · N-1 lane
  computation table (fast/careful) · N-2 Tier B tag holder needs ID and child name, recorded · N-3 Tier A without
  photo → ID required, "ID seen" remembered · O-1 stopwatch: Tier A ≤ 8 s, Tier B ≤ 20 s (BR timed + MAN).
- S: C2.07 two services · C2.12 restriction added during release (same transaction) · C2.18 wrong child by sight ·
  C2.19 messages · C2.20 non-kid rows · C2.22 batch split race.

**Custody and restrictions (P4)**
- M: R3.01 `canRelease` matrix (golden fixture shared by rules and API) · R3.02 name matching normalisation +
  nickname table, match → check_first · R3.03 every path, hard block even for admin, multi-child atomic · R3.04
  added mid-service: server immediate, tablet ≤ 45 s, alert for in-room child · R3.05 stale offline list > 180 min →
  PIN · R3.06 ended needs second person; pending_end still enforced · R3.08 override binding, expiry, single use,
  campus · R3.09 canary `details` absent everywhere (roster, active, pickup, live, push, inbox, audit, events,
  search, CSV) · R3.10 labels have no restriction text; medical label rules · R3.12 generic notification text ·
  R3.13 per-child scope · R3.14 merge moves restrictions · R3.16 banners at check-in, Rooms, check-out ·
  S-H1a station- or helper-added adult = not yet known · S-H1b name-only match · S-H1c campus check on `POST /people`
  household · S-H7 leaders mode: no restriction key; enabling refused · S-H8 self-approval, own household, ending
  needs second, staff can't add contact to restricted household · S-M10 enforcement survives the flag off; kill
  switch audited and notified · S-M12 override IDOR, other station, concurrent use · N-4 coordinator PIN: online
  verify, offline verify, 5-try lock, rotation, hashes only to stations in explicit mode · N-5 Alert button event
  and notification.
- S: R3.07 timezone dates · R3.11 member app never exposes · R3.15 household move keeps restrictions; restricted
  household reachable by all-campus search · R3.17 limiter doesn't block legitimate desks.

**Contacts and verification (P4)**
- M: A4.01 one-time valid that pickup and day only · A4.02 at check-out only via override (restricted) · A4.03 ID
  policy × kind, old client omitting `id_checked` · A4.04 no photo / 404 photo → ID · A4.05 archived contact refused
  online · A4.06 scope; malformed fails closed · A4.08 campus checks and audit on pickup routes (F11) · A4.11 old
  contacts keep working (recognised) · A4.12 foreign session id refused · S-H5 station photo endpoint scope
  (200/404/403) · S-M11 one-time for restricted child needs coordinator.
- S: A4.07 date bounds · A4.09 NULL-campus households · A4.10 contact equal to restricted person blocked.

**Permissions and stations (P1/P3)**
- M: P5.01 table-driven matrix across all roles and stations · P5.02 mode flip, auto-leader loses access, admin
  never locked out · P5.03 revoked flag mid-session · P5.04 campus limits, 404 vs 403 · P5.05 station allow-list
  router sweep · P5.06 station revoked mid-service, nothing lost · P5.07 `user_id` null handling · P5.09 details
  visibility · P5.10 volunteer and guest · P5.12 existing users' effective access unchanged in `leaders` mode ·
  S-H9 hours window, rotation, revoke keeps name, roster TTL · S-L6 only admin grants coordinator.
- S: P5.08 spoofed `by` ignored · P5.11 `x-mb` on new routes · S-L5 CSP header.

**Data integrity and migrations (every migration PR)**
- M: D6.01 original-column hashes on all tables + counts + integrity checks · D6.02 defaults · D6.03 historical
  reports deep-equal; grep test that every `FROM checkins` applies the void and duplicate filters · D6.04 void keeps
  row · D6.06 production-shaped fixture (40 Sundays × 2 campuses × 300 families, odd data) + timing ·
  D6.07 idempotent re-run + failure injection mid-migration · D6.08 old code on migrated DB · D6.09 flags off =
  old behaviour (existing tests unchanged) · D6.10 merge moves new references · D6.11 triggers block update and
  delete · S-M7 namespaced event ids, conflicting payload 409.
- S: D6.05 nothing writes during migration · D6.12 foreign-key behaviour · D6.13 doc count test · D6.14 backup and
  restore includes new tables.

**Backward compatibility (P1/P2)**
- M: B7.01 v3 golden payloads · B7.02 Sunday queue replayed Monday · B7.03 old outbox with a refused id: other ids
  applied each retry, one alert · B7.04 old UI after refusal shows error, not success · B7.05 mixed fleet ·
  B7.06 old tablet with new roster, size · B7.07 service worker v4, files exist, no dynamic imports, failed install
  keeps v3 · B7.09 upgrade with unsynced queue and outbox, killed mid-way.
- S: B7.08 min_app reload guards · B7.10 downgrade strands v2 outbox (procedure) · B7.11 `/active` extra fields.

**Regression (all phases, flags off and on)**
- M: G8.01–G8.11 (new family, labels in all 5 sizes with 5/6-character codes, room rules, allergies and medical
  notes on Rooms, headcounts and weekly totals, reports, idempotent upload, pairing, campus 403, `npm run test:ui`
  as admin/north/volunteer in light and dark, workflows 1/2/6/15).
- S: G8.12 roster timing · G8.13 timezone campus.

**Browser and device**
- M: V9.01 home-screen offline · V9.02 storage eviction · V9.03 in-flight request loss · V9.04 printer failure ·
  V9.05 real labels · V9.06 phone approval page · V9.07 real push · V9.09 iPad orientations, 44 px targets ·
  V9.10 two tabs on one tablet · V9.14 console clean.
- S: V9.08 slow network and fetch timeouts · V9.11 sleep and wake · V9.12 themes.

**Load and time**
- M: L10.01 Easter surge (1,400 check-ins and releases, 6 devices, p95 < 500 ms, no SQLITE_BUSY) · L10.02 roster
  size and quota failure path · L10.03 midnight · L10.04 campus timezone · L10.06 tablet clock wrong · L10.08
  rate limits under load.
- S: L10.05 DST · L10.07 long-outage backlog · L10.09 a year without unpair.

### 5.2 Testability hooks (Phase 1)
- **Server:** `app.locals.clock` (settable only when `NODE_ENV=test`), used by `localNow`, expiry, bounds, limiter
  and leases. Injected `notify` captured in tests. `makeLimiter({clock})`. `openDb(path, {upTo: n})` to build v29
  fixtures.
- **Rules:** `pickupCode(prefix, taken, random)`, `canRelease(..., {today, listAgeMin})` and `laneFor` are pure.
  Golden JSON fixture consumed by rules and API tests.
- **Tablet:** pure logic (queue/outbox migration, issued list, purge, roster minimiser, lane) moves out of
  `checkin.js` into `checkin-rules.js` or a new pure module.
  - Tests seed `localStorage` (lease, issued codes) instead of adding test query parameters to production code.
  - `window.__test` hooks only when the server runs in test mode.
- **Replay simulator** in `test/api.test.js`: any order or duplication of the same event set → same final state.

### 5.3 Browser checks (Playwright, iPad 1024×768 and 768×1024, hub at 390 px)
1. 3 stations offline → distinct codes.
2. Forced same lease → conflict card.
3. Fast lane Tier A, timed.
4. Tier B: tag holder, no-photo, lost tag.
5. Careful lane: hard block screen, PIN approval offline, phone approval online.
6. Stale safety list → PIN.
7. Old v3 app (from `git show 433475f:public/js/checkin.js`) against the new server.
8. Upgrade with queue and outbox.
9. Unpair keeps queue, wipes roster and photos.
10. Rooms auto-refresh and last-2 code display.
11. Print previews: no restriction text, medical flag, initials.
12. `npm run test:ui`, light and dark.

### 5.4 Manual device checklist (record device, iOS, app version, result)
QA M1–M14, plus:
- O-2 timed pickup line with real volunteers (10 families, mixed tiers)
- O-3 coordinator PIN on a real iPad offline
- O-4 push to a silenced iPhone, and the runner fallback
- O-5 label stock and print time with parent tag always on

### 5.5 Migration rehearsal (Phase 0 and before each migration PR merges)
- The owner restores the latest backup to a scratch instance (never production).
- QA runs D6.01–D6.08 on it, times the migrations and spot-checks 10 historical Sundays against old reports.
- Results attached to the PR.

### 5.6 Two-Sunday soak (after Phase 2 enabled)
- One untouched legacy tablet per campus as fallback; all others on the new app.
- Track:
  - conflicts (target 0)
  - `unleased` codes
  - Tier A/B/C counts
  - pickup times (sampled)
  - old-app requests
  - volunteer feedback
- Go/no-go for the legacy sunset and Phase 4 at the end. One more soak Sunday after Phase 4 before reporting "done".

---

## 6. Operations readiness (owned by church staff; text drafted by church-operations and the UI/UX specialist)
1. **Roles per campus per service:** two named approvers (coordinators) on a rota, plus one **safety runner** who is
   not teaching, carries the phone and does approvals. The Live page shows who is on duty.
2. **Training:**
   - 10-minute onboarding for every kids' volunteer: check-in, fast lane, the three "stop and call" cases (pickup
     alert, ID doesn't match, no tag and not a known adult), the words to use, "you are never in trouble for asking".
   - 3-minute pre-service huddle.
   - Shadowing for the first two Sundays.
   - Coordinator session: PINs, approvals, restriction entry, ending rules.
3. **Laminated quick card per station:**
   - the flows and lanes
   - scripts ("We check ID for anyone we don't know; it keeps every child safe"; code clash; waiting for approval)
   - what to do offline
   - what to do if a restricted person arrives, or someone gets angry (don't argue, don't release, alert, call 911
     if threatened)
   - on-duty phone numbers
4. **Signage:** desk and doors: "Keep your tag — you'll need it to collect your child. Anyone collecting may be asked
   for ID. Someone else picking up? Tell us at check-in."
5. **Family communication:**
   - Two weeks before enabling: app announcement, email and bulletin, plus a 20-second stage announcement on the first
     Sunday.
   - The message: 5-character codes, tag every time, ID for people we don't know, add regular pickup people with the
     office.
   - A greeter at pickup for the first two Sundays.
6. **Paper fallback kit** in each desk folder: numbered sign-in sheets per room (child, parent, phone, allergies, time)
   and matching numbered tag pairs. Rule: numbers must match, ID for anyone unknown. Reconciled into the hub on Monday.
7. **Daily "pickup alerts" sheet:** printed per campus each service morning from the hub (names, photos, station
   notes, coordinator on duty; no details). Kept in the coordinator folder; shredded after.
8. **Pre-service checklist (before doors open):**
   - every iPad charged, online, header shows the current version and "Safety list" time
   - Stations page shows no "Needs reload"
   - check-in hours open
   - label rolls (double use) and printers
   - alerts sheet printed
   - approvers and runner named
   - paper kit present
9. **Restriction intake procedure:** who may request (custodial parent, court order), what is kept on paper, two
   trained staff per campus, weekly expiring-alerts review, incident note after any denied release.
10. **Supplies:** label stock roughly doubles (parent tag always printed).

---

## 7. Implementation sequence (each phase is one pull request, deployed with flags off)

| Phase | Content | Size | Effort | Depends on | Main risks → mitigation |
|---|---|---|---|---|---|
| **P0** Prep (read-only) | Inventory on backup copy (§4.1); production-shaped fixture generator; check-out card and lane designs with timing targets; ops procedures, card, signage and comms drafts; owner decisions | S | 1.5 d | — | Decisions late → P1 can start (no decision-dependent behaviour) |
| **P1** Foundation and hardening | m30; events and triggers; device/user/operator on check-in and out; void; revoke; station allow-list and `requireCheckin` skeleton; `POST /people` household campus check and audit and `household_set_at`; pickup-route campus checks and audit (F11); field allow-lists (roster, active, person); archived or non-child upload flags; client time bounds; per-id **report** semantics for old outbox; limiter factory; CSP; version header and Stations "Needs reload"; testability hooks | L | 5 d | P0 | Breaking old tablets → B7.01 golden tests; flags none needed because behaviour is the same for volunteers |
| **P2** Unique codes and pickup sessions | m31; leases with 6-character fallback; `pickupCode`; server-derived household, mismatch and placeholder rules; conflict detection; server-made legacy pickups; `GET /checkin/pickup`, `/changes`, `/photo`; fast-lane UI (Tier A/B, lost tag Tier B, revoke and reissue); duplicates; undo release; outbox v2; Rooms auto-refresh and last-2 code; parent tag and label content; "Who's on this desk?"; service worker v4; flag `checkin_pickups`; Tier C cases temporarily → "staff member signs in on this iPad" | L | 7 d | P1 | Slower lines → O-1 timing gate, pre-ticked children; offline conflicts → backstop; long-running old pages → server keeps v3 shapes |
| *Soak* | Two Sundays, one legacy tablet per campus; then legacy sunset | — | (calendar) | P2 enabled | Go/no-go criteria in §5.6 |
| **P3** Permissions, coordinators, stations | m32; `users.checkin`; `explicit` mode; accounts UI; coordinator PIN (set, verify online and offline, rotate); leases for helper+ only; check-in hours and "Open now"; token rotation; Live page (on-duty, pending, alerts); `checkin_alert` notification kind (unmutable, de-duplicated) | M | 3.5 d | P2 (can start during soak) | Locking out leaders → grant first, flip Monday, rollback to `leaders`; PIN brute force → scrypt, try limit, rotation, Security re-review |
| **P4** Child protection | m33; restrictions (quick form, household level, forced linking, fuzzy match, two-person ending, expiring list, incident note); contacts extended (scope, dates, one-time, archive, photo link, ID required); verification memory; ID policy; overrides with binding; careful-lane UI, hard-block screen and Alert button; offline freshness and PIN fail-closed; restriction snapshot on pickup; in-room alert; daily alerts sheet; enforcement on all paths; preconditions (explicit + sunset); canary tests | L | 7 d | P3, sunset | Custody data leaks → canaries, H7 precondition; false confidence → intake procedure; coordinator unavailable → PIN, two approvers, runner |
| **P5** Roster, labels, retention | m34; roster scope and all-campus search; field minimisation; last-4 phones; TTL and day purges; photo cache purge; label medical flag and per-child full note; one-time contact phone purge job (if D17) | M | 3 d | P4 | Visitors not found → all-campus search; quota → measured in L10.02 |
| **P6** History, docs, release | History page and export; docs (database, permissions, security, api, features, testing, roadmap, tech-debt); release checklist; full regression; Easter load test; migration and rollback rehearsal; device checklist; one Sunday after P4 | M | 3 d | P5 | Untested real-device behaviour → checklist results in PR |
| **P7** (optional, D19) Offline quick-add for first-time families | Client-made guest records queued and reconciled with duplicate handling; added adults always "not yet known" | M | 3.5 d | P2 (any time after) | Duplicates → reconcile screen for staff |

**Effort includes** development, QA and a half-day security review per phase P1–P5.
- **Total:** 30 working days core (P0–P6), 33.5 with P7.
- **Calendar:** about 10–12 weeks including the soaks, and avoiding deploys in Advent/Christmas week if the owner
  prefers.

### Steps (agents)
| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 1 | Inventory queries on restored backup copy (owner restores) | qa-engineer | Yes | — |
| 2 | Check-out card, lanes, banners, Live page and phone approval designs, with timing targets | ui-ux-specialist | Yes (designs) | — |
| 3 | Desk card, scripts, signage, family message, paper kit, pre-service checklist drafts | church-operations | Yes | — |
| 4 | Owner decisions D1–D20 and plan approval; approvals in §8.2 | owner via main session | — | 1–3 |
| 5 | P1 build | senior-developer | No | 4 |
| 6 | P1 security review → QA verification (tests above marked P1) | security-specialist → qa-engineer | Yes → tests only | 5 |
| 7 | P2 build | senior-developer | No | 6, 2 |
| 8 | P2 security review → QA (incl. timing O-1, old-app BR) | security-specialist → qa-engineer | Yes → tests only | 7 |
| 9 | Enable P2, soak two Sundays, sunset | owner + church-operations (observe) | Yes | 8 |
| 10 | P3 build | senior-developer | No | 8 |
| 11 | P3 security review (PIN design) → QA | security-specialist → qa-engineer | Yes → tests only | 10 |
| 12 | P4 build | senior-developer | No | 11, 9 |
| 13 | P4 security review → QA (canaries, lanes, offline) | security-specialist → qa-engineer | Yes → tests only | 12 |
| 14 | P5 build → security review → QA | senior-developer → security-specialist → qa-engineer | No → Yes → tests | 13 |
| 15 | P6 build (history, docs) | senior-developer | No | 14 |
| 16 | Full regression, load, rehearsals, device checklist | qa-engineer | Tests only | 15 |
| 17 | Final review against this plan and the release checklist | chief-architect | Yes | 16 |
| 18 | (optional) P7 build → review → QA | senior-developer → security-specialist → qa-engineer | No → Yes → tests | 8 |

Never two editing agents at once. Steps 1–3 run in parallel.

---

## 8. Owner decisions and approvals

### 8.1 Decisions (recommendation in bold)
| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Code format | 4 random (today) / 5 = device letter + 4 / 6 random | **5 characters, `K 7Q3M`, device letter from the server; 6-character fallback when needed** |
| D2 | Who may check in from a signed-in (unpaired) device | anyone with access / helper+ with a lease (max 2) / paired stations only | **Helper+ with lease; encourage pairing every desk** |
| D3 | Check-in permission | keep "any leader" / helper + coordinator levels, then explicit mode | **Levels; switch to explicit before pickup alerts (required)** |
| D4 | Pickup lanes | one flow for all / fast lane + careful lane | **Two lanes chosen by data (§3.3)** |
| D5 | Non-household adult holding the tag, unrestricted child | coordinator override / helper with ID check, recorded, coordinator told after | **Helper with ID check and the adult naming the child** |
| D6 | Lost tag | always coordinator / tiered | **Tiered: household adult on file + photo or ID → helper; else coordinator; code revoked** |
| D7 | Do-not-release | hard block / override possible | **Hard block for the named person, no override; others in the careful lane need a coordinator** |
| D8 | Coordinator approval methods | phone only / phone + per-coordinator PIN on the iPad | **Both; PIN works offline; two approvers and a runner per service** |
| D9 | Offline safety-list limit | 120 / 180 / none | **180 minutes and same day; then PIN required** |
| D10 | Parent tag content | names + household (today) / initials / count only | **Code, date, children's initials, no household name; always printed** |
| D11 | Phone numbers on iPads | full / last 4 for search + household main phone / none | **Last 4 for search, household main phone kept to call parents** |
| D12 | Medical notes | full on label / flag on label, full on Rooms / hidden | **Allergy strip as today; "MEDICAL: see room list" on label; full note on Rooms for helpers; per-child "print full note" for life-critical cases** |
| D13 | Station limits | none / check-in hours / hours + allowed networks | **Check-in hours with "Open now"; networks optional, off** |
| D14 | Roster scope on iPads | whole church / campus + 12 months anywhere + online search | **Campus + 12 months + "search all campuses" online** |
| D15 | Ending a restriction | one coordinator / second coordinator or admin confirms | **Second person confirms; creating is immediate** |
| D16 | Deploy windows and soak | any time / weekday mornings, two-Sunday soak with one legacy tablet, 14-day sunset | **As stated; owner confirms midweek programme times** |
| D17 | Retention | keep all / keep events and check-ins indefinitely, purge one-time contacts' phones after 90 days | **Keep events indefinitely; purge one-time phones after 90 days; review with pastor/insurer** |
| D18 | Undo release | none / coordinator within 30 min | **Coordinator within 30 min, with reason** |
| D19 | Offline quick-add for first-time families (P7) | defer / include | **Include after P2, before Easter** |
| D20 | Deferred to roadmap | — | **Children in two households (workaround: second parent as standing contact), parent self-service pickup contacts in the member app, push to parent on pickup, tablet camera photos, cache encryption, VBS wristbands, special-needs paging** |

### 8.2 Approvals required by project rules
- **Schema:** migrations 30–34 (additive; owner approves the plan; backup taken before each deploy) — CLAUDE.md
  rule 1, `docs/database.md`.
- **Roles and permissions:** new `users.checkin` levels, `explicit` mode, station rights, coordinator PINs (a new
  credential) — rule 7. Security Specialist sign-off on P1, P3 and P4.
- **Consequential security changes:**
  - station token rotation and revoke
  - check-in hours
  - the emergency kill switch
  - offline PIN hashes on iPads (an accepted, documented risk: brute force on a stolen iPad, limited to offline
    approvals on that iPad)
- **Data retention purge** (D17): a deleting job on new data only; explicit owner approval.
- **No new dependencies, outside services or costs.** Push and inbox are existing and free; no SMS.
- Release checklist applies to P2–P5. The owner merges each PR.

```
Summary: Final child-safety plan consolidating Security (9 High folded in), QA (138 cases → consolidated list) and Ops
  (speed, tiers, PIN, paper fallback). Two lanes: fast for ordinary children (≈ today's speed, ID only when unknown),
  careful for children with pickup alerts (ID always, coordinator for anything unusual, fail-closed offline via PIN).
  5 additive migrations; enforcement never behind a flag; old tablets and outboxes never poisoned. 7 phases, 30 d core
  (+3.5 optional), ~10–12 weeks with soaks.
Files: docs/plans/child-safety/plan.md (planning only; no application files changed)
Decisions needed: D1–D20 (§8.1); approvals §8.2
Next: qa-engineer inventory, ui-ux designs, church-operations materials (parallel, read-only); then owner
Evidence: read all three reviews in full; re-checked migrate() atomicity, /uploads guard, settings audit, no
  campus/person delete routes; npm test 42/42 earlier (in-memory)
```
