# Feature inventory

What already exists, where it lives, what it replaces, and how sure we are that it works. **Check
here before building anything**: most "new" ideas extend something below.

**Status** (Chief Architect's audit and QA run of 26 November 2026, against the code on
`milestone-1`, which is **not deployed yet**; the live site still runs `main`):

| Status | Means |
|---|---|
| **Verified** | Built, covered by automated tests, and seen working end to end by QA (made-up data, a laptop browser and a phone-sized screen) |
| **Needs more testing** | Built and tested automatically, but parts must still be tried by hand or on real phones |
| **Partial** | Some of it is built; the rest is planned |
| **Not built** | Not in the code (see [roadmap.md](roadmap.md)) |
| **Needs outside setup** | Built, but only works once an outside account or setting is in place (named in the row) |

"Verified" never means tried with real church data, real email inboxes or real phones: those
checks are in [beta-readiness.md](beta-readiness.md) §A–C and the owner's
[leadership preview checklist](leadership-preview.md#b-personal-testing-checklist).

Replaces: **FT** Faith Teams · **SS** Subsplash · **GC** Google Chat.

## People and church structure (FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| People and households, photos, statuses, duplicate merge, CSV import/export | Verified. The real Faith Teams export hasn't been imported yet (rehearsal on a copy first: [beta-readiness.md](beta-readiness.md) §C) | `routes/people.js`, `csv.js` | `pages/people.js`, `person.js` |
| People list and person page on a phone: search first with the filters behind a button, compact rows with a call link, Export in a "…" menu; the person page reads summary, Family, Teams and serving, Attendance, with empty profile sections folded into one Profile card and Merge duplicate in a "…" menu (admin only). The person page says "Family" where the data says household | Verified (`npm run test:ui` at phone size) | unchanged | `pages/people.js`, `pages/person.js`, `profile.js` |
| Custom profile fields (milestones, classes, leadership track) with visibility; Spiritual journey checkboxes | Verified | `routes/fields.js` | `pages/person.js`, `settings.js` |
| Campuses, rooms, church settings, brand colour, app icon | Verified | `routes/setup.js` | `pages/settings.js` |
| Accounts, roles, campus limits (including campus-limited admins), Finance/Announcements/Kids' check-in flags, sign-in policy | Verified | `auth.js`, `routes/setup.js` | Settings → Sign-in & accounts |
| Global search (Ctrl/⌘K) | Verified | `routes/search.js` | `js/search.js` |
| New sign-ups from the app, connect cards, follow-up lists | Verified | `routes/app.js` | `pages/connect.js` |
| Dashboard (Home: greeting, this week's services, open spots, away this week; Accept / Can't make it on your next times serving). Phone: More sheet in the bottom bar | Needs more testing | `routes/dashboard.js` | `pages/home.js` |
| Member directory | Not built (Stage 2) | | |

## Planning and volunteers (FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Teams, positions, leaders, rosters | Verified | `routes/teams.js` | `pages/teams.js`, `team.js` |
| Repeating services (series), skips, per-service needs. Before deleting, ending or resetting positions on services with volunteers scheduled, the confirm says how many are scheduled (and accepted) and what happens to them; unchanged when nobody is | Verified. Known: a new service starts on "Every week", and a duplicate service on the same day isn't warned about New service asks “How often” (One time or Repeats, nothing pre-selected) and the repeat interval appears only for Repeats. On phones the service page puts Lock and Details in a “…” menu. | `routes/series.js`, `services.js` | `pages/services.js` |
| Order of service (Faith Teams style), locking, templates with fill-in slots | Verified | `routes/services.js`, `templates.js` | `pages/service.js`, `templates.js`, `js/plan.js` |
| Songs with keys; charts, lyrics and audio files | Verified | `routes/services.js`, `songfiles.js` | `pages/songs.js`, `js/songfiles.js` |
| Scheduling: candidates, conflicts, away dates, per-volunteer campus eligibility (empty list = home campus only; no list and no home campus = any campus, shown as "campus not set"), autofill (one team at a time: a Fill open spots button on each team in Who's serving, and Fill the month on the schedule once a team is picked; nobody is told until Send), month matrix, drafts → send requests, decline reasons shown under the Declined badge on Who's serving (to leaders only, as the API sends them), “Remind N who haven’t replied” (12-hour limit; upcoming services only; the automatic reminder skips anyone nudged in the last 6 hours), Message team | Verified. Drag and drop on the month grid still to be tried by hand | `routes/services.js` | `pages/schedule.js`, `js/scheduling.js` |
| Accept/decline in app and by email link; reminders; leaders hear declines; “Please reply” requests listed first | Verified. Email needs the SMTP settings on Render (Needs outside setup) Member app Home shows a “Please reply … Tap to reply” card first when a request is waiting; More folds the notification choices under one row. | `notify.js`, `routes/app.js` | `js/myschedule.js`, `respond.html` |
| Volunteers answering from a push notification | Needs more testing (never tried on real phones) | `push.js` | `sw.js` |
| Recurring availability ("not on the first Sunday") | Not built (deferred until the worship team says it's needed) | | |
| Swaps between volunteers | Not built (Stage 2) | | |

## Attendance (FT) and kids' check-in (replaces Subsplash check-in)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Roll call by spotters (a New guest runs the normal duplicate check and asks “Is this the same person?” before adding); attendance reports; headcounts | Verified (attendance trends: Not built) | `routes/attendance.js`, `checkin.js` | `pages/attendance.js`, `js/rollcall.js` |
| Kids' check-in flow: rooms by age/grade, allergies, security codes, check-out, check-in access per account | Verified, **but not used for the beta**: check-in stays on Subsplash until the separate child-safety release | `routes/checkin.js`, `js/checkin-rules.js` | `checkin.html`, `js/checkin.js` |
| Name-tag printing | Needs more testing (not tried with a real printer) | `routes/checkin.js` | `js/checkin.js` |
| Child-safety V1 (unique pickup codes, custody alerts, full audit) | Partial: the plan is written; these requirements are not built ([plans/child-safety](plans/child-safety/README.md)) | | |
| iPad stations paired with a code | Needs more testing (pairing a real iPad not tried) | `routes/stations.js` | `pages/stations.js` |

## Communication (GC, SS)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Team chats and groups: replies, @mentions, reactions, files, live updates | Verified (adult direct messages: Not built, Stage 2) | `routes/chat.js`, `live.js` | `js/chat.js`, `pages/chat.js` |
| Small groups: roster, leaders, group chat that follows the roster and is private to members, members see "My groups" (adults only) | Verified (meeting attendance, finder and join requests: Not built, by design for now) | `routes/groups.js` (+ `chat.js`) | `pages/groups.js`, `pages/group.js`, `member/main.js` (More) |
| Tasks: personal/team/chat, checklists, comments, repeats, reminders | Verified | `routes/tasks.js` | `js/tasks.js`, `pages/tasks.js` |
| Video calls and meetings in chats (Daily, monthly minute limit) | Needs outside setup (Daily account key) | `routes/calls.js`, `daily.js` | `js/chat.js` |
| Notifications inbox, push (accounts and guests), email, preferences | Inbox: Verified. Push: Needs more testing on real phones. Email: Needs outside setup (SMTP) | `notify.js`, `push.js`, `mail.js` | bell, `js/push.js` |
| Announcements with audiences and scheduling | Verified (create, schedule, cancel). Real pushes need phones with notifications on; a scheduled announcement actually going out hasn't been watched yet The audience starts on the campus chosen in the top bar (Everyone when none); “Volunteers” is explained as everyone with an account who is on at least one team. | `routes/announcements.js` | `pages/announcements.js` |
| Text messages (SMS) | Not built (would need a paid provider: owner decision) | | |
| Church-wide email | Not built (Stage 2) | | |

## Member app (SS)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Sign-in, profile, Serve tab (My Schedule, plans, all services), Tasks, Chat, More | Verified at phone size in both themes | (shared) | `member/main.js` |
| Installable app (home screen), own address | Needs more testing (install on real iPhones and Android phones by hand) | `routes/app.js` | `member/*` |
| Widget home screen (drag, sizes, styles, pictures) and App Builder | Needs more testing (App Builder editing not tried by QA) | `routes/app.js`, `js/app-widgets.js` | `member/home-edit.js`, `pages/appbuilder.js` |
| Events calendar with RSVP and questions | Verified (sign-ups not tried by QA in this round) Member app: one Campus dropdown and a “Show service times” switch. | `routes/events.js` | `member/events.js`, `pages/events.js`, `event.js` |
| Paid event sign-ups | Needs outside setup (Stripe) | `routes/events.js`, `stripe.js` | `member/events.js` |
| Next-service countdown, Latest message widgets | Verified | | `member/widgets.js` |

## Giving (SS, FT)
Not part of the staff beta. Giving data is only ever shown to accounts with the **Finance** flag,
even admins.

| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Online giving (card, ACH, wallets, cover fee, recurring, guests), funds | Needs outside setup (Stripe); never tested with live payments | `routes/giving.js`, `stripe.js` | `js/give.js`, `give.html` |
| My giving, statements; cash/check batches; year-end statements; finance dashboard and weekly view | Needs outside setup (Stripe for online gifts; Finance flag) | `routes/finance.js` | `pages/giving.js` |

## Media (SS)
Not part of this migration (Stage 3).

| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Media library from YouTube: hourly sync, filled in from the order of service, own titles/trims/tags | Needs outside setup (YouTube key) | `media.js`, `routes/media.js` | `pages/media.js`, `media-item.js` |
| Watch tab: latest, series, search, filters, video pages; live detection and "We're live" | Needs outside setup (YouTube or Mux) | | `member/watch.js`, `js/video.js` |
| Mux streaming: permanent stream key, live in our own player, recordings, real trims | Needs outside setup (paid Mux account) The developer setup steps are folded under “Setup steps for whoever manages hosting”; Media opens on Library once a channel or Mux is connected. | `mux.js` | Media → Setup |
| Upload past services to Mux (single and bulk) | Needs outside setup (Mux) | `mux.js` | `js/mux-upload.js` |
| Podcast feed from Mux audio | Needs outside setup (Mux) | `podcast.js` | Media → Podcast |

## Operations
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Basic forms: staff set up simple forms (questions, contact fields, who's told), people fill them in on a phone from a link (guests or signed-in), staff read responses, mark done, export CSV; one model, not a form builder | Verified | `routes/forms.js`, `questions.js` | `pages/forms.js`, `member/forms.js` (`/app/#/form/:slug`), app More tab |
| Help page: short how-to guides by role (reply to a request, away dates, schedule people, remind, team chat, small groups, feedback, check-in access, getting help); hub `#/help` and app More → Help | Needs more testing | | `pages/help.js`, `help-content.js`, `member/main.js` |
| Feedback from staff and leaders (hub page and app More menu), admin triage with status, "You said, we did" | Verified | `routes/feedback.js` | `pages/feedback.js`, `member/main.js` |
| Unlinked accounts tell the office; admins link accounts to people by hand (nothing links by email or name; audited; one account per person, with an audit script and a Settings warning for duplicates) | Verified | `routes/setup.js`, `db.js`, `scripts/audit-account-links.js` | `pages/settings.js`, `myschedule.js` |
| Nightly encrypted backups to disk and Google Drive; restore script with `--check`; offline mode and [restore drill](restore-drill.md) | Needs outside setup (`MB_BACKUP_PASSWORD` on Render, Google Drive connected); the Backups page itself is verified | `backup.js`, `routes/backups.js` | `pages/settings-backups.js` |
| Settings → Checks: yes/no production checks for admins (test sign-in off, `MB_TRUST_PROXY`, backups, email, sign-in policy, admins, one account per person; the admin's own address as the server sees it) | Verified | `routes/checks.js` | `pages/settings.js` |
| Appearance: Light, Dark or Match my device (saved per person); time-of-day greeting from the device's clock | Verified | `routes/setup.js` (`/me`) | `app.js`, `greeting.js` |
| Demo data (made-up people, for developers; refuses to run on Render or over real data) | Verified | `scripts/seed-demo.js` | `npm run demo` |

## Not built yet (see [roadmap.md](roadmap.md))
Discipleship (growth pathway, mentors) · Small-group meetings with attendance, finder and join
requests · Classes/training with watch-to-the-end and quizzes · Member directory and member tier ·
Adult direct messages · Church-wide email · SMS · Attendance trends · Recurring availability ·
Swaps · Public website · Website embed for the Watch library · Multi-church (SaaS).
