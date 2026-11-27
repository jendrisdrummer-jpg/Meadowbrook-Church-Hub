# Security and privacy standards

A church hub holds children's medical notes, family details, giving records, pastoral notes and
private conversations. Treat every change as if a family's trust depends on it. The Security
Specialist audits against this page; developers build to it. Access rules: [permissions.md](permissions.md).
Where data lives: [database.md](database.md#sensitive-data).

## Non-negotiables

1. **Secrets live only in Render's environment settings** (`STRIPE_*`, `MUX_*`, `MB_SMTP_PASS`,
   `MB_DAILY_API_KEY`, `MB_BACKUP_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`; the key is only ever sent to YouTube’s API, and Media → Setup shows only whether it is on). Never in
   code, tests, docs, commits, PRs, chat or logs. `.env` is git-ignored.
2. **Every API route has an explicit guard**: a role, a permission flag, membership, a signed
   link, or a deliberate public decision with a comment saying why.
3. **Campus-limited accounts never see other campuses' data** (`canCampus`, `campusFilter`).
4. **Giving data requires the Finance flag** in every path: lists, exports, search, dashboards,
   notifications, emails.
5. **Parameterized SQL only.** Dynamic column names come from fixed allow-lists.
6. **All HTML is built with the escaping `html` template** in `lib.js`; `raw()` only for markup
   the code itself built, never for user text.
7. **Non-GET requests require `x-mb: 1`** (CSRF protection). Don't add exceptions except
   signed webhooks.
8. **No destructive data operations without the owner's approval and a fresh backup.**
9. **Security controls are never weakened to make something work.** Find another way or ask.
10. `MB_DEV_LOGIN` must never be set in production.

## What exists today

| Area | How it works | Code |
|---|---|---|
| Sessions | Random token in the cookie `mb_session` (HTTP-only, `SameSite=Lax`, `Secure` behind HTTPS, 30 days); `sessions` stores only its sha256, so a copy of the database holds no usable cookie. Sessions made before this change are hashed in place on startup (`hashSessionTokens`, idempotent, one `BEGIN IMMEDIATE` transaction; if it fails the server still starts and those people sign in again) and then end within 24 hours, so a backup or copy made before this release stops holding usable sign-ins within a day. Live streams re-check the session and that the account is active on every send and ping, failing closed. After a rollback to an older release, run `DELETE FROM sessions` (after a backup): the old code would otherwise accept stored hashes as cookies. Signing out, deactivating, deleting, or changing an account's role, campuses or linked person closes its open live chat streams (`closeStreams` in `live.js`); a stream also stops once its session has expired | `auth.js`, `live.js`, `db.js` |
| Sign-in | Google OAuth (state cookie), email one-time codes (hashed, attempt-limited, expiring), passwords (scrypt) | `auth.js` |
| Sign-in policy | anyone / people in the directory / Workspace domain / invited only. Decides who may sign in, never who they are: accounts start unlinked and an admin links them (audited `user.link`) | Settings → Sign-in |
| Account links | One account per person: 409 on every write path, plus a unique index on `users.person_id` created at startup when no duplicates exist (see [account-links.md](account-links.md)) | `db.js`, `routes/setup.js`, `scripts/audit-account-links.js` |
| Campus-limited admins | An admin with a campus list can't change their own access, can't touch accounts outside their reach (admins, other campuses), can't make admins or change Finance or Announcements, and can't reach church-wide admin routes (settings, backups and Drive, import, profile fields, campuses create, app icon, live-stream key). The team-leader rule can't hand a limited actor's leader a wider campus list than the actor's. Unrestricted admins are unchanged. See [permissions.md](permissions.md#campus-limited-admins) | `auth.js` (`accountInReach`, `requireAllCampuses`), `routes/setup.js` |
| CSRF | `x-mb` header on non-GET | `requireAppHeader` |
| Stations | Paired tokens stored as SHA-256 hashes; check-in endpoints and own campus only | `routes/stations.js` |
| Email links | HMAC-signed per assignment (`assignmentSig`), timing-safe compare | `notify.js`, `routes/app.js` |
| Webhooks | Stripe signature verified over the raw body | `stripe.js` |
| Uploads | Size limits per route; photos and files served only to signed-in volunteers+; public app pictures under `/uploads/app` only (`isAppImage` check) | `index.js`, routes |
| Headers | `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` | `index.js` |
| Rate limits | In-memory limiters (per process; each route area creates its own when the app starts) for sign-in passwords and codes, connect cards, event sign-ups, forms, giving checkout, guest push and station pairing. IPv6 counts per /64, and also per /48 at a multiple of the per-address limit (16× for connect cards, event sign-ups, forms and guest push; 8× for code requests, password tries, giving checkout and station pairing), so one connection can't spread across its addresses while a shared network of many /64s isn't locked out by one busy neighbour; IPv4 per address. Checks run before anything is recorded (both the /64 and /48 must pass), so a refused client creates no new keys. Sign-in email keys live in their own limiter, apart from the address keys, and a password try with something that isn't an email address is refused (same 401 wording) before any key is made. When a table is full, stale entries go first, then the least recently used; entries at their limit (a locked-out key) are dropped only if nothing else is left, and the table is never wiped, so a flood of addresses or emails can't reset limits. A value that isn't a valid IP address gets its own bucket (its text, cut to 64 characters), never a real address's. Needs `MB_TRUST_PROXY=1` on Render to see real addresses (Settings → Checks shows the address the server sees for you) | `ratelimit.js`, `auth.js` |
| Sign-in code emails | “Email me a code” answers `{ok:true}` straight away for every valid email, before any lookup, database write or send, so neither the answer nor its timing tells anyone whether an address has an account. Afterwards it sends a code only when the address has an active account or the sign-in policy would let it create one (`anyone`; `directory` for someone in People or the church domain; `domain` for the church domain; under `invited` only those with accounts; listed admin emails and a brand-new install's first admin). Per email: 5 an hour; per connection: 20 an hour (IPv6 /64), 160 per /48 (these 429s depend only on volume, the same for every email). Server-wide, `max_code_emails_per_hour` (default 200, admins only): every valid request takes a slot the same way, but only emails that would create a new account are held back when it's full (no email, the same answer, one warning an hour, and a warning on Settings → Checks); people with accounts are never refused by it. Production should use `invited` (or `directory`). Password and Google sign-in are unaffected | `auth.js` |
| Production checks | Settings → Checks (admins): test sign-in off, `MB_TRUST_PROXY` set to the host's proxy hops (2 on Render), offline mode off, invited sign-in, email and sign-in methods, backups (password, recent, Drive), two admins, one account per person. Yes/no with explanations; never shows a secret. Also shows the requesting admin's own address as the server sees it (not stored), to compare with a “what is my IP” site and confirm the proxy setting | `routes/checks.js` |
| Classes | Every route is guarded and campus scoped (staff, a named class manager, or the enrolled person); the right quiz answers go to staff only; a make-up's video and test aren't sent until it is open; quiz tries are limited to 20 an hour per person; video credit can't outrun real time. Class videos are **YouTube Unlisted**: anyone with the link can watch, so keep confidential teaching out of them. Progress pings and quiz tries are not audited (too frequent); every staff or manager change is. Not built: Mux signed playback (it would need `MUX_SIGNING_KEY_ID` and `MUX_SIGNING_KEY_PRIVATE` in Render and a paid Mux account; names only, never values). | `routes/classes.js`, `classes.js` |
| Audit | `audit_log` for significant changes | `http.js` |
| Backups | AES-256-GCM with a key derived (scrypt) from `MB_BACKUP_PASSWORD`; Drive access limited to files the hub creates | `backup.js` |
| The demo seed can't wipe real data | `scripts/seed-demo.js` deletes the database it points at, and the Docker image ships `scripts/` next to `MB_DB=/data/meadowbrook.db`. So the seed refuses to run when `NODE_ENV=production` or `RENDER` is set, when the target is outside this project's `data/` folder (symlinks followed), and when the file exists but lacks the `sample_data` marker (checked read-only before anything is deleted). The seed writes the marker | `server/sample.js`, `test/seed-guard.test.js` |
| Copies of real data on a laptop | Offline mode (`MB_OFFLINE=1`) refuses every outgoing web request except to the machine itself (redirects included), keeps email in the local outbox, listens on 127.0.0.1 only, and starts no background jobs, so a copy can't push to phones, send email or reminders, or touch the church's Drive. The restore script asks for the password without echo, never overwrites, writes files readable by you only, and refuses to write inside the code folder; the check opens copies read-only. Session tokens are stored hashed, so a decrypted copy holds no usable sign-ins | `offline.js`, `restore-check.js`, [restore-drill.md](restore-drill.md) |

## Severity scale (for findings)

| Severity | Meaning | Response |
|---|---|---|
| **Critical** | Anyone (or any account) can read or change data they shouldn't at scale: auth bypass, SQL injection, exposed secrets, giving or children's medical data readable without access | Stop and fix before anything else; tell the owner now |
| **High** | A signed-in account can reach another person's private data or act beyond their role; stored XSS; missing guard on a sensitive route | Fix in the current cycle; blocks releases touching that area |
| **Medium** | Defence-in-depth gaps: missing rate limit, overly broad public response, weak audit, information leaks in errors | Schedule; fix before the next significant release |
| **Low** | Hardening and hygiene: headers, logging detail, dependency pinning | Backlog |

Each finding: **where** (file:line), **what** could happen and to whom, **how** to reproduce
(safely, read-only), **fix** (specific), **severity**.

## Review checklist for a change

- [ ] Every new route has the right guard and campus scoping; lower roles get 403 (tested).
- [ ] Public responses include only fields a guest should see.
- [ ] Inputs are validated with `http.js` helpers and length-limited.
- [ ] No user text reaches the page without escaping.
- [ ] File uploads: size limit, type check where it matters, stored under `MB_UPLOADS`, served
      with the right guard, no user-controlled paths.
- [ ] Sensitive data isn't sent in notifications, push payloads, emails or logs beyond need.
- [ ] Giving data: Finance flag on every path.
- [ ] Children's data: shown only where check-in and care need it.
- [ ] New outside service: data shared is the minimum, credentials are env vars, tests use a stand-in.
- [ ] Audit entries for changes to people, money, permissions and settings.

## Multi-church readiness (security view)

Isolation today comes from separate deployments. Before any shared hosting of several churches,
the following must be designed and reviewed: a tenant boundary enforced in one place (not per
query), per-church secrets for integrations, per-church backups and restores, cross-tenant tests
that try to read another church's data, and super-admin access that is logged. See
[architecture.md](architecture.md#multi-church-saas-readiness).
