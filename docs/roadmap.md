# Product roadmap and backlog

Kept by the Product Manager agent (fed by Product Innovation's research), decided by the owner. Every item says whether it's
**existing** (built: see [features.md](features.md)), **missing** (a gap people would expect), or
**proposed** (a new idea), who it helps and why. Nothing here is approved until the owner says so.

## Where we are

Built and in use: people & households, teams, services and planning, scheduling, attendance and
kids' check-in, chat and tasks, notifications and announcements, member app with App Builder,
events with sign-ups and payments, giving, media library, backups. Built and awaiting real-world
setup: Mux streaming, uploads, podcast. This already replaces most of Faith Teams, Google Chat and
the Subsplash app.

## Order and phases

**[master-product-roadmap.md](master-product-roadmap.md) sets the order:** phases, release gates, the adoption and
migration plan, and when each old system retires. This page stays the **backlog**: what each item is, its ID, size and
gap analysis. Where the two differ on order or phase, the master roadmap governs. The "Critical / High / Medium" groups
below describe importance, not sequence.

**New items from the master roadmap (Nov 2026, revision 2: "better Faith Teams first"):**

| ID | Item | Size | Stage |
|---|---|---|---|
| N1 | Interim privacy fix: health data, private notes, household notes and pickups staff-only on person pages; no adult health data at check-in (PR #51) | S | Stage 1, now |
| N2 | Member tier below volunteer, plus team-scoped leader access (C4), on one grants table | M | Stage 2 entry gate |
| N3 | Per-volunteer campus serving eligibility (`serving_campuses`), honoured by candidates and autofill | M | Stage 1 (A) |
| N4 | Platform readiness: restore drill, deploy window, uptime and error alerting (CI is H12) | S | Stage 1 (A) |
| N5 | Push: sign-out removes the device; batched fan-out (Stage 1 if many devices); retries and delivery log | S–M | Stage 1 / 2 |
| N6 | Invitations and safe account linking (leaders in Stage 1; members in Stage 2) | M | Stage 1 / 2 |
| N7 | First-run flow, accessibility pass, "Needs attention" on Home, other UX polish | S–M | Stage 1 (B) / 2 |
| N8 | Adult direct messages with minimal chat safeguarding; message search | M | Stage 2 |
| N9 | Security Mediums: leader-grant audit (Stage 1), connect-card visibility, offboarding, chat and upload limits, announcement campus scope | M | Stage 1 / 2 |
| N10 | Adoption view and in-app feedback link with a "you said, we did" status list | S | **Feedback shipped** (#55: Feedback page, triage, "You said, we did"); adoption view not built |
| N11 | Interim check-in roster guard: staff, stations and leader accounts an admin authorises (`checkin_user_ids`) only (Security F1) | S | **Shipped** (#52) |
| N12 | Weekly scheduling loop: remind non-responders, "Message team", volunteer app shows pending requests first | S–M | **Shipped** (#58) |
| N13 | Kids' teams and photos hidden from plain accounts; no group with a minor without two adults (if minors have accounts) | S | Stage 1 |

## Product vision

The Hub is the church's operating system: one place where every person is known, cared for and
connected, from their first visit to leading others. Pillars: know every person · care for every
person · connect the church · equip the team · grow disciples · run it safely. Horizons: **now**
safety, privacy, Sunday scheduling and the care foundation; **next** reach and organize; **later**
discipleship, classes and multi-church SaaS. Full strategy (Nov 2026): the product strategy report
reviewed and approved in direction by the owner.

## Approved direction and working rule

- **Child safety and privacy come before everything else** (owner, Nov 2026).
- Work through the backlog **one step at a time**; don't start several large changes at once.
- Security, privacy, usability, data integrity and scalability are requirements for every item.
- Every item below still needs the owner's approval of its own plan before development.

## In planning

| ID | Item | Status |
|---|---|---|
| CS | Child-safety program: unique pickup codes, child-by-child check-out, custody / do-not-release alerts, authorized pickup verification, kids'-area permissions, check-in audit (covers C1, C2) | Version 1 strategy in [plans/child-safety/v1-strategy.md](plans/child-safety/v1-strategy.md) (about 205–240 team hours, about 9 weeks); full design revision 3.1 in [plans/child-safety/plan.md](plans/child-safety/plan.md) as amended by revision 3.2, with operational policy, 135-item approval checklist and Security, QA and Church Operations reviews. **Approved to start 2026-11-27**; six V1 PRs and the PR 1 brief in [plans/child-safety/v1-refresh-2026-11.md](plans/child-safety/v1-refresh-2026-11.md) |

## Prioritized backlog

IDs match the strategy report. Size: S days · M 1–3 weeks · L a month or more.

### Critical
| ID | Item | Size | Notes |
|---|---|---|---|
| C3 | Clearance-gated scheduling for kids and youth teams (background check / training dates, autofill skips, expiry reminders) | M | Next after CS; vendor is an owner decision ([master roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation)) |
| C4 | Private pastoral notes; staff-only `notes`; team-scoped leader access instead of automatic directory-wide leader | M | Permission change: owner approval + security review |
| C5 | Small groups as their own concept (roster, meetings with roll call, group chat, tasks, finder, request to join) | M–L | Not built on serving teams; after C4 |
| C6 | Follow-up inbox: owners, states, notes, due dates, template message, Monday push, automatic guest thank-you | M | Unifies connect cards, sign-ups, first-timers, "missing" |

### High
| ID | Item | Size |
|---|---|---|
| H1 | Day-of urgent replacement on a late decline (with S2 in team chat) | S–M |
| H2 | Open spots ("I can serve") and swaps for volunteers | L |
| H3 | Recurring availability honored by candidates and autofill | M |
| H4 | Roll-call-only permission (names and photos, no contact/medical) | M |
| H5 | Annual grade rollover with dry run | S |
| H6 | "Message people": team/group/list/campus, email fallback, delivery log, retract (email provider = owner decision) | M |
| H7 | Saved lists and bulk actions in People | M |
| H8 | Pastor's Monday digest; attendance trends, campus comparison, export (with S1) | M |
| H9 | Volunteers can message teammates; message search (permission change) | S–M |
| H10 | Events: repeat, duplicate, `.ics` feed, room conflicts | M |
| H11 | Prayer requests | S–M |
| H12 | Friendly no-access page; GitHub Actions running `npm test` | S |

### Medium
| ID | Item | Size |
|---|---|---|
| M1 | Duplicate prevention at check-in and roll call; household merge | M |
| M2 | Counting workflow (verify, close, soft delete); split Finance into enter vs see donors | M |
| M3 | Household statements, print batch, named unlinked cash | M |
| M4 | Pledges, giving by campus, recurring forecast, payout reconciliation | M |
| M5 | iPad roster cache hardening (unless folded into CS) | M |
| M6 | Parent paging (push first) and volunteer presence / room ratios | M |
| M7 | Notification quiet hours and digest | M |
| M8 | Ministries above teams, directors, assistant leaders | M |
| M9 | Opt-in member directory and self-service profile | M |
| M10 | Volunteer load and fill-rate report; event check-in and waitlist | S–M |

### Long-term
| ID | Item | Size |
|---|---|---|
| L1 | Discipleship pathway and mentor pairs | L |
| L2 | Classes and leader training (watch-to-the-end video, quizzes, in-person sessions) | L |
| L3 | Per-child event registration (VBS) feeding check-in; event volunteer shifts | L |
| L4 | Multi-church SaaS: tenancy decision, setup wizard, Faith Teams/Subsplash importers. **Direction decided 26 Nov 2026; moved up: groundwork before the whole-church launch** (architect plan and owner approval first; large architectural change) | L |
| L6 | One shared store app (App Store, Google Play) for all churches: thin native shell (e.g. Capacitor) around `/app`, native push, Face ID, "find your church" for guests, church layout from App Builder. Needs L4 groundwork, product name, new dependency and store fees (about $99/year, $25 once): owner decisions. Proposed; after staff beta, before whole-church launch ([master §12](master-product-roadmap.md#12-stage-2-and-stage-3)) | L |
| L5 | SMS, public website and embeddable Watch, accounting export, sermon notes | M–L each |
| — | Media: finish setup with the church's Mux account; verify live, uploads, podcast | existing, needs owner setup |

### Innovative standouts
S1 "people who need attention" board · S2 decline-to-replacement in team chat · S3 group page
(roster + chat + roll call + tasks) · S4 bulletin / run sheet from the order of service · S5 giving
prompt on the live player and "serving this week" card.

### Not now (decided)
Full calendar approval chains · own text-to-give · custom reporting engine · a separately branded
app per church (one shared app instead, L6) · small groups built on serving teams. (Earlier "no
native apps" and "no multi-church before groups and follow-up" were replaced by the owner's
direction of 26 Nov 2026: see L4 and L6.)

## Gap analysis vs. the services being replaced

Baseline from the code as of this document; the Product Manager agent keeps it current from Product Innovation's research and
verifies competitor details before relying on them.

| Area | Faith Teams / Subsplash / Google Chat offer | Here | Status |
|---|---|---|---|
| Small groups | Groups with leaders, rosters, attendance, sign-ups (FT) | Teams only (serving), not groups | **missing** |
| Member directory | Members see a directory of each other (opt-in) | Staff-facing only | missing |
| Public website | Website builder with sermons, events, connect forms (SS) | Member app only | missing |
| Watch library on the church's own website | Embeddable media (SS) | App only | missing |
| Sermon notes, Bible reader | In-app notes and Bible (SS) | — | proposed |
| Prayer requests | Prayer wall/requests (SS) | Connect card free text only | missing |
| Text messaging (SMS) | SMS to groups (SS, some ChMS) | Push and email only | missing (would need a paid SMS provider: owner decision, [master roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation)) |
| Email to groups | Bulk email/newsletters | Announcements push + inbox; transactional email | missing |
| Direct messages | 1:1 chat (GC) | Team chats and groups | verify: groups of two may cover it |
| Background checks / child-safety clearance | Common in ChMS | Profile fields could track dates | proposed |
| Reports | Attendance and giving trends, growth | Attendance and finance views | partial |
| Guest follow-up pipeline | Assign, track steps | Connect cards and sign-ups lists | partial |

## Differentiators to lean into

- **One app for everything**: serving, chat, tasks, giving, watching, events. No switching
  between Faith Teams, Subsplash and Google Chat.
- **Order of service drives everything**: media titles and speakers, live titles, podcast
  episodes, reminders all come from the plan the team already writes.
- **Built for volunteers on phones**: accept/decline from a notification, away dates, plans.

## Backlog rules (for the Product Manager and Product Innovation agents)

- Each proposal: problem, who has it (role), how often, what they do today, the proposal,
  expected benefit, rough size (S/M/L), dependencies, and status (existing/missing/proposed).
- Prefer improving existing workflows over adding modules.
- Flag anything that needs a paid service or new billing as an owner decision.
- Keep this page short: move shipped items to [features.md](features.md); drop ideas the owner rejects
  (note them in one line so they aren't re-proposed).
