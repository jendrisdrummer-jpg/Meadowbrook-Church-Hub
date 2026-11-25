# Kids' check-in child-safety plan

**Status: Version 1 strategy proposed (see v1-strategy.md); revision 3.2 kept as the Version 2/3 reference. Awaiting owner approval. Nothing here is implemented.** Approving means
merging the pull request that adds this folder. Development then starts with Phase 0, one phase per
pull request, each needing its own review and the owner's merge. Deployment approvals (Group III of
the checklist) are asked for one at a time, when each phase is ready.

## The plan (read these)

| File | What it is |
|---|---|
| [v1-strategy.md](v1-strategy.md) | **Read first.** The Version 1 / 2 / 3 strategy: the smallest safe first release, what stays manual, what is postponed and its real risk, effort, calendar, and the rest of Church Hub. Reviewed independently by all five agents, who then challenged each other's positions. Sets the scope of the first release |
| [revision-3.2.md](revision-3.2.md) | The full design (now the Version 2/3 reference). Revision 3.2: interim safety and the new first phase P0.5, the temporary pickup procedure, the approved release roster, exact label content, hardware and costs. Governs over plan.md where they differ |
| [schedule-review.md](schedule-review.md) | Independent Chief Architect and Senior Developer review of the effort and calendar: hours per phase, safe combinations, parallel work, dependencies, and the recommended and accelerated timelines |
| [plan.md](plan.md) | The implementation plan, revision 3.1 (Chief Architect). Section "000" lists the final Security notes N1–N8; where older wording differs, that section governs |
| [operational-policy.md](operational-policy.md) | Church-facing policy for staff and volunteers: the two check-out lanes, tag holders, "list only" families, medical notes, paper kit, lost iPads |
| [approval-checklist.md](approval-checklist.md) | All 135 items in three groups (I church policy, II technical approvals, III deployment approvals), each with a recommended default; the owner decision sheet is at the top |

## Supporting review findings

| File | What it is |
|---|---|
| [review-security-rev3.2.md](review-security-rev3.2.md) | Security Specialist's review of revision 3.2: approve with changes (all six applied) |
| [review-operations-rev3.2.md](review-operations-rev3.2.md) | Church Operations' review of revision 3.2: workable with changes (applied) |
| [review-security-v3-verification.md](review-security-v3-verification.md) | Security Specialist's verification of revision 3: all 19 must-fix items pass; notes N1–N8 (applied in 3.1) |
| [review-security-rev2.md](review-security-rev2.md) | Security Specialist's independent review of revision 2 (0 Critical, 3 High, 14 Medium, 21 Low) |
| [security-credentials-and-isolation.md](security-credentials-and-isolation.md) | Security Specialist's specification of offline coordinator codes (cryptography, generation, storage, expiry, brute-force limits, lost iPad) and the separate check-in host |
| [followup-architect-codes-checklist.md](followup-architect-codes-checklist.md) | Chief Architect's answers on pickup-code uniqueness and the checklist (owner questions Q1, Q6) |
| [followup-security.md](followup-security.md) | Security Specialist's answers on tag holders, medical notes, retention and offline PINs (Q2–Q5) |
| [followup-operations.md](followup-operations.md) | Church Operations' answers on the same questions from the Sunday-morning side |

## First-round reviews (of the first draft)

| File | What it is |
|---|---|
| [review-security.md](review-security.md) | Security Specialist (0 Critical, 9 High, 13 Medium, 6 Low) |
| [review-qa.md](review-qa.md) | QA Engineer: 138 test cases, edge cases and failure scenarios |
| [review-operations.md](review-operations.md) | Church Operations: Sunday-morning practicality |

Each review was written against an earlier revision; the plan records how every finding was
resolved. When the plan and a review disagree, the plan is the decision.
