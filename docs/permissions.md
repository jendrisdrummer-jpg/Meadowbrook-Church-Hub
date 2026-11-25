# Roles and permissions

How access works. Any change here is a security change: it needs the Security Specialist's review
and the owner's approval (see [agent-workflow.md](agent-workflow.md)). Code: `server/auth.js`.

## Who is asking

| Caller | How they're recognised | What they can reach |
|---|---|---|
| **Guest** (no account) | No session | Public app config, events and sign-ups, Watch library and live, giving checkout, connect cards, email reply links, announcements push for guests, the podcast feed |
| **Signed-in account** | `mb_session` cookie (HTTP-only) from Google sign-in, an emailed code or a password | By role, flags and campuses below |
| **Check-in station** (iPad) | `x-station` header with a paired token (stored hashed) | Check-in endpoints, campuses and adding families, at its own campus only (`stationAuth`) |
| **Webhook** (Stripe) | Signature on the raw body | `/stripe/webhook` only |

All non-GET API requests need `x-mb: 1` (`requireAppHeader`), which stops other sites from
posting on a signed-in person's behalf.

## Roles (ranked)

`volunteer` < `leader` < `staff` < `admin`. A route guarded with `requireRole('leader')` lets
leaders, staff and admins in. Leader access can also come **automatically** from leading a team
(`users.role_auto`), and is taken back when they stop leading, if that's where it came from.

| | Volunteer | Leader | Staff | Admin |
|---|:-:|:-:|:-:|:-:|
| Own schedule, accept/decline, away dates | ✓ | ✓ | ✓ | ✓ |
| Order of service for services they serve at; all services in the app | ✓ | ✓ | ✓ | ✓ |
| Chat with their teams and groups; tasks | ✓ | ✓ | ✓ | ✓ |
| See people, teams, attendance; run check-in; add families; connect cards | | ✓ | ✓ | ✓ |
| Start chat groups; schedule their teams; edit orders of service and songs | | ✓ | ✓ | ✓ |
| Edit people, households, services, rooms, templates; schedule any team | | | ✓ | ✓ |
| Events, Media, App Builder, check-in stations | | | ✓ | ✓ |
| Settings, campuses, accounts, profile fields, import, merge duplicates, backups, reset Mux key | | | | ✓ |

## Permission flags (on top of the role)

| Flag | Grants | Notes |
|---|---|---|
| `finance` | Giving: gifts, donors, funds, batches, statements, finance dashboard (`requireFinance`) | **Never implied by role, not even admin.** Giving data is seen only by people explicitly given Finance. |
| `announce` | Sending announcements to the congregation | Admins always have it. |

## Campus limits

`users.campus_ids` (JSON list, or NULL for all campuses). Routes use `canCampus(user, id)` for one
record and `campusFilter(user, column)` for lists. Any new campus-owned data must be filtered the
same way.

## Field-level visibility

- Custom profile fields have `visibility` leader or staff.
- Children's allergies and medical notes are shown for check-in and to leaders and up.
- Chats: only members (team chats follow the team roster).
- Private tasks: only the person; team tasks: the team.

## When you add a route

1. Choose the lowest role that needs it, and add campus scoping if the data has a campus.
2. Public (guest) routes need a reason, rate limiting if they write, and must return only what a
   guest should see (see `publicItem` in `routes/media.js` for the pattern).
3. Add a test that a lower role gets 403 and a campus-limited account can't see other campuses.
4. Update this page.

## Known gaps

Tracked in [tech-debt.md](tech-debt.md): a page an account can't open shows "Something went
wrong" instead of "You don't have access" (the server correctly refuses with 403).
