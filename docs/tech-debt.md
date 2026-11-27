# Known bugs and technical debt

What's known to be wrong, risky or untidy, so it isn't rediscovered every time. Add an entry when
you find something you won't fix now; remove it in the PR that fixes it. Severity: **H** high,
**M** medium, **L** low.

| # | Area | Issue | Sev | Suggested fix |
|---|---|---|---|---|
| 1 | SaaS readiness | "Meadowbrook" appears in the package name, README, demo data and some defaults. Each church is a separate deployment; there is no tenant boundary in one deployment. | M | Keep new code church-neutral; plan the tenancy model before selling (see [architecture.md](architecture.md#multi-church-saas-readiness)). |
| 2 | UX / permissions | Settings, App Builder, Giving and Announcements now show "You don't have access" up front (`PAGE_RULES` in `public/js/app.js`). Other staff pages opened by URL by a lower role can still show "Something went wrong" (the server correctly answers 403). | L | Extend `PAGE_RULES` to the remaining staff pages, or show a friendly state on any 403. |
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
| 13 | Docs / config | `.env.example` doesn't list `MB_TRUST_PROXY` (required as `2` on Render), `MB_SMTP_HOST`/`MB_SMTP_PORT` or `MB_OFFLINE` (laptop only). | L | Add them with comments; the full list is in [deploy-runbook.md](deploy-runbook.md#environment-variables-on-render). |
| 14 | Permissions | QA-6: a campus-limited admin can send an announcement to the whole church; Announcements is a church-wide permission. Owner decision pending (limit their reach to their campuses, or require the flag be granted by an all-campus admin). | M | Decide, then scope the announcement audience with `campusFilter`. |
| 15 | Scheduling | QA-7: nothing stops two services at the same campus and time. Kept as is (some churches run overlapping services). | L | Optional warning in the new-service dialog. |
| 16 | UX | QA-10: the new-service dialog defaults to "Every week" (changing it changes behaviour for people used to it). | L | Revisit with the owner. |
| 17 | History protection | History protection stops deletes only. A past assignment's status, a past service's time, roll-call un-marking and headcount edits can still be changed, and deleting an upcoming service sets `checkins.service_id` to NULL on any check-in already linked to it (the plan's "update guards", H1). Audit rows exist for none of them yet. | M | See the plan (`docs/plans/child-safety/`, section 4.2 and 4.9). |
| 18 | History protection | A past service with records can't be deleted and there is no "cancel" for a service held by mistake (the plan's `services.cancelled_at`). It stays in the lists. Needs a column and a filter on every service list. | M | See the plan (`docs/plans/child-safety/`, section 4.2 and 4.9). |
| 19 | History protection | Legal hold is the smallest version: one switch by any all-campus admin, with a reason, audited and notified. Missing from the plan: a two-person release (a second admin approves), reminders on days 1 and 6 after release, disk alerts at 60/80/85%, and the Drive-owner warning. With no Drive connected, backup copies pile up on the Render disk until the hold is released. | M | See the plan (`docs/plans/child-safety/`, section 4.2 and 4.9). |
| 20 | History protection | A hold doesn't stop an admin from deleting an upcoming service or a draft assignment (they aren't history), nor from archiving a person. Archive and edit changes to people during a hold are audited, not blocked. | M | See the plan (`docs/plans/child-safety/`, section 4.2 and 4.9). |
| 21 | History protection | No staff screen lists check-ins to void one: voiding is the API only (`POST /checkin/checkins/:id/void`). The iPad can't void (by design); the check-in screen for signed-in staff needs a "Void" action with the reason dialog before the pilot. | M | See the plan (`docs/plans/child-safety/`, section 4.2 and 4.9). |
