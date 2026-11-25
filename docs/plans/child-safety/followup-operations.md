# church-operations: answers to Q2 (D5), Q3 (D12), Q4 (D17)
Read-only review, 2026-11-25. Sources: plan.md (3.3, 3.5, 3.12, 6, 8), review-operations.md, public/js/checkin.js, server/routes/checkin.js, server/routes/services.js, server/db.js. Legal and insurance points below are practice norms to confirm with the insurer and attorney, not asserted requirements.

## Facts from the code that drive the answers
- `rooms` has no link to volunteers. `positions` belong to `teams`; `assignments` are (service, position, person, status). A position like "Room 3 Leader" is only a free-text name; nothing ties a position to a `rooms.id`.
- `checkins.kind` can be 'volunteer', but the check-in row has the same `room_id` column and nothing in the Rooms screen (`drawRooms`) sets it for adults. Today the Rooms screen shows allergies AND `medical_notes` to whoever is signed in to the tablet (`k.medical_notes` rendered at checkin.js ~452). Scheduling data is Planning-Center-style "who is serving", entered days ahead, with status pending/accepted/declined.
- So "assigned to the child's room" is NOT knowable from current data. It would be a new thing: a position-to-room mapping, or volunteers checking themselves into a room on Sunday.

---
## Q2. D5: helper releases an unrestricted child to a non-household tag holder (ID check + adult names the child; coordinator told after)

### How common
Very common. At a 200-400 person campus with 80-150 kids, expect roughly 5-15% of pickups on a normal Sunday to be someone other than the parent who checked in: grandparents (the biggest group, especially at multi-campus churches with grandparents bringing grandkids), the other parent who was not in the check-in line (this is household, so Tier A), babysitters/nannies, aunts and uncles, family friends doing a carpool, an older sibling (14-17) collecting a toddler. Rough guess: 3-8 per campus per Sunday, 15-30 at Easter/Christmas. Parents decide by text at 10:45; they rarely pre-register anyone. The parent is usually in the service with the phone silenced.

### What requiring coordinator approval would do
- Each case is 3-10 minutes (find the coordinator, who is also in the hallway/teaching/handling a crisis; call a parent who is in the service). With 5 such cases a Sunday, the coordinator is pulled away 5 times, on top of lost tags, allergies and bathroom incidents. At Easter, 20+ approvals: the coordinator becomes the bottleneck and the line backs up behind a grandparent and a screaming toddler.
- Predictable response: helpers stop using the "someone else" path. They tick "household adult" for whoever shows up, or lend the tag-holder the parent's name. The record then lies. A safeguarding record that is routinely falsified is worse than an honest Tier B.
- Coordinators will start giving blanket verbal approvals ("just let them, I know that family") and stop reading the screen. Approval fatigue erodes the cases where approval matters (restricted children).
- Safety gain from requiring approval is small: a coordinator cannot verify the grandparent either; they have no more information than the helper, except they can phone the parent. The phone call is the only real added check, and it is the one that fails at 10:50 on a Sunday.

### Alternatives, with practical cost
1. Parent adds "Someone else picking up today?" at check-in (already allowed). Best control, because the parent is present and names the person. Cost: 15-25 s and a keyboard at a busy desk. Expect <20% adoption when optional. Do keep it, because it removes the later ID friction for those families, but do not depend on it.
2. Push/notification to the parent ("Ava was picked up by Jane, grandmother"). This is the best post-hoc safety net for a parent: it catches the wrong person within minutes. Plan D20 defers it. Cost: member-app work and the parent must have the app. I would move a simple version (hub message/push, no SMS) earlier. Blocking pickup on "parent confirm" is NOT workable: parents are in worship, do not answer, and the child waits.
3. Minimum age for the person collecting: a good, cheap rule. Suggest 16 and over (18 preferred, but older siblings of 16-17 are real and common; a church that wants 18 should accept that some teen-sibling pickups go to the coordinator). Under 16 (or under the church's chosen age): never a non-household release; they need the parent or coordinator. Easy to apply by eye plus ID.
4. Teen volunteers never release to non-household adults: right, and cheap. Mixed-age helper teams include 13-17 year-olds who cannot judge or challenge an adult. Rule: any helper under 18 can release only Tier A (household adult with tag, photo matches), and calls an adult helper for anything else. Cost: an adult must be within reach at each station; schedule one adult per station at pickup.
5. Tag + child named by the adult before the child is shown + ID look + record name/relationship: this is the plan. Keep, and add one cheap guard: the helper never says the child's name first.

### Recommendation: KEEP D5, with tightening that costs almost nothing
- Keep Tier B for unrestricted children: helper + tag + adult names the child + ID checked + name and relationship recorded + coordinator sees it on Live afterwards.
- Tighten: (a) helper must be 18+ (or any adult helper) for the Tier B release; teen helpers hand off; (b) person collecting must be 16+ (church may choose 18; coordinator for younger); (c) the Tier B record must carry the ID type seen and a mandatory relationship pick-list; (d) coordinator's end-of-service review of that day's Tier B list (2 minutes), with a parent follow-up message for any case the child has told the room leader "I don't know her"; (e) restricted/check-first children stay coordinator-only (already in plan); (f) pull the parent push from D20 earlier as the compensating control.
- Practical cost: mostly an adult being at each pickup station; about +3-5 s on the Tier B path; one short coordinator review per service.
- Weakness to note: the "child names the adult" check does not work for babies and nonverbal/special-needs children; the helper needs the child's room leader to confirm the child recognises the person (watch the child's reaction) as a human signal.

---
## Q3. D12: full medical notes limited to volunteers "assigned to the child's room" vs all kids helpers

### Can "assigned to this room" be reliably known on a Sunday? No.
- No data link between assignments/positions and rooms (see facts above). It would require: (1) a room attribute on positions or an `assignments.room_id`, and scheduling to fill it; (2) volunteers checking in on Sunday ("volunteer" kind, with a room); and (3) a live rule applying to whoever is signed in on a station.
- Real Sundays defeat it even if built:
  - substitutes who were never scheduled (a parent asked at 9:55 to help in 2s)
  - floaters and hallway monitors who cover several rooms by design
  - bathroom runs (a helper walks 2-year-olds to the bathroom; another covers the room)
  - combined rooms at low attendance (summer: babies and 1s together; or two grade groups joined)
  - room changes mid-service (a child moves up, a room fills and kids overflow into another)
  - special-needs buddies who follow one child between rooms
  - Easter/VBS: 2-3x attendance, overflow rooms, borrowed adults
  - scheduled volunteers who do not show, and showed volunteers who were never scheduled
- The tablet roster is per device/station, not per person; helpers in rooms often share one tablet or use paper room lists. Plan's helper accounts are for the check-in desk, not each room helper. A per-person restriction would require every room helper to sign in on a device, which does not happen in a nursery with babies on laps.
- Result of a strict "assigned only" rule: the substitute or floater cannot see that a child has an epinephrine plan, and that is exactly the person least likely to know the child.

### Who actually needs to know
| Who | Needs | Why |
|---|---|---|
| Room leaders and all adults in the room | Full note | They are first responders for a seizure/anaphylaxis. |
| Floaters, hallway monitors, bathroom escorts | Alert + action ("EPI: yes, bag in Room 3 cabinet, call 911 then parent") | They may be the person with the child. |
| Check-in desk | Allergy strip + "MEDICAL: see room" flag; the full note is optional | They hand the label to the room; they confirm the flag. They do not give care. |
| First aid / safety runner | Full note on request, via the room list | Called when something happens. |
| Coordinators | Full note | They call the parent and 911 and brief the responders. |
| Teen helpers (13-17) | Alert and action line, not the full diagnostic note | Minimises exposure of private health data to minors, and they can act on "epi: call adult now". |

### What breaks if the substitute/floater cannot see the epi plan
The child with the severe allergy gets the wrong snack (a donated-snack Sunday), or has a reaction in a hallway with a person who does not know there is an epinephrine pen in the bag. Minutes matter. The cost of leaving the info hidden is a potential death; the cost of over-sharing it with a trained helper at a closed church tablet is a privacy concern that is real but manageable. Church-ops practice: the allergy and the action are on the label and on the room clipboard precisely so ANY adult near the child sees it.

### Recommendation: tier by sensitivity, not by room assignment
- Do NOT gate on "assigned to this room". Gate on role: signed-in helper/leader at the campus (authenticated, trained, background-checked adults), plus the room's printed/clipboard list.
- Split the data (this works within the plan):
  1. **Safety line (all adults serving kids, including floaters, shown on label, room list and any helper's view):** allergy, "EPI-PEN: yes", one-line action ("give epi in thigh, call 911, call parent"), location of meds. Short, mandatory format, entered by coordinators/parents.
  2. **Full diagnosis/history note (private):** room list on a signed-in device for adult helpers and leaders only; hidden from teen helpers; coordinators see all.
- The plan's per-child "print full note on label" for life-critical cases: keep (it is the one place where the label is the safest delivery). Add an expiry (re-confirm each term) so stale notes do not mislead.
- Add cheap accountability instead of gating: log who opened a full medical note (the plan already audits); review monthly; training line "medical details are for care only, never repeated".
- Optional later (not P1): volunteer self-check-in into a room, used only to show "who is in your room now" and for room-leader alerts, never as the access gate.

---
## Q4. D17: retention

### What records churches actually need (practice, not legal advice; confirm retention periods with the church's insurer and attorney)
- **Incident and safeguarding records** (allegation, injury, restricted pickup attempts, "do not release" events, abuse concerns, coordinator notes): the records that matter years later. Allegations of abuse can surface decades after the fact, and many states extend or remove civil limitation periods for child abuse claims; insurers' guidance commonly tells churches to keep these for the life of the church or at least well beyond the child's majority (often "indefinitely" or until a stated period past age 18-21). Plan's "events indefinitely" matches this practice.
- **Attendance and check-in records** (who was in which room on which date, which adult was the helper): in an investigation, "was this volunteer in that room on that date, who else was present, who released the child" is the question asked. Many churches and insurers keep these for many years, and some guidance says indefinitely for children's-ministry attendance. Ministry also uses attendance history (promotion, follow-up, engagement) and for children who are now adults it is mostly low-risk historic data.
- **Volunteer records** (screening, background check dates, training, agreements, scheduled assignments): keep for the length of service and many years after; the volunteer/room schedule is evidence of who was assigned where.
- **Restriction/custody paperwork** (court orders): keep while active, then keep the history of the restriction (who, when, ended by whom) for the long period; keep the sensitive document itself in a locked place with a shorter, attorney-set retention.
- **One-time pickup contacts (phone, relationship):** low long-term value, privacy cost real; purge the phone after a short period but keep name, relationship, ID type, the fact and date of the release.

### What feels intrusive to families
- A stranger's (grandparent's, babysitter's) phone and address kept for years; parents expect it to be removed.
- Medical notes retained after a child ages out or leaves, or visible to staff with no reason.
- Photos of children and of non-member adults kept indefinitely on tablets and in the hub.
- Records on families who visited once and never returned (visitors) kept forever with phone and email.
- Notes about custody disputes visible to the whole kids' team.
- Anything on "who the church thinks the parent is" shown to staff with no role.
Families generally accept: "we keep a safety record of who was checked in and out, for the protection of children, for many years". They react to detail (phones, medical, notes, photos) rather than the log.

### Who should be able to see old records
- Volunteers/helpers: today and the current service only (roster cache already purges day lists; the plan's 7-day TTL for rosters). No history, no past restrictions, no past incidents.
- Room leaders: current-service roster plus the last few weeks' attendance for their own rooms if needed for follow-up; not old incidents.
- Check-in coordinators: 12 months of attendance (the plan's D14), current restrictions and events for their campus.
- Pastor/children's director/safeguarding lead: full event and attendance history, incident notes, with an audit of who looked.
- Admin/IT: access for maintenance, audited; no browsing.
- Insurer, attorney, law enforcement: via the safeguarding lead, as an export on request (not direct system access).

### Recommended practical policy (to be confirmed with insurer and attorney before adoption)
| Data | Keep | Who sees |
|---|---|---|
| Check-in/out events (who, when, room, helper, who released, to whom) | Indefinitely (storage is tiny), append-only | Safeguarding lead and pastor; coordinators 12 months |
| Incident reports and restriction history (without the court document itself) | Indefinitely | Safeguarding lead, pastor, insurer on request |
| Court orders / paper custody documents | While active plus a period set by the attorney; locked paper | Two trained staff |
| One-time pickup person's phone | Purge 90 days (as plan); keep name, relationship, ID type, date | Coordinators |
| Medical notes and allergies | Keep while the child is active; archive when inactive (e.g. 12 months no attendance) and delete the note text after a period the family can request; keep "had an allergy flag" in events only if an incident occurred | Room helpers (per Q3), coordinators |
| Photos of children | Keep while active; remove on family request or after inactivity | Station use for today's families |
| Visitor/guest families who never returned | Contact details minimised after e.g. 12-24 months; keep the check-in event (name, date, room) | Coordinators |
| Volunteer screening/training/schedule history | Length of service plus a long tail (insurer to say) | Safeguarding lead, ministry directors |
| Device caches | Day purge (plan) | Station user |

- Add a **family-facing line** in the first-visit form and the privacy page: what we keep, why, who sees it, how to ask for removal of phone/medical/photo data (the events log stays, which is for child protection).
- Add a **legal hold** switch: when an incident or an investigation opens, suspend any purge for the people involved. Do not purge anything while a claim, subpoena or investigation is pending.
- Annual 15-minute **retention review** by the safeguarding lead with the insurer's loss-control checklist.
- Purge job rule: new data only, explicit owner approval (plan already says so), dry-run count first, log what was purged.

### Recommendation: ADOPT D17 as written, plus these additions
Keep events and attendance indefinitely; purge one-time phones at 90 days (name, relationship, ID type and date stay); add inactivity-based minimisation of phone/medical/photo for lapsed families (set period with insurer); a legal-hold flag; role-based visibility as above; a family-facing explanation. Confirm periods with the church's insurer and attorney before enabling any purge.
