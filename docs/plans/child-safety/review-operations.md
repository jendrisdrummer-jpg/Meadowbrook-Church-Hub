# Church Operations review: child-safety plan (cs-plan-draft.md)

Reviewer: church-operations (read-only). Date 2026-11-25.
Compared against: today's tablet flow (`public/js/checkin.js`, `public/checkin.html`), `docs/features.md`, `docs/permissions.md`.

## 0. Overall verdict: WORKS WITH FRICTION. The safety goals are right. Several steps will break on a busy Sunday unless simplified.

The plan fixes real holes (cross-family release, no custody data, any auto-leader can open check-in, no audit). The danger is that it makes the *normal* path (90%+ of pickups: a parent with a tag and a matching child) heavier to protect the 1-3% special cases. Volunteers under pressure route around friction. A safety system that is skipped is worse than a simple one that is always used. Principle for every change below: **the common case stays near today's speed; extra steps appear only when the data says "this is special."**

## 1. Today's baseline (what volunteers do now)

Check-in, returning family (`drawSearch` > `drawFamily` > `checkIn`):
1. Type last 4 of phone or last name (2+ chars, results appear live).
2. Tap family (1 tap).
3. Kids pre-ticked, room auto-assigned, service defaults to current. Tap "Check in & print" (1 tap).
4. Labels print; confirmation screen auto-returns after 20 s or "Done".
Total: ~2 taps + typing, about 10-15 seconds per family. Works offline.

New family: "Add a new family" (online only) > parent dialog (4 fields) > child dialog (4 fields, birthdate picker) > per extra child repeat > check in. About 60-120 s, mostly typing. Fails offline (writes on paper).

Check-out today: type 4-char code (auto-submits at 4) > see kids + "Allowed to pick up" text > 1 tap "Check out all N". About 3 taps, 5-8 seconds. This speed is why it works with 30 pickups in 5 minutes. It is also why it is unsafe (any family sharing the code is released; nobody is asked who the adult is).

Small observations from the current code worth knowing: the 4-char code input auto-submits and is uppercase-only; Rooms mode shows the code beside each child (so a helper can see codes); the parent tag is optional; offline new families/children are blocked.

## 2. Workflow-by-workflow walkthrough

Counts are taps/keystrokes on the iPad. "Sunday speed" = 30+ pickups in 5 minutes across 2-3 stations, i.e. roughly 8-10 seconds per family per station maximum.

### 2.1 Check-in, returning family
Plan: same screens, plus (a) red "Pickup alert" banner if any child has a restriction, (b) optional "Someone else picking up today?" prompt, (c) pickup session created silently, (d) 5-char code with a lease prefix, (e) parent tag always printed (D11).
- Taps: 2 as today, +1 only when the volunteer opens "Someone else picking up".
- Verdict: **works** if the "Someone else" button is a small optional link, not a dialog that appears every time. If it were a mandatory prompt it would add 2-3 s x every family and be skipped within a month.
- Always printing the parent tag: **right call**, but it doubles label use and print time (child labels + parent tag). On a Brother/Dymo that is 1 extra label per family, about 2-3 s. Acceptable. Make sure stock is on the supplies list (see section 5).
- Simplest change: keep "Someone else picking up today?" as a quiet secondary button next to "+ Add a child"; auto-show nothing else.

### 2.2 Check-in, new family (first-time visitors)
Plan changes nothing here directly, but the plan's check-out requires "who is collecting" from an authorised list. For a brand-new family the list is just the parent(s) typed 30 seconds ago.
- The real problem: new-family entry is already the slowest, most error-prone step (online only, ~8-10 fields). Adding pickup contacts, ID-required flags, custody questions here would make it worse.
- Verdict: **works with friction** (today's friction, not new). Do NOT add custody or pickup-contact questions to the first-visit form. Ask one line on the paper/screen: "Anyone other than you two who may pick up today?" and leave the rest to staff follow-up on Monday.
- Gap: when the internet is down, a first-time family cannot be added at all (the current toast says write it down). Plan does not fix this. See paper fallback (section 4).
- Simplest change: allow an offline "guest family (quick)" with parent name, phone, child name, birthdate, allergies, queued and reconciled later. This is the single biggest Easter/Christmas surge risk and is not in the plan.

### 2.3 Parent tag
Plan: always printed; code "K 7Q3M" (5 chars); volunteer types it at pickup.
- Verdict: **works with friction.**
  - 5 chars with a leading prefix is more to hear, read and type than 4. Over a noisy hallway, parents shout codes ("K-seven-Q-three-M"). Letters like Q, M, N, W, U, V, 7/T, 8/B (alphabet already excludes some lookalikes) still get misheard.
  - Parents will lose tags (in diaper bags, in the car, on the toddler). Plan handles by lost-tag flow (below).
  - Many parents never read the tag: they say "I'm picking up Ava Smith". Today's system has no way to find by name at check-out; the plan adds only the lost-tag path, which is gated by a coordinator. That makes the *most common failure* (lost tag) the *heaviest path*.
- Simplest change: (1) print the code **large and in two groups** matching what is typed (`K 7Q3M`), and print the first name(s) of the children on the tag (already done); (2) let the volunteer find the family by **tapping the child's name from the Rooms list or by parent last name** and treat that as "no tag" (see 2.8); (3) keep the input tolerant: accept with or without the prefix space.

### 2.4 Check-out, normal case (parent has tag, adult is a household member)
Plan (section 3.3), step by step:
1. Type 5 chars + tap "Find" (no auto-submit): +1 tap.
2. Family card appears. Each child checkbox **unchecked by default**: tap each child (2 kids = 2 taps; 3 = 3).
3. Choose who is collecting from a list (photo cards): +1 tap.
4. ID tick: only when policy requires ("unrecognised": rare).
5. Tap Release: +1 tap.
Total for a 2-child family: 1 Find + 2 child taps + 1 adult tap + 1 release = **5 taps** vs 3 today (code auto-submits, one big button). With 3 children: 6 taps. Roughly doubles time to ~12-18 s per family.
- At 30 pickups in 5 minutes across 2-3 stations that is roughly 15 s x 30 / 2.5 stations = 3 minutes of pure station time per 5 minutes: feasible but with no slack, and queues form. Two things make it worse in practice: iPad tap precision with a parent hovering, and "who is collecting" being a decision the volunteer must make for every family.
- Verdict: **works with friction. Will break on the busiest Sundays** if every step is mandatory.
- Where the safety value actually is: (a) the code returns only one family's children (this alone fixes the cross-family release, and costs nothing in taps), (b) "who is collecting" when the adult is *not* a household member, (c) restrictions.
- Simplest change that keeps safety:
  1. **Keep auto-submit at 5 chars** (or "Find" only when 4 chars are typed, to still support legacy). A Find tap is pure cost.
  2. **Children pre-ticked** (like check-in) with a visible "Release 2" button, and the volunteer unticks any child who is staying (e.g. one sibling still in the nursery). Pre-ticked + label check by eye is the same safety as unticked + a tap, because the failure to guard against is "released the wrong family", already fixed by pickup sessions. Unticked-by-default is the single largest cause of added taps and the likeliest to be bypassed.
  3. **"Who is collecting": default to "Household adult" with one tap on the adult's photo only when there is more than one adult**; when the household has one listed adult, preselect. Show the "Someone else..." choice small.
  4. Show the **child's photo and room** large so the volunteer can compare the child at their side. This is a stronger real-world check than any tick box.
  5. Time the flow in QA with a stopwatch: target <= 8 s for a household adult with a tag, <= 20 s with "someone else".

### 2.5 Check-out, "someone else" / grandparent / babysitter / one-time pickup person
- Added **at check-in by the parent** (D12): good, parent is present, can authorise. Walkthrough: volunteer taps "Someone else picking up today?", types name, phone, relationship = about 15-25 s and a keyboard. At a welcome desk with a line, this will be skipped and families will not remember to do it. It also assumes the parent knows who will collect at 9 am (often a grandparent decided by text at 10:45).
- At **check-out** via override (D12): coordinator + call the parent. This means a grandparent with a tag in hand, a toddler screaming, and the parent not answering their phone (they are in the service) triggers a 3-10 minute wait. This is the most common "special" case after lost tags and will happen several times per Sunday at a 300-family campus.
- Verdict: **will break on Sunday** (overrides for ordinary non-household pickups will jam the line and the coordinator).
- Simplest change that keeps safety:
  - **A tag in the hand is the authorisation.** The tag is the parent's explicit transfer of authority. Policy: person holds the matching tag + matches name on a standing "authorised contacts" list OR can show ID matching **a name the parent gave at check-in** OR... If none: coordinator approval. Do not require override when the person has the tag, the child is unrestricted, and the person gives the child's name plus a quick ID look. Record "released to X, ID looked at, tag presented".
  - Offer a **"Pickup person" field on the parent's own phone/member app** and on the hub for regular grandparents and babysitters, so standing contacts are entered once by the family or staff (not at the desk). Contacts with photo come from the directory where possible.
  - A one-time person with the tag + ID check + child unrestricted: let any **helper** record it (reason auto-filled "tag presented") and notify the coordinator after the fact, rather than blocking before. Block-before only for restricted children (already the plan).
  - Add "Text me when someone else picks up" later as a free push notification to the parent (member app); no SMS.

### 2.6 Check-out, ID check
- Plan default `unrecognised` (D7): ID checked for one-time contacts, "ID required" contacts, restricted children, lost tags, conflicts. A reasonable default.
- Practical issues: volunteers who are teens or elderly may not know how to handle a parent who is insulted or in a hurry; checking ID against a *name typed by a stranger* is only as good as the typed name; no "what do I do if ID does not match?" script.
- Verdict: **works with friction.**
- Simplest change: give volunteers a **one-sentence script** on the screen and on the quick-reference card ("We check ID for anyone we don't know; it keeps every child safe"). Make "ID doesn't match" a single red button that opens the coordinator call (not free text).

### 2.7 Code clash on sync
- Plan: per-device prefix means clashes should be practically impossible; if they happen, both pickups flagged, coordinator notified, check-out forces choose-family + check ID.
- Walkthrough of a real clash: two parents at the door both say "K 7Q3M". Banner "Two families have this code" + two family cards + ID check. About 20-30 s and some confusion.
- Verdict: **works.** Rare, and the handling is calm. Key practical requirement: the volunteer must see **parent's name/last name on each family card at the top** and the child's photo; "check the label on each child" is excellent.
- Missing: what the volunteer says. Add a pre-written line: "Two tags have the same code, I'll check your child's name and ID, thank you for waiting."
- Concern: **prefix lease on signed-in (unpaired) tablets** (D2) relies on a `device_key` in `localStorage`. iPads under Safari "Private Browsing", cleared website data, or an iOS storage purge wipe this and the tablet will happily get a new prefix; conflict logic covers it. Fine. But if the lease needs the **internet at first use** of a tablet, a brand new tablet on Easter morning with Wi-Fi down cannot check in at all. State clearly: *a tablet that has never been online cannot check in*; test before the service (add to the pre-service checklist).

### 2.8 Lost tag
- Plan: "Lost tag?" > find family by name/phone > open check-ins listed > **override request** > coordinator approves from their phone (push) > ID check mandatory > release. Station alone cannot release.
- Walkthrough on a Sunday: parent (hurry) says "I lost the tag". Volunteer taps Lost tag (1), types name (4-8 keystrokes + 1 tap), picks family (1), picks children (1-2), enters a reason (required free text: typing), taps request (1). Waits for coordinator: coordinator is teaching a room, phone in a pocket or silenced, push on iPhone may be delayed. Realistic wait: 2-10 minutes, occasionally never. Parent stands there with a toddler. At 11:45 with 5 families doing this at once, the coordinator becomes the bottleneck and the parent sees this as "the church is making me wait for my own child."
- Lost tags are common: realistically 3-6% of pickups at a family church (1 in 20 to 1 in 30). With 300 pickups that is 10-15 per Sunday, not an edge case.
- Verdict: **will break on Sunday.**
- Simplest change that keeps safety: a **tiered lost-tag rule**:
  1. The **volunteer on the desk** (a trained helper) can release on lost tag when ALL are true: the adult is a **household adult already on file** (the app shows their directory photo), **ID checked and matches** the photo/name, the child is unrestricted, and the child is named correctly by the adult before the volunteer reveals the name. One tap "Release (lost tag)", no free-text reason; reason is a pick-list (lost tag / phone died / other).
  2. **Coordinator approval** only when: the adult is not a household adult (contact or one-time), the child has any restriction or "check first", or ID does not match.
  3. A coordinator can approve **by tapping a notification on a lock screen** or on a **desk "walkie" fallback** (a coordinator is also reachable by a named runner). Plan the human fallback: each campus has one "safety runner" per service who is NOT teaching (see section 5).
  Plan's own text "A station alone cannot release on a lost tag" should be relaxed to the tier above.

### 2.9 "Check first" override needing a coordinator's phone
- Plan: `check_first` restriction: any release needs a coordinator. Coordinator approves from phone via hub Live page or push; approval is single-use, expires 15 min.
- Walkthrough: parent arrives; red banner "Check first: call Pastor Dan"; volunteer taps request; coordinator receives push; opens hub page (login session may have expired on a phone); approves. About 1-4 min if the coordinator is free, effectively never if teaching.
- Verdict: **works with friction** for a few known cases per month (it IS rare), **breaks** if the coordinator is also teaching and has no backup.
- Simplest change: (1) **named backup approvers** per campus per service (the plan has one pool of "coordinators" notified together: good: first one to tap wins; make the push say "Pickup needs approval at Kids' Desk, Room 3" without names, as the plan does); (2) the request screen should show **who has been notified and how long ago**, with a "Call coordinator" tap-to-dial button for a person on duty; (3) a **desk phone number / radio channel** printed on the card. (4) The tablet shows a calm line the volunteer can say to the parent: "I need one quick approval; it will take a minute."
- Also: the 15-minute expiry is fine. Single-use per child set is fine.

### 2.10 Do-not-release hard block
- Plan: release to the named person: hard block, no override anywhere; only ending the restriction lifts it; every denied attempt notifies coordinators.
- Walkthrough: tablet shows the restricted person's name only when the volunteer is *choosing the adult*; the restricted person is simply not selectable/is greyed with "Not allowed. Call [coordinator]". If the volunteer picks "Someone else..." and types the restricted name, server blocks with 409 and a plain-English reason.
- Verdict: **works** and is the plan's strongest piece. Practical cautions:
  - The volunteer must **not be the one to confront**. The screen text must tell them exactly what to do: "Do not release. Keep the child with you. Press the red button to alert the coordinator and stay calm." A big "Alert coordinator now" button that also notifies pastor/safety lead. Include "if the person becomes angry: call a coordinator or 911", and never a place that tells the restricted adult *why*.
  - A restricted person may simply be the **household's other adult** (divorced, one parent has the tag because they did check-in). That is a real-world case: Mom has the tag; Dad (restricted) is at the door. Dad does not have a tag, so he would look up by name: the plan must handle **look-up by child's name** showing the alert. See gap in section 4 ("no tag, no code").
  - A hard block with **no override** is right for court orders; for informal "do not release to Dad because Mom asked" with no document, pastoral staff should be the ones who decide, but the enforcement is the same. Add a "court order on file" vs "parent request" label so pastoral follow-up differs (the plan has `kind` for this).

### 2.11 Restriction setup by staff
- Plan: coordinators/admins create restrictions on the hub person page ("Kids safety" card): kind, named person, dates, station note, details, document on file.
- Walkthrough: a mother tells the children's pastor in a hallway: "my ex is not allowed to pick up Lily". Staff opens the hub on a phone, finds Lily, opens card, picks kind, picks/types restricted person, writes a station note, saves. About 8-10 taps/typing: 1-2 minutes. OK on a desktop on Monday; awkward on a phone at the door.
- Verdict: **works with friction.**
- Simplest changes: (1) a **"quick add: do not release"** form with 3 fields (child, person, note) usable from a phone, with the rest completed later; (2) **show on the household page, not only on the child**, so a staff member can add one restriction for all children in the family; (3) a **"restrictions entered / expiring" list** staff can check weekly; (4) copy the intake wording for the **parent to sign** (outside the software).
- Operations gap: court orders get entered by only one person; if that person is on holiday no one knows the process. Add a short written procedure and a 2nd trained person per campus.

### 2.12 Granting helper / coordinator levels
- Plan: new `users.checkin` flag (helper/coordinator), settings mode `leaders` then `explicit`.
- Walkthrough: an admin opens Settings > Accounts, finds each volunteer, sets level. Most Sunday kids volunteers (teens, grandparents) do **not have accounts** at all; they use the **paired iPad** (station token). So "helper" level mostly affects people with their own accounts. Good: stations map to helper.
- Verdict: **works**, provided the owner understands that **stations are the real volunteer identity**, which means the audit trail says "Welcome desk iPad", not "Margaret". Child-safety best practice wants to know *who* released the child.
- Simplest change: have the check-out screen ask **"Who are you?" (volunteer picks own name from a short list or 4-digit personal PIN)** only on paired stations and remembered for the session, or at least a lightweight "volunteer name" pick-list for the day populated from the **serving schedule** (the hub already schedules volunteers). That gives a human name in the audit with 1 tap per shift, no accounts. Add as a decision.
- `explicit` mode risk: flipping it will lock out leaders who relied on automatic leader status (Sunday morning surprise). The plan's mitigation (inventory query 5, grant first, then flip) is right; add "flip on a Monday and send each coordinator a test sign-in" plus a **rollback toggle everyone knows** (settings value back to `leaders`).

### 2.13 Deploy-day changes and tablet reloads
- Plan: deploy midweek mornings (D14), flags dark, then enable after a dry run on one station; tablets: wait for "0 waiting to sync", reload.
- Walkthrough: someone needs to physically touch or remote-reload each iPad at each campus before the next service. At a multi-campus church with 3-6 tablets per campus, that is 10-25 tablets. Home-screen web apps on iOS do not always reload on a normal open; the plan notes this as "not testable here".
- Verdict: **works with friction.** The concept is right; the risk is a forgotten tablet showing the old app on Sunday.
- Simplest changes: (1) a **Sunday-morning pre-service checklist item**: "Open check-in on every iPad, confirm it shows the version number in the header and 'Online'". Print the version in the tablet header (the plan adds `x-checkin-app`; show it to the volunteer too); (2) the hub **Stations page lists "needs reload"**, so a coordinator checks the list at 8:30 am with one look; (3) never flip flags on a service day (plan says this); (4) keep one **legacy-capable fallback tablet** per campus untouched until the new flow has run successfully for two Sundays.

### 2.14 Special cases not walked in the plan
- **Siblings in several rooms:** one parent tag, kids in 3 rooms; pickup requires walking to rooms or kids coming to a central pickup. Plan only says release child-by-child. Decide the **physical** process: central pickup point vs parent goes to each room. Child-by-child with 3 children being released from one tablet at once is fine; but **room teachers** need a way to know "Ava has been released" (Rooms view refresh is manual / every 10 min; stale). Make Rooms auto-refresh every 30-60 s when online.
- **Staff kids / volunteers' kids:** teachers' own children check in under their household; the parent is in the room teaching and "picks up" at the same room. Likely to be flagged "check-out requires ID" if mis-set. Allow a household-level "staff family: serving, pickup at room" note, or accept that the tag works as normal.
- **Special-needs children:** often have a dedicated buddy and a quiet room; the parent may be called mid-service ("please come to room 4"). Plan has no "page the parent" path (the notification feature is listed as no-SMS). Medical notes: D10 prints "Medical note: ask a leader" instead of the full note on labels. Good for privacy but **slows a nurse or a substitute volunteer** if the full note is not also visible on the Rooms screen (the plan keeps Rooms; confirm it still shows the full note to helpers). Do not hide a life-critical note (epi-pen, seizure plan) behind "ask a leader"; show the *allergy strip* as today and keep the full medical note on the room roster.
- **Divorced/separated:** "shared custody across two households" is cut to the roadmap (D17). In practice this is the most common pickup question: the child lives in two households, both parents are *authorised*, tags are issued per check-in, whichever parent checks in holds the tag. The per-child restriction covers *prohibition*; what is missing is **both parents appearing on the same child's authorised list** when they are in two households. Workaround: add the other parent as a standing pickup contact. This works but is not discoverable. Add to staff procedure and the "Kids safety" card help text.
- **Phone died / no tag, no phone:** parent can't show a tag or receive an approval callback; see 2.8; tag-less look-up by child's name should exist for household adults with ID.
- **Wi-Fi drops:** overrides, lost-tag approval, new families, and adding a one-time person all fail offline. Plan says "Find a coordinator". At check-out the most likely offline cases are lost tags and "someone else". Provide the **paper fallback** (section 4).
- **Surge (Easter/Christmas/VBS):** many first-time families (online-only add), more volunteers who have never used the tablet, more Wi-Fi congestion (guests on the same network), more lost tags, more non-household pickups (relatives visiting). VBS: multi-day, a different roster, T-shirt or wristband approach.

## 3. Owner decisions: where to decide differently (practical view)

| # | Plan | Practical view |
|---|---|---|
| D1 | 5-char, device prefix | **Agree**, with caveats: print/type as `K 7Q3M`; accept with or without the space; make the prefix a character that is visually distinct from the first group; show the code in the Rooms list as today. Test that a brand-new tablet that has never been online cannot check in (say so in training). |
| D2 | Signed-in tablets may check in with a lease | **Agree.** Strongly encourage pairing. |
| D3 | helper/coordinator levels | **Agree**, but add a **"volunteer name for this shift"** pick (see 2.12). A coordinator who is also teaching should NOT be the only approver (see D6). |
| D4 | Show restricted name + station note, never details | **Agree.** Stress that a station note should never explain *why* ("Call Pastor Dan" yes; "restraining order" no). |
| D5 | Hard block, no override | **Agree.** Add the volunteer script + "Alert coordinator now" button. |
| D6 | Overrides via coordinator's phone, no PINs, no shared PINs | **Decide differently.** Phones are silenced, in a pocket, or in a teaching room. Require **at least two named approvers per campus per service** (rota), push to all, plus a printed desk phone/radio route. The optional **offline PIN** should be *in* scope, not "later": per-coordinator 4-6 digit PIN works with no Wi-Fi and no phone. Keep audit by coordinator name. |
| D7 | ID check `unrecognised` | **Agree.** Do **not** go to `always` (30+ pickups). Add the ID script. |
| D8 | Void instead of delete | **Agree.** Add: a coordinator can void a mistaken check-in in 2 taps from the Rooms view (common: wrong child checked in, double check-in). |
| D9 | Roster cache minimised: this campus + last 12 months | **Mostly agree; one catch.** Families who attend another campus occasionally (Easter, a cousin's visit, a family who moved campuses) will **not be found** on a given tablet and will have to be re-added as "new family", creating **duplicates**. Make the scope "this campus + 12 months + any household with a child that has checked in anywhere in 12 months" (still minimised: no adult medical data) or add an **online "search all campuses"** fallback button at the desk. Last-4 phone search: parents give their number or last name; fine. |
| D10 | "Medical note: ask a leader" on label | **Decide differently.** Keep the allergy strip unchanged. For medical notes, printing a short **flag** (e.g. "MEDICAL: see leader") is fine, but the full note must always be visible to every helper on the Rooms screen, and an epi-pen/seizure note should not require asking anyone. Offer "Print full note" as a per-child setting for the few kids that need it. |
| D11 | Always print parent tag | **Agree.** Add to supplies list; add a **paperless alternative** (member-app QR/code) as a later item. |
| D12 | One-time pickup: parent at check-in; at check-out only via override after calling parent | **Decide differently** (see 2.5): allow a trained helper to release to someone presenting the tag + ID for an unrestricted child without a coordinator call, with an after-the-fact notice. Override remains for restricted children. Add standing "regular pickup helpers" on the family's own member-app page. |
| D13 | Directory photo for contacts; camera deferred | **Agree.** Note most grandparents/babysitters will not have a directory photo, so ID check becomes the control; fine. |
| D14 | Weekday-morning deploys, reload tablets | **Agree.** Add the two-Sunday soak with one untouched legacy tablet and a check-in app version shown on screen. |
| D15 | Keep history indefinitely | **Agree** but flag privacy: child names with pickup person names forever. Decide a retention period with the pastor/insurance advisor, with restrictions and incidents kept longer than ordinary rows. |
| D16 | Inbox + push, no SMS | **Agree**, but push on iOS web apps is unreliable. Add the human fallback (runner, radio/phone) and an on-screen "coordinator notified at 11:42" timestamp. |
| D17 | Defer shared custody, camera, encryption | **Agree to defer**, with a documented workaround (second parent as a standing contact) and a staff note, because divorced/separated families are common. |

## 4. What is missing for real operations (not in the plan)

1. **Paper fallback that keeps safety (system down or Wi-Fi gone).** Pre-printed, numbered sign-in sheets per room (child name, parent name/phone, allergies, time in) and **matching numbered paper tag pairs** (child's half stuck on the child, parent keeps the other half; number written on both). Check-out rule: tag numbers must match; ID for anyone unknown; a **"do not release" list printed Sunday morning** from the hub (the plan only mentions printing restrictions after a rollback; make a **daily one-page "pickup alerts" printout per campus** a standard pre-service step: names of restricted adults + station notes only, in a folder with the coordinator). The tablet already works offline for check-in and basic check-out, so paper is for *total* failure (dead tablet, dead charger, lost lease). Reconcile the paper into the system Monday.
2. **Volunteer training.** 10-minute onboarding for every new kids' volunteer (teens included) covering: how to check in, how to check out, the three "stop and call a coordinator" cases (restriction alert, no tag and not a household adult, ID doesn't match), the words to use with a parent, and "you are never in trouble for asking for help." Ongoing: a 3-minute huddle before each Sunday service. Two trained **safety leads** per campus. Pair a first-timer with a shadow for the first 2 Sundays.
3. **Printed quick-reference card** (one laminated A5 per station, large type): the 3 flows; the "stop" cases; scripts for parents; who to call and the number; what to do if tablet is offline; what to do if a restricted person arrives. Include a picture of the tag and where the code is.
4. **Signage for parents:** at the welcome desk and room doors: "Keep your tag. You will need it to pick up your child." and "Anyone collecting your child must show this tag and may be asked for ID." Add a "Picking up someone's child? Tell us at check-in" line.
5. **Telling families about the new 5-character codes.** Short message through the app/announcements/email two weeks before and again the Sunday of: "Pickup codes now have 5 characters and your tag now prints every time. Keep the tag with you. If you lose it, we will ask for ID." A bulletin note and a 20-second announcement from the stage the first Sunday. First two Sundays: a greeter at the pickup door explaining. Note that the old 4-character tags printed *before* the switch will still work for that day only.
6. **Communicating the change to parents in advance (and the why):** family e-mail from the children's pastor explaining "ID may be asked for anyone we don't know; add regular pickup people in the member app by [date]". This also reduces the one-time-person and lost-tag spike. Add a parent self-service: members add standing pickup contacts in their own app (not only staff).
7. **A "safety runner"/coordinator not teaching.** At least one named adult per campus per service who walks, does approvals and answers the phone: not the lead teacher of a room. Otherwise D6 will fail.
8. **Pickup process for siblings in different rooms** (central pickup vs room-by-room) and for **two-service families** (code reuse across services is by family per day; confirm a second-service check-in does not strand the first service's child).
9. **Behaviour with an angry or aggressive parent:** a written procedure (do not argue, do not release, call a coordinator, call 911 if threatened, incident note after). The tablet already shows an alert; the human escalation is the missing half.
10. **Incident follow-up:** after a denied release or conflict, who contacts the family, who writes the note, and where. The plan sends notifications but no workflow for the aftermath. A simple "incident note" on the child's record (coordinator only).
11. **Pre-service readiness checklist (8:30 am):** tablets charged and online, app version matches, label rolls loaded (parent tags double the use), printer working, "pickup alerts" printout done, coordinator list for the day, runner named, paper backup in the folder.
12. **Teen and older volunteers:** very large buttons, no free typing where a pick-list will do (reasons, relationships), spoken-friendly code.
13. **First-time families and VBS:** consider a quick pre-registration link (so the line at the desk is mostly returning families); VBS wristbands/class lists are a different pickup model and should be scoped.

## 5. What the plan gets right

- Treats the **cross-family release** (F4/F5) as the first problem, and fixes it by design (pickup sessions) at no cost to speed.
- Unique codes **by construction offline**, not by hope; server never changes a code a parent holds; clear conflict handling.
- **Hard block** for named restricted adults, plus a station-safe note with no details on labels.
- **Never drops a child's check-in**; never deletes history (void/archive); append-only audit.
- Additive migrations, feature flags, old tablets keep working; deploy midweek; rollback story.
- Closes the **"any team leader can open check-in and download every family's medical data"** hole; roster minimisation and purge on unpair.
- Realistic about what cannot be tested (real iPads, printers, iOS reload).
- The plan itself schedules a Church Ops walkthrough and asks for timing in QA.

## 6. Verdict table

| Workflow | Verdict | Taps now > proposed | Simplest fix |
|---|---|---|---|
| Check-in, returning family | Works | 2 > 2 (+1 optional) | Keep "someone else" optional and small |
| Check-in, new family | Works with friction (today's friction) | ~8-10 fields | Offline quick-add; no custody questions at the desk |
| One-time pickup person at check-in | Works with friction | 0 > ~6 + typing | Make optional; prefer standing contacts in the member app |
| Parent tag | Works with friction | n/a | Large `K 7Q3M`; accept with or without space; name on tag |
| Check-out, household adult with tag | Works with friction, breaks at peak | 3 > 5-6 | Pre-tick children, auto-submit, preselect single adult, show photo |
| Check-out, non-household with tag | Will break | 3 > override + phone call | Helper can release with tag + ID; notify after; restrict override to restricted kids |
| ID check | Works with friction | +1 tick when needed | Script + one red "ID doesn't match" button |
| Code clash on sync | Works | n/a | Show family names big; script |
| Lost tag | Will break | 3 > ~8 + coordinator wait | Tiered: household adult + ID + photo match = helper releases |
| "Check first" override | Works with friction | n/a | Two+ approvers, tap-to-call, on-screen "notified at" |
| Do-not-release hard block | Works | n/a | Volunteer script, "alert coordinator" button |
| Restriction setup by staff | Works with friction | 8-10 taps | Quick-add 3-field form; household-level; weekly review list |
| Granting helper/coordinator | Works | admin-only | Add shift "volunteer name" pick; staged `explicit` flip |
| Deploy day and tablet reloads | Works with friction | 10-25 tablets | Visible app version; checklist; keep a legacy fallback tablet 2 Sundays |
| Offline (Wi-Fi drop) | Will break for overrides, new family, lost tag | n/a | Offline coordinator PIN; offline quick-add; paper fallback |

## 7. Top practical changes (also in the reply)

1. Pre-tick children at check-out and auto-submit at 5 chars; preselect the single household adult; show child photo and room large.
2. Tiered lost tag: helper can release to a household adult with ID matching the directory photo; coordinator only for non-household, restricted or mismatch.
3. Do not require override for a non-household person who holds the tag, with ID checked and an unrestricted child; notify after the fact.
4. Per-coordinator offline PIN in scope for approvals; at least two named approvers plus a non-teaching safety runner per campus per service.
5. Paper fallback kit plus a daily printed "pickup alerts" sheet per campus.
6. Offline quick-add for first-time families (Easter/Christmas surge) and an "all campuses" search so visitors do not become duplicates.
7. Keep full medical notes visible on the Rooms screen (do not hide life-critical notes behind "ask a leader"); allergy strip unchanged on labels.
8. Training, laminated quick card, parent signage, and two weeks' notice to families about the 5-character code and the tag; show the app version on the tablet and run a two-Sunday soak with one legacy tablet.

## Handoff

```
Summary: Church Ops review of cs-plan-draft. Safety design is sound; the normal check-out gets ~2x slower
  (3 > 5-6 taps) and lost-tag / non-household pickups route through a coordinator who is usually teaching.
Files: none changed (read-only)
Decisions needed: re-decide D6 (approvers, offline PIN), D10 (medical note visibility), D12 (one-time pickup
  at check-out), D9 (cross-campus visitors); add ops items (paper fallback, training, signage, comms)
Next: chief-architect to revise the plan; ui-ux-specialist to design the check-out card with timing targets;
  security-specialist to review the tiered lost-tag and tag-plus-ID rules
Evidence: read plan, public/js/checkin.js, public/checkin.html, docs/features.md, docs/permissions.md
```
