# Merge log: Milestone 1

What was merged into the `milestone-1` integration branch, and why. Merging `milestone-1` into `main`
deploys to production and runs any migrations, so that step needs the owner's explicit approval. The
rules are in [master-product-roadmap.md](master-product-roadmap.md) §2.

| Date | PR | What | Checks before merge | Into |
|---|---|---|---|---|
| 2026-11-25 | #53 | GitHub Actions runs `npm test` on every PR and on pushes to `main` and `milestone-1` | CI green; local `npm test` 42/42 | milestone-1 |
| 2026-11-25 | #49 | Child-safety V1 plan and Subsplash cutover plan (docs only; approves the plan, implements nothing) | CI green; docs link test | milestone-1 |
| 2026-11-25 | #50 | Master roadmap revision 3, feedback record, merge log (docs only) | CI green; docs link test | milestone-1 |
| 2026-11-25 | #51 | Interim privacy fix: leaders no longer get health information, private notes, household notes or pickups on person pages; check-in never sends an adult's health data | CI green; npm test 43/43; test:ui 168/168; browser check; security review: approve, no findings | milestone-1 |
| 2026-11-25 | #52 | Kids' check-in only for paired stations, staff/admins and admin-authorised leaders (interim `checkin_user_ids`); families stay with their campus (unassigned households included on purpose); connect-card messages staff only; automatic leader access audited | CI green; npm test 44/44; test:ui 168/168; browser check; security review: approve with changes, M1 and L1 fixed in the PR with failing-first tests | milestone-1 |
| 2026-11-25 | #54 | Account onboarding: unlinked accounts tell the office (admins notified once a week per account); admins link accounts to people by hand; one person, one account. **Migration 30** (nullable `users.link_requested_at`) | CI green; npm test 45/45; test:ui 168/168; browser checks; security review: approve, L3 fixed | milestone-1 |
| 2026-11-25 | #55 | Feedback: anyone signed in can send feedback from the hub or app; admins triage it (status, admin note, "You said, we did" note); public list of completed items without names. **Migration 31** (`feedback`) | CI green; npm test 46/46; test:ui; browser check; security review: Lows fixed (campus-limited admins, tag campus, no text in push) | milestone-1 |
| 2026-11-25 | #56 | Campus eligibility: per-volunteer serving campuses (none = home campus only); candidates show why someone is ineligible; autofill skips them; manual other-campus assignment needs a confirm. **Migration 32** (`serving_campuses`) | CI green; npm test 48/48; test:ui 168/168; browser check; security review | milestone-1 |
| 2026-11-25 | #57 | Basic small groups with a members-only group chat; contact details staff only; leaders limited to their group's campus, audited, 30 adds a day. **Migration 33** (`groups`, `group_members`, `chats.group_id`) | CI; npm test 56/56; test:ui 174/174; security review 1 High, 3 Medium fixed with failing-first tests; re-review: no High/Medium, 5 of 7 Lows fixed (L2 sign-out streams is an owner decision; L6 push text untested) | milestone-1 |
| 2026-11-25 | #58 | Scheduling loop: “Remind N who haven’t replied” (leader+, own teams only, 12-hour limit, upcoming services only, audited); Message team links; “Please reply” requests first. **Migration 34** (`assignments.nudged_at`) | CI; npm test 57/57; test:ui 174/174; browser check; security review: no High/Medium, L1 and L2 fixed with failing-first test | milestone-1 |

**Migrations waiting for the next deploy:** 30 (`users.link_requested_at`), 31 (`feedback`), 32 (`serving_campuses`), 33 (small groups), 34 (`assignments.nudged_at`). All additive. They run automatically on
production when `milestone-1` is merged to `main`, which needs the owner's approval; take a backup first.

**At go-live:** add serving campuses for volunteers who serve at more than one campus (otherwise they are only offered at their home campus).

**Deployed to production:** nothing yet. `main` is unchanged.
