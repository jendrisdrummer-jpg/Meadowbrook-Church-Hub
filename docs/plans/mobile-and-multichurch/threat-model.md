# Threat model: App Store readiness (step 4)

Written by security-specialist on 27 Nov 2026. It is read-only: nothing was run. Section 3.11 and finding F11 come from the addendum on the native bridge, which follows the bridge spike (`spike-bridge.md`).


Scope read: `docs/plans/mobile-and-multichurch/app-store-readiness.md` (including the owner answers in §7), `plan.md`, `docs/security.md`, `docs/permissions.md`, `server/auth.js` (all sign-in lives there; there is no `server/routes/auth*.js`), `server/index.js`, plus the parts of `routes/services.js`, `routes/me.js`, `routes/setup.js`, `routes/notifications.js`, `routes/announcements.js`, `routes/chat.js`, `notify.js`, `db.js` and `mobile/capacitor.config.js` that bear on this design. I changed no files and ran no commands.

## 1. Summary

The sign-in base is solid and worth reusing as it is:
- Session tokens are random and stored hashed.
- Cookies are HttpOnly and SameSite=Lax.
- The OAuth state cookie, `safeNext`, scrypt passwords, hashed and attempt-limited codes, the uniform early answer on `/auth/code`, the layered rate limits and the `x-mb` CSRF header are all in place.

Most of the risk is in the new pieces: tickets, the app return path, Apple tokens, deletion and the reviewer account. Four things in the plan as written need changing before B1 merges:
- **(a)** The reviewer account is not isolated by the volunteer role.
- **(b)** `/auth/app-return*` must not be a universal-link path.
- **(c)** "Confirm deletion with a fresh code" doesn't work for the password-only reviewer account, and the office-request route refuses unlinked accounts.
- **(d)** Two existing enumeration leaks undercut owner decision 2 ("same screen for everyone").

Counts: Critical 0 · High 1 · Medium 5 · Low 4.

## 2. Findings, most severe first

### F1. High (design blocker for submission): a "made-up volunteer" on the live Hub sees real people
- **Where:**
  - `server/routes/services.js:54-66`: `?all=1` lists every service at the account's campuses.
  - `server/routes/services.js:120-136`: "Anyone signed in can look at any service's plan and who's serving". Volunteers get the `first_name`, `last_name`, `nickname` and `photo` of everyone on sent, non-declined assignments.
  - `server/index.js:111`: `/uploads` serves any photo to any volunteer. The filenames come straight from those responses.
  - `server/routes/announcements.js:30`: "everyone" announcements reach every active account, including this one.
  - `campusFilter`/`canCampus` (`auth.js:142-146, 179-183`) always let church-wide (NULL-campus) rows through.
- **What could happen:** an Apple reviewer, who is outside the church, sees the names and photos of real volunteers, including teens on teams, on every real Sunday. They also see real orders of service and church-wide teams and rooms. Pastoral announcements reach the reviewer's inbox and push. Owner decision 6 requires that it "sees no real person's details", and the plan's "made-up team on a made-up service" doesn't deliver that.
- **Reproduce safely:** on `npm run demo` data, sign in as a volunteer and call `GET /api/services?all=1`, then `GET /api/services/<any id>`. Names and photos of people on other teams appear.
- **Fix (new):** see §3.7. In short:
  - Add a server-enforced `demo` flag on `users` (new migration) with an expiry.
  - Add one middleware in the `/api` router that allow-lists routes for demo accounts and 403s everything else.
  - Scope the allowed routes to a made-up campus, with no NULL-campus rows.
  - Leave demo accounts out of announcement fan-out.
  - Allow `/uploads` only for `/uploads/app` and the demo people's own photos.
- **Test:** see §3.7. A test seeds real-looking and demo people, signs in as the demo account, walks every GET route on the router and asserts no non-demo person id, name, photo, email or phone appears.

### F2. Medium (exists today): code-verify answers reveal who may get a code
- **Where:** `server/auth.js:496-502`. With no code row, the answer is "That code has expired. Send a new one." With a pending row and a wrong code, it is "That code isn't right…".
- **Why it leaks:** `/auth/code` creates a row only when `mayHaveAccount()` is true (`auth.js:466`). Under the `directory` policy that means "this email is in People", and church membership can be religious information.
- **Attack:** anyone sends `POST /auth/code` for a target email, then `POST /auth/code/verify` with `000000`, and reads which message comes back. It costs one email to the member, which is noisy, and the existing limits apply (20 an hour per IP, 5 an hour per email). The directory `/verify` would inherit the same leak.
- **Fix:** make the wrong-code and no-code cases identical:
  - The same 400 text for both, for example "That code isn't right, or it has expired. Check the email or send a new one."
  - The same "Too many wrong codes" behaviour, by counting attempts for no-row emails in `emailLimits` (`verify:${email}`, 5 per 15 min).
- **Test:** for an email outside the policy and one inside it (after `/auth/code`), the 1st through 6th wrong-code answers have the same status and body.

### F3. Medium (exists today): password sign-in timing shows which emails have a password
- **Where:** `server/auth.js:439-440`. `!user?.password_hash || checkPassword(...)` skips scrypt (N=16384, tens of milliseconds) when there is no account or no password, so the response time differs.
- **What could happen:** anyone can time `POST /auth/password` (or the directory `/password`, which reuses it) and learn which emails have accounts with passwords. That goes around decision 2. The existing limits (40 per 15 min per IP, 8 per email) slow it down but don't stop it.
- **Fix:** when the user or hash is missing, run `checkPassword(password, DUMMY_HASH)` against a fixed hash made at start-up, then answer with the same mismatch.
- **Test:** a unit test with a spy or stub on `crypto.scryptSync` asserts scrypt runs exactly once for an unknown email, an account without a password and a wrong password. Don't time it in CI.

### F4. Medium (plan): universal-link paths allow sign-in CSRF, and the respond path is wrong
- **Where:** app-store-readiness.md §1, "Universal links". The paths listed are `/app/*`, `/respond*` and `/auth/app-return*`.
- **What could happen:** if `/auth/app-return?t=…` is a universal link, an attacker can email a member a link carrying the attacker's own fresh ticket. The member's app opens and silently signs them in as the attacker, and anything they then type (My info, chat, forms) lands in the attacker's account.
- **Also wrong:** email reply links are `/r/:id/:sig` (`index.js:182`), not `/respond*`, so the planned list misses them.
- **Fix:**
  - The AASA path list is `/app/*` and `/r/*` only. Exclude `/auth/*`, `/api/*` and `/uploads/*`, and keep staff pages out.
  - Only native code may load the app return page, and only with a `state` value it created itself for a flow in progress (§3.4).
  - If a different account is already signed in, `/auth/app-return` asks before replacing it.
- **Test:** the AASA JSON contains no `/auth` component. A ticket redeemed while another user's session cookie is present gets a confirm answer, not a silent switch.

### F5. Medium (plan): reusing the Google callback for the app needs guard rails
- **Where:** `server/auth.js:376-415`. Today the callback calls `startSession` and redirects to the `mb_next` cookie.
- **What could happen:** done naively, the app flow either:
  - starts a 30-day `mb_session` in the ASWebAuthenticationSession browser (Safari's cookie jar when the session isn't ephemeral), or
  - takes its return target from a request parameter, which is an open redirect or ticket exfiltration path.
- **Fix:** §3.4.
- **Test:** §3.4.

### F6. Medium (plan): the deletion flow can't be finished by every account, and leaves gaps
- **Where:** app-store-readiness.md §4, row 5.1.1(v). Also `server/routes/me.js:45-49, 103` (`/me/office-request` returns 409 when the account isn't linked) and `server/routes/setup.js:229-248` (the admin delete path, which is the right base).
- **Problems:**
  - The reviewer account signs in with a password, and Apple reviewers can't receive codes, yet Apple reviewers often test deletion.
  - New self-sign-ups under `directory` are unlinked (`permissions.md:40`), so they can't send an office request at all.
  - The plan doesn't say what happens to a listed `MB_ADMIN_EMAILS` admin or the last admin.
- **Fix:** §3.6.

### F7. Low (exists today): no per-IP or daily limit on code verification
- **Where:** `server/auth.js:493`.
- **Detail:** per code, 5 tries; per email, 5 codes an hour. That allows about 25 guesses an hour per targeted email with no daily cap, and it is noisy because the victim gets every code.
- **Fix:** an `ipAllowed(limits, 'verifyip', …, 60, 15 min, { wide: 8 })` check, plus a per-email cap of 20 wrong codes a day. The directory `/verify` gets the same.

### F8. Low (exists today): signing out doesn't stop Web Push to that device
- **Where:** `server/auth.js:47-54` (`endSession`). `push_subscriptions` rows (`notifications.js:56-66`) live on until the browser says 404/410.
- **What could happen:** a signed-out or shared phone keeps showing that person's schedule and chat previews on the lock screen.
- **Fix:** for APNs, tie tokens to the session (§3.8). For Web Push, consider deleting that browser's subscription on sign-out (the client already knows its endpoint).

### F9. Low: no HSTS and no CSP while the app gives the hub's pages native access
- **Where:** `server/index.js:53-60`.
- **Why it matters now:** inside the shell, every page on the allowed host gets the Capacitor bridge, including staff pages opened in the app. That means Preferences (the offline snapshot), push registration and Share. Any XSS on the host becomes native plugin access. Chat files are already sandboxed (`chat.js:380`).
- **Fix:**
  - `Strict-Transport-Security: max-age=31536000` when `req.secure`.
  - A report-only CSP on `/app/` first.
  - Add to the plan: the shell exposes only the approved plugins.

### F10. Low: the Secure flag depends on the proxy setting
- **Where:** `server/auth.js:34-36` (`req.secure ? '; Secure'`).
- **Detail:** if `MB_TRUST_PROXY` is wrong in production, cookies lose Secure. Settings → Checks already warns.
- **Fix:** also force Secure when `RENDER` or `NODE_ENV=production` is set.

## 3. Threat model by item (ranked). Each control is marked EXISTS or NEW

### 3.1 Directory contract (`/api/directory/v1/*`, single-church now)

Threats: email enumeration (who is a member), mass code-mailing, credential stuffing, over-sharing in public answers, CORS mistakes, and later a leak between churches.

Controls, in priority order:
1. **P1 · EXISTS, reuse:** `/v1/code` answers before any lookup (`auth.js:447-462`), and reuses the same limiter instances as `/auth/code`, not new ones. Otherwise each endpoint doubles the attacker's budget: per IP 20 an hour (8x per /48), per email 5 an hour, and the server-wide `max_code_emails_per_hour`. Route both through one shared function.
2. **P1 · NEW:** fix F2 and F3 before the directory wraps these endpoints. `/v1/password` for an unknown email: same 401, same scrypt cost. `/v1/verify`: the same wording whether or not a code exists.
3. **P1 · NEW:** `/v1/password` and `/v1/verify` return churches only after proof. Before proof, the answer is the same `{ok:true}` or the same 401/400. After proof, return only `{slug, name, logo_url, host, ticket}`. No role, no person id, no "has password" flag, no account count. `need_password` and `need_name` appear only after a correct code (as today).
4. **P1 · NEW:** CORS scoped by path in a middleware mounted only on `/api/directory/v1`:
   - `Access-Control-Allow-Origin: capacitor://localhost` exactly, never echoed back from the request.
   - Never `Allow-Credentials`.
   - Allow only the headers `content-type, x-mb`.
   - `Vary: Origin`.

   Note that every Capacitor app on every phone shares that origin, and scripts ignore CORS. CORS is not authentication: rate limits and uniform answers are the real controls.
5. **P1 · NEW:** the directory never creates accounts or decides policy. Ticket redemption at the church re-runs `userForEmail`, which checks `sign_in_policy` and `active`.
6. **P2 · NEW:** `GET /v1/churches/:slug` returns public brand fields only (the same set as `/api/app/config`'s planned `brand`). It is rate-limited and gives a 404 for unknown slugs that looks identical to an unlisted church.
7. **P2 · NEW:** in the app, the `host` in a directory answer must match the build's `allowNavigation` list, which is fixed in the pinned build. A bad or compromised directory answer must never point a bridge-enabled web view at another host.
8. **Later (multi-church):**
   - **Index privacy:** an HMAC email index keyed with a product secret. Store no plain emails or names.
   - **Ticket binding:** tickets bound to the church id. A church server validates a ticket server-to-server using its own credential, and can only redeem tickets for itself.
   - **Passwords per church:** a password proves an account at one church only. The directory should return only the churches where that password checks. An emailed code proves the email and can return all the person's churches. Otherwise a weak or reused password at church A opens church B. (Owner/architect decision, §4.)
   - **Limits at both levels:** product-wide and per-church code ceilings.
   - **Pinned build:** it shows only its own church even when the email is also in other churches.
   - **Logging:** super-admin and directory operations are logged.

Tests to require:
- known, unknown, policy-refused and deactivated emails get byte-identical bodies and statuses on `/v1/code`, `/v1/password` (wrong password) and `/v1/verify` (wrong code);
- 429 after the shared limits, counted across `/auth/code` and `/v1/code`;
- the answer after proof has no extra fields;
- CORS: preflight from `capacitor://localhost` passes, from any other origin gets no ACAO, there is never an `Allow-Credentials` header, and there are no CORS headers on `/api/me` or `/auth/*`;
- non-GET without `x-mb` gets 403;
- a deactivated account gets no tickets.

### 3.2 One-time tickets (`/auth/ticket`, `/auth/app-return`)

Threats: guessing, replay, interception (logs, Referer, history, other apps), sign-in CSRF, and the wrong church or user.

1. **P1 · NEW (pattern EXISTS in `startSession`):** `crypto.randomBytes(32)` as base64url, stored as `hashToken()` only. Table `sign_in_tickets (hash PK, user_id FK CASCADE, church_slug, purpose IN ('directory','google','apple'), challenge, expires_at, used_at, created_ip)`.
2. **P1 · NEW:** lifetime 60 s. Single use, enforced atomically: `UPDATE … SET used_at=now WHERE hash=? AND used_at IS NULL AND expires_at>now`, then require `changes === 1`. Never "select, then update".
3. **P1 · NEW:** bound to the church (`church_slug` equals this hub's `church_slug` setting) and to a user id. At redemption, re-check `users.active = 1`. Purge expired rows on each insert.
4. **P1 · NEW:** binding to the app instance (PKCE-style). The app makes a random verifier and sends `challenge = sha256(verifier)` when the flow starts. The ticket stores the challenge, and redemption must present the verifier. A leaked ticket alone is then useless.
5. **P1 · NEW:** keep the ticket out of logs and Referer. Preferred: the return page is loaded with `#t=…&v=…` in the fragment, which is never sent to the server, and the page's script POSTs it to `/auth/app-return` with `x-mb: 1`. That POST sets the cookie and then the page goes to `/app/`. If a GET is kept: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, an immediate 303, and no request-URL logging on that route.
6. **P1 · NEW:** the redirect target after redemption is fixed (`/app/`). Never take it from a parameter.
7. **P2 · NEW:** rate-limit redemption per IP with `ipAllowed` (for example 30 per 10 min). This is noise control; 256 bits can't be guessed.
8. **P2 · NEW:** guard against sign-in CSRF (F4). There is no universal link to these paths. If a session already exists for another user, ask before switching.
9. **P2 · NEW:** audit `auth.ticket` (purpose and user id, never the ticket) so support can trace a wrong-account report.

Tests to require: expired (fake clock, not today's date), reused (second redeem gets 400), wrong church slug, wrong or missing verifier, a deactivated user between issue and redeem, a ticket for user A cannot become user B, a `next`/`redirect` parameter is ignored, the stored value is a hash, a concurrent double redeem gives exactly one session, and the AASA file has no `/auth`.

### 3.3 Sign in with Apple (native sheet, verified with built-in `crypto`)

Threats: forged or replayed identity tokens, an audience from another app, algorithm confusion, a relay email that opens someone else's account, and Apple key and refresh-token handling.

1. **P1 · NEW: verify the token.**
   - Split the JWT. The header `alg` must be exactly `RS256`; reject `none`, `HS*` and anything else.
   - Look up the key by `kid` in Apple's JWKS (`https://appleid.apple.com/auth/keys`). Cache it for about 24 h. Refetch on an unknown `kid` at most once every 5 min, so a flood of fake kids can't make the server fetch endlessly.
   - `crypto.createPublicKey({ key: jwk, format: 'jwk' })`, then `crypto.verify('sha256', headerDotPayload, key, sig)`.
   - Cap the token at 8 KB.
   - With `MB_OFFLINE=1` the fetch is refused, so Apple sign-in fails closed.
2. **P1 · NEW: check the claims.**
   - `iss === 'https://appleid.apple.com'`.
   - `aud` is in an allow-list from env (the bundle id or ids for the native flow; a Services ID only if a web flow is ever added).
   - `exp > now - 60s`, and `iat` within 10 min.
   - `sub` must be present.
   - `email_verified` is `true` or `"true"`.
   - Record `is_private_email`.
3. **P1 · NEW: nonce.**
   - The server issues it: `POST /auth/apple/nonce` (`x-mb`, rate-limited) returns a random raw nonce. Store its hash with a 5-min TTL, single use, tied to an HttpOnly `mb_apple` cookie set on the same response (the same idea as `mb_oauth`).
   - The app passes `sha256(raw)` to `ASAuthorizationAppleIDRequest.nonce`.
   - The server requires `token.nonce === sha256hex(raw)`, consumes it, and requires the cookie to match.
   - A captured token can then never be replayed.
4. **P1 · NEW: identity storage.**
   - `user_identities (user_id FK CASCADE, provider, app_id, subject, refresh_token, created_at, UNIQUE(provider, app_id, subject))`.
   - Sign in by `(provider, app_id, sub)`, never by email alone after the first link.
   - `app_id` matters because Apple's `sub` is per developer team: the LLC's product app will see different subs (§3.10).
5. **P1 · NEW: relay and email linking.**
   - **Auto-link:** link automatically to the account with the same email only when the Apple email is verified and not a relay. Account creation still goes through `userForEmail`, so the policy applies and new accounts are unlinked.
   - **Pending link:** for relay emails, or emails not in People, create a server-side pending link (hash, sub, app_id, 15 min, cookie-bound). Never trust a `sub` sent back by the client.
   - **Proving the email:** the person enters their church email, which goes through the normal `/auth/code` and `/auth/code/verify` with the pending-link token. Only after the code is right is the identity row inserted.
   - **Why this holds:** an attacker's Apple ID can't attach to a victim's account without the victim's emailed code.
   - **Relay addresses:** don't save a relay address as `users.email`.
6. **P1 · NEW: secrets.**
   - `MB_APPLE_KEY_ID`, `MB_APPLE_TEAM_ID`, `MB_APPLE_PRIVATE_KEY` and `MB_APPLE_CLIENT_IDS` in Render only.
   - The ES256 client-secret JWT is made in memory, with a short `exp`, and never logged.
   - A test override `MB_APPLE_URL` points at a local stand-in and is ignored when `RENDER` or `NODE_ENV=production` is set.
7. **P2 · NEW:** on first sign-in, exchange the `authorizationCode` (5 min, single use) at `/auth/token` for a refresh token. That token is needed for revocation (§3.6). Store it only in `user_identities`. Never return it, log it or include it in any export. It grants nothing in the Hub, so plain storage inside the encrypted backups is acceptable, but note it in `database.md#sensitive-data`.
8. **P3 · NEW (later):** Apple server-to-server notifications (`consent-revoked`, `account-delete`), verified with the same JWKS code, to remove the identity row and end its sessions.

Tests to require: a locally generated RSA key pair and a JWKS stand-in. Cases that must be refused: bad signature, `alg: none`, `alg: HS256` signed with the public key as secret, wrong `iss`, wrong `aud`, expired token, missing or reused nonce, nonce without the cookie, unknown `kid` (one refetch then refused). Also: a relay email creates no account and asks to link; linking without a correct code is refused; after linking, a second sign-in finds the account by `sub` even if the email changed; a deactivated account is refused.

### 3.4 The Google return path (ASWebAuthenticationSession)

1. **P1 · EXISTS:** the state cookie (`auth.js:325-328, 379`), the token exchange over TLS with an `aud` and `email_verified` check (`auth.js:401-402`), `safeNext` (`auth.js:309`), and the policy through `userForEmail`.
2. **P1 · NEW:** the app flow starts at `/auth/google?app=1&cc=<challenge>&st=<native state>`. The server keeps `{state → app: true, challenge, native_state}` in a short server-side row (or a signed cookie). The callback decides "app" from that stored record, never from a callback query parameter.
3. **P1 · NEW:** in app mode the callback must **not** call `startSession` and must ignore `mb_next`. It creates a ticket (purpose `google`, with the challenge) and redirects to a callback address fixed in config: `MB_APP_CALLBACK` (a custom scheme, or https on iOS 17.4+). Success and error both carry `st`. Never take the redirect from a request parameter.
4. **P1 · NEW:** native code accepts the callback only if `st` equals the state it made for the session in progress. It then loads the church's `/auth/app-return#t=…&v=…` in WKWebView (§3.2, item 5). ASWebAuthenticationSession hands the callback only to the app that started it, which limits URL-scheme hijacking. The verifier still protects against leaks.
5. **P2 · NEW:**
   - **Ephemeral session:** prefer `prefersEphemeralWebBrowserSession = true`, so `mb_oauth` and `mb_next` and the Google sign-in don't stay in Safari on shared church phones. It costs some convenience; mobile-engineer and owner to choose.
   - **PKCE:** add `code_challenge=S256` to the Google request as defence in depth.
   - **Errors:** in app mode, errors go to the app's callback with a short code, not `/login`, so the sheet always closes.
6. **P3 · EXISTS, OK:** `siteOrigin()` builds the `redirect_uri` from known URLs. Google rejects unregistered ones.

Tests to require: an app-mode callback sets no `mb_session` cookie; it redirects only to `MB_APP_CALLBACK`; `next`, `redirect` and `return_to` parameters have no effect; a state mismatch is refused; the ticket carries the challenge; the website flow is unchanged (a regression test).

### 3.5 Session cookies in WKWebView and Safari

- **EXISTS:**
  - `mb_session` is 32 random bytes, stored hashed, `HttpOnly; SameSite=Lax; Path=/`, `Secure` behind TLS, 30 days fixed (`auth.js:34-45`).
  - It is host-only (no `Domain`), so the dashboard host and `MB_APP_URL` host have separate cookies, and future churches are isolated per host.
  - The WKWebView data store is separate from Safari and is erased when the app is uninstalled.
- **P1:** the cookie is only ever set first-party on the church host, by redeeming a ticket in the web view. Never send it cross-site from `capacitor://localhost` (the plan already says so). Never pass the session token itself to native code or JS.
- **P1 · NEW:** signing out in the app:
  - The server deletes the session and this device's APNs token (§3.8).
  - The app clears the Preferences offline snapshot and the cached brand data that isn't public.
  - It returns to the launcher.
  - Switching church does the same for the church being left.
- **P2:** F10 (force Secure in production) and F9 (HSTS). Moving to a `__Host-` prefix would sign everyone out once: owner decision, not required.
- **P2:** a 30-day fixed lifetime is acceptable. Don't add sliding renewal without review.
- **Note:** a cookie set just before the app is killed can occasionally be lost (plan.md). That fails safe: the person signs in again.

Tests to require: a ticket redemption response carries `Set-Cookie` with HttpOnly, SameSite=Lax and, in production mode, Secure; no response from `/api/directory/*` ever sets a cookie; sign-out deletes the session row and the device token.

### 3.6 Account deletion (5.1.1(v))

- **P1 · NEW: re-confirmation.** Confirm with a fresh check: a code with purpose `delete` (add a `purpose` column to `login_codes` in a new migration), sent to the account's stored email, never an email from the request body. For accounts with a password, also allow re-entering the password, which the reviewer account needs. A sign-in code must not count as a deletion code, or the other way round.
- **P1 · NEW: one transaction.** Base it on `DELETE /users/:id` (`setup.js:242-245`). Delete the `users` row, which cascades sessions, `push_subscriptions`, `device_tokens`, `chat_reads`, reactions and `user_identities`; authored content is set to NULL and shows as "Deleted account". In the same transaction:
  - mark that email's unused `login_codes` as used;
  - delete its tickets and pending links;
  - run `closeStreams({ userId })` and `revokeCheckin`;
  - clear the cookie.

  Deleting the row is better than a tombstone that keeps the email and blocks sign-in forever. Under `directory`, the person stays in People and can make a new account later; say so on the confirm screen.
- **P1 · NEW: office notice.** Built inside the deletion route, not through `/me/office-request` (that route needs a linked person, `me.js:46`). It goes to staff and admins who reach the person's campus, or to all-campus admins when the account was unlinked. It names the account and the linked person, never other details. Audit `user.self_delete` with the user id and linked person id.
- **P1 · NEW: admins.** Refuse deleting the last active admin (same rule as `setup.js:239-241`). Warn listed `MB_ADMIN_EMAILS` that signing in again recreates an admin.
- **P2 · NEW: Apple revocation.** If an Apple identity exists, POST `/auth/revoke` with its refresh token and `token_type_hint=refresh_token`, signed with the client-secret JWT. Do it after the commit and in the background; never block deletion on Apple. Log success or failure without the token. If there is no refresh token (the code exchange failed earlier), log it and carry on.
- **P2:** email the address afterwards: "Your account was deleted. If this wasn't you, contact the office."

Tests to require:
- After deletion: no session, push or device rows; the cookie is rejected; streams are closed; the email's codes can't be used.
- A sign-in code is refused for deletion; a wrong password is refused.
- The last admin is refused.
- Staff get a notice, also for an unlinked account.
- With an Apple identity, the revoke stand-in is called once; deletion succeeds when the stand-in returns 500.
- People, households and check-in history are untouched.

### 3.7 Reviewer demo account (decision 6, F1)

**Must never see:** any real person's name, photo, email, phone, address or household; children's or check-in data; real orders of service or schedules; real chats, groups or tasks; announcements, form responses, feedback, giving or connect cards; staff pages.

1. **P1 · NEW:**
   - `users.demo_until` (a migration). `loadUser` treats an account past that time as inactive, so it switches itself off.
   - In the `/api` router, one middleware right after `stationAuth` lets demo accounts reach only an allow-list:
     - `GET /app/config`, `/my/schedule`, `/services/:id` for the demo service only;
     - `/chats*` for the demo team only;
     - `/me*`, `/notifications*`, `/me/devices`, the deletion route;
     - the public events and media lists.
   - Everything else gets 403. That includes `/services?all=1`, `/search`, `/teams`, `/rooms`, `/campuses`, `/groups*`, forms, feedback, event sign-ups, calls (Daily minutes) and `/settings`.
   - `/uploads` (`index.js:111`) for demo accounts: only `/uploads/app` and the demo people's photos.
2. **P1 · NEW:** all demo people, the team, positions and the service belong to one made-up campus. The demo team has no real member or leader, so accept and decline notify no one real. Leave demo accounts out of `reach()` in `announcements.js:28-44` and out of staff fan-outs.
3. **P1 · NEW:** a long random password, rotated before each submission, entered only in App Store Connect review notes (never in the repo, docs, chat or PRs). Use an email address the office controls, so any code reset goes to the office. Role volunteer, with no Finance, Announcements, Attendance or Edit-the-app switches (enforce in code: a demo account can't hold flags).
4. **P2 · NEW:** Settings → Checks shows "Demo account: on until <date>, last sign-in <time>". The demo account's sign-ins are audited. After approval, set `demo_until` in the past or deactivate it, then confirm on Checks.
5. **How to verify:**
   - **(a) Automated:** a `node:test` test walks every GET route on the router as a demo account over seeded data mixing real-looking and demo people. It asserts no non-demo person id, name, photo filename, email or phone appears in any body, and that the non-allow-listed routes give 403.
   - **(b) Manual, before submission:** security-specialist signs in on the live Hub, read-only, with the reviewer password in a private browser and on TestFlight. They open every tab, try `GET /api/services?all=1` and `/api/search?q=a` (expect 403), and record what they saw (screens with no real names). The owner keeps the password; the agent never sees it in chat, so the owner runs this step or shares a screen.

### 3.8 Push tokens (`device_tokens`, `server/apns.js`)

1. **P1 · NEW:**
   - `POST /api/me/devices` uses `requireRole('volunteer')` and `x-mb`.
   - Validate the token as hex, at most 200 characters.
   - `platform` must be one of `apns` and `fcm`.
   - `app_id` must be in an allow-list from env (`MB_APNS_TOPIC`, later the key registry).
   - `sandbox` is a boolean.
   - `device` is limited with `str(…, 80)`.
   - At most 10 tokens per user, oldest dropped.
2. **P1 · NEW:** bind each token to the session that registered it (a `session_hash` column). Send only while that session is live. Delete the token on sign-out, on session expiry (sweep it), on deactivation and on deletion. This fixes the shared or sold phone case, and F8 for the app.
3. **P1 · EXISTS, extend:** `notify()` and `pushOnly()` select `active = 1` users and respect `users.notify` (`notify.js:40, 57`). The APNs call sits beside `pushAll`, with the same text. Nothing about children (already true).

   Owner choice: chat previews (`chat.js:303-304`) show on lock screens; iOS's "Show previews" setting is the person's own control.
4. **P1 · NEW:** the key comes only from env. The provider JWT is cached for less than 50 min and never logged. The 403 configuration warning logs the status and reason only. `MB_APNS_URL` is ignored in production; `MB_OFFLINE` refuses it. 410, `BadDeviceToken` and `Unregistered` delete the row.
5. **P2:** "a token already held by another account moves to this one" is fine for shared family phones. Its abuse (re-pointing someone's token, which needs the token first) only moves notifications. Accept, with a note.
6. **P2:** cap the payload at 4 KB, cutting the body. `url` must be a relative path. The badge count is the person's own unread total.

Tests to require: 401 signed out, 403 without `x-mb`, bad token formats and an unknown `app_id` refused, the per-user cap, a token moves between accounts, a token is deleted on sign-out and on session expiry and isn't sent to, deactivated accounts get nothing, a 410 deletes the row (on an HTTP/2 stand-in), and no key in logs.

### 3.9 Deep links and associated domains

1. **P1 · NEW:** `/.well-known/apple-app-site-association`:
   - an explicit route (express.static ignores dotfiles anyway);
   - `application/json`, 200, no redirect, served on both `PUBLIC_URL` and `MB_APP_URL` hosts;
   - built from `MB_APP_APP_IDS`, and a 404 when that is missing;
   - paths `/app/*` and `/r/*` only, excluding `/auth/*`, `/api/*` and `/uploads/*` (F4);
   - public, holding no secrets.
2. **P1 · NEW:** native `appUrlOpen` and notification-tap handling must parse the URL. Accept only `https` with a host in the build's `allowNavigation` and a path in the AASA allow-list; anything else opens in Safari or is dropped. Never `javascript:`, `data:` or another host. Push `url` values are relative paths, resolved against the current church host.
3. **P2:** `/r/:id/:sig` keeps working signed out with HMAC links (EXISTS, `app.js:173-195`). Opening it in the app adds no sign-in.
4. **P2:** consider `webcredentials:<host>` so iOS Password AutoFill works in the bundled launcher. It encourages strong passwords; optional.
5. **Later (product):** wildcard `applinks:*.<product domain>`. Custom church domains stay website-only (the plan agrees). A wildcard means every subdomain must be one the product controls, so no user-controlled subdomains.

Tests to require: the AASA content type and paths (no `/auth`), 404 when unset, no redirect on the app host; on-device checklist items for a foreign-host link and a `javascript:` link (qa-engineer, TestFlight).

### 3.10 Isolation between churches later (cross-cutting)

- Apple `sub` and the APNs and Apple keys are per developer team. Meadowbrook's team identities won't carry over to the LLC's app without Apple's transfer process, so store `app_id` on identities and tokens now (the plan does for tokens).
- Tickets, nonces and pending links are per church file. The central directory must never hold sessions.
- Each church re-checks policy and `active` at redemption.
- Nothing in the directory contract should let church A's server mint or redeem church B's tickets.

## 4. Checked and OK

- Session tokens are random, hashed at rest (`db.js:1087`) and cleared on sign-out (`auth.js:38-54`).
- A new password signs out everywhere (`auth.js:513-516`).
- Codes are hashed, expire in 15 min, allow 5 attempts and are compared timing-safe (`auth.js:472-502`).
- The `/auth/code` early answer and the ceiling that can't be timed (`auth.js:447-489`).
- `safeNext` blocks `//` and `\`.
- The Google callback checks `state`, `aud` and `email_verified`.
- The sign-in policy never links an account to a person (`auth.js:222-255`).
- `x-mb` CSRF on all non-GET requests (`index.js:68`).
- Chat files are sandboxed with a CSP and forced download (`chat.js:375-383`).
- Push endpoints are allow-listed (`notifications.js:9-15`).
- Admin delete cascades sessions and devices (`setup.js:229-248`).
- `capacitor.config.js` limits `allowNavigation` to one host.

## 5. Owner decisions

1. **Reviewer account:** with the free option you chose (live Hub), it needs the new demo flag, route allow-list and campus. That is a change to roles and permissions (rule 7). The alternative is a separate demo server (a monthly fee).
2. **Deletion re-confirmation:** a code or the account's password (needed so Apple can test it).
3. **Deleted accounts:** delete the row, so someone still in People can make a new account later (recommended), or keep a blocking tombstone.
4. **Self-deletion by admins:** allowed except the last admin.
5. **Multi-church passwords:** a password at one church opens only that church, and an emailed code opens all of a person's churches (recommended).
6. **Ephemeral Google browser session in the app:** safer, but people type their Google password more often.
7. **Fixing F2 and F3:** changes sign-in wording and behaviour slightly (rule 7). I recommend doing it in the B1 PR.

## 6. Handoff

```
Summary: Threat model for the app sign-in, directory, tickets, Apple/Google return, cookies, deletion,
reviewer account, push and deep links. 1 High (the reviewer account isn't isolated by the volunteer
role: services.js shows real names and photos, uploads are open, announcements reach every account),
5 Medium (two enumeration leaks today in /auth/code/verify wording and /auth/password timing;
/auth/app-return in AASA enables sign-in CSRF and /respond should be /r; the Google app path must not
start sessions or follow mb_next; the deletion flow needs a password option and its own office notice),
4 Low. Controls and tests for each item are ranked P1/P2/P3 and marked EXISTS or NEW.
Files: server/auth.js (34-54, 309, 376-415, 430-519), server/index.js (53-60, 68, 111, 182),
server/routes/services.js (54-66, 120-136), server/routes/me.js (45-49, 103), server/routes/setup.js (229-248),
server/routes/notifications.js, server/routes/announcements.js (22-44), server/notify.js (37-79),
server/routes/chat.js (375-383), server/db.js, mobile/capacitor.config.js,
docs/plans/mobile-and-multichurch/app-store-readiness.md, docs/plans/mobile-and-multichurch/plan.md
Decisions needed: (owner) the 7 items in section 5, chiefly the demo flag and allow-list (rule 7) and
deletion confirmation by code or password.
Next: chief-architect folds §3 into the plan (AASA paths, demo flag, ticket verifier, purpose-scoped codes,
user_identities and sign_in_tickets tables). senior-developer fixes F2/F3/F7 first (small, separate PR), then
builds B1 to the P1 controls with the listed tests. qa-engineer turns the tests and the §3.7/§3.9 device
checks into the TestFlight checklist. security-specialist reviews step 8, including the manual demo walkthrough.
Evidence: read-only review of the files above; nothing was run or tested.
```

---

Addendum to the step 4 threat model: the native bridge (from the spike, commit 16d7eba)

This adds item 3.11 to the report I already sent; the earlier findings and the handoff still stand. I read `docs/plans/mobile-and-multichurch/spike-bridge.md` and checked the embeds and file routes in this checkout. Nothing was run, and nothing was tested on a device.

## New finding

**F11. Medium, and it affects the shell staff already use: any frame on an allowed host can call every native plugin**

- **Where:** per the spike's own source reading (marked [V]), Capacitor 8.6.3's `WebViewDelegationHandler.userContentController(_:didReceive:)` (`:192-220`) checks neither the sender's frame nor its origin. The bridge scripts are injected into every main-frame page.
- **The iframe case is likely but not proven:** the handler is registered with `contentController.add(self, name: "bridge")`, which in WebKit normally reaches every frame. The member app embeds third-party iframes at `public/js/member/watch.js:41` and `widgets.js:159`.
- **Some protection already exists:** the iframe `src` comes from `videoEmbed()` in `public/js/member/main.js:225-238`, which only produces `www.youtube.com/embed/...` or `player.vimeo.com/video/...`. So the iframe origins are fixed. The risk is a script-injection bug on the church host, or a compromised YouTube or Vimeo page.
- **What an attacker gets through the bridge:**
  - **`CapacitorHttp`:** native requests that ignore CORS and any future CSP `connect-src`. That is a way to send data out, and to make blind requests to the phone's local network.
  - **`CapacitorCookies`:** I infer it uses the native cookie store, which can probably set or overwrite HttpOnly cookies such as `mb_session`, `mb_oauth` and `mb_next`. That would allow silently signing someone into another account and getting around the OAuth state check. The spike verified only that reading returns non-HttpOnly cookies; **setting needs checking**.
  - **Preferences:** an attacker could plant a false "last church" host or a fake offline schedule.
  - **Shell sign-in methods:** they return tokens or tickets to page JavaScript.
  - **Share and `showLauncher`:** nuisance or denial of service only.
- **A frame that isn't the main page** probably can't read results, since replies go to the main frame's JavaScript. It can still trigger the side effects above.
- **This applies today:** the Phase 0/A shell already loads the live `/app/` with core `CapacitorHttp` and `CapacitorCookies` registered, and the Watch page's YouTube iframe.

## 3.11 Controls to require, ranked

### P1: before any TestFlight build that adds plugins or sign-in (ideally in Phase A)

1. **Gate every message in one place.**
   - In `MainViewController.capacitorDidLoad()`, remove the `bridge` handler with `removeScriptMessageHandler(forName: "bridge")`. Re-add a small wrapper `WKScriptMessageHandler` that passes a message on to Capacitor's original handler only when all of these hold:
     - `message.frameInfo.isMainFrame` is true;
     - `message.frameInfo.securityOrigin` (scheme, host, port) is `capacitor://localhost` or exactly one of the profile's hosts;
     - the body's `pluginId` and `methodName` pair is on an allow-list.
   - This is the only control that tells frames apart. Checking `webView.url` inside each method can't, because it shows the main page's address even when an iframe sent the call.
   - **Verify (mobile-engineer):** that Capacitor's handler can be reached to forward to (for example through the bridge's `webViewDelegationHandler`). Do it without editing `node_modules` or `CapApp-SPM`. If it can't, raise it before building any other way.
   - **Allow-list:** the approved plugins with only the methods the app uses: App, Preferences (`get`/`set`/`remove`), PushNotifications, Haptics, Share, StatusBar, SplashScreen, Keyboard and Shell, plus the core Console logger if `native-bridge.js` needs it.
   - **Denied:** `CapacitorHttp`, `CapacitorCookies`, `WebView`, and anything not listed.
2. **Turn off CapacitorHttp and CapacitorCookies twice over.**
   - Set `plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } }`, so `fetch` and `document.cookie` are never patched.
   - Also deny both in the gate above. I expect `enabled: false` only stops the patching and leaves `Capacitor.Plugins.CapacitorHttp.request` callable; **mobile-engineer to confirm in the 8.6.3 source**.
3. **Exact hosts only.**
   - Pinned build: `allowNavigation` is exactly the `MB_APP_URL` host. No `*`, and no wildcard.
   - The dashboard host (`PUBLIC_URL`) goes on the list only if staff pages must open inside the app. Every allowed host extends the bridge to all of its pages, so I recommend opening staff pages in Safari or `SFSafariViewController` (owner/architect decision).
   - Product build: only `*.<product domain>` (one label). No user-controlled subdomains on that domain, and no user-uploaded HTML served from it.
   - **Checked, no problem found:** chat files are sandboxed (`chat.js:380`); song files allow only PDF, PNG, JPEG, WebP, text and audio, with `nosniff` (`songfiles.js:12-15, 87`); `/uploads` serves images. Any new route that serves uploads inline must keep `Content-Security-Policy: sandbox`.
4. **A host check inside each method, as a second layer** (the spike's "common guard").
   - The first line of each method checks `bridge.webView.url` scheme and host against the profile, using exact comparison of the parsed URL, never a text prefix match.
   - **Sign-in methods** (`signInWithApple`, `signInWithGoogle`): **only from the launcher** (`capacitor://localhost`). A signed-out church page calls `showLauncher()` and never signs in itself, so remote pages never touch sign-in.
   - **`setBadge`:** a number from 0 to 9999.
   - **`showLauncher`:** takes no arguments.
   - Only one call may be in progress at a time.
5. **Treat stored data as untrusted.** Before the launcher navigates to a church host it read from Preferences or a directory answer, it checks that host against the profile's `allowNavigation`. The launcher and `offline.html` escape all stored text; there is no `innerHTML` with stored values.
6. **Iframe and embed policy.**
   - Keep `videoEmbed()`'s fixed hosts. Add a test that any other URL produces a link, not an iframe.
   - A `sandbox` attribute does **not** fix this: YouTube needs `allow-scripts allow-same-origin`, which leaves message handlers reachable. The fix is the gate in item 1.
   - Until the device test below shows the gate working, in the shell (`inShell`) show a thumbnail that opens the video in Safari, `SFSafariViewController` or the YouTube app instead of an iframe. Keep the iframe on the website.
   - Also add a CSP on `/app/` with `frame-src https://www.youtube.com https://player.vimeo.com` (report-only first), in line with F9.

### P2

7. **Debug builds:** `CAPACITOR_DEBUG` and the Web Inspector stay off in Release builds (the spike notes this).
8. **Device test checklist** (qa-engineer, TestFlight), each expected to be refused:
   - from a test cross-origin iframe page (a local stand-in, not YouTube), `window.webkit.messageHandlers.bridge.postMessage({pluginId:'Preferences',methodName:'set',...})`, then confirm nothing changed;
   - from the main page, `Capacitor.Plugins.CapacitorHttp.request(...)` and `CapacitorCookies.setCookie(...)`;
   - `Shell.signInWithApple()` called from `/app/`;
   - also confirm that a navigation to a host off the list opens Safari.

## Sign-in design for the Shell plugin's Apple and Google methods

**Principle:** no secret ever reaches page JavaScript. The plugin returns only `{ok}`, `{cancelled}` or `{error}`. Native code makes and holds the nonce, state and PKCE verifier, and native code redeems. A script-injection bug that calls the method can at most sign the web view into an account the person picks on Apple's or Google's own screen; it gets nothing it could replay elsewhere.

### Redemption (common to both)

- Native loads a `URLRequest` into the WKWebView itself: `POST https://<church host>/auth/app-return`, with header `x-mb: 1` and a form body of `ticket` and `verifier`.
- Because WKWebView makes the request, the `Set-Cookie` is first-party and lands in the web view's cookie store. The answer is a `303` to `/app/`.
- This keeps ticket and verifier out of URLs, logs, the Referer header, history and JavaScript. It replaces the fragment option in §3.2 item 5.
- **Verify on device:** that WKWebView sends the POST body and the custom header with `load(_:)`. If it doesn't, fall back to the fragment option with the verifier still held natively.

### Google

1. Native makes `state` and `verifier` (32 random bytes each, from `SecRandomCopyBytes`) and `challenge = base64url(SHA-256(verifier))`. They are kept in the plugin's memory only and never resolved to JS.
2. Native builds the start URL itself from the profile's church or directory host: `https://<host>/auth/google?app=1&cc=<challenge>&st=<state>`. It does not take a `url` from JS. If JS passes anything, it must equal what native would build; the spike's `{ url, callbackScheme }` arguments should go.
3. `callbackURLScheme` is fixed from the profile and matches the server's `MB_APP_CALLBACK`. The server redirects only there, with `ticket` and `st`, and never sets `mb_session` in this flow (§3.4).
4. On completion, native requires `st == state` (compared in constant time), discards a second or late callback, wipes the state, then redeems as above.
5. **Server:** the ticket is single use, lasts 60 s, is stored hashed, is bound to church, user and `challenge`, and needs `SHA-256(verifier) == challenge` at redeem time. The `state` record is single use and lasts 10 min. A copied callback URL is useless without the verifier.

### Apple

1. Native makes `rawNonce` (32 random bytes) and sets `request.nonce = hex(SHA-256(rawNonce))`.
2. After the native sheet, native POSTs `{identityToken, authorizationCode, rawNonce, givenName, familyName}`:
   - **in a pinned build:** through the web view's load to `POST https://<church host>/auth/apple` with `x-mb: 1`. The server verifies (§3.3), then sets the cookie first-party in the same response, so no ticket is needed;
   - **from the bundled launcher with a central directory later:** native posts to the directory with `URLSession`, receives tickets plus a `challenge` it supplied, and redeems through the web view as above.
3. **Server:**
   - `token.nonce == sha256hex(rawNonce)`;
   - record `sha256(rawNonce)` in a used-nonce table until the token's `exp`, so each nonce works once (replay);
   - plus every check in §3.3: RS256 only, `kid` from the JWKS, `iss`, `aud` from the allow-list, `exp`/`iat`, `sub`, `email_verified`.
   - The server-issued, cookie-bound nonce in §3.3 item 3 becomes optional: with the token never shown to JavaScript, a nonce generated natively and single-use on the server is enough. Keep the cookie binding if the web view route is used, because it costs nothing there.
4. `email` and `fullName` arrive only on the first authorization. Native sends them along; the server stores the name only if it creates or links an account. The relay email linking flow is unchanged (§3.3 item 5). The pending-link token goes into the web view only as an HttpOnly cookie, never as a value in JS.
5. **Cancelling:** maps to `CANCELLED`, with no network call.

### Tests to require

**Server (`node:test`):**
- `/auth/app-return` refuses a GET with a ticket; refuses a POST without `x-mb`; refuses a wrong verifier; refuses reuse.
- `/auth/apple` refuses a nonce that has been used, a missing `rawNonce` and a mismatched `rawNonce`.
- In app mode the Google callback redirects only to `MB_APP_CALLBACK`, with `st` echoed unchanged.
- No sign-in response body contains a ticket meant for page JavaScript (only the directory answer to the launcher does, while the launcher is the JS redeemer). Simplest: native is always the redeemer.

**Device (qa-engineer):**
- From `/app/` in the Web Inspector of a debug build: `Shell.signInWithGoogle()` and `Shell.signInWithApple()` are refused.
- From the launcher: both methods resolve with no `ticket`, `identityToken` or `verifier` fields.
- A second callback replayed by hand into the app is ignored.

## Owner decisions added
- Whether staff pages open inside the app. That extends the bridge to the dashboard host; I recommend Safari.
- Whether to show video as a thumbnail that opens outside the app, in the shell only, until the frame gate is shown to work on a device.

## Handoff
```
Summary: Added item 3.11 and finding F11 (Medium; it affects the current shell too): every frame on an allowed host can
reach every Capacitor plugin, including CapacitorHttp and probably CapacitorCookies. P1 controls: one native message
gate (main frame only, exact origin, an allow-list of plugin and method pairs, CapacitorHttp and CapacitorCookies
denied); exact allowNavigation hosts with no staff host unless the owner decides otherwise; Shell sign-in only from
the launcher; stored hosts checked again; no in-app video iframes until the gate is proven. Sign-in design: native
holds the nonce, state and PKCE verifier, JS gets back only ok/cancelled, and native redeems by a WKWebView POST to
/auth/app-return (Google) or /auth/apple, so the cookie is first-party and no ticket or token reaches JS or a URL.
Files: docs/plans/mobile-and-multichurch/spike-bridge.md, public/js/member/main.js:225-238, watch.js:41, widgets.js:159,
server/routes/chat.js:380, server/routes/songfiles.js:12-15,82-89, mobile/capacitor.config.js
Decisions needed: (owner) staff pages inside the app or in Safari; video thumbnails instead of iframes in the shell for now.
Next: mobile-engineer checks three things in the 8.6.3 source: whether the bridge handler can be wrapped from
MainViewController, whether CapacitorHttp stays callable with enabled:false, and whether CapacitorCookies.setCookie
can overwrite HttpOnly cookies; then builds the gate and the Shell sign-in methods as specified. senior-developer adds
POST /auth/app-return and /auth/apple to B1 with the tests above. qa-engineer adds the device checks to the TestFlight list.
Evidence: read-only; source facts come from the spike's [V] items; nothing was run or tested on a device.
```