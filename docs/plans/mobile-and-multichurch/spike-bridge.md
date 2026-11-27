# Spike: launcher versus `server.url`, plugin versions, sign-in bridge, build profiles, TestFlight steps

Mobile Engineer · 27 November 2026 · read-only research for step 3 of
[app-store-readiness.md](app-store-readiness.md). No app code was changed. **Status: findings for the owner and
the next steps (5, 9).**

## How to read the evidence tags

- **[V]** verified by reading the installed sources: `@capacitor/ios`, `@capacitor/core`, `@capacitor/cli` at
  **8.6.3** (installed with `npm ci --ignore-scripts` from `mobile/package-lock.json` into a scratch folder,
  because `mobile/node_modules` is not checked in), the eight plugins' sources, and the repo files.
- **[R]** read from the npm registry (reachable from this environment) on 27 Nov 2026.
- **[I]** inference or recalled Apple behaviour. **Nothing here was run on a device, in Xcode or in a simulator**
  (this environment is Linux). Every [I] item is in the device checklist at the end.

---

## 1. Launcher versus `server.url`

### Recommendation

**Ship a bundled launcher (no `server.url`), then navigate the web view to the church's `/app/` on an
`allowNavigation` host.** Keep `errorPath: 'offline.html'`. Add one tiny in-repo native plugin ("Shell") whose
methods include `showLauncher()`, so signing out returns to the launcher without relying on a cross-scheme
`location` change. The fallback in the plan (keep `server.url`, serve the launcher from the hub at `/app/start`)
is **not needed**: the spike's question has a yes answer.

### What the sources show

1. **The bridge and every plugin are available on a remote page, with or without `server.url`.** [V]
   `JSExport` adds the Capacitor global, `native-bridge.js` and one script per registered plugin as `WKUserScript`s
   with `injectionTime: .atDocumentStart, forMainFrameOnly: true` (`JSExport.swift:20,107,212`). User scripts are
   not tied to an origin, so they run on **any main-frame document**, including `https://<church host>/app/`.
   The scripts define `window.Capacitor`, `Capacitor.Plugins.<Name>` and `Capacitor.PluginHeaders`; so
   `Capacitor.isNativePlatform()` and `Capacitor.isPluginAvailable('X')` work on the hosted page.
   **Consequence for the member app:** it has no bundler, so it must not `import '@capacitor/...'`. It calls
   `window.Capacitor.Plugins.PushNotifications.register()` etc. (and feature-detects with `isPluginAvailable`).
   This matches today's `inShell` in `public/js/push.js`.
2. **A bundled page may navigate to a remote host when that host is in `allowNavigation`.** [V]
   `WebViewDelegationHandler.decidePolicyFor` (`:67-130`): plugins get first say; then
   `shouldAllowNavigation(to: host)` → `.allow`; otherwise a top-level navigation to anything that is not the
   server URL or `capacitor://localhost` is cancelled and **opened in Safari**. So with no `server.url`, the launcher
   at `capacitor://localhost/` can go to `https://<host>/app/` only if `<host>` is listed. Sub-frame loads
   (iframes such as the Watch page's YouTube player) are not blocked by this function.
3. **With no `server.url`, `serverURL` falls back to `localURL`** (`CAPInstanceConfiguration.m:45-50`), and
   `loadWebView()` loads `localURL + appStartPath` (`CAPBridgeViewController.swift:167-179`), i.e. `www/index.html`
   becomes the first screen. `loadWebView()` only checks that the `www` folder exists, so adding `www/index.html`
   needs no other native change.
4. **`allowNavigation` matching is exact or single-level wildcard.** [V] `doesHost`
   (`CAPInstanceConfiguration.swift:59-77`): `*` alone matches everything; otherwise the host and pattern must have
   the **same number of dot-separated labels**, and `*` replaces one label. So `*.example.com` matches
   `a.example.com` but not `a.b.example.com` or `example.com`. This fits the plan's "product churches use
   `*.<product domain>`" rule. **Never use `"*"`**: it would give every site the bridge.
5. **`errorPath` works the same in both modes.** [V] `errorPathURL = localURL + errorPath`
   (`CAPInstanceConfiguration.swift:18-24`); it loads from the bundle in both. It fires only from
   `didFail` and `didFailProvisionalNavigation` (`WebViewDelegationHandler.swift:145-160`): **network failures
   only. An HTTP 502/503 from a sleeping Render instance renders the server's error page, not `offline.html`.**
   True today as well; the member app's own error handling (or a launcher pre-flight, below) must cover it.
6. **Plugin registration for in-app code.** [V] `CapacitorBridge.registerPlugins()` auto-registers classes from
   the `packageClassList` in the generated `capacitor.config.json` (`:333-362`). A class in the app target is not in
   that list, so register it by hand: `bridge?.registerPluginInstance(MyPlugin())` from
   `MainViewController.capacitorDidLoad()` (`registerPluginInstance` is public on `CAPBridgeProtocol`, `:80`, and
   works with auto-registration on; `registerPluginType` is a no-op when it is on, `:365-366`). The plugin must
   conform to `CAPBridgedPlugin` (`identifier`, `jsName`, `pluginMethods`), as `HapticsPlugin.swift` does.
   `capacitorDidLoad()` runs inside `loadView()` before `viewDidLoad()` loads the page, so the plugin's user
   script is in place for the first document. [V]
7. **Cold-start links reach the launcher.** [V] `@capacitor/app` posts `appUrlOpen` with
   `retainUntilConsumed: true` (`AppPlugin.swift:55,63`) and has `getLaunchUrl()`; `SceneDelegate.swift` already
   forwards `openURLContexts` and `continue userActivity` to `SceneDelegateProxy`. With the launcher, the first
   JS to run is the launcher's, so it can read the launch URL and decide (signed in → go straight to the church).

### Comparison

| | Launcher, no `server.url` (recommended) | `server.url` = church host |
|---|---|---|
| Bridge on the church page | Yes [V] (point 1) | Yes [V] (point 1) |
| First screen | Bundled `index.html`, native-feeling, works offline [V] | Remote page; blank until the network answers |
| Product app (many churches) | Natural: launcher picks the church, then navigates [V] | Impossible: `server.url` is fixed at build time |
| Signed out → launcher | Shell plugin `showLauncher()` loads `localURL/index.html` [I that a plain `location.href` to `capacitor://` from https also works; do not rely on it] | Same plugin works (`localURL` is served in both modes) [V] |
| Offline at launch | Launcher draws at once; can show the saved schedule (Preferences) and a "Try again" without any failed navigation [I] | Only after a failed navigation does `offline.html` appear [V] |
| Swipe-back | Use `location.replace(...)` from launcher to church so the launcher is not in the history and a back swipe cannot return to it [I] | n/a |
| App Review 4.2 | Better: the first thing a reviewer sees is bundled native-style UI, with Sign in with Apple and the notification and offline features behind it [I] | Reviewer's first screen is a web page: the classic "repackaged website" look [I] |
| Risk | Bridge exposure is the same; see below | Same |

### Risks of the bridge on a remote origin (same in both modes)

1. **Any main-frame page on an allowed host can call every registered plugin.** The native handler
   (`WebViewDelegationHandler.userContentController(_:didReceive:)`, `:192-220`) never checks which origin or frame
   sent a message: no `frameInfo`, no `securityOrigin` anywhere in the Capacitor sources [V]. Consequences:
   an XSS bug in the member app on the allowed host becomes native access (Preferences read/write, push
   registration, share sheet, the new sign-in plugin, and the core `CapacitorHttp` plugin, which makes native
   requests that skip CORS). Mitigations: keep `allowNavigation` to exact hosts (plus the product's single-level
   wildcard); keep the in-repo plugin's methods minimal and have each method check that
   `bridge.webView.url?.host` is an allowed host; keep the CSP and HTML escaping rules in
   [security.md](../../security.md).
2. **Iframes can probably reach the handler too.** [I from WebKit behaviour; the code confirms only that the
   handler has no frame check] The handler is registered with `contentController.add(self, name: "bridge")`
   (`:22`), which exposes `window.webkit.messageHandlers.bridge` to every frame in the page's content world,
   even though the helper scripts are main-frame only. The Watch page and the widgets embed third-party iframes
   (`public/js/member/watch.js:41`, `widgets.js:159`). A compromised or malicious embed could post a raw message.
   Mitigations: accept only the allow-listed embed hosts already used; **device test** that
   `window.webkit.messageHandlers.bridge.postMessage(...)` from a cross-origin iframe is or is not delivered; if it
   is, the frame cannot be told apart inside a plugin call, so make sensitive plugin methods verify
   `bridge.webView.url?.host` and keep secrets out of return values (the sign-in methods return an identity token or
   ticket to the caller, so those are the ones to protect: see §3).
3. **Cookies:** `CapacitorCookies` returns only non-HttpOnly cookies (`CapacitorCookieManager.swift:80,93`) [V].
   Confirm `mb_session` is HttpOnly in `server/auth.js` before relying on that (not checked here).
4. **Custom-scheme page can be asked to load remote content:** `/_capacitor_http_interceptor_*` and file proxy
   paths are blocked in `decidePolicyFor` (`:74-77`) [V]; nothing to do.
5. **Session cookie across origins:** the launcher is at `capacitor://localhost`, a different site from the church
   host, so a cookie set by a `fetch` from the launcher is third-party and Safari's tracking rules can drop it [I].
   The plan's one-time **ticket** that the web view then opens as a top-level navigation on the church host
   (`/auth/ticket?t=`) sets the cookie first-party, which is the right design. Keep it.

### Back to the launcher when signed out (sketch)

The member app, on a 401 or sign-out in the shell, calls `Capacitor.Plugins.Shell.showLauncher()` instead of
rendering its own login page. Native side: `webView?.load(URLRequest(url: bridge.config.localURL))`. The launcher
then clears its stored church if the person chose "Switch church". Store the last church in
`@capacitor/preferences` (native UserDefaults), not `localStorage` of `capacitor://localhost`, so it survives web
view storage clean-ups [I].

### Offline behaviour (what to build)

- `offline.html` stays as the network-failure page (both modes) and is the place that shows the saved schedule.
- Launcher pre-flight (optional, small): before navigating, `fetch(<church>/api/app/config)` with a short timeout;
  on failure or 5xx show the same offline view. This covers the "502 from a sleeping server" gap in point 5.

### App Review 4.2 (inference, not from the sources)

Review is about what the app does, not how it loads content. The launcher with Sign in with Apple, native push,
badge, haptics, share, offline snapshot and universal links is what the plan already lists as the 4.2 answer;
the launcher makes the first impression native. `server.url` is not itself a rejection reason, but it makes the
"just a website" reading more likely. Re-read guideline 4.2 and 4.2.6 at submission time.

---

## 2. Exact plugin versions (compatible with `@capacitor/core` 8.6.3)

All eight were installed together with `@capacitor/core@8.6.3` without conflicts. [V] Each declares peer
dependency `@capacitor/core >=8.0.0`, and its `Package.swift` depends on `capacitor-swift-pm from: "8.0.0"` and
`.iOS(.v15)`, which matches `CapApp-SPM` (`exact: "8.6.3"`, iOS 15). [V] Latest 8.x line per registry on 27 Nov 2026. [R]

| Package | Pin (exact) | iOS needs |
|---|---|---|
| `@capacitor/push-notifications` | **8.1.3** | Push Notifications capability (entitlement `aps-environment`); two `AppDelegate` forwarders (below). `UIBackgroundModes` `remote-notification` is **not** required for visible alerts and a badge; add it only if silent pushes are wanted later. |
| `@capacitor/status-bar` | **8.0.4** | `UIViewControllerBasedStatusBarAppearance = YES`: already true in `Info.plist`. |
| `@capacitor/splash-screen` | **8.0.2** | None. Use `launchAutoHide: false` and `hide()` from the launcher/app. |
| `@capacitor/keyboard` | **8.0.6** | None. `resize` (`native` default) is configured under `plugins.Keyboard` in `capacitor.config.js`. |
| `@capacitor/haptics` | **8.0.2** | None. |
| `@capacitor/share` | **8.0.3** | None. |
| `@capacitor/app` | **8.1.2** | None for universal links; **Associated Domains** entitlement `applinks:<host>`; `SceneDelegate.swift` already forwards the URL and user-activity callbacks. A custom URL scheme (for the Google return) is only needed if the auth session uses one; `ASWebAuthenticationSession` does not need it registered in `Info.plist`. |
| `@capacitor/preferences` | **8.0.1** | None in `Info.plist`. It uses `UserDefaults`, which is an Apple "required reason" API: add an app-level `PrivacyInfo.xcprivacy` declaring `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`. The plugins ship no privacy manifest and Capacitor's core one declares no accessed APIs [V]. (Reason code from memory [I]: confirm in App Store Connect's upload warnings.) |

Further requirements:

- **Entitlements file (new, `mobile/ios/App/App/App.entitlements`):** `aps-environment` (Xcode swaps
  `development` for `production` when it signs for TestFlight and the store [I]), `com.apple.developer.applesignin`
  = `Default`, `com.apple.developer.associated-domains` = `applinks:<host>`. None exists today; the project has no
  `CODE_SIGN_ENTITLEMENTS` setting. [V]
- **`AppDelegate.swift`:** add the two forwarders from the push plugin's README (`didRegisterForRemoteNotifications…`
  posts `.capacitorDidRegisterForRemoteNotifications`; the failure one posts `.capacitorDidFailToRegister…`). The push
  token returned to JS is **uppercase hex** (`PushNotificationsPlugin.swift:187`), which is what `device_tokens` and
  the APNs sender should expect. [V]
- **Info.plist:** keep `NSCameraUsageDescription` etc. from `claude/app-links`; `ITSAppUsesNonExemptEncryption =
  false`; `UIRequiredDeviceCapabilities` `arm64`; for Sign in with Apple nothing extra. No push plist keys.
- **Not a plugin, no Info.plist:** the badge bridge (`UNUserNotificationCenter.setBadgeCount`, iOS 16+; on iOS 15
  use `UIApplication.shared.applicationIconBadgeNumber`, which needs notification permission) goes in the in-repo
  Shell plugin. Deployment target is 15.0 today [V]: either keep 15 and branch with `#available`, or raise to 16
  (owner's call; check how many staff phones are older).
- **`cap sync` effects (files that change when plugins are added):** `package.json`, `package-lock.json`,
  `ios/App/CapApp-SPM/Package.swift` (one `.package(name:, path: "../../../node_modules/@capacitor/<x>")` per
  plugin: `spm.js:108-143`), and the generated, git-ignored `ios/App/App/capacitor.config.json` (the
  `packageClassList`). The Mac therefore needs `npm install` before Xcode resolves packages (the README already says
  so). [V]
- **Configuration keys** to add to `capacitor.config.js` under `plugins`: `SplashScreen { launchAutoHide: false }`,
  `Keyboard { resize: 'native' }`, `PushNotifications { presentationOptions: ['badge','sound','alert'] }`
  (read in `PushNotificationsHandler.swift:32`). [V]
- **Proposal for the owner (rule 6):** these eight pins are the list to approve. They are official, MIT licensed
  [V], no paid service.

---

## 3. The Swift bridge (outline only)

One local plugin, in a new file in the app target, registered by hand. Suggested name: `ShellPlugin` with
`jsName = "Shell"` (keeps the Sign in with Apple and Google calls, `showLauncher`, `setBadge`, in one place; split
later if it grows). **File mechanics:** the Xcode project uses explicit file references, so a new `.swift` file
needs four entries in `ios/App/App.xcodeproj/project.pbxproj` (`PBXBuildFile`, `PBXFileReference`, the `App` group,
the Sources build phase; compare how `SceneDelegate.swift` appears at `:18,162`). The repo's existing convention is
to avoid that by putting classes into `AppDelegate.swift` (`MainViewController` does). Either: put the plugin in
`AppDelegate.swift` (zero project changes, less tidy), or hand-edit those four entries and let the owner confirm
with `xcodebuild -list` / a first build. Do **not** put it in `CapApp-SPM` (the CLI rewrites it; "DO NOT MODIFY").

```swift
// Registration, in MainViewController
override func capacitorDidLoad() {
    webView?.allowsBackForwardNavigationGestures = true
    bridge?.registerPluginInstance(ShellPlugin())
}

@objc(ShellPlugin)
public class ShellPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
                          ASAuthorizationControllerPresentationContextProviding,
                          ASWebAuthenticationPresentationContextProviding {
    public let identifier = "ShellPlugin"
    public let jsName = "Shell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithGoogle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLauncher",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge",         returnType: CAPPluginReturnPromise),
    ]
    private var pendingCall: CAPPluginCall?          // keep: session and controller are weak otherwise
    private var webAuthSession: ASWebAuthenticationSession?
    private var appleController: ASAuthorizationController?
}
```

**Common guard (first line of every method):** reject unless `bridge?.webView?.url?.host` is `localhost`
(the launcher) or in the profile's allowed hosts, and reject if a call is already pending. Run UI work on the main
queue. `presentationAnchor`/`presentationAnchor(for:)` return `bridge?.viewController?.view.window`.

### Sign in with Apple (`AuthenticationServices`, iOS 13+)

- JS: `Shell.signInWithApple({ nonce })` where `nonce` is a random string created by the launcher; the server
  stores its SHA-256 for this attempt (or the launcher sends the raw nonce at redeem time, server hashes and
  compares with the token's `nonce` claim).
- Swift: `ASAuthorizationAppleIDProvider().createRequest()`, `requestedScopes = [.email, .fullName]`,
  `request.nonce = sha256(nonce)` (CryptoKit, hex); `ASAuthorizationController(authorizationRequests:)`, delegate
  and presentation provider set to self, `performRequests()`.
- Success (`didCompleteWithAuthorization`): take `ASAuthorizationAppleIDCredential`:
  `identityToken` (UTF-8 string, a JWT), `authorizationCode` (string), `user` (stable Apple id), `email` and
  `fullName` (**only on the first authorization ever for this app and Apple ID**; the server must store them then
  and rely on the token's `sub` afterwards). `call.resolve(["identityToken": ..., "authorizationCode": ...,
  "user": ..., "email": ..., "givenName": ..., "familyName": ...])`.
- Failure: map `ASAuthorizationError.canceled` to `call.reject("cancelled", "CANCELLED")` so the launcher stays
  quiet; other codes to `"FAILED"` with a plain message.
- Server (for the security review, not built here): verify the JWT signature against Apple's published keys
  (`https://appleid.apple.com/auth/keys`) with Node's `crypto`, check `iss = https://appleid.apple.com`,
  `aud = <the app's bundle id>`, `exp`, and the nonce; then look the email up in the directory. The email may be a
  private relay address (`…@privaterelay.appleid.com`) that matches nobody: the plan already handles that (ask for
  the email, then send a code). A Sign in with Apple **key** (`.p8`) is only needed for token revocation and for
  exchanging `authorizationCode`; Apple expects revocation when an account is deleted (5.1.1(v)) [I]. Not needed
  for the first TestFlight build.

### Google (`ASWebAuthenticationSession`, iOS 12+)

- JS: `Shell.signInWithGoogle({ url, callbackScheme })`. `url` is the hub/directory's own start URL
  (`/auth/google?app=1&challenge=<PKCE challenge>&state=<random>`), **not** Google's URL: the server owns the OAuth
  client and returns to `/auth/app-return`, which redirects to `<callbackScheme>://auth?ticket=…&state=…`.
  `callbackScheme` comes from the build profile (for example the bundle id), and is never read from the page
  without checking it equals the profile's value.
- Swift: `ASWebAuthenticationSession(url:callbackURLScheme:completionHandler:)`, `presentationContextProvider = self`,
  `prefersEphemeralWebBrowserSession = false` (shares the Safari Google login so people are not asked to retype;
  set `true` if the owner prefers no shared state), `start()`; keep a strong reference in `webAuthSession`.
  Because the deployment target is iOS 15, use the scheme form (`ASWebAuthenticationSession.Callback.https` needs
  iOS 17.4+).
- Completion: on success resolve `["ticket": ..., "state": ...]` from the callback URL's query items; on
  `ASWebAuthenticationSessionError.canceledLogin` reject `"CANCELLED"`. The JS then redeems the ticket with the
  PKCE verifier through the directory contract and navigates the web view (top level) to
  `/auth/ticket?t=…` on the church host.
- Why this is acceptable to Google: the sign-in happens in the system browser session, not in an embedded web view
  (the reason the demo app hides Google today, see `mobile/README.md`).
- Security notes: custom schemes are not exclusive, but `ASWebAuthenticationSession` only hands the callback to the
  session that started it; the ticket is still single-use, 60 seconds, bound to the PKCE verifier and the `state`,
  so a copied callback is useless. This is the item for step 4's threat model.

### Other methods in the same plugin

- `showLauncher()`: `DispatchQueue.main.async { self.bridge?.webView?.load(URLRequest(url: self.bridge!.config.localURL)) }`.
- `setBadge({ count })`: `UNUserNotificationCenter.current().setBadgeCount(count)` on iOS 16+, else the
  `applicationIconBadgeNumber` fallback.

---

## 4. Build profiles (`mobile/profiles/<name>.json`)

**Feasible with SPM and Capacitor 8.** [V for the mechanics below; the Xcode behaviour in 4 is [I] until built]

What makes it work:

1. `capacitor.config.js` is already a JS file evaluated on `cap sync` (it `require`s `church.config.json` today).
   It can read `process.env.CHURCH_PROFILE` (default `meadowbrook`) and `mobile/profiles/<name>.json`. `cap sync`
   writes `ios/App/App/capacitor.config.json` (ignored by git) from it. [V]
2. `cap sync` does **not** rewrite the bundle id or app name once the project exists: `editProjectSettingsIOS`
   runs only from `cap add` (`dist/tasks/add.js:105`). So the bundle id, display name, version and entitlements
   must be driven by Xcode build settings, which we control through an xcconfig. [V]
3. The target's settings in `project.pbxproj` currently hard-code `PRODUCT_BUNDLE_IDENTIFIER`,
   `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in both configurations (`:303,310,312,325,332,333`), and Xcode
   gives target-level `buildSettings` priority over an xcconfig. They must be **removed** from the target, and a
   generated `profile.xcconfig` attached as the target's `baseConfigurationReference` (Debug already points at
   `debug.xcconfig`, `:299`; Release has none). Plan: `profile.xcconfig` begins with `#include "debug.xcconfig"` for
   Debug and holds the profile values for both. Equivalent and lower-risk for the owner: two xcconfigs (Debug,
   Release) that both `#include "profile.xcconfig"`.
4. `Info.plist` already uses `$(PRODUCT_BUNDLE_IDENTIFIER)`, `$(MARKETING_VERSION)`, `$(CURRENT_PROJECT_VERSION)`
   [V]; change the hard-coded `CFBundleDisplayName` to `$(APP_DISPLAY_NAME)`, and add the usage strings as
   `$(APP_NAME)`-based text. Entitlements files also expand build settings (`applinks:$(APP_LINK_HOST)`) [I]; an
   array of several hosts cannot be generated from one variable, so allow `APP_LINK_HOST` and `APP_LINK_HOST_2`,
   or have `prepare.mjs` write the whole `App.entitlements` from the profile (simplest, and it is generated config,
   not code).
5. Icons and launch screen are asset catalogs (`Assets.xcassets`), not settings. A profile can name a source folder
   and `prepare.mjs` can copy images in (as `scripts/make-assets.py` produces them today); a profile with no
   artwork keeps the current ones.

**Files that change** (Phase A, step 5 of the plan):

| File | Change |
|---|---|
| `mobile/profiles/meadowbrook.json` (new), `mobile/profiles/README.md` (optional) | Profile values: `name`, `bundleId`, `appLinkHosts`, `allowNavigation`, `callbackScheme`, `directoryUrl`, `pinnedChurch`, `hostedUrl`, colours, version, asset paths. No secrets, no team id. |
| `mobile/church.config.json` | Removed or becomes a thin pointer (keep during migration so nothing breaks). |
| `mobile/capacitor.config.js` | Read the profile; drop `server.url`; `allowNavigation` from the profile; `plugins` config (Splash, Keyboard, Push). |
| `mobile/scripts/prepare.mjs` | Takes `--profile`; writes `www/church-config.js`, `ios/profile.xcconfig` (and `ios/App/App/App.entitlements`); fails if the profile is missing a required key. `package.json` script `sync` passes the profile through. |
| `mobile/www/index.html` (+ launcher JS/CSS), `mobile/www/church-config.js` | The launcher; `church-config.js` stays generated (consider git-ignoring it). |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | Remove the three hard-coded settings; attach the xcconfigs; add `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`; add the Swift file entries and `PrivacyInfo.xcprivacy` if used; set `TARGETED_DEVICE_FAMILY = 1`. Hand-edit; owner confirms by building. |
| `mobile/ios/App/App/Info.plist` | `CFBundleDisplayName`, usage strings, `arm64`, orientation lists, `ITSAppUsesNonExemptEncryption`. |
| `mobile/ios/App/App/AppDelegate.swift` | Push forwarders; `ShellPlugin` registration (or the new file). |
| `mobile/ios/.gitignore` | Ignore the generated `profile.xcconfig` if it holds only generated values. |
| `mobile/ios/App/CapApp-SPM/Package.swift`, `mobile/package.json`, `mobile/package-lock.json` | Changed by `cap sync` / `npm install` when plugins are approved and added. |
| `mobile/README.md` | Rewritten for profiles, the launcher and the TestFlight steps. |

Risks: (1) a hand-edited `project.pbxproj` that Xcode rejects: mitigated by small edits and by the owner opening the
project before anything else is merged; (2) the profile and Xcode drifting apart (today's README admits the bundle id
lives in two places): the xcconfig removes that drift; (3) `CAPACITOR_DEBUG` is set only by `debug.xcconfig`
and is `true` for Debug [V]; keep it out of the Release path.

---

## 5. Owner steps: first internal TestFlight build

For the church's Apple Developer account (a paid **organization** Program membership), the owner's Mac and a
current Xcode. Nothing below needs a secret in this repository. Do not paste Apple IDs, keys or certificates into
chat, code, docs or commits. **Before the first run** the owner needs the Phase A build (step 5 of the plan: profile,
entitlements, `Info.plist` fixes). These steps are written for that build; the screens named are Apple's current
ones and may be renamed.

**A. Decide the app's name and bundle id (5 minutes).**
1. The early test app is a separate app with its own bundle id (owner decision 7). Choose a reverse-domain id that
   you control and that is clearly the test app, for example `church.meadowbrook.hub.beta`. The value goes in
   `mobile/profiles/meadowbrook-beta.json`, not a secret. A bundle id cannot be changed later for that app record,
   and the store build later uses a different id, so do not reuse Subsplash's id here.
2. Choose an app name for App Store Connect (up to 30 characters; it can be changed before the first public
   release), for example "Meadowbrook Hub Beta". It must not clash with an existing listing in the account.

**B. Register the App ID (10 minutes).**
3. Sign in at developer.apple.com with an Admin or Account Holder login, open **Account → Certificates,
   Identifiers & Profiles → Identifiers**.
4. Press **+**, choose **App IDs → App**, then **Continue**.
5. Enter a description, choose **Bundle ID: Explicit**, type the id from step 1.
6. Under **Capabilities** tick **Push Notifications**, **Sign In with Apple** (leave "Enable as a primary App ID")
   and **Associated Domains** (needed for links that open the app). Then **Continue → Register**.
   (If you skip this, Xcode can create the same App ID for you when you add the capabilities in step 9; doing it here
   first makes mistakes visible.)

**C. Open the project and sign it (15 minutes).**
7. On the Mac: unzip or `git pull` the branch, then in Terminal in the `mobile` folder run `npm install`, then
   `npm run sync -- --profile meadowbrook-beta` (the form the build-profile change will provide), then `npx cap open ios`.
8. In Xcode click **App** (blue icon) → target **App** → **Signing & Capabilities**. Tick **Automatically manage
   signing**. Under **Team** choose the church's team (not a Personal Team). Check **Bundle Identifier** shows the id
   from step 1.
9. Check the capabilities list shows **Push Notifications**, **Sign in with Apple** and **Associated Domains**
   (with the church host as `applinks:<host>`). If one is missing press **+ Capability** and add it. Xcode will not
   show red errors when the App ID in step 5 has the same ones.
10. In **General**, set **Version** `1.0.0` and **Build** `1`. **Build must be higher on every upload.**

**D. Create the App Store Connect record (10 minutes).**
11. Open appstoreconnect.apple.com → **Apps → + → New App**.
12. Choose **iOS**; enter the name from step 2; choose the primary language; choose the **Bundle ID** from the list
    (it appears because of step 5); enter an **SKU** (any internal label, for example `hub-beta-1`); **User Access:
    Full Access**. Press **Create**.
13. You do not need screenshots, a description or a privacy policy for internal TestFlight testing. (You will for the
    store listing later.)

**E. Archive and upload (20 to 40 minutes, longer the first time).**
14. In Xcode choose the run target **Any iOS Device (arm64)** at the top (not a simulator).
15. **Product → Archive**. Wait for the Organizer window to open with the new archive.
16. Press **Distribute App → App Store Connect → Distribute** (or **Upload**); keep **Automatically manage signing**;
    accept the defaults (symbols uploaded; Xcode manages version/build number only if you chose that).
17. When it says **Upload Successful**, open App Store Connect → your app → **TestFlight**. The build shows
    "Processing" for several minutes to an hour. Apple emails the account holder if something is wrong (for example
    a missing privacy manifest reason or an icon problem): fix, raise **Build** by one, archive again.
18. If the build shows **Missing Compliance**, answer the export-compliance question: the app uses only standard
    HTTPS, so choose "None of the algorithms mentioned above" (the `ITSAppUsesNonExemptEncryption = false` setting in
    `Info.plist` normally pre-answers this).

**F. Internal testers (10 minutes plus the testers' own setup).**
19. Internal testers must be people on **your** App Store Connect account (up to 100). Add each in **Users and
    Access → Users → +**: name, their own Apple ID email, and a role that can use TestFlight with the least other
    access (for example Developer, App Manager or Marketing; check Apple's role table, since roles changed over the
    years). They accept the emailed invitation and turn on two-factor sign-in. Giving someone a role gives
    them a login to your account: add only people you trust, and remove them after testing.
20. In **TestFlight → Internal Testing → +** create a group (for example "Staff"), tick **Enable automatic
    distribution** if you want new builds to reach them without a click, add the testers and add the build.
    Internal builds need **no** Beta App Review.
21. Each tester installs **TestFlight** from the App Store on their iPhone, signs in with the same Apple ID that
    was invited, opens the invitation (email or the app) and presses **Install**.
22. Builds expire after 90 days; upload a new build before then. People who are not on the account (the wider staff)
    join as **external** testers later: a different group, a short Beta App Review for the first build, and a public
    link or email invitation. That step is covered when needed.

**G. Later (not for this first build).**
23. Push notifications: create the APNs key in Apple's **Keys** page (**Keys → + → Apple Push Notifications service**),
    download the `.p8` once, and put the Key ID, Team ID, the key text and the bundle id **only** into Render's
    environment variables (names are in the plan, §2). Never send it in chat.
24. Sign in with Apple server side: a **Keys → Sign in with Apple** key is only needed for revocation and code
    exchange; same rule, Render only.

Estimated owner time for steps 1 to 21: about 1.5 to 2.5 hours the first time, mostly waiting for the archive and
Apple's processing.

---

## What I could and could not verify

| Verified in sources [V] | Inferred or recalled [I], to test on a device or in Xcode |
|---|---|
| Bridge scripts are injected into every main-frame page, so the bridge and plugins exist on remote pages | A cross-origin iframe can reach `webkit.messageHandlers.bridge` (the handler has no frame check; WebKit semantics assumed) |
| Navigation to `allowNavigation` hosts is allowed; others open in Safari; wildcard rules | `location` change from a remote https page to `capacitor://localhost` works (not needed: `showLauncher()` avoids it) |
| `errorPath` fires only on network failures | Back-swipe history behaviour with `location.replace`; first-party ticket cookie behaviour under ITP |
| `registerPluginInstance` from `capacitorDidLoad()`; auto-register ignores app-target classes | `aps-environment` becoming `production` at distribution; entitlement variable substitution; Xcode priority of target settings over xcconfig |
| Plugin versions, peer ranges, `Package.swift` bounds, push token format, `cap sync` file effects | App Review 4.2 reading; the `CA92.1` UserDefaults reason code; Apple's TestFlight role names and screen labels |
| pbxproj hard-codes bundle id/version in target settings; no entitlements file exists | That `mb_session` is HttpOnly (not read) |

Nothing was built, run, or installed on a device. The scratch install lives outside the repository.

## Risks

1. **Bridge exposure** (§1 risks 1 and 2) is the main one: keep the native plugin small, check the host in each
   method, and ask `security-specialist` to include "iframe → bridge" in the step 4 threat model.
2. **Hand-edited `project.pbxproj`** (§4): the owner opens it in Xcode first.
3. **Deployment target:** iOS 15 works for everything here; `setBadgeCount` is iOS 16+ (fallback exists).
4. **Name and bundle id reuse:** the beta app's id is not the store app's id; the plan's possible Subsplash
   replacement later needs a different build id (decision 7).
5. **Apple's Xcode/SDK requirement** for uploads rises each spring: build with the current Xcode; the upload
   check reports it. [I]

## Handoff

```
Summary: A bundled launcher with no server.url is feasible and recommended: the Capacitor 8.6.3 bridge and all
  plugins are injected into any main-frame page, so the church's /app/ keeps them after navigation from the launcher
  to an allowNavigation host. Fallback (hub-served /app/start) is not needed. The bridge handler never checks origin
  or frame, so keep allowNavigation exact, keep the local plugin small and host-checking, and test the iframe case.
  All eight plugins have exact 8.x pins that resolve with core 8.6.3. Build profiles work through an xcconfig plus a
  generated entitlements file, but the target's hard-coded bundle id/version in project.pbxproj must be removed.
Files: docs/plans/mobile-and-multichurch/spike-bridge.md (new). Read: app-store-readiness.md, plan.md,
  mobile/README.md, capacitor.config.js, church.config.json, package.json, scripts/prepare.mjs, ios/App/** (AppDelegate,
  SceneDelegate, Info.plist, project.pbxproj, CapApp-SPM), Capacitor 8.6.3 ios/core/cli sources, the 8 plugins.
Decisions needed: (owner) approve these pins: push-notifications 8.1.3, status-bar 8.0.4, splash-screen 8.0.2,
  keyboard 8.0.6, haptics 8.0.2, share 8.0.3, app 8.1.2, preferences 8.0.1; the beta bundle id and app name;
  whether to raise the iOS target from 15 to 16 (badge API); whether Google uses a shared Safari session.
Next: security-specialist (step 4): add "cross-origin iframe to bridge" and the nonce/PKCE/ticket design to the threat
  model. mobile-engineer + training-writer (step 5): profiles, entitlements, Info.plist, privacy manifest, README and
  tester guide. ui-ux-specialist (step 6): launcher screens. senior-developer (steps 7, 9): directory contract,
  member-app hooks using Capacitor.Plugins.* with isPluginAvailable.
Evidence: npm ci --ignore-scripts of mobile/package-lock.json plus the eight plugins pinned above in a scratch folder
  (installed with no conflicts, 0 vulnerabilities); npm view for versions and peer ranges; grep and reading of the
  Capacitor sources. No Xcode, simulator or device run was possible.
```
