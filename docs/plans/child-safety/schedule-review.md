# Schedule review: is 61.5 working days real?

2026-11-25 · Planning only; nothing is implemented. The owner challenged the "61.5 working days core, 21–25 weeks"
figure. The Chief Architect and the Senior Developer each reviewed the phases independently (read-only, sized
against today's code). This page sets out both reviews and the reconciled answer. **No safety, security, testing or
operational requirement changes;** the revisions change only order, overlap and phase boundaries.

## The short answer
- **The 61.5 days was effort, not calendar.** It is development, QA and security review at a human-developer pace,
  with **no waiting in it**. The 21–25 weeks added waiting: one phase strictly at a time, each merge waiting for the
  previous deploy, the trial Sundays, the Christmas freeze, and slack.
- **The two reviews disagree on effort, because they assume different paces:**
  - **Senior Developer, human-equivalent pace:** about **603 hours (about 75 days)**. By that measure the plan
    *under*-estimates by about 20 %, mostly in P4 (the pickup rewrite) and P5 (the offline-code crypto).
  - **Chief Architect, agent-assisted pace:** about **320 team hours (about 40 days), plus about 28 hours of owner
    PR review**.
  - Both agree the hours were never the padding. The schedule was the padding.
- **What really sets the calendar:**
  - real Sundays: an iPad pilot, two trial Sundays after P4 and one after P6
  - the on-site iPad migration visit
  - the Christmas freeze
  - DNS and secrets, which the owner sets
  - how fast PRs are reviewed and merged

  These set a floor of about **11–12 weeks** for the full scope.

## Hours per phase (both estimates)
Agent-assisted hours are from the Chief Architect; human-pace hours from the Senior Developer.

| Phase | Agent-assisted: dev / QA / security / other | Total | Human pace total | Plan (days × 8) |
|---|---|---|---|---|
| P0 prep (read-only) | 2 / 6 / 1 / 9 | 18 | 21 | 20 |
| P0.5 interim guard | 6 / 4 / 2 / 5 | 17 | 24 | 16 |
| P1 history protection, legal hold | 10 / 8 / 3 / 5 | 26 | 47 | 40 |
| P2 foundation, quick wins | 14 / 8 / 4 / 5 | 31 | 54 | 52 |
| P3 check-in host, iPad migration | 12 / 8 / 4 / 10 | 34 | 67 | 56 |
| P4 codes, sessions, tag holders | 22 / 14 / 5 / 10 | 51 | 122 | 84 |
| P5 coordinator credentials, roster | 18 / 12 / 8 / 8 | 46 | 98 | 80 |
| P6 child protection | 14 / 10 / 5 / 6 | 35 | 74 | 64 |
| P7 medical levels, labels | 12 / 8 / 4 / 9 | 33 | 54 | 44 |
| P8 regression, load test, release | 5 / 10 / 1 / 12 | 28 | 42 | 28 |
| **Core** | **115 / 88 / 37 / 79** | **319** | **603** | **492** |
| P9 (optional) | 8 / 6 / 2 / 4 | 20 | 31 | 28 |

"Other" (agent-assisted, core) is 25 h docs, 13 h volunteer training material, 19 h hardware testing (iPads, label
printers, PBKDF2 timing) and 22 h deployment and migration. On top of that, the owner spends about 28 h reviewing PRs,
plus DNS, the secrets and the iPad visit.

**Riskiest pieces**, where the estimate should not be squeezed:
1. the offline day-code crypto (P5)
2. outbox v2 and lease and clone detection (P4)
3. the check-in host and iPad migration (P3)
4. the history-protection triggers (P1), which can only be undone by a new migration

## What can be combined safely
- **Docs in each phase's PR** (already a project rule); P8 keeps only regression, load test and the release
  checklist.
- **P0 and P0.5 as one week:** P0 is read-only.
- **New split: P7a.** Level 1 allergen words, "EPI: YES" and the new label ship **with P4**. This **shortens the
  accepted risk II-49** (full medical notes on labels) by about a month. Level 1 doesn't need P5. Level 2 and 3 stay in
  P7.
- **Kept separate** for small, reversible PRs:
  - P0.5 (the only interim guard, so it should merge alone and fast)
  - P1 (triggers can't be reverted while a hold is active)
  - P3 (host)
  - P4
  - P5 (crypto)
  - P6

## What can run in parallel (no conflicting files)
| While | In parallel | Why it doesn't conflict |
|---|---|---|
| P0.5 is built (`public/js/checkin.js`, `server/routes/checkin.js`) | P0 inventory and device probes (read-only) | No edits |
| P0.5 is in review | P1 build (`server/db.js` m30; services, teams, series, backup) | No check-in files |
| Christmas freeze (no deploys) | P3 and then P4 built on branches | Merged after the freeze |
| P4 build | P5 crypto modules and property tests (new files only); Security pre-review of the crypto | New files only |
| P4 trial Sundays | P5 integration | Merged after the soak |
| P6 build | P7 server side (m36, care-note endpoints) | `server/db.js` migration order agreed in advance |
| Every phase | Church Operations: desk card, training, family message | Policy document only |

**Hot spots, always one stream at a time:** `public/js/checkin.js` and the `MIGRATIONS` order in `server/db.js`.
Migration numbers m30–m36 are reserved up front. New tests go in new files (for example `test/checkin-*.test.js`)
rather than the shared `test/api.test.js`.

## Genuine dependencies
- **P0.5's refusal switch** waits until every station reports the new app version. The version report moves from P2
  into P0.5, because the staged switch needs it.
- **P1 before P2:** soft. They share the trigger pattern and both edit `people.js`.
- **P3 needs P2:** the check-in guard and station allow-list. It also needs DNS and the Render domain, both owner tasks.
- **P4 needs every iPad migrated (P3):** sensitive data is served only on the check-in host, and the old app can't
  type 5–6-character codes. P4 also needs P0.5's outbox format.
- **P5 needs P4's** lease and operator data.
- **P6 is switched on** only after the P4 soak, with P5 merged and explicit mode on.
- **P7 Level 2 needs** P4 and P5.
- **P8** comes last.
- **Retention purges** wait for the insurer and attorney. They are outside the core plan.

## Optional or postponable without affecting child safety
- **Postpone:**
  - **P9**, offline quick-add for first-time families
  - the retention dry-run report (no purge is switched on anyway)
  - all-campus search
  - MDM (Guided Access is free)
- **Owner to confirm whether postponable:**
  - the P8 history page and export, and the "older than 13 months" access rule
  - the Live page and check-in hours

  These records stay protected either way; only the viewing tools would wait.
- **Not postponable:**
  - the interim guard
  - the roster and label rules
  - every "must" test
  - the lost-iPad drill
  - the soaks
  - the Easter load test (Easter is 28 March 2027)

## Timelines
Assumed freeze: 19 December to 3 January, with no deploys; building on branches continues. Both timelines keep every
test, security review, soak and safeguard. If a phase's required tests or review don't pass, **the date slips; the
gate doesn't**.

| Milestone | Recommended | Accelerated |
|---|---|---|
| Temporary pickup procedure (no code) | Sun 29 Nov | Sun 29 Nov |
| P0.5 merged; refusal switch on after stations report versions (Sun 6 Dec) | 4 Dec; switch 8 Dec | 1 Dec; switch 7 Dec |
| P1 merged | 11 Dec | 4 Dec |
| P2 merged; owner sets up DNS | 18 Dec | 11 Dec |
| P3 merged; pilot iPad Sunday; on-site migration | 5 Jan; Sun 10 Jan; 12–15 Jan | Merged 16 Dec, switched on 4 Jan; Sun 10 Jan; 11–12 Jan |
| **P4 + P7a switched on: code-only release ends**; two trial Sundays | **26 Jan**; Sun 31 Jan and 7 Feb | **13 Jan**; Sun 17 and 24 Jan |
| P5 merged; owner sets the secrets | 9 Feb | 19 Jan |
| P6 switched on; trial Sunday | 16 Feb; Sun 21 Feb | 26 Jan; Sun 31 Jan |
| P7 merged | 2 Mar | 2 Feb |
| P8 merged; Easter load test | 9 Mar; before 28 Mar | 9 Feb; before 28 Mar |
| **Core complete** | **about 12 March (about 15 weeks)** | **about 12 February (about 11–12 weeks)** |

- **Recommended:**
  - the owner reviews about 1–2 PRs a week
  - a week of buffer around P4, because the Senior Developer's larger P4 and P5 estimates may be right
- **Accelerated:**
  - the owner reviews 2–3 PRs a week
  - P3 is merged before the freeze but switched on after it
  - P4 is built during the freeze
  - P4 must be ready within days of the iPad visit; any slip moves it to the recommended dates
- **Compared with the plan's 21–25 weeks:** the recommended timeline ends code-only release about 3 weeks earlier
  (week 9 instead of weeks 10–13) and finishes about 7–10 weeks sooner.
