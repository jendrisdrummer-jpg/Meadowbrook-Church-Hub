# Plan: the phone app and serving many churches

Chief Architect · 26 November 2026 · **Status: plan approved by the owner on 26 November 2026 (Phase 0 and option (a)); each later step still needs its own approval. See "Owner decisions" below.**
Product name undecided ("the product" below; front-runner "Steeple"). Direction: [master roadmap §12 "Product
direction"](../../master-product-roadmap.md#12-stage-2-and-stage-3), decision 20 in
[§13](../../master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation), backlog L4 and L6 in
[roadmap.md](../../roadmap.md).

## In plain words (for the owner)

1. **First, a demo app for Meadowbrook only** that you install on your own iPhone and an Android phone to show
   leadership. It's a thin "frame" around the member app that already works; nothing on the live site changes.
2. It costs nothing: your Mac with Xcode and your free Apple ID for the iPhone (it needs re-installing every 7
   days), and a downloadable install file for Android. No paid Apple or Google accounts yet.
3. In the demo app people sign in with an **email code or password**. Google sign-in is blocked by Google inside apps,
   so it's hidden there for now (it keeps working on the website).
4. **Phone notifications keep coming from the home-screen app (Web Push)** during the demo. Notifications inside the
   real app need the paid Apple account; that comes later.
5. **To serve many churches, I recommend one server holding a separate database file for each church**, plus a
   small "directory" that knows which church an email belongs to. Each church's data stays in its own file,
   backed up and restored on its own. Meadowbrook's file stays exactly where it is.
6. I recommend against putting all churches into one shared database: it would mean changing about 730 queries
   in 65 tables, and one missed check could show one church's people to another.
7. The shared store app then works like Faith Teams: enter your email, get a code, and the app opens your
   church (or lets you pick, if you belong to several). "Find your church" is only for visitors.
8. Timing: demo app in early December; the safe groundwork in January; **nothing multi-church goes live from
   about 7 February to 1 March** (kids' check-in pilot) or during the Easter freeze; the risky switch-over after Easter.
9. The whole-church launch shouldn't wait for the store app: the member app already works on phones.
10. You'll be asked to approve, one at a time: this plan, sign-in changes, the paid Apple account (about $99/year),
    Google Play (about $25 once), a product web address, and any hosting increase.

## Owner decisions, 26 November 2026

- **Update, 26 Nov evening:** the first store app is a **Meadowbrook Church app from the church's own Apple and
  Google developer accounts** (the ones Subsplash uses), kept permanently for Meadowbrook; the product app comes
  later from the LLC's accounts, from the same code (different name, icon, settings). This brings TestFlight forward
  with no new cost. See master roadmap §13 items 21–22.

- **Approved:** this plan, Phase 0 (the demo app) and option (a), one database file per church plus a directory.
- **Sign-in:** like Faith Teams. Download the app, enter email and password (or a code), and land in your church.
- **Keep Google sign-in in the app.** Google blocks it inside an embedded web view, so the shell opens Google in
  the system browser (Capacitor's in-app browser / `ASWebAuthenticationSession`) and returns to the app with a
  one-time ticket. This replaces "hide the Google button" in Phase 0; it is a sign-in change, so it gets its own
  security review.
- **Android:** not needed for Phase 0 (no beta tester uses Android). The GitHub Actions APK build waits until later.
- **Timing:** the owner wants the **store app ready before the whole-church launch**, so people download an app as
  they do with Faith Teams today and are never taught "add to Home Screen" first. The developer's suggestion, for
  the owner to confirm: ship the store app for **Meadowbrook only** (the directory holds one church) as soon as
  the paid Apple account is approved, before the multi-church switch-over, and hold the whole-church launch until
  it's in the App Store. This brings the Apple account (~$99/year), the product name and TestFlight forward.

## Phase 0 as built (27 November 2026)

The iPhone shell is in `mobile/` (see [mobile/README.md](../../../mobile/README.md)): Capacitor 8.6.3, hosted URL,
bundled offline page, icon and splash redrawn from `public/icons`, and the generated iOS project (Swift Package
Manager) committed. Android is not added yet. The member's login page hides the Google button when
`window.Capacitor` reports a native shell (a front-end check only; server sign-in is unchanged).

**Next: [app-store-readiness.md](app-store-readiness.md)** (app-like features, native push, sign-in required in the app, store checklist).

**Follow-up (its own PR and security review, not in Phase 0): Google sign-in in the app.** Open Google in the system
browser (`@capacitor/browser` / `ASWebAuthenticationSession`), and have the server finish by redirecting to the app
with a short-lived, single-use, hashed ticket (custom URL scheme or Universal Link). The app exchanges the ticket
for the session cookie inside the web view. This changes sign-in, so: owner approval, security specialist review,
tests for expiry, reuse, wrong-device and open-redirect cases, and Apple's rule 4.8 (Sign in with Apple) to weigh.

---

## 1. Phase 0: the Meadowbrook demo app

**Goal:** a native app on two phones that opens Meadowbrook's live member app, for a leadership demo.
**Out of scope:** store submission, native push, Face ID, multi-church, any server change beyond one optional tweak.

### What the shell contains (recommendation: load the hosted member app)

| Option | For | Against |
|---|---|---|
| **Hosted URL** (shell opens `MB_APP_URL`, i.e. `/app` on the live site) **(recommended)** | Same origin as today, so the session cookie is first-party and sign-in just works; App Builder changes show instantly; no second copy of the front end; demo shows real, current data | Needs a connection (offline screen below); Capacitor describes `server.url` as meant for development, so the store version wraps it in a small bundled launcher (§4) |
| Bundled assets (copy `public/` into the app) | Opens offline; looks "more native" to Apple | Pages run at `capacitor://localhost`, so every API call is cross-site: the `mb_session` cookie (`SameSite=Lax`) becomes a third-party cookie that WKWebView blocks. Would need token sign-in, CORS and a release for every front-end change. Rebuilds what works |

**Shell contents (`mobile/`, its own `package.json`; the server keeps Express as its only dependency):**
- Capacitor core, iOS and Android platforms, plus the free official plugins `@capacitor/splash-screen`,
  `@capacitor/status-bar`, `@capacitor/app` (back button, deep-link events). All inside the approved Capacitor
  dependency; `mobile/` is excluded from the Docker image (`.dockerignore`) and from the server's `npm ci`.
- `capacitor.config` with `server.url` = Meadowbrook's member app address (a placeholder in the repo, set at build time
  from an env var, so no church-specific value lands in code), `allowNavigation` limited to that host, and
  `server.errorPath` → a bundled **offline page** ("You're offline. Check your connection, then tap Try again.").
- Icon and splash: one 1024×1024 PNG and one 2732×2732 splash from the owner (Meadowbrook logo for the demo; the
  product's logo later). Generated into platform sizes with Xcode's and Android Studio's asset tools (no extra tool).
- **Apple 4.2 "minimum functionality"** (matters for the store version, not the demo). Native touches that make it more
  than a website, in order of value: native push (§5), Face ID to unlock, a native church picker and sign-in launcher
  (§3), offline screen, deep links that open the right screen, app badge for unread, native share sheet, Android back
  button. Also required by Apple for the store: **in-app account deletion** (5.1.1(v)); if Google sign-in is offered
  in the app, **Sign in with Apple** too (4.8), which is a reason to keep the app on email sign-in; **giving opens in
  the browser** unless the church is an Apple-approved nonprofit (3.2.1/3.2.2), while event payments may stay in-app.

### Sign-in and cookies inside the app
- With the hosted URL the WebView's top page is the church's own site, so `mb_session` is a first-party, `Secure`,
  `HttpOnly`, `SameSite=Lax` cookie: it works unchanged and lasts 30 days. WKWebView keeps cookies across launches;
  a cookie set seconds before the app is killed can occasionally be lost (sign in again; acceptable for a demo).
- **Google sign-in inside a WebView is refused by Google** (`disallowed_useragent`). Capacitor would open Google in
  the system browser, which signs the person in to Safari, not the app. So in the shell: **email code and password
  only**. One small front-end change hides the Google button when `window.Capacitor?.isNativePlatform()` is true
  (Senior Developer, about 1 hour; login page only, no sign-in rule changes). Later, if wanted, Google via the system
  browser with a one-time hand-off code returned by deep link (a sign-in change; owner approval).
- Service workers don't run in WKWebView unless "app-bound domains" are set up; the member app works without one.
  **Web Push does not work inside either platform's WebView**, so the demo has no notifications; people keep the
  home-screen app for those. The "Turn on notifications" prompt should say so in the shell (same small change).

### Deep links (email "Accept" links)
- Demo: email links keep opening in the phone's browser. `respond.html` works there without signing in (signed link),
  so accept and decline already work. No change needed.
- Store version: iOS Universal Links need the Associated Domains capability (paid Apple account) and an
  `apple-app-site-association` file; Android App Links need `/.well-known/assetlinks.json`. Both are small static
  files served by the hub (Senior Developer, in the store phase).

### Owner steps: iPhone (about 1 to 2 hours the first time)
1. On the Mac: install **Xcode** from the App Store (large download) and **Node 22** (nodejs.org).
2. Get the code: `git clone` the repository (or download it), open Terminal in the `mobile` folder.
3. Run `npm install`, then `npx cap sync ios`, then `npx cap open ios` (Xcode opens).
4. Xcode → Settings → Accounts → add your Apple ID.
5. Click the app target → **Signing & Capabilities** → Team: "(Your name) (Personal Team)". If Xcode complains about
   the bundle ID, change it to something unique, e.g. `com.yourname.churchdemo`.
6. Plug in the iPhone, tap **Trust**. On the iPhone: Settings → Privacy & Security → **Developer Mode** → on, restart.
7. Choose the iPhone at the top of Xcode, press **Run** (▶).
8. First launch only: on the iPhone, Settings → General → **VPN & Device Management** → trust your developer profile.
9. It stops opening after **7 days**: plug in and press Run again. (A free account allows 3 such apps per phone.)

### Owner steps: Android phone
- **Recommended:** a GitHub Actions job builds a test APK (debug build) on GitHub's free runners, which have the Android
  SDK; you download it from the run page. Uses the already-approved free GitHub Actions, for a new purpose: say yes or no.
- Or on the Mac: install Android Studio, `npx cap sync android`, `npx cap open android`, Build → Build APK(s).
- On the phone: open the APK file, allow "Install unknown apps" for the browser or Files app when asked, install.
  No expiry. (Play Protect may warn about an unknown developer: tap "Install anyway".)

### What an agent can and can't do from the Linux cloud container (checked 26 Nov)
- **Can:** scaffold `mobile/`, write the config, offline page, Android project files, the Actions workflow and these
  steps (`registry.npmjs.org` is reachable; Java 21 and Gradle are installed).
- **Can't build iOS:** needs macOS and Xcode. The owner runs steps above.
- **Can't build the Android APK here today:** the Android SDK downloads from `dl.google.com`, which this environment's
  network proxy refuses. So: GitHub Actions or the owner's Mac. Not worth asking for an exception.
- **Can't test on a device:** the owner checks the demo on both phones (sign-in, App Builder home, schedule, chat,
  offline screen, Android back button).

**Effort:** 6 to 10 agent-assisted hours (scaffold, config, offline page, Actions job, front-end tweak, docs) + the
owner's 1 to 2 hours on the Mac. Size **S**.

---

## 2. Multi-church: options and recommendation

What already helps: `createApp({ db, uploadDir })` in `server/index.js` builds a whole hub around one database
handle; every router receives `db`; background jobs take `db`; per-church values live in `settings`; backups are
per database file. Campus scoping (`canCampus`/`campusFilter`) works *inside* a church and stays as it is; it is
not a tenancy mechanism.

| | (a) **Database per church in one service + directory** | (b) One shared database, `church_id` everywhere | (c) One Render service per church + directory |
|---|---|---|---|
| How | Request host name (e.g. `meadowbrook.<product>.app` or the church's own domain) picks the church; a dispatcher holds one `createApp` per church, each with its own SQLite file and upload folder. A small `directory.db` maps churches and email → church | Add `church_id` to ~65 tables, scope ~730 queries, settings keyed by church | Copy today's deployment per church; the directory is a separate small service |
| Isolation | Strong: a church's data is a separate file; a bug can't join across files | Weakest: one missed `WHERE church_id = ?` leaks data; needs tests on every route | Strongest |
| Code change | Moderate, mostly in one place (dispatcher, jobs loop, per-church integration settings) | Very large, touches nearly every file; risky to the live church | Smallest in the hub; directory still needed |
| Backups / restore | Per file, as today; restore one church without touching others | All or nothing; restoring one church means surgery | Per service, as today |
| Migrations | Run per file on start (loop); a slow file delays only start-up | Once, but every migration affects everyone | Per service; N deploys to keep in step |
| Cost (Render) | One service; move to a bigger instance and disk as churches grow (roughly $7 to $25+/month per step; check current prices). Ceiling: SQLite is one process, so one instance; past that, a second service and the directory points churches at it (that is (c) as the growth path) | One service, same ceiling | Roughly a paid service plus disk **per church** each month, plus the directory; ops work grows with every church |
| Native push, Stripe, mail keys | One product-wide APNs/FCM key; per-church Stripe/Mux/Google keys in settings (encrypted) | Same | APNs/FCM key copied into every service |
| Meadowbrook carry-over | **No data migration**: its file stays at `/data/meadowbrook.db`, its addresses stay, so sessions, installed home-screen apps and push subscriptions keep working | Data copied/rewritten with `church_id = 1`; big bang | Nothing changes |
| Size | **L**, about 90 to 130 agent-assisted hours in all (below) | **XL**, 150 to 250 hours, high risk | **M** for the directory; cost and ops grow per church |

**Recommendation: (a)**, with (c) as the growth path when one server is full. It fits this codebase (the parts are
already passed `db`), keeps the isolation churches expect, keeps per-church backups and restores, and needs no
change to Meadowbrook's data. Reject (b).

**Design of (a), in brief**
- **Directory** (`directory.db`, own small migration list): `churches` (slug, name, city, host(s), db path, upload
  dir, status, listed-for-search flag, server URL for later sharding); `members_index` (HMAC of the email with a
  server secret, church id), kept in step when accounts are created, renamed or deactivated, and backfilled once
  from each church's `users`. Stores no names or plain emails. Backed up nightly like the church files.
- **Dispatcher** in `server/index.js`: host → church → that church's app; unknown host → product landing page.
  Cookies stay host-only, so sessions are naturally per church.
- **Background jobs** loop over active churches, one at a time, each with its own `db` (they already take `db`).
- **Integrations per church**: SMTP, Stripe, Mux, Daily, Google, YouTube move from env vars to per-church settings,
  secrets encrypted with a master key held in Render env vars. Meadowbrook keeps falling back to today's env vars,
  so nothing changes for it. Product-wide items stay in env vars: APNs/FCM keys, directory secret, product mail sender.
- **Uploads:** `MB_UPLOADS/<slug>/`; Meadowbrook's existing folder is registered as-is (no file moves).
- **Church setup** (owner/support only, not self-service at first): create a church = new file, migrations, first
  admin invite, directory row. A self-service wizard and importers are later (L4).
- **Leftover "Meadowbrook" defaults** in code (e.g. the `church_name` fallback in `server/auth.js`) become neutral
  (tracked in [tech-debt.md](../../tech-debt.md)).

**Effort for (a), agent-assisted hours:** directory and email index 15 to 20 · dispatcher, per-church uploads,
jobs loop 25 to 35 · per-church integration settings with encryption 30 to 45 (can be staged: the first new churches
may share the product's mail sender) · church creation script 8 to 12 · security review, tests, two restore drills
10 to 15. Total **about 90 to 130 hours**, spread over several PRs.

---

## 3. Sign-in in the shared app

1. **Email first.** The launcher (bundled in the app, product-branded) asks for an email and calls the directory.
   The directory **always answers the same way** ("If you have an account, we've sent a code"), after the same delay,
   and only then looks the email up: no way to learn whether an email belongs to any church (same pattern as today's
   `POST /auth/code` in `server/auth.js`).
2. **Code proves the email.** The 6-digit code is emailed by the product sender. After the code is right, the
   directory returns the person's churches (names and logos only).
3. **One church:** opens directly. **Several:** they pick; the app remembers the last one and offers "Switch church"
   in the profile menu. Being signed in to two churches at once works because each church has its own host and cookie.
4. **Hand-off:** the directory gives a one-time ticket (random, single use, 60 seconds, bound to the church); the app
   opens `https://<church host>/auth/ticket?t=…`, the church server checks it with the directory and starts its normal
   session. Passwords still work on each church's own sign-in page; in the app, after the first code sign-in, Face ID
   (store phase) keeps people signed in so codes are rare.
5. **No account:** "Find your church" searches listed churches by name or town and opens the church's member app as a
   guest (today's guest mode). Joining then follows that church's own `sign_in_policy`.
6. **Rate limits:** reuse `server/ratelimit.js`: per IP, per email and a product-wide code ceiling on the directory, as
   today per church; ticket redemption limited per IP; church search limited and returns only listed churches.
7. **Meadowbrook today:** its website sign-in is unchanged; email-first is added in the app and on the product's
   landing page. This is a **sign-in change: owner approval and a security review first.**

## 4. App Builder and branding per church

- Each church's App Builder layout and branding already live in that church's `settings`; under (a) nothing moves.
- The app icon, store listing and launch splash are the product's (one app). After the church opens, everything
  inside is the church's: name, logo, colours, tabs, home widgets.
- The bundled launcher shows each church's logo and colour from the directory (copied from settings on change) and
  sets the status bar colour from `brand_color` through a tiny bridge in the shell.
- The launcher stays small and rarely changes; the church's app itself is always loaded from its server, so App
  Builder changes need no app-store release.

## 5. Native push later (APNs and FCM) alongside Web Push

- Keep Web Push for the website and home-screen app exactly as now (`server/push.js`, VAPID keys in settings).
- Add a `kind` (`web`, `apns`, `fcm`) to device registrations (additive migration on `push_subscriptions`, or a
  sibling `device_tokens` table) and teach the sender to pick the channel. Notification choices (`users.notify`)
  stay the same.
- **APNs:** HTTP/2 with a signed token, doable with Node's built-in `http2` and `crypto` (no new server dependency).
  Needs the paid Apple account and one key for the product's app.
- **Android:** a native app can't receive Web Push in its WebView, so Android needs **FCM** (free, but a new Google
  service: owner approval). Sent with Node's `fetch` and a service-account token, no new dependency.
- Shell side: `@capacitor/push-notifications` (official Capacitor plugin). Tapping a notification opens the right
  screen through the deep-link handler.
- Under (a) the keys are product-wide env vars and each church's server sends through them; device tokens stay in
  each church's file.
- Effort: about 20 to 30 hours. Store app overall (launcher, Face ID, push, account deletion, deep links, store
  listings): **L, about 50 to 70 hours.**

## 6. Timeline

| When | Work | Goes live? | Owner approvals at this step |
|---|---|---|---|
| Early Dec (before staff beta) | **Phase 0** demo app; hide Google in the shell | No server change, except the small front-end tweak (with the next deploy) | This plan's Phase 0; Actions for the APK; the front-end tweak |
| Mid-Dec to early Jan | Staff beta. Architecture work paused; at most review of this plan | — | Approve option (a) |
| Jan | **Phase 1** (additive): directory, email index backfill, neutral defaults, church-creation script tested on a copy | Yes, invisible to members | Sign-in change design; security review; backup first |
| ~7 Feb to ~1 Mar | **Kids' check-in pilot (~21 Feb) has priority.** No multi-church merges to `main` | No | — |
| Early Mar (2 to 13 Mar) | Phase 2 on a branch: dispatcher, jobs loop, per-church settings; rehearsal on a copy of the live file plus a **restore drill** | Only if fully ready by ~10 Mar; otherwise after Easter | Data cut-over with backup and restore drill |
| 14 Mar to 11 Apr | **Easter freeze.** Store-app work on a branch only (no deploys) | No | Paid Apple account (~$99/yr) if TestFlight is wanted right after Easter; FCM |
| From 13 Apr | Phase 2 live (Meadowbrook as the only church); **Phase 3** store app: TestFlight with staff, native push, Face ID | Yes | Product name; product domain; Google Play (~$25); any Render upgrade |
| After | Second church (pilot), setup wizard, importers (L4) | Yes | Pricing, terms, privacy policy for other churches |

The whole-church launch replacing Faith Teams should **not** wait for the store app; the member app and home-screen
install already work.

## 7. Risks and questions for the owner

**Risks**
- **Apple review** may still reject a WebView app as "minimum functionality"; the native touches in §1 reduce this.
- **A sign-in mistake could expose an account** at the wrong church: the directory and ticket design needs a
  security review and tests before it's live.
- **Changing Meadowbrook's addresses** would sign everyone out and break installed home-screen apps and
  notifications: keep them.
- **Holding other churches' secrets** (Stripe, email) makes the server a bigger target: encryption, audit and backups
  of the directory are part of the work.
- **One server for all churches** means one outage affects all; fine for a handful, revisit with growth.

**Questions**
1. Approve option (a), one database file per church?
2. Is the early-December demo timing right, and may GitHub Actions build the Android test file?
3. OK to hide Google sign-in inside the app (it stays on the website)?
4. When should the paid Apple account (~$99/year) be bought: before or after Easter?
5. Is FCM (free Google service) acceptable for Android notifications?
6. Product name and web address (needed before store submission and other churches' addresses).

## Steps

| # | Step | Agent | Read-only? | Depends on |
|---|---|---|---|---|
| 1 | Approve this plan (Phase 0 and option (a)) | owner | — | — |
| 2 | Phase 0 shell in `mobile/`, offline page, APK workflow, steps doc | senior-developer + devops-engineer | No | 1 |
| 3 | Hide Google and the push prompt in the shell | senior-developer | No | 1 (parallel with 2) |
| 4 | Review shell config (allowed hosts, no secrets) | security-specialist | Yes | 2, 3 |
| 5 | Owner runs the demo on both phones | owner | — | 4 |
| 6 | Directory and sign-in design review | security-specialist | Yes | 1 (parallel with 2 to 5) |
| 7 | Phase 1: directory, index, ticket sign-in, tests | senior-developer | No | 6, staff beta done |
| 8 | Test plan and regression | qa-engineer | No | 7 |
| 9 | Phase 2: dispatcher, jobs loop, per-church settings | senior-developer | No | 8, after pilot |
| 10 | Rehearsal on a copy and restore drill | devops-engineer | No | 9 |
| 11 | Final review against this plan | chief-architect | Yes | 8, 10 |
| 12 | Phase 3 store app and native push | senior-developer + devops-engineer | No | 11, Apple account |

Each phase updates `docs/architecture.md`, `database.md`, `api.md`, `security.md`, `features.md` and uses the
[release checklist](../../release-checklist.md).

## Owner approvals needed
This plan; GitHub Actions for the APK; hiding Google in the app; option (a); the sign-in change (directory, codes,
tickets); each data cut-over (backup and restore drill first); Apple Developer (~$99/year); Google Play (~$25 once);
FCM; a product domain; any Render plan increase; the product name.
