# Beta launch checklist

How we get from `milestone-1` to staff using the hub, then ministry leaders, safely. Each item is in
the **earliest** stage that needs it. Kids' check-in is **not** in any of these stages: it stays on
Subsplash until the separate child-safety release is approved ([plans/child-safety](plans/child-safety/)).

**Who:** **O** = owner · **A** = an admin · **D** = developer (agent) · **S** = staff testers.
**Dates** follow [roadmap §7](master-product-roadmap.md#7-beta-plan): staff in mid-December, before the
19 Dec – 3 Jan freeze; worship and production in late January; other ministries February to early
March. No onboarding during freezes or a check-in pilot week.

## 1. Required before deployment
Nothing is merged to `main` (which deploys) until every line is done.

| # | Task | Who | Done when |
|---|---|---|---|
| 1.1 | Approve the deploy | O | Written approval, with a date |
| 1.2 | `MB_DEV_LOGIN` is **not set** on Render | O | Render → service → Environment has no `MB_DEV_LOGIN` |
| 1.3 | `MB_TRUST_PROXY` is exactly `1` on Render | O | Render → Environment shows `1` (not `true`) |
| 1.4 | People can sign in without test sign-in | O | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `MB_SMTP_USER`/`MB_SMTP_PASS` set on Render |
| 1.5 | `MB_BACKUP_PASSWORD` is set, and kept by two people outside the hub | O | Settings → Backups shows backups running |
| 1.6 | Restore drill passed with a real backup | O + D | [restore-drill.md](restore-drill.md) record row filled in, "Restore check passed" |
| 1.7 | One-account-per-person audit run on production | O (Render Shell) + D | `node scripts/audit-account-links.js` (read-only) output shared (ids and counts only). Duplicates, if any, are resolved by an admin as in [account-links.md](account-links.md), or knowingly left (the rule then waits; admins see a warning) |
| 1.8 | All checks green on `milestone-1` | D | CI green; `npm test` and `npm run test:ui` pass on the day |
| 1.9 | Fresh backup just before the deploy, downloaded and kept off shared drives | O | Settings → Backups → Back up now → Download |
| 1.10 | Deploy window | O + D | Not Saturday evening or Sunday; someone available for an hour after |
| 1.11 | Right after the deploy: Settings → Checks has no "No" | A + D | Screenshot of Settings → Checks; "Your address as this server sees it" matches a what-is-my-IP site |
| 1.12 | Smoke test on production (10 minutes) | D + A | Sign in, People, a service, Chat, Help, Feedback, Settings → Checks, sign out |

**What the deploy does:** runs migrations 30–35 (new columns and tables only), hashes existing
sessions (everyone signs in again within 24 hours), and creates the one-account index if there are no
duplicates. **If it has to be rolled back:** restore the code, then clear `sessions` (after a backup);
see [merge-log.md](merge-log.md).

## 2. Required before staff beta (about 8 staff)

| # | Task | Who | Done when |
|---|---|---|---|
| 2.1 | Sign-in policy set to **invited** | A | Settings → Checks "Only invited people can create accounts: Yes" |
| 2.2 | Account review: every leader, staff and admin account is someone who should have it | O + A | Settings → Accounts reviewed; extra access removed |
| 2.3 | At least two admins who cover every campus; campus staff (and any campus admins) limited to their campus | O | Settings → Checks "At least two admins: Yes". Campus-limited admins can manage only accounts at their campuses and can't widen anyone's access (#69) |
| 2.4 | Staff accounts added and linked to their People records by an admin | A | Each staff member's account is linked (Settings → Accounts) |
| 2.5 | Real-device check by 2–3 staff (§A) | S + D | Every row in §A passes on an iPhone and an Android |
| 2.6 | Email delivery (§B) | S + D | Codes and schedule emails arrive in Gmail and Outlook inboxes, not spam |
| 2.7 | Kids' check-in access list empty or minimal | A | Settings → Accounts: only those who must have it (check-in stays on Subsplash) |
| 2.8 | Feedback route agreed | O | Who triages the Feedback page weekly; a named person for problems |
| 2.9 | Staff walkthrough (30 minutes) | O + D | Sign in, install on phone, notifications on, My schedule, Chat, Tasks, Help, Feedback |
| 2.10 | Tell staff what isn't in the beta | O | Kids' check-in, giving and media stay where they are |

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
