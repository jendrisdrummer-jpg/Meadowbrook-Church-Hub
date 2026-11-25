# Revision 3.2: interim safety, approved release roster, labels, hardware and costs

Chief Architect · 2026-11-25 · Planning only; nothing is implemented. This revision answers the owner's four questions
of 2026-11-25. It was reviewed independently by the Security Specialist ("approve with changes"; six required
changes, all applied below) and Church Operations ("workable with changes", applied below). See
[review-security-rev3.2.md](review-security-rev3.2.md) and [review-operations-rev3.2.md](review-operations-rev3.2.md).

**This revision governs over [plan.md](plan.md) (revision 3.1) wherever they differ.** Nothing here weakens a 3.1
safeguard; every change is stricter or adds information.

## Facts checked in today's code (main)
- **Check-out screen** (`public/js/checkin.js` `showMatch`): typing a 4-character code lists **every** checked-in
  child with that code, from **all** households, under one "Check out all N" button. It shows the "Allowed to pick
  up" list of **only the first household found**, and sends `POST /checkin/checkout {ids}`.
- **Server** (`server/routes/checkin.js`): the `{ids}` path checks nothing about households. The 3.1 ambiguity guard
  (§4.6, Phase 2) was written only for the `{security_code}` path, which **today's app doesn't use**. So the 3.1 guard,
  as written, would not have protected today's app. **Gap found and fixed below (P0.5).**
- **Offline outbox:** today it is one flat list of ids that merges every offline check-out. Security found that a
  mixed-family batch refused by a new guard would retry forever and leave children shown as checked in. Handled below.
- **Labels today:** the child label shows the allergy strip with the full `allergies` text, first name or nickname,
  **full last name**, room, date, code, and the **full `medical_notes` text**. The parent tag shows "PARENT PICKUP ·
  household name", the code, the children's first names and the date. Parent-tag printing is a setting, **on by
  default** (`checkin_print_parent_tag`).
- **Label sizes supported:** Brother QL 62×29 mm (DK-1209) and 62×100 mm (DK-1202), DYMO 30252 and 30256, and plain
  paper. Printing uses Safari's print, so the printer must be reachable from the iPad by AirPrint.

---

## Q1. Interim safety (from approval until pickup sessions are on, about 10–13 weeks)

### 1.1 New phase P0.5 "Interim guard" (the first code PR, before P1; about 2 days)
1. **Two-family stop on the check-out screen.** If the children matching a code belong to more than one
   household, the screen:
   - shows each family separately, each with its own "Allowed to pick up" list
   - has **no "Check out all" button**
   - says "This code matches two families. Check ID and choose the children."

   Children are ticked one family at a time, after an "ID checked" tick. It works offline, because the roster is
   cached. A child with no household counts as its own family.
2. **Children are always ticked one by one.** "Check out all" is removed for everyone, even with one family. The
   screen shows the number of children, which the volunteer reads aloud against the tag (Church Operations).
3. **Server guard on both paths:**
   - A `{security_code}` that matches more than one household gets a 409 with the families listed.
   - An `{ids}` request spanning more than one household gets a 409 unless `split_confirmed: true` is set. Only the
     ticked flow above sets it.
   - **Audit:** each 409 and each confirmed split writes an audit row. The row records the **server-known identity**
     (the session user or station token, never the free-text `by`), the ids and the households.
4. **Outbox and staged rollout:** a release that already happened is recorded, never refused on replay (Security
   required change 1).
   - **Per-release entries:** the new client stores outbox entries per release:
     `{ids, split_confirmed, checked_out_at, operator}`. On first load it converts any old flat list into one entry
     per id.
   - **Replays:** replays carry `replay: true`. The server records a mixed-household replay per id, with a
     `mixed_household_replay` audit row and an alert to the coordinator. It does not refuse it.
   - **Rollout order:**
     1. Ship the client.
     2. Each station sends its app version.
     3. Confirm every station has reloaded. Under Guided Access a kiosk keeps the old app in memory all day, so this
        means a reload or restart.
     4. Only then turn on the `{ids}` 409 for clients with no version.
5. **Parent tag privacy now:** remove the household name. **Child label now:** last-name initial instead of the full
   last name, with the clash rule in §3.2 below.
6. **Tests:**
   - two households sharing a code, on both paths, online and on offline replay
   - a legacy flat outbox holding two families
   - a single household (unchanged)
   - a child with no household
   - the audit identity
   - the staged-rollout switch
   - the label clash rule
- **Effort:** P0.5 is about 2 days. The P2 ambiguity guard is now "done in P0.5" (−0.5 day).

### 1.2 What is protected when
| From (approximate) | Active |
|---|---|
| **Next Sunday** (no code) | The temporary pickup procedure (§1.3). Already in today's app: names and the allowed-pickup list are shown before check-out; check-out needs a leader sign-in or a paired station; parent tags are on by default |
| **P0.5** (week 1–2) | Two-family stop; child-by-child check-out; server guard on both paths with audit; no household name on tags; last-name initial on labels |
| **P1** (week 3–4) | Past check-ins and serving records can't be deleted or rewritten; legal hold |
| **P2** (week 5–6) | Station token wins over a hub session; no sign-in on kiosks; campus checks on pickup contacts and `POST /people`; column allow-lists; security headers and SRI |
| **P3** (week 7–9) | Separate check-in host; every iPad migrated |
| **P4** (week 10–13) | Server-leased codes, pickup sessions, the two lanes, tag-holder safeguards. **Code-only release ends here** |

### 1.3 Temporary pickup procedure (recommended from next Sunday; no code needed)
On the desk as a one-page card, with a 10-minute briefing before the first Sunday. It is also in
[operational-policy.md](operational-policy.md) §0.

1. **Settings check (admin, once):** "Print a parent pickup tag with each check-in" is on, at every campus.
2. **Tag plus names:** the adult shows the tag and **says each child's first name before the volunteer reads the
   screen**. For a child too young to be named, the room leader confirms the child knows the adult.
3. **Never press "Check out all"** (until P0.5 removes it): tick the named children one by one. The volunteer reads
   the number of children on screen aloud against the tag.
4. **Stop rule:** if the screen shows a child the adult didn't name, or children from two families, stop. Check ID and
   call the coordinator.
5. **Who may collect:** a household adult, or someone on "Allowed to pick up" **on the screen**. "I know them" is not
   enough on its own: everyone else shows ID, and the duty coordinator calls a parent on file before release. **The
   child waits in the room, not at the door.** Never release to anyone under 16.
6. **No tag:** ID, and the person must be on the household or allowed list. Otherwise the coordinator calls a parent.
7. **Pickup alerts (custody and do-not-release): there is no system flag yet.**
   - **What the list holds:** the safeguarding lead keeps a confidential paper list with:
     - the **restricted adult's name and description**
     - the child's first name and last initial, and their room
     - "Hold the child and call the coordinator"
   - **Who holds it:**
     - **Copies:** the lead prints a numbered copy for the desk coordinator and one for each room holding a listed
       child.
     - **Briefing:** rooms holding a listed child are told before the service: "ask the coordinator before releasing
       this child."
     - **Handover:** at a change of service the outgoing coordinator hands the copies to the incoming coordinator.
     - **After the service:** copies are collected, counted against their numbers and shredded.
   - **Rules:** never photographed, put in chat or kept on phones. If a copy goes missing, the safeguarding lead is
     told the same day.
   - **Limit (accepted for the interim only):** the stop works when the restricted adult is recognised or the child is
     on the list. It is not a system check.
8. **Undo check-in:** only for a mistake made in the last few minutes. Anything else goes to an admin, because
   undo deletes the record until P1.
9. **Two adults at each room door during pickup.** If a room has only one adult, the desk sends a runner, or the
   children are collected from the desk.
10. **If a parent refuses ID or the check:** stay calm. The child stays in the room, and the coordinator (or the staff
    member on call) handles it. Nobody argues at the door.
11. **Phones:** the duty coordinator's mobile number is on the desk card, and each room can reach it. To reach a parent
    in the service, an usher fetches them.

---

## Q2. Approved release roster (replaces self-selection for adult-only actions)
In revision 3.1, "adult" came from the birthdate of whoever was picked from today's kids-team schedule. Revision 3.2
adds an **approved roster**. It is required for any action that releases a child to someone other than a known
household adult, and for full medical notes.

### 2.1 Who is on it
People an admin grants the `helper` (or `coordinator`) check-in level at a campus. This is the 3.1 permission, now
made a roster with these rules:
- `approved_by`, `approved_at` and `review_by`. The default review is 12 months; a grant lapses automatically, and
  admins are reminded 30 days before.
- An admin ticks "Screening complete under church policy" at each grant and renewal. **No screening details or
  results are stored in the hub**, only who ticked it, when, and the policy version. An admin can't tick it on their
  own grant. (A full background-check record stays in the backlog.)
- Adult by birthdate on file. With no birthdate, the grant is refused.
- Expected size: 8–15 people per campus, 3–5 present per service (Church Operations).

### 2.2 What needs the roster
- Tier B releases (tag holder, lost tag with photo or ID, ID tick)
- desk approvals
- opening Level 2 full care notes

Scheduled volunteers who are not on the roster can still:
- check children in
- do Tier A releases (a known household adult with the tag)
- see the Level 1 safety line

### 2.3 How identity is confirmed: never just a name picked on the iPad
- **Online Tier B release:** the roster member confirms the release on **their own signed-in phone**, in one of two
  ways:
  - a **push**, which reads only "Confirm a release at North Desk 2". Names appear only inside the signed-in app;
    the push carries only an opaque id.
  - **typing the short one-time code** the iPad shows into their app, for when a push is late or signal is poor.
- **Binding:** the confirmation is single-use. It is bound to the release id and the station, expires after
  2 minutes, and must come from the roster member picked on the iPad.
- **On screen:** the iPad shows "Waiting for approval" with the time so far, and afterwards "Approved by Sam T.,
  14:02".
- **No phone with them:** a coordinator approves instead (phone or online PIN, as in 3.1).
- **Level 2:** the roster member is picked on the iPad and confirms from their phone once per shift (3.1 `phone`
  mode). Each view is logged.
- **Offline (Security required change 3):**
  - Tag-holder and lost-tag releases still need a coordinator's offline day code, as in 3.1 (I-53). Unchanged.
  - **ID-tick release of a known household adult** (on file, ID shown): **owner decision I-56.**
    - **Recommended:** the operator must be a roster member picked from the **cached roster**. The release is
      recorded as "not phone-confirmed" and appears in the coordinator's daily review. This is stricter than 3.1,
      which allowed any adult on the schedule.
    - **Stricter alternative:** a coordinator's offline day code.
  - Level 2 is online only (unchanged).
- **Cached roster:**
  - The iPad keeps the roster's ids, names and adult flag, refreshed with every sync.
  - **Revocation:** reaches an online iPad within 60 seconds. An offline iPad applies it at its next connection, and
    after the 180-minute safety-list limit it stops using its cached roster entirely.
  - Offline releases by someone revoked in the meantime are flagged on sync.

### 2.4 Plan changes and effort
- Checklist:
  - I-27 changes to "roster plus phone confirmation for every Tier B release"
  - new items I-54 (roster renewal and screening tick), I-56 (offline ID tick) and II-48 (roster fields,
    confirmation binding, generic push, audit)
- Effort: about +1.5 days. Roster fields, renewal reminders and the cached roster go in P5. Phone confirmation
  already exists in 3.1 for tag holders; P4 extends it to lost tag and ID tick and adds the code-entry alternative.

---

## Q3. Labels: exactly what is printed

### 3.1 Child label (stuck on the child, where other families can see it)
| Item | Why it is needed | How it is kept minimal |
|---|---|---|
| First name (or preferred name) | Room volunteers call the child by name; parents spot their own child | — |
| Last-name initial | Tells apart two children with the same first name | Full last name removed (§3.2) |
| Room | Gets a wandering child back to the right room | — |
| Date and check-in time | Stops an old label or tag being reused on another day | No year; time as HH:MM |
| Pickup code | Matches the child to the parent tag at pickup | It is never enough on its own to release a child |
| Allergy strip | Snack and craft helpers who never open the iPad must see it at a glance | Allergen words only, from the Level 1 field, with no diagnosis or reaction history. **Never cut short:** if the words don't fit, it prints "ALLERGIES: SEVERAL, SEE ROOM LEADER" (Security required change 5). |
| "EPI: YES" | Any adult in an emergency knows an EpiPen is needed and is on site | Yes or no only |
| "MEDICAL NOTE: ask the room leader" | Tells volunteers a Level 2 note exists | No content |
| Full medical note | Only when the parent opts in for that child, re-confirmed each term | Off by default |

**Never on the child label:** full last name, household name, birthdate or age, grade, phone, address, photo, a
custody or restriction marker, or Level 2 or 3 content (except the opt-in above).

### 3.2 Clash rule
The rule is checked at print time against **every child eligible for that room** in the cached roster, not only the
children already checked in, so a later arrival can't make an earlier label ambiguous.
- Two eligible children share a first name and last initial: their labels print two letters of the last name.
- They still clash (for example twins with the same name, which is very rare): the labels add the age in years.

### 3.3 Parent tag (kept by the adult)
- the code in large type
- the date and check-in time
- the number of children and their initials
- "Keep this tag. You hand it over at pickup. We may ask for ID."

No household name, no children's full names and no room.

### 3.4 Timing and one accepted risk
- **P0.5:** household name off the tag; last-name initial on the label.
- **P7:** Level 1 allergen words and the medical-note line.
- **Until P7, labels keep today's full `medical_notes` text.** Level 1 doesn't exist yet, and removing the notes early
  could hide life-critical information. **The owner accepts this as a temporary risk (II-49)**, recommended by
  Security.
- **Free-text allergies:** parents' existing free-text allergies are sorted by staff into Level 1 allergen words using
  the P7 review list (I-29). Anything that doesn't map prints "ALLERGIES: SEE ROOM LEADER".
- New owner decision: I-55 (last-name initial with the clash rule; recommended).

---

## Q4. Hardware and running costs

### 4.1 iPads
- **What the new check-in needs:** Safari features that all exist by iPadOS 15.4:
  - Web Locks
  - WebCrypto ECDH P-256, HKDF, AES-GCM and PBKDF2
  - non-extractable keys stored in IndexedDB

  Security confirmed these.
- **Expected to work:** any iPad that can run iPadOS 15.4 or later. That is the iPad Air 2, iPad mini 4 and every
  newer model. The Air 2 and mini 4 stop at iPadOS 15, which is enough.
- **Not confirmed for your devices:** the hub doesn't record iPad models.
- **P0 checks each iPad:**
  - It runs a probe page.
  - It times the 600,000-round PBKDF2 step. The oldest models (A8/A8X chips) will probably need the plan's
    310,000-round fallback.
  - It checks that the stored key survives a two-week gap. The app runs from the Home Screen, which avoids Safari's
    7-day storage clearing.
- **Owner action:** list each desk iPad's model and iPadOS version (Settings → General → About).

### 4.2 Printers
- The same AirPrint label printers that work today keep working. Nothing new is needed.
- P0 test-prints the new layout (5–6-character codes, time, EPI) on each model and label size.

### 4.3 Labels
- **Today:** one label per child, plus one parent tag per family when the setting is on (it is on by default).
- **What the plan adds:** the tag becomes mandatory, plus occasional reprints for lost tags.
  - If tags are already on: under 5 % more labels.
  - If they are off: about 40–60 % more (one per family).
- **Worked example** (replace with your own counts):
  - 120 children and 70 families a Sunday ≈ 190 labels ≈ 9,900 a year ≈ 12–13 rolls of DK-1209 (800 labels a roll).
  - Rough prices, to check with your supplier: compatible rolls cost a few dollars each; genuine Brother rolls about
    $15–$25. So labels cost about **$50–$320 a year in total**.
  - The plan's share: **about $0–$15 a year** if tags are already on, or **about $20–$120** if they are off.

### 4.4 Paid services, subscriptions and hardware
**None are required.**
- No new dependencies, no SMS and no paid APIs. Notifications use the existing push and email.
- **`checkin.<domain>`:** a DNS record at your registrar (free), plus a custom domain on the existing Render service
  (managed TLS is included on paid Render services; confirm it fits your plan's limits, A5).
- **Device management (MDM):** optional. Apple Business Essentials and Jamf charge per device. Guided Access is free
  and is the default.
- **The "spare iPad" for the trial Sundays** is one of your existing iPads set up with the new app, not a purchase.
- **Phones:** roster members and coordinators use their own phones with the existing member app, which is free.

---

## Effect on the plan
- **Effort:**
  - P0.5 adds about 2 days and P2 drops 0.5 day.
  - The roster adds about 1.5 days.
  - **Core: about 61.5 working days** (65 with P9) of effort at a human-developer pace.
  - **Calendar:** replaced by [schedule-review.md](schedule-review.md): about **15 weeks** recommended, or about
    **11–12 weeks** accelerated, with nothing removed. Code-only release ends in about week 9. Level 1 labels move up
    to ship with P4 (P7a).
- **New checklist items:**
  - I-54: roster renewal and screening tick (Group I, sheet B)
  - I-55: last-name initial (Group I, routine)
  - I-56: offline ID-tick rule (Group I, sheet A)
  - I-57: the temporary pickup procedure from next Sunday (Group I, sheet A)
  - II-48: roster and confirmation design (Group II, routine)
  - II-49: full medical notes on labels until P7 (Group II, sheet C)
  - III-29: deploying P0.5, with the staged `{ids}` switch (Group III)
- **Changed:**
  - I-27: roster plus phone confirmation
  - I-36: the spare iPad is one you already own
- **Owner and operations to-dos raised by Church Operations:**
  - name the safeguarding lead and a backup
  - name the duty coordinator at each campus for the interim
  - print the one-page desk card
  - add the procedure to volunteer onboarding
  - the insurer and attorney review of the written policy (already I-34, I-38, I-49) should happen before the interim
    procedure becomes a written rule; in the meantime it runs as interim guidance
