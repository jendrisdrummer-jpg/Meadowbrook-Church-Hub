# Master Product Roadmap: Meadowbrook Church Hub

Revision 3 (execution) · 2026-11-25. A planning document: nothing here is implemented or approved until the owner says
so.

This page sets the **order, stages, release gates and adoption plan**. [roadmap.md](roadmap.md) remains the
**backlog** (item IDs, sizes, gap analysis). [feedback.md](feedback.md) holds the leaders' feedback list and the
"You said, we did" record. Where these pages differ on order or stage, this page governs.

**Status, 26 November 2026.** Milestone 1 is **complete** on the `milestone-1` integration branch and **not
deployed** (`main` is unchanged; see [merge-log.md](merge-log.md)). The current milestone is **"Personal Testing &
Leadership Preview"**: the approved visual refresh, end-to-end verification and a demo guide
([leadership-preview.md](leadership-preview.md)), all in the existing Church Hub, then (with the owner's explicit approval) a deploy to the existing Render service. No separate app or
testing environment.
**No new features** in this milestone. Open owner decisions are listed once, in §13.

**Revision 3** moves from planning to execution. It records:
- what is **already built and verified**
- the **first development milestone** as small, reviewable PRs
- the **beta plan**
- **kids' check-in as a separate release** that replaces Subsplash check-in

The three-stage strategy is unchanged.

---

## 1. Summary
- **The replacement is mostly built.** About 260 server endpoints, 27 hub pages, a member app, and 42 automated tests
  (32 of them large end-to-end scenarios), all passing.
- **QA verified the core workflows in a real browser.** Each one worked start to finish:
  - scheduling and sending requests
  - volunteer accept and decline, in the app and by signed email link
  - leader decline notices
  - order of service from a template
  - team chat
  - announcements
  - roll call
  - events with capacity limits
  - connect cards
  - kids' check-in and check-out, including offline sync

  The remaining work is to **finish and improve**, plus testing on real devices and real data.
- **The initial migration replaces three things:**
  - Faith Teams, for church management
  - Google Chat, for team communication
  - **Subsplash children's check-in**, as its own safety-critical release

  The Subsplash media replacement stays in Stage 3.
- **First milestone ("Staff and leaders, safely"):** about **140–220 agent-assisted hours** across about ten small PRs,
  including basic small groups and the forms Meadowbrook uses. About a third of it is testing, setup and people work.
- **Kids' check-in cutover:** **about 200–300 hours**, with a pilot from about 21 February and Subsplash check-in
  switched off around mid-June 2027 (§8).
- **Expected timeline:**

  | Who starts | When |
  |---|---|
  | Staff | mid-December |
  | Worship and production | late January |
  | Other ministry leaders | February to March, then after Easter |

  Ministries leave Faith Teams one at a time, by workflow (§10).

## 2. Approval boundaries
- **PR #49** approves the child-safety V1 plan and the Subsplash cutover plan, **plans only**.
- **PR #50 (this page)** approves the **planning direction** only.
- **PR #51** (interim privacy fix): approved and merged into `milestone-1`.
- **Every PR in the milestone below:**
  - is opened only after its summary (what changes, why, security and data implications, acceptance criteria, tests)
    has been shown
  - is merged and deployed only with the owner's approval
- **No paid service or recurring cost** without the owner's approval.
- **Execution authority (owner, 25 Nov 2026).** The agent team builds and merges approved Milestone 1 work
  without per-PR approval, once tests, browser checks and security checks pass. Merges go into the
  **`milestone-1` integration branch**, never into `main`. **Merging to `main` deploys to production and runs
  migrations, so it needs the owner's explicit approval.** So do anything that could damage production
  data, any paid service, and major decisions outside the roadmap. Merges are recorded in the
  [merge log](merge-log.md).

## 3. The three stages
1. **Stage 1, Better Faith Teams:** staff and ministry leaders use the Hub for the workflows Meadowbrook uses today,
   done better. Their volunteers answer requests in the app or by email link. Kids' check-in moves from Subsplash as
   its own release. Reliability, security and confidence come first.
2. **Stage 2, Better Meadowbrook:** shaped by leaders' and members' feedback (§9). Members join, behind the member
   tier and team-scoped leader access.
3. **Stage 3, Planning Center alternative:** expand only where there is a clear reason and a sustainable plan.
   Includes the Subsplash media replacement.

---

## 4. What is already built

**Verified** means seen working in a browser by QA, or covered by passing tests.

| Area | Status | What remains (type of work) |
|---|---|---|
| People, households, search, custom fields, CSV import | **Built, verified** | Import the real Faith Teams export onto a copy and fix the mapping (testing, fix) |
| Accounts, sign-in, roles, campuses | **Built, needs refinement** | Unlinked accounts tell the office; admins link by hand (done, #54, #65). Sign-in set to invited (setting) |
| Teams and positions | **Built, verified** | Audit automatic leader grants (security) |
| Scheduling: requests, accept/decline, email links, reminders, conflicts, away dates, autofill, month grid | **Built, verified** | Campus eligibility (done, #56). Leader "Remind" (done, #58). Recurring availability if worship uses it (deferred) |
| Service planning, songs, templates | **Built, verified** | Printable run sheet can wait |
| Team chat, tasks | **Built, verified** | "Message team" (done, #58). Volunteer DMs and search wait for Stage 2 |
| Announcements, notifications | **Built, verified** | Push and email on real phones (testing) |
| Attendance, roll call | **Built, verified** | Trends can wait |
| Events and sign-ups | **Built, verified** | "Duplicate event" (small). Repeating events can wait |
| Connect cards, follow-up | **Built, verified** | Messages staff only (done, #52). Owner and due date can wait |
| Member app | **Built, verified** | Pending requests first (done, #58) |
| Giving | **Built, never tested with live payments** | Only in scope if Faith Teams runs giving |
| Backups | **Built, needs setup** | Password, Drive, restore drill (ops) |
| Small groups | **Basic groups built** (#57) | Roster, leaders, members-only group chat, "My groups" in the app. Finder, attendance and join requests later |
| Forms | **Built** (#60) | Set up the forms Meadowbrook uses in the hub, from the owner's list (no new code) |
| Member directory, member tier, adult DMs, church-wide email | **Missing** | Stage 2 |
| Kids' check-in | **Flow built and verified; safety requirements not built** | Separate release (§8) |
| Media, Mux, podcast | Built | Not in this migration |

## 5. Privacy first
**Today, in Settings (no code):**
- Sign-in: "Only accounts an admin adds below" (invited).
- Review every leader account:
  - Set a campus limit, or untick "Can sign in".
  - Deleting an account or demoting it to volunteer doesn't stick.
- Team "leader" ticks: only where the person truly schedules that team.
- Profile-field visibility: check each field.
- Pastoral matters: don't keep them in People notes.
- `MB_DEV_LOGIN`: must not be set.

**A read-only production check:** run in Render's Shell. It prints counts only, never names or contents. It shows how
many real children, allergies, medical notes, pickups and connect-card messages are exposed, plus account roles and the
sign-in policy.

**Code, each needing approval:**
1. **PR #51:** person pages hide health data, private notes and pickups from leaders. Check-in never sends an adult's
   health data.
2. **Milestone PR 2:** the check-in roster and active list go to staff, paired stations and leader accounts an admin
   authorises in Settings (`checkin_user_ids`) only. Connect-card messages become staff only. Automatic leader grants are audited.

**Still exposed after both:**
- leaders see contact details church-wide
- any signed-in account sees who serves at each service (no member tier yet: Stage 2)
- staff see everything, by design

Child-safety V1 PR 3 later replaces the roster rule with the check-in access flag.

---

## 6. First milestone: "Staff and leaders, safely"
Each PR is small and reviewable. Before it is opened, its summary is shown (what changes, why, security and data
implications, acceptance criteria, tests). Hours are agent-assisted.

| # | PR | Type | Why | Security and data | Acceptance (summary) | h |
|---|---|---|---|---|---|---|
| 1 | **#51 Interim privacy fix** (ready) | Security | Live exposure of health and pastoral data | Staff and admin views unchanged | Canary test fails before, passes after; leader page checked in a browser | done |
| 2 | **Check-in roster guard, connect-card privacy, leader-grant audit** | Security | Remaining exposures (Security F1, F3, F5) | **Permission change (approval).** New setting `checkin_user_ids` (authorised accounts) | Parking leader gets 403, kids'-team leader gets 200, station gets 200. Leader gets no card message. Audit row on a team-leader change | 10–16 |
| 3 | **Automated tests on every PR** (GitHub Actions, `npm test`) | Ops | Merging deploys; nothing runs tests today | Free tier: approval needed | A PR shows a check; a failing test is visible | 3–5 |
| 4 | **Account onboarding** | Fix | Unlinked accounts hit a dead end | No change to who can sign in | Unlinked account sees "We've let the office know"; admins see a list of unlinked accounts with one-click linking | 6–10 |
| 5 | **Per-volunteer campus eligibility** | New | Teams are shared across campuses; autofill must never request someone for a campus they don't serve | New table `serving_campuses`. Default: home campus (owner decision) | Ineligible volunteers excluded from candidates and autofill; a manual pick warns; tests across two campuses | 14–24 |
| 6 | **Scheduling loop** | Small new + UI | Leaders' weekly chores | Remind is rate-limited; it reaches only people with pending requests | "Remind N who haven't replied" on a service; volunteer app shows pending requests first; "Message team" on team and service pages; leader notified | 10–16 |
| 7 | **Feedback link** in hub and app | Small UI | Leaders must shape Stage 2 | Goes to a "Hub feedback" chat; nothing public | One tap from every page; captures page, role and campus | 2–4 |
| 8 | **Basic small groups** | New | Owner listed it for the first milestone | Separate model from teams; **never grants leader access**; adults only in Stage 1 | Group with leaders and members, a group chat, members see their groups in the app; group leaders see only their group; permission tests | 30–45 |
| 9 | **The forms Meadowbrook uses** | New | Owner listed it for the first milestone | One forms model; sensitive answers staff-only; never links to a person by a typed email | Each named form works end to end on a phone; responses listed for staff; rate-limited | 20–35 (scope from the owner's list) |
| 10 | **Recurring availability** (only if worship uses it) | New | Avoid re-entering the same blockouts monthly | — | "Not on the first Sunday" respected by autofill; tests | 10–14 |

**Status, 25 November 2026** (all merged into `milestone-1`, **nothing deployed**; see [merge-log.md](merge-log.md)):

| # | PR | Status |
|---|---|---|
| 1 | Interim privacy fix | Merged (#51) |
| 2 | Check-in access, connect-card privacy, leader-grant audit | Merged (#52) |
| 3 | Tests on every PR | Merged (#53) |
| 4 | Account onboarding | Merged (#54) |
| 5 | Campus eligibility | Merged (#56) |
| 6 | Scheduling loop | Merged (#58) |
| 7 | Feedback | Merged (#55): a Feedback page with triage and "You said, we did", not just a chat link |
| 8 | Basic small groups | Merged (#57), after a security review (1 High, 3 Medium fixed) and a re-review |
| 9 | Forms | Merged (#60), after a security review, a re-review (no High/Medium) and two browser click-throughs. The named forms are set up in the hub once the owner's list arrives, with no new code |
| 10 | Recurring availability | Deferred (owner, 25 Nov): only if the worship team confirms it's needed; doesn't hold up the milestone |
| – | Backup restore drill | Tools and runbook merged (#59, [restore-drill.md](restore-drill.md)); the drill itself is the owner's |
| – | Polish from browser click-through | Merged (#61) |
| – | How-to pages | In-app Help page (#63), hub and member app |
| – | Security decisions (owner, 25 Nov) | Hashed sessions and live-connection revocation (#64); admin-only account linking and one account per person (#65, #66); IPv6-aware rate limits, safer sign-in codes, Settings → Checks, forms retention (#67) |
| – | Beta readiness | [beta-readiness.md](beta-readiness.md): deployment gate, device and email tests, import rehearsal, restore drill, permissions, training, configuration |

**Not PRs, but part of the milestone:**

| Work | Type | h |
|---|---|---|
| **Backup restore drill** on a scratch copy, result recorded | Ops | 3–4, plus owner |
| **Real-device testing:** push on iPhone home-screen app and Android; email codes and reply links in Gmail and Outlook; camera upload | Testing | 6–8, plus people |
| **Faith Teams import rehearsal** on a copy | Testing | 4–8 |
| **Leader and campus permission tests** | Testing | 8–10 |
| **How-to pages** for leader tasks | Ops | 6–8 |
| **Bug reserve** for real use | Fix | 12–15 |

**Total:** about **140–220 agent-assisted hours**. Small groups and forms are about 50–80 of it.

**Remaining, as of 25 November:** about **30–45 agent-assisted hours**, plus owner and volunteer time:
- real-device testing: 6–8
- Faith Teams import rehearsal: 4–8
- extra leader and campus permission tests: 3–4 (most are in the PRs already)
- how-to pages: done (#63); 1–2 to keep them current
- bug reserve: 12–15
- small follow-ups: 3–6 (Tasks place picker for small groups; per-person reminder grouping)
- running the restore drill with the developer: 1

Done since (owner decisions of 25 November): hashed sessions, closing live chat on sign-out, removing
automatic linking, one account per person (#64–#66), and the rate-limit and Checks work (#67).

**Only if approved or needed:**
- recurring availability: 10–14 (deferred; only if the worship team confirms it)
- campus limits on account management for campus-limited admins: done (#69); edge cases are an owner decision (§13)

**Not rebuilt:** scheduling, planning, chat, announcements, roll call, events and connect cards stay as they are. They
are verified.

**Order and hot files:**
- PR 1, then PRs 2, 3, 4 and 7 in December.
- PR 5, then PR 6, in January, after child-safety PR 2 (both touch `services.js`).
- PRs 8 and 9 alongside (new files).
- PR 10 if needed.

Migrations are numbered in merge order and rehearsed on a restored backup.

## 7. Beta plan
| Group | What they use | Must be complete first | Onboarding |
|---|---|---|---|
| **Staff** (about 8), **mid-December** | Chat, tasks, planning, people, announcements | §5 settings. PRs 1–4 and 7. Restore drill done. Feedback chat set up. A named person for problems | In person. Accounts added by an admin. Notifications switched on together. One-page how-to |
| **Freeze 19 Dec – 3 Jan** | — | — | — |
| **Worship and production**, **late January** | Scheduling, plans, songs, team chat | PRs 5 and 6. Real-device push and email tested. Leader permission tests pass. Recurring availability if they use it | Team leader invites their team personally. A 20-minute walkthrough. Phone card: install, notifications, accept your first request. Volunteers can stay on email links |
| **Other ministry leaders**, **February to early March** (then after Easter) | Their teams; small groups; their forms | PRs 8 and 9. No open "blocks Sunday" bugs from the previous group | Same as above. One champion per ministry |
| **Children's ministry** | Kids' check-in | Separate release (§8). Not in the same month as their scheduling move | Training per campus |

**Rules:**
- No onboarding during freezes:
  - Christmas: 19 Dec – 3 Jan
  - Holy Week and Easter: about 14 Mar – 11 Apr
- No onboarding in a check-in pilot week.
- Each team has one source of truth for each job.

## 8. Kids' check-in: separate release (replacing Subsplash check-in)
**Full plan:** [subsplash-cutover.md](plans/child-safety/subsplash-cutover.md), with
[v1-strategy.md](plans/child-safety/v1-strategy.md).

- **Safety requirements:** every V1 requirement stays. Subsplash check-in continues until all of them are implemented
  and verified and the exit criteria are met.
- **Estimate:** about **200–300 agent-assisted hours**.
  - The Senior Developer says about 170; the Chief Architect about 310.
  - The difference is device, training and rollout work, and it is fixed once the number of campuses, iPads and
    printers and the export format are known.
- **Calendar:**
  - V1 PRs in December and January
  - pilot campus from about 21 February
  - other campuses after Easter
  - Subsplash check-in off around mid-June 2027
- **Biggest unknowns:**
  - **Label printers:** they must support AirPrint. Replacing them is a purchase needing approval.
  - **The Subsplash export format.**

## 9. Feedback process
- **Where leaders send it:** the feedback link in the hub and app, or the "Hub feedback" chat. One per ministry if it
  gets busy.
- **What they send:**
  - bugs and frustrations
  - missing functionality
  - workflow improvements
  - feature requests
  - ministry-specific ideas
- **Severity:** Blocks Sunday · Slows me down · Nice to have.
- **Cadence:**
  - daily 10-minute sweep
  - weekly 20–30-minute triage (owner or a named deputy, plus the developer)
  - monthly "You said, we did" message to leaders
- **Record:** [feedback.md](feedback.md) holds the prioritised list (with who asked) and the "You said, we did"
  record.
- **What enters the backlog:** an item that:
  - blocks a ministry's move off Faith Teams
  - has several requesters
  - affects safety, security or reliability
  - is cheap

  Anything else is "heard, not now", with a reason.
- **Bugs:** a failing test first, then the fix. Closed when the reporter confirms on their phone. Privacy, children's
  data and giving jump the queue.
- **Advisory groups:** worship, production, children's, hospitality and office (2–4 people each, including a sceptic).

## 10. Retirement: per ministry, by workflow
A ministry stops using Faith Teams only when all of these hold:
- its own workflows work in the Hub, in real use, by its own people
- one full cycle has run in parallel
- there are no open "blocks Sunday" bugs
- its leader confirms in plain words

| Ministry | Must work, in real use |
|---|---|
| **Worship** | Plan from a template with songs, keys and charts. Scheduling with campus eligibility. Reminders and nudges. Same-morning replacement. Players open plans on phones. Four consecutive Sundays |
| **Production** | Run sheet and call times. Cross-campus scheduling. Quick swaps. Two consecutive Sundays |
| **Hospitality and welcome** | Spotter roll call on phones. Headcounts match. Connect cards followed up |
| **Groups** | Their groups and members in the Hub. Group chat in use |
| **Office** | People and households imported and checked. Weekly events and the forms in use working |
| **Children's** | Separate release and exit criteria (§8) |

**Retirement of each system:**
- **Faith Teams as a whole:** switched off when every ministry has signed off, an encrypted export is archived, and
  access is revoked.
- **Google Chat:** retires team by team as each chat is active in the Hub for 4+ weeks. The final switch-off waits for
  an archived export.
- **Subsplash check-in:** per §8. **Subsplash media:** Stage 3.

## 11. Effort and calendar

| | Agent-assisted hours | Owner time |
|---|---|---|
| First milestone | 140–220 | 3–5 h/week of review |
| Kids' check-in cutover | 200–300 | 15–30 h review in total; staff 15–30 h verifying data |
| **Peak (December–January)** | both streams running | 6–8 h/week |

- **Human-pace equivalent:** about 2.25 times the agent-assisted hours.
- **What sets the calendar:** review time, freezes, real Sundays and parallel cycles. Not coding.
- **Assumptions:**
  - owner facts arrive by mid-December
  - reviews are turned around in 2–3 days
  - the freezes in §7

| Milestone | Expected | Pessimistic |
|---|---|---|
| Staff using it | mid-December | January |
| Worship and production | late January | February |
| Other ministry leaders | Feb – early March, then April | after Easter |
| Ministries off Faith Teams | from March, one by one | summer |
| Kids' check-in pilot | 21 February | March |
| Subsplash check-in off | mid-June 2027 | late summer |

## 12. Stage 2 and Stage 3
- **Stage 2 (from leader and member feedback):**
  - **Members:** the member tier and team-scoped leader access, then invitations, the member directory (opt-in,
    adults), adult DMs with safeguarding, and message search.
  - **Communication:** church-wide email.
  - **Scheduling:** swaps.
  - **Care:** full follow-up and prayer.
  - **Reporting:** attendance trends.
  - **Then:** whatever leaders ask for most.
- **Stage 3:**
  - a Planning Center-level breadth only with a clear reason
  - the Subsplash media replacement (Mux verification first, with the owner's cost approval)
  - multi-church only by owner decision

  **Avoid:** fund accounting, approval chains, a reporting engine, a website builder, native store apps (unless web
  push fails).

## 13. Decisions and facts needed before implementation
This is the **one list of owner decisions**. Other pages link here rather than keeping their own.

**Decided (as merged into `milestone-1` by 25 November 2026):**
1. **PR #51:** approved and merged (#51).
2. **Milestone PR 2:** approved and merged (#52). Check-in access is per account, not per team: an admin
   authorises leader accounts in Settings (`checkin_user_ids`). Connect-card messages are staff only.
3. **GitHub Actions** (free tier): approved; tests run on every PR (#53).
4. **Campus eligibility:** an empty list means "home campus only" (#56).
5. **Small groups, "basic":** roster, leaders, a members-only group chat and "My groups" in the app; adults only;
   never grants leader access (#57). Meeting attendance, finder and join requests later.

**Open:**

6. **Forms:** the list of Faith Teams forms in use, with their fields (set up in the hub; no new code).
7. **Recurring availability:** do worship volunteers use recurring blockouts? (Deferred until they say.)
8. **Minors:** will any have accounts in Stage 1? (Recommended: no.)
9. **Beta people:**
   - staff names for the first group
   - an advisory member per ministry
   - a triage person for the Feedback page
   - a Sunday contact
10. **Child-safety plan:** approve the V1 release, and the kids' check-in facts it needs
    (subsplash-cutover.md §6): printers and AirPrint, the Subsplash export and contract.
11. **Check-in today:** is hub kids' check-in used in production now? If so, an admin fills the check-in access
    list straight after the deploy ([beta-readiness.md](beta-readiness.md) 1.15).
12. **Warn-only ceiling for member sign-in codes** (security review L3 on #67): accept as is, or add a hard limit.
13. **Campus-limited admin edge cases** ([permissions.md → Campus-limited admins](permissions.md#campus-limited-admins)):
    narrowing on promotion, accounts with Finance or Announcements, church-wide announcements, cross-campus team
    leaders. Safe defaults are in place.
14. **Vendors (paid):** an SMS provider, and a clearance-check (background check) provider for C3.
15. **Leadership demo on the live site:** real member information will be visible; show everything, or avoid
    screens with personal details where possible?
16. **Test accounts on the live site:** add a few clearly named test accounts (campus admin, staff, leader,
    member) to see each role's view, or test with real staff?

## 14. How the agent reviews settled the main questions
| Question | Outcome |
|---|---|
| Rebuild or finish? | **Finish.** Earlier estimates priced setup, testing and small buttons as new building and double-counted safety work |
| Members in Stage 1? | No. Volunteers use the app or email links. The member tier is the Stage 2 entry gate |
| Sign-in policy | Invited. "Directory" would let anyone in People see kids' team rosters |
| Roster exposure | Fix now (milestone PR 2), not at child-safety PR 3 |
| Campus eligibility | Required before worship and production, because teams are shared across campuses |
| UX | The scheduling loop and feedback first; polish by feedback |
| Kids' check-in | Separate release; requirements unchanged; estimates differ only on rollout work |
