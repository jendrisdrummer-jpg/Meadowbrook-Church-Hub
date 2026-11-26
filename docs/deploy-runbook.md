# Deploy and rollback runbook

How to put `milestone-1` live on Render, what to watch afterwards, and how to undo it. Written for
the owner, who presses the buttons; the developer prepares and stays on hand. It covers the
**first** deploy from `milestone-1` (migrations 30–35). Later releases follow the same steps with
their own notes in [merge-log.md](merge-log.md). Kids' check-in is a separate release with its own
plan.

**Never:** deploy in a freeze (19 Dec – 3 Jan), on a Saturday evening or on a Sunday. Never paste
a secret (passwords, keys, the backup password) into chat, a document or a commit.

## What the deploy does

When the new code starts on Render it opens the database and, in this order (`openDb` in
`server/db.js`):

1. **Migrations 30–35.** New columns and tables only; nothing is removed or renamed. Rehearsed on a
   made-up copy: see the rehearsal record below.
2. **Session hashing.** Stored sign-in sessions are converted to hashes. People stay signed in, but
   those sessions now end within 24 hours, so everyone signs in again within a day.
3. **One-account index.** If no person has two accounts, the database starts enforcing "one person,
   one account". If someone does, the index is skipped with a warning and nothing is changed
   ([account-links.md](account-links.md)).

The hub is offline for a minute or two while Render swaps the old version for the new one (a
service with a disk can't run two copies at once). Pick a quiet time.

## Before the deploy

1. Every row of [beta-readiness.md §1](beta-readiness.md#1-required-before-deployment) is done,
   except 1.11 and 1.12 (those happen after). Don't repeat them here; the checklist is the record.
2. **On the day,** the developer confirms: CI is green on `milestone-1`, `npm test` and
   `npm run test:ui` pass, and no new commits have landed since the restore drill.
3. **Fresh backup** (checklist 1.9): Settings → Backups → **Back up now**, then **Download** it.
   Keep the file on your own computer, not a shared drive. This is what a real restore would use.
   **Safeguard: don't merge until the developer has confirmed all three** (from your screenshots):
   - the top row of Settings → Backups → Copies is from **today, minutes ago**, says **Google Drive ·
     This server** and status **OK**;
   - the downloaded file is on your computer: its name ends in `.db.gz.enc` and matches that row's
     date and time (the file name uses UTC, so it may read a few hours ahead);
   - no backup started after it is still running.
4. **Write down the current live commit.** Render → the service → **Events**: note the latest
   successful deploy (date and the short commit code). That is what a rollback goes back to.

5. **Safeguard: read the rollback cleanup below** ("Rollback", step B) before merging, so you know
   exactly what it does if it's ever needed.

## The deploy (owner, about 10 minutes)

1. On GitHub, open a pull request from `milestone-1` into `main` (the developer can prepare it;
   only you merge it). Title: "Deploy milestone-1".
2. Wait for the **Tests** check on the pull request to go green. If it's red, stop.
3. Press **Merge pull request**. Merging to `main` is the deploy: Render notices the new commit and
   starts building.
4. In Render → the service → **Events**, watch the new deploy go from "in progress" to **live**
   (usually a few minutes). If it says **failed**, Render keeps the old version running; see
   "If it goes wrong".
5. Open **Logs** and look for the lines in the next section.

## The first hour

Someone stays available for an hour after the deploy.

**1. Render → Logs** (just after it goes live). Look for:

| Line | Means | Do |
|---|---|---|
| `Meadowbrook Church Hub on http://localhost:…` | The server started | Good |
| `WARNING: N person has more than one account (person ids: …)` | The one-account index was skipped | Expected if the audit (1.7) found duplicates. Resolve them in Settings → Accounts ([account-links.md](account-links.md)); the rule turns on by itself |
| `One-account-per-person index not created this time` | The index step couldn't get the lock | Harmless; it tries again at the next start or unlink. Tell the developer |
| `Session conversion failed` | Old sessions weren't converted | Harmless (people sign in again); tell the developer |
| `Google sign-in is not configured` | `GOOGLE_CLIENT_ID` is missing | Check Render → Environment (checklist 1.4) |
| `OFFLINE MODE` | `MB_OFFLINE` is set on Render | Must **never** appear. Remove `MB_OFFLINE` in Render → Environment; it restarts |
| `SqliteError`, or the server restarting over and over | A migration or start-up failed | No-go: roll back (below) |

Share log lines with the developer only after removing email addresses, names and anything that
looks like a code or key. (Without email settings, the log prints each email it would have sent,
sign-in codes included.)

**2. Settings → Checks** (checklist 1.11). Sign in as an admin, open Settings → Checks and take a
screenshot. Every row should say **Yes**, or **Check** for things you've decided on. A **No**:

| Check says No | Fix |
|---|---|
| Test sign-in is off | Remove `MB_DEV_LOGIN` in Render → Environment |
| Real visitor addresses | Set `MB_TRUST_PROXY` to exactly `1` |
| Offline mode is off | Remove `MB_OFFLINE` |
| Email can be sent | Set `MB_SMTP_USER` and `MB_SMTP_PASS`. This is a No even if you only use Google sign-in, because schedule requests and reminders go by email |
| People have a way to sign in | Google or email settings (checklist 1.4) |
| Backups are encrypted / recent | `MB_BACKUP_PASSWORD`; then Back up now |
| One account per person | Duplicates exist (see the log line above). Not a reason to roll back |

Also compare "Your address as this server sees it" with a what-is-my-IP website. If they differ,
`MB_TRUST_PROXY` is wrong.

**3. Smoke test** (checklist 1.12, 10 minutes, on a laptop and a phone): sign in, People (open a
person), a service plan, Chat (send a message), Help, Feedback (send one marked "nice to have" and
delete it afterwards), Settings → Checks, sign out. Don't send a test announcement to the whole
church: announcements push to real phones.

**4. Later that day:** Render's health check is green, and Settings → Backups shows the nightly
backup the next morning.

## Go or no-go

**Prefer fixing forward.** A rollback brings back the privacy gaps this release closes (leaders
seeing health information, #51, and wider kids' check-in access, #52), so roll back only when:

- the server won't start or keeps restarting, or
- data is being lost or damaged, or the wrong people can see private data, or
- sign-in is broken for everyone and a settings fix (Render → Environment) doesn't solve it within
  about 30 minutes.

Anything else (a page looks wrong, one feature fails, a "Check" on Settings → Checks): note it in
Feedback or tell the developer, and fix forward with a normal pull request into `milestone-1`.

## Rollback

**A. Put the old code back** (5–10 minutes).
1. Render → the service → **Events**: find the deploy you wrote down before (the last one before
   today's) and choose **Rollback** on it (Render offers this on previous deploys). Confirm.
   If you can't find it, use **Manual Deploy** and pick that commit.
2. Render may switch off automatic deploys after a rollback. That's what we want for now: it stops
   the next merge from deploying by accident. Note whether it did; the developer will say when to
   turn it back on.
3. Ask the developer to open a revert pull request on `main`, so `main` matches what is live.
   Don't merge anything else into `main` until the developer has a fix.

The database stays as it is. The new tables and columns are simply ignored by the old code
(rehearsed: the old code starts on the upgraded database and works).

**B. Clean up two things the old code can't handle** (Render Shell, about 5 minutes).
1. Settings → Backups → **Back up now** first, and wait for it to finish.
2. Render → the service → **Shell**, and paste this one line:
   ```sh
   node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.MB_DB);console.log('sessions removed:',d.prepare('DELETE FROM sessions').run().changes);d.exec('DROP INDEX IF EXISTS users_person_unique');console.log('done')"
   ```
   It runs these two statements:
   ```sql
   DELETE FROM sessions;
   DROP INDEX IF EXISTS users_person_unique;
   ```
   - `DELETE FROM sessions` signs everyone out. It's needed because the old code would accept the
     stored session hashes as sign-in cookies, so anyone holding a copy of the database could sign in.
     (Rehearsed: with the old code, a stored hash sent as a cookie was accepted.)
   - `DROP INDEX` removes an index only; no data is lost. The old code links accounts by email at
     sign-in and moves accounts when merging people, and the index would make those fail.

   **The line, part by part:**
   | Part | In plain English |
   |---|---|
   | `node --disable-warning=ExperimentalWarning -e "…"` | Run the short program in quotes with the hub's own Node.js; hide a harmless "experimental" notice |
   | `const {DatabaseSync}=require('node:sqlite')` | Load Node's built-in database tool (no download, nothing installed) |
   | `new DatabaseSync(process.env.MB_DB)` | Open the hub's database at the path Render already uses (`/data/meadowbrook.db`, from the `Dockerfile`) |
   | `d.prepare('DELETE FROM sessions').run().changes` | Delete every row in the `sessions` table and count them |
   | `console.log('sessions removed:', …)` | Print how many were removed |
   | `d.exec('DROP INDEX IF EXISTS users_person_unique')` | Remove the one-account rule; if it isn't there, do nothing |
   | `console.log('done')` | Print "done" when finished |

   **Exactly what it changes, and nothing else:** every row of the `sessions` table (sign-ins only:
   a token, an account number and an expiry time each) and the `users_person_unique` index (a rule,
   not data). No row in any other table is read, changed or deleted: people, households, accounts,
   teams, services, schedules, chats, messages, check-ins, gifts, forms and the audit log are
   untouched. Expected output: `sessions removed: <a number>` then `done`. If it prints anything
   else, stop and send the developer the message.
3. Everyone signs in again. Tell staff.

**C. A real restore instead** (rare, needs your explicit decision). Only when data was lost or
damaged, not just because the code was rolled back: follow
[restore-drill.md → A real restore on production](restore-drill.md#a-real-restore-on-production),
using the backup from step 3 of "Before the deploy". Anything entered since that backup is lost,
so the developer writes the exact steps for that day.

**After any rollback: no new migrations on `main`.** The database is now at version 35, so a
migration added to `main`'s older list would be skipped silently. A hotfix must be made from
`milestone-1` (whose migration list matches the database), not from `main`. This rule lasts until
`milestone-1` is live.

## After the deploy: record it

Add a line to [merge-log.md](merge-log.md) under "Deployed to production" (the developer can do it
in a pull request):

```
| <date> | #<PR> | Deployed milestone-1 to production: migrations 30–35; one-account index <created / skipped, N duplicates>; rollback: none | Settings → Checks <all Yes / which said Check or No, and why>; smoke test passed | main |
```
and change "**Deployed to production:** nothing yet" to the date and PR.

Then tick 1.11 and 1.12 in [beta-readiness.md](beta-readiness.md).

## Environment variables on Render

Names only, never values. Render → the service → **Environment**.

| Name | Needed | Shape |
|---|---|---|
| `PUBLIC_URL` | Yes | The hub's address, `https://…`, no trailing slash. Email links and Google sign-in use it |
| `MB_TRUST_PROXY` | Yes | Exactly `1` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google sign-in and Drive backups | From Google Cloud |
| `GOOGLE_WORKSPACE_DOMAIN` | Optional | The church's email domain |
| `MB_SMTP_USER`, `MB_SMTP_PASS` | Yes (email codes, schedule emails) | Gmail address and app password |
| `MB_SMTP_HOST`, `MB_SMTP_PORT`, `MB_MAIL_FROM` | Optional | Other email providers; sender name |
| `MB_BACKUP_PASSWORD` | Yes | Long passphrase, kept by two people outside the hub |
| `MB_ADMIN_EMAILS` | Optional | Comma-separated emails that are always admins |
| `MB_APP_URL` | Optional | The member app's own address |
| `MB_DAILY_API_KEY`, `STRIPE_*`, `YOUTUBE_API_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Only for video calls, giving, media | From each service |
| `MB_DB`, `MB_UPLOADS`, `PORT` | Set by the `Dockerfile` | Leave alone |
| `MB_DEV_LOGIN`, `MB_OFFLINE` | **Must not be set** | Laptop-only |

`RENDER` is set by Render itself; Settings → Checks uses it to apply the production rules.

## Rehearsal record

| Date | Release | What was rehearsed | Result |
|---|---|---|---|
| 2026-11-25 | `milestone-1` at `bbc6b4d` over `main` at `03b094f` | Made-up data only. `main`'s demo seed built a database at schema 29; three sign-ins on `main` created old-style sessions. `milestone-1` started on copies in offline mode. Then `main` started on the upgraded copy (rollback) | Migrations 30–35 applied (schema 35, all six new tables and three columns, integrity ok); `/healthz` answered; three sessions hashed and capped to 24 hours, old cookie still signed in; index created on the clean copy, skipped with the warning on a copy with one duplicate; `npm test` 146/146, `npm run test:ui` 224/224. Rollback: `main` started on schema 35, `/healthz` ok, old cookies refused, a stored hash accepted as a cookie (why sessions are cleared); the cleanup one-liner ran |

The real-data rehearsal is the restore drill run with the `milestone-1` code
([beta-readiness.md](beta-readiness.md) 1.6).

## Known small issues

- **Low:** the `Dockerfile` sets `MB_BACKUPS`, but the server reads `MB_BACKUP_DIR`
  (`server/backup.js`); only `scripts/backup.js` reads `MB_BACKUPS`. Harmless today, because both
  default to `/data/backups`. Logged in [tech-debt.md](tech-debt.md).
- The `Dockerfile`'s `HEALTHCHECK` is for Docker; Render uses the **Health Check Path** in the
  service's settings. There is no `render.yaml`, so check that path is `/healthz`.
