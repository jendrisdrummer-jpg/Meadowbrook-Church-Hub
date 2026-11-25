# Master Product Roadmap: Meadowbrook Church Hub

2026-11-25 · Planning document; nothing here is implemented or approved until the owner says so. This page sets the
**order, phases, release gates and adoption plan** for the whole platform. [roadmap.md](roadmap.md) remains the
**backlog**: item IDs, sizes and gap analysis. Where they differ on order or phase, this page governs; the backlog
records what each item is.

**How this was made:**
- All seven agents (Chief Architect, Product Innovation, Church Operations, UI/UX, Security, QA, Senior Developer)
  reviewed the code, docs, backlog and child-safety strategy independently.
- They then read each other's findings and argued the twelve points where they disagreed.
- This page is the consolidated result; §16 records the disagreements and how each was settled.

**What was verified:**
- `npm test`: 42/42 pass.
- `npm run test:ui`: 168/168 page checks pass. These cover admin, campus staff and volunteer, at desktop and phone
  size.
- Code facts below were checked in the source.
- **Never tested:** real phones (push, email delivery, camera upload, Mux playback on iOS), live Stripe, label
  printers.

---

## 1. Executive summary

**The Hub is further along than a typical "new app".** Staff can rely on these today:
- scheduling with accept/decline from a notification
- order of service and song planning
- team chats that follow the roster
- announcements with push
- tasks
- events
- the member app
- the YouTube-backed Watch tab

The platform is sound for one church.

**What stands between today and a church-wide platform is mostly not features. It is four things:**
1. **Privacy and permissions built for staff, not for a whole congregation.** Two High findings are live today:
   - Leading any team silently makes the person a leader across every campus. That leader can open anyone's full
     record, **including children's medical notes and pastoral notes**.
   - There is no role below "volunteer", and sign-up is open to anyone by default.
2. **Getting people in:**
   - There are no invitations.
   - A new account that isn't linked to a person hits a dead end ("ask an admin").
   - Chat is hidden on phones.
   - Volunteers can't start a conversation.
3. **Scheduling parity with Faith Teams:**
   - **No campus rule for volunteers:** the system has no idea which campuses each volunteer serves, so autofill can
     place someone at a campus they never serve.
   - **No recurring availability:** volunteers can't set regular unavailable times.
   - **No day-of replacement:** nothing helps a leader replace a volunteer who drops out on the day.
4. **Operational trust:**
   - nothing runs the tests automatically
   - no restore has ever been rehearsed
   - every deploy is a short outage
   - one announcement to the whole church can stall the server for seconds

**The recommended path keeps your order:**
1. Communication.
2. Beta.
3. Church-wide.
4. Church management.
5. Media.

**It adds four changes the agents agreed on:**
- **A small "platform readiness" step first.**
- **Phase 1 split in two:**
  - 1a: staff and teams.
  - 1b: members. The privacy work moves up from Phase 4 to here.
- **Scheduling parity moved up** from Phase 4 into Phase 1a. The beta teams (worship and production) are the
  heaviest schedulers.
- **Retirement by job, one team at a time,** rather than switching off a whole product on one date.

**Child-safety Version 1 runs as its own stream throughout.** It is not done until it is implemented, tested,
independently reviewed and verified.

**Realistic dates.** These are not promises: each date moves if its gate isn't met.

| Step | Earliest |
|---|---|
| Staff (about 8 people) start using it | December 2026 |
| Worship and production beta | from 1 February 2027 |
| Wider beta (more teams, then a small group of members) | late February, then April after Easter |
| Church-wide communication rollout | May–June 2027 |
| Google Chat retired | about July 2027 |
| Faith Teams retired | about September 2027 |
| Subsplash replaced | 2028, depending on the Mux cost decision and the contract date |

---

## 2. Long-term product vision
The Hub is the church's operating system: one place where every person is known, cared for and connected. It is
where Meadowbrook communicates, schedules and serves, cares for people, runs ministries and shares its teaching.

It **grows with the church**:
- People start using the parts that are ready.
- Each old tool is retired only when the Hub does that job better for that team.
- Real usage decides what is built next.

It stays a **single-church platform proved at Meadowbrook**. Nothing in this roadmap needs multi-church (SaaS)
architecture. Choices that keep that door open, such as per-church values in `settings` and `campus_id` on new
tables, cost nothing now and are kept.

---

## 3. Current application assessment (verified in code)

| Area | Status | Evidence and what's missing |
|---|---|---|
| People, households, CSV import, duplicates | **Ready** | Tested. Missing: saved lists (H7), household merge (M1) |
| Sign-in (Google, email code, password) | **Works, needs improvement** | Missing: invitations; linking a new account to the right person; offboarding ("sign out everywhere"). Sign-up defaults to **anyone** |
| Roles and permissions | **Built, needs security work** | **High:** auto-leaders get church-wide access to people records, including medical and pastoral notes (`routes/teams.js` ~139, `routes/people.js` ~108). **High:** no member tier. Any account sees who serves where, with photos, kids' teams included (`routes/services.js` ~114) |
| Member directory, self-service profile | **Not built** | Staff-facing only. `PATCH /me` changes only the theme |
| Announcements | **Ready** | Audiences, scheduling, push, guests. Missing: campus-scoped audiences for campus-limited announcers (Security M4), a delivery log |
| Push notifications | **Works, needs reliability work** | Fan-out is synchronous and unbatched, with no retry or delivery log (`notify.js`). Signing out leaves the device subscribed. Lock-screen previews show message text. iPhone push needs the home-screen app; untested on real devices |
| Chat | **Works, needs improvement** | Membership checks are sound. Volunteers can't start chats or direct messages (`POST /chats` needs leader). No search. No safeguarding: edits and deletes destroy the original, and there is no report or block. Video calls use Daily, which has a monthly minute cap |
| Tasks | **Ready** | Tested |
| Teams and positions | **Works, needs improvement** | Shared teams supported (`campus_id` empty = church-wide). No ministry layer (M8) |
| Services, planning, order of service, songs | **Ready** | Strongest Faith Teams replacement. Bulletin and run sheet not built (S4) |
| Scheduling: requests, accept/decline, reminders, drafts | **Ready** | Tested |
| Scheduling: conflicts, availability, autofill | **Works, needs improvement** | One-off away dates only. No recurring availability (H3), no day-of replacement (H1), no swaps (H2) |
| Scheduling rule (campuses) | **Partial** | See §9.1 |
| Attendance and roll call | **Works, needs improvement** | No roll-call-only permission (H4); trends thin (H8) |
| Kids' check-in | **Built, needs security and reliability work** | Child-safety V1 ([v1-strategy.md](plans/child-safety/v1-strategy.md)) |
| Events and sign-ups | **Works, needs improvement** | No repeat, `.ics` feed or room conflicts (H10) |
| Giving and finance | **Works, needs improvement** | Tested against a Stripe stand-in only. Missing: counting close, household statements (M2–M4) |
| Member app and App Builder | **Ready** | Smoke-tested. Workflows not browser-tested |
| Onboarding and first run | **Partial** | Unlinked accounts hit a dead end. No first-run flow. Chat is under More on phones. More page cluttered |
| Media (YouTube library, Watch, live detection) | **Ready** | Tested |
| Mux streaming, uploads, podcast | **Built, unproven** | Tested with stand-ins only. Needs the church's account and the owner's cost decision |
| Care: follow-up, prayer, pastoral notes, small groups | **Partial / not built** | Connect cards and lists exist. C6, H11, C4 and C5 not built |
| Group email / "message people" | **Not built** | H6. Needs an email-provider decision |
| Backups | **Works, needs verification** | Encrypted, Drive copy, round-trip tested. Production configuration and a restore drill not confirmed |
| CI, monitoring, deploys | **Not built** | No CI; no uptime or error alerts; deploys cause a brief outage |
| Accessibility | **Needs an audit** | Focus styles thin; the design-system checklist is not verified |

**Technical debt confirmed or found** (to be added to [tech-debt.md](tech-debt.md) in a follow-up docs PR):

| Item | Severity |
|---|---|
| Auto-leader church-wide access | High |
| No member tier | M |
| Synchronous push fan-out | M |
| Deploy outages with no deploy window | M |
| No uptime or error monitoring | M |
| Rate limiting copied in six files | — |
| Backup memory use about 3× the database size | L–M |
| Notification and audit tables never pruned | L |
| Session tokens stored unhashed | L |
| `MB_BACKUPS` vs `MB_BACKUP_DIR` mismatch in the Dockerfile | L |

**Already sufficient; don't rebuild:**
- Planning
- Scheduling core
- Team chats
- Announcements
- Tasks
- Events core
- App Builder
- Design system
- YouTube media
- Backups mechanism

---

## 4. The rollout strategy (your five phases, refined)

| Phase | Your intent | What the agents changed, and why |
|---|---|---|
| **0. Platform readiness** (new, small) | — | CI, a backup restore drill, a deploy window, an uptime check, push hardening and the settings fixes. Cheap, and it makes everything after it safer. It is the gate for the worship and production beta |
| **1a. Staff and teams** | Replace Faith Teams and Google Chat for staff and team work | **Privacy and permissions:** the interim privacy fix comes first. **Scheduling parity:** campus eligibility and day-of replacement are moved up from Phase 4. **Getting in:** invitations and onboarding fixes; Chat reachable on phones. **Measuring use:** an adoption view and a feedback route |
| **1b. Members** | Member accounts, profiles, directory, member app | **Permissions:** the member tier and team-scoped leader access (C4) move up from Phase 4, because a directory without them exposes people. **Directory and profile:** opt-in, adults only. **Messaging:** adult direct messages with minimal safeguarding; group email (H6); recurring availability (H3). **Security Mediums** |
| **2. Beta** | Selected teams, real use | Runs **across** 1a and 1b in waves: staff now, worship and production in February, more teams, then a few members after Easter (§10) |
| **3. Church-wide communication** | Everyone | After Easter. Needs a minimal follow-up inbox (C6), training and support. Kids' volunteers join only after child-safety V1 is verified |
| **4. Church-management maturity** | Make management excellent | Unchanged in spirit. It loses the items moved up and gains child-safety V2 slices. Faith Teams retires here, by evidence |
| **5. Media and Subsplash** | Only after management is strong | Mostly a **verification and cost decision**, since the Watch tab already works. Then the genuine gaps (§9.4). Research can start now, at no cost |

---

## 5. Product development roadmap

Effort is **agent-assisted team hours** (development, tests, security review, docs). Human-pace estimates are about
2–2.5× these. The owner's review time is extra and is the real bottleneck: about 15–25 hours a month.

### Stream A: Child-safety V1 (runs December to late January)
See §7. **205–240 h.**

### R0: Platform readiness (December) · Must-have · 31–44 h
| Item | h | Done when |
|---|---|---|
| CI: GitHub Actions running `npm test` on every PR (H12), plus the friendly no-access page | 4–8 | Every PR shows a check; a failing test blocks merge (branch protection needs your go-ahead) |
| Backup restore drill and written procedure | 6–8, plus owner time | A real backup restored to a scratch instance, result recorded in [testing.md](testing.md) |
| Deploy window (no deploys from Saturday evening to Sunday afternoon) and a "deploying" notice | 4–6 | Written in [development.md](development.md) and followed |
| Uptime check and error alerting | 4–6 | A free external check, needing your approval, plus in-app error logging |
| Push hardening: batched, queued fan-out with retries and delivery counts | 14–20 | An announcement to 1,500 devices doesn't stall check-in; a test proves batching |

### R1a: Staff and teams (December to January; lands by early February) · Must-have · about 80–115 h
| Item | h | Depends on | Done when |
|---|---|---|---|
| **Interim privacy fix (Security H1):** medical notes, pastoral notes and pickups hidden from anyone below staff; auto-leader accounts get their team's campus | 10–14 | Child-safety PR 2 (shared `people.js`) | A test proves an auto-leader sees no medical or notes fields and gets 403 on another campus |
| Sign-out removes the device's push; previews can be hidden (Security M3) | 6–8 | R0 push work | Test |
| Audit entries for leader grants and sign-ins (Security M6, part) | 6–8 | — | Test |
| **Per-volunteer campus eligibility** (§9.1) | 24–32 | Child-safety PR 2 (assignment trigger) | Candidates and autofill never offer an ineligible volunteer; schedulers see why; tests |
| **Day-of replacement (H1):** on a late decline, the leader is pushed suggestions and an "open spot" appears in the team chat | 8–12 | Eligibility | Test plus beta use |
| Onboarding fixes: Chat reachable in one tap on phones, More page tidied, a one-page "how to" per role, an in-app feedback link | 12–16 | — | UI check at phone size |
| Real-device matrix: push on iPhone (home-screen app) and Android, email codes in Gmail and Outlook, camera upload | 16–24 (people time) | — | Results recorded in [testing.md](testing.md) |

### R1b: Members (February to April) · Must-have before church-wide · about 220–310 h
| Item | h | Done when |
|---|---|---|
| **One permission change set**, designed once with child-safety PR 3's check-in access flag and reviewed once by Security: <br>• a **member tier** below volunteer, and the sign-up default (H2) <br>• **team-scoped leader access and private pastoral notes (C4)** <br>• optionally campus-scoped team leadership | 44–60 | Permission tests per role and campus; your approval (CLAUDE.md rule 7) |
| Account linking that can't attach the wrong person; merge guard (Security M1) | 8–12 | A merge returns 409 when the duplicate has its own account |
| **Invitations and linking:** bulk invite from People; the invite link pre-fills the person; exact-email match links automatically; anything else goes to an admin queue with a "we're checking" screen | 30–45 | A new member lands linked, in the common case with no admin step |
| **First-run flow:** confirm name and phone; turn on notifications (with the reason); find your team chat. Plus an accessibility pass | 20–30 | Works on iPhone, including add-to-home-screen; accessibility checklist recorded |
| **Adult direct messages:** both people adults by birthdate or confirmed by staff, and sharing a team or campus; edits and deletes keep the original for a safeguarding role; Report and Block | 26–36 | Permission change approved; tests |
| Message search | 8–12 | Search only shows chats you belong to |
| **Opt-in directory and self-service profile (M9):** adults only, per-field opt-in, household consent, children excluded, no phone search, "what others see" preview | 16–24 | Test that children never appear |
| **Group email / "message people" (H6):** team, list, campus; delivery log | 24–36 | Needs your email-provider decision |
| Recurring availability honoured by autofill (H3) | 16–24 | Test |
| Security Mediums: campus-scoped announcement audiences (M4), sign-out-everywhere and offboarding (M7), per-account chat and upload limits (M8) | 18–24 | Tests |
| Quiet hours (M7 backlog) and an adoption view (who's signed in, push on, unlinked) | 12–18 | Used in the wider beta |

### R2: Church-wide communication (April to June) · about 40–60 h, plus operations time
- **Minimal follow-up inbox (C6):** owner, state, due date, Monday push.
- **Training and support material:** phone card, FAQ, sign-in help page, help chat.
- **Fixes from the beta.**

### R3: Church-management maturity (May 2027 onward) · about 260–370 h, plus child-safety V2 at 150–200 h
In priority order. Exact order to be confirmed at each step from real use.

| # | Initiative | Effort (h) | Why |
|---|---|---|---|
| 1 | Clearance-gated kids' and youth scheduling (C3) | M | Builds on the check-in access flag |
| 2 | Small groups (C5) | 56–80 | A Faith Teams retirement blocker **if** Meadowbrook uses groups there |
| 3 | Full follow-up (C6) and prayer requests (H11) | 46–64 (with minimal C6) | Care is the main reason pastors would feel the Hub falls short |
| 4 | Swaps and open spots (H2) | 40–56 | — |
| 5 | Reports (H8, M10) | 24–36 | Pastor's Monday view, fill rate |
| 6 | Events: repeat, `.ics`, rooms (H10) | 28–40 | — |
| 7 | Ministries above teams (M8) | 24–32 | — |
| 8 | Giving: counting close, household statements, pledges (M2–M4); live Stripe verified | 40–60 | — |
| 9 | Roll-call-only permission (H4); grade rollover (H5); duplicate prevention at check-in (M1) | M each | — |
| 10 | Child-safety V2 slices, alternating with the above | 150–200 | See [revision-3.2.md](plans/child-safety/revision-3.2.md) |

### R4: Media and Subsplash replacement (from about Q4 2027) · about 100–150 h
1. **Verify Mux end to end** on the church's real account: live, uploads, podcast, playback on iOS. 8–12 h, needs your
   cost approval.
2. **Library organisation:** series, speakers, topics, discovery, links to events and ministries. 32–48 h.
3. **Livestream hardening.** 20–30 h.
4. **Public watch page and embeds.** 24–36 h.
5. **Sermon notes and new-message push.** 16–24 h.
6. **Podcast directory submission** (an owner task).

---

## 6. Adoption and migration roadmap

| When (earliest) | Who starts | What they move | What must be true first |
|---|---|---|---|
| **Now** | — | Nothing yet. Owner settings fixes (§15) | — |
| **December** | **Wave 0:** about 8 staff (lead pastor, executive pastor or administrator, campus pastors, one office staffer) | Staff chat and tasks | Sign-in policy **directory or invited**. Auto-leader accounts reviewed. Backups confirmed running, plus one restore drill. Deploy window. Named bug intake |
| 19 Dec – 3 Jan | — | **Freeze:** no new people, no training (Advent, Christmas) | — |
| January | — | Child-safety V1 goes live; soak Sunday about **24 January**. No beta onboarding that week | §7 |
| **From 1 February** | **Wave 1:** worship and production teams (about 25), plus 1–2 low-risk teams such as hospitality or greeters (adults) | **Their scheduling and plans move off Faith Teams.** Their team chat moves off Google Chat | R0 done (CI, restore drill, push hardening). Interim privacy fix live. Campus eligibility and day-of replacement live. Device matrix passed. Not in the soak week |
| late February – mid March | **Wave 2:** 2–3 more volunteer teams (adults; not kids' teams) | Scheduling and team chat | Wave 1 meets the go/no-go measures (§10) |
| mid March – 4 April | — | **Freeze:** Holy Week and Easter (28 March) | — |
| **April** | **Wave 3:** 20–40 members (mixed ages, iPhone and Android); kids' volunteers, now that V1 is verified | Member app, announcements, messages | R1b's member tier, team-scoped leaders, directory consent and adult DMs live. Security review passed. Kids' volunteers trained on V1 |
| **May – June** | **Church-wide**, team by team, then members by campus, with a champion per ministry | Everything in the Hub for communication | No open High security findings. Wave 3 stable for 3 weeks. Minimal follow-up inbox live. Support rota named. Not in the same weeks as a child-safety change |
| **about July** | — | **Google Chat retired** (§11) | Criteria in §11 |
| **about September** | — | **Faith Teams retired** (§11) | Criteria in §11. Avoids the fall launch season |
| **2028** | — | **Subsplash replaced** (§11) | Phase 5 done, plus the contract date |

**Rules for the transition:**
- **One source of truth per job.** On a team's switch date, that job moves to the Hub and the old tool becomes
  read-only for that team. Running two systems in both directions is what burns volunteers out.
- **Ask for one new habit at a time.** Accepting a schedule request comes first, then chat, then everything else.
- **No migration during Advent, Christmas, Holy Week or Easter**, and none in a child-safety change week.
- **Don't migrate chat history.** Export and archive it, and keep the old spaces read-only for 6–12 months. Say this
  out loud so nobody feels they'll lose anything.

---

## 7. Child-safety Version 1 integration
- **What it is:** the strategy in [v1-strategy.md](plans/child-safety/v1-strategy.md), in PR #49.
  - **Approving PR #49 approves the plan; it implements nothing.**
  - V1 is complete only when all six PRs are implemented, the tests are green, Security has independently reviewed
    it, and the dress rehearsal and soak Sunday are verified.
  - Its security requirements are unchanged.
- **Timing:** Stream A, December to about 26 January:
  - PR 1 live 6 December; PR 2 live 13 December.
  - PRs 3–5 in January.
  - Dress rehearsal and soak about 24 January.
- **What runs alongside:** one other stream at most, kept off the check-in files. R0 and R1a are planned that way.
- **What must be sequenced** (hot files):
  - `people.js`: child-safety PRs 2 and 3, then the interim privacy fix, then account linking, then the directory last.
  - `teams.js` and `auth.js`: child-safety PR 3, the member tier, C4 and offboarding, designed as **one permission
    change** and reviewed once.
  - `services.js`: campus eligibility, then H1 and H3, all after child-safety PR 2.
  - Check-in files: child safety only until V1 is live.
  - **Migrations:** numbers are claimed in merge order, and each is rehearsed on a restored backup.
- **What it gates:**
  - Kids' volunteers and parents join only after V1 is verified (April).
  - The church-wide step needs V1 verified.
  - Faith Teams retirement doesn't depend on V1, since check-in is already in the Hub.
- **Afterwards:** the full plan ([revision-3.2.md](plans/child-safety/revision-3.2.md)) stays the reference for V2/V3.
  V2 slices alternate with Phase 4 work.

---

## 8. Feature prioritisation

| Category | Items |
|---|---|
| **Must-have before wave 1** | R0; the interim privacy fix (H1); sign-out push and previews (M3); audit entries; campus eligibility; day-of replacement; onboarding fixes; device matrix |
| **Must-have before church-wide** | Member tier and C4 (one change set); account-linking guard; invitations and linking; first-run flow and accessibility pass; adult DMs with minimal safeguarding; message search; opt-in directory; M4, M7, M8; minimal C6; training and support; child-safety V1 verified |
| **Must-have before retiring Faith Teams** | Recurring availability (H3); group email (H6); a full scheduling cycle at every campus; small groups (C5) **if** used there; follow-up (C6) |
| **Important** | Quiet hours; adoption view; swaps (H2); reports (H8, M10); events (H10); prayer (H11); clearance scheduling (C3); ministries (M8); giving workflows (M2–M4) |
| **Future** | Bulletin from the order of service (S4); "serving this week" card (S5); discipleship and classes (L1, L2); per-child event registration (L3); SMS (L5, paid); public website and embeds; sermon notes; Faith Teams and Subsplash importers (L4); multi-church |
| **Already sufficient** | Planning and songs; scheduling core; team chats; announcements; tasks; events core; App Builder; design system; YouTube Watch tab; backups mechanism |

---

## 9. Dependencies and technical considerations

### 9.1 The scheduling rule
**Your rule:** teams can be shared across campuses; each volunteer has their own campus eligibility; schedules stay
separate per campus, service, date and time.

**Already true:**
- Schedules are per service, and each service has a campus and a start time.
- Teams can be church-wide.
- Double-booking is caught across campuses.

**Missing:** volunteer eligibility. Nothing records "this person may serve at North"; `people.campus_id` is only a
home campus, and candidates and autofill ignore it.

**Plan:**
- **New table:** `serving_campuses(person_id, campus_id)`, with an optional per-team override.
- **Scheduling:** candidates and autofill skip ineligible people. A manual assignment shows a warning that staff can
  override. Schedulers see why someone is excluded, so it doesn't look like a bug.
- **Your decision: what an empty list means.**
  - "Home campus only" (recommended): safe, but needs a one-time setup for people who serve at two campuses.
  - "Any campus": changes nothing on day one.
- **Later:** campus-scoped team leadership (a North worship leader schedules only North), as part of the permission
  change set.

### 9.2 Architecture
- **Fit:** SQLite on one Render service is well within limits for 1,000–2,000 people.
- **Real constraints:**
  - The single process blocks during big push fan-outs (fixed in R0).
  - Deploys briefly drop the service and live chat (deploy window).
  - Backups use memory of about 3× the database size (watch it as chat grows).
- **No re-architecture is recommended.**

### 9.3 Cost
- **No paid service is required by this roadmap.**
- **Your decisions:**
  - **Email provider for H6:** several have free tiers.
  - **Uptime check:** free.
  - **Mux:** paid per minute. Pricing pages disagree, so verify on mux.com before budgeting. The risk is archive
    storage and viewer delivery. Keep YouTube as the live path until real minutes give a cost estimate.
  - **SMS:** paid; future only.
  - **Video calls:** keeping Google Meet beside the Hub avoids the Daily minute cap at no extra cost.

### 9.4 Subsplash: what replacing it takes
Research by Product Innovation, from the App Store listing, Subsplash's site and Capterra reviews. Pricing is
quote-only, so confirm what Meadowbrook actually pays and uses.

- **Already covered by the Hub:**
  - member app
  - events
  - giving
  - push
  - Watch and live
- **Built but unproven:** podcast feed, Mux live and uploads.
- **Genuine gaps:**
  - **Discovery:** app-store presence. Members can't find a web app in the App Store; a native wrapper is a separate,
    later decision.
  - **Website:** a website or embeddable Watch page.
  - **Sermon notes.**
  - **Podcast:** submission to the podcast directories.
- **Offline listening:** confirm whether it is used.

---

## 10. Beta testing and launch strategy
- **Participants:**
  - Waves as in §6.
  - A **named champion per team**, who gets early access and a 30-minute briefing.
  - Mixed ages and both iPhone and Android in every wave.
  - No kids' volunteers until V1 is verified.
- **Onboarding:**
  - A personal invite from the team leader, not a bulk email.
  - A 3-step phone card: install the app, turn on notifications, accept your first request.
  - A 20-minute walkthrough per team.
  - **Check iPhone install and push on day one;** this is the most common failure for older volunteers.
- **Feedback and bugs:**
  - **Where to report:** a "Hub feedback" chat in the Hub (it tests chat too), plus the in-app feedback link.
  - **What to capture:** each report gives the role, the device and the steps.
  - **Severity:** "blocks church use" (fix in 1–2 days or roll back), "annoying" (next release), "cosmetic" (batched).
    Anything touching permissions, giving or kids' safety is treated as high.
  - **Triage:** weekly, by one named person. Every fixed bug ships with a test.
- **Adoption measures** (shown in the adoption view, or counted by hand until it exists):
  - share of invited people signed in
  - share with push on
  - schedule requests answered in the Hub within 48 hours
  - messages in the Hub vs the old tool
  - "how do I" questions per week
  - a one-question Friday pulse: "Did the Hub save you time this week?"
- **Go/no-go to widen each wave.** You set the final numbers; suggested:
  - at least 80 % of the wave signed in
  - at least 70 % of requests answered in the Hub
  - push working for at least 90 % of those who enabled it
  - two consecutive Sundays scheduled entirely in the Hub
  - zero data-loss or wrong-person incidents
  - no open "blocks church use" bugs
  - CI green and the restore drill done
- **Launch (church-wide):**
  - Team by team, then members by campus.
  - **Support:** a help desk person and help chat, and office hours before and after services for the first month.
  - **Tone:** never a single "launch Sunday".

---

## 11. Platform retirement criteria
Each needs **all** of its criteria, at least **4 weeks of overlap**, an **archive** of the old data and a way back
during the overlap.

**Google Chat** (first, about July 2027):
- Every team and staff space is active in the Hub for 4+ weeks.
- Adults can start direct messages.
- Message search works.
- Push is proven on both platforms.
- A video-call decision has been made (Meet kept, or Daily within its cap).
- A Takeout export is archived, and the old spaces are read-only for 6–12 months.

**Faith Teams** (about September 2027; switched off team by team as each meets the rule from February):
- Every campus scheduled in the Hub for **8 consecutive weeks**, including a full cycle (request, accept, decline,
  replace), with fill rate no worse than before.
- Campus eligibility in use, with zero wrong-campus placements.
- Recurring availability live.
- People and household data checked against Faith Teams counts, with an encrypted export archived.
- Group email (H6) and follow-up (C6) live, or their absence accepted by you.
- Small groups handled (C5), or confirmed not used in Faith Teams.
- A restore drill within the last quarter.

**Subsplash** (2028, after Phase 5):
- Mux verified on real devices, or a YouTube-only path accepted.
- Live tested in a real service.
- The sermon archive complete.
- The podcast live in the directories.
- Giving proven with live Stripe, and recurring donors moved with notice.
- App-store presence decided.
- Website and embeds replaced or accepted.
- Members' existing links redirected.
- Retirement timed to the contract renewal date.

---

## 12. Estimated effort and timeline

| Release | Agent-assisted hours | Calendar (earliest) |
|---|---|---|
| Child-safety V1 (Stream A) | 205–240 | Dec – late Jan |
| R0 Platform readiness | 31–44 | December |
| R1a Staff and teams | 80–115 | Dec – early Feb |
| R1b Members | 220–310 | Feb – April |
| R2 Church-wide | 40–60, plus operations | April – June |
| R3 Church-management maturity | 260–370, plus child-safety V2 at 150–200 | May 2027 onward (6–9 months) |
| R4 Media | 100–150 | from about Q4 2027 |
| **Path to church-wide** (V1 + R0 + R1a + R1b + R2) | **about 575–770** | **about 6–7 months** |

**Assumptions behind the calendar:**
- one main stream plus child-safety V1
- about 60–80 productive main-stream hours a month after review time
- the owner reviews 2–3 PRs a week
- the freezes in §6

**What happens if those assumptions slip:**
- **If group email (H6) and the full follow-up inbox must come before church-wide,** church-wide slips about a month.
- **If you can review faster,** the build can go a little faster. Beta waves and the overlap periods can't.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Live privacy exposure (auto-leaders see medical and pastoral notes) | Settings fixes today (§15); interim fix as the first small PR |
| iPhone push unreliable (needs the home-screen app), so people drift back | Device matrix in R1a; day-one install check; email fallback (H6) |
| Running two systems too long burns volunteers out | One source of truth per job; fixed switch dates per team |
| A permission change locks out a kids' director or a leader | Named grants before switching; tests per role; your approval |
| Migration collisions between streams | Hot-file order (§7); migration numbers in merge order; rehearsal on a restored backup |
| Single owner and developer (key-person risk) | Docs and agent team; CI; written procedures (restore, deploy, offboarding) |
| Change fatigue in ministry leaders who also run Advent and Easter | Waves avoid the seasons; one habit at a time; champions paid in attention, not work |
| Push storm or deploy outage on a Sunday | Push hardening; deploy window; uptime check |
| Wrong person linked to an account (giving, chats) | Invitations; exact-match linking only; merge guard |
| Mux or Subsplash costs unknown | Trial and verification spike before any commitment; YouTube fallback |
| Phase 4 scope creep delays Faith Teams retirement | Retirement criteria list only what Meadowbrook uses |
| Advent and Easter calendar pressure | Freezes in §6 |

---

## 14. Decisions requiring your approval
1. **This roadmap.** Approve the order, the 1a/1b split, scheduling parity moved up, and C4 and the member tier
   moved up.
2. **Today, in Settings (no code):** the sign-in policy and the leader-account review (§15).
3. **The interim privacy fix (Security H1)** as the first small PR after child-safety PR 2. It is a consequential
   security change (rule 7).
4. **Child-safety V1 (PR #49).** Merging it approves the plan only.
5. **The combined permission change** (check-in access flag, member tier, team-scoped leaders, optional
   campus-scoped leadership): approve the design when it is presented.
6. **Adult direct messages** with the stated conditions (a permission change).
7. **Campus eligibility:** what an empty list means; per-team overrides.
8. **Free outside services:** an email provider for H6; an uptime monitor; CI branch protection.
9. **Mux:** approve a verification spend, or stay YouTube-only for now. Video calls: keep Google Meet.
10. **Deploy window and freeze dates:** Advent 19 Dec – 3 Jan; Holy Week and Easter mid March – 4 April.
11. **Beta:** wave 0 names, team champions, go/no-go numbers.
12. **Policies:**
    - an age policy for accounts (for example none under 13, and teens only in supervised groups)
    - whether staff may read team chats, and telling members
    - chat retention
    - how long to keep the old systems' archives
13. **Facts we need from you:**
    - which Faith Teams features Meadowbrook really uses (groups? email? follow-up?)
    - what Subsplash is used for
    - **contract renewal dates** for Faith Teams and Subsplash

---

## 15. Recommended immediate next steps
**This week, no code. You, in the hub and on Render:**
1. **Settings → Sign-in:** set the policy to **directory**, or **invited**. Never "anyone".
2. **Settings → Accounts:** review every leader account.
   - Set a **campus limit**, or **deactivate** accounts that don't need the hub.
   - Changing someone back to volunteer by hand **does not stick**: the next roster change promotes them again. Use a
     campus limit or deactivation.
3. **Leader ticks:** only tick "leader" on teams where scheduling truly needs it.
4. **People "notes":** stop writing pastoral matters in the People `notes` field. Don't bulk-delete without a backup.
5. **Render:** confirm `MB_DEV_LOGIN` is unset, and that `MB_TRUST_PROXY=1` and `MB_BACKUP_PASSWORD` are set.
   Confirm nightly backups reach Drive.
6. **Send us the facts** in decision 13.

**Then, once you approve** (each as its own PR with your merge):
1. Merge PR #49, then child-safety PR 1.
2. **R0:** CI (H12) and the restore drill.
3. **The interim privacy fix (H1)**, after child-safety PR 2.
4. **Wave 0:** about 8 staff, in December.
5. **Chief Architect:** design the combined permission change and `serving_campuses`, for your approval in January.
6. **Docs:** a follow-up PR adds the new debt items to [tech-debt.md](tech-debt.md).

**Nothing is implemented until you approve it.**

---

## 16. Agent findings and how the disagreements were settled

| # | Question | Positions | Settled as |
|---|---|---|---|
| 1 | When does the permission work happen? | You: C4 in Phase 4. Security: interim fix first, member tier and C4 before church-wide. Architect and QA agreed. Developer: design check-in flag and C4 together | Interim fix first (small PR); one permission change set in R1b, before any directory or church-wide step |
| 2 | Scheduling parity | Architect, Developer, Operations: before the beta. Product: H3 later (conceded) | Eligibility and day-of replacement before wave 1; H3 before Faith Teams retires |
| 3 | Care and group email | Operations: Phase 1 (then conceded C6 can follow the beta). Product: minimal version | H6 in R1b; minimal C6 before church-wide; full C6 and prayer in Phase 4; no pastoral content in the Hub until C4 |
| 4 | Which system retires first | Product, Architect, QA: Google Chat. Operations: Faith Teams for worship and production first, because volunteers can't start chats yet | **By job and team:** worship and production stop scheduling in Faith Teams from February. As whole products, Google Chat retires first (once adult DMs, search and push are proven) and Faith Teams last |
| 5 | Child-safety V1: parallel or a gate? | Product, Developer, Security: parallel. QA: a gate. Operations: separate in people's calendars | Built in parallel; gates kids' volunteers and the church-wide step; no beta onboarding in its soak week |
| 6 | Beta timing | Operations: staff now. Developer and Architect: teams from February. QA: a full gate only for the team beta | Wave 0 staff in December; wave 1 from 1 February; members after Easter |
| 7 | Sign-in policy | UI/UX: open eases adoption (conceded). Security: directory or invited | Directory or invited from now on, with invitations; never "anyone" |
| 8 | Directory in Phase 1? | You: Phase 1. Security, Product, UI/UX, QA: after the member tier and C4 | R1b, opt-in, adults only, after the permission change set |
| 9 | Volunteer DMs | Product and UI/UX: early. Security: after safeguarding, then conceded adults-only with conditions | Adult DMs in R1b with kept originals and Report/Block; groups with teens wait for full safeguarding |
| 10 | Platform readiness step | Architect and QA: yes. Developer conceded | R0, the gate for wave 1 |
| 11 | Media | Architect: mostly verification. Product, QA: start Mux verification early | Research now at no cost; Mux spike only with your cost approval; the build after Phase 4 must-haves |
| 12 | Capacity | All: your Phase 1 can't fit one stream | Split into 1a and 1b; 1b items slide first if needed |

**Honest dissent recorded:**
- Church Operations would still prefer group email and a basic follow-up inbox before the wider beta.
- QA wants more QA time than the estimates allow for child-safety V1.
- Security considers the member tier non-negotiable before any member joins.
- The Developer warns that church-wide becomes about May–June, not April, if R1b's full list is required first.
