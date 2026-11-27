# Project docs

The shared knowledge base for people and the Claude Code agent team. The root
[README](../README.md) covers what the hub is and how to set it up and run it; these pages cover
how it's built and how to change it.

| Page | What's in it |
|---|---|
| [architecture.md](architecture.md) | Stack, how the code is laid out, request flow, background jobs, integrations, deployment, multi-church readiness |
| [database.md](database.md) | Tables by area, relationships, migration rules, where sensitive data lives |
| [features.md](features.md) | Everything that's built, where it lives, what it replaces, and its status (verified, needs more testing, partial, not built, needs outside setup) |
| [permissions.md](permissions.md) | Roles, flags, campus limits, stations, guests, rules for new routes |
| [design-system.md](design-system.md) | Tokens, components, patterns, writing style, accessibility and mobile checklists |
| [api.md](api.md) | API conventions, endpoint map, integrations and their settings |
| [account-links.md](account-links.md) | How accounts are linked to people, the audit script, resolving duplicate accounts |
| [security.md](security.md) | Security and privacy standards, severity scale, review checklist |
| [development.md](development.md) | Coding standards, commands, git/PR flow, keeping docs current, efficient Claude use |
| [beta-readiness.md](beta-readiness.md) | Staff beta readiness: deployment gate, device and email tests, import, permissions, training, configuration |
| [leadership-preview.md](leadership-preview.md) | **Current milestone:** the owner's personal testing checklist on the live site, the leadership demo guide, likely questions, a one-page feature overview, known issues and next steps |
| [deploy-runbook.md](deploy-runbook.md) | Deploying `milestone-1` to Render: pre-deploy checks, owner steps, the first hour, go/no-go, rollback, env var list, rehearsal record |
| [restore-drill.md](restore-drill.md) | Backup restore drill on a laptop (offline mode), and its record |
| [testing.md](testing.md) | Test layers, writing tests, core workflow regression checklist, phone checks |
| [release-checklist.md](release-checklist.md) | Release-readiness checklist for significant features |
| [tech-debt.md](tech-debt.md) | Known bugs and technical debt |
| [master-product-roadmap.md](master-product-roadmap.md) | **Order and phases:** the five-phase rollout, release gates, adoption and migration plan, retiring Faith Teams, Google Chat and Subsplash, effort and timeline |
| [merge-log.md](merge-log.md) | What was merged into the `milestone-1` integration branch, and why (deploying to `main` needs the owner's approval) |
| [feedback.md](feedback.md) | Leaders' prioritised feedback list and the "You said, we did" record |
| [roadmap.md](roadmap.md) | The backlog: item IDs, sizes, gap analysis (order is set by the master roadmap) |
| [agent-workflow.md](agent-workflow.md) | The nine agents, who owns what, hand-offs, which agent for which task, approvals |
| [plans/](plans/child-safety/README.md) | Implementation plans awaiting or after owner approval (child safety) |
| [../mobile/README.md](../mobile/README.md) | **Phase 0 built:** the iPhone demo app shell (`mobile/`, Capacitor) and the owner's Xcode steps |
| [plans/mobile-and-multichurch/plan.md](plans/mobile-and-multichurch/plan.md) | **Proposed:** the Meadowbrook demo phone app (Capacitor shell), multi-church options and recommendation, shared-app sign-in, native push, timeline |

Screenshots used by the root README also live here (`*.png`).
