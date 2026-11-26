# Beta launch checklist

How we get from `milestone-1` to staff using the hub, then ministry leaders, safely. Each item is in
the **earliest** stage that needs it. Kids' check-in is **not** in any of these stages: it stays on
Subsplash until the separate child-safety release is approved ([plans/child-safety](plans/child-safety/)).

**Status, 26 November 2026.** The current milestone is **personal testing and the leadership
preview**, in the existing Church Hub: the owner tests on the live site and shows it to church
leadership, using the [leadership preview guide](leadership-preview.md). That happens **after** the
deploy of `milestone-1`, which **still needs the owner's written approval** (1.1); nothing has been
deployed. There is no separate test environment. On the live site, use a test team and test service
with only yourself on them: requests, reminders and announcements reach real people.

**Who:** **O** = owner · **A** = an admin · **D** = developer (agent) · **S** = staff testers.
**Dates** follow [roadmap §7](master-product-roadmap.md#7-beta-plan): staff in mid-December, before the
19 Dec – 3 Jan freeze; worship and production in late January; other ministries February to early
March. No onboarding during freezes or a check-in pilot week.

## 1. Required before deployment
Nothing is merged to `main` (which deploys) until every line is done. The deploy itself, what to
watch afterwards and how to roll back are in the [deploy and rollback runbook](deploy-runbook.md).

**Status** (DevOps review, 2026-11-25, against the code at `milestone-1`): **Ready** = done, or can be
done without the owner · **Owner** = waits on the owner or an admin · **Blocked** = can't start until
something else is done (named). Items marked † were added or moved from the Chief Architect's review.

| # | Task | Who | Done when | Status |
|---|---|---|---|---|
| 1.1 | Approve the deploy | O | Written approval, with a date | Owner |
| 1.2 | `MB_DEV_LOGIN` is **not set** on Render | O | Render → service → Environment has no `MB_DEV_LOGIN` (nor `MB_OFFLINE`) | Owner |
| 1.3 | `MB_TRUST_PROXY` is exactly `1` on Render | O | Render → Environment shows `1` (not `true`). It isn't in `.env.example`; the full list is in the [runbook](deploy-runbook.md#environment-variables-on-render) | Owner |
| 1.4 | People can sign in without test sign-in | O | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `MB_SMTP_USER`/`MB_SMTP_PASS` set on Render, and `PUBLIC_URL` is the hub's address. Without the SMTP pair, Settings → Checks says "No" for email (schedule emails and reminders need it) | Owner |
| 1.5 | `MB_BACKUP_PASSWORD` is set, and kept by two people outside the hub | O | Settings → Backups shows backups running | Owner |
| 1.6 | Restore drill passed with a real backup, **with `milestone-1` checked out** † | O + D | [restore-drill.md](restore-drill.md) record row filled in, "Restore check passed". Starting the copy in offline mode takes real data through migrations 30–35, session hashing and the index step: record the start-up log lines and the `--check` counts. (`main`'s code has no `--check` and no offline mode, so don't use it for this drill) | Owner (D on hand). Made-up-data rehearsal passed (see the [runbook](deploy-runbook.md#rehearsal-record)) |
| 1.7 | One-account-per-person audit on production data | O + D | `node scripts/audit-account-links.js` (read-only) summary shared (ids and counts only). The script isn't in production's code yet, so run it on the drill copy during 1.6 ([restore-drill.md](restore-drill.md) step 4). Duplicates, if any, are resolved by an admin as in [account-links.md](account-links.md), or knowingly left (the rule then waits; admins see a warning, and 1.11 shows "No" for that row) | Owner (with 1.6) |
| 1.8 | All checks green on `milestone-1` | D | CI green; `npm test` and `npm run test:ui` pass on the day | Ready (2026-11-25: CI green, `npm test` 146/146, `npm run test:ui` 224/224); repeat on the day |
| 1.9 | Fresh backup just before the deploy, downloaded and kept off shared drives | O | Settings → Backups → Back up now → Download | Owner (on the day) |
| 1.10 | Deploy window | O + D | Not Saturday evening or Sunday, not in the freeze; someone available for an hour after | Owner |
| 1.11 | Right after the deploy: Settings → Checks has no "No" | A + D | Screenshot of Settings → Checks; "Your address as this server sees it" matches a what-is-my-IP site. A "No" for one-account-per-person is acceptable only if 1.7 left duplicates knowingly. Also read the Render start-up log for the duplicate-accounts warning and any "Session conversion failed" line † ([runbook → first hour](deploy-runbook.md#the-first-hour)) | Blocked (after the deploy) |
| 1.12 | Smoke test on production (10 minutes) | D + A | Sign in, People, a service, Chat, Help, Feedback, Settings → Checks, sign out | Blocked (after the deploy) |
| 1.13 | Sign-in policy set to **invited** (was 2.1) † | A | Settings → Sign-in & accounts: "invited". Works on today's `main`; with "anyone", new sign-ups create guest duplicates in People. After the deploy, Settings → Checks shows "Only invited people can create accounts: Yes" | Owner |
| 1.14 | Account review: every leader, staff and admin account is someone who should have it (was 2.2) † | O + A | Settings → Accounts reviewed; extra access removed | Owner |
| 1.15 | Is hub kids' check-in used in production today? † | O | Answered. #52 limits check-in to stations, staff/admins and authorised leaders **at the deploy**, so if any leader or volunteer uses it now, an admin fills the check-in access list straight after the deploy, before Sunday | Owner |
| 1.16 | Does any team already schedule across campuses in the hub? † | O | Answered. If yes, an admin sets serving campuses for those volunteers right after the deploy (otherwise they're only offered at their home campus); if no, it waits for 3.4 | Owner |
| 1.17 | Render's health check uses `/healthz` | O | Render → service → Settings → Health Check Path is `/healthz`. There is no `render.yaml`, and Render doesn't use the `Dockerfile`'s `HEALTHCHECK` | Owner |
| 1.18 | Deploy and rollback runbook reviewed | O | [deploy-runbook.md](deploy-runbook.md) read and approved | Owner |

**What the deploy does:** runs migrations 30–35 (new columns and tables only), hashes existing
sessions (everyone signs in again within 24 hours), and creates the one-account index if there are no
duplicates. **If it has to be rolled back:** prefer fixing forward; if not, follow the
[runbook's rollback](deploy-runbook.md#rollback): restore the code, then (after a backup) clear
`sessions` and drop the one-account index. Until `milestone-1` is live, add no migrations to `main`.

## 2. Required before staff beta (about 8 staff)

| # | Task | Who | Done when | Status |
|---|---|---|---|---|
| 2.1 | Sign-in policy | | Moved to 1.13 | — |
| 2.2 | Account review | | Moved to 1.14 | — |
| 2.3 | At least two admins who cover every campus; campus staff (and any campus admins) limited to their campus | O | Settings → Checks "At least two admins: Yes". Campus-limited admins can manage only accounts at their campuses and can't widen anyone's access (#69) | Owner |
| 2.4 | Staff accounts added and linked to their People records by an admin | A | Each staff member's account is linked (Settings → Accounts) | Owner (after the deploy) |
| 2.5 | Real-device check by 2–3 staff (§A) | S + D | Every row in §A passes on an iPhone and an Android | Blocked (after the deploy) |
| 2.6 | Email delivery (§B) | S + D | Codes and schedule emails arrive in Gmail and Outlook inboxes, not spam | Blocked (after the deploy, needs 1.4's SMTP settings) |
| 2.7 | Kids' check-in access list empty or minimal | A | Settings → Accounts: only those who must have it (check-in stays on Subsplash; see 1.15) | Owner |
| 2.8 | Feedback route agreed | O | Who triages the Feedback page weekly; a named person for problems | Owner |
| 2.9 | Staff walkthrough (30 minutes) | O + D | Sign in, install on phone, notifications on, My schedule, Chat, Tasks, Help, Feedback. Announcements send real pushes and inbox messages to everyone in their audience, so don't demonstrate one to the whole church †. The [leadership demo guide](leadership-preview.md#c-leadership-demo-guide-3045-minutes) can be reused | Owner (after the deploy; D can prepare it now) |
| 2.10 | Tell staff what isn't in the beta | O | Kids' check-in, giving and media stay where they are | Owner |

Staff use: chat, tasks, people, planning, announcements, feedback, Help. **Not before the freeze ends:**
nothing new is onboarded from 19 Dec to 3 Jan.

## 3. Required before ministry leader beta (worship and production first, then other ministries)

| # | Task | Who | Done when |
|---|---|---|---|
| 3.1 | Staff beta ran at least two weeks with no open "blocks Sunday" feedback | O + D | Feedback page: nothing open at that severity |
| 3.2 | Faith Teams import rehearsal on a copy, then the real import (§C) | A + D | Counts match; no duplicates; no account linked by the import |
| 3.3 | Campuses assigned to imported households that need one | A | Unassigned households reviewed (they stay visible to authorised check-in leaders on purpose) |
| 3.4 | Serving campuses set for volunteers who serve at more than one campus | A | Otherwise they're only offered at their home campus |
| 3.5 | Teams and team leaders set up; leaders' accounts linked | A | Each leader's account linked; leader access follows from leading a team |
| 3.6 | Leader permission spot-check on production | D + a leader | A leader sees their teams and contact details, no health data, private notes or other campuses |
| 3.7 | Push and schedule loop on real devices, as a leader and a volunteer (§A) | S + D | Request → Accept from push and email → leader sees it; Remind works |
| 3.8 | Forms: the forms in use are set up, and the retention rule is agreed before any collects sensitive information | O + A | [permissions.md → Forms](permissions.md#forms) |
| 3.9 | Recurring availability, **only if** the worship team says it needs it | O | Decision recorded (deferred otherwise) |
| 3.10 | Leader walkthrough (20 minutes) and a phone card for volunteers | O + D | Install, notifications, accept your first request; volunteers can stay on email links |
| 3.11 | One champion per ministry; per-ministry retirement of Faith Teams workflows | O | [roadmap §10](master-product-roadmap.md#10-retirement-per-ministry-by-workflow) |
| 3.12 | Decide whether any minors have accounts † | O | Decision recorded ([roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation) item 8; recommended: no) |

## 4. Can wait until after beta

| Item | Why it can wait |
|---|---|
| Kids' check-in replacing Subsplash | Separate, safety-critical release with its own approvals |
| Recurring availability | Deferred unless worship needs it |
| Warn-only ceiling on sign-in codes to existing members | Members are already limited per email and per connection; production uses invited sign-in |
| Automatic deletion of old form responses | Manual deletion and the retention rule cover the beta |
| Tasks place picker listing small groups; per-person grouping of reminder emails | Convenience only |
| Re-running the team-leader rule's campus scope for auto-leaders with "all campuses" | Older behaviour, documented in [permissions.md](permissions.md); reviewed again after beta |
| Campus-limited admin edge decisions (narrowing on promotion, flagged accounts, church-wide announcements, cross-campus team leaders) | Safe defaults are in place; see [permissions.md → Campus-limited admins](permissions.md) |
| Visual redesign | Design direction under review; doesn't block the beta |
| Phone layout of the Settings → Accounts table | Wider than a phone screen; admins use a laptop for account management during the beta |
| Giving and media replacement | Later stages |
| Running `npm run test:ui` in CI | Run by hand before each deploy (1.8); CI would need a browser install (free, but slower) |
| Branch protection on `main` (GitHub → Settings → Branches: require the Tests check) | Only the owner merges today; worth turning on soon after the deploy |
| Tidying env var names (`MB_BACKUPS` in the `Dockerfile`, missing lines in `.env.example`) | Harmless today; [tech-debt.md](tech-debt.md) 12 and 13 |

## A. Real-device checks
| Check | Pass when |
|---|---|
| Sign in (Google or email code), sign out | Works on iPhone Safari, Android Chrome and a laptop; signing out on one leaves the others signed in |
| Install on home screen | Opens full screen, right icon and name |
| Push notifications (iPhone home-screen app, iOS 16.4+; Android) | A schedule request arrives as a push, opens the right page, Accept works from it |
| Chat | A team message arrives live and as a push; a small-group chat push says "New message" without the text |
| Camera upload | Profile photo and a chat photo |
| Forms | A test form filled in on a phone without an account appears for staff |
| Help, Feedback, dark mode, large text | Readable, nothing cut off |

## B. Email delivery
| Check | Pass when |
|---|---|
| Sign-in code | Arrives within a minute in Gmail and Outlook, not spam |
| Schedule request with Accept/Decline links | Links work from Gmail (web and app) and Outlook |
| Automatic reminder | Arrives about `reminder_hours` before; no double message after a "Remind" |
| Sender name | Looks right to a volunteer |

## C. Faith Teams import
On a **copy** first (offline mode, as in [restore-drill.md](restore-drill.md)): export People from Faith
Teams, import (Settings → Import people), then check counts, spot-check 20 records, check campuses,
confirm no account was linked. Then on production in a quiet window, after a backup.
