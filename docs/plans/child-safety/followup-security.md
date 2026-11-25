# Child-safety plan: security answers to Q5, Q2, Q3, Q4

Security Specialist · 2026-11-25 · read-only. No repository file was changed.

**Sources read:**
- `origin/claude/child-safety-plan:docs/plans/child-safety/plan.md`: §1, §3.1–3.12, §4, §8
- `review-security.md`: H3, H8, H9
- `review-operations.md`: D6, D10 and D15 rows
- Current code:
  - `public/js/checkin.js`: the `store` in localStorage, the `KEY` map, the label printing
  - `public/sw.js`
  - `server/routes/checkin.js`
  - `server/routes/stations.js`
  - `server/auth.js:163-176`: password scrypt, N=16384, r=8, p=1, a 16-byte salt and a 32-byte key
  - `server/db.js`: the schema for `rooms`, `positions`, `assignments` and `checkins`

**Severity scale:** Critical, High, Medium and Low, as `docs/security.md` uses them. Each rating is for the plan as
written, if it were built that way.

---

## Q5 (primary). Offline coordinator PINs

### What the plan stores today (§3.6, §3.11, m32)

| Item | Plan as written |
|---|---|
| Secret | A 6-digit personal PIN. The coordinator chooses it in the hub, and it rotates every 90 days. |
| Server | `users.checkin_pin_hash`, plus `checkin_pin_set_at`. |
| On the iPad | A scrypt hash per coordinator, inside the station roster. Only paired stations at that campus receive it, and only in `explicit` mode. |
| Storage on the iPad | The roster is saved in `localStorage` (`mb.checkin.roster.<campus>`, `checkin.js:10,24-25`) and kept for up to 7 days. |
| KDF parameters | Not specified. The assumption is that it copies `auth.js`: scrypt N=2^14, r=8, p=1, a 16-byte salt and 32 bytes of output. |
| Online use | `POST /checkin/pin-verify` checks the same PIN on the server, with a rate limit. |
| Offline use | The tablet checks the hash. After 5 wrong tries, the whole tablet locks for 15 minutes. |
| Scope stated in §8.2 | "Brute force on a stolen iPad, limited to offline approvals on that iPad." |

A side note on implementation: WebCrypto has no scrypt. Under the "no new dependencies" rule, the tablet would need a
hand-written or vendored scrypt in JavaScript. The native alternative is PBKDF2-SHA256 through WebCrypto. The
recommended design below does not depend on the KDF being strong, so either is fine. **Use native PBKDF2-SHA256 with
about 300,000 iterations**, and don't hand-roll scrypt.

### Offline brute-force feasibility (estimates, worst case = the full keyspace; the average is half)

**Assumptions:**
- scrypt N=2^14, r=8, p=1 (16 MiB per guess).
- One current high-end GPU does roughly 5,000–8,000 guesses per second (hashcat mode 8900, order of magnitude); 6,000
  is used below.
- A laptop CPU with 8 cores does roughly 150 per second.
- On the iPad itself, one check takes about 0.3–1.5 s in JavaScript. That is why N can't go much higher: N=2^16 would
  take about 1–6 s and 64 MiB per try in Safari.
- PBKDF2-SHA256 at 300,000–600,000 iterations lands in the same range on a GPU.

| Secret | Keyspace | 1 GPU | Laptop CPU | Rented 8-GPU box |
|---|---|---|---|---|
| 4 digits | 10^4 | ~2 s | ~1 min | instant |
| **6 digits (plan)** | 10^6 | **~3 min** | **~2 h** | ~20 s |
| 8 digits | 10^8 | ~4.6 h | ~8 days | ~35 min |
| 10 digits | 10^10 | ~19 days | ~2 years | ~2.4 days |
| 6 letters and digits (36^6) | 2.2·10^9 | ~4 days | ~5.5 months | ~12 h |
| 8 letters and digits | 2.8·10^12 | ~15 years | centuries | ~2 years |

People choose PINs from a small set: years, birthdays, `123456`, a phone's last digits. A dictionary-first attack
usually cracks a chosen 6-digit PIN in seconds.

**Conclusion:** any secret short enough to type at a busy desk can be cracked from the iPad's copy. Make the cracked
value worthless outside a small scope and a short time; a stronger KDF won't fix this.

### Risks

**Q5-1 · High · A 6-digit PIN hash on the iPad is effectively the PIN itself to anyone who copies the iPad's storage.**
- Who could copy it:
  - Someone holding the unlocked iPad, with a Mac and Safari Web Inspector. This works only if Web Inspector is
    turned on in the iPad's Safari settings, which a person who can reach Settings can do.
  - A device backup. Safari website data may be included in iCloud or Finder backups.
  - Script running on the same origin (below).
  - A stolen iPad whose passcode is known or blank.
- What they get: the PIN of every coordinator at that campus within minutes to hours. The copy lasts up to 7 days,
  because the hashes sit inside the 7-day roster.

**Q5-2 · High · The cracked PIN is not limited to "offline approvals on that iPad". §8.2 understates the risk.**
- The same PIN is accepted online by `POST /checkin/pin-verify` at any paired station, and within the online rate
  limit.
- It stays valid for up to 90 days, so a cracked PIN approves online overrides at that campus until it is rotated:
  `check_first`, `court_order` (anyone other than the named person), `lost_tag_c`, conflict, mismatch, `id_mismatch`.
- If the coordinator works at more than one campus and the server checks PINs church-wide, it works at those campuses
  too.
- **PIN reuse:** a chosen PIN is often also a phone passcode, a bank card PIN or an alarm code. Cracking it can hurt
  the coordinator personally, outside the hub.
- What a cracked PIN cannot do:
  - sign in to the hub (§3.6)
  - override do-not-release (a hard block with no override)
  - read restriction details
  - change any data except through override approvals

**Q5-3 · Medium · Offline, the two-person rule can't be enforced.**
- A paired station has `user.id = null`. The only "requester" offline is a typed operator name.
- So a coordinator working the desk can approve their own request, and so can an insider who has cracked a PIN.
  The tablet can't tell either case from a real second person.

**Q5-4 · Medium · The lockout design blocks Sunday service and is easy to get around.**
- A 5-try, 15-minute lock on the **whole tablet** means a child pressing buttons, or a flustered volunteer, can take a
  pickup desk out of action during the rush.
- If the lock is measured by the wall clock, changing the iPad's clock resets it.
- If no coordinator is chosen first, the tablet has to test the typed PIN against every coordinator's hash. With 10
  coordinators at 0.5 s each, that is 5 s per attempt. Two coordinators with the same PIN would be indistinguishable.
- **Online**, an account-wide lockout after failures would let anyone lock out every coordinator on a Sunday.

**Q5-5 · Medium · Same-origin script exposure.**
- `localStorage` belongs to the whole origin, not to a path. The hub and `/checkin` share one origin.
- Any XSS on any hub page, opened in that iPad's Safari, can read the PIN hashes and also `mb.checkin.token`.
- Today there is no CSP anywhere (`server/index.js`). The plan adds one only on `/checkin`.
- Not an issue today: the label code escapes names (`esc()`, `checkin.js:463-474`).
- The station token is the larger prize. Online, during check-in hours, it already allows roster download (medical
  notes) and check-outs. Earlier review H9 covers this.

**Q5-6 · Low · How long a stolen iPad stays dangerous depends on staff noticing.**
- Revoking the station kills the token at the next request. Data cached on an iPad that never reconnects stays there
  until the 7-day TTL, and only if the app is ever started again.
- **Without MDM remote wipe, the hashes and roster on a powered-off stolen iPad are never removed.**

### Recommended design (safest workable)

1. **Separate the online PIN from the offline code.**
   - **Online PIN:** personal, never sent to any device, checked only on the server.
     - Rate-limited per station and coordinator, with progressive delay: after 10 failures in 10 minutes, the
       coordinator is blocked on that station for 15 minutes and an alert fires.
     - **No account-wide lockout.** Phone approval stays available.
   - **Server-generated, not chosen:** this ends reuse risk. Show it once and let the coordinator regenerate it.
2. **Offline day codes instead of PIN hashes.**
   - For each coordinator, campus and service day, the server derives an **8-digit offline code**:
     `HMAC(server_secret, user_id|campus_id|day)`, truncated.
   - The coordinator sees it in the hub or app under "Today's offline code". The phone keeps today's and tomorrow's
     code for offline viewing, and a coordinator may write it on a card for one day.
   - Paired stations at that campus, in `explicit` mode and during check-in hours, receive only
     `PBKDF2(code, salt = device_id|user_id|day)` for **today**, and for tomorrow after 6 pm.
   - These go in their own small key (`mb.checkin.approvers.<campus>.<day>`), not in the 7-day roster. They are
     wiped by the daily purge, unpair and sign-out.
   - **The server never accepts a day code online.** Online uses phone approval or the online PIN.
   - Result: a value cracked from one iPad works only **offline, at that campus, on that day**. It gives no
     server-side power.
3. **Tap your name, then type the code.**
   - Only that coordinator's hash is checked, once.
   - Lock **per coordinator on that tablet**: 5 failures lock for 15 minutes, using a persisted counter that changing
     the clock doesn't reset.
   - Backstop for the tablet: 20 failures in a day stop all offline approvals, show "Use the paper process / call",
     and sync a `pin_failure` alert.
   - Other coordinators stay usable, so the Sunday denial-of-service is limited to one person.
4. **Narrow what an offline code may approve.**
   - **Allowed:** releases when the safety list is stale (fast-lane children), `lost_tag_c`, conflict, mismatch,
     `code_unknown`.
   - **Not allowed offline:**
     - do-not-release (already a hard block)
     - releasing a `check_first` child **to the named person**
     - anything `court_order`
     - `id_mismatch`
   - Those wait for phone approval (coordinators' phones usually still have cellular data when the church Wi-Fi is
     down), a coordinator signing in once the tablet is on a phone hotspot, or the custodial parent.
5. **Check again on sync, with alerts.**
   - Every offline approval uploads as an event: coordinator, device, client and server time, kind, child ids, adult
     and operator.
   - The server re-checks it against the restriction state at `client_at`. If the approval would not have been
     allowed, it raises an urgent `release_violation`.
   - **It always notifies the approving coordinator.** "You approved an offline release at North Desk 2, 10:42, for
     1 child." A coordinator who didn't do it reports it at once.
   - Failed attempts sync too.
   - Weekly digest: count of offline approvals per coordinator.
6. **Lost or stolen iPad runbook.** Target: within 15 minutes of noticing.
   1. Revoke the station in the hub. The token dies, and the next request wipes the iPad.
   2. Run an MDM remote wipe, or Find My if MDM isn't used.
   3. Press **"Rotate today's offline codes"** for that campus. New HMAC input; other iPads refresh in about 45 s
      when online.
   4. Online PINs never need resetting, because none were on the device.
   5. Log an incident: the device held the roster with children's medical notes. Check with the insurer or attorney
      whether that triggers a notification duty.
7. **Device guidance (operations, not code).**
   - Supervised iPads in **Single App Mode** (MDM), or Guided Access, on `/checkin`, with a passcode set.
   - No personal Apple ID. iCloud Backup off through MDM.
   - Keep Safari Web Inspector off. Single App Mode keeps volunteers out of Settings.
   - Coordinators keep their phone with cellular data on. A **phone hotspot** for the desk often beats offline mode
     altogether.
8. **Hub-wide CSP.** At least `script-src 'self'` on every page, not only `/checkin`, because storage is
   origin-wide.

**If the owner keeps one personal PIN for both online and offline (the minimum fixes):**
- 8 digits, server-generated.
- Hash sent per day, not in the 7-day roster.
- Locks per coordinator.
- No offline approval for named-person or `court_order` cases.
- Alert on sync.
- "Reset all PINs at this campus" is part of the stolen-iPad runbook.
- Correct §8.2: a cracked PIN also works **online for up to 90 days**.

### Residual risk the owner accepts (with the recommended design)

Someone who copies an iPad's storage and cracks a day code on the same day (8 digits: under an hour to a few hours
with one GPU) could approve, on that campus's iPads, **while they are offline**:
- stale-list releases
- lost tags
- conflicts

**Not** releases to anyone named in a pickup alert.

Every use is recorded and reported to the real coordinator at the next sync. This needs an insider at the desk, an
outage (or a tablet forced offline, which Single App Mode makes harder), and the same day. **Rated Low.**

The plan as written is **High**: a cracked PIN works online for 90 days, and chosen PINs get reused elsewhere.

---

## Q2 (security view). D5: a non-household adult holding the tag, unrestricted child

### Threat model

| Threat | Does "ID check + adult names the child" stop it? | Notes |
|---|---|---|
| Parent knowingly gave the tag to a grandparent, friend or babysitter | n/a (legitimate) | The main reason D5 exists; it is very common |
| **Non-custodial parent with no order on file** | **No** | They know the child's name and carry a real ID. With no restriction on file the system can't know. ID identifies them; it doesn't mean they're allowed. Often legally a parent with equal rights unless an order says otherwise (varies by jurisdiction); the church usually can't refuse on its own judgement. |
| Tag photographed: the code is printed large, with the initials and the number of children | Partly | Without the physical tag, a code, initials and a glimpse of the family make naming the child easy. **The plan doesn't require the physical tag.** |
| Tag stolen, or passed to a stranger | Partly | ID records who took the child, which deters and gives investigators a lead. Naming the child is weak, because initials are on the tag and children say their names aloud. |
| Forged ID | No | Volunteers can't check documents. What protects the child is the recorded name and face, and being seen. |
| Pressure or social engineering on a teen helper ("I'm her dad, I'm in a hurry") | Weak | Tier B can be done by "a trained helper" of any age. Teens give way to adult authority. |
| The real parent later says "I never gave anyone the tag" | n/a | The record needs enough detail to investigate. |

The realistic attacker is someone **who knows the family**: an estranged parent or a relative. Against them, naming
the child proves nothing. ID gives accountability, not authority. In D5 the authority is the **physical tag**, so the
design should make the tag hard to fake and make the household find out quickly.

### Risks
- **D5-1 · Medium:**
  - The physical tag is not required, so a photo, a screenshot or a handwritten code works.
  - Fix: require the printed tag in hand and **collect it** at release ("tag kept" tick).
- **D5-2 · Medium:**
  - Helpers under 18 can do Tier B tag-holder releases, which is where pressure works.
  - Fix: only adult helpers (18 or over) may complete `tag_holder`. A teen presses "Get an adult helper".
- **D5-3 · Medium:**
  - The household finds out only when the child doesn't come home.
  - The coordinator sees it "afterwards on the Live page", which nobody may be watching.
  - Fix:
    - a push to the on-duty coordinators immediately ("Tag-holder pickup at North Desk 1")
    - **a notification to the household's adults with the app straight after the release**: "Mia was collected at
      11:52 by Jane Smith (Grandmother). Not expected? Call the desk/coordinator."
  - This is a narrow piece of D20's "push to parent on pickup". It uses existing push, at no cost.
- **D5-4 · Low:**
  - What gets recorded. Record:
    - the name **as printed on the ID**
    - the ID type (driver's licence, passport or other)
    - "matches the person in front of me"
    - relationship
    - operator
  - **Don't record ID numbers.** They're sensitive, and no use to the church.
- **D5-5 · Low:**
  - Patterns. Raise a coordinator alert when the same household has a second tag-holder release within 30 days, or
    the same tag-holder name collects from several households.

### Recommendation: **Keep D5 in the fast lane, but tighten it.**
1. Physical tag required and collected.
2. Adult helper (18 or over) only.
3. The adult names the child before anything is shown, and checking them against what is on the tag stays.
4. ID name and type recorded, no number.
5. Immediate push to the on-duty coordinators.
6. **A post-release notification to the household's adults.**
7. **Per-household setting "Only people on our list may collect"**, which parents ask for through staff. It sends
   that household to the careful lane, coordinator only.
8. Optional: a coordinator must approve tag-holder releases of nursery and preschool children, who can't confirm
   they know the adult.

Not recommended:
- **Coordinator approval for every tag-holder release:** too slow for a common legitimate case, and staff will route
  around it.
- **Parent confirmation before release:** fails when the parent has left, which is exactly why they gave someone the
  tag.

**Residual risk:** an unflagged non-custodial parent, or a tag deliberately handed to a stranger, still gets the child.
The church can't prevent this with software; the remedy is a pickup alert, which parents must ask for. What remains:
- a recorded identity
- a coordinator who knows within a minute
- a parent who knows within minutes rather than hours

**Rated Medium-to-Low with the tightenings; Medium without them.**

---

## Q3 (security and privacy view). D12: can full medical notes be limited to the room's volunteers?

### Can this codebase do it?
**Not reliably.**
- **Nothing links a person to a room.**
  - `rooms` are age and grade bands per campus.
  - `positions` belong to teams.
  - `assignments` are (service, position, person).
  - Volunteers aren't checked into rooms: `checkin.js:299-300` only creates `kind: 'kid'`.
  - Limiting by room would need a new column, `positions.room_id`, or a `room_staff` table, plus a check of today's
    accepted assignments.
- **Shared stations have no identity.** `user.id` is null (`stations.js:41`). The Rooms screen on a paired iPad would
  need the iPad bound to a room, or a sign-in for each person. Neither fits a busy Sunday.
- **Reality on the day:**
  - substitutes and walk-in helpers
  - combined rooms when numbers are low
  - floaters and bathroom runners
  - the coordinator covering everywhere
  - Schedules are wrong often enough that access based on assignment fails on the day it matters.
- **Offline:** every child's notes are already in the cached roster (`checkin.js:10`; the plan's roster keeps them),
  so filtering on the screen alone doesn't minimise what the iPad holds.

### Benefit compared with risk
- **Benefit:** a modest reduction in who can read notes, and only on personal signed-in devices.
- **Safety cost:** high. Anaphylaxis, seizure plans, diabetes and asthma matter most in hallways, bathrooms, at
  handovers and in combined rooms. A helper who can't see "EpiPen in blue bag, give at first sign" is a safety
  failure, not a privacy gain. Ops review D10 says the same.

### Risks
- **D12-1 · Medium:**
  - The `medical_notes` field mixes emergency care information with sensitive things that aren't emergencies.
    Examples: diagnoses, behaviour, medications, foster or custody remarks, therapy.
  - Everything goes to every helper and every iPad.
- **D12-2 · Low:**
  - Full notes for all children in the 7-day roster cache, discussed in §3.11 and the earlier review.

### Recommendation: **don't limit by room. Minimise by what the information is and when it's needed.**
1. **Split the field. One additive column, Phase 5.**
   - `medical_notes` becomes "care and emergency notes": what any adult with the child must know. Rooms and helpers
     see it, as planned.
   - New `private_care_notes`: coordinators and admins only, never sent to iPads.
   - Show parents and staff guidance on which goes where. Existing notes stay where they are; staff move them by hand
     if they choose.
2. **The life-critical summary travels with the child:**
   - the allergy strip
   - `label_medical` for epi-pen or seizure plans
   - "MEDICAL: see room list" (D12 as planned)
3. **Full care notes in the Rooms view:**
   - only for children **checked in today** at that campus (already the case)
   - only to helpers and above, and stations, in `explicit` mode
   - never to unflagged leaders
4. **Hub viewing is audited.** Opening a child's notes in the hub or History writes an access event. Coordinators can
   see who looked.
5. **Optional later:** a care-notes field for each room, if a room bound to a station ever becomes real.

**Residual risk:** every kids helper on duty can read care notes for children checked in that day. That is accepted,
and it is how most children's ministries work. The non-emergency sensitive material comes off the iPads.

---

## Q4 (security and privacy view). D17: what keeping all check-in and pickup events indefinitely means

**This is not legal advice.** Laws differ by country and state. **The owner should confirm the final schedule with
the church's insurer and attorney** (and a safeguarding advisor, if the denomination has one) before any purge job is
approved.

### What keeping everything means
- **Safeguarding (the argument for keeping it):**
  - Abuse allegations often surface years or decades later. Many places have extended or removed limitation periods
    for childhood abuse claims.
  - Investigators and insurers then ask: who was in the room, who checked the child in and out, who released them
    and to whom, which volunteers were serving. Those records protect children and volunteers wrongly accused alike.
  - Church insurers commonly advise keeping children's-ministry attendance and staffing records for a very long time.
- **Breach impact (the argument for minimising):**
  - Years of children's names, attendance patterns ("Mia is here every Sunday at 10:30"), who collects them, and
    restriction history: a pattern-of-life record useful to a stalker or an abducting parent.
  - Medical notes and phone numbers raise the impact further.
  - Children's data gets the strictest treatment under most privacy regimes. Where storage-limitation rules apply
    (for example GDPR in the UK and EU), "indefinitely" needs a written justification. A safeguarding purpose usually
    supports long retention of **safeguarding records**, but not of everything.
- **Things in the code that matter here:**
  - **Backups:** nightly encrypted backups to Drive (`backup.js`). A purge isn't finished until old backups rotate
    out. A legal hold has to stop that rotation.
  - **Append-only events:** `checkin_events` will be append-only by trigger (m30). Any anonymising has to be a
    documented, owner-approved maintenance path, never a quiet `UPDATE`.
  - **Cascades:**
    - `checkins.person_id ON DELETE CASCADE` (`db.js:207`)
    - `assignments` cascading from services, positions and people (`db.js:176-180`)
  - A future hard delete would therefore wipe safeguarding evidence. Keep "no hard delete" as a rule, and have holds
    cover it.
  - **Medical notes aren't historical.** They live on `people` and are never copied into events. Keep it that way:
    events and `restrictions_snapshot` must never copy medical text.

### Recommended retention schedule (starting proposal for the insurer and attorney)

| Data | Keep | Then | Why |
|---|---|---|---|
| Release, refusal, override, undo, void, alert, incident-note and code-conflict events, and who released to whom (including tag-holder ID name and type) | **Long-term: at least until the youngest child named turns 18 plus the local limitation period; in practice "indefinitely, reviewed every 5 years"** | Review | The core safeguarding evidence |
| Pickup restrictions, including ended ones and their `details` | Long-term (as above) | Review | Investigations and custody disputes |
| Routine check-in and check-out rows (attendance) | Long-term (as above) | Review | They prove who was present. Can't be separated from release events. |
| Volunteer serving records (`assignments`, and room staffing if added) | Long-term (as above) | Review | "Who was on duty" is the first question asked |
| One-time pickup contacts: phone | **90 days** (as D17) | Phone cleared; name and relationship kept on the release record | No ongoing need |
| Pickup-contact photos (`household_pickups.photo`) | Until the contact is archived or ended, **+ 90 days** | File deleted; record kept | Faces are high-impact if breached |
| Tablet caches (roster, photos, day lists) | Per §3.11 (day purge, 7-day TTL) | Wiped | Device data |
| Medical and care notes, allergies | Current only | **Cleared when a child is archived or has had no check-in for 24 months** (staff warned first) | Not needed for safeguarding; highest health-data impact |
| Security logs: roster downloads, leases, PIN failures, logins | **2 years** | Purged or counted | Detecting incidents, not safeguarding |
| Notification and inbox copies of alerts | 1 year | Purged | The event is the record |

**Access to old records:**
- History older than 13 months is visible only to coordinators and admins.
- Searches and exports of it are audited.
- A reason is required for exports.

**Legal hold (build it before any purge job):**
- A `retention_holds` table records the scope (person, household, campus, or date range), the reason, who set it,
  when it was set and when it was released.
- Admins can set or release a hold. Both actions are audited and admins are notified.
- Every purge job skips held rows and **pauses backup rotation** while any hold is active, so a snapshot is preserved.
- Rule in the runbook: **when an allegation or claim is raised, set the hold first, before anything else.**

**Recommendation:**
1. **Keep the safeguarding events and attendance long-term, as D17 proposes, but write down why, and review it every
   5 years.**
2. Add the short-lived items to the purge list:
   - one-time phone numbers after 90 days
   - pickup-contact photos 90 days after the contact ends
   - medical and care notes for children who have left (24 months)
   - security logs after 2 years
3. Build the legal hold before the first purge, and make it cover backups.
4. Get the insurer and attorney to confirm before the purge job is approved (§8.2 already requires owner approval).

**Residual risk:** a breach of the database or a backup exposes years of children's attendance and pickup history.
This is reduced by access limits, encrypted backups and minimised medical data, and accepted for safeguarding reasons.
