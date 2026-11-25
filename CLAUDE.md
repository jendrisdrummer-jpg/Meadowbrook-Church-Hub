# Church Hub: guidance for Claude Code

A church management platform (people, planning, volunteers, check-in, chat, tasks, member app,
events, giving, media) replacing Faith Teams, Subsplash and Google Chat. It is live and in use at
Meadowbrook Church; protect what works.

## Read first
- `docs/README.md` indexes the knowledge base. Read the page for the area you're touching, not the
  whole codebase: architecture, database, features (does it already exist?), permissions,
  design-system, api, security, development, testing.
- `docs/agent-workflow.md` explains the agent team in `.claude/agents/` and when to use it.

## Stack (no build step)
Node ≥ 22.13 ES modules · Express 5 (the only dependency) · SQLite via `node:sqlite` · plain JS
front end with `html` templates (`public/js/lib.js`) · `node:test` · Docker on Render with a `/data` disk.

## Commands
`npm run dev` (test sign-in) · `npm run demo` (made-up data; sign in as pastor@meadowbrook.church) ·
`npm test` (must pass before every push) · `npm run test:ui` (browser + phone smoke run; needs a
global Playwright install).

## Firm rules
1. **Schema:** append a migration at the end of `MIGRATIONS` in `server/db.js`; never edit a shipped one.
2. **Every route has a guard** (`requireRole`, `requireFinance`, `announce`, membership) and campus
   scoping (`canCampus`/`campusFilter`). Giving needs the Finance flag, even for admins.
3. **Non-GET requests need `x-mb: 1`**; use `api()` from `lib.js`.
4. **Parameterized SQL only; escape all HTML** via the `html` template.
5. **Secrets only in Render env vars**, never in code, docs, commits, PRs or chat.
6. **No new dependencies, paid services or billing** without the owner's approval.
7. **Ask the owner first** for: architectural changes, destructive data operations (backup first),
   changes to sign-in/roles/permissions, consequential security changes.
8. **No church-specific values in code**; per-church settings go in `settings` (future multi-church).
9. **Tests**: add API tests for new workflows and permission edges; never depend on today's date.
10. **Docs are part of the change**: update the matching `docs/` page in the same PR
    (table in `docs/development.md`). Significant features use `docs/release-checklist.md`.
11. **UI**: follow `docs/design-system.md`; phone first; plain, kind wording.

## Working style
- Work on a branch; open a pull request for the owner to merge (merging deploys).
- Small tasks: do them directly. Large ones: plan with `chief-architect` first.
- Report results honestly: what was run and what was seen; say what wasn't tested.
