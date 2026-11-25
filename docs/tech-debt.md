# Known bugs and technical debt

What's known to be wrong, risky or untidy, so it isn't rediscovered every time. Add an entry when
you find something you won't fix now; remove it in the PR that fixes it. Severity: **H** high,
**M** medium, **L** low.

| # | Area | Issue | Sev | Suggested fix |
|---|---|---|---|---|
| 1 | SaaS readiness | "Meadowbrook" appears in the package name, README, demo data and some defaults. Each church is a separate deployment; there is no tenant boundary in one deployment. | M | Keep new code church-neutral; plan the tenancy model before selling (see [architecture.md](architecture.md#multi-church-saas-readiness)). |
| 2 | UX / permissions | Opening a page your account can't use shows "Something went wrong" instead of a friendly "You don't have access" (the server correctly answers 403). Seen by `npm run test:ui` for volunteers/campus staff on staff pages, and admins without Finance on Giving. | L | Hub router: show a friendly no-access state on 403. |
| 3 | Testing | No CI: tests run only when someone runs them. | — | Done (#53): GitHub Actions runs `npm test`; `npm run test:ui` is not in CI yet. |
| 4 | Testing | Date-sensitive tests have failed on certain calendar days before (backups retention, Oct 2026). | M | Review tests for "today"-dependent assertions (see [testing.md](testing.md)). |
| 5 | Code quality | No linter or formatter configured; style is kept by hand. | L | Optional: ESLint with a minimal config as a dev-only tool (owner decision; no runtime impact). |
| 6 | Security | Session tokens are stored as-is in `sessions` (not hashed). A database leak would expose live sessions. | — | Done (#64) on `milestone-1`; live once it deploys. |
| 7 | Security | Rate limiting is in-memory and per process, and duplicated in `routes/app.js` and `routes/events.js`. | L | Share one helper; acceptable while there's one server process. |
| 8 | Supply chain | `hls.js` and YouTube's player load from CDNs at run time. | L | Serve a pinned `hls.js` copy from `/public` (no dependency change needed). |
| 9 | Docs | README "Roadmap" and "Who can do what" tables were out of date (fixed with this docs PR; keep [features.md](features.md) as the source of truth). | — | Done. |
| 10 | Media | Mux, uploads and podcast are tested only against stand-ins; first real use needs checking. | M | Test with the church's Mux account; fix what comes up. |
| 11 | Operations | Large files (chat files up to 25 MB, images 8 MB) live on the Render disk; disk size is the only limit. | L | Watch disk usage; consider limits or cleanup for old chat files. |
| 12 | Operations | The `Dockerfile` sets `MB_BACKUPS`, but the server's backups read `MB_BACKUP_DIR` (`server/backup.js`); only `scripts/backup.js` reads `MB_BACKUPS`. Harmless today: both default to `/data/backups`. | L | Use one name in the `Dockerfile` and scripts (`MB_BACKUP_DIR`). See [deploy-runbook.md](deploy-runbook.md#known-small-issues). |
| 13 | Docs / config | `.env.example` doesn't list `MB_TRUST_PROXY` (required as `1` on Render), `MB_SMTP_HOST`/`MB_SMTP_PORT` or `MB_OFFLINE` (laptop only). | L | Add them with comments; the full list is in [deploy-runbook.md](deploy-runbook.md#environment-variables-on-render). |
