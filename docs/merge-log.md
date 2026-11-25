# Merge log: Milestone 1

What was merged into the `milestone-1` integration branch, and why. Merging `milestone-1` into `main`
deploys to production and runs any migrations, so that step needs the owner's explicit approval. The
rules are in [master-product-roadmap.md](master-product-roadmap.md) §2.

| Date | PR | What | Checks before merge | Into |
|---|---|---|---|---|
| 2026-11-25 | #53 | GitHub Actions runs `npm test` on every PR and on pushes to `main` and `milestone-1` | CI green; local `npm test` 42/42 | milestone-1 |
| 2026-11-25 | #49 | Child-safety V1 plan and Subsplash cutover plan (docs only; approves the plan, implements nothing) | CI green; docs link test | milestone-1 |
| 2026-11-25 | #50 | Master roadmap revision 3, feedback record, merge log (docs only) | CI green; docs link test | milestone-1 |

**Deployed to production:** nothing yet. `main` is unchanged.
