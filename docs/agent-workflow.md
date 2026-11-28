# The development team and how it works

Nine Claude Code subagents live in `.claude/agents/`. The main Claude Code session (the one you
talk to) runs them: a subagent can't start another subagent, so the **Chief Architect plans and
names who does what, and the main session carries the plan out**, one focused brief per agent.

## The team

| Agent | Model | Can change files? | Use it for |
|---|---|---|---|
| `product-manager` | Sonnet | Roadmap docs only (`master-product-roadmap.md`, `roadmap.md`, `feedback.md`) | What we build and in what order; triaging requests and feedback; saying no; product briefs; product-side stage gates |
| `product-innovation` | Sonnet | No (read-only, with web research) | Discovery: competitor features with sources, gaps, friction, high-leverage ideas; feeds the Product Manager |
| `church-operations` | Sonnet | No (read-only) | Does this work for a real church on a real Sunday? Workflows for pastors, admins, leaders, volunteers, members |
| `chief-architect` | Opus | Docs and plans only | Plans for medium/large work, architecture decisions, technical debt, final review, keeping docs true |
| `ui-ux-specialist` | Sonnet | UI files (approved changes) | UI audits, layout and wording, mobile and accessibility, implementing approved UI changes |
| `security-specialist` | Opus | No (strictly read-only) | Audits of sign-in, permissions, data exposure, uploads, privacy, secrets handling; findings by severity |
| `senior-developer` | Sonnet | Yes | Building approved features and fixes, migrations, app-side tooling |
| `qa-engineer` | Sonnet | Tests and test docs | Workflow testing, API tests, browser and phone checks, regression runs, verifying fixes |
| `devops-engineer` | Sonnet | Ops docs and `.github/workflows/` | Deploy and rollback plans, migration rehearsal, Render env vars, backups and the restore drill, monitoring, CI. Prepares owner steps; never deploys |
| `database-engineer` | Sonnet | Migration code and `docs/database.md` (when asked) | Schema and migration review, numbering across held branches, indexes and slow queries, data moves as preview then transaction, integrity checks on rehearsal copies; never touches production data |
| `accessibility-specialist` | Sonnet | No (runs checks, reports only) | Can people of all ages and abilities use it? Large text and zoom, contrast, tap targets, VoiceOver and keyboard, colour, motion, forms, plain language; findings by severity |
| `mobile-engineer` | Sonnet | Yes (`mobile/` and phone-specific web fixes) | The iPhone and Android apps: Capacitor and Xcode setup, native behaviour, links and downloads in the app, push through Apple and Google, icons, TestFlight and store steps for the owner |
| `training-writer` | Sonnet | Guides and help docs only | Staff and volunteer how-to guides, beta walkthroughs, "how to get the app" and launch announcements, staff release notes, help text proposals; checked against the real screens |

Invoke one by name in a request ("Use the security-specialist to audit the chat routes"), or let
the main session choose from each agent's description. `/agents` lists them.

## Who owns what

**Product.** `product-manager` owns priorities and the three roadmap docs: the order and stages in
[master-product-roadmap.md](master-product-roadmap.md), the backlog in [roadmap.md](roadmap.md), and
triage in [feedback.md](feedback.md). `product-innovation` researches and evaluates ideas and hands
them to the Product Manager, who files them. One writer per file, so the two never edit the same page.
The owner approves stage, gate and §2 changes.

**Operations.** Where several agents touch the same area, the owner of the outcome is first:

| Area | Owns it | Also involved |
|---|---|---|
| Render config and env vars | `devops-engineer`: inventory (names, never values) and exact owner steps; the owner changes Render | `senior-developer` adds new vars to code, `.env.example`, [api.md](api.md); `security-specialist` reviews security-relevant ones (`MB_DEV_LOGIN`, `MB_TRUST_PROXY`, sign-in) |
| Settings → Checks | `devops-engineer` reads it after every deploy and proposes new checks | `senior-developer` builds them (`routes/checks.js`); `security-specialist` confirms they never show a secret |
| Restore drill | `devops-engineer` owns [restore-drill.md](restore-drill.md) and its schedule, and is on hand | The owner or an admin runs it with the real file and password |
| Migration safety and rehearsal | `senior-developer` writes them (additive); `chief-architect` reviews the design | `devops-engineer` rehearses on made-up data before each deploy; the owner's drill copy is the real-data rehearsal; `qa-engineer` tests behaviour |
| Deploy and rollback runbook | `devops-engineer` (first deliverable; not written yet) | The owner deploys and decides on a rollback |
| Backups and Drive | `devops-engineer`: health, recency, retention, owner steps | `senior-developer` owns `server/backup.js`; `security-specialist` reviews encryption and Drive scope |
| Monitoring and logs | `devops-engineer`: what to watch (`/healthz`, Checks, backups, disk, Render logs) | The owner shares redacted log lines; `security-specialist` reviews what code logs |
| `MB_OFFLINE` and `restore --check` | `devops-engineer` uses and documents them | `senior-developer` changes the code, with `security-specialist` review; `qa-engineer` tests it |
| CI (`.github/workflows/`) | `devops-engineer` | `qa-engineer` owns what the tests check; `security-specialist` reviews workflow permissions and third-party actions; the owner turns on branch protection |

## Which agent for which task

| Task | Agent |
|---|---|
| "Should we build X?", "What's next?", a feature request, weekly feedback triage | `product-manager` |
| "What do Planning Center / Subsplash do for X?", "Where are we behind?" | `product-innovation` → `product-manager` |
| "Will this work on a Sunday morning?" | `church-operations` |
| Plan a medium or large change; final review | `chief-architect` |
| Screen audit, wording, phone layout | `ui-ux-specialist` |
| Usable for all ages and abilities (zoom, contrast, VoiceOver, plain language) | `accessibility-specialist` |
| The phone app itself, push in the app, TestFlight and store steps | `mobile-engineer` |
| Staff guides, beta walkthroughs, church-wide announcements | `training-writer` |
| Access, privacy, secrets, uploads review | `security-specialist` |
| Build a feature, fix a bug, write a migration | `senior-developer` |
| Test a workflow, verify a fix, regression run | `qa-engineer` |
| Plan a deploy, "is this migration safe to ship?", rollback, backups, restore drill, Checks shows "No", CI | `devops-engineer` |

## Size decides the team

| Size | Examples | Who |
|---|---|---|
| **Small** | A bug, a wording change, a missing guard on one route, a style fix | `senior-developer` (or the main session directly) → `qa-engineer` to verify if behaviour changed |
| **Medium** | A feature inside one area, a new report, a new widget | `product-manager` (worth it now?) → `chief-architect` plan → `senior-developer` → `qa-engineer`; add `ui-ux-specialist` for new screens, `security-specialist` if it touches access or sensitive data, `devops-engineer` if it adds a migration or env var |
| **Large** | A new area (small groups, classes), schema changes across areas, sign-in, money, integrations, anything multi-church | Full flow below, with the [release checklist](release-checklist.md) |
| **Question / audit** | "How does X work?", "Audit Y" | The one relevant agent, read-only |

## Full flow for a large feature

1. **Product Manager**: is it worth doing now? The product brief: problem, who it helps, existing/missing/proposed, stage, smallest version, what to leave out. Uses **Product Innovation** research when competitors or new ideas matter. A "not now" ends the flow here.
2. **Church Operations** (when it touches church workflows): how it really runs at church, edge cases (multiple campuses, volunteers on phones, Sunday-morning pressure).
3. **Chief Architect**: feasibility, design, files and migrations, reuse, risks, the step-by-step plan with an agent per step. → **owner approval** of the plan.
4. **UI/UX Specialist** (new screens): layout, wording, mobile, using the design system.
5. **Security Specialist** (access, sensitive data, uploads, public endpoints, integrations): threats and required controls, before code is written.
6. **Senior Developer**: builds it on a branch, with tests and doc updates.
7. **QA Engineer**: runs the workflows, `npm test`, `npm run test:ui`, phone checks; reports what passed with evidence and what failed.
8. **Chief Architect**: final review against the plan, conventions, docs and the release checklist. → merge into `milestone-1` (see [master-product-roadmap.md](master-product-roadmap.md) §2).
9. **DevOps Engineer** (when it adds a migration or env var, and for every deploy): migration rehearsal, deploy plan, rollback note, owner steps. → **owner approval and deploy** to `main`.

The Product Manager also checks the plan in step 3 didn't grow beyond the brief. Steps 1–2 and 4–5
may run in parallel because they only read. **Never run two agents that edit
files at the same time.** Skip any step that adds nothing.

## Deploys and beta stages

Merging `milestone-1` into `main` deploys. For each deploy:
1. `devops-engineer` writes the deploy plan (what ships, migrations rehearsed, backup first, window,
   smoke test, rollback) against [beta-readiness.md](beta-readiness.md) §1, after
   `qa-engineer` has a green `npm test` and `npm run test:ui` on the day.
2. `security-specialist` confirms the security items (test sign-in off, proxy setting, sign-in policy).
3. The owner approves, takes the backup and deploys; `devops-engineer` reads Settings → Checks with an
   admin afterwards and records the deploy in [merge-log.md](merge-log.md).

Moving to the next beta stage needs the product side (`product-manager`: feedback gates, scope),
the operations side (`devops-engineer`: drill passed, backups healthy, no open "No" on Checks)
and the owner's decision. Kids' check-in is a separate release with its own plan and approvals.

**First DevOps deliverable:** a deploy and rollback runbook in `docs/` (not written yet; today
[beta-readiness.md](beta-readiness.md) §1 and [merge-log.md](merge-log.md) hold the gate and a
one-line rollback note). Needed before the first deploy.

## Approvals the owner must give

Agents stop and ask (through the main session) before:
- Major architectural changes, or choosing a multi-church model.
- Destructive database operations (dropping, deleting or rewriting existing data) — and a backup is taken first.
- Changes to sign-in, sessions, roles or permission flags.
- Consequential security changes, or accepting a known security risk.
- New dependencies, new outside services, or anything that costs money.
- Merging to `main` (deploys), any change on Render or GitHub settings, and any step on production
  data. Agents prepare exact steps; the owner carries them out.

## Handoffs (keep them short)

Each agent ends with a compact handoff the next step can use without re-reading everything:

```
Summary: what I concluded or did (3–6 lines)
Files: paths touched or read that matter
Decisions needed: (owner) …
Next: which agent should do what
Evidence: commands run and results (QA, developer)
```

## Using the team efficiently on Claude Max ($100/month)

- **No extra billing**: no API keys, no pay-as-you-go, no paid services. Everything runs on the subscription.
- **Opus is reserved** for the Chief Architect and Security Specialist, used for planning, review and audits, not routine edits. The Product Manager and DevOps Engineer run on Sonnet.
- **Ask the Product Manager first** when it's unclear whether something is worth building; a "not now" is the cheapest outcome.
- **One agent, one focused brief**: name the goal, the files or area, and the doc sections to read. Agents read the docs instead of re-exploring the codebase.
- **Small things stay small**: don't run the full flow for a bug fix.
- **No back-and-forth between agents**: each runs once per step and hands off in writing.
- **Parallel only for read-only reviews** of independent questions.
- Batch related questions into one request rather than many small ones.

## Keeping shared knowledge current

The docs in `docs/` are the team's memory. Every PR updates the docs its change affects (table in
[development.md](development.md#keeping-the-docs-current)); the Chief Architect checks this at
final review and can be asked anytime to "check the docs against the code for area X".
