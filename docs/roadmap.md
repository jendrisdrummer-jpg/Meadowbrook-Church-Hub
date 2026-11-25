# Product roadmap and backlog

Owned by the Product Innovation agent, decided by the owner. Every item says whether it's
**existing** (built: see [features.md](features.md)), **missing** (a gap people would expect), or
**proposed** (a new idea), who it helps and why. Nothing here is approved until the owner says so.

## Where we are

Built and in use: people & households, teams, services and planning, scheduling, attendance and
kids' check-in, chat and tasks, notifications and announcements, member app with App Builder,
events with sign-ups and payments, giving, media library, backups. Built and awaiting real-world
setup: Mux streaming, uploads, podcast. This already replaces most of Faith Teams, Google Chat and
the Subsplash app.

## Now / next (owner-confirmed direction)

| Item | Type | Who it helps | Notes |
|---|---|---|---|
| Finish media setup with the church's Mux account; verify live, uploads, podcast | existing | Media team, members | Real-world test of built features |
| Discipleship: small groups with leaders, members and weekly attendance; growth pathway; mentor pairs | missing | Pastors, group leaders | Phase 2 of the original plan; small groups are a core Faith Teams feature |
| Classes / training: courses of video sessions (must watch to the end), quizzes with a pass mark, in-person sessions marked by attendance; completion sets a profile milestone and can be required before leading a group | proposed (owner idea, Nov 2026) | Pastors, future leaders | Builds on Mux player, profile fields, roll call |

## Gap analysis vs. the services being replaced

Baseline from the code as of this document; the Product Innovation agent keeps it current and
verifies competitor details before relying on them.

| Area | Faith Teams / Subsplash / Google Chat offer | Here | Status |
|---|---|---|---|
| Small groups | Groups with leaders, rosters, attendance, sign-ups (FT) | Teams only (serving), not groups | **missing** |
| Member directory | Members see a directory of each other (opt-in) | Staff-facing only | missing |
| Public website | Website builder with sermons, events, connect forms (SS) | Member app only | missing |
| Watch library on the church's own website | Embeddable media (SS) | App only | missing |
| Sermon notes, Bible reader | In-app notes and Bible (SS) | — | proposed |
| Prayer requests | Prayer wall/requests (SS) | Connect card free text only | missing |
| Text messaging (SMS) | SMS to groups (SS, some ChMS) | Push and email only | missing (would need a paid SMS provider: owner decision) |
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

## Later

| Item | Type | Notes |
|---|---|---|
| Multi-church SaaS | proposed | Prepare per [architecture.md](architecture.md#multi-church-saas-readiness); decide tenancy model first. Needs pricing, onboarding, billing (owner decisions). |
| Native app store wrapper | proposed | Only if PWA limits (iOS push reliability) hurt |
| Custom domain for the hub | existing option | Render setting |

## Backlog rules (for the Product Innovation agent)

- Each proposal: problem, who has it (role), how often, what they do today, the proposal,
  expected benefit, rough size (S/M/L), dependencies, and status (existing/missing/proposed).
- Prefer improving existing workflows over adding modules.
- Flag anything that needs a paid service or new billing as an owner decision.
- Keep this page short: move shipped items to [features.md](features.md); drop ideas the owner rejects
  (note them in one line so they aren't re-proposed).
