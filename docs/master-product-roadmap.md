# Master Product Roadmap: Meadowbrook Church Hub

Revision 2 · 2026-11-25. Planning document only: nothing here is implemented or approved until the owner says so.

This page sets the **order, stages, release gates and adoption plan** for the whole platform. [roadmap.md](roadmap.md)
remains the **backlog** (item IDs, sizes, gap analysis); where the two differ on order or stage, this page governs.

**Revision 2** re-centres the plan on the owner's direction of 2026-11-25: build **a better Faith Teams first**, put
it in the hands of staff and ministry team leaders, and let real use shape what follows. Becoming a Planning Center
alternative is the long-term aim, not the first target.

**How this was made**
- All seven agents (Chief Architect, Product Innovation, Church Operations, UI/UX, Security, QA, Senior Developer)
  evaluated the strategy independently, verified their claims against the code where possible, then challenged each
  other on ten contested points. §17 records the outcome.
- `npm test` passes 43/43 on the interim-privacy branch, and `npm run test:ui` passes 168/168 page checks.
- Never tested on real devices: phone push, email delivery, Mux, live Stripe, printers.
- **Limit on the Faith Teams research.** This session's network policy blocked faithteams.com, Capterra and Planning
  Center's help site, so the Faith Teams column below rests on search summaries (medium/low confidence). **What
  Meadowbrook actually uses in Faith Teams, confirmed by the owner, overrides every "likely" in this document.**

---

## 1. Executive summary

**Strategy**
- **Stage 1, Better Faith Teams:**
  - the workflows Meadowbrook uses today, done better
  - for staff and ministry team leaders, with their volunteers answering requests by app or by email link
  - reliability, security and confidence first
- **Stage 2, Better Meadowbrook:** built from what leaders and members tell us.
- **Stage 3, Planning Center alternative:** expanded only where there is a clear reason and a sustainable plan.

**What this changes from revision 1**
- **Members leave the critical path.** The member tier, member directory, adult direct messages, church-wide group
  email, member first-run and quiet hours move to Stage 2. That works because volunteers can already accept or
  decline from email links without an account, and team-sized email already works over the existing SMTP.
- **What fills Stage 1 instead.** The weekly scheduling loop leaders actually run:
  - right-campus scheduling
  - reminders and nudges
  - same-day replacement
  - messaging their team
  - a real feedback loop
- **Parity-only items.** Small groups, forms, guest follow-up, team email and giving are built in Stage 1 **only if**
  the owner confirms Meadowbrook uses them in Faith Teams today.

**What does not change**
- Children's safety (child-safety V1, PR #49) stays separate and non-negotiable.
- Privacy fixes come first.
- Old systems retire per ministry, by workflow, after real parallel use. Never by date.

**Realistic expectation** (not the fastest case):

| Milestone | When |
|---|---|
| Staff start using it | December |
| Worship and production schedule in the Hub | mid-February 2027 |
| Faith Teams parity for the core workflows | about May |
| Parity including any confirmed groups, forms and follow-up | about June |
| Pessimistic case | August–September |

Ministries leave Faith Teams one by one as each meets its own criteria (§9). Your review time, about 4–6 hours a
week and 8–10 in December–January, is the real pace-setter.

---

## 2. Approval boundaries
- **PR #49** approves the child-safety V1 **plan** only. Each of its six PRs needs its own review and merge, and V1 is
  done only when implemented, tested, independently reviewed and verified.
- **PR #50 (this document)** approves the **planning direction** only. It authorises no feature.
- **PR #51** (interim privacy fix) is the only code awaiting approval.
- **Everything else:** every other item is built only after its own plan or PR is approved. Permission, sign-in and
  security changes always need the owner's explicit approval (CLAUDE.md rule 7).

---

## 3. Privacy first: the live exposure and what closes it

**Facts verified in code**
- Anyone made a leader of any team gets leader access automatically.
- Today a leader can read anyone's allergies, medical notes, private (often pastoral) notes and pickup list on their
  person page.
- Any leader can also open the check-in roster, which is **church-wide**: every child's allergies and medical notes,
  and every family's pickup list.
- Sign-up is open to anyone by default.

| Step | What it closes | Still open afterwards |
|---|---|---|
| **Owner settings today:** sign-in policy **"Only accounts an admin adds below" (invited)**; review every leader account (campus limit, or untick "Can sign in": deleting or demoting doesn't stick); only tick team "leader" where needed; profile-field visibility; no pastoral text in People notes; confirm `MB_DEV_LOGIN` unset | Strangers and members can no longer create new accounts. Fewer leader accounts exist | Everything below |
| **PR #51** (awaiting approval) | Person pages: health data, private notes, household notes and pickups are staff-only. Check-in roster and active list never send an adult's health data | Church-wide roster with children's data, for any leader |
| **F1 interim roster guard** (needs approval; 6–10 h, in the child-safety stream) | Roster, active list, check-out and upload are allowed only for staff, paired stations, and leaders of teams listed in a new setting `checkin_team_ids` | The roster still covers all campuses until V1 |
| **Child-safety V1 PR 3** | Check-in access flag, roster minimised and campus-scoped; F1 retired | — |
| **Stage 1 security items** | F5: audit automatic leader grants. F3: connect-card messages (your call). Kids' teams and photos hidden from plain accounts (defence in depth). F6: no group with a minor unless two adults are in it, **only if minors get accounts** | Member tier and team-scoped leaders (C4): **Stage 2 entry gate** |

---

## 4. Current application assessment (verified in code)

| Area | Status | Notes |
|---|---|---|
| People, households, CSV import | **Ready** | Saved lists and tags missing (H7) |
| Sign-in, accounts | **Works, needs improvement** | No invitations, and an unlinked account is a dead end. Sign-up defaults to anyone |
| Permissions | **Built, needs security work** | See §3. Leader rights are written into `users.role` |
| Announcements | **Ready** | Push and inbox; no group email |
| Team chat | **Works, needs improvement** | Team chats follow the roster. Volunteers can't start chats; no search; no safeguarding for minors |
| Teams and positions | **Ready** | No ministry layer (not needed yet) |
| Scheduling (requests, accept/decline, conflicts, autofill, month grid, email links) | **Ready, the strongest area** | **No per-volunteer campus eligibility.** No recurring availability, same-day replacement, "remind non-responders" or swaps |
| Reminders | **Works** | One global lead time; nothing nudges the leader about non-responders |
| Service planning, songs, templates | **Ready** | Printable run sheet missing |
| Attendance, roll call | **Works** | Trends and export thin |
| Kids' check-in | **Built, needs safety work** | Child-safety V1 |
| Giving | **Works** (stand-in Stripe only) | Live verification, counting close and household statements missing |
| Forms | **Partial** | Event sign-ups with questions only; no standalone forms |
| Guest follow-up | **Partial** | Connect cards and lists; no owner, state or due date |
| Events | **Works** | No repeat, duplicate or `.ics` feed |
| Member app | **Ready** | Pending requests not shown first |
| Platform | **Needs work** | No CI, no restore drill, deploy outages, synchronous push fan-out |

---

## 5. Faith Teams parity: feature by feature

**Classes**
- **A:** minimum to replace Faith Teams
- **B:** needed for an excellent first experience
- **C:** shaped by leader feedback (Stage 2)
- **D:** long-term Planning Center capability (Stage 3)

**"Used?"** is the agents' judgement; **the owner confirms**.

| Area | Faith Teams provides (medium confidence) | Hub today | Missing / needs improvement | Used? | Needed for replacement? | Class |
|---|---|---|---|---|---|---|
| People and families | Profiles, households, tags, import | Strong | Tags and saved lists; verified import of the real export | Likely | Yes | A (import); B (lists) |
| Member directory | Member-facing directory | Staff only | Opt-in directory with privacy | Unknown | No: members come in Stage 2 | C |
| Announcements and communication | Email/text to people and groups | Push, inbox, announcements; SMTP for transactional mail | Email a **team** with a delivery log; church-wide email; SMS (paid) | Likely | Team email **if leaders email from FT today** | A if used; church-wide C; SMS D |
| Groups and ministries | Groups with rosters and sign-ups | Serving teams only | Small groups (separate model, never reusing auto-leader access) | Unknown | **Only if groups are active in FT** | A if used, else C |
| Team messaging | Basic (Google Chat used instead) | Team chats, mentions, files, tasks | "Message team" button; search; volunteer DMs | Yes | Yes (built) | A (button); C (DMs, search) |
| Volunteer management | Teams, positions, leaders | Built | Leader-grant audit; clearance for kids' teams | Yes | Yes | A; C3 with kids' ministry |
| Volunteer scheduling | Grid, requests, reminders, leader notices | Built and arguably better | **Campus eligibility**; same-day replacement; swaps | Yes, the core | Yes | **A** (eligibility); B (same-day); C (swaps) |
| Availability and reminders | Blockouts, automatic reminders | One-off away dates; one reminder | Recurring availability; **remind non-responders** | Likely | Yes | **A** (remind); A for worship (recurring) if used, else B |
| Service planning | Plans, printable/emailable schedule | Strong | Printable run sheet | Yes | Yes (built) | A (built); B (print) |
| Attendance | Check-in-based attendance | Roll call, headcounts, reports | Trends and export | Likely | Basic yes | A (built); C (trends) |
| Children's check-in | Tags, pickup slips, safety notes | Built; V1 pending | Child-safety V1 | Confirm whether in FT | **Separate, non-negotiable** | Safety track |
| Giving | Online giving | Strong (Stripe, recurring, statements) | Live verification; counting close; household statements | Unknown (FT or Subsplash?) | **Only if FT runs giving** | A if used, else C |
| Forms and registrations | Form builder, registrations, payments | Event sign-ups with questions | Only the forms actually in use (one forms model, no general builder) | Unknown | **Only forms in use** | A if used; builder D |
| Guest follow-up | Tag-driven text/email automation | Connect cards, lists | Assigned list: owner, state, due date. Automation later | Likely | Assigned list yes | A (assigned list); C (automation) |
| Events and calendars | Calendar, events | Events, RSVP, payments | Repeat and duplicate; `.ics` | Likely | Repeat yes | A (repeat); B (`.ics`) |

**Owner facts that decide Stage 1 scope**
1. Are small groups run in Faith Teams?
2. Where does giving run: Faith Teams or Subsplash?
3. Do leaders email or text from Faith Teams?
4. Which Faith Teams forms are live?
5. Is kids' check-in in Faith Teams today?
6. Do teams message in Faith Teams or Google Chat?
7. Do worship volunteers use recurring blockouts?
8. How many volunteers and campuses are involved?
9. Will any minors have accounts in Stage 1?
10. How many devices are subscribed to push today? This is a read-only count.

---

## 6. A better experience, not just a copy

The agents agreed that **the weekly scheduling loop is what makes leaders switch.** Polish comes after leaders tell
us what slows them down.

| Item | Class | Agent-assisted effort |
|---|---|---|
| Feedback link on every page, plus a "you said, we did" status list | A (first) | 0.5–1 day |
| **Remind non-responders** (push plus existing email, rate-limited) | A | 8–12 h |
| **Message team** from the team and service pages (opens the team chat; team email if used) | A | 6–10 h |
| Volunteer app shows **pending requests first** with Accept/Decline | A | 6–8 h |
| How-to pages for the six leader tasks | A | 1–2 days |
| "Needs attention" on Home (open spots, haven't replied, drafts not sent), tappable pills, sticky "Send N drafts" bar, fix the blank gap and zero stats | B (cheap first impression) | about 2.5 days |
| Leader home with "My teams", availability-ranked picker, team-page workspace, phone one-week schedule, role-trimmed navigation, naming clean-up | C (by feedback) | about 9 days |

**What leaders will notice in week one** (Church Operations):
1. Requests go to the right campus.
2. Reminding non-responders works.
3. A Sunday-morning decline is replaced fast.
4. Volunteers reply in a tap or two.
5. Recurring blockouts are remembered (worship).
6. Feedback gets an answer.
7. Naming and navigation.

---

## 7. Stage 1: Better Faith Teams (scope)

**Must-have (A)**
- **Safety and trust:**
  - owner settings (§3), PR #51, the F1 guard, F5
  - CI and a restore drill, deploy window
  - minimal batched push fan-out if the device count is high
  - sign-out removes the device's push
  - kids' teams hidden from plain accounts
  - F6 if minors get accounts
- **Scheduling loop:** per-volunteer campus eligibility; remind non-responders; recurring availability for worship
  (if used).
- **Leader tools:** Message team; volunteer pending-first; Faith Teams people import, verified on a copy.
- **Follow-up and events:** assigned guest follow-up list; repeating events.
- **Leader support:** feedback loop, how-to pages, leader invitations (exact-email link for leaders only).
- **Parity-only, if used:**
  - team email over SMTP with a delivery log
  - small groups (separate model)
  - the specific forms in use (one forms model)
  - giving close and live Stripe check

**First impression (B):**
- the "Needs attention" set (§6)
- same-day replacement (H1)
- `.ics` feed
- saved lists
- printable run sheet
- guest thank-you
- recurring availability for other teams

**Out of Stage 1:**
- member tier, member directory, adult DMs, church-wide email, member first-run, quiet hours, message search
- swaps, full C4, ministries layer, SMS, the whole C list in §6

### Architecture decisions Stage 1 must get right
These are cheap now and expensive later. One design note goes to the owner before child-safety PR 3:
- **Grants.** Child-safety PR 3's check-in access becomes the **first row of one grants table**
  (`user, capability, scope`), not another column. Moving leader rights off `users.role` (C4) waits for Stage 2, but
  must use the same table. If the note isn't approved in time, PR 3 ships a flag shaped like a grant: **V1 is never
  delayed.**
- **Groups ≠ teams.** Small groups, if built, are their own model and never use automatic leader access.
- **Three campus concepts stay separate:**
  - access (`users.campus_ids`)
  - home (`people.campus_id`)
  - serving eligibility (`serving_campuses`, default = home campus)
- **Forms.** One forms model (`forms`, `form_fields`, `form_responses`) if any are built, with staff-only sensitive
  answers and no auto-linking by typed email.
- **Messages.** One outbox and delivery log for push, email and in-app.
- **Stage 3 door.** Kept open by these and by the existing multi-church rules; no tenancy work now.

---

## 8. Leader involvement and feedback

**Channels (only three)**
1. An in-app "Send feedback" link that captures page, role and campus automatically.
2. A "Hub feedback" chat for each ministry.
3. A 20-minute monthly huddle with each ministry's advisory group.

For a Sunday blocker: a named on-call person and phone number for the first six weeks.

**Categories**
- bug / frustration
- missing functionality
- feature request
- workflow improvement
- ministry-specific idea

**Severity:** Blocks Sunday · Slows me down · Nice to have.

**Cadence**
- **Daily:** a 10-minute sweep.
- **Weekly:** a 20–30-minute triage with the owner (or a named deputy) and the developer.
- **Monthly:** a "you said, we did" message.
- **Early weeks:** a quick Monday-after-Sunday check.

**From feedback to backlog**
- **An item enters the backlog if it does one of these:**
  - blocks a ministry's retirement criteria
  - has several requesters
  - affects safety, security or reliability
  - is cheap
- Otherwise it is marked "heard, not now", with a reason.
- Every item shows a status leaders can see: Received → Looking → Planned → Done / Not now.
- Requesters are told by name when their item ships.

**Bugs**
- Reproduce, write a failing test, fix, see it pass, and keep the test.
- Close only when the reporter confirms on their own phone.
- Privacy, children's data and giving bugs jump the queue.

**Advisory groups** (2–4 people each, including one sceptic):

| Group | Who |
|---|---|
| Worship | Worship pastor, a band lead, a scheduler |
| Production | Production director, a tech lead |
| Children's | Children's director and check-in lead; the safety lead has the final word |
| Hospitality and welcome | Hospitality lead, guest follow-up lead |
| Office and finance | Administrator, finance lead |

**Not asked of volunteers**
- feedback forms (it goes through their leaders)
- long double-running
- set-up work on day one
- testing on Sunday mornings
- extra transition messages

---

## 9. Rollout and workflow-based retirement

**Waves** (each starts only when its gate passes; dates are expectations, not deadlines):

| Wave | Who | Gate |
|---|---|---|
| 0, December | About 8 staff: chat, tasks, planning | Owner settings done (§3), PR #51 merged, F1 guard live, invited policy, account review, restore drill, CI (or `npm test` before every merge), deploy window, `MB_DEV_LOGIN` unset |
| Freeze, 19 Dec – 3 Jan | — | No onboarding, no deploys |
| Child-safety V1, January | Kids' check-in on the new safety flow; soak about 24 January | V1's own gates. No other onboarding in soak week |
| 1, mid-February | Worship and production leaders; their volunteers answer by app or email | Campus eligibility, remind non-responders, Message team, pending-first, feedback loop live. Real-device push matrix passed. Recurring availability if worship uses it. Leader-view permission tests (campus-limited and volunteer accounts) |
| 2, late Feb – early Mar | Hospitality and welcome; office; other adult teams | Wave 1 has no "blocks Sunday" bugs. Assigned follow-up list. Repeating events. Parity items for those ministries (if used) |
| Freeze, mid-March – 4 April | — | Holy Week and Easter (28 March) |
| 3, April–May | Children's ministry (after V1 is verified and the safety lead signs off); remaining teams | Safety lead's written sign-off; F6 if minors have accounts |
| Stage 2 entry | Members | Member tier, team-scoped leaders (C4), directory consent, adult DMs with safeguarding, push hardening |

**Per-ministry retirement from Faith Teams.** A ministry stops using Faith Teams only when **all** of these hold:
- **Workflows:** its own listed workflows are done in the Hub by its own people, in real use.
- **Parallel run:** **one full cycle in parallel** with Faith Teams.
- **No regressions:** no open "blocks Sunday" bugs.
- **Sign-off:** its leader signs off in plain words ("I did X without Faith Teams").

| Ministry | Must work in the Hub, in real use |
|---|---|
| Worship | Plan from a template with songs, keys and charts. Schedule, send requests, see replies, remind non-responders. Same-morning replacement with notification. Players open plan and charts on phones. **Four consecutive Sundays** with no fallback |
| Production | Run sheet and call times visible. Cross-campus scheduling with eligibility. A swap in under two minutes. **Two consecutive Sundays** |
| Children's | Child-safety V1 complete. Full real Sunday with the safety lead present. Allergy and room on tags. Code check-out under pressure. Documented exception process. Kids' team scheduling. Paper fallback tried. **Safety lead's written sign-off** |
| Hospitality and welcome | Spotter roll call on phones for a full Sunday. Headcounts match expectations. Every new guest has an owner and a next step within the week |
| Office and finance | People and households imported, de-duplicated and spot-checked. Giving reconciles (if in scope). Weekly events and forms created and reported |

**Faith Teams as a whole** is switched off only when every ministry has signed off, an encrypted export is archived,
the people data is confirmed, and access is revoked.

**Google Chat** retires per team as each team's chat is active in the Hub for 4+ weeks. Its final switch-off waits
for Stage 2 (adult DMs, search) and an archived export. **Subsplash** is Stage 3 (§12).

---

## 10. Child-safety V1 (separate, non-negotiable)
- **The plan:** [v1-strategy.md](plans/child-safety/v1-strategy.md) in PR #49, unchanged.
- **Timing:** six PRs, December to late January, with a soak Sunday about 24 January.
- **F1 guard:** added to this stream, between PR 2 and PR 3. PR 3 replaces it.
- **Grants table:** PR 3's check-in access is the first grant (§7), never at the cost of delay.
- **Hot files** stay in order:
  - check-in files belong to V1
  - `services.js` changes (eligibility, then H1/H3) wait for V1 PR 2
  - `people.js`, `auth.js` and `teams.js` are sequenced around PR 3
  - migrations are numbered in merge order and rehearsed on a restored backup
- **Kids' ministry joins last,** after V1 is verified and the safety lead signs off.
- **Longer-term reference:** the full plan ([revision-3.2.md](plans/child-safety/revision-3.2.md)) guides V2/V3.

---

## 11. Stage 2: Better Meadowbrook (shaped by feedback)
- **Entry gate:** member tier and team-scoped leaders (C4) on the grants table.
- **Members:** invitations and safe account linking, member first-run, opt-in adult directory, adult DMs with
  safeguarding (kept originals, report and block), message search.
- **Communication:** church-wide email (with a provider decision), quiet hours, push hardening with retries and a
  delivery log.
- **Ministry features in the order leaders ask:**
  - swaps and open spots
  - full follow-up and prayer requests
  - attendance trends
  - ministries layer
  - clearance-gated kids' and youth scheduling (C3)
  - the C list in §6
- **Retirements:** Google Chat's final retirement. Child-safety V2 slices alternate with these.
- **Effort:** set after Stage 1 feedback. Roughly 300–450 agent-assisted hours, based on the earlier R1b and Phase 4
  estimates.

## 12. Stage 3: Planning Center alternative (only with a clear reason)
- **Planning Center** is eleven products: People, Services, Groups, Check-Ins, Giving, Registrations, Calendar,
  Publishing, Music Stand, Church Center and others. Staff use per-product screens; Church Center is the member front
  door. Sources: planningcenter.com and its help centre, at summary level.
- **Where the Hub can be better and unified:**
  - one person record and one app
  - order of service driving media, podcast and live titles
  - chat and tasks built in
  - simpler migration (Faith Teams and Subsplash importers)
- **Avoid:**
  - fund accounting
  - facility approval chains
  - a custom reporting engine
  - a website builder
  - native store apps (unless web push fails)
  - own text-to-give
  - chart annotation
  - multi-church tenancy before there is a reason
- **Media and Subsplash replacement:**
  - first verify Mux on the real account, with the owner's cost approval
  - then the library, livestream hardening, public watch page and sermon notes
  - retire Subsplash at a contract date
- **Multi-church:** only with a sustainable development plan and the owner's decision.

---

## 13. Effort and timeline (reconciled)

**Stage 1 effort**

| Measure | Stage 1 |
|---|---|
| Agent-assisted engineering, core | **about 260–370 h** (includes the F1 guard, UX A items, privacy items and 20 % contingency) |
| Agent-assisted, conditional on the owner's facts | **+0–180 h** (groups 40–56, forms 24–34, follow-up 24–32, team email 12–20, giving close 16–24) |
| Human-pace equivalent | about 2.25×, so 580–1,240 h |
| Child-safety V1, separate stream | 205–240 h |
| Real-device and people time | 16–24 h |
| **Your review time** | **4–6 h/week, peaking at 8–10 h/week in Dec–Jan** while both streams run, plus 1–2 h/week during permission design and F1 |

**What can run in parallel with V1**
- platform readiness
- forms and events
- follow-up
- groups
- UX A items
- the grants design note

**What must wait**
- F1: inside the V1 stream
- campus eligibility: after V1 PR 2
- anything in `auth.js` or `teams.js`: around PR 3

**Calendar assumptions**
- one main stream at about 15 h/week while V1 runs, about 25 h/week afterwards
- 2–3-day review turnaround
- freezes 19 Dec–3 Jan and about 15 Mar–4 Apr
- owner facts supplied by mid-December

**Calendar**

| | Expected | Fastest | Pessimistic |
|---|---|---|---|
| Staff wave | 7–14 Dec | 1 Dec | January |
| Wave 1 (worship, production) | mid-Feb | early Feb | March |
| Core A parity | May | late March | July |
| Including confirmed conditional items | June | April | Aug–Sep |
| Ministries leave Faith Teams | from March (worship, production), then one by one | — | — |

The pace is set by review latency and calendar gates (freezes, soak Sunday, real Sundays in parallel), not by coding
speed.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Live privacy exposure | Settings today; PR #51; F1 guard before leaders widen |
| "Parity" judged by staff, missing real leader workflows | One-cycle parallel rule; leader sign-off; advisory groups |
| A Faith Teams feature turns out to be essential late (groups, forms, texts) | Owner facts by mid-December; conditional budget |
| Wrong-campus requests destroy trust | Campus eligibility before wave 1 |
| iPhone push unreliable | Real-device matrix; email links as fallback |
| Feedback with no reply kills the beta | Status list and monthly "you said, we did" |
| Leader burnout from double-running | Short overlap; one source of truth per team |
| Two permission models | Grants note before PR 3, with a fallback that never delays V1 |
| Owner is the bottleneck | Named triage deputy; small PRs; review-hour budget |
| SMS turns out to be essential | Paid; needs an owner decision. Flag early |

---

## 15. Decisions and facts needed from you
1. **Today:** apply the settings in §3, and approve or decline **PR #51**.
2. **F1 interim roster guard** (permission change), and which teams go in `checkin_team_ids`.
3. **Connect-card messages:** staff only, or leaders too?
4. **Grants table** folded into child-safety PR 3, with the never-delay fallback.
5. **Minors:** will any have accounts in Stage 1? (Recommended: no, so Stage 1 stays adults-only.)
6. **Campus eligibility:** what an empty list means. Recommended: home campus only.
7. **The ten facts in §5,** including the push device count and contract renewal dates.
8. **Advisory group members,** the pilot campus, a triage deputy, Sunday on-call, the safety lead.
9. **Freeze dates and a deploy window.**
10. **Approve this revised direction** (PR #50). It approves planning only.

## 16. Immediate next steps (nothing beyond these without approval)
1. You: the §3 settings, the PR #51 decision, and the facts in §5.
2. On approval:
   1. child-safety PR 1, then PR 2
   2. the F1 guard
   3. R0 (CI and restore drill)
   4. the staff wave
3. The Chief Architect and Security write the grants design note for your approval before PR 3.
4. After V1 PR 2: campus eligibility, then the scheduling-loop items, with Stage 1 scope fixed by your facts.

---

## 17. Agent challenge round: how disagreements were settled

| # | Question | Outcome |
|---|---|---|
| 1 | Sign-in policy | **Invited.** "Directory" would let anyone in People see kids' team rosters. Hiding kids' teams from plain accounts is added as defence in depth. Invited only blocks new accounts; existing ones need the review |
| 2 | F1 roster guard now or at V1 PR 3? | **Now,** in the child-safety stream, before leaders widen (Security, Architect, QA) |
| 3 | Grants table | Folded into PR 3 as the first capability. It must never delay V1. Full C4 waits for Stage 2 |
| 4 | Campus eligibility | **A before wave 1.** Church Operations conceded |
| 5 | Recurring availability | A for worship if they use it, otherwise B (Product's dissent noted) |
| 6 | Push hardening | Decided by the device count; sign-out cleanup stays in Stage 1 |
| 7 | UX scope | A = feedback loop, remind, Message team, pending-first, how-to. B = cheap "Needs attention" set. The rest by feedback. UI/UX cut its list from 15–17 days to about 7 |
| 8 | Team email | A only if leaders email from FT today, over the existing SMTP; church-wide email is Stage 2 |
| 9 | Estimates | Architect and Developer reconciled at 260–370 h core plus 0–180 h conditional |
| 10 | Minors in chat | Interim rule only if minors get accounts; recommended adults-only Stage 1 |

**Dissent recorded**
- **Product:** recurring availability is B except for worship.
- **Developer:** the full grants table is more than Stage 1 needs. Settled as one capability first.
- **Church Operations:** the feedback loop comes before any polish. Adopted.
