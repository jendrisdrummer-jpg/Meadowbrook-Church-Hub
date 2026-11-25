# Development standards

How changes are made, tested and shipped. Applies to people and to every agent.

## Before writing code

1. Read the relevant docs: [features.md](features.md) (does it already exist?),
   [architecture.md](architecture.md), [database.md](database.md),
   [permissions.md](permissions.md), [design-system.md](design-system.md).
2. Inspect only the files involved (`Grep`/`Glob` first, then read). Don't re-read the whole
   codebase; the docs exist so you don't have to.
3. For anything medium or large, get a plan approved first (see [agent-workflow.md](agent-workflow.md)).

## Code conventions

- **Match the surrounding code**: plain ES modules, small functions, two-space indent, single
  quotes, semicolons, no build step, no TypeScript. Comments explain *why* in plain English, as the
  existing files do (a short header comment on each module).
- **No new dependencies** without a written reason the owner approves. The server has one
  (Express). Prefer Node built-ins (`node:sqlite`, `node:crypto`, `fetch`, `node:test`).
- **No new paid services or billing** without the owner's approval.
- **Reuse**: `lib.js` (UI helpers), `http.js` (validation, errors, audit), `auth.js` (guards,
  campus scoping), `notify.js` (inbox + push + email), `getSetting`/`setSetting`.
- **Server**: one router per area; guards on every route; parameterized SQL; plain-English error
  messages; `audit()` on significant writes; `LIMIT` on lists.
- **Schema**: append a migration; never edit a shipped one (see [database.md](database.md)).
- **Front end**: `html` templates (escaped), tokens not raw colours, patterns from
  [design-system.md](design-system.md), phone-first.
- **No church-specific values in code** (see SaaS readiness in [architecture.md](architecture.md)).
- **Integrations**: env vars for credentials, a test override URL, a stand-in server in tests.

## Commands

| Command | Does |
|---|---|
| `npm ci` | Install (Express only) |
| `npm run dev` | Hub on :8090 with test sign-in and auto-restart (`MB_DEV_LOGIN=1`) |
| `npm run demo` | Fresh demo database (made-up people), then the server. Sign in as `pastor@meadowbrook.church` (admin), `south@meadowbrook.church` (campus staff) or `volunteer@meadowbrook.church` |
| `npm test` | API and rules tests (`node:test`, in-memory DB, stand-in servers). Must pass before every push. |
| `npm run test:ui` | Browser smoke and regression run (see [testing.md](testing.md)). Needs Playwright installed globally; not a project dependency. |
| `npm run restore -- <file>` | Decrypt a backup (needs `MB_BACKUP_PASSWORD`) |

## Git and pull requests

- Work on a branch, never on `main`. One topic per PR; small PRs merge faster and break less.
- Commit messages: a short summary line, then what changed and why in plain words.
- PR description: what it adds/fixes, how it was tested (with real results), anything the owner
  must set up after merging.
- Before pushing: `npm test` passes; for UI changes `npm run test:ui` passes and screenshots were
  looked at; for significant features the [release checklist](release-checklist.md) is done.
- **CI:** GitHub Actions (`.github/workflows/test.yml`) runs `npm test` on Node 22 for every pull
  request and every push to `main`. A red "Tests" check means don't merge. Still run the tests yourself
  before pushing; `npm run test:ui` isn't in CI yet (it needs a browser), so run it locally for UI
  changes. The free tier's minutes cover this (about a minute per run). To block merging on a red
  check, the owner turns on branch protection for `main` in GitHub (Settings → Branches).
- Merging to `main` deploys to Render.

## Keeping the docs current

The docs are part of the code. **A PR that changes one of these must update the matching doc in
the same PR:**

| Change | Update |
|---|---|
| New/changed table or column | [database.md](database.md) |
| New feature or module, or one removed | [features.md](features.md) |
| New route, guard, role or flag | [api.md](api.md), [permissions.md](permissions.md) |
| New integration or env var | [api.md](api.md), README setup, `.env.example` |
| New UI pattern or token | [design-system.md](design-system.md) |
| Architectural change | [architecture.md](architecture.md) |
| Bug found and not fixed, or debt taken on | [tech-debt.md](tech-debt.md) |
| Item shipped or reprioritised | [roadmap.md](roadmap.md) |
| New workflow worth testing | [testing.md](testing.md) |

The Chief Architect checks this in its final review.

## Efficient use of Claude (Claude Max, no extra billing)

- No paid APIs, no pay-as-you-go keys. Agents use only what the subscription includes.
- Small task → do it directly or with one agent. Use the full team only for large features.
- Give agents a focused brief: the goal, the files, the doc sections to read.
- Run agents in parallel only for independent read-only reviews.
- Don't ask an agent to "review the whole app"; name the area.
