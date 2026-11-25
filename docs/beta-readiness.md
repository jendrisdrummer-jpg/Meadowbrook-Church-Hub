# Staff beta readiness

What has to be true before staff and team leaders use the hub for real (Stage 1, Milestone 1),
who does each part, and how we know it's done. Kids' check-in is **not** part of this beta: it
stays on Subsplash until the child-safety release is approved ([plans/child-safety](plans/child-safety/)).

**Status key:** ✅ done · 🧪 built, needs testing on real devices or with real data · ⛔ blocks deployment.

## 1. Deployment gate (all must be ✅ before `milestone-1` is merged to `main`)

| # | Item | Who | How we know | Status |
|---|---|---|---|---|
| D1 | Owner approves the deploy | Owner | Written approval | ⛔ |
| D2 | `MB_DEV_LOGIN` is **not** set on Render | Owner | Render → service → Environment: no `MB_DEV_LOGIN` entry. After deploy, Settings → Checks says "Test sign-in is off: Yes" | ⛔ until confirmed |
| D3 | `MB_TRUST_PROXY` is exactly `1` on Render | Owner | Render → Environment shows `1` (not `true`). After deploy, Settings → Checks says "Yes" | ⛔ until confirmed |
| D4 | A people sign-in method works without test sign-in | Owner | Google sign-in or email codes (`MB_SMTP_*`) set on Render; Settings → Checks "People have a way to sign in: Yes" | ⛔ until confirmed |
| D5 | One account per person: production audit run | Owner (Render Shell), developer | `node scripts/audit-account-links.js` (read-only) prints no duplicates; if any, an admin resolves them by hand as in [account-links.md](account-links.md). Either way the deploy is safe: with duplicates the rule just isn't enforced yet and admins see a warning | ⛔ until run |
| D6 | A fresh backup just before the deploy, downloaded | Owner | Settings → Backups → Back up now → Download; keep it off shared drives | ⛔ at deploy time |
| D7 | Restore drill passed with a real backup | Owner + developer | [restore-drill.md](restore-drill.md) record row filled in, "Restore check passed" | ⛔ until done |
| D8 | All automated checks green on `milestone-1` | Developer | CI green; `npm test` and `npm run test:ui` pass | ✅ (re-run on the day) |
| D9 | Deploy window agreed | Owner | Not Saturday evening or Sunday; someone available for an hour after | ⛔ at deploy time |

The deploy runs migrations 30–35 (all additive: new columns and tables only) plus the session
and account-link changes listed in [merge-log.md](merge-log.md). People stay signed in through the
deploy, but sessions from before it end within 24 hours (hashed sessions, #64), so everyone signs in
again within a day. If the deploy is ever rolled back, clear `sessions` (after a backup).

## 2. Real-device testing (🧪, before staff are invited)

Run on the **real** hub after the deploy, with two or three staff, using real accounts.

| Check | Devices | Pass when |
|---|---|---|
| Sign in (Google and/or email code), sign out | iPhone Safari, Android Chrome, a laptop | Works on each; sign-out on one device leaves the others signed in |
| Install the app on the home screen | iPhone, Android | Opens full screen; icon and name right |
| Push notifications | iPhone (home-screen app, iOS 16.4+), Android | A schedule request arrives as a push; tapping it opens the right page; Accept from the push works |
| Schedule loop | Phone | Request → Accept/Can't make it (app and email link) → leader sees it; "Remind N" sends one reminder |
| Chat | Two phones | Team chat message arrives live and as a push; a small-group chat shows "New message" without the text |
| Camera upload | Phone | Profile photo and a chat photo upload |
| Forms | Phone, no account | Fill in a test form; staff see it in Forms |
| Help and Feedback | Phone | Help opens; feedback arrives in the Feedback page |
| Dark mode, large text | iPhone | Readable, nothing cut off |

## 3. Email and push delivery (🧪)

| Check | Pass when |
|---|---|
| Sign-in code email | Arrives within a minute in Gmail and Outlook, not in spam |
| Schedule request email with Accept/Decline links | Links work from Gmail (web and app) and Outlook |
| Automatic reminder | Arrives about `reminder_hours` before the service; a person nudged with "Remind" in the last 6 hours isn't sent a second one |
| Push on iPhone and Android | As in section 2 |
| Sender name and reply-to | Look right to a volunteer |

## 4. Faith Teams import rehearsal (🧪)

On a **copy**, never on production first: export People from Faith Teams, import into a local or
offline copy (Settings → Import people), then check:
- counts match Faith Teams (people, households)
- no duplicates of people already in the hub; spot-check 20 records
- campuses: households without one are flagged; plan who assigns them
- nothing is linked to an account by the import (accounts are linked by an admin only)
- teams and leaders re-created as planned

Then repeat on production during the deploy window, with a backup taken first.

## 5. Backup and restore drill with an actual backup (🧪 → ⛔ D7)

Follow [restore-drill.md](restore-drill.md) on a laptop with a real production backup, in offline
mode. Record the result. Re-run before any later release with migrations, then quarterly.

## 6. Account and permission review (🧪)

| Check | Who | Pass when |
|---|---|---|
| Settings → Sign-in: policy is **invited** for the beta | Owner | Settings → Checks "Only invited people can create accounts: Yes" |
| Every account with leader, staff or admin is someone who should have it | Owner | Settings → Accounts list reviewed; remove or lower the rest |
| At least two admins | Owner | Settings → Checks |
| Campus limits set for campus staff | Owner | Each campus-limited account sees only its campus |
| Admins are church-wide | Owner | Today a campus-limited **admin** can still change any account's access, including their own campus limit (an older gap; fixing it is an owner decision). Until then, give admin only to people trusted with every campus |
| Unlinked accounts | Office | Settings → Accounts "not linked to a person" list handled; links made by an admin only |
| Finance flag only for those who handle giving | Owner | Reviewed |
| Spot-check as a leader and a volunteer | Developer + a leader | A leader sees their teams but no health data, private notes or other campuses; a volunteer sees their own schedule |

## 7. Check-in and campus access (🧪; kids' check-in itself is a later release)

- Kids' check-in stays on **Subsplash** for the beta.
- Who may open check-in in the hub: staff, paired stations, and leaders an admin has named
  (Settings → Accounts → Kids' check-in). Keep that list empty or minimal during the beta.
- Households without a campus are visible to authorised check-in leaders on purpose; assign
  campuses as part of the import clean-up.
- Serving campuses: set them for volunteers who serve at more than one campus, or they're only
  offered at their home campus.

## 8. Staff onboarding and training (🧪)

- First group: office staff and the worship team leaders (roadmap §7), then other ministries.
- A 30-minute walk-through: sign in, install on the phone, My schedule, Help page, Feedback.
- Leaders: schedule a service, send requests, Remind, Message team, small groups (Help covers each).
- A named person for Sunday questions, and the weekly feedback triage (roadmap §9).
- Tell people what isn't in the beta: kids' check-in, giving, media replacement.

## 9. Remaining production configuration

| Setting | Where | Notes |
|---|---|---|
| `MB_DEV_LOGIN` absent, `MB_TRUST_PROXY=1` | Render → Environment | D2, D3 |
| `MB_SMTP_USER`, `MB_SMTP_PASS`, `MB_MAIL_FROM` | Render → Environment | Email |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Render → Environment | Google sign-in and Drive backups |
| `MB_BACKUP_PASSWORD` | Render → Environment | Kept by two people, outside the hub |
| Google Drive connected for backups | Settings → Backups | Second copy off the server |
| Sign-in policy **invited** | Settings → Sign-in & accounts | |
| `reminder_hours`, church name, campuses and time zones | Settings | |
| Forms: retention rule agreed before collecting anything sensitive | [permissions.md → Forms](permissions.md#forms) | |

After the deploy, Settings → Checks should show no "No".

## What is ready, what needs testing, what blocks deployment

- **Ready (built, automated tests and browser checks pass, security-reviewed):** privacy fixes,
  check-in access limits, account onboarding with admin-only linking, feedback, campus eligibility,
  scheduling loop, small groups, forms, Help, restore tooling, production checks, hashed sessions
  and live-connection revocation (see [merge-log.md](merge-log.md) for each PR and its checks).
- **Needs testing with real devices or real data:** sections 2–8 above.
- **Blocks deployment:** D1–D7 and D9.
