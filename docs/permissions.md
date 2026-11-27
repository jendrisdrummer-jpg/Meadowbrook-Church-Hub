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
accounts → "Accounts not linked to a person", or the account's "Link to person…"). Nothing links by
name, email or any other guess: no automatic link by exact email, no link from the sign-in policy,
none from team leadership, imports, connect cards or forms. Every link and unlink is audited
(`user.link`, `user.unlink`, with the admin who did it). Accounts already linked stay linked.

**One person, one account.** Every write that sets a person on an account refuses with 409 when
another account already has that person (admin link, adding an account, merging two people who both
have accounts). The database enforces it too, once no duplicates exist: see
[account-links.md](account-links.md) for the audit script and what to do about duplicates.

An unlinked account sees "We've let the church office know", which calls `POST /me/link-request`;
admins get one notification per account per week.

### The sign-in policy decides who may sign in, not who they are

| Policy | May sign in | New account |
|---|---|---|
| Anyone | Anyone who can verify an email | Created as a volunteer, **unlinked** |
| People in the directory | Someone whose email is in People (or in the Workspace domain) | Created as a volunteer, **unlinked** (the directory is only checked to allow sign-in) |
| Workspace domain | Only the church's Google Workspace domain | Created as a volunteer, **unlinked** |
| Invited only | Only accounts an admin added | n/a |

`MB_ADMIN_EMAILS` and the first admin on a fresh install also start unlinked when their email is in People (otherwise they are a brand-new person, below). The only account that
is born linked is someone brand new to the church (their email is not in People, sign-ups are open):
the app adds them to People as a new person flagged "signed up from the app", and links the account to
that new person. It never attaches to an existing person, and a matching email or name only means a
new account that waits for an admin. Someone with a matching email in People signs in unlinked and sees
"We've let the church office know" until an admin links them. Settings → Accounts suggests that person (exactly one non-archived person with the same email, inside the admin's reach) with a one-click, confirmed link; the link is the ordinary admin action and nothing is linked automatically ([account-links.md](account-links.md#suggestions-serverlink-suggestionjs)).

Leading a team gives leader access to the person's account if they have a linked one; it no longer
creates an account. When an admin links an account to someone who already leads a team, the same rule
applies at that moment, also when an admin creates a linked account with Volunteer access (audited as `user.leader_auto`), unless the admin changes the access to something else in the same save.
Unlinking takes back leader access only if it came from leading a team; access set by hand stays.

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
**Empty families** (`GET /households/empty`, `POST /households/empty/remove`, admins only, campus-limited admins only for households at their own campuses, not church-wide ones): lists and removes households with no people at all (archived people count), no pickup people, no notes and no other table pointing at them. Removal is explicit (confirm naming the count), skips any family that gained a member since the list, runs in one transaction and is audited as `household.remove_empty` (ids and count).
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
| Edit **their own** phone and birthday (More → My info; saved straight to their People record), and, for an adult in a household, that household's home address (it changes for the whole family), and send a “Tell the office” note. A teen whose record is a child can change their phone only, not their birthday (age decides check-in rooms). Never email, family, role, status, campus or notes: see `routes/me.js` | ✓ | ✓ | ✓ | ✓ |
| Order of service for services they serve at; all services in the app | ✓ | ✓ | ✓ | ✓ |
| Chat with their teams and groups; tasks | ✓ | ✓ | ✓ | ✓ |
| See their own small groups: names and photos of the roster, and the group chat (members only) | ✓ | ✓ | ✓ | ✓ |
| Create, edit, archive small groups and set their leaders (at their campuses) | | | ✓ | ✓ |
| See people, teams, attendance; run check-in (with the Kids' check-in switch); add families; connect cards | | ✓ | ✓ | ✓ |
| Start chat groups; schedule their teams; edit orders of service and songs | | ✓ | ✓ | ✓ |
| Edit people, households, services, rooms, templates; schedule any team | | | ✓ | ✓ |
| Events, Forms, Media, check-in stations | | | ✓ | ✓ |
| Media → Setup (channel, messages playlist, skip rules, hide videos not in the playlist): church-wide, so only an admin who covers every campus changes it; staff can read it | | | | ✓ (every campus) |
| App Builder (open it, save the app, upload its pictures) | Only with the **Edit the app** flag (any role) | | | ✓ (always) |
| Settings, campuses, accounts, profile fields, import, merge duplicates, backups, reset Mux key | | | | ✓ |

### Team leaders and other teams

A leader who isn't staff sees **full detail only for the teams they lead** (`team_members.is_leader = 1`):
declined people and their reasons, drafts not yet sent, member phone and email on the team page, away
reasons, open spots. For every other team they see what a volunteer sees: people who were asked and
haven't declined, names and photo only, with no needed counts. Not limited: `GET /people` and search
still return every person (with their contact details) at the leader's campuses, as leaders have always
had People; the limit is on the team page and on away reasons. The helper is `server/team-scope.js` (`ledTeamIds`, `seesTeamDetail`,
`ledPositionsClause`); staff and admins are unlimited (campus scoping still applies). This is about
what can be *seen*; who may *schedule* is still `canSchedule` and the `schedule_role` setting.

| Where | A leader sees for a team they don't lead |
|---|---|
| `GET /services/:id` | Volunteer view of its rows; needed count hidden; the team is left out when nothing is visible; each position has `detail: true/false` |
| `GET /services` | `needed`, `filled`, `accepted`, `declined` count only their teams |
| `GET /services/:id/candidates` | 403 for a team they neither lead nor may schedule |
| `GET /schedule` | Only their teams; `team_id` of another team is 403; `led_team_ids` lists theirs |
| `GET /dashboard`, `GET /attention` | Needs, counts and away dates for their teams' members only |

Home's attention counts (`attention()` in `dashboard.js`) are limited to the person's campuses and, for a leader who isn't staff, to the teams they lead. Connect cards and app sign-ups use the same filters as their pages (leader+, campus-scoped). New form responses are counted for staff only, and only on forms they manage (`manages()` in `forms.js`: church-wide forms need an account with no campus limit). Volunteers get zeros.

| `GET /people/:id` (upcoming) | A row only if it's their team, or it was sent and not declined |
| `GET /people/:id` (away dates) | Dates always; the `reason` only when the person is on a team the leader leads |
| `GET /teams/:id` | Members' `email` and `phone` only for teams they lead; likewise `reachable` (yes or no: a request would arrive by email or in the app) and `unreachable_reason` (`no_contact`: no email and no account; `notices_off`: emails and schedule notices both turned off; never an address), which would otherwise hint at a missing email |
| `PUT /teams/:id/members/:personId` | 403 for a person at a campus outside the leader's campuses (no campus is fine) |
| `POST /services/:id/assignments` | `allow_other_campus` works only for staff and up, or an account with no campus limit |
| `POST /services/:id/remind` | Without `team_id`, nothing they may remind gives `{reminded: 0, skipped: 0}`, not 403 |
| Decline notifications | The person who sent the request hears of a decline only while they still lead that team or are staff |

## Campus-limited admins

An admin whose `campus_ids` is a list (not NULL) manages their own campuses and nothing wider. An admin
with no campus limit keeps every power, exactly as before. The server enforces all of this (the
Settings and person-page dialogs hide what would be refused and say "Some options are for admins who
cover every campus."). Code: `accountInReach` and `requireAllCampuses` in `server/auth.js`,
`scopePatch` in `routes/setup.js`.

**Accounts in reach.** For a limited admin with campuses C, an account is in reach when it is not
their own, is not an admin, and is either a volunteer who is unlinked or linked to a person at a
campus in C or with no campus yet (as elsewhere, unassigned people are open to every campus; giving
them more access still needs a campus list inside C), or a leader or staff account whose own campus list is set and sits inside C. Everything
else is out of reach: 403 on change, delete and check-in grants, and left out of Settings → Accounts
(the main list, "not linked" and "more than one account").

Also out of reach: any account holding Finance or Announcements (church-wide), a volunteer whose own campus
list reaches beyond C (for example staff who stepped down at another campus), and deleting an account whose
email is in `MB_ADMIN_EMAILS` (its next sign-in would make it an admin again).

**What they can't do** (403 with a kind message; a value the dialog re-sends unchanged is fine):
- change their own role, campuses, Finance, Announcements, "Can sign in" or check-in, link or unlink
  their own person, or delete themselves ("Ask an admin who covers every campus to change your own access.");
- make anyone an admin, or give or take Finance, Announcements or Edit the app (giving, announcements and the app are church-wide). They may give or take Attendance for accounts in reach, with a campus list inside their own campuses (403 outside);
- set campuses to "all" or to a campus outside C. Leader and staff accounts always end up with a campus
  list inside C: left out on create, or when promoting someone with no list, it becomes C.

**Team-leader rule.** When a campus-limited actor (an admin linking an account, staff or a leader changing a team, or a merge) makes someone an automatic leader, the account's campus list ends up inside the actor's campuses: the person's campus if it's one of theirs, otherwise their campuses, and an existing list that reaches further is narrowed the same way. An unrestricted actor keeps the older behaviour. The narrowing is audited (`user.leader_auto` records the campus list before and after) and stays if they later stop leading. Open questions for the owner: (1) accept that narrowing, or skip such promotions instead; (2) accounts holding Finance, Announcements or Edit the app are out of reach for campus-limited admins even inside their campuses (safe default); (3) campus-limited admins can still send announcements to the whole church (existing behaviour; their own power, not a grant). Also: campus-limited staff can make someone from another campus a leader of one of their own teams (teams can be shared across campuses); the access granted stays inside the staff member's campuses.

**Merging people** moves the duplicate's account to the kept person, so a limited admin can't merge
when that account is out of reach.

**Church-wide admin routes** are for admins with no campus limit (`requireAllCampuses`):

| Route | Scope | Limited admin |
|---|---|---|
| `PATCH /settings` | Church-wide (sign-in policy, domain, code cap, reminders, name, brand, name tags, headcount areas) | 403 (Settings hides those forms and says so; kids' rooms for their campus stay editable) |
| `POST /app-icon/:size`, `DELETE /app-icon` | Church-wide (the installed app's icon) | 403 |
| `POST /campuses` | Church-wide (creates a campus) | 403 |
| `PATCH /campuses/:id` | Campus-scoped | Own campuses only |
| `POST`, `PATCH /profile-fields`, `PUT /profile-fields/order` | Church-wide (every profile) | 403 |
| `GET /backups`, `POST /backups/run`, `GET /backups/:id/download`, `DELETE /backups/drive`, Google Drive sign-in | Church-wide (a backup holds every campus) | 403 |
| `POST /import/preview`, `POST /import/people` | Church-wide (can create and update people at any campus) | 403 |
| `POST /media/mux/reset-key` | Church-wide (the live-stream key) | 403 |
| `GET /users`, `POST`, `PATCH`, `DELETE /users/:id` | Accounts | Accounts in reach only, rules above |
| `POST /people/:id/merge` | Campus-scoped | Both people in their campuses, and the duplicate's account in reach |
| `PATCH /feedback/:id` | Campus-scoped | Own campuses and feedback with no campus |
| `DELETE /admin/form-responses/:id` | Campus-scoped (the form's own rules) | As the form allows |
| `GET /admin/production-checks` | Read-only server status, no secrets | Allowed |

Read-only exposure that remains: a person's page shows their account (email, role, campuses, flags) to
any leader or above who can see that person, and the Checks page and account counts are church-wide.
Both leave the account itself unchangeable.

Older behaviour, not changed: a volunteer who becomes an automatic leader through an unrestricted
admin or an unrestricted actor keeps no campus list, so sees every campus.

## Permission flags (on top of the role)

| Flag | Grants | Notes |
|---|---|---|
| `finance` | Giving: gifts, donors, funds, batches, statements, finance dashboard (`requireFinance`) | **Never implied by role, not even admin.** Giving data is seen only by people explicitly given Finance. |
| `announce` | Sending announcements to the congregation | Admins always have it. |
| `app_editor` | Editing the member app: opening the App Builder, saving the app’s tabs and home screen (`PUT /app/config`) and uploading its pictures (`POST /app/images`), guarded by `requireAppEditor` (`canEditApp`). The Settings label is **Edit the app**. | Admins always have it (`user.appEditor`). **Staff no longer edit the app by role**: an admin turns the flag on for anyone who needs it, whatever their role (migration 38 adds it off for everyone). Reading the app’s public config (`GET /app/config`) is unchanged and open to everyone. The App Builder link in the hub menu shows only to those who can use it. Granting it is church-wide, like `announce`: only an admin who covers every campus can give or take it (403 for a campus-limited admin), an account holding it is out of a campus-limited admin’s reach, and every change is audited (`user.update`, `user.create` with “+ edit the app”). |
| `attendance` | Taking attendance: the roll (`GET`/`POST /services/:id/roll`), new guests (`POST /services/:id/roll/guest`), headcounts (`PUT /services/:id/headcounts`) and the Take attendance services list (`GET /attendance/services`), for services at the account's campuses (`requireAttendance` + `canAttendCampus`) | For volunteer-level accounts; leaders and above already can, so it changes nothing for them. Opens nothing else: People, schedules, reports (`/attendance/people`, `/attendance/weekly`, a person's history) and kids' check-in (`canCheckin`, its own switch) keep their own guards. On a church with more than one campus the account must have a campus list (400 otherwise), and with none it fails closed (403). No time limit on past services; a change made after the service's own date is audited (`attendance.correct`, `headcount.correct`). New guests: a new family, or a child into a family already on that roll (never an adult), name-only duplicate check, 30 a day per account (429). A campus-limited admin can grant or take it inside their own campuses. |

## Campus limits

`users.campus_ids` (JSON list, or NULL for all campuses). Routes use `canCampus(user, id)` for one
record and `campusFilter(user, column)` for lists. Any new campus-owned data must be filtered the
same way.

**Households** hang off a campus too. Every household-level route (`PATCH /households/:id`, adding a
pickup person, removing one) refuses a campus-limited user for a household at another campus (403);
moving or adding a person into a household checks the household's campus as well as the person's.
`GET /people/:id` leaves out the household (with its notes and pickup list) when it sits at a campus
the user can't reach. Pickup changes are audited (`pickup.add`, `pickup.remove`). Households with no
campus are open to everyone, as for people.

**Roll call.** `POST /services/:id/roll` with `present: true` checks every person ID first: the person
must exist, not be archived, and pass `canCampus` (people with no campus are open to everyone, as on
the roll list). Any failing ID refuses the whole request with 403 and marks no one. Unmarking
(`present: false`) is not checked, so a wrong mark can always be undone. Check-in stations act as
a leader limited to their own campus, so they follow the same rule.

**Adding people to an existing family.** Check-in treats every adult in a household as an approved
pickup, and only staff may grant pickups (audited). So below staff, including leaders and paired
check-in stations, `POST /people` with a `household_id` is allowed only for `household_role: 'child'`;
an adult (or no role, which means adult) gets a 403. A new family (`new_household: true`) is open to
them as before. Staff are unchanged. Every join is audited: `household.member_add` / `household.member_move`
(person, household ids from and to, role), plus `household.create` / `household.update` (fields, and
`from_campus` / `to_campus` when the campus changes). The duplicate check on `POST /people` only looks at
the caller's campuses; leaders and stations see just `{id, first_name, last_name}` in the 409, staff see
email, phone and birthdate. Merging refuses (403) to bring in a household at a campus the admin doesn't cover.

**Access dialog campuses.** In the account dialogs (person page, Settings → Accounts) "All campuses"
and specific campuses are mutually exclusive. The server takes `campus_ids` as `'all'` (or null) or a
non-empty list of campuses; an empty list is refused (400), duplicates collapse.

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
  voiding a check-in) is for **paired stations, staff and admins automatically**, and for **any other account
  (leader or volunteer) an admin has given the "Kids' check-in" switch** (Settings → Sign-in & accounts → the
  account; `users.checkin`, migration 43; `canCheckin` and `canCheckinCampus` in `auth.js`). Any admin may grant it, like
  Attendance; a campus-limited admin only inside their own campuses, and every change is audited (`user.checkin`).
  A volunteer-level account needs a campus list on a church with several campuses (400 otherwise, whether or not it is linked to a person), and with none it
  fails closed (403), like Attendance. Leaders keep their old meaning of no list (all campuses). Automatic leader
  access removed on unlink also clears the switch. **A station token wins over a hub session**: with a valid
  `x-station` header the request is the station's even if a session cookie is present (a removed token is 401). It sends
  **children's Level 1 safety line** (allergen words, EpiPen yes/no, one-line action) but never the longer medical note and never an adult's details, and no photos or adult birthdates; pickups are loaded for the campus's families only; roster and active are `no-store`. Every route checks the campus. A live check-out (`mode: 'request'`) is refused (409) for children of more than one family, for everyone including admins; an offline report is never refused but is recorded and flagged. The released-by identity comes from the paired station or session, not the request.
- **Medical details come in three levels** (migration 44). **Level 1** (`allergies`, `allergy_epi`, `allergy_action`): everyone using check-in,
  on the iPad and printed on the label. **Level 2** (`medical_notes`): fetched on tap with `GET /checkin/medical/:personId?campus_id=`, only online,
  for a child checked in at that campus today (not voided; once checked out, staff only; a child with no family must not belong to another campus),
  by a paired station or any account with check-in access at that campus; every view is recorded as a `medical.view` event (who and which child,
  never the text; `self_checkin` marks a read by whoever made that check-in); never printed or stored on the iPad. **Level 3** (`person_care_notes`):
  staff and admins in the Hub only (`GET`/`PUT /people/:id/care-notes`, checked against both the child's and the family's campus, opening and saving are audited, never the text); never sent to an
  iPad, the roster, the check-in record or a leader's view of the person. Editing the Level 1 fields and marking a child sorted is staff (`PATCH /people/:id`);
  the review list (`GET /checkin/medical/review`) is staff, scoped by the child's and the family's campus, audited (`checkin.medical.review`, a count), never an iPad. Leaders no longer see these fields on a person's page (as before).
- **Pickup codes** are a station letter plus four characters. Pairing assigns the letter (staff, within their campuses); no extra permission.
- **Voiding a check-in** (`POST /checkin/checkins/:id/void`) is for accounts signed in to the Hub, **never a paired iPad**, so the record always names a person; a reason is required. **Staff and admins** may void any check-in at their campuses; **anyone else with check-in access (the switch)** only one that is still open (not checked out) from today at that campus (403 otherwise). Nobody can
  delete a check-in (`DELETE` answers 405 and the database refuses). **The legal hold** (`POST /checkin/legal-hold` and `/release`) is for
  **admins who cover every campus** (`requireAllCampuses`), each time with a reason; campus-limited admins can see it but not change it. While
  it is on, voiding, merging people and disconnecting Google Drive are refused for everyone, and no backup copy is deleted.
- **The check-in record** (`GET /checkin/events`) is for **staff and admins at that campus** (`requireRole('staff')` plus
  `canCampus`). Never a station, and not a leader even with check-in access: the log names who released which child.
  **Check-in safety settings** (`/checkin/safety`) are for admins; reading is open to campus-limited admins, changing
  needs an admin with **all campuses** (`requireAllCampuses`), because the switch affects every campus's iPads. The setting
  is kept apart from `/settings` on purpose, so the general settings endpoint can't change it.
- **Holds** ("Hold: see coordinator", migration 45; `routes/checkin-holds.js`). **Placing, changing the note, lifting a hold and releasing a held child** are for
  **staff and admins who have check-in access at that campus** (`manages` = staff rank, not a station, `canCheckin`, then `canCheckinCampus` for the
  hold's campus, and `canCampus` for the child). A leader or volunteer with the Kids' check-in switch can't, and a paired iPad never can (403). **Reading** holds
  (`GET /checkin/holds`) is for those staff and for the **named safeguarding lead** (read only, any role, within their campuses); everyone else, and every iPad, gets 403.
  An iPad is told only that a child has a hold (`on_hold` on the roster and the active list), never the note. A held child can't be checked out by an iPad, a
  leader, staff or an admin at the check-out screen: **only staff in the Hub** release them (`POST /checkin/checkins/:id/release-held`, with a reason and who collected, audited).
  The **safeguarding lead** is a per-church setting (`checkin_safeguarding`, `PUT /checkin/safeguarding`: an admin who covers every campus; staff may read who is named).
  The lead is told in the Hub (and by email when email is set up) each time a hold is placed, changed or lifted, when a held child is released or an iPad's release
  was over a hold, and when an iPad tries to check out a held child (once per child per day). With nobody named, every active admin who covers all campuses is told instead (every active admin if none does). Phone pushes never name the child or collector. A report of a release (`mode: 'report'`, from an iPad or any account with check-in access) is never refused but is flagged to the lead with who reported it, including when a hold was placed after the time given. Saving the lead list keeps a named lead the account list doesn't show (for example a volunteer with no flags).
  Merging a duplicate who has a hold is refused (409) until the hold is lifted. **Who collected** (`checked_out_to_*`) is shown to staff and above on the person page, not to leaders.
- **Check-in settings** (`checkin_features` in `settings`; `server/checkin-settings.js`, `routes/checkin-settings.js`). **Reading** (`GET /checkin/settings`) is for anyone with check-in access (an iPad reads them through its token and on its roster);
  **staff in the Hub** get the whole thing (including `auto_team_ids`), and everyone else with check-in access (an iPad, the Kids' check-in switch, a leader of a chosen team) gets only what the iPad needs (`checkout`, `holds`, `medical_tap`, `label_overflow`);
  **changing** them (`PUT /checkin/settings`) is for **an admin who covers every campus** (`requireRole('admin')` + `requireAllCampuses`), never an iPad, a campus-limited admin or staff. The settings sit apart from `/settings`, so the general settings endpoint can't change them.
  Every change is audited with the old and new values (`checkin.settings`) and noted in the check-in record (`safety.settings`, which setting changed, never a team's or a person's name).
  **Making check-in less protective needs a reason and is never quiet.** That is: holds `block` to `alert`, anything to `off`, check-out becoming `tag`, `medical_tap` changing either way, or `auto_team_ids` changing (`weakenedSettings` in `checkin-rules.js`). The request needs a `reason` of 1 to 300 characters (400 otherwise), kept only in the audit entry (never in the record, a notification or an email), and the safeguarding leads (or every all-campus admin until one is named) **and** every active admin who covers all campuses are told through `tellLeads`, with a generic message that says what kind of setting changed and how many holds are on. The Hub card asks for the reason in a small prompt.
  - **`checkout: 'tag'`** (parents show their matching tag): `POST /checkin/checkout` answers an iPad, or a leader or volunteer signed in to a browser, **409 `checkout_off`** in every shape except a **report** of a release that already happened (an older iPad catching up), which is still recorded. Staff and admins in the Hub can still check out. `GET /checkin/active` adds `in_room`: with tags, a check-in is in the room only on its own campus-local day and until staff check it out in the Hub (queries, not rewrites; `checked_out_at` is never set for this and attendance counts are unchanged).
  - **`holds`**: `off`, `alert` or `block`. `block` can't be saved with `tag` (400). Until chosen on purpose the default is `block` with check-out on the iPad and `alert` with tags. `off`: the roster and active list carry no `on_hold`, new holds are refused (409), nothing is blocked or flagged, and existing rows are kept (lifting still works). `alert`: check-in works, the lead is told (in the Hub, by email, and by a generic push), and a live check-out of a held child is allowed but flagged (`checked_out_held`, `checkout.held_released` via `alert`) and sent to the lead. `block`: part 6, unchanged.
  - **`medical_tap: false`**: `GET /checkin/medical/:personId` is **403** (`medical_tap_off`) for every iPad and every account except **staff and admins** (the Hub's own reads).
  - **`any_campus`** (default off): **widens what an iPad's roster carries.** With it on, `GET /checkin/roster` includes every household (with its members' Level 1 and its pickups, as for local families), `POST /checkin/checkins` accepts a family assigned to another campus (the row keeps the iPad's campus; the household's campus is not changed), and the active list and the Care note work for those check-ins. Nothing else widens: an iPad still only reads its own campus's lists, and campus-limited staff still manage only their own campuses' people and households in the Hub (403 otherwise). Turning it on is a widening change like the weakenings above: **an admin who covers every campus only, with a `reason`, and the safeguarding leads and all-campus admins are told**. Turning it off needs neither.
  - **`label_overflow`** is not a permission; it only decides the words or size on a name tag.
  - **`auto_team_ids`** (default empty): **a permission.** A person (not archived) who **leads** (`team_members.is_leader`) a non-archived team on this list gets Kids' check-in as if they held the switch, **but only at the campus of the ticked teams they lead**: a team with a campus gives that campus, and a team with no campus means the account's own campus list (an account with no list on a church with several campuses gets nothing from it, so a leader with no list who leads only a church-wide ticked team has no access). The account's own list still limits it. This is worked out in `canCheckinCampus` only for access that comes from leading a team (`user.autoReach`); the manual switch is unchanged. It is computed lazily, once per request that needs it (`autoCheckin` and `autoReach` are memoized getters in `loadUser`, not part of `/me`) and **never written to `users.checkin`**, so it ends the moment they stop leading the team, the team is archived or an admin takes it off the list. Archiving a ticked team takes it off the stored list (audited, so unarchiving never revives the access); a team or campus that is deleted never counts and is dropped at the next save. The fail-closed rule for accounts below leader with no list is the same as the switch's. **Who can archive teams is unchanged** (an open question for the owner: today a team's leader or staff can). It opens Kids' check-in only: not holds (staff), the settings, the record, the safeguarding lead or voiding anything older than today. Each change to the list also has its own audit entry (`checkin.settings.auto_teams`, from and to), and **making someone a leader of a ticked team, or taking that away** (`PUT`/`DELETE /teams/:id/members/:personId`) is audited as `checkin.auto_grant` (`person_id`, `team_id`, `granted`) under the account that did it. `GET /me` reports `checkin: true` for them so the Hub shows the page.
  - **A hold at another campus.** `GET /checkin/holds?person_id=` for staff with check-in access at the child's or the family's campus, when the child has an active hold at a campus they can't read, returns `{ person_id, active: true, other_campus: true }` and nothing else (never the note, who placed it, or why); the person page shows "On hold (placed at another campus)" with "contact that campus's staff before releasing" and **no** Release button, and `POST /checkin/checkins/:id/release-held` is **403** for staff who can't manage the hold's own campus (`canCheckinCampus` for the hold's campus, as for lifting it). (Several check-ins for one child in a day, at one campus or two, were never refused by the server: check-ins, codes, clash flags, rooms and counts are all per campus and per service.) With holds **off**, an active hold is still shown on the person page ("Holds are switched off, so this hold isn't checked at the iPad") and can be lifted.
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

### How the interim check-in authorisation moved (migration 43)

The `checkin_user_ids` setting is gone from the code. Migration 43 added `users.checkin` and copied the grant: every
**leader** on the old list got the switch, so exactly the people who could use check-in the day before still can. Staff
and admins need no switch, and a volunteer on the old list never had access (they still don't until an admin switches them
on). The old settings row is left untouched and is no longer read. The "grants table" in the earlier plan was replaced by
this per-account switch (owner decision, 27 Nov 2026).

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
  if that check fails, it fails closed. Open live streams also close when someone signs out or is
  deactivated (#64), and every message re-checks the viewer's session and chat access before it is sent.
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
