# Roles and permissions

How access works. Any change here is a security change: it needs the Security Specialist's review
and the owner's approval (see [agent-workflow.md](agent-workflow.md)). Code: `server/auth.js`.

## Who is asking

| Caller | How they're recognised | What they can reach |
|---|---|---|
| **Guest** (no account) | No session | Public app config, events and sign-ups, Watch library and live, giving checkout, connect cards, email reply links, announcements push for guests, the podcast feed |
| **Signed-in account** | `mb_session` cookie (HTTP-only) from Google sign-in, an emailed code or a password; the server keeps only a hash of it. Open live chat pages end when the account signs out, is deactivated or deleted, or has its role, campuses or linked person changed (they reconnect with the new access) | By role, flags and campuses below |
| **Check-in station** (iPad) | `x-station` header with a paired token (stored hashed) | Check-in endpoints, campuses and adding families, at its own campus only (`stationAuth`) |
| **Webhook** (Stripe) | Signature on the raw body | `/stripe/webhook` only |

All non-GET API requests need `x-mb: 1` (`requireAppHeader`), which stops other sites from
posting on a signed-in person's behalf.

## Linking accounts to people

An account is linked to one person in People (`users.person_id`); that's how it sees its schedule,
teams and chats. **Only an admin links an account,** by choosing the person (Settings → Sign-in &
accounts → "Accounts not linked to a person", or the account's "Link to person…"). New code never
links by name, email or any other guess. One person can have only one account (409 otherwise).
An unlinked account sees "We've let the church office know", which calls `POST /me/link-request`;
admins get one notification per account per week.

Existing behaviour, unchanged: signing in for the first time links an account to the person in
People with exactly that email address, and an admin adding an account with no person chosen does
the same. That is how volunteers in People get their schedule without an admin step.

## Feedback

Anyone signed in can send feedback (rate-limited) and see what they sent and what happened to it.
Admins see all of it from their campuses (and feedback with no campus), with who sent it, and set the status and notes. A sender can only tag a campus they belong to. Admin notifications say who sent it and what kind, never the text. The "You said, we did" list
(`GET /feedback/done`) shows only admins' notes on finished items: no names and no original text.

## Forms

Staff and admins set up forms (Church app → Forms). A campus-limited account can create and edit forms only
for its own campuses, never church-wide ones, and sees another campus's forms nowhere. **Responses are
staff-only.** For a campus form they are readable by staff who can access that campus; for a church-wide
form only by staff with no campus limit (campus-limited staff see the form in the list but no counts or
answers). Marking a response done is staff; deleting one is admin and audited. Anyone can fill in a
public form without an account (rate-limited, with a hidden honeypot field); a signed-in form needs a
session of any role, and for a campus form the account must be able to access that campus (otherwise 404,
the same rule as the app's More tab). A response is linked to a person **only** through the signed-in account's own linked
person: a typed email or name never links to anyone. The "tell this person" notice carries no answers
("Open Forms in the Hub to read it."), and the person chosen must be staff who can see that form's responses. That is checked again when a response
arrives, so someone demoted, switched off or limited since is simply not told; a person gets at most one notice
per form every 15 minutes. Exporting responses to CSV is audited (`form.export`: title and row count, never
answers). Don't collect children's medical or safeguarding details in forms; check-in is the place for that.

**Retention (recommendation, agreed before any form collects sensitive information):**
- Ask only what the ministry needs to act. No children's medical, safeguarding, financial or
  identity-document details in forms; those belong in check-in, giving or a pastoral conversation.
- Pastoral or personal free text (a prayer request, a care need): mark the response done once
  followed up, and delete it (admin) within **90 days** of being done, unless a pastor asks to keep it.
- Sign-ups and interest forms (volunteer interest, event questions): keep for **12 months**, then
  export what's needed and delete the rest.
- CSV exports are copies outside the hub: download only when needed, keep them off shared drives,
  and delete them when the task is done (exports are audited as `form.export`).
- Archive a form when it closes; archiving keeps responses, so the deletion step above still applies.
- Review open forms and old responses each quarter (the same rhythm as the restore drill).

The hub doesn't delete responses automatically yet; if a form will collect sensitive information
regularly, ask for automatic deletion first.

## Settings → Checks

Admins only (`GET /admin/production-checks`). Shows whether this server is set up safely for real use; never
shows a secret, only yes/no and non-secret values such as `MB_TRUST_PROXY`. It also shows the signed-in admin's own
address as the server sees it (so they can compare it with a “what is my IP” site); that is returned only to that admin and isn't stored.
It warns for an hour after the sign-in code limit for new accounts (`max_code_emails_per_hour`) was reached.

**Sign-in policy in production:** use `invited` (or `directory`). Under `anyone`, sending a code to a new
address is by design, up to `max_code_emails_per_hour` an hour server-wide; past that, new addresses get the
usual “code sent” answer and no email (people who already have accounts are never held back by it).
`GET /settings` leaves that cap out for everyone but admins.

## Roles (ranked)

`volunteer` < `leader` < `staff` < `admin`. A route guarded with `requireRole('leader')` lets
leaders, staff and admins in. Leader access can also come **automatically** from leading a team
(`users.role_auto`), and is taken back when they stop leading, if that's where it came from.

| | Volunteer | Leader | Staff | Admin |
|---|:-:|:-:|:-:|:-:|
| Own schedule, accept/decline, away dates | ✓ | ✓ | ✓ | ✓ |
| Order of service for services they serve at; all services in the app | ✓ | ✓ | ✓ | ✓ |
| Chat with their teams and groups; tasks | ✓ | ✓ | ✓ | ✓ |
| See their own small groups: names and photos of the roster, and the group chat (members only) | ✓ | ✓ | ✓ | ✓ |
| Create, edit, archive small groups and set their leaders (at their campuses) | | | ✓ | ✓ |
| See people, teams, attendance; run check-in; add families; connect cards | | ✓ | ✓ | ✓ |
| Start chat groups; schedule their teams; edit orders of service and songs | | ✓ | ✓ | ✓ |
| Edit people, households, services, rooms, templates; schedule any team | | | ✓ | ✓ |
| Events, Forms, Media, App Builder, check-in stations | | | ✓ | ✓ |
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

**Serving campuses** (which campuses a volunteer may be scheduled at, `PUT /people/:id/serving-campuses`):
staff and admins only; leaders and volunteers can't change them. Campus-limited staff can only add or
remove campuses they can access (other campuses already on the list are left alone), and every change
is audited (`person.serving_campuses`). The list is shown on `GET /people/:id` (not sensitive).
Scheduling honours it on the server: candidates are marked `eligible`, autofill skips ineligible people,
and a manual assignment for one is refused with 409 unless the request sends `allow_other_campus: true`
(the screen sends that only after the scheduler confirms a warning).

## Field-level visibility

- Custom profile fields have `visibility` leader or staff.
- Allergies, medical notes, a person's private `notes`, household notes and the household pickup list
  are **staff and up** on a person's page (`GET /people/:id`). Leaders, including anyone with leader
  access only because they lead a team, see contact and serving details but not those fields.
- **Kids' check-in** (`/checkin/roster`, `/checkin/checkins`, `/checkin/active`, `/checkin/checkout`,
  deleting a check-in) is for **paired stations, staff and admins, and leader accounts an admin has
  authorised** (Settings → Sign-in & accounts → the account → "Kids' check-in"; stored in the
  `checkin_user_ids` setting; `canCheckin` in `routes/checkin.js`). Other leaders get 403. It sends
  **children's** allergies and medical notes, never an adult's. Every route checks the campus.
- **The check-in roster** for a campus holds that campus's families **plus families with no campus
  set**, and never a family assigned to another campus. The rule uses the **family's** (household's)
  campus. Checking in and the list of who's checked in follow the same rule, so a check-in can't pull
  another campus's child into this campus's lists. A family visiting another campus can't be checked
  in there yet; that's a later child-safety item. Unassigned families are included on purpose,
  because Faith Teams has no campuses, so many imported households have none. Leaving them out would
  hide real children from check-in. Unassigned families are therefore visible at every campus's
  check-in to authorised people. Staff can assign a household's campus at any time (People → the
  household → edit; `PATCH /households/:id`), and from then on the family appears only at that
  campus. Assigning campuses to imported households before kids' check-in goes live (Subsplash
  cutover) narrows this further.

### Moving the interim check-in authorisation to the permanent permissions

The `checkin_user_ids` setting is temporary. Child-safety V1, PR 3 ("Access"), replaces it with the
permanent check-in access, stored as the first row type of a grants table (`user, capability =
'checkin', scope = campus`). That table was approved as part of the child-safety plan. The switch is
done in one PR:

1. **Copy the grants.** A migration creates one `checkin` grant per account in `checkin_user_ids`,
   scoped to that account's campuses (all campuses if it has no campus limit). Nobody gains or loses
   access on the day of the switch.
2. **Read from the new place.** `canCheckin` reads the grant instead of the setting. Staff, admins
   and paired stations keep access as now (or get grants by role, as V1 decides).
3. **Move the admin control.** The "Kids' check-in" checkbox writes the grant.
4. **Remove the old setting.** `checkin_user_ids` is deleted, and the tests in this PR run unchanged
   against the new storage.

Check-in authorisation is removed when the account is deleted or stops being a leader (by hand or
because it no longer leads a team), so it never comes back silently.

Until then, review the authorised list in Settings → Sign-in & accounts (accounts show a
"Check-in" tag).
- **Connect-card messages** (often prayer requests) are staff only; leaders see the card without it.
- Automatic leader access from leading a team is written to the audit log (`user.leader_auto`).
- Chats: only members (team chats follow the team roster; small-group chats follow the group roster).
  **Small-group chats are private to the group's current members, staff and admins included**
  (they often hold prayer and pastoral content); staff manage the roster from the group page. A live
  chat stream re-checks access on each message, so a removed member or an archived group stops
  receiving at once.
- **Small groups** (`routes/groups.js`) are their own model and **never grant leader access**: no
  `role_auto`, no change to `users.role`, nothing in scheduling. Who can do what:

  | Action | Volunteer, not in the group | Group member | Group leader (any role) | Staff with power over the group | Other staff |
  |---|:-:|:-:|:-:|:-:|:-:|
  | List groups | none shown | own groups | own groups | all they manage | only groups they're in |
  | Open a group and its roster | 403 | ✓ names + photos | ✓ names + photos | ✓ plus email and phone | 403 (unless a member) |
  | Group chat | no | ✓ | ✓ | only if they're a member | no |
  | Add or remove members (and find people to add) | 403 | 403 (may leave) | ✓ that group only, max 30 adds/day | ✓ | 403 |
  | Make or remove a leader | 403 | 403 | step down themselves only (stay a member) | ✓ | 403 |
  | Create, rename, move, archive | 403 | 403 | 403 | ✓ | 403 |

  "Staff with power over the group": staff at the group's campus; for a church-wide group (no
  campus), only staff with no campus limit. Campus-limited staff are ordinary members of church-wide
  groups. Only staff see members' email and phone; leaders do not. A campus group's finder and
  adds offer only people at that campus (or with no campus); church-wide groups use the viewer's
  campuses. Group rosters never include health data, notes, birthdate or household. Adults only for
  now (a child, anyone with a school grade, or under 18 by birthdate can't be added). Archived
  groups are hidden from everyone but staff, with their chat. Audited: `group.create`,
  `group.archive`/`unarchive`, `group.member_add`/`member_remove` (including leaving),
  `group.leader_add`/`leader_remove`. A leader who adds more than 30 people in 24 hours gets a
  kind 429 (counted from the audit log). Merging two people moves group memberships (keeping
  leadership) and serving campuses to the kept person. Leaders who aren't staff need three letters
  to search the finder and get at most 60 searches an hour. Campus and adult checks apply when
  someone joins, not to existing members (so a leader can still step down after moving campus).
  Push notifications for small-group chats never include the message text ("New message. Open the
  chat to read it."), since these chats carry prayer and pastoral news. Open chat pages stop
  receiving a small-group chat's messages as soon as the viewer is removed or the group archived;
  if that check fails, it fails closed. Not done yet (owner decision): closing open live streams
  when someone signs out, is deactivated, or has their role changed.
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
