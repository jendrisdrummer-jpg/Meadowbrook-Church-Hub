# Plan: an app-like phone app, ready for the App Store, on the product's code path

Chief Architect · 27 November 2026 · **Status: proposed. Each phase needs the owner's approval; items marked
OWNER are approvals under CLAUDE.md rules 6 and 7.**
Builds on the approved [plan.md](plan.md) (Phase 0 shell, option (a) database per church plus a directory, owner
decisions of 26 Nov) and [master roadmap §13 items 20 to 22](../../master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation).
Product working name "Steeple" (not final; never written into code).

## In plain words (for the owner)

1. The app you have now is a frame around the member app. This plan makes it feel like a real iPhone app
   (smooth screens, pull down to refresh, notifications, a badge with unread counts, works on a weak signal).
2. **Everyone signs in first**, like Faith Teams: email, then password (or an emailed code). New people make a
   password after a code. The app finds their church and opens it; if they belong to several, they pick.
3. Meadowbrook's app runs **exactly the same code** as the future product app. The only difference is a small
   settings file that says "this app is Meadowbrook" (name, icon, which church). So it all gets tested now.
4. People who aren't in Meadowbrook's directory can't make an account; the app kindly tells them to ask the
   office or fill in a connect card.
5. Notifications come straight from Apple. You create one key in Meadowbrook's Apple account; it goes only into
   Render's settings, never into chat or code.
6. Apple requires a few things first: delete-my-account inside the app, "Report" in chat, a privacy page, a test
   account for Apple's reviewers, and (if Google sign-in stays) **Sign in with Apple**.
7. Three phases: **A** staff test the current app through TestFlight (December); **B** native features, sign-in
   and notifications (January to early February, and March); **C** submit to the App Store (March or after Easter).
8. No new paid services. You approve: a list of free official app add-ons, the sign-in change, the account
   deletion rules, and the store name. Your Mac and Xcode are needed for every build upload.

---

## 0. Scope

- **In:** iPhone app only (owner: no Android now; FCM designed, not built). Native feel, offline, deep links,
  share, native push (APNs), the product sign-in flow with Meadowbrook pinned, store requirements, release plan.
- **Out:** full multi-tenancy (the dispatcher, per-church integration secrets: plan.md Phase 2); Android and FCM
  delivery; Face ID unlock (later, small); in-app giving (stays in Safari); the LLC's product listing (item 22).
- **Reuse, don't rebuild** ([features.md](../../features.md)): the member app `public/js/member/*` (tabs, App Builder
  layout, events, watch, forms, my info), `GET /api/app/config` (`server/routes/app.js:138`: church name, colour,
  tabs, campuses), email-code and password sign-in with `sign_in_policy` (`server/auth.js:198-286, 430-519`),
  `server/ratelimit.js`, the inbox and fan-out in `server/notify.js`, Web Push (`server/push.js`), `inShell`
  (`public/js/push.js`), the Phase 0 shell (`mobile/`), and the unmerged **`claude/app-links`** branch (in-app file
  viewer `public/js/member/shell.js`, camera, microphone and photo wording in `Info.plist`, Watch "Copy link"
  fallback). **Merge `claude/app-links` first** (step 1); everything below assumes it.

## 1. Native feel

Mechanism: the member app feature-detects plugins (`Capacitor.isPluginAvailable(...)`) and does nothing on the
web, so the website and home-screen app are unchanged and older app builds keep working after any server deploy.

| Item | What / smallest version | Why | Who | Effort |
|---|---|---|---|---|
| Transitions | Same-document View Transitions (`document.startViewTransition`, supported by iOS 18 WKWebView) on route change: slide in on open, slide back on Back; none when `prefers-reduced-motion`. CSS only, no plugin | Feels native; Apple 4.2 | ui-ux-specialist designs, senior-developer builds, accessibility-specialist checks motion | 4-6h |
| Pull to refresh | Native `UIRefreshControl` on the web view's scroll view in `MainViewController` (Swift, no plugin) that calls a JS hook `window.mbRefresh()` (re-runs the current route, as "refresh after a minute away" already does) | Expected on iPhone | mobile-engineer (Swift), senior-developer (hook) | 3-4h |
| Haptics | `@capacitor/haptics`: light tap on Accept/Decline, task done, pull-to-refresh trigger. Respect system setting | Native feel | senior-developer | 1-2h |
| Safe areas | Already done (`viewport-fit=cover`, `env(safe-area-inset-*)` in `member.css`). Verify on notch and Dynamic Island; the file viewer bar already pads | — | accessibility-specialist (check) | 1h |
| Status bar | `@capacitor/status-bar`: overlay web view, style follows the member app's light/dark theme | Polish | mobile-engineer | 1h |
| Splash hand-off | `@capacitor/splash-screen` with `launchAutoHide: false`; the app hides it after its first render, with a 4-second fallback so it can never stick | No white flash | mobile-engineer + senior-developer | 1-2h |
| App icon badge | Server sends `aps.badge` = unread inbox + unread chat (both counts already exist). When the app reads items it updates the badge through a tiny in-repo Swift bridge (`UNUserNotificationCenter.setBadgeCount`), no third-party plugin | Unread at a glance | senior-developer + mobile-engineer | 3-5h |
| Keyboard | `@capacitor/keyboard`: `resize: 'native'`, chat composer stays above the keyboard, focused field scrolls into view, accessory bar hidden on chat | Chat and forms usable | mobile-engineer | 2-3h |
| Offline | See below | Weak signal in church buildings | senior-developer + mobile-engineer | 8-12h |
| Deep and universal links | See below | Email "Accept" and notification taps open the app | senior-developer (server), mobile-engineer (shell) | 6-8h |
| Share sheet | `@capacitor/share` when in the app; Web Share or "Copy link" elsewhere (keeps the `app-links` fallback) | Sharing a sermon is common | senior-developer | 1h |

**Offline: pick native storage, not a service worker.** A service worker inside WKWebView only runs with
App-Bound Domains (`WKAppBoundDomains`, at most 10 hosts), which doesn't scale to a product app opening many
churches' hosts and restricts the bridge. Instead, when signed in and in the app, the member app writes a small
snapshot after each successful load to `@capacitor/preferences`: my next 8 serving spots, the home "this week"
summary, the Watch list (titles and dates only). The bundled `offline.html` (already shown by the shell when the
host is unreachable) reads it and shows "Your schedule, as of Sunday 9:12" read-only with Try again. **Never
stored:** children's or check-in data, chat, other people's contact details. Cleared on sign-out and church switch.

**Universal links.** The hub serves `/.well-known/apple-app-site-association` (JSON, no redirect, public) built from
an env var `MB_APPLE_APP_IDS` (`TEAMID.bundleid`, a deployment value, not a secret; absent = 404). Paths: `/app/*`,
`/respond*`, `/auth/app-return*`; excluded: `/api/*`, `/uploads/*`, staff pages. Shell: Associated Domains
entitlement `applinks:<host>` from the build profile (§3); `@capacitor/app` `appUrlOpen` navigates the web view.
Email links then open the app when installed and the browser otherwise (`respond.html` already works signed out).
Notification taps carry a `url` and use the same handler. Product note: the product's entitlement can't list every
church's custom domain, so app traffic for product churches must use `*.<product domain>` (wildcard applinks);
custom domains stay website-only.

## 2. Native push (APNs now, FCM later)

- **Table** (new migration appended to `MIGRATIONS`): `device_tokens (id, user_id → users ON DELETE CASCADE,
  platform TEXT CHECK IN ('apns','fcm'), token TEXT NOT NULL, app_id TEXT NOT NULL, sandbox INTEGER NOT NULL
  DEFAULT 0, device TEXT, created_at, last_used, UNIQUE(platform, token))`. A sibling of `push_subscriptions`
  (whose `p256dh`/`auth` are Web Push only). `app_id` records which app (Meadowbrook's or the product's) the token
  belongs to, so the right Apple key is used later.
- **Routes** (in `server/routes/notifications.js`, beside `/me/notify`): `POST /api/me/devices`
  (`requireRole('volunteer')`, `x-mb`, upsert; a token already held by another account moves to this one) and
  `DELETE /api/me/devices` (own token only). `GET /me/notify` lists both kinds; sign-out and account deletion
  remove the device's token; the announcement device count (`routes/announcements.js:48`) counts both.
- **Sender:** `server/apns.js`: Node's built-in `http2` and `crypto` (ES256 provider token, cached under 50 minutes,
  one HTTP/2 session reused). No new server dependency. `notify()`/`pushOnly()` in `notify.js` gain one call next
  to `pushAll`; same `users.notify` choices, same text. 410 or `BadDeviceToken`/`Unregistered` deletes the row; 403
  logs a configuration warning once. Payload: title, body, `badge`, `thread-id` per kind, `url`. Nothing about
  children in push text (already true).
- **Env vars (Render only, never code, docs, commits or chat):** `MB_APNS_KEY_ID`, `MB_APNS_TEAM_ID`,
  `MB_APNS_PRIVATE_KEY` (the .p8 text), `MB_APNS_TOPIC` (bundle id). Test override `MB_APNS_URL` pointing at a
  cleartext HTTP/2 stand-in in `node:test`; `MB_OFFLINE=1` refuses it like other outgoing calls. Missing vars = native
  push quietly off, email and inbox unchanged.
- **Multi-church:** an APNs key works only for apps in its own Apple team. Meadowbrook's app is in Meadowbrook's
  team; the product app will be in the LLC's. So under option (a) the sender picks the key by `app_id` (a small
  key registry in env vars, product-wide); tokens stay in each church's file. Designed now, built later.
- **Shell plugin (OWNER, rule 6):** `@capacitor/push-notifications` from the 8.x line matching `@capacitor/core`
  8.6.3, pinned exact (mobile-engineer checks the current 8.x version on npm before proposing the number). The app
  asks permission after a tap on "Turn on notifications" (the `inShell` message from Phase 0 is replaced).
- **Owner steps in Apple Developer (Meadowbrook's team):** (1) Certificates, IDs & Profiles → Identifiers → the
  app's ID → enable Push Notifications (Xcode can do this under Signing & Capabilities). (2) Keys → + → name it,
  tick "Apple Push Notifications service (APNs)" → Continue → Register → **Download** the .p8 (only once) and note
  the **Key ID**. (3) Membership details → **Team ID**. (4) Paste all three plus the bundle id into Render
  environment variables yourself.
- **FCM later:** same table with `platform = 'fcm'`, sent with `fetch` and a service-account token. New Google
  service: OWNER approval when Android starts.
- Effort: server 14-20h (senior-developer), shell 6-8h (mobile-engineer), review 3h (security-specialist).

## 3. Product architecture: "operate like Steeple" with Meadowbrook pinned

### The sign-in flow (owner decision, 27 Nov: sign-in required, Faith Teams style)
This replaces plan.md §3 step 5 ("Find your church" as guest) as the primary path; **guest browsing is off in the
app** (it stays on the website and the home-screen app).

1. **Open app → "Your email".** Bundled launcher screen (in the app, not loaded from a church).
2. **Then one screen: "Password"** with "Email me a code instead" and "First time here? We'll email you a code".
   The screen is the same whether or not the email has an account, so the app can't be used to test which emails
   are members (today's rule in `POST /auth/code`). Faith Teams' style of showing different screens to known and
   unknown emails would reveal membership: **OWNER decision 2**.
3. **Existing account:** password, or code. **New person:** code, then "Create a password" (8+ characters). This is
   today's `/auth/code/verify` behaviour (`need_password`); it moves behind the directory contract below.
4. **The directory finds the church(es) for that email.** One → straight to that church's member home (for
   Meadowbrook, its App Builder home). Several → a simple picker (name and logo); the app remembers the last one,
   "Switch church" sits in More.
5. **Email not allowed by any church's policy:** no code is sent (as today). After the code wait, the screen says:
   "No code? If you're new, ask your church office to add you, or fill in a connect card," with a link to the
   church's public connect card (for the pinned build, Meadowbrook's). No open sign-up.
6. **Google:** "Continue with Google" opens Google in `ASWebAuthenticationSession` (allowed by Google), the server
   finishes at `/auth/app-return` with a one-time ticket, the app redeems it. Same directory lookup by the verified
   email. **Sign in with Apple** follows the same shape if chosen (§4).
7. Later launches open the last church directly (its 30-day cookie); a signed-out member app inside the shell
   returns to the launcher instead of showing its own login page.

**Policy naming to fix:** the owner's "invited" means "only people already in the church's People can create an
account". In code that is `sign_in_policy = 'directory'`; `'invited'` means no new accounts at all
(`canJoin`, `server/auth.js:281`). **OWNER decision 3** confirms which Meadowbrook uses; the flow works with either.

### One code path, two builds
- **Build profiles** replace the single `mobile/church.config.json`: `mobile/profiles/<name>.json` with only store
  identity: display name, bundle id, icon and splash files, `directoryUrl`, `pinnedChurch` (a slug, or `null` for
  the product), associated-domain hosts, `allowNavigation` hosts. `npm run sync -- --profile meadowbrook` writes
  `www/church-config.js` and an `ios/App/profile.xcconfig` (bundle id, display name, entitlements), so one Xcode
  project builds either app. Profiles are configuration, not code (rule 8); "Steeple" lives only in a future
  product profile.
- **Pinned build:** `pinnedChurch: "meadowbrook"` → the launcher never shows a picker or church search; a person
  whose email is in another product church only sees Meadowbrook. Product build: same launcher, picker on.
- **Everything else from the server:** `GET /api/app/config` gains a `brand` block: `logo_url`, `accent`,
  `background`, `status_bar`, `privacy_url`, `support_email`, `connect_url`, `native_push` (bool),
  `min_app_build` (settings key, prompts "Please update the app"). Tabs and home already come from `app_config`.
  The launcher caches the last brand so the next launch is drawn in the church's colours before the network.
- **App identification:** `appendUserAgent: "ChurchHubApp/<version> (<build>)"` (neutral name) so the server and
  support can tell app versions apart.

### The directory contract, served by the hub itself first (the smallest step)
- Versioned public API: `POST /api/directory/v1/code` (uniform answer, same rate limits and ceiling as `/auth/code`),
  `POST /api/directory/v1/password` and `/verify` → returns `[{ slug, name, logo_url, host, ticket }]`;
  `GET /api/directory/v1/churches/:slug` (public brand). Church side: `GET /auth/ticket?t=` (random, single use,
  60 seconds, stored hashed, bound to the church) starts the normal `mb_session` cookie, first-party on the church
  host, then opens `/app/`.
- **Single-church mode now:** Meadowbrook's hub answers the contract for itself (its own `users` and `people`, its
  own `sign_in_policy`); settings `church_slug` and brand. **Later (plan.md Phase 1-2):** the same contract is
  served by the product's central directory (`directory.db`, HMAC email index); the product profile simply points
  `directoryUrl` there. Meadowbrook's pinned build can stay on its own hub or move to the central one by changing
  one profile value in an app update. No big bang, no tenancy built now.
- CORS: only on `/api/directory/v1/*`, only for origin `capacitor://localhost`, no credentials; `x-mb: 1` still
  required (allowed header). The cookie is never set cross-site.
- **Spike first (mobile-engineer, read-only, 2h):** with no `server.url`, confirm in
  `mobile/node_modules/@capacitor/ios` that the bridge and plugins work on a page navigated to from the bundled
  launcher onto an `allowNavigation` host. Fallback if not: keep `server.url` = the pinned church host and serve the
  launcher from the church hub at `/app/start` (same contract, same code). Decide before building the launcher.
- **Maps to plan.md:** this pulls the *contract* of Phase 1 and the *launcher* of Phase 3 forward, on one church.
  Phase 2 (dispatcher, jobs loop, per-church secrets) is untouched and still after Easter.
- Effort: launcher 12-16h (mobile-engineer, ui-ux-specialist, accessibility-specialist); directory contract,
  tickets, CORS, tests 16-22h (senior-developer); Google via auth session 8-12h; security review 6-8h.

## 4. App Store checklist (late 2026; re-check the guidelines at submission)

| Requirement | Plan | Who |
|---|---|---|
| **4.2 minimum functionality** | Native push, badge, offline snapshot, universal links, pull to refresh, haptics, native sign-in launcher, share sheet. Review notes list them | mobile-engineer |
| **4.2.6 template apps** | Meadowbrook's app is submitted from Meadowbrook's own account with its own content: allowed. The product app later is one app for many churches (like Church Center), from the LLC | owner |
| **5.1.1(v) account deletion** | More → My info → "Delete my account": explains what happens, confirms with a fresh code. Removes the sign-in: sessions, Web Push and device tokens, password, notification choices; the login becomes "Deleted account". The church's records about the person (household, children's check-in history, giving for tax statements) are not erased automatically: a request goes to the office (reuse `POST /me/office-request`) and the privacy page says what is kept and why. If Sign in with Apple is used, its token is revoked through Apple's REST API. **OWNER decision 5** (rule 7, destructive data) | senior-developer, security-specialist |
| **4.8 Sign in with Apple** | Google in the app as a primary sign-in triggers 4.8. Options: (a) add Sign in with Apple, native sheet via a small in-repo Swift bridge (AuthenticationServices; no plugin), server verifies Apple's identity token with built-in `crypto` against Apple's published keys. First Apple sign-in may give a hidden "relay" email that won't match People, so it asks for an email code once to link. Needs a Sign in with Apple key in env vars and the relay sending domain registered; (b) hide Google in the app (no 4.8); (c) keep Google only and argue the church-account exemption (rejection risk). **Recommended (a)** for the product path; (b) is the fallback to avoid delaying submission. **OWNER decision 1** | senior-developer, mobile-engineer, security-specialist |
| **1.2 user-generated content** (chat) | "Report" on a message (notifies staff, logged), "Hide this person's messages", staff delete (exists), contact in the listing | senior-developer, ui-ux-specialist |
| **5.1.1 sign-in required** | Allowed for account-based apps; review notes explain the church's member content is account-based and the website stays open to guests | training-writer |
| **3.2.2 donations** | Give keeps opening Safari (today's behaviour) unless Meadowbrook becomes an Apple-approved nonprofit. Event fees for real-world events may stay in-app | — |
| **Privacy policy URL** | `public/privacy.html` is static, names Meadowbrook and says sign-in is Google only (tech-debt 17). Rewrite per church from settings (church name, contact), cover email/password/Apple sign-in, push, chat, children, deletion, retention | senior-developer, training-writer |
| **Privacy nutrition labels** | Linked to you, for app functionality, no tracking: Contact Info (name, email, phone, address); User Content (messages, photos, files, form answers); Identifiers (user ID); Health (children's allergies and medical notes, entered by parents or staff, staff pages open inside the app); Sensitive Info (church membership may count as religious belief); Financial Info only if giving history shows in the app. No analytics SDKs | mobile-engineer, security-specialist |
| **Children, COPPA** | The app isn't directed to children; children have no accounts; their records are entered by parents and staff. Keep app accounts for ages 13 and up (OWNER decision 5). Not legal advice: check the amended COPPA rule and any US state app-store age laws and Apple's age-range signals at submission | owner, security-specialist |
| **Age rating** | Answer Apple's age-rating questionnaire honestly (user messaging: yes; web content: limited). Expect around 13+ | owner |
| **Reviewer demo account** | Sign-in is required, so Apple needs one. Password account (codes can't reach reviewers) with volunteer role on a made-up "App Review" team of made-up people, scheduled on a made-up service; security-specialist verifies it sees no real person's details; switched off after review. **OWNER decision 6** | security-specialist, senior-developer |
| **Screenshots** | iPhone 6.9-inch set (1320×2868 portrait), 3 to 10, taken from `npm run demo` data only (never real people). App made iPhone-only and portrait to avoid iPad screenshots and iPad review | ui-ux-specialist, mobile-engineer |
| **Listing** | Name, subtitle, keywords, category (Lifestyle), support URL, privacy URL, 1024px icon without transparency, copyright | training-writer, owner |
| **App Review notes** | Who the app is for, that it's Meadowbrook's own, the native features, demo account, Give opens Safari, chat moderation | training-writer |
| **TestFlight** | Internal testers must be App Store Connect users on the church's account (gives account access): owner only. Staff join as **external** testers (up to 10,000; the first build gets a short Beta App Review). Builds expire after 90 days | mobile-engineer, owner |
| **Versioning** | `MARKETING_VERSION` 1.0.0; `CURRENT_PROJECT_VERSION` +1 on every upload; git tag `ios-<version>-<build>`; noted in `mobile/README.md`. Server never requires a newer build; `min_app_build` prompts to update | mobile-engineer |
| **Export compliance** | Only standard HTTPS: `ITSAppUsesNonExemptEncryption = false` in `Info.plist` | mobile-engineer |
| **Info.plist hygiene** | `UIRequiredDeviceCapabilities` says `armv7` (should be `arm64`); iPhone landscape and iPad orientations listed; usage strings come from `app-links` and should use the build profile's name (tech-debt 18) | mobile-engineer |

## 5. Release plan

| Phase | Work | Gate to the next phase | Owner steps |
|---|---|---|---|
| **A. Internal TestFlight** (December, around the staff beta; no server change) | Merge `claude/app-links`; build profiles and `profile.xcconfig`; Info.plist hygiene, export flag, version numbers, user-agent tag; real bundle id in the church's team; tester guide | Owner and 5+ staff use it for 2 weeks with the `mobile/README.md` checklist; no blocker open | App Store Connect access (item 21: find the 2-factor holder or ask Apple); create the App ID and app record; Xcode → Archive → Upload on the Mac; invite testers |
| **B1. Server groundwork** (January, **merged before ~7 Feb**; nothing sign-in related merges during the kids' check-in pilot, ~7 Feb to ~1 Mar) | Directory contract in single-church mode, tickets, CORS; `device_tokens`, routes, `apns.js`; AASA file; account deletion; chat Report and Hide; privacy page from settings; `brand` block | `npm test` green with new tests; security review passed; live and invisible to the website | Approve the sign-in change and deletion rules; paste APNs and Apple values into Render |
| **B2. Native features** (January to March, app builds only, can continue during the pilot via TestFlight) | Launcher, plugins, transitions, pull to refresh, haptics, badge, keyboard, offline snapshot, push in the shell, universal links, Google and (if chosen) Apple sign-in | Staff TestFlight round passes the device checklist (sign-in, push, links, offline, deletion on a test account); accessibility pass | Approve the plugin list; Xcode capabilities (Push, Associated Domains, Sign in with Apple); upload builds |
| **C. App Store submission** (2 to 13 March, or from 13 April after the Easter freeze) | Listing, screenshots, labels, age rating, review notes, demo account; "manually release" after approval | Approved by Apple; release checklist done; whole-church launch date set | Answer the questionnaires, submit, release when ready |

Store review deploys nothing, so submission may happen during the freeze, but any server fix Apple asks for waits
until 13 April. The kids' check-in pilot keeps priority throughout.

## 6. Risks

- **Apple may still call it a web wrapper (4.2).** Mitigation: the native items above, all visible in the review notes.
- **A sign-in bug could open the wrong account or church.** Tickets single use, short, hashed; uniform answers;
  tests for expiry, reuse, wrong church, open redirect, enumeration; security review before merge.
- **Store name clash:** if Subsplash's live listing in the same account is already "Meadowbrook Church", a second
  app can't use that name; replacing Subsplash's listing needs its bundle id and Subsplash's cooperation (item 21).
- **Demo account on live data** could expose real people if set up wrongly: security-specialist verifies.
- **Older app builds** stay installed for months: feature detection and `min_app_build`, never server changes that
  need a newer app.
- **Multi-church impact:** keeps every path in [architecture.md](../../architecture.md#multi-church-saas-readiness)
  open: profiles carry the only church values, the directory contract is the product's, tokens carry `app_id`,
  APNs keys stay deployment-level. Would close a path: custom church domains in the product app (avoid, §1).
- **Effort is larger than plan.md's 50-70h** because the launcher, directory contract, deletion, chat reporting and
  Apple sign-in come forward: about **140 to 190 agent-assisted hours** plus about 8 to 12 owner hours on the Mac and
  in Apple's sites.

## 7. Owner decisions (plain language)

**Answered by the owner on 27 Nov 2026:**
1. **Sign in with Apple: yes (a).** Google stays in the app, and Sign in with Apple is added beside it. It needs a Sign in with Apple key in the Render environment variables (the owner adds it; never in code or chat), and the relay email domain registered with Apple.
2. **Same screen for everyone after the email** (the recommended option).
3. **"Directory":** people already in People can create their own account.
4. **The free official add-ons are approved**, pinned to exact version 8 releases.
5. **Account deletion approved as written.** App accounts are for ages 13 and up.
6. **Apple's test account:** the free option, a made-up volunteer on the live Hub.
7. **A separate app for early testing.** It has its own bundle id, through TestFlight and then possibly its own listing. When the app launches to the whole church, it may replace the Subsplash app instead. That needs Subsplash to transfer the app to the church's Apple account, and a build under that app's bundle id.
8. **The church finder starts on Meadowbrook's own server** and moves to the product's central service later.

The original questions follow, for the record.


1. **Google in the app:** add Sign in with Apple (recommended), or hide Google inside the app (fastest to approve), or
   keep Google alone and risk rejection?
2. **After the email, same screen for everyone** (safer: nobody can test who's a member) **or Faith Teams' style**
   of showing "password" to members and "join" to others (smoother, but reveals who has an account)?
3. **Who may create an account at Meadowbrook:** only people already in People (setting "directory"), or nobody new
   at all (setting "invited", the office creates every account)?
4. **Approve these free official app add-ons**, pinned to version 8: push notifications, status bar, splash screen,
   keyboard, haptics, share, app (links), preferences (offline copy); plus small in-house iPhone code for the badge,
   Google and Apple sign-in. No paid services.
5. **Deleting an account:** OK that it removes the sign-in at once while the church's records (household, children's
   check-in history, giving statements) go to the office to decide, and that app accounts are for ages 13 and up?
6. **Apple's test account:** a made-up volunteer on a made-up team on the live hub (recommended, free), or a separate
   demo server (costs a small monthly Render fee)?
7. **Store name:** a new listing (for example "Meadowbrook Church" if free, otherwise "Meadowbrook Church Hub") now, or
   wait and replace the Subsplash app as an update later?
8. **The church finder ("directory"):** start on Meadowbrook's own server now and move to the product's central
   service when the LLC launches (recommended), or build the central service first (later, more cost)?

## Steps

| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 1 | Review and merge `claude/app-links` | security-specialist (review), owner (merge) | Review yes | — |
| 2 | Approve this plan and decisions 1 to 8 | owner | — | — |
| 3 | Bridge spike (launcher vs `server.url`); propose exact plugin versions | mobile-engineer | Yes | 2 (parallel with 4) |
| 4 | Threat model for directory contract, tickets, Apple and Google return, deletion, demo account | security-specialist | Yes | 2 (parallel with 3) |
| 5 | Phase A: profiles, Info.plist, versioning, TestFlight steps, tester guide | mobile-engineer, training-writer | No | 1, 3 |
| 6 | Launcher and sign-in screens design, wording, accessibility | ui-ux-specialist, accessibility-specialist | Yes (design) | 2 (parallel with 5) |
| 7 | B1 server: directory contract, tickets, CORS, `device_tokens`, `apns.js`, AASA, deletion, Report/Hide, privacy page, `brand` block, tests | senior-developer | No | 4 |
| 8 | Security review of step 7 | security-specialist | Yes | 7 |
| 9 | B2 shell and member app: launcher, plugins, native feel, offline, push, links, sign-in bridges | mobile-engineer, senior-developer | No | 3, 6, 8 |
| 10 | Device test round on TestFlight; regression on web and home-screen app | qa-engineer, owner | Yes | 9 |
| 11 | Store listing, labels, review notes, screenshots, help text | training-writer, ui-ux-specialist, mobile-engineer | No (docs) | 10 |
| 12 | Final review against this plan, release checklist | chief-architect | Yes | 10, 11 |
| 13 | Submit and release | owner | — | 12 |

Docs updated in the same PRs: `architecture.md` (directory contract, launcher, profiles), `database.md`
(`device_tokens`), `api.md` (directory, devices, AASA, ticket, env vars), `security.md`, `permissions.md` (deletion,
Report), `features.md`, `mobile/README.md`, `.env.example`. The **release checklist applies** to B1, B2 and C.

## Owner approvals needed

The plan; the sign-in change (directory contract, tickets, sign-in required in the app, Google and Apple return;
rule 7); account deletion rules (rule 7, destructive); the plugin list (rule 6); Apple capabilities and keys in
Meadowbrook's account; the store name and listing; the demo account; submission timing against the pilot and the
Easter freeze. FCM and Google Play wait for Android.
