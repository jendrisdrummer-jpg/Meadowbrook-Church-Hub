# Security review: kids' check-in child-safety plan (DRAFT)

Reviewer: security-specialist (read-only) · 2026-11-25
Plan reviewed: `cs-plan-draft.md` (chief-architect draft, nothing implemented)
Code read: `server/routes/checkin.js`, `server/routes/stations.js`, `server/routes/people.js`, `server/auth.js`,
`server/http.js`, `server/index.js`, `server/db.js` (checkins, household_pickups, checkin_devices, device_pairings,
audit_log, settings), `server/routes/setup.js` (settings, users), `server/routes/teams.js` (syncLeaderAccess),
`server/notify.js`, `public/js/checkin.js`, `public/js/checkin-rules.js`, `public/checkin.html`, `public/sw.js`,
`docs/security.md`, `docs/permissions.md`, `docs/database.md#sensitive-data`.
No files were changed and nothing was run against a database.

---

## 1. Summary

The plan is a real improvement on today. Pickup sessions with "ids must belong to this pickup", restrictions
that override household membership, void instead of delete, append-only events and per-device prefixes all fix
the findings F1–F19, and I agree with them. The weak spots are where the plan **trusts something the attacker
controls**:

- **who counts as a household adult.** Any leader or station can add an adult to a household today.
- **what the tablet says a pickup is.** The client supplies the household, campus binding and placeholder pickups.
- **how fresh the tablet's restriction list is** when it is offline.
- **the pickup code.** It is printed, shown on the Rooms screen and returned by `/checkin/active`, so it is not a secret.
- **photo checks.** They are the main identity check, and they silently fail on paired iPads and offline.
- **coordinators.** One coordinator can request, approve and end restrictions alone.

There are also several Sunday denial-of-service paths: lockouts, running out of leases, conflict floods and
notification storms.

Nothing here is Critical today, because the design isn't built yet. **H1–H8 should be treated as must-fix in
the plan before phase 2/4 is approved.** For child safety they decide whether a do-not-release actually
holds.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 9 |
| Medium | 13 |
| Low | 6 |

---

## 2. Findings

### H1 · High: anyone who can add a household adult becomes an "authorised" pickup, and name-only restrictions are easy to miss
- **Where:** plan §3.3 step 4, §3.4 "Restriction beats implicit household-adult authorisation", §3.5. Code:
  `server/routes/people.js:131-160` (`POST /people`, guard `leader`): the non-station path checks only
  `canCampus(f.campus_id)`, not the household's campus. Any leader can pass `household_id` + `household_role:'adult'`
  with `force:true` to skip the duplicate check. Stations can do the same for any household at their campus or with
  campus NULL (`:139-143`). `PATCH /people/:id` (staff) changes `household_id` with only a field-name audit (`:170-178`).
- **What could happen:** a non-custodial parent who leads any team (auto-leader, `teams.js:135-147`), or who has a
  friend on the welcome desk, adds "Mike Jones" as an adult in the child's household. The plan's check-out list then
  shows him as a household adult, with no ID check under D7 `unrecognised`. If the restriction was entered by name
  ("Michael Jones") or linked to his *other* directory record, the hard block never fires. The same bypass happens
  with no malice: the restricted parent is still listed as a household adult under a slightly different name.
- **Recommended change to the plan:**
  1. Authorised = household adults **who existed before today and were not added by a station or helper**, plus
     active contacts. An adult added to a household with children in the last N days (setting, default 14), or by a
     station/helper, is "unrecognised". That means ID check plus coordinator override if the child has any restriction.
  2. When a restriction is created, the hub **forces linking** to a directory person if any household adult or
     contact fuzzy-matches the name (same last name, or first-name prefix). Show "Is this the same person as …?"
     If a name-only restriction remains, the release check also matches normalised first and last names (case,
     accents, nickname table) and treats a match as `check_first`, not "allowed".
  3. Any child with an active restriction: **every** release needs ID check plus photo match, whoever the adult is (D7 already lists restricted children; make it explicit that household adults are included).
  4. In the same phase, fix `POST /people` for non-stations: check the household's campus with `canCampus`. Also
     write `audit()` with household id and role, plus a coordinator notification when an adult is added to a household
     whose children have restrictions.
- **Test:** (a) a leader posts `/people {household_id: X, household_role:'adult', force:true}` and then
  `GET /checkin/pickup`. The new adult is listed as `unrecognised` and checkout to them without `id_checked` returns 409.
  (b) Restriction name "Michael Jones" and household adult "Mike Jones": release to Mike returns 409 `check_first`.
  (c) A campus-limited leader adding to another campus's household gets 403.

### H2 · High: the tablet decides which family a pickup belongs to, so it can bind one family's code to another family's children
- **Where:** plan §3.3, §3.9 (`POST /checkin/checkins` "accepts optional `pickups[]` and `pickup_id` per record"),
  §7.1 test 3 ("records referencing an unknown pickup create a placeholder"). Migration 30: `checkin_pickups.household_id`
  is client-supplied; `checkins.pickup_id` has no check against the child's household or campus. Current code trusts
  the client the same way: `server/routes/checkin.js:58-71` (any `person_id`, any code).
- **What could happen:**
  - A malicious leader or station (or a buggy or cloned tablet) uploads pickup P with `household_id = A` and attaches
    child of household B to P. Family A's tag and adults can then release B's child, and the server check "every id
    belongs to `pickup_id`" passes.
  - Records can point at a pickup id from another campus.
  - A placeholder pickup created from an unknown id can be claimed later by a second upload carrying attacker-chosen
    code and household (`INSERT OR IGNORE` keeps whichever came first).
- **Recommended change to the plan:**
  - The server **derives** `checkin_pickups.household_id` from the children's `people.household_id` and ignores the
    client value. A record whose child's household differs from the pickup's household is stored, never dropped, but
    gets `conflict = 1` and a `pickup_mismatch` event, and can only be released through a coordinator.
  - Attaching to an existing pickup requires the same `campus_id`, same `day` and same household.
  - Re-sending a pickup id with different campus, day, code or household returns 409 for that record and writes an event.
  - Placeholders are created with `code_unknown = 1` and can only be released through a coordinator. A later upload
    may fill in the code only if it comes from the same device that owns the prefix.
  - Validate the pickup id format the same way as check-in ids (`/^[\w-]{8,64}$/`).
  - Check that the code's prefix belongs to the uploading device's lease. A mismatch sets `conflict = 1`, which also
    catches cloned or stolen tokens.
- **Test:** upload pickup {household A} with child of B, then `POST /checkin/checkout {pickup_id, ids:[B child]}`
  returns 409 and a `pickup_mismatch` event exists. Upload a record to a pickup id from campus 2 while station is campus 1:
  the record is flagged, not linked. A re-sent pickup id with a different code returns 409 and the original is unchanged.
  A code with a prefix not leased to the device gives `conflict = 1`.

### H3 · High: do-not-release fails open offline, and restrictions added during a service may never reach a tablet
- **Where:** plan §3.1 ("enforced on the tablet for offline"), §3.10, §3.11. The plan has no maximum roster age.
  Code: roster refresh only every 10 min and only when `navigator.onLine` (`public/js/checkin.js:73,76-92`). A tablet
  uses whatever roster it last stored (`:66`), however old.
- **What could happen:**
  - A coordinator enters an emergency do-not-release at 10:05 during a service. A tablet whose Wi-Fi dropped at
    10:00, or which refreshes at 10:10, releases the child at 10:07 to the named adult.
  - A tablet that sat offline in a cupboard since last month boots offline on Sunday with a roster that has none of
    this month's restrictions.
- **Recommended change to the plan:**
  1. Roster and restrictions carry `generated_at` and `restrictions_version`. **Offline release is allowed only if
     restrictions were refreshed within a set limit** (setting `checkin_offline_max_age_min`, default 120, and
     always "today"). Past it, offline check-out of *any* child goes to "Find a coordinator" (fail closed). The
     screen shows "Safety list last updated 9:12".
  2. Add a light `GET /checkin/restrictions?campus_id&since=version`, polled every 60 s while online (cheap, no PII
     if unchanged), plus an immediate refresh before every **online** check-out (the server check runs anyway).
  3. When a restriction is created or changed for a child who is **currently checked in**, notify coordinators
     ("A pickup alert was added for a child who is in a room now") and flag the pickup so the server blocks
     even legacy paths.
  4. Store station-safe restrictions **with the pickup at check-in time** (copy on the tablet), so a later roster
     shrink can't remove them.
  5. `check_first` and `court_order` children: no offline release at all (state it; the plan implies it through
     "overrides not available offline").
- **Test:** rules test: `canRelease(..., {restrictionsAgeMin: 121})` returns `needs_coordinator` for any child.
  Browser: load the roster, go offline, set the clock to +3 h, try check-out and see "Find a coordinator". API:
  create a restriction for a checked-in child, and a coordinator notification is written. `GET /checkin/restrictions?since=`
  returns only changes.

### H4 · High: offline check-outs that break a rule would be refused on replay, losing the record, jamming the outbox and flooding coordinators
- **Where:** plan §3.3 legacy "restriction checks apply to every path … gets an error toast", §3.1 "server never
  drops a child's check-in (flags, never rejects)", §7.1 test 10. Code: `flushCheckouts()` sends **all** outbox ids
  in one request, retries every 30 s and clears only on success (`public/js/checkin.js:429-438`).
- **What could happen:** a check-out that happened offline (child already gone) is replayed. The new server returns
  409 because of a restriction, ambiguity or bounds.
  - The whole legacy outbox never clears, so other children's check-outs are never recorded either.
  - A `release_denied` event plus a coordinator push is generated every 30 s per tablet (alert storm), and the real
    signal "a restricted child was released offline" is buried or treated as noise.
  - In the new outbox, the same happens if replay is all-or-nothing.
- **Recommended change to the plan:**
  - Distinguish **requests** (online: refuse with 409) from **reports of releases that already happened offline**
    (outbox v1 and v2, `client_at` older than the request). Reports are always recorded: `checked_out_at = client_at`
    (bounded), plus a `release_violation` event (restriction, ambiguity, unknown adult) with a **single** urgent
    coordinator and admin notification per child, deduplicated by `event_id` or `checkin_id`.
  - Process per id and return per-id results so one bad id never blocks the batch.
  - The old outbox (ids only) is treated as "report" because it can only come from an offline release.
- **Test:** an old-shape outbox `{ids:[restricted, normal]}` replayed 3 times gives both checked out, one
  `release_violation` event and one notification. A new-shape replay with one id outside the pickup gives the other
  ids applied and a per-id error for the bad one.

### H5 · High: photo verification cannot work on paired iPads or offline, so volunteers release on a blank avatar
- **Where:** plan §3.5, §3.3 step 4 ("with photos"), D13. Code: `/uploads` is served only to a **signed-in cookie user**
  (`server/index.js:100`, `requireRole('volunteer')`). `stationAuth` runs only inside `/api` and only for `stationMay`
  paths (`index.js:69`, `stations.js:27,36`), so a paired station gets 401 for every photo. The SW caches no photos
  (`public/sw.js:6,18`).
- **What could happen:** the main defence against "someone with a photographed tag who says 'I'm Dad'" is matching
  the adult to a photo. On every paired iPad, and on every tablet offline, the photo is missing. Volunteers learn to
  ignore it, and D7 `unrecognised` asks for no ID from household adults or standing contacts.
- **Recommended change to the plan:**
  - Add `GET /api/checkin/photo/:person_id` (station or helper). It serves only photos of adults and children
    **linked to an open pickup at the caller's campus today**, or in the roster scope, with `Cache-Control: private,
    no-store` for stations.
  - Cache photos only for households checked in today, in a separate cache `mb-checkin-photos-<day>`, deleted on
    unpair and on the day purge.
  - Policy: **an authorised adult with no photo, or whose photo can't load, needs an ID check** (add to D7
    `unrecognised`).
- **Test:** API: a station token fetching the photo of a child with an open pickup gets 200, of an unrelated person
  gets 404/403, and from another campus gets 403. Browser: a paired station shows the contact photo, and offline after
  check-in still shows it. Rules: `canRelease` with `adult.photo == null` and policy `unrecognised` returns `needs_id`.

### H6 · High: the pickup code is not a secret, but the plan treats "code + choose a name from the list" as verification
- **Where:** plan §3.2 ("a code alone is never enough once the authorised-person check is on"), §3.3 steps 2–4.
  Code: the Rooms screen prints every child's code next to their name (`public/js/checkin.js:453`). `GET /checkin/active`
  returns `ci.*` (codes) plus medical notes to any leader, any day (`server/routes/checkin.js:78-88`). The child label
  prints the code (`checkin.js:467`). The parent tag prints household name, children's names and code (`:470-475`).
- **What could happen:**
  - Anyone who photographs a parent tag, reads a child's back label, glances at the Rooms screen, or is an auto-leader
    with the API knows the code **and the children's names**.
  - At the desk, the plan's card shows the authorised adults' names **before** the adult says who they are, so the
    impostor reads "Grandma Jane, Uncle Bob" off the screen and claims one. With `unrecognised`, a household adult or
    standing contact needs no ID.
- **Recommended change to the plan:**
  1. Check-out card: show children and alerts first. The volunteer **asks "Who's collecting?"** and taps the person
     the adult names, then sees the photo to match. The adult names list is not shown to the person at the counter
     (screen faces the volunteer, list collapsed behind "Who are you?").
  2. Remove codes from the Rooms screen (show the last 2 characters at most, or nothing). Remove `security_code` from
     `/checkin/active` for helpers and stations except for the caller's own device's pickups. Restrict `?day=` to
     today for non-coordinators.
  3. Parent tag: code, date and number of children only. Child names on it are an owner choice (D11), but recommend
     initials.
  4. Not on the photo list, or no photo: ID required (see H5).
- **Test:** API: a helper calling `/checkin/active` gets no `security_code` field and `?day=yesterday` returns 403.
  Browser: the Rooms screen has no code text. The check-out card does not render adult names until "Who's collecting"
  is opened.

### H7 · High: in `leaders` mode, every team leader would see custody/restriction names for the whole church
- **Where:** plan §3.7 table (helpers and stations "see restriction names + station note"), `checkin_access =
  'leaders'` at deploy, §8 ("4 needs 3", but not "4 needs explicit mode"). Code: roster is `requireRole('leader')`
  (`checkin.js:23`) and leader comes automatically from team leadership (`teams.js:135-147`).
- **What could happen:** phase 4 ships while the church is still in `leaders` mode. Every worship, tech or hospitality
  leader's phone can download `/checkin/roster`. That shows which families have a do-not-release or court order, the
  restricted person's name and photo, and the station note, for every household in scope. That reveals custody
  disputes and domestic-abuse situations to dozens of people with no child-care role. Today they already see every
  child's medical notes (F12/F15).
- **Recommended change to the plan:** make **`checkin_access = 'explicit'` a precondition for turning on
  `checkin_restrictions`**, enforced in code: the server refuses to enable it and `canRelease` data isn't sent while
  in `leaders` mode. Alternatively, in `leaders` mode send restriction data only to paired stations and flagged
  accounts. Restriction data never goes to unflagged leaders.
- **Test:** in `leaders` mode, a leader without the flag gets a roster with no `restrictions` key. A paired station
  gets it. `PATCH /settings {checkin_restrictions:true}` while `leaders` returns 400 with an explanation.

### H8 · High: one coordinator can do everything alone: self-approve, end a restriction, release to themselves
- **Where:** plan §3.6 (coordinator may approve "on the spot" if signed in on that tablet), §3.4 "Who" (coordinators
  set/end restrictions), §3.7 (staff without the flag manage pickup contacts "as today").
- **What could happen:**
  - A coordinator who is the restricted parent, a relative, or simply pressured ends the restriction (audited, but
    after the fact) or approves their own override, and releases the child. Nobody else learns of it until someone
    reads History.
  - A staff member adds the restricted person as a pickup contact under another name. A name-only restriction misses it (H1).
- **Recommended change to the plan:**
  1. **Two-person rule for restricted children:** requester ≠ approver. A coordinator can't approve an override where
     `released_to_ref` is their own person or someone in their own household.
  2. **Ending or weakening a restriction** (end, date change, `court_order` → `check_first`) needs a second
     coordinator or an admin to confirm. Alternatively it takes effect after 24 h, with an immediate notification to
     all admins and the campus's coordinators. A coordinator can't end a restriction on a child in their own household.
  3. Every override approval and every restriction change notifies all coordinators of that campus plus admins (no
     names in push, see M13).
  4. Pickup contacts for a child with an active restriction can only be added or changed by coordinators, and each
     change is notified.
  5. Coordinators can't grant coordinator; only admins can (state it for `PATCH /users`).
- **Test:** coordinator A requests and approves the same override, giving 403. Coordinator approves a release to their
  own `person_id`, giving 403. Coordinator ends a restriction: it stays `pending_end` until a second coordinator or
  admin confirms, and notifications are written. Staff adding a contact to a restricted child's household gets 403.

### H9 · High: the station token is a permanent bearer secret, and a lost or stolen iPad keeps everything
- **Where:** plan §3.7 "Station rights tightened", §3.11 purge on unpair, §6.6. Code: the token never expires and is
  accepted from any network at any time (`stations.js:31-43`). It is stored in `localStorage` (`checkin.js:9,136`).
  Roster wipe on removal happens only if the iPad **reaches the server** and gets 401 (`checkin.js:37,94-98`).
  Removal hard-deletes the device (`stations.js:126`).
- **What could happen:**
  - A stolen, borrowed or "taken home" iPad, or a token copied from an unlocked one (Safari's Web Inspector, or a
    device backup), downloads the roster (children's medical notes, phones, and soon restriction names) from home,
    and can run pickup lookups and check-outs from anywhere.
  - Kept offline, a stolen iPad keeps the roster forever. Removing it in the hub does nothing to the cached data.
- **Recommended change to the plan:**
  1. **Check-in hours:** a campus setting for check-in windows (or "Open check-in" toggled by a coordinator). Outside
     the window, station tokens get roster and check-out 403 (pairing info still works). Hub notification on use
     outside the window.
  2. Optional per-campus **allowed networks** (IP/CIDR list via `trust proxy`, already set in `index.js:45`).
     Notify on the first use from a new IP.
  3. Rotate the token on the first request of each day (server returns a new token, old valid for 10 min).
     A copied token then goes stale.
  4. **Roster TTL on the device:** drop the roster and day lists if there has been no successful refresh for 7 days
     (setting). The screen then says "Connect to update".
  5. Station removal becomes **revoke** (`revoked_at`, `revoked_by`) instead of `DELETE`, so events keep the device
     (see M7) and the lease stays held for the rest of the day (see M1).
  6. Audit roster downloads (device or user, campus, size) in `checkin_events` (action `roster`).
- **Test:** a station token outside the window gets 403 on `/checkin/roster` and a notification is written. A token
  used after rotation plus 10 min gets 401. A revoked station's events still show its name. Browser: a roster older
  than TTL is purged on start.

### M1 · Medium: leases can be exhausted, and the planned FK frees a prefix the same day
- **Where:** plan §3.2 (27 prefixes; signed-in tablets lease by a random `device_key` they choose), D2, migration 30:
  `checkin_code_leases.device_id … ON DELETE CASCADE`.
- **What could happen:**
  - Any leader opening `/checkin` in private browsing, on several phones, or with a script calling `POST /checkin/lease`
    with fresh `device_key`s uses up all 27 prefixes, since leases are held for 30 days. The next real station gets
    "clear error" on Sunday and can't check in.
  - Removing a station (`stations.js:126` DELETE) cascades its lease away **immediately**, so a new device can get
    the same prefix that day and issue codes that collide with ones parents already hold. That contradicts "never
    reclaimed on the current day".
- **Recommended change to the plan:**
  - Leases only for paired stations and for accounts with check-in helper+ (in `explicit` mode), with at most 2 active
    leases per user. Coordinators can release a lease from the Stations page (audited, never same day).
  - FK `ON DELETE SET NULL` plus revoke instead of delete (H9).
  - On exhaustion, **never block check-in**: fall back to a 2-character prefix (6-char codes) automatically, and alert.
- **Test:** user requests 3 leases with different keys: the third is refused (or the same lease is returned). 28
  devices: the 28th gets a 2-char prefix, not an error. Revoke a station and lease the next device the same day: the
  prefix is different.

### M2 · Medium: the proposed rate-limit lockout is itself a Sunday denial of service, and the current limiter can be reset
- **Where:** plan §3.8 ("30 per 10 min per device/user, then a 5-min lock"). Code: the limiter that will be shared
  clears **all** counters when the map passes 5000 keys (`stations.js:22`). `auth.js:188` does the same at 10000.
- **What could happen:** a bored child or a prankster types codes at the check-out iPad during pickup, or a stressed
  volunteer mistypes. The whole check-out desk locks for 5 min at the busiest moment. Separately, an attacker sending
  requests with many distinct keys (IPs/devices) wipes every counter.
- **Recommended change to the plan:** for **stations**, no hard lock. Use a progressive delay (1 s, 2 s, 5 s, max 10 s)
  plus a coordinator alert after 30 failures. Keep the hard limit (429) for signed-in **API** callers, keyed by user.
  The shared helper evicts oldest entries (LRU) instead of `clear()`. Count only *failed* lookups. Lookups return the
  same "not found" for unknown and already-released codes.
- **Test:** station with 31 failed lookups: the 32nd still answers (slower), and one notification. User with 31: 429.
  Inserting 6000 keys does not reset an existing key's count.

### M3 · Medium: conflict flags and notifications can be flooded
- **Where:** plan §3.2 server detection (both pickups flagged, coordinators pushed), §3.6, D16. Code: `notify()` sends
  push per call with no dedupe (`server/notify.js:36-50`), and users can mute kinds (`prefs`).
- **What could happen:** a malicious client or a cloned tablet uploads pickups reusing other families' codes. Every
  real family is marked `conflict = 1`, so every check-out needs choose-family plus ID (slow lines). Coordinators get
  one push per conflict, per denied attempt, per override request, and their phones are useless during the service.
  A coordinator who muted the kind gets nothing.
- **Recommended change to the plan:** conflicts are flagged only for pickups whose prefix is **not** the uploader's
  lease (H2) or that come from the same lease twice. Deduplicate notifications (one per pickup or child per 10 min, plus
  a digest of "12 more on the Live page"). Safety kinds (`checkin_alert`) **can't be muted** by coordinators. Cap
  override requests per device (e.g., 10 pending).
- **Test:** 50 conflicting uploads from one device produce ≤ 2 notifications. A muted coordinator still gets `checkin_alert`.

### M4 · Medium: legacy paths keep weak release open for as long as an old tablet runs
- **Where:** plan §3.3 "Legacy rows", §6.3 ("accepting all old payload shapes indefinitely"). Code: the old app posts
  `{ids, by}` (`checkin.js:415,433`) and makes 4-char codes with no pickup.
- **What could happen:** one welcome-desk iPad not reloaded after deploy (very likely) keeps creating **legacy** check-ins
  all Sunday. Those children get none of the new protection: no adult selection, no ID check, no per-child release.
  Restriction checks still apply, but only by child id, not by adult, because legacy checkout has no `released_to`.
  The `ids` path lets any helper or station release any legacy row at the campus by id, and ids are returned by
  `/checkin/active`.
- **Recommended change to the plan:**
  - Once `checkin_pickups` is on, the server **upgrades legacy-shaped new check-ins**: it groups by
    (campus, day, code, household) into a server-made pickup so new-format check-out rules apply.
  - The legacy `{ids}` check-out is accepted only as an offline *report* (H4) for rows checked in before the request,
    or from coordinators. Legacy `{security_code}` for rows with a server-made pickup returns 409 "Reload this iPad".
  - Add a **sunset**: after `checkin_legacy_until` (default deploy + 14 days), legacy shapes are accepted only as
    offline reports.
  - Show "Needs reload" on the Live page as well as Stations.
- **Test:** an old-shape check-in after the flag is on gets a server pickup. An old-shape `{ids}` live checkout of
  that row from a helper returns 409. A coordinator `{ids}` succeeds and is audited. After sunset, `{security_code}`
  legacy returns 426/409.

### M5 · Medium: station access is a path prefix plus `role: 'leader'`, so new `/checkin/*` routes are open to stations by default
- **Where:** `stations.js:27` (`req.path.startsWith('/checkin/')`), `:40` (station is `role: 'leader'`). Plan §3.7
  lists what stations may not do, but plans to add `/checkin/history`, `/checkin/live`,
  `PATCH /checkin/overrides/:id` and void under `/checkin/`. Also `GET /checkin/active?day=` lets a station read any
  past day (`checkin.js:80`).
- **What could happen:** any new route guarded only by `requireRole('leader')`, or by a `requireCheckin` that maps
  role rank to helper or coordinator in `leaders` mode, is reachable by every station token. That covers override
  approval, history and restriction details.
- **Recommended change to the plan:**
  - `stationMay` becomes an explicit allowlist of `METHOD path` pairs.
  - `requireCheckin()` handles `req.user.station` **first** and returns helper, never deriving from `role`.
  - Stations limited to `day = today`.
  - Add a test that walks the Express router stack and calls every `/checkin/*` route with a station token, asserting
    the allowlist.
- **Test:** router-sweep test as described. Station `PATCH /checkin/overrides/1` returns 403. `GET /checkin/history`
  returns 403. `GET /checkin/active?day=<yesterday>` returns 403.

### M6 · Medium: `SELECT *` sends new sensitive columns to stations and leaders
- **Where:** `checkin.js:30` (`SELECT * FROM household_pickups` into the roster), `:84` (`ci.*` in `/checkin/active`),
  `:35` (whole `campus` row). `people.js:116` (`SELECT * FROM household_pickups` in `GET /people/:id`, leader).
  Plan §3.5 adds `notes`, `created_by`, `pickup_session_id` and phone of one-time contacts. Migration 30 adds
  `released_to`, `void_reason` and `voided_by` to `checkins`.
- **What could happen:** contact notes ("Dad not allowed; see office"), void reasons and release names flow
  automatically to every station's localStorage and every leader's phone, contradicting §3.11 minimisation.
- **Recommended change to the plan:** list the roster, active and person-page fields explicitly (allowlists) in phase 1,
  before any column is added. Add a roster "shape" test that fails when a new key appears.
- **Test:** a snapshot of key names for `/checkin/roster` (households, members, pickups), `/checkin/active` and
  `/people/:id` as leader. The test fails if `notes`, `details`, `void_reason` or a full member phone appear.

### M7 · Medium: the audit trail isn't append-only in practice
- **Where:** migration 30 `checkin_events.campus_id … ON DELETE CASCADE`, `device_id`/`user_id … SET NULL`. The id is
  "client event id" (global PK). Plan §3.8. Code: `audit()` stores only `user_id` (null for stations) (`http.js:53-56`).
  The settings audit logs only key names (`setup.js:129`).
- **What could happen:**
  - Deleting a campus erases its whole safety trail.
  - Removing a station or user blanks "who".
  - A client that picks an `event_id` equal to an existing event's id makes its event silently ignored (or it
    suppresses another device's future event).
  - Nothing stops a future route or admin script from updating events.
  - A change to `checkin_restrictions` or `checkin_access` shows as "settings.update: checkin_restrictions" with no
    old or new value.
- **Recommended change to the plan:**
  - Events: campus FK without cascade (and block campus deletion when events exist). Store denormalised `device_name`
    and `user_name`.
  - Event id = server-namespaced (`d<device>:<client id>` or `u<user>:<client id>`). An id that already exists with
    a different payload returns 409.
  - SQLite triggers `BEFORE UPDATE`/`BEFORE DELETE ON checkin_events` that `RAISE(ABORT)`.
  - `audit()` records station id and name when `req.user.station`.
  - Settings audit for `checkin_*` keys records old→new.
  - Restriction audit records the fields changed, but not `details` text (M13).
- **Test:** `UPDATE checkin_events` raises. Two devices with the same client event id produce two events. A third send
  of the same id and payload is a no-op. Different payload returns 409. A station void attempt produces an
  `audit_log`/events row with the device name. A settings change records old and new.

### M8 · Medium: tablet clock decides the day, which can hide a check-in or backdate a release
- **Where:** `checkin.js:63-64` (server derives `day` from the client's `checked_in_at`). Plan §9 bounds only
  check-out `client_at`. One-time contact validity (`starts_on`/`ends_on`) and pickup `day` are proposed to come from
  the tablet. Checkout by code uses the server's "today" (`checkin.js:94`).
- **What could happen:**
  - An iPad with a wrong date (dead battery reset, or a manual change) files Sunday's check-ins under another day.
    They don't appear in today's active list, other stations and Rooms don't see the child, and server code lookup
    fails. A tampered clock can also extend a one-time contact.
  - An offline check-out replayed on Monday fails a "today" lookup.
- **Recommended change to the plan:**
  - Server computes `day` from **server receive time** when the client time is more than 12 h from it (store both and
    flag `clock_skew`).
  - One-time contacts' `ends_on` is set by the server in the campus timezone.
  - Pickup check-out uses the pickup's own `day`, not "today", for replays.
  - Add a skew warning on the tablet header (from the server `Date` header).
- **Test:** upload with `checked_in_at` 3 days ahead: `day` = server day and `clock_skew` event. A one-time contact
  with client `ends_on` next month is stored as today. A Sunday offline checkout replayed Monday is applied.

### M9 · Medium: a lost or stolen tag stays valid
- **Where:** plan §3.3 "Lost tag" (release by override, and "Reprint parent tag (same code)").
- **What could happen:** a parent reports the tag lost and collects one of two children. The found or stolen tag still
  releases the second child (child-by-child release keeps the code live). Reprinting the same code leaves two physical
  copies.
- **Recommended change to the plan:** the lost-tag flow sets `pickup.code_revoked_at`. Remaining children need a
  **reissued** code (new code, new parent tag, child labels reprinted), and the revoked code at check-out shows a red
  "This tag was reported lost" plus coordinator alert. "Reprint same code" only for printer failures within 5 min
  of check-in.
- **Test:** lost-tag release of child 1, then a lookup of the old code shows `revoked`, and a checkout of child 2
  with the old code returns 409 with a notification.

### M10 · Medium: one settings switch silently turns off do-not-release
- **Where:** plan §3.1 (everything behind flags), §6.5 soft rollback, `checkin_restrictions`. Code: `PATCH /settings`
  is admin only, and the audit logs key names only (`setup.js:117-131`).
- **What could happen:** an admin (or a stolen admin session, which lasts 30 days) turns the flag off, or turns it off
  as a "quick fix" on Sunday. Every restriction stops being enforced at every campus, and nobody else is told.
- **Recommended change to the plan:**
  - Once any active restriction exists, enforcement can't be switched off by the setting. The flag only hides
    *management UI*.
  - If a kill switch is truly needed, it needs a typed reason and notifies all admins and coordinators.
  - Banners still show while enforcement is off.
- **Test:** with an active restriction, `PATCH /settings {checkin_restrictions:false}` either returns 400, or succeeds
  while release to the restricted person still returns 409. Notifications are written.

### M11 · Medium: one-time pickup people can be added by whoever stands at the desk
- **Where:** plan §3.5, D12 ("parent at check-in").
- **What could happen:** the desk has no way to know the adult checking in is a custodial parent. A non-custodial
  parent on their weekend is legitimate, but so might be an abuser who brings the child in. They add a one-time
  contact who then collects. The contact's name and phone sit in `household_pickups` for good.
- **Recommended change to the plan:**
  - The adult checking in is picked from the authorised list. For children with any restriction, one-time contacts
    need a coordinator.
  - One-time contacts are scoped to that pickup's child ids, expire server-side (M8), and always need an ID check.
  - Their phone is purged after 90 days (retention, see D15).
- **Test:** a one-time contact for a restricted child from a station returns 403/override. The next day the contact
  isn't authorised. After the retention job, phone = ''.

### M12 · Medium: overrides and pickups need tight binding (IDOR and replay)
- **Where:** plan §3.6, §3.9 (`PATCH /checkin/overrides/:id`, `POST /checkin/checkout {pickup_id}`), integer
  `checkin_overrides.id` (guessable).
- **What could happen:**
  - A coordinator limited to campus 1 approves campus 2's request by id.
  - A station uses an approval made for another station.
  - The approved request is reused with a different `released_to` or extra ids.
  - Two tablets race to use one approval.
- **Recommended change to the plan:**
  - Decide only after `canCampus(override.campus_id)`.
  - An approval binds `(campus, requesting device or user, ids set, released_to_ref/name, kind)`. Checkout must match
    exactly.
  - Mark it used atomically (`UPDATE … SET status='used' WHERE id=? AND status='approved' AND expires_at > now`,
    then check `changes === 1`).
  - `pickup_id` must be at the caller's campus.
- **Test:** a campus-2 coordinator on a campus-1 override gets 403. Station B using A's approval gets 409. Same
  approval with a different adult gets 409. Two concurrent uses: one 200 and one 409.

### M13 · Medium: privacy of restriction and court-order details
- **Where:** plan §3.4 (`details`, `document_on_file`), §3.8 (`audit()` of restriction changes), D16 notifications.
  Code: `notify()` persists title and body in `notifications` (`notify.js:43`).
- **What could happen:**
  - Court-order text ends up in `audit_log.detail` (if the whole body is logged, as `user.update` does at
    `setup.js:207`), in inbox bodies ("Denied: John Smith tried to collect Emma"), in search, or in CSV exports.
  - Free-text `station_note` becomes a place for details that every station caches.
- **Recommended change to the plan:**
  - `details` is never in audit (log "details changed"), notifications, search, exports or the roster.
  - Notification title and body are generic ("A pickup needs your attention at North"). Names appear only on the Live
    page after sign-in.
  - `station_note` max 120 chars with UI guidance ("Who to call, not why").
  - No court-order **uploads** in this plan (paper on file only). Any future upload needs its own guarded store.
  - Update `docs/database.md` sensitive-data as planned.
- **Test:** grep-style test: after creating a restriction with details "XYZSECRET", `audit_log`, `notifications`,
  `/search?q=XYZSECRET`, `/people.csv` and `/checkin/roster` don't contain it.

### L1 · Low: labels give away information
- **Where:** plan §3.4 ("optional small '!' mark"), D10, D11. Code: `checkin.js:463-475`.
- **What could happen:** a "!" on a child's label tells everyone, including the restricted parent in the hallway, that
  the family has a restriction. Child names plus household name on the parent tag help an impostor.
- **Recommended change to the plan:** no "!" mark (decline the option). Parent tag without household name; owner
  decides on children's names (recommend initials). Keep D10.
- **Test:** print preview snapshot for a restricted child has no restriction marker.

### L2 · Low: `min_app` only arrives with the roster; the photo cache needs its own purge
- **Where:** plan §3.10, `sw.js:5-28`.
- **What could happen:** a stale app keeps running up to 10 min after a forced upgrade. A future photo cache (H5)
  outlives unpair.
- **Recommended change to the plan:**
  - Send `x-checkin-min-app` on **every** `/checkin/*` response, and the app reloads when it is higher.
  - Never cache `/api/*` in the SW.
  - Photo cache separate and deleted on unpair, sign-out and day purge.
- **Test:** `sw.test.js`: API requests aren't cached. Unpair clears all `mb-checkin-photos-*` caches.

### L3 · Low: void can hide a child or rewrite a release
- **Where:** plan §3.9 / D8.
- **Recommended change to the plan:** void only open, unreleased check-ins (a released row can't be voided). Voids on
  the service day appear on the Live page and notify the campus's other coordinators.
- **Test:** void of a checked-out row returns 409. Void creates an event plus notification.

### L4 · Low: check-in upload accepts any person
- **Where:** `checkin.js:61` (any `person_id`, archived or not, any campus, adult or child).
- **Recommended change to the plan:** require `archived = 0`. For `kind = 'kid'`, require `household_role = 'child'`
  or flag. Note other-campus children in the event.
- **Test:** upload for an archived person is skipped with an event. Upload of an adult as kid is flagged.

### L5 · Low: tokens and the roster share the hub's origin with no CSP
- **Where:** `index.js` headers (no CSP), `checkin.html`, `localStorage` keys in `checkin.js:7-13`.
- **Recommended change to the plan:** add a strict CSP to `/checkin` (`default-src 'self'`; no inline script; the
  print area uses `innerHTML` of escaped text only). Note that any stored XSS in the hub can read station tokens on an
  iPad that also opens hub pages, so advise in the procedure that station iPads open only `/checkin`.
- **Test:** the `/checkin` response has a `Content-Security-Policy` header.

### L6 · Low: migration and permission plumbing
- **Where:** migration 32 `users.checkin`; `PATCH /users/:id` allowlist (`setup.js:201`); person merge list
  (`people.js:189`).
- **Recommended change to the plan:** add `checkin` to the `PATCH /users` allowlist with validation (`oneOf`), and
  audit (already logs the body). Granting coordinator notifies admins. Merge also moves `checkin_overrides.released_to_ref`
  and `household_pickups.person_id` (plan lists these). The access-mode switch from `leaders` to `explicit` is audited
  with old and new values. Test 22 (byte-identical old rows) is good: keep it.
- **Test:** an admin sets `checkin:'coordinator'` and the audit row is written. An invalid value returns 400. A staff
  member setting it gets 403.

---

## 3. Checked and OK

- **Pickup sessions with "every id must belong to `pickup_id`"** fix F4/F5/F6 correctly (given H2's server-side binding).
- **Per-device prefix** gives offline uniqueness by construction. Collision math in F1 is right. Detecting conflicts
  on sync and never changing a code a parent holds is the right call.
- **Hard block** with no override for the named person (D5). Restriction beats household. `check_first` needs a
  coordinator. Overrides **not available offline** (fail closed): good.
- **Restrictions never deleted** (ended). **Void instead of delete**, with stations 403. **Archive instead of delete**
  for contacts. F11 campus fix included.
- **Additive migrations, no back-fill, old rows untouched.** Test 22 (byte-identical) is the right proof.
- **Station-safe fields only. Nothing on labels. Push text without names.** Medical note on label replaced (D10).
- **Roster minimisation and purge (§3.11)** is right and cheap. Deferring encryption is reasonable (§6.6), given H9's TTL and hours.
- **Old-client analysis is accurate:** `maxlength="4"` and auto-submit at 4 (`checkin.js:389,395`) mean old tablets can't hit 5-char pickups.
- **Event-id idempotency** for offline replays (with M7's namespacing).
- **Existing controls still sound:** station tokens stored as SHA-256 (`stations.js:11,102`), the pairing secret is
  single-use and the pairing is rate-limited, `x-mb` CSRF applies to station calls, parameterized SQL in all reviewed
  routes, `esc()` on label text (`checkin.js:464-475`), and the `html` template on tablet screens.
- **The lost tag needs a coordinator, and a station alone can't release** (add M9's revocation).

---

## 4. Owner decisions I would change

| # | Plan recommendation | My recommendation | Why |
|---|---|---|---|
| D2 | Allow signed-in leader tablets with a lease | Allow **only** for accounts with the check-in flag (`explicit` mode), max 2 leases per user; otherwise online-only with server-issued codes | Lease exhaustion and unaccountable devices (M1, H9) |
| D3 | Deploy `leaders`, then switch to `explicit` | Same, but **`explicit` is a hard precondition for turning on restrictions** (phase 4) | Custody data to every team leader (H7) |
| D4 | Names, photo, station note to stations and helpers | Agree, but not to unflagged leaders. Station note ≤120 chars, "who to call, not why" | H7, M13 |
| D5 | Hard block | Agree, plus **fail closed offline when the safety list is stale**, and ID plus photo for every release of a restricted child | H3, H1 |
| D6 | Coordinator approves from phone or on the tablet | Agree, plus **requester ≠ approver** and no approval for self or own household. Ending a restriction needs a second person or a 24 h delay | H8 |
| D7 | `unrecognised` | Agree, and add **"no photo on file or photo can't load"** and **"added to the household recently or by a station"** to "unrecognised" | H5, H1 |
| D11 | Always print parent tag | Agree. Drop household name; children as initials (owner choice) | H6, L1 |
| D12 | Parent at the desk adds one-time people | Allowed only by an adult picked from the authorised list; **coordinator only for restricted children**; expiry set by the server | M11 |
| D15 | Keep everything indefinitely | Keep events indefinitely, but **purge one-time contacts' phones after 90 days**. Ended restrictions' `details` kept only as long as the church's safeguarding policy says | Data minimisation |
| §3.4 "!" mark | Optional | **Decline** | L1 |
| New | — | **Check-in hours / allowed networks for stations** and a **legacy sunset date** (owner sets) | H9, M4 |

---

## 5. Handoff

```
Summary: Security review of the child-safety plan (draft, nothing built). 0 Critical, 9 High, 13 Medium, 6 Low.
  The plan's core (pickup sessions, per-device prefixes, restrictions, void, append-only events) is sound. Gaps are
  where it trusts attacker-controlled inputs: household membership as authorisation (H1), client-declared pickup
  household (H2), stale offline restriction lists (H3), offline-replay refusals (H4), photos that don't load on
  stations or offline (H5), codes that aren't secret (H6), restriction data in leaders mode (H7), single-coordinator
  powers (H8), permanent station tokens (H9).
Files: plan sections §3.2–3.11, §4 (migration 30/31 FKs), §6.3, §7, §10; code refs server/routes/{checkin,stations,people,setup}.js,
  server/index.js:100, server/http.js:53, public/js/checkin.js, public/sw.js
Decisions needed: D2, D3 (explicit before phase 4), D5–D7, D11, D12, D15, "!" mark, station hours, legacy sunset
Next: chief-architect folds H1–H9 and M1–M13 into the plan, then owner decisions; senior-developer builds, qa-engineer
  adds the listed tests; security-specialist re-reviews phases 1–5 as planned
Evidence: read-only review of the files listed; no commands run against data; no repo files modified
```
