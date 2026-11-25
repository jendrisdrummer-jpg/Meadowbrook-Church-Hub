# Release-readiness checklist

Use this for every **significant** feature (anything medium or large in
[agent-workflow.md](agent-workflow.md), anything touching people data, money, permissions,
sign-in, notifications to the congregation, or the database schema). Copy it into the PR
description and tick each item with evidence. An unticked item needs a written reason.

## 1. Purpose and scope
- [ ] The problem and who it helps are stated (Product Manager brief / Church Operations notes for large features).
- [ ] Checked [features.md](features.md): this doesn't duplicate something that exists.
- [ ] Scope agreed with the owner; anything deferred is listed in [roadmap.md](roadmap.md).

## 2. Design and architecture
- [ ] Plan reviewed by the Chief Architect (medium/large).
- [ ] Follows existing patterns; no new dependency or paid service (or approved in writing).
- [ ] Schema change is an appended migration, additive, documented in [database.md](database.md).
- [ ] No church-specific values in code; per-church settings in `settings` (SaaS readiness).
- [ ] Destructive data changes: owner approved, backup taken first.

## 3. Security and privacy
- [ ] Every new route has the right guard and campus scoping (see [permissions.md](permissions.md)).
- [ ] Security Specialist reviewed it if it touches sign-in, permissions, money, children's data,
      private messages, uploads, public endpoints or a new integration. No open Critical/High findings.
- [ ] Secrets only in env vars; none in code, tests, docs or PR text.

## 4. Quality
- [ ] `npm test` passes (paste the summary line).
- [ ] New API tests cover the workflow **and** the permission edges (403 for lower roles, other campus hidden).
- [ ] `npm run test:ui` passes; phone and desktop screenshots of changed pages were looked at.
- [ ] The affected workflows in [testing.md](testing.md) were run end to end, as the right roles.
- [ ] Light and dark themes checked for new UI.
- [ ] Things that couldn't be tested here are listed (real phones, printers, live services).

## 5. User experience
- [ ] Matches [design-system.md](design-system.md); wording is plain and kind; errors say what to do.
- [ ] Works on a phone at 390px; tap targets OK; no sideways scrolling.
- [ ] Empty states and first-time setup are clear (what to do next).
- [ ] Accessible: labels, contrast, keyboard.

## 6. Operations
- [ ] Setup steps for the owner (env vars, accounts, settings) are in the README and the PR.
- [ ] Integrations fail gracefully when not configured, and say how to set them up.
- [ ] Background jobs are idempotent and don't overlap.
- [ ] Rollback thought through: what happens if this PR is reverted after the migration ran?

## 7. Documentation
- [ ] Docs updated per the table in [development.md](development.md#keeping-the-docs-current).
- [ ] [features.md](features.md) and [roadmap.md](roadmap.md) reflect the new state.
- [ ] Known limitations recorded in [tech-debt.md](tech-debt.md).

## 8. Final review
- [ ] Chief Architect final review done (large features).
- [ ] PR description says what changed, how it was tested, and what the owner needs to do.
