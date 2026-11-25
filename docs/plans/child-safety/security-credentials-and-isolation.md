# Child-safety plan: offline coordinator credentials and check-in origin isolation

Security Specialist, 2026-11-25. Planning stage, read-only. No repository file was changed.

**This document supersedes** the Q5 sketch in `followup-security.md` in three places:
- **Code length** goes from 8 digits to **10 digits**.
- **The device-bound wrapping key** is new.
- **The encrypted sync envelope** replaces the plain approval event.

**What I read:**
- the plan (`origin/claude/child-safety-plan:docs/plans/child-safety/plan.md`: §3.6–3.11)
- `server/index.js`: headers at 46-53, `/uploads` at 98-100, host handling at 131-136, static and pages at 164-172
- `server/auth.js`: cookie at 16-47, `loadUser` at 50-60, `requireAppHeader` at 112-115, password scrypt at 163-176
- `server/routes/stations.js`
- `public/checkin.html`
- `public/js/checkin.js`: `KEY` at 7-13, store at 23-26, `call()` at 30-41, boot at 44-73, `pairScreen` at 108-148,
  sync at 322-337, outbox at 418-434, labels at 479
- `public/sw.js`
- `public/js/lib.js`
- `public/js/video.js:61`
- `public/js/give.js:17`
- README hosting notes

**About the numbers:** brute-force figures are order-of-magnitude estimates from public hashcat benchmarks and one
measurement on this machine. They are not a lab result. The relative comparisons between options are what matter.

---

# PART 1: Offline coordinator credential: design specification

## 1.1 What the credential is for

The internet at a campus drops. A check-out then needs a coordinator's approval, for example:
- a lost tag (Tier C)
- a code conflict
- a household mismatch
- `code_unknown`
- a release when the safety list is older than 180 minutes

The coordinator is at the desk but their phone can't reach the server. The iPad must decide on its own whether the
person typing is that coordinator.

The **offline code** is a credential with these properties:
- it belongs to one coordinator
- it covers one campus and one service day
- the server generates it
- it is accepted **only by paired iPads at that campus, while they are offline**
- it is **never accepted by the server as a sign-in or an online approval**

### Goals (MUST)
| # | Property |
|---|---|
| G1 | A correct code lets the iPad record an offline approval for the **allowed kinds only** (§1.9). |
| G2 | The code works only at its campus, only on its service day, and only on paired iPads that received a verifier for it. |
| G3 | No plaintext code and no directly testable value is stored on the iPad. Read the details in §1.4. |
| G4 | Every offline approval reaches the server with **cryptographic proof that the code was typed**. The server re-checks everything, and the real coordinator is always notified. |
| G5 | One person mistyping can't lock the whole desk out. A lockout affects one coordinator on one iPad. |
| G6 | A lost iPad, or a compromised coordinator account, can be contained within 15 minutes, and the remaining damage can be listed (§1.6). |

### Never allowed (MUST NOT)
- Override `do_not_release`. It is a hard block with no override, online or offline.
- Release a `check_first` child **to the named person**.
- Approve anything about a `court_order`.
- Approve an `id_mismatch`, or a release to someone who isn't on the list, for a child with a pickup alert.
- Sign in to the hub or the member app, call any API, or approve anything online.
- Work at another campus, on another day, or on an unpaired or revoked device (revoked as far as the iPad knows; the
  server checks again on sync).
- Let a coordinator approve their own request, a release to themselves, or a release to their own household. These
  rules are re-checked on sync (§3.6, two-person rule).

### Attackers
| Attacker | Capability | What we must hold |
|---|---|---|
| **A1** Thief of a **locked** iPad (passcode set, supervised) | Physical device. No passcode. | Nothing readable: iOS Data Protection encrypts website data while locked. **Out of scope for our code**; covered by device policy and the §1.6 runbook. |
| **A2** Thief or finder of an **unlocked** iPad, or a locked one whose passcode is known or blank | The UI. Possibly Safari Web Inspector from a Mac (if enabled), or a device backup. | Copied storage must not reveal codes cheaply. Using the UI gives about 20 guesses a day. |
| **A3** Insider with brief access (a volunteer at the desk, a teenage helper) | The UI for a few minutes. Watches people typing. | Online-limited guessing. A shoulder-surfed code is limited to offline, that campus and that day, and is reported to the real coordinator. |
| **A4** Malicious script in the same origin: stored XSS anywhere on the host, a compromised third-party script (Stripe, hls.js), or a hub page opening or framing `/checkin` | Runs JavaScript in the check-in origin on that iPad. It can read localStorage and IndexedDB and **use** any CryptoKey there. | It must not be able to forge an approval the server accepts (G4). It can log the code as typed: **Part 2 reduces this.** |
| **A5** Network attacker on church Wi-Fi | Sees and alters traffic, but not TLS. | All traffic is TLS (HSTS). Codes are never sent in clear, by email or by SMS. The sync envelope is encrypted to the server. |
| **A6** Malicious coordinator | Holds a valid code for their own campus and day. | Can approve the allowed kinds only. Can't approve their own household, can't approve what is never allowed, and can't hide it: the event, their notification and the weekly digest record it. |

## 1.2 Generating the code (server)

**Secret material:**
- **`MB_CHECKIN_CODE_SECRET`:** a 32-byte value, base64, held only as an environment variable.
  - If it is missing, offline codes are **off**: no offline approvals, phone or online only. This fails closed.
  - It is never logged or returned. It sits beside `GOOGLE_CLIENT_SECRET` in the README settings list.
- **`MB_CHECKIN_SYNC_KEY`:** a P-256 private key (PKCS#8 PEM), held as an environment variable, used for the sync
  envelope (§1.5).
  - Its public key is served to stations in `GET /checkin/station`.
- **Table `checkin_offline_codes`:**
  - `id`, `user_id`, `campus_id`, `day` (church-local `YYYY-MM-DD`), `gen INTEGER`, `nonce BLOB(16)`
  - `issued_at`, `rotated_at`, `rotated_by`, `rotate_reason`
  - unique `(user_id, campus_id, day, gen)`
- `nonce = crypto.randomBytes(16)`, from the CSPRNG.

**Derivation:**
```
mac  = HMAC-SHA256(MB_CHECKIN_CODE_SECRET,
         "mb-offline-code-v1\0" || user_id || "\0" || campus_id || "\0" || day || "\0" || gen || "\0" || nonce)
code = (first 8 bytes of mac as unsigned 64-bit BigInt) mod 10^10, zero-padded to 10 digits
```
- **Modulo bias:** 2^64 mod 10^10 gives a bias of about 10^10/2^64 ≈ 5·10⁻¹⁰. That is negligible.
- **Why derive it instead of storing `crypto.randomInt(0, 1e10)`:**
  - The server needs the plaintext again: to show it to the coordinator, to build device verifiers, and to check sync
    envelopes.
  - Derived, the code is never stored. Rebuilding it needs **both** the database (the nonce) **and** the environment
    secret. A leaked backup alone gives nothing.
  - The randomness comes from the CSPRNG nonce. **Rotation** means a new `gen` and a new nonce.
- **Equivalent alternative:** `crypto.randomInt(0, 10**10)`, stored encrypted with AES-256-GCM under the env key. That
  is acceptable but adds a stored ciphertext for no gain.

**Length and alphabet.** Offline approvals are rare (an outage plus an exception), so a coordinator types this once
or twice on a bad Sunday. It is not typed at every check-out.

| Format | Entropy | Typing on iPad | Brute force, 1 GPU (§1.4) | Verdict |
|---|---|---|---|---|
| 6 digits | 19.9 bits | trivial | ~1 min | No |
| 8 digits | 26.6 bits | numeric pad, ~4 s | **~1.9 h** (avg ~55 min) | Too weak: one gaming PC, same morning |
| **10 digits** | **33.2 bits** | numeric pad, ~6 s; shown and typed as `483 291 7706` | **~7.7 days** (avg ~3.9 days) | **Chosen** |
| 12 digits | 39.9 bits | ~8 s, more typos | ~2.1 years | Option if the owner wants more margin |
| 8 letters and digits (Crockford base32) | 40 bits | full keyboard, layout switching, `0/O` confusion | ~2.3 years | Rejected: too much friction and too many errors at a busy desk |

- **Decision: 10 random decimal digits, with no check digit.**
  - A check digit would add a keystroke and buy nothing against brute force.
  - Typos simply count as failures, and the limit is generous (§1.8).

**Issuance window:**
- Day X's code is created when the coordinator first opens **"Today's offline code"** in the hub or app.
- That is possible from **18:00 on day X−1 until 23:59 on day X** (church time zone).
- Only for:
  - users with `checkin = 'coordinator'` who have access to that campus
  - **listed as an on-duty approver for a service at that campus on day X** (the plan's "two named approvers per
    campus per service")
  - admins may always request one
- Fewer holders means fewer targets.

**How the coordinator receives it:**
- Only in the signed-in hub or member app, while online, before service.
- `GET /checkin/my-offline-code?campus_id=`:
  - `Cache-Control: no-store`
  - requires a session signed in within the last 12 h, otherwise it asks them to sign in again
  - writes an audit event (`offline_code.view`) without the code
- **Never** sent by email, SMS, push, inbox, or in a notification preview. Never written to logs or audit detail.

**Display rules:**
- Masked as `••• ••• ••••` until the coordinator taps **Show**. It masks again after 60 s.
- It reads "Valid only on Kids Check-in iPads at **North**, **Sunday 29 Nov**, when they are offline. Never share it."
- No copy button. They may write it on a card for that day only, and destroy the card afterwards.
- **"Keep on this phone until midnight"** is opt-in. It stores the code in the member app's local storage with an
  `expires` time, and is wiped on first open after expiry or on sign-out.
  - This is a one-day plaintext copy on a personal, passcode-locked phone. It is accepted because the code works
    only offline, at one campus, for one day.

## 1.3 Options for the verifier stored on the iPad

The iPad must check the code with no server. A basic fact follows from that:
- **Whatever the iPad can check, someone holding everything the iPad holds can also check, once per guess.**
- So the useful questions are what one guess costs, and what an attacker must hold to make guesses at all.

| Option | Construction | Assessment |
|---|---|---|
| **(a) Slow KDF only** | `scrypt` or `PBKDF2(code, salt)` stored | Sound baseline. Cost per guess is set by the KDF. WebCrypto has **no scrypt or Argon2**; those would need vendored JavaScript or WASM (against the no-new-dependency rule, and 1–3 s per try on an old iPad at scrypt N=2^15). PBKDF2-SHA256 is native, constant-time in CommonCrypto, and fast on the device. |
| **(b) HMAC with a key held on the iPad** | `HMAC(K, code)` with K stored next to it | **Pointless on its own.** Whoever copies the storage copies K, and HMAC is about 10⁹ guesses/s on a GPU: 10^10 codes in seconds. A key only helps if it **can't be copied** (option e). |
| **(c) No offline check; verify on sync** | Accept any code offline, check on sync | **No prevention**, only detection hours later. A thief or insider types anything. Rejected for approvals that release a child. |
| **(d) Partial check** | Check the first k digits offline, all digits on sync | Weakens the offline gate (an attacker cracks only k digits) and is still a detect-later model for the rest. A worse trade-off than (a). Rejected. |
| **(e) KDF verifier wrapped by a non-extractable device key** | (a), then HMAC under a WebCrypto `CryptoKey` created on the iPad with `extractable: false` and stored in IndexedDB | **Chosen**, with (a) inside it. See the limits below. |

**What a non-extractable `CryptoKey` does and does not do:**
- **Does:**
  - JavaScript can never read the key bytes. `exportKey` throws, and `wrapKey` of it is refused.
  - IndexedDB stores the key object (structured clone), not raw bytes that page code can see.
  - WebKit also wraps the stored key with a per-user master key in the system **Keychain**
    (`SerializedCryptoKeyWrap`). So a copy of the website-data files alone (some backup extractions, file-level
    forensics) does not contain a usable key.
- **Does not:**
  - Stop **use**. Any script in the same origin (A4) can open the same IndexedDB and call
    `crypto.subtle.sign(key, …)`. The iPad then becomes an oracle while that script runs on it.
  - Survive the attacker who has the Keychain too. That includes a full encrypted device backup, if the master key's
    Keychain accessibility class lets it migrate, which is not documented, or anyone using the unlocked device.
  - Provide any guarantee from the specification. Wrapping in the Keychain is a WebKit implementation detail.
  - **So I treat (e) as defence in depth.** All brute-force figures below assume the attacker **has** the key or can
    use it.
- **Device backups:**
  - Safari website data can be included in iCloud and Finder backups.
  - Device policy (from Q5): iCloud Backup **off** through MDM, no personal Apple ID, Web Inspector off, Single App
    Mode or Guided Access.
  - Home Screen web apps keep their own website-data container. The same backup caveats apply.

## 1.4 Chosen construction (exact)

### Server, per (device, coordinator, day, gen)
This runs when an `explicit`-mode station at the campus downloads approvers during check-in hours, for today and, after
18:00, tomorrow.
```
salt  = crypto.randomBytes(32)                         // per device × coordinator × day × gen
S     = "mb-oc-v1\0" || device_id || "\0" || user_id || "\0" || campus_id || "\0" || day || "\0" || gen || "\0" || salt
V     = PBKDF2-HMAC-SHA256(P = ASCII(code10), S, c = 600_000, dkLen = 32)
```
- Computed with the **asynchronous** `crypto.pbkdf2`, so the event loop isn't blocked.
- Cached for the day in `checkin_offline_verifiers(device_id, code_id, salt, issued_at)`. V itself is not stored;
  it can be recomputed.
- Cost: about 100 ms of server CPU for each one (measured at 108 ms on this machine). Ten coordinators times six
  iPads is about 6 s of CPU a day.
- The response sends:
  - `{ user_id, display_name, campus_id, day, gen, salt, iter: 600000, V, valid_from, valid_until }`
  - It goes only to that device, with `Cache-Control: no-store`.
- **`dkLen` must stay at 32 bytes.** With PBKDF2-SHA256, dkLen 64 makes the defender compute twice while the
  attacker needs only the first block. If more key material is ever needed, derive it from V with HMAC or HKDF.

### iPad, once at pairing
```
K_dev = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, /*extractable*/ false, ['sign'])
```
- Stored in IndexedDB database `mb-checkin-secure`, store `keys`, key `"verifier-wrap"`.
- Created again (and all verifiers dropped) on unpair, revoke or re-pair.

### iPad, when verifiers arrive
- `W = HMAC-SHA256(K_dev, V)`.
- Stores `{user_id, display_name, campus_id, day, gen, salt, iter, W, valid_from, valid_until}`.
- **V is dropped right away.** It is never written to localStorage, IndexedDB, Cache Storage or the console.
- The response is never cached by the service worker. It is not in `FILES` (`sw.js:6`), so this is already true and
  a test must keep it so.

### iPad, when a code is typed
1. The coordinator **taps their name** first. Only that coordinator's record is tried, so there is one KDF per try
   and two people can never collide.
2. Check the lock state (§1.8). Check the clock window: `valid_from ≤ now ≤ valid_until`, and the stored high-water
   clock `≤ valid_until`.
3. Compute `V' = PBKDF2(code, S, 600000, 32)` with `crypto.subtle.deriveBits`. Then `W' = sign(K_dev, V')`.
4. Compare with `W` over all 32 bytes, with no early exit. Timing barely matters locally, but this costs nothing.
5. On a match, build the sync envelope (§1.5), then drop the code, V' and W'. On a mismatch, add one to the failure
   counter.

**Iteration count and device timing:**
- **600,000** is the current OWASP figure for PBKDF2-SHA256.
- Assumption: the oldest desk iPad is an A10 or A12 model (iPad 7th or 8th generation) on iPadOS 17 or 18. Its native
  WebCrypto does roughly 2–4 million PBKDF2-SHA256 iterations per second.
  - That is **about 0.15–0.3 s** per attempt, well inside the 1 s budget.
- Phase test: time 5 attempts on the **slowest real desk iPad**.
  - If the median is over 800 ms, lower to **310,000** (the OWASP 2021 figure) and halve the figures below.
  - `iter` travels with each record, so it can change without a release.
- Show a spinner, and disable the keypad while verifying.

### Brute-force cost for an attacker who has (or can use) everything on the iPad
Rates:
- **GPU:** an RTX 4090 does about 9·10⁹ PBKDF2-HMAC-SHA256 iterations/s (hashcat mode 10900). That is about
  **15,000 guesses/s** at 600k iterations.
- **CPU:** measured here at 108 ms per guess per core, so about 9 guesses/s per core. A 16-core desktop does about
  150/s.
- **Cloud GPU:** about US$0.40 per hour for each RTX 4090-class GPU.

| Code | Keyspace | 1 GPU, full (average) | 16-core CPU, full | 64 rented GPUs, full | Cost to search everything |
|---|---|---|---|---|---|
| 8 digits | 10^8 | 1.9 h (55 min) | 7.7 days | 1.7 min | ~$1 |
| **10 digits (chosen)** | 10^10 | **7.7 days (3.9 days)** | **2.1 years** | **2.9 h** | **~185 GPU-hours, about $75** |
| 12 digits | 10^12 | 2.1 years | 210 years | 12 days | ~18,500 GPU-hours, about $7,400 |
| (scrypt N=2^15, 10 digits, for comparison) | 10^10 | ~33 days | – | ~12 h | ~$320, but needs vendored scrypt and 1–3 s per try on the iPad |

**Compared with the code's lifetime** (one service day, and really the morning's service window):
- At 10 digits, **one GPU or any CPU can't make it in time.**
- A **prepared** attacker with rented GPUs can, for about $75. That attacker must:
  - extract storage, either with Keychain access or by running script on the device itself (because of K_dev)
  - do it the same day
  - then get back to an iPad at that campus **that is offline**
  - and act knowing the approval is reported and checked by the server
- **The KDF is not the boundary.** The boundary is:
  - **scope**: offline only, allowed kinds, one campus, one day
  - the **device-bound wrap**
  - **detection with proof** on sync (§1.5)
  - **device policy**
- The KDF and the 10-digit length remove the cheap attacks: a laptop, a single GPU, one evening.

**Script in the origin (A4) on a live iPad:**
- It can't read K_dev, but it can use it.
- It can run PBKDF2 for each guess on a GPU elsewhere, then use the iPad to compute `sign(K_dev, V)` for each
  candidate.
  - That means about 10^10 `sign` calls (days of iPad time) and moving 320 GB of candidates to the device.
  - **That is not a practical path.**
- The practical A4 path is **reading the code as it is typed**. The answer is isolation and CSP (Part 2), plus the
  fact that the code is good for one day only.

## 1.5 Proof on sync: the encrypted approval envelope

The approval event in the outbox must prove that the code was typed. It must also give an attacker who copies storage
nothing new to test guesses against.

A stored `HMAC(f(code), event)` would itself be a second verifier, not wrapped by K_dev. So it is not used.

**Construction** (all native WebCrypto):
```
E      = canonical JSON of { v:1, approval_id (random 128-bit), device_id, seq (per-device monotonic),
           user_id, campus_id, day, gen, kind, child_ids (sorted), pickup_id, released_to_ref | released_to_name,
           operator_name, client_at }
eph    = ECDH P-256 key pair, generated now, extractable:false, never stored
Z      = ECDH(eph.private, SERVER_PUB)                               // SERVER_PUB from GET /checkin/station
k      = HKDF-SHA256(Z, salt = eph.public raw, info = "mb-oc-envelope-v1", 256 bits) → AES-GCM key
ct     = AES-256-GCM(k, iv = 12 random bytes, plaintext = ASCII(code10), AAD = SHA-256(E))
outbox entry = { E, env: { eph_pub, iv, ct } }
```
- **Storage attacker:**
  - The envelope is randomised public-key encryption. Without the server's private key, a guess can't be tested
    against it, because re-encrypting with a new ephemeral key gives a different result.
  - So the outbox **adds no brute-force target**.
- **A4, a script that doesn't know the code:**
  - It can write a fake `E` into the outbox. It can't produce a `ct` that decrypts to the correct code.
  - On sync, the event is rejected as `offline_approval_invalid` (critical).
- **The server's private key** is used only to open envelopes. If the key leaks, the past envelopes it exposes show
  past day codes, which are worthless.
  - Rotate it by publishing a new public key with a `kid`.

**Server checks on sync** (all of them; any failure gives a critical `offline_approval_invalid` alert and the event is
still **recorded**, never dropped):
1. **Station:**
   - The device token is valid, or the station was revoked **after** `client_at` and the report is accepted as
     "reported after revoke".
   - Reports from a station revoked before `client_at` are quarantined and alerted.
2. **Envelope:**
   - It decrypts.
   - The AAD equals `SHA-256(E)` as received.
   - The decrypted code equals the code rebuilt for `(user, campus, day, gen)` (`crypto.timingSafeEqual`).
3. **Generation:**
   - `gen` is current, or the code was rotated **after** the device's last successful contact. In that case the
     event is accepted, with `flag: rotated_offline`, for coordinator review.
   - If the device made contact after the rotation and still used the old gen, that is critical.
4. **Time:**
   - `client_at` falls on `day` (church time zone), inside `valid_from/valid_until`.
   - It is not before the device's last server contact minus 5 minutes of skew, and not after the upload's server
     time plus 5 minutes.
   - Otherwise the event gets the flag `clock_skew`, and critical if the day is wrong.
5. **Sequence:**
   - `seq` is strictly greater than the device's last accepted one. Gaps are flagged, because they suggest deleted
     outbox entries.
   - Duplicate `approval_id` values are ignored idempotently.
6. **Kind and restriction state:**
   - Recompute, against the restriction state **at `client_at`**, whether this kind was allowed offline (§1.9).
   - If it wasn't, raise `release_violation` (critical).
7. **People:**
   - At `client_at` the approver held `coordinator` at that campus.
   - They weren't the requester, the released-to person, or in either household.
8. **Rate:** the event is within the per-device, per-coordinator daily cap (§1.8).
9. **Notify:**
   - **Always** notify the approving coordinator: "You approved an offline release at North Desk 2, 10:42, 1 child.
     Not you? Tap to report."
   - Add it to the weekly digest.

**Audit fields** on `checkin_events` (`kind = 'override_offline'`):
- `approval_id`, `device_id`, `device_name`, `seq`
- `approver_user_id`, `code_id`, `gen`, `override_kind`
- `child_ids`, `pickup_id`, `released_to_*`, `operator_name`
- `client_at`, `server_at`, `last_contact_at`
- `result` (`ok` | `rotated_offline` | `invalid:<reason>`), `flags`
- No code, no V, no envelope plaintext.

## 1.6 Storage on the iPad

| Item | Where | Never |
|---|---|---|
| K_dev (non-extractable HMAC key) | IndexedDB `mb-checkin-secure` / `keys` | exported or logged |
| Verifier records `{user_id, display_name, campus_id, day, gen, salt, iter, W, valid_from, valid_until}` | IndexedDB `mb-checkin-secure` / `approvers`, keyed `[campus_id, day, user_id]` | in localStorage, in the roster (`mb.checkin.roster.*`), or in the service worker cache |
| Failure counters and locks `{user_id, day, fails, lock_until, total_today}` and the clock high-water mark | IndexedDB `mb-checkin-secure` / `limits` | – |
| Pending envelopes | the outbox v2, IndexedDB `mb-checkin-outbox` (the plan's outbox; IndexedDB so writes are transactional) | the plaintext code |
| Plaintext code, V, V', W' | memory only, for one verification | anywhere persistent |

- **IndexedDB rather than localStorage:**
  - CryptoKey objects can't be stored in localStorage at all.
  - IndexedDB transactions make "count the failure, then compare" atomic.
  - It is still **origin-scoped**, so the isolation in Part 2 still matters.

**Cleared:**
- At the start of each day, judged by `max(now, high-water)`: all approvers and limits with `day <` today.
- When `valid_until` passes.
- On unpair, revoke (`station_removed`) or re-pair: approvers, limits and K_dev are cleared. **The outbox and queue
  are kept** until they are sent (§3.11).
- On a server push of `rotate`: `/checkin/changes` returns `offline_codes_version`, and the iPad replaces its records.
- When the campus is switched out of `explicit` mode.

## 1.7 Expiry, rotation and revocation

- **Validity:**
  - `valid_from` is 05:00 on day X and `valid_until` is 23:59 on day X (church time zone). Both are configurable to
    the campus's check-in hours plus 2 h of grace.
  - The iPad also refuses when its high-water clock is past `valid_until`. Setting the clock back can't revive a
    purged or expired record.
  - The server is the backstop: `client_at` must fall on day X and match the device's contact history (§1.5, check 4).
- **Multi-use within the day, with caps.**
  - One-time codes would need a list of codes per coordinator, and that fails exactly when one runs out.
  - Instead, at most **10 accepted offline approvals per coordinator per iPad per day**. After that it says "Use your
    phone or the paper process".
  - Every use is notified to the coordinator.
- **Rotation triggers:**
  - automatically each day (new day, new code)
  - by hand: "Rotate my offline code" in the app, or "Rotate today's offline codes" for a campus (coordinator or
    admin)
  - **automatically when a station is revoked with reason lost or stolen**
  - when a coordinator's flag is removed or their account is disabled
- Rotation means `gen+1`, a new nonce, the old record marked `rotated_at`, and `offline_codes_version++`. iPads that
  are online drop the old verifiers within about 45 s (the `/changes` poll).
- **Offline iPads keep the old verifier until they reconnect.** This is the main residual window. It is bounded by
  the day, and approvals made in it are flagged `rotated_offline` on sync.

### Lost or stolen iPad: procedure (target: contained within 15 minutes of noticing)
| Time | Who | Action | Effect |
|---|---|---|---|
| T+0 | Anyone | Tells a coordinator. The coordinator opens Check-in → Stations. | – |
| T+2 min | Coordinator or staff | **Revoke**, with reason "Lost / stolen" | `revoked_at` is set. The server rejects the station token on the next request (401 `station_removed`), and the device wipes the roster, verifiers and K_dev if it ever connects. Reports from it are quarantined. |
| T+2 min (automatic) | Server | **Rotates that campus's offline codes** for today and tomorrow (all coordinators). Pushes `offline_codes_version`. Notifies the coordinators at that campus: "Offline codes changed, open the app for the new one". | Other iPads at the campus refresh within 45 s once online. The stolen iPad's verifiers now match nothing the server will accept as current. |
| T+5 min | Admin | MDM: **Lost Mode, then Erase**. Without MDM, use Find My on the church Apple ID. | Erases the device when it next comes online. |
| T+10 min | Coordinator | Hub: **"Since last sync" report** for that device. It shows the last contact time, the queue and outbox counts the device last reported (the plan's `/changes` should send these), and every offline approval and check-out it uploaded today. Then a **room headcount** compared with open check-ins at that campus. | Lists what can be known. Anything the device did after its last contact can't be known until it uploads, and an upload from a revoked device is quarantined and alerted. |
| T+15 min | Admin | Logs an incident. The device held the roster (children's names, allergies and medical notes, last 4 digits of phones). Ask the insurer or attorney whether notification is required. | Record kept. |
| Same day | Admin | If the device was unlocked when lost, or its passcode was known, treat today's roster as exposed. Rotating day codes was enough for credentials. Online PINs never were on the device. | – |

### Coordinator phone or account compromised
1. An admin **disables the account**: `users.active = 0` ends sessions at once (`loadUser` requires `active = 1`).
   Or "Sign out everywhere".
2. That coordinator's offline codes are rotated automatically (disabling triggers it).
3. Remove `checkin = coordinator` until reviewed. Reset the online PIN.
4. Review that coordinator's approvals for the last 30 days, online and offline. The approver notifications are the
   tripwire here.
5. **Exposure:**
   - Today's (and, after 18:00, tomorrow's) offline code for their campuses.
   - **More importantly**, online phone approvals.
   - The offline code is the smaller part of that compromise.

## 1.8 Brute-force protection

**Online (server):**
- **Offline codes are never accepted online.** No endpoint takes one. A test sweeps every route with a valid day code
  and expects a refusal.
- **Sync envelopes are a one-guess-per-report oracle:**
  - Each invalid envelope raises a critical alert.
  - At 3 invalid envelopes per device per day, the device is **quarantined**: new verifiers are withheld, reports are
    still recorded, and admins are alerted.
  - Probability of success: about 3·10⁻¹⁰ per device per day. Negligible.
- **Online PIN** (separate credential, `POST /checkin/pin-verify`):
  - Per coordinator per station: progressive delay (1/2/5/10 s). At 10 failures in 10 minutes, that coordinator is
    blocked on that station for 15 min and an alert fires.
  - Per coordinator across all stations: 30 failures an hour, then PIN entry for that coordinator is paused for 1 h.
    Phone approval still works, and an alert fires.
  - Per station across coordinators: 30 failures an hour, then that station's PIN entry pauses for 15 min, with an
    alert.
  - **No account lockout and no whole-desk lockout.** Phone approval is never blocked.
  - With a server-generated 8-digit PIN, the most an attacker gets is about 720 guesses a day per coordinator
    (alerted). That is about 7·10⁻⁶ chance per day of hitting it, and each failure is visible.

**Offline (iPad):**
- Per coordinator per iPad: **5 failures**, then a **15-minute lock** for that coordinator only. The lock ends when
  15 minutes have passed by the wall clock **and** the clock has not gone back past the high-water mark. If the clock
  moved back by more than 2 minutes, the lock stays until the iPad is online.
- Per iPad: **20 failures a day** across coordinators stops all offline approvals that day. The screen says "Use the
  paper process or call", and a `pin_failure` alert syncs.
- Through the UI that is **at most 20 guesses a day per iPad**, a 2·10⁻⁹ chance of hitting a 10-digit code.
- **Anyone who can edit the iPad's storage can reset these counters.** Their purpose is to stop casual guessing at the
  desk, not a storage attacker. The real protection against a storage attacker is the earlier rows:
  entropy (33 bits) × KDF cost (600k) × short life (one day) × device-bound wrap × proof checked on sync.
- Every failure is counted on sync (`pin_failure` events with the device and coordinator). More than 5 for one
  coordinator in a day gets a review.

## 1.9 What an offline code may approve

| Approval kind | Offline code | Notes |
|---|---|---|
| Release with a stale safety list (> 180 min or another day), **child with no pickup alert** | ✓ | Fail-closed path in §3.9 |
| `lost_tag_c` (child with no pickup alert) | ✓ | Revokes the code, as in the plan |
| `conflict`, `mismatch`, `code_unknown` (children with no pickup alert) | ✓ | |
| Anything for a child **with any pickup alert** | ✗ | Phone approval, a coordinator online through a hotspot, or the custodial parent |
| `check_first` to the named person, `court_order`, `id_mismatch`, `not_on_list_restricted`, `revoked_code` | ✗ | |
| `do_not_release` | ✗ (never, by anyone) | |

- The iPad enforces this list using its safety list. The server re-checks it against the restriction state at
  `client_at`.
- A restriction the iPad didn't know about is already covered by the plan's immediate coordinator alert for in-room
  children. On sync it becomes `release_violation`.

## 1.10 Residual risk, in plain words (for the owner to accept)

> If someone gets hold of a check-in iPad **and** can either run code on it or copy its storage including the
> system keychain, **and** spends about $75 renting computers, they could work out a coordinator's offline code
> within a few hours. With it they could, **only on that campus's iPads, only while those iPads are offline, and
> only that day**, approve releases for children who have **no pickup alert** (lost tags, code mix-ups, old safety
> list). They could never release a child with a pickup alert or override a do-not-release. When the iPad
> reconnects, every such approval is checked, and the real coordinator is told straight away. Someone watching a
> coordinator type the code gets the same limited power without the computers. We accept this because offline
> approvals have to work when the internet is down, and the alternative (no offline approvals) means a lost-tag
> child waits for a phone signal.

- **Rating: Low** with device policy (supervised, passcode, Single App Mode, iCloud Backup off) and Part 2's
  isolation.
- **Rating: Medium** without Part 2, because a script in the shared origin can read the code as it is typed.

## 1.11 Tests that prove each property

| Property | Test (layer) |
|---|---|
| Codes are 10 digits, CSPRNG, uniform | Unit: derivation of 10⁵ codes with random nonces; chi-square on digit positions; zero-padded. Derivation is deterministic for the same inputs. |
| Fails closed without the secret | API: `MB_CHECKIN_CODE_SECRET` unset gives no verifiers in station responses, and the iPad shows "Offline approvals unavailable". |
| Issued only to on-duty coordinators of that campus | API: helper, leader, other-campus coordinator and off-duty coordinator get 403 from `/checkin/my-offline-code`. A stale session (> 12 h) asks for re-authentication. |
| Never in email, push, logs or audit | Grep test: no `offline_code` value in `notify` or `mail` calls. Log capture during a full flow contains no 10-digit run equal to the code. The audit row has no code. |
| `no-store` everywhere | API: headers on `my-offline-code` and the approvers payload. Service-worker test: the approvers URL is not in `FILES` and is never cached. |
| Never accepted online | Router sweep: every route with the code in the body, query and headers is refused. `pin-verify` with a day code fails and counts as a PIN failure. |
| No plaintext, and no V, at rest on the iPad | Browser test (Playwright WebKit): after verifiers load and an approval, dump localStorage, IndexedDB and Cache Storage. Assert the code, V and the received payload bytes are absent, and that only W is stored. |
| K_dev can't be extracted | Browser: `exportKey('raw', K_dev)` rejects. The key's `extractable` is false. |
| One KDF per try; correct timing | Browser: tapping the name, then a wrong code, calls `deriveBits` once. The iteration count comes from the record. Timing check on the oldest iPad (manual, recorded). |
| Day and clock bounds | Rules unit with an injected clock: before `valid_from`, after `valid_until`, the clock set back after a purge (record gone, can't be used), the clock set back during a lock (lock holds). |
| Per-coordinator lockout and device cap | Rules or browser: 5 failures lock A but not B. The 20th failure that day stops all. The lock survives a reload. |
| Allowed kinds only | Golden fixture from the plan's shared release rules: every kind × restriction state × offline. The never-allowed kinds are refused on the iPad **and** become `release_violation` on sync. |
| Envelope proves the code | API: a valid envelope is accepted. Changed `E` (child id, kind, `client_at`) fails the AAD check. A wrong code, a replayed `approval_id` (idempotent no-op), a lower `seq`, a missing envelope and a forged `E` all give critical `offline_approval_invalid`, and **the event is still stored**. |
| No new brute-force target in the outbox | Unit: two envelopes of the same code differ. An envelope can't be checked without the server key (structure test: there is no HMAC or hash of the code). |
| Rotation | API: rotate, then the old gen is refused for a device that had contact after the rotation (critical), and accepted with `rotated_offline` for one that didn't. Revoking with "lost" rotates the campus automatically. Disabling a user rotates. |
| Quarantine | API: 3 invalid envelopes means no more verifiers for that device. Reports are still recorded and admins alerted. |
| Notifications | API: every accepted offline approval notifies the approver. The weekly digest counts them. |
| Two-person rule | API: approver equals requester, the released-to person or their household gives `offline_approval_invalid`. |

---

# PART 2: Origin and storage isolation of the check-in app

## 2.1 What is shared today

| Shared by every page on a host | Evidence | Consequence |
|---|---|---|
| **localStorage** | `checkin.js:7-13, 23-26` | `mb.checkin.token` (the **raw station bearer token**), `mb.checkin.roster.<campus>` (children's allergies and medical notes, household phones, contacts), `mb.checkin.queue`, `mb.checkin.outbox`, `mb.checkin.today.*`. Readable by **any script on any page of that host**. |
| **IndexedDB** (future verifiers, K_dev, outbox v2) | Part 1 | Same exposure. K_dev can be *used* by any same-origin script. |
| **Service worker** | `sw.js` registered at scope `/` by `checkin.js:45`, `app.js:129` and `member/main.js:62` | One worker controls hub, app and check-in pages. A change made for the hub's push handling ships to the kiosks. A bug or compromise of the worker affects all of them. |
| **Cookies** | `auth.js:33`: `Path=/; HttpOnly; SameSite=Lax`, no `Domain`, so host-only | The hub session cookie is sent with `/checkin` and `/api/checkin/*` on that host. |
| **Framing** | `index.js:52`: `X-Frame-Options: SAMEORIGIN` | Any same-origin page can frame `/checkin` and, being same-origin, **script it completely**. |
| **Window references** | none | A hub page that opens `/checkin` with `window.open` keeps a same-origin `opener` and can script it. COOP does nothing between same-origin pages. |
| **Hosts** | `index.js:131-136` | `MB_APP_URL` only redirects `/` on the app host. **Every route, hub pages and `/checkin` included, is served on every host.** |

### Concrete risks

**P2-1 · High (as the plan stands) · A hub session on a check-in iPad replaces the station identity.**
- `stationAuth` (`stations.js:37`) does `if (req.user || !token || …) return next()`. If a session cookie is present,
  the station token is **ignored** and every request runs as that user, with their full role and campuses.
- The check-in screen itself sends people to sign in on the kiosk:
  - "Or sign in as a leader instead" (`checkin.js:127`)
  - "Sign in to sync" (`checkin.js:193`)
- The plan adds "Coordinator signs in on the tablet" as approval route 3 (§3.6).
- The session lasts **30 days** (`auth.js:16`).
- Result: a shared kiosk carries a coordinator's or staff member's hub session for a month.
  - Anyone at the desk who can reach the address bar (no Guided Access), or any script in the origin, can use the
    whole hub API as that person: people, giving if they have Finance, pastoral notes, chats.
  - Any role checks for station-only behaviour (check-in hours, the allow-list) are bypassed. That covers both the
    plan's version and today's `stationMay`.
- **Fix:**
  - On check-in pages, the station token wins.
  - Remove sign-in on kiosks. Route 3 becomes a **15-minute, request-scoped approval**: the coordinator signs in on
    their phone and approves; there is no session on the iPad.
  - Better still, the separate host (2.3 B), where cookies aren't accepted at all.

**P2-2 · Medium · Any script in the origin reads the station token, the roster and the queue.**
- **Realistic paths:**
  - **A stored-XSS bug on any hub or app page.** There are 128 `raw(` uses and several `innerHTML` sinks. I found no
    injectable sink in this pass (`html` escapes, and `checkin.js` uses `esc()` at 463-474). The surface is large and
    changes weekly.
  - **Third-party scripts loaded into the origin:**
    - hls.js from `cdn.jsdelivr.net` (`video.js:61`), with **no Subresource Integrity**
    - Stripe.js (`give.js:17`); Stripe is a reasonable trust, but it is code we don't control
  - **The iPad browsing hub pages:** the sign-in links above, or a volunteer exploring.
- **What the script gets:**
  - the station token: a bearer that works from **anywhere** until revoked, giving roster with medical notes,
    lookups and check-outs during check-in hours
  - the cached roster
  - queued check-ins
  - with Part 1, the ability to use K_dev and to **log offline codes as they are typed**
- **Note:** an XSS has to run **on the iPad's own storage**: Safari on that iPad, or that Home Screen app. An XSS on
  a staff laptop doesn't reach the iPad's localStorage. So the risk centres on what else the kiosk browses, and on the
  check-in page's own code.

**P2-3 · Medium · Same-origin framing and openers.**
- `SAMEORIGIN` lets an injected hub page `<iframe src="/checkin">` and read its DOM and storage.
- That is equal to P2-2, but it also lets the attacker **drive** the kiosk UI. A cross-site attacker can't do this.
- `frame-ancestors 'none'` on `/checkin` stops framing. Only a separate origin stops `opener` access.

**P2-4 · Low · One service worker for everything.**
- Its fetch handler only serves `FILES` from cache (`sw.js:17-19`). That is fine today.
- But the hub's push-click code (`sw.js:57-93`) runs on kiosks, and it can open hub URLs from a notification. A kiosk
  shouldn't receive push at all.
- Cache poisoning needs a server compromise. Not an issue today.

**P2-5 · Low · Storage eviction (availability, but it means lost check-ins).**
- Safari's tracking prevention deletes script-written storage for sites not interacted with in 7 days of Safari use.
  That deletes the queue.
- **Home Screen web apps are exempt and keep separate storage and cookies from Safari.**
- Kiosks should run as a Home Screen app (or MDM web clip) on the check-in address. The server should know each
  device's pending count (sent with `/changes`), so a device going quiet with N unsynced items raises an alert.

**Checked and OK:**
- Cookies are HttpOnly, so script can't read the session token. It can still use it.
- `x-mb` CSRF header on writes (`auth.js:112-115`).
- No `Domain` attribute, so the hub cookie never reaches other hosts.
- `/uploads` requires volunteer or above (`index.js:100`).
- `nosniff` and a referrer policy are set.
- Labels escape names.

## 2.2 Hardening that is worth doing on any option (quick wins, about 1 day)
1. **Station token wins on station requests.** If `x-station` is present and valid, ignore the cookie, or refuse when
   both are present. Remove "sign in" links from a **paired** station's screen.
2. `/checkin` page and its JavaScript:
   - `Content-Security-Policy:`
     - `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;`
       `connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none';`
       `frame-ancestors 'none'; object-src 'none'`
     - `'unsafe-inline'` for **styles** only. It is needed by inline `style=` attributes and the label CSS injected at
       `checkin.js:479`. Script stays strict, because `checkin.html` has no inline script.
   - `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`
   - `Permissions-Policy: camera=(self), geolocation=(), microphone=()`
   - `X-Frame-Options: DENY` (`SAMEORIGIN` stays for the hub's App Builder pages only)
3. `Strict-Transport-Security: max-age=31536000` on every response (behind `trust proxy`).
4. **SRI** on hls.js. Pin the hash with `s.integrity = 'sha384-…'` and `s.crossOrigin = 'anonymous'`, or self-host it.
5. `Cache-Control: no-store` on `/api/checkin/roster`, `/approvers`, `/photo`, `/my-offline-code`.
- **This does not isolate storage.** A CSP on `/checkin` protects the check-in page from injection. It does nothing
  about a script on another page of the same origin reading the same storage.
- A hub-wide strict CSP is a larger project: 347 inline `style=` uses, Stripe, YouTube, Vimeo, Mux, jsdelivr and
  Maps. Do it eventually. It is not a substitute.

## 2.3 Options

| | (A) Same origin + hardening | **(B) Separate host, same service** | (C) Separate Render service | (D) Native or managed app |
|---|---|---|---|---|
| Storage, IndexedDB and service worker separate from hub and app | ✗ | **✓** | ✓ | ✓ |
| Hub session cookie on the kiosk | Possible (needs code discipline) | **Impossible:** host-only cookies are never sent, and the host refuses cookie auth | ✓ | ✓ |
| Hub XSS or third-party script reaching the kiosk's data | ✓ (exposed) | **✗**: only check-in code runs there | ✗ | ✗ |
| Framing or opener by hub pages | Framing fixed by CSP; opener remains | **✗** (cross-origin, plus COOP and `frame-ancestors`) | ✗ | ✗ |
| Infrastructure | none | custom domain, DNS CNAME, Render-managed TLS | a second service. **The Render persistent disk attaches to one service**, so SQLite can't be shared; it needs an API proxy or a database move | App Store or MDM distribution, a Swift or React Native codebase |
| Effort | ~1 day | **~4–5 dev days + ½ day ops + ~10 min per iPad** | weeks | months, out of scope |
| Verdict | Do it anyway (2.2) | **Recommended** | Overkill. Same isolation as B, much more cost and new failure modes | Out of scope |

## 2.4 Recommendation: (B), `checkin.<church domain>` on the same Render service

**What to build** (new env var `MB_CHECKIN_URL`, mirroring `MB_APP_URL` at `index.js:133`):
1. **Host gate** (middleware, first after the headers). When `req.get('host') === checkinHost`, allow only:
   - `GET /` (redirects to `/checkin`), `GET /checkin`, `GET /checkin.webmanifest`, `GET /sw-checkin.js`
   - the static files check-in needs (`/css/app.css`, `/css/checkin.css`, `/js/checkin*.js`, `/js/lib.js`,
     `/js/theme.js`, icons)
   - `/api/` paths on the station allow-list (§3.8), plus `POST /api/checkin/pair` and `GET /api/checkin/pair/:secret`
   - `/healthz`
   - **Everything else gets 404**: no hub pages, no `/login`, no `/auth/*`, no `/uploads`, no `/app/`.
   - Set the allow-list from the plan's router-sweep test and run it on both hosts.
2. **No cookie auth on the check-in host.** `loadUser` returns `req.user = null` there, and the host never sets
   `mb_session`. Station identity is the only identity.
3. **Station token as a cookie, not localStorage, on that host:**
   - `__Host-mb_station=<token>; Path=/; Secure; HttpOnly; SameSite=Strict`, set on the pairing hand-off and on the
     plan's daily rotation.
   - Script then can't exfiltrate it for use elsewhere. It can only use it while running on the iPad.
   - `x-mb` still guards writes. The `x-station` header stays supported during migration.
4. **Its own service worker** `/sw-checkin.js`, scope `/`, with no push handlers. Its own manifest:
   `start_url: /checkin`, `display: standalone`.
   - The hub's `/sw.js` stops listing `/checkin` files after migration.
5. **Strict headers** from 2.2, on the whole check-in host:
   - CSP `frame-ancestors 'none'`
   - COOP `same-origin`
   - CORP `same-origin`
   - HSTS
6. **Hub host:**
   - `/checkin` on the hub host becomes "This page moved", with a **paired-station migration** path (below).
   - A signed-in leader's own-device mode stays on the hub host for laptops (or is retired; owner's choice), and
     **never on kiosks**.
   - Pairing in the hub (Check-in → Stations) is unchanged. Staff enter the code shown on the check-in host.
7. **No CORS needed.** The page and the API it calls are on the same check-in host. The hub never calls the check-in
   host.
8. **Member app host (`MB_APP_URL`):** apply the same gate idea later, serving `/app/` and its API only. That is a
   separate, smaller change, noted here because today the app host also serves `/checkin` and the hub.

**Effort:**
| Item | Days |
|---|---|
| Ops: Render custom domain, DNS CNAME, automatic TLS, `MB_CHECKIN_URL` | 0.5 |
| Host gate, cookie refusal, station cookie, header set | 1.5 |
| `sw-checkin.js`, manifest, hub `sw.js` trim | 0.5 |
| Migration flow ("replace station"), drain-before-move | 1 |
| Tests: router sweep on both hosts, header tests, a WebKit browser test that hub storage isn't visible, migration tests | 1–1.5 |
| **Total** | **≈ 4.5–5 dev days + ½ day ops**, plus about 10 minutes per iPad on site |

**Risks:**
- A DNS or TLS mistake on the morning of a service. Mitigation: go live mid-week, and keep the old path working for
  stations that haven't moved yet.
- Staff confusion: two addresses. Mitigation: the hub's Stations page shows the address and a QR code.
- An iPad left on the old address with queued items. Mitigation: the migration rule below, plus the server alert
  from P2-5.
- Cost of the separate host: **none at Render** for a custom domain on an existing service.

### Migration of existing paired iPads (never lose a queued check-in)

Storage can't move across origins. On iOS, a Home Screen app's storage is also separate from Safari's. So the safe
path is **drain, then re-pair as a replacement**. Moving data through URLs is not safe.

1. **Release N (before the switch):**
   - The old `/checkin` learns a `migrate` instruction from `/checkin/station`.
   - It reports `queue` and `outbox` counts with every `/changes` poll.
   - The hub's Stations page lists each iPad's pending count and its migration status.
2. **Migration, done mid-week by staff at each iPad:**
   1. The old app shows **"Move this iPad to the new check-in address"**. The button is enabled **only when online**.
   2. Pressing it freezes new check-ins and check-outs on that iPad.
   3. It then syncs the queue and outbox until both are **empty and acknowledged by the server**.
      - If either can't be sent (for example an old-shape 409), it stops and shows "N items need a coordinator", and
        nothing is wiped.
   4. Only when both are empty does it wipe the old roster, day lists, photos, approvers and K_dev, and show the QR
      code and the new address.
   5. The old token is **kept** until the replacement is paired, so reports still upload if needed.
   6. Staff open the new address in Safari, then **Add to Home Screen** (or the MDM web clip is updated), then open it
      from the Home Screen. **The new container is where pairing must happen.**
   7. A pairing code is shown. In the hub, staff choose **"Replace North Desk 2"** instead of "Add a station".
      - The server creates the new device row and keeps the name, lease, campus and print settings, with
        `replaces_device_id`.
      - It **revokes the old token only now**.
      - The new device gets a fresh K_dev and fresh verifiers.
   8. Remove the old Safari bookmark or web clip. Guided Access or Single App Mode now points to the new web clip.
3. **Safety nets:**
   - If the old token uploads after replacement (a forgotten tab), the server **still records the reports** (§3.8:
     reports are always accepted) and alerts. Nothing is dropped.
   - The old host keeps serving `/checkin` to **paired tokens not yet migrated** for 60 days. After that it shows only
     the move screen. The migration screen stays available indefinitely, so a powered-off iPad found months later
     still drains.
   - Never migrate during check-in hours. The button is disabled inside the campus's hours.

## 2.5 How Part 2 interacts with Part 1 and the roster cache
- With (B), the only code that can reach K_dev, verifiers, the outbox and the roster is `checkin*.js` and `lib.js`,
  under a strict script CSP. That **removes the hub-wide XSS and third-party script paths** to the offline code
  (keylogging) and to the medical-notes roster. **Part 1's residual risk drops from Medium to Low.**
- With the station token in an HttpOnly `__Host-` cookie, A4 can no longer **steal** the token. It can only use it on
  the iPad while running.
- With no cookie auth on that host, the "coordinator signs in on the tablet" route disappears. Approvals come from the
  phone, the online PIN or the offline code, and none of them leaves a session on the kiosk.
- The roster stays in the check-in origin's IndexedDB or localStorage. Moving it to IndexedDB makes purges
  transactional; that is optional. §3.11's minimisation and purge rules are unchanged.
- Without (B), Part 1 still works, but the owner must accept that **any script on any hub or app page that the kiosk
  loads** can read the roster and the token, and can capture offline codes. Do (A)'s hardening now in either case.

## 2.6 Tests for Part 2
- **Router sweep (both hosts):**
  - On the check-in host, every non-allow-listed path is 404.
  - A valid hub `mb_session` cookie sent to the check-in host gives `req.user = null`, and station-only scope holds.
  - On the hub host, a request with both a cookie and `x-station` follows the precedence rule.
- **Headers:** the CSP, COOP, CORP, HSTS and `frame-ancestors` values on the check-in host. `X-Frame-Options: DENY` on
  `/checkin`.
- **Browser (Playwright WebKit):**
  - a page on the hub host can't read the check-in host's localStorage or IndexedDB
  - framing the check-in host from the hub is blocked
  - `window.open` from the hub gives `opener === null` on the check-in side
- **Station cookie:** set as `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`. Not readable by
  `document.cookie`. Rotated daily.
- **Migration:**
  - the move is refused while the queue or outbox isn't empty, or offline, or inside check-in hours
  - a replacement keeps name and lease and revokes the old token only at pairing
  - an old-token upload after replacement is recorded and alerted, never lost
  - a fault-injection run (network drop mid-drain) loses nothing
- **SRI:** a grep test that every dynamically added third-party `<script>` sets `integrity`.

## 2.7 Owner decisions
1. Accept the Part 1 residual risk (§1.10). Choose 10 digits (recommended) or 12.
2. Approve the separate check-in address (B) and the ~5-day cost. Choose the hostname (for example
   `checkin.<church domain>`).
3. Remove "coordinator signs in on the tablet" (plan §3.6, route 3) in favour of phone or PIN approval.
4. Device policy is a precondition for the Low rating: supervised iPads, passcode, Single App Mode or Guided Access,
   iCloud Backup off, Web Inspector off, Home Screen or web-clip install.

**Handoff:** design changes go to `senior-developer` (Phase 3 and 4 tickets: offline codes and the envelope; Phase 0
or 1: quick wins and the check-in host). Verification of §1.11 and §2.6 goes to `qa-engineer`.
