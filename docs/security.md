# Security and privacy standards

A church hub holds children's medical notes, family details, giving records, pastoral notes and
private conversations. Treat every change as if a family's trust depends on it. The Security
Specialist audits against this page; developers build to it. Access rules: [permissions.md](permissions.md).
Where data lives: [database.md](database.md#sensitive-data).

## Non-negotiables

1. **Secrets live only in Render's environment settings** (`STRIPE_*`, `MUX_*`, `MB_SMTP_PASS`,
   `MB_DAILY_API_KEY`, `MB_BACKUP_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`). Never in
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
| CSRF | `x-mb` header on non-GET | `requireAppHeader` |
| Stations | Paired tokens stored as SHA-256 hashes; check-in endpoints and own campus only | `routes/stations.js` |
| Email links | HMAC-signed per assignment (`assignmentSig`), timing-safe compare | `notify.js`, `routes/app.js` |
| Webhooks | Stripe signature verified over the raw body | `stripe.js` |
| Uploads | Size limits per route; photos and files served only to signed-in volunteers+; public app pictures under `/uploads/app` only (`isAppImage` check) | `index.js`, routes |
| Headers | `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` | `index.js` |
| Rate limits | In-memory per-IP limits on public forms (connect cards, event sign-ups) | `routes/app.js`, `events.js` |
| Audit | `audit_log` for significant changes | `http.js` |
| Backups | AES-256-GCM with a key derived (scrypt) from `MB_BACKUP_PASSWORD`; Drive access limited to files the hub creates | `backup.js` |
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
