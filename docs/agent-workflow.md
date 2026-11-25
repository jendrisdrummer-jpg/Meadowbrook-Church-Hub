# The development team and how it works

Seven Claude Code subagents live in `.claude/agents/`. The main Claude Code session (the one you
talk to) runs them: a subagent can't start another subagent, so the **Chief Architect plans and
names who does what, and the main session carries the plan out**, one focused brief per agent.

## The team

| Agent | Model | Can change files? | Use it for |
|---|---|---|---|
| `chief-architect` | Opus | Docs and plans only | Plans for medium/large work, architecture decisions, technical debt, final review, keeping docs true |
| `product-innovation` | Sonnet | `docs/roadmap.md` only | What to build next and why; gaps vs Faith Teams, Subsplash, Google Chat; backlog |
| `church-operations` | Sonnet | No (read-only) | Does this work for a real church on a real Sunday? Workflows for pastors, admins, leaders, volunteers, members |
| `ui-ux-specialist` | Sonnet | UI files (approved changes) | UI audits, layout and wording, mobile and accessibility, implementing approved UI changes |
| `security-specialist` | Opus | No (strictly read-only) | Audits of sign-in, permissions, data exposure, uploads, privacy; findings by severity |
| `qa-engineer` | Sonnet | Tests and test docs | Workflow testing, API tests, browser and phone checks, regression runs, verifying fixes |
| `senior-developer` | Sonnet | Yes | Building approved features and fixes |

Invoke one by name in a request ("Use the security-specialist to audit the chat routes"), or let
the main session choose from each agent's description. `/agents` lists them.

## Size decides the team

| Size | Examples | Who |
|---|---|---|
| **Small** | A bug, a wording change, a missing guard on one route, a style fix | `senior-developer` (or the main session directly) → `qa-engineer` to verify if behaviour changed |
| **Medium** | A feature inside one area, a new report, a new widget | `chief-architect` plan → `senior-developer` → `qa-engineer`; add `ui-ux-specialist` for new screens, `security-specialist` if it touches access or sensitive data |
| **Large** | A new area (small groups, classes), schema changes across areas, sign-in, money, integrations, anything multi-church | Full flow below, with the [release checklist](release-checklist.md) |
| **Question / audit** | "How does X work?", "Audit Y" | The one relevant agent, read-only |

## Full flow for a large feature

1. **Product Innovation**: problem, who it helps, existing/missing/proposed, scope, what to leave out.
2. **Church Operations** (when it touches church workflows): how it really runs at church, edge cases (multiple campuses, volunteers on phones, Sunday-morning pressure).
3. **Chief Architect**: feasibility, design, files and migrations, reuse, risks, the step-by-step plan with an agent per step. → **owner approval** of the plan.
4. **UI/UX Specialist** (new screens): layout, wording, mobile, using the design system.
5. **Security Specialist** (access, sensitive data, uploads, public endpoints, integrations): threats and required controls, before code is written.
6. **Senior Developer**: builds it on a branch, with tests and doc updates.
7. **QA Engineer**: runs the workflows, `npm test`, `npm run test:ui`, phone checks; reports what passed with evidence and what failed.
8. **Chief Architect**: final review against the plan, conventions, docs and the release checklist. → PR for the owner.

Steps 1–2 and 4–5 may run in parallel because they only read. **Never run two agents that edit
files at the same time.** Skip any step that adds nothing.

## Approvals the owner must give

Agents stop and ask (through the main session) before:
- Major architectural changes, or choosing a multi-church model.
- Destructive database operations (dropping, deleting or rewriting existing data) — and a backup is taken first.
- Changes to sign-in, sessions, roles or permission flags.
- Consequential security changes, or accepting a known security risk.
- New dependencies, new outside services, or anything that costs money.
- Merging to `main` (the owner merges PRs; agents open them).

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
- **Opus is reserved** for the Chief Architect and Security Specialist, used for planning, review and audits, not routine edits.
- **One agent, one focused brief**: name the goal, the files or area, and the doc sections to read. Agents read the docs instead of re-exploring the codebase.
- **Small things stay small**: don't run the full flow for a bug fix.
- **No back-and-forth between agents**: each runs once per step and hands off in writing.
- **Parallel only for read-only reviews** of independent questions.
- Batch related questions into one request rather than many small ones.

## Keeping shared knowledge current

The docs in `docs/` are the team's memory. Every PR updates the docs its change affects (table in
[development.md](development.md#keeping-the-docs-current)); the Chief Architect checks this at
final review and can be asked anytime to "check the docs against the code for area X".
