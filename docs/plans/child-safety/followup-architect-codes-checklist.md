# Child-safety plan: answers to Q1 (pickup code uniqueness) and Q6 (final approval checklist)

Chief Architect · 2026-11-25 · Planning only. Read: `origin/claude/child-safety-plan:docs/plans/child-safety/plan.md`
(§3.2, §3.3, §3.9, §4.6, §8), `review-qa.md` (P1.04–P1.09, P1.15), `review-operations.md` (§2.7), current
`public/js/checkin-rules.js` (`securityCode`), `public/js/checkin.js:294-296, 400-403`, `server/routes/checkin.js:47-110`,
`server/routes/stations.js`. No repository file changed.

Notation: alphabet A = 27 characters (`346789ABCDEFGHJKMNPQRTUVWXY`: 6 digits, 21 letters).
4 random characters give 27⁴ = 531,441 suffixes. 6 random characters give 27⁶ = 387,420,489.
For two issuers that issue nA and nB codes from the same space S with no knowledge of each other:
P(clash) = 1 − exp(−nA·nB / S). For one issuer that does not check its own list (today's app):
P = 1 − exp(−n² / 2S).

---

## Q1. Pickup code uniqueness

### 1.1 Short answer
- **Yes, two offline fallback devices can issue the same active code.** The plan's sentence "codes cannot clash
  offline" is only true for leased single-letter prefixes held by exactly one live copy of the app's storage. It is
  false for the random 2-letter fallback, and for several other paths listed below.
- **5-character leased and 6-character fallback codes can never be equal as strings**, because their lengths differ
  and normalisation only strips spaces, hyphens and case. **But the plan's typing rule breaks this.** The input
  "auto-submits at 5 characters (6 for fallback)". The tablet cannot know a code is a fallback code from its first
  characters, because fallback prefixes are random over all 27 characters. So typing `KM7Q3M` fires a lookup for
  `KM7Q3` at the fifth keystroke, and that is a valid leased code under prefix `K`. This path can show another
  family. (§1.3, row 10.)
- **An absolute guarantee of unique codes is not possible for codes made offline in a browser.** Browser storage can
  be copied (iPad restore from backup, Safari data sync, a cloned image), and nothing ties it to the hardware. An
  absolute guarantee exists only for codes the server confirms in a transaction before the label prints (online), or
  for codes from a physically unique numbered paper pad. Both are part of the recommendation below.
- **What can be absolute is release safety.** A clash must never be able to release the wrong child. That holds only
  if check-out never relies on the code alone (§1.6).

### 1.2 Plan as written: two offline fallback devices
- Each fallback device draws a random 2-character prefix (1 in 729 chance that two devices draw the same one). Given
  the same prefix, each device checks only its own issued list. So the two devices clash with probability
  1 − exp(−n²/531,441).
- The combined probability for 2 devices issuing n codes each is ≈ n² / 27⁶. If the prefix is redrawn for every
  code instead of once per device, the result is the same.

| Fallback devices offline at a campus that day | Codes each | P(at least one active clash) |
|---|---|---|
| 2 | 50 | 6.5 × 10⁻⁶ |
| 2 | 150 | 5.8 × 10⁻⁵ (about 1 in 17,000) |
| 2 | 300 | 2.3 × 10⁻⁴ |
| 3 | 150 | 1.7 × 10⁻⁴ |
| 4 (Easter, Wi-Fi down, new iPads) | 200 | 6.2 × 10⁻⁴ (about 1 in 1,600) |
| 6 | 250 | 2.4 × 10⁻³ |

- If 2 fallback devices were used every Sunday at both campuses (104 device-days a year, 150 codes each), the chance
  of at least one clash in a year is about 0.6%.
- "Negligible" is fair for this row on its own. It is not the largest risk (see the next table).

### 1.3 Every path to an active-code clash or an ambiguous check-out under the plan
"Same lease, two issuers" means P = 1 − exp(−nA·nB/531,441): **0.47% at 50/50, 4.1% at 150/150 and 15.6% at
300/300** for each incident.

| # | Path | Can it clash? | Remaining probability under the plan | Detected by |
|---|---|---|---|---|
| 1 | Two leased devices, distinct prefixes, storage intact | No | 0 (deterministic) | — |
| 2 | Two unleased fallback devices offline | Yes | ≈ n²/27⁶ (table §1.2) | Sync backstop, after the fact |
| 3 | Fallback device vs leased device | Not as stored strings (lengths 6 ≠ 5) | 0 exact | — |
| 4 | **Cloned or restored iPad** (backup restore, migration to a new iPad, Safari data restored), both copies offline | Yes: the same prefix and the same `device_key` or station token, with separate issued lists | 4.1% at 150/150, for each day both copies issue | Only by a code clash on sync. The plan has no clone detection. |
| 5 | Two tabs or windows on one iPad (home-screen app plus Safari) | Yes, if a tab works from an in-memory copy of the issued list. localStorage has no cross-tab lock. | Like row 4, for the codes each tab issued from a stale copy | Clash on sync |
| 6 | Storage cleared or evicted mid-service, offline | The lease is lost with it, so the device becomes "no lease" and moves to row 2. If only the issued-list key is lost or fails to write (quota; `store.set` swallows the error and toasts), the device keeps its prefix and forgets earlier codes. | Self-clash n₁·n₂/531,441 (before and after the loss) | Clash on sync |
| 7 | Same helper account on several devices | Each `device_key` gets its own prefix, so no clash. The third device hits the cap and falls back to row 2. | Row 2 | Sync |
| 8 | Lease revoked or device re-paired the same day | No: the plan never reclaims a prefix the same day | 0 | — |
| 9 | Prefix reclaimed after 30 idle days while the old holder is still alive and offline (stored in a drawer, comes back with its old lease) | Yes: two holders of one prefix | Row 4 formula, rare | Prefix-to-lease check on sync |
| 10 | **Auto-submit at 5 characters on a 6-character fallback code** (typing hazard, not a stored clash) | Ambiguous check-out: shows the leased family whose code equals the first 5 characters | For each fallback check-out: (leased prefixes ÷ 27) × (open codes under that prefix ÷ 531,441). With 4 leased iPads at 150 each and 150 fallback check-outs, ≈ **0.6% for each Sunday with a fallback iPad** | Not detected. Only the human checks at release stop it. |
| 11 | Day boundary: yesterday's still-open pickups (lookups search the last 8 h of yesterday) vs today's codes from the same prefix. The issued list is per day, so it does not check yesterday's codes. | Yes (watch-night, overnight lock-in, events across midnight) | nY·nT/531,441 for each prefix, e.g. 40·40 → 0.3% | Only if the server compares across days (it does not) |
| 12 | Device clock or date wrong or changed mid-service | The issued list key changes with the day, so codes repeat | n₁·n₂/531,441 | Skew flag only |
| 13 | Legacy 4-character codes during the soak (one legacy iPad per campus). The old app never checks its own list (`checkin.js:296`). | Yes, legacy against legacy | 1 − exp(−n²/1,062,882): 0.24% at 50, 2.1% at 150, 8.1% at 300 | Legacy ambiguity guard (409, list families) |
| 14 | Server-invented codes: `server/routes/checkin.js:71` fills a missing code with a random 4-character `securityCode()` without checking | Yes, against legacy codes | ≈ open legacy codes ÷ 531,441 for each such record | Not detected |
| 15 | Legacy 4 vs new 5 or 6 characters | Not equal as strings. Typing the first 4 characters of a new code and pressing Find matches a legacy code (QA P1.15). | ≈ open legacy codes ÷ 531,441 for each such typo | Human checks |
| 16 | One-character typo that lands on another open code under the same prefix | Ambiguous check-out | ≈ (open codes under that prefix ÷ 531,441) for each typo, about 0.03% at 150 | Human checks |
| 17 | Offline lookup of a clashing code whose twin was issued on another, unsynced iPad | **Worst case.** The lookup returns one family, the wrong one, and looks unambiguous. | Rows 2, 4, 5, 6 and 9 feed it | Only the human checks at release |

**The biggest risks are rows 4, 5, 10 and 17, not row 2.** Rows 4 and 5 are cloned storage and stale tabs (4% at
normal volume when they happen). Row 10 is the auto-submit truncation. Row 17 is the offline lookup that looks
unambiguous.

### 1.4 Is an absolute guarantee possible?
- **Online issuance (the server confirms the code in a write transaction before printing):** absolute. SQLite writes
  run one at a time, so the server can check `(campus, day or yesterday-open, code)` and insert in one transaction.
- **Offline issuance from a leased prefix:** unique if, and only if, exactly one copy of the issuing state exists and
  that state is intact. A web app cannot prove either. Storage can be cloned or restored, and there is no hardware-bound
  key in Safari. So offline codes can be made **unique except for cloned or partly lost state**, and those cases can
  be **detected** at the first online contact. They cannot be prevented absolutely.
- **Paper fallback:** absolute if each desk's pad is pre-numbered with a desk letter that no other pad uses.
- **Conclusion:** "never clash" can be promised only as "never clashes unless an iPad's storage was copied or
  corrupted, and any clash is caught at check-out". The owner and the family-facing text should use that wording.
  Child safety must rest on §1.6, not on uniqueness.

### 1.5 Options weighed
| Option | Verdict |
|---|---|
| Lease 2-character prefixes from the server when single letters run out (so every code is leased) | **Adopt.** No random prefixes, ever. |
| A device may check in offline only after it has held a lease online at least once; pre-provision the lease at pairing or sign-in | **Adopt.** Pairing and sign-in already need the network, so the lease comes with them at no extra step. |
| Each device gets a reserved backup prefix | **Adopt, narrowly.** Used only when the device detects that its own issued state is unreliable (write failure, unreadable list, the queue has today's records but the issued list is missing). It is not a fix for clones, because a clone copies the backup too. |
| No lease → paper fallback kit instead of random codes | **Adopt** for the no-lease *and* offline case. Online, a device without a lease gets one on the spot, or server-issued codes. |
| Per-device monotonic counter instead of random suffixes | **Do not adopt as the main scheme.** A counter guarantees no repeats for one intact copy, but the random suffix plus the issued list already does that. A counter turns clone and restore cases from a 4% clash into a **certain** clash, because both copies issue `K0001`, `K0002`… Counter codes, even put through a per-lease permutation, still collide in step on clones. Keep random suffixes checked against the device's issued list. |
| Check character in the code | Not now. 5 characters is already at the limit of what Operations will accept (review-operations §2.4), and 3 random characters plus a check character makes clone clashes much likelier (68% at 150/150). Typo safety comes from §1.6. |
| Server confirms every online check-in before printing | **Adopt** (1.5 s timeout, then the device-issued code). This makes online codes absolutely unique and catches clones the moment either copy is online. |

### 1.6 Check-out must not depend on code uniqueness (rules for §3.3)
1. **A code only selects candidates.** Every lookup (online or offline, today plus yesterday's open pickups, legacy
   rows, pickups flagged `conflict`/`unleased`/`code_unknown`) returns **all** matching open pickups.
2. **More than one match → always the careful lane**, never pre-ticked, never "release all":
   - Banner: "This code matches 2 families."
   - Both families shown side by side, children **unticked**.
   - "Who's collecting?" is answered first, and the adult must be identified as belonging to exactly one of the
     families (photo match plus ID check).
   - The adult **names the children before they are shown to them**. The screen faces the volunteer.
   - Tick child by child, and check the child's label initials against the parent tag initials.
   - Coordinator approval, override kind `conflict` (PIN offline, phone online).
   - The pickup is flagged and the event recorded.
   - The tablet never decides between the families.
3. **One match is not proof.** A fast-lane release still needs the adult to be a household adult or contact **of that
   pickup** (photo match), or the Tier B tag-holder path (names the child, ID). An impostor holding a clashing tag from
   another family matches no tile. So row 17 ends in Tier B or Tier C, not a release.
4. **Server check on every release** (requests and reports): `released_to_ref` must be an adult or contact of the
   pickup's household for that pickup's children, or the release kind must be `tag_holder` with `id_checked = 1` and a
   recorded name, or an override. A report that breaks this is recorded as a `release_violation` with an urgent
   alert, as for restrictions.
5. **Codes with an uncertain prefix go to the careful lane** (pickups flagged `conflict`, `lease_cloned` or
   `code_unknown`).
6. The parent tag and child labels carry the **children's initials and the check-in time (HH:MM)**. This gives a
   second visible link between tag and child that does not come from the code.
7. **Auto-submit only when the length is certain** (first character decides; §1.7). Otherwise wait for Enter or Find.

### 1.7 Recommended replacement text for plan §3.2
> ### 3.2 Pickup codes
> - **Format and namespace (the first character decides the length):**
>   - **Letter prefix** (21 letters) + 4 random characters = **5 characters**, `K 7Q3M`.
>   - **Digit-led 2-character prefix** (6 digits × 27 = 162 prefixes) + 4 random characters = **6 characters**,
>     `7K 3Q4M`. Used when a campus has more than 21 leased devices, and for backup prefixes.
>   - Legacy 4-character codes are accepted only from Find (never auto-submitted) while legacy rows exist.
>   - The input auto-submits at 5 characters when the first character is a letter, and at 6 when it is a digit.
>     Characters outside the alphabet are rejected with a hint, never silently mapped.
> - **Every code comes from a server lease. No code is ever made from a random prefix.**
>   - Each campus has 183 leasable prefixes (21 letters, then 162 digit-led pairs).
>   - A lease is granted **as part of pairing** (stations) and **as part of check-in sign-in** (helper+ accounts,
>     max 2 devices per user). It is not a separate step that can be missed.
>   - Each lease includes a **primary prefix**, a **backup prefix** (digit-led), `valid_until` (today + 14 days, renewed
>     on every online contact) and a `lease_epoch`.
>   - A device never issues a code from an expired lease.
>   - The server reassigns a prefix only when the lease was released, or `valid_until` passed more than 7 days ago,
>     **and** no pickup with that prefix exists at the campus today or yesterday. The prefix is never reassigned on a day
>     it was used.
> - **Online check-in:** the tablet sends the pickup before printing. The server checks the code against open pickups
>   (campus, today, and yesterday's open) and inserts it in one transaction.
>   - If the code is taken, the server returns `409 code_taken`, the tablet draws again and nothing has been printed.
>   - If the server gives no answer within 1.5 s, the tablet prints its own lease code and uploads later.
>   - A device online without a lease (cap reached, all prefixes used) gets **server-issued codes** from the campus's
>     reserved server prefix (`99`), checked in the same transaction. It cannot check in offline.
> - **Offline check-in:**
>   - Allowed only with a valid lease the device got online.
>   - The suffix is random (crypto) and checked against the device's issued codes for **today and yesterday**, for both
>     prefixes, whatever the device clock says.
>   - The code, the issued list and the queue entry are written in **one** storage write before the label prints. If
>     the write fails, nothing prints and the tablet shows "Use the paper kit".
>   - If the device finds its issued state unreliable (unreadable list, or queue records for today with no issued list),
>     it switches to its **backup prefix** for the rest of the day and flags `backup_prefix` on sync.
>   - **No lease and offline:** the tablet shows "This iPad can't check in until it has been online. Use another iPad
>     or the paper kit." The paper kit's pads are pre-numbered with the desk letter, so paper numbers never repeat.
> - **One issuer per device:** check-in takes an exclusive Web Lock (`navigator.locks`, `mb-checkin-issuer`). Where
>   Web Locks is missing, a BroadcastChannel and localStorage heartbeat is used instead. A second tab or window opens
>   Rooms and check-out only, and says "Check-in is open in another window".
> - **Clone detection:** `lease_epoch` increases on every online contact, and the device stores the new value.
>   - A request that carries an older epoch after a newer one has been used means the device's storage was copied.
>   - Result: a `lease_cloned` event and an urgent coordinator alert.
>   - Both copies are moved to new prefixes.
>   - That prefix's open pickups for today and yesterday are flagged `conflict` (careful lane).
>   - The station token rotation (§3.8) gives the same signal for paired stations.
> - **Server backstop on sync** (unchanged in spirit):
>   - Conditions: the prefix is not leased to the uploader, the epoch is stale, or `(campus, code)` equals another
>     open pickup today or yesterday.
>   - Result: both pickups get `conflict = 1`, a `code_conflict` event and one de-duplicated alert.
>   - The server **never changes a code a parent holds**. A coordinator may reissue.
> - **The server never invents a code.** A legacy upload with no code becomes a `code_unknown` placeholder
>   (coordinator release), replacing the random `securityCode()` fallback in `POST /checkin/checkins`.
> - **Release safety never depends on uniqueness** (§3.3):
>   - Any lookup returning more than one open pickup goes to the careful lane: all families shown, children unticked,
>     the adult identified and naming the children, ID check, coordinator approval (`conflict`).
>   - The server refuses or flags any release to an adult who is not linked to that pickup, unless it is a recorded
>     tag-holder release with ID or an approved override.
> - **Plain-language promise:** "Each iPad has its own letters, so codes don't repeat. If an iPad's memory was copied
>   or damaged and a code ever repeats, the desk sees both families and checks ID before anyone leaves."

Data-model delta to m31 (additive):
- `checkin_code_leases` + `kind TEXT DEFAULT 'primary'` (`primary|backup|server`), `valid_until TEXT`,
  `lease_epoch INTEGER DEFAULT 0`.
- `checkin_pickups.flags` gains `backup_prefix`, `lease_cloned`, `server_issued`.
- Server uniqueness check: a non-unique index on `(campus_id, code, day)` exists already. Use the transaction check,
  not a UNIQUE index, because offline reports must always be accepted.

### 1.8 Tests that prove it (add to §5.1 "Pickup codes", all **M** unless noted)
| ID | Type | Test |
|---|---|---|
| N-Q1.01 | RULES | Property, 100k draws with seeded random: `codeLength(code[0])` equals `code.length` for every generated code. No 5-character code is a prefix of any 6-character code. Letters → 5, digits → 6. |
| N-Q1.02 | RULES | `pickupCode(lease, issued, random)` throws `NO_LEASE` with no lease or an expired `valid_until`. It never returns a code in `issued` for today or yesterday, including when the device clock moves the day key. |
| N-Q1.03 | API | Lease allocation: letters first, then digit-led. The 22nd device gets a 6-character prefix. Exhaustion of 183 gives online-only `server` mode (no random). 20 parallel lease calls give distinct prefixes and no 500. Reassignment refused while `valid_until` + 7 days has not passed or a pickup with the prefix exists today or yesterday (injected clock). |
| N-Q1.04 | API | Online reserve: POST a pickup whose code equals an open pickup (today, and yesterday-open) → `409 code_taken`, nothing stored. The same record sent later as an offline **report** → stored with `conflict = 1`, one alert. |
| N-Q1.05 | API | Clone: requests with epoch 5, then 6, then 5 → `lease_cloned` event, one alert, both instances get new prefixes, that prefix's open pickups flagged `conflict`, and lane = careful. |
| N-Q1.06 | BR | Fresh or wiped iPad offline: check-in shows the paper-kit message, no code is generated, the queue is unchanged. Pairing (online) returns a lease, so the next offline boot can check in. |
| N-Q1.07 | BR | Two tabs: the second tab cannot check in. Closing the first tab hands over the lock. |
| N-Q1.08 | BR | Storage quota injected to fail on write → no label printed, a visible error, the issued list and queue are consistent. An unreadable issued list → backup prefix used, flagged on sync. |
| N-Q1.09 | BR | Auto-submit: `K7Q3M` submits at 5 characters. `7K3Q4M` waits until 6. A legacy 4-character code is only looked up by Find. |
| N-Q1.10 | API + BR | Forced clash (two pickups with the same code via direct DB, plus a forced clone offline): every path (code request, ids, report, legacy `security_code`) leads to the careful lane, children unticked, `conflict` override needed. A release to an adult from the other household is refused (request) or a `release_violation` with alert (report). |
| N-Q1.11 | API | `POST /checkin/checkins` with an empty `security_code` creates a `code_unknown` placeholder. The server never generates a code (grep test: no `securityCode()` call in `server/`). |
| N-Q1.12 | RULES | Simulation (replaces the P1.05 claim): 6 leased devices, 300 codes each, offline, 1,000 seeded runs → 0 clashes. The same with 2 cloned copies → the clash rate matches 1 − exp(−n²/531,441) ± 3σ, and **every** clash is detected on sync. |
| N-Q1.13 | API (S) | Midnight: an open pickup at 23:30 and a same-prefix check-in at 00:30 never share a code (yesterday is included). |

Update existing tests:
- **P1.06:** "no lease → 6-character code" becomes "no lease → paper kit message".
- **P1.07:** the 28th device becomes "the 22nd device gets a 2-character leased prefix; exhaustion gives server mode".
- **§5.6 soak:** the `unleased` count becomes `backup_prefix` / `lease_cloned` / `server_issued` counts, each with a
  target of 0 except `server_issued`.

---

## Q6. Final approval checklist

Mark each box when the owner decides. "Pending" = another agent's evaluation is outstanding. Rec. = the plan's
recommendation. Where = section of `docs/plans/child-safety/plan.md`.

### A. Operational policy decisions (the church owns these)
- [ ] **A1 · Code design (Q1, pending owner):** Rec. (this note): leased-only prefixes, letter = 5 / digit-led = 6
  characters, online reserve, no lease and offline → paper kit; replaces the random fallback. Where: §3.2, D1.
- [ ] **A2 · Who may check in from an unpaired device (D2):** Rec. helper+ with a lease (max 2 devices), and pair
  every desk. Where: §3.2, §8.1.
- [ ] **A3 · Check-in permission model (D3):** Rec. helper and coordinator levels, then switch to explicit mode
  before pickup alerts. Where: §3.7.
- [ ] **A4 · Who the first coordinators and helpers are, per campus:** Rec. named list from each campus, granted by an
  admin before the switch to explicit mode. Where: §3.7, §7 P3.
- [ ] **A5 · Two pickup lanes (D4):** Rec. fast and careful lanes, chosen by data. Where: §3.3.
- [ ] **A6 · Non-household adult holding the tag (D5, Q2 pending):** Rec. helper with ID check and the adult naming the
  child, coordinator told afterwards. Where: §3.3 Tier B.
- [ ] **A7 · Lost tag (D6):** Rec. tiered: household adult on file + photo or ID → helper; otherwise coordinator; the
  code is revoked. Where: §3.3.
- [ ] **A8 · Do-not-release (D7):** Rec. hard block for the named person with no override; others in the careful lane
  need a coordinator. Where: §3.3, §3.4.
- [ ] **A9 · Coordinator approval methods (D8, Q5 offline PINs pending):** Rec. phone plus a personal PIN on the iPad
  that works offline. Where: §3.6.
- [ ] **A10 · Approvers and runner per service:** Rec. two named approvers and one safety runner per campus per
  service. Where: §6.1.
- [ ] **A11 · Offline safety-list limit (D9):** Rec. 180 minutes and the same day; after that a PIN is required.
  Where: §3.9.
- [ ] **A12 · ID check policy:** Rec. `unrecognised`; the careful lane always requires ID. Where: §3.5.
- [ ] **A13 · "Not yet known" window for newly added household adults:** Rec. 14 days, staff-set only. Where: §3.5.
- [ ] **A14 · "ID seen" memory:** Rec. valid for 12 months. Where: §3.5.
- [ ] **A15 · Parent tag content (D10):** Rec. code, date, children's initials (plus check-in time per Q1), no
  household name, always printed. Where: §3.12.
- [ ] **A16 · Phone numbers on iPads (D11):** Rec. last 4 digits for search; keep the household main phone. Where:
  §3.11.
- [ ] **A17 · Medical notes (D12, Q3 pending):** Rec. allergy strip on the label, "MEDICAL: see room list", full notes on
  Rooms for helpers, per-child print of the full note. Where: §3.12.
- [ ] **A18 · Check-in hours per campus (D13):** Rec. hours plus "Open check-in now"; the allowed-networks list
  optional and off. Owner supplies the hours. Where: §3.8.
- [ ] **A19 · Roster scope (D14):** Rec. this campus + any household with a check-in in the last 12 months +
  online search of all campuses. Where: §3.11.
- [ ] **A20 · Ending a restriction (D15):** Rec. a second coordinator or an admin confirms; creating takes effect at
  once. Where: §3.4.
- [ ] **A21 · Restriction intake procedure:** Rec. who may request (custodial parent, court order), paper copy kept
  for court orders, two trained staff per campus, weekly review of expiring alerts, incident note. Where: §6.9.
- [ ] **A22 · Escalation script for a hard block:** Rec. don't argue, keep the child, Alert button, 911 if threatened,
  pastor told. Where: §3.3, §6.3.
- [ ] **A23 · Deploy windows, soak and legacy sunset (D16):** Rec. weekday mornings with no programme, two-Sunday soak
  with one legacy iPad per campus, sunset 14 days. Owner names the midweek programme times and the legacy iPads.
  Where: §4.7.
- [ ] **A24 · Advent and Christmas deploy freeze:** Rec. avoid deploys in Christmas week. Where: §7.
- [ ] **A25 · Retention policy (D17, Q4 pending):** Rec. keep events and check-ins indefinitely, purge one-time
  contacts' phones after 90 days, review with the pastor and insurer. Where: §4.4, §8.1.
- [ ] **A26 · Undo release (D18):** Rec. coordinator within 30 minutes, with a reason. Where: §3.3.
- [ ] **A27 · Offline quick-add for first-time families, P7 (D19):** Rec. include after P2, before Easter. Where: §7.
- [ ] **A28 · Roadmap deferrals (D20):** Rec. defer the listed items. Where: §8.1.
- [ ] **A29 · Training, desk card, signage and family communication:** Rec. 10-minute onboarding, huddle, shadowing,
  announcement two weeks before. Where: §6.2–6.5.
- [ ] **A30 · Paper fallback kit and daily pickup-alerts sheet:** Rec. pre-numbered pads with the desk letter (Q1),
  reconciled on Monday by a named person; the sheet is printed each morning and shredded after. Where: §6.6–6.7.
- [ ] **A31 · Supplies cost:** Rec. accept roughly double the label stock (parent tag always printed). Where: §6.10.

### B. Technical approvals required by project rules (CLAUDE.md rules 1, 6, 7)
- [ ] **B1 · Migration m30** (`checkin_events` + append-only triggers, new columns on `checkins`, `checkin_devices`,
  `people`): Rec. approve (additive). Where: §4.3, rule 1.
- [ ] **B2 · Migration m31** (leases, `checkin_pickups`, `checkins.pickup_id/duplicate_of`; **Q1 delta pending**:
  `kind`, `valid_until`, `lease_epoch`): Rec. approve with the Q1 delta. Where: §4.3, this note §1.7.
- [ ] **B3 · Migration m32** (`users.checkin`, PIN hash columns): Rec. approve. Where: §4.3.
- [ ] **B4 · Migration m33** (`pickup_restrictions`, `checkin_overrides`, extended `household_pickups`, verification
  columns): Rec. approve. Where: §4.3.
- [ ] **B5 · Migration m34** (`people.label_medical`): Rec. approve. Where: §4.3.
- [ ] **B6 · Backup and rehearsal:** Rec. the owner restores a backup to a scratch instance, and a backup is taken
  before each deploy (rule 7). Where: §5.5, §8.2.
- [ ] **B7 · Person merge also moves the new references** (data-changing code path): Rec. approve. Where: §4.3.
- [ ] **B8 · New roles (`users.checkin` helper and coordinator); only admins grant coordinator:** Rec. approve. Where:
  §3.7, rule 7.
- [ ] **B9 · `checkin_access` switch to explicit mode** (auto-leaders lose check-in): Rec. approve, flipped on a Monday
  after granting. Where: §3.7, §4.8.
- [ ] **B10 · Station rights:** exact `[method, path]` allow-list, stations first in `requireCheckin`, today-only:
  Rec. approve. Where: §3.8.
- [ ] **B11 · New credential: coordinator PINs** (scrypt, 6 digits, 90-day rotation; offline hashes on paired iPads,
  Q5 pending): Rec. approve after the Security re-review. Where: §3.6, §8.2.
- [ ] **B12 · Station token rotation and revoke-not-delete:** Rec. approve. Where: §3.8.
- [ ] **B13 · Check-in hours enforcement** (and optional allowed networks): Rec. approve, networks off. Where: §3.8.
- [ ] **B14 · Enforcement never behind a flag, plus the emergency kill switch** (admin only, typed reason, 24 h
  expiry): Rec. approve. Where: §4.8.
- [ ] **B15 · Rate-limiter factory** (stations get a progressive delay by device; users get 429): Rec. approve.
  Where: §3.10.
- [ ] **B16 · Content Security Policy on `/checkin`:** Rec. approve. Where: §3.12.
- [ ] **B17 · New station photo endpoint** (scoped to today's pickups or roster, private cache): Rec. approve. Where:
  §3.5.
- [ ] **B18 · New sensitive data category: custody restrictions** (`details` coordinator and admin only, canary
  tests): Rec. approve. Where: §3.4.
- [ ] **B19 · Unmutable `checkin_alert` notification kind:** Rec. approve. Where: §3.10.
- [ ] **B20 · Device data minimisation and purges** (roster TTL, day and photo purges, adults' medical data removed;
  encryption at rest deferred as an accepted risk): Rec. approve. Where: §3.11.
- [ ] **B21 · Deletion job: one-time contact phone purge after 90 days** (D17, Q4 pending): Rec. approve separately
  (destructive, new data only). Where: §4.4, §8.2.
- [ ] **B22 · Q1 security changes** (online reserve before print, Web Lock single issuer, clone detection, removing
  server-invented codes, careful lane for multiple matches): Rec. approve. Where: this note §1.6–1.7.
- [ ] **B23 · Accepted residual risks recorded in `docs/tech-debt.md`:** `checkins.person_id ON DELETE CASCADE`,
  offline PIN brute force on a stolen iPad, offline clone clash (Q1 §1.3 row 4). Rec. accept. Where: §4.4, §8.2.
- [ ] **B24 · Outbox v2 and service worker v4** (compatibility contract with old iPads, legacy sunset 409): Rec.
  approve. Where: §4.5–4.6.
- [ ] **B25 · Feature flags and the order they are enabled** (`checkin_pickups` → soak → sunset → explicit →
  restrictions); each enabling is an owner act. Rec. approve the order. Where: §4.8, §7.
- [ ] **B26 · Dependencies and costs:** none. No new npm packages, no paid services, no SMS; push and inbox are
  existing. Rec. confirm (rule 6). Where: §8.2.
- [ ] **B27 · Security Specialist sign-off on P1, P3 and P4** (plus a half-day review per phase and the PIN
  re-review), and the release checklist on P2–P5. The owner merges each PR. Rec. approve. Where: §7, §8.2.

Counts: **A = 31 items, B = 27 items** (58 in total). Five of them wait for the Q1–Q5 outcomes: A1, A6, A9/B11, A17,
A25/B21 (plus the B2 delta and B22 from Q1).
