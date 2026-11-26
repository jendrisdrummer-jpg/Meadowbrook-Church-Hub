# Security review of revision 3.2 (owner questions Q1–Q4)

Security Specialist · 2026-11-25 · Read-only review of the revision 3.2 draft, checked against `plan.md` (3.1),
`public/js/checkin.js` and `server/routes/checkin.js`.

**Verdict: approve with changes.** Nothing in the draft weakens a 3.1 safeguard. All six required changes below are
applied in [revision-3.2.md](revision-3.2.md).

## 1. Ambiguity gap and the P0.5 fix
- **The gap is real.**
  - `showMatch` collects every child with the code across all households. It shows only the first household's
    pickup list, and it posts `{ids}`.
  - The server's `{ids}` branch does no household check.
  - So a guard on `{security_code}` alone would never fire for today's app.
- **The design is sound.** A station can send `split_confirmed: true` itself, but that is not a meaningful bypass: a
  leader session or station token can already send one family's ids at a time. The flag prevents mistakes, not
  attacks, so audit is the right control.
- **Required (2):** the audit row records the server-known identity (session user or station token), not the
  free-text `by`, plus the ids and households. A child with no household counts as its own family.
- **Required (1), old outbox:** today's outbox is one flat list of ids merging every offline check-out. A mixed batch
  refused with 409 would retry every 30 s forever and leave children shown as checked in, which makes headcounts and
  evacuation lists wrong. The release already happened physically, so refusing the replay protects no one. Required:
  - per-release outbox entries, with the old flat list converted on load
  - replays marked and recorded per id, with an audit row and an alert
  - a staged rollout: client first; then station versions confirmed; only then the `{ids}` 409 for clients with no
    version. Kiosks under Guided Access keep old code in memory all day.
  - a test for a legacy mixed flat list

## 2. Approved release roster
- Sound, and stricter than 3.1.
- **Required (3):** the draft said offline Tier B releases already need a day code. That is not true for ID-tick
  releases: 3.1 §3.8 allows them offline with an attested operator. State one consistent offline rule. Using the
  cached roster pick with `operator_verified=false`, or requiring a day code, are both acceptable. Neither weakens
  3.1. Cache the roster on iPads with a stated revocation delay.
- **Required (4):** push text must be generic ("Confirm a release at North Desk 2"), with names only inside the
  signed-in app and an opaque id in the payload. Confirmation is single-use, bound to release id and station, expires
  after about 2 minutes, and must come from the picked operator.
- The "screening complete" tick with no details stored is the right privacy call. Record who ticked it, when, and the
  policy version.

## 3. Labels
- The final content is good.
- **Required (5):** never silently cut an allergy strip short. If the words don't fit, print a "several, see room
  leader" line plus the EPI line.
- **Required (6):** keeping full `medical_notes` on labels until P7 is acceptable, because removing it before Level 1
  exists could hide life-critical information. Record it as an owner risk acceptance.
- Optional, adopted: P0.5 can switch to the last-name initial now. It has no safety cost.

## 4. Interim paper pickup-alert list
- Privacy handling is acceptable. Add:
  - numbered copies, counted back each week
  - kept out of photos and lost-and-found
  - a missing copy reported to the safeguarding lead the same day

## 5. Hardware claims
- Correct:
  - Web Locks arrived in Safari and iPadOS 15.4.
  - ECDH P-256, HKDF, AES-GCM and PBKDF2 predate it.
  - A non-extractable `CryptoKey` can be stored in IndexedDB.
  - The iPad Air 2 and mini 4 run iPadOS 15.
- Clarify: those two can't run iPadOS 16, so "16.4+ recommended" excludes them.
- Add Safari's 7-day storage clearing as a caveat. Run the app from the Home Screen, and have P0 check that the key
  survives a two-week gap.
- 600,000-round PBKDF2 will probably be slow on A8/A8X iPads. The P0 timing and the 310,000-round fallback cover it.
