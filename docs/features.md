# Feature inventory

What already exists, where it lives, and what it replaces. **Check here before building
anything**: most "new" ideas extend something below. Status: ✅ built and in use, 🟡 built but
needs setup or real-world testing, 💤 not built (see [roadmap.md](roadmap.md)).

Replaces: **FT** Faith Teams · **SS** Subsplash · **GC** Google Chat.

## People and church structure (FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| People and households, photos, statuses, duplicate merge, CSV import/export | ✅ | `routes/people.js`, `csv.js` | `pages/people.js`, `person.js` |
| Custom profile fields (milestones, classes, leadership track) with visibility; Spiritual journey checkboxes | ✅ | `routes/fields.js` | `pages/person.js`, `settings.js` |
| Campuses, rooms, church settings, brand colour, app icon | ✅ | `routes/setup.js` | `pages/settings.js` |
| Accounts, roles, campus limits, Finance/Announcements flags, sign-in policy | ✅ | `auth.js`, `routes/setup.js` | Settings → Sign-in & accounts |
| Global search (Ctrl/⌘K) | ✅ | `routes/search.js` | `js/search.js` |
| New sign-ups from the app, connect cards, follow-up lists | ✅ | `routes/app.js` | `pages/connect.js` |

## Planning and volunteers (FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Teams, positions, leaders, rosters | ✅ | `routes/teams.js` | `pages/teams.js`, `team.js` |
| Repeating services (series), skips, per-service needs | ✅ | `routes/series.js`, `services.js` | `pages/services.js` |
| Order of service (Faith Teams style), locking, templates with fill-in slots | ✅ | `routes/services.js`, `templates.js` | `pages/service.js`, `templates.js`, `js/plan.js` |
| Songs with keys; charts, lyrics and audio files | ✅ | `routes/services.js`, `songfiles.js` | `pages/songs.js`, `js/songfiles.js` |
| Scheduling: candidates, conflicts, away dates, autofill, month matrix, drafts → send requests | ✅ | `routes/services.js` | `pages/schedule.js`, `js/scheduling.js` |
| Accept/decline in app, push, email links; reminders; leaders hear declines | ✅ | `notify.js`, `routes/app.js` | `js/myschedule.js`, `respond.html` |

## Attendance and kids' check-in (FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Roll call by spotters; attendance reports; headcounts | ✅ | `routes/attendance.js`, `checkin.js` | `pages/attendance.js`, `js/rollcall.js` |
| Kids' check-in with rooms by age/grade, allergies, name tags, security codes, check-out | ✅ | `routes/checkin.js`, `js/checkin-rules.js` | `checkin.html`, `js/checkin.js` |
| iPad stations paired with a code | ✅ | `routes/stations.js` | `pages/stations.js` |

## Communication (GC, SS)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Team chats and groups: replies, @mentions, reactions, files, live updates | ✅ | `routes/chat.js`, `live.js` | `js/chat.js`, `pages/chat.js` |
| Tasks: personal/team/chat, checklists, comments, repeats, reminders | ✅ | `routes/tasks.js` | `js/tasks.js`, `pages/tasks.js` |
| Video calls and meetings in chats (Daily, monthly minute limit) | 🟡 | `routes/calls.js`, `daily.js` | `js/chat.js` |
| Notifications inbox, push (accounts and guests), email, preferences | ✅ | `notify.js`, `push.js`, `mail.js` | bell, `js/push.js` |
| Announcements with audiences and scheduling | ✅ | `routes/announcements.js` | `pages/announcements.js` |

## Member app (SS)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Installable PWA, own address, tabs, widget home screen (drag, sizes, styles, pictures) | ✅ | `routes/app.js`, `js/app-widgets.js` | `member/*`, `pages/appbuilder.js` |
| Serve tab (schedule, plans, all services), Tasks, Chat, More | ✅ | (shared) | `member/main.js` |
| Events calendar with RSVP, questions, paid sign-ups | ✅ | `routes/events.js` | `member/events.js`, `pages/events.js`, `event.js` |
| Next-service countdown, Latest message widgets | ✅ | | `member/widgets.js` |

## Giving (SS, FT)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Online giving (card, ACH, wallets, cover fee, recurring, guests), funds | ✅ | `routes/giving.js`, `stripe.js` | `js/give.js`, `give.html` |
| My giving, statements; cash/check batches; year-end statements; finance dashboard and weekly view | ✅ | `routes/finance.js` | `pages/giving.js` |

## Media (SS)
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Media library from YouTube: hourly sync, filled in from the order of service, own titles/trims/tags | ✅ | `media.js`, `routes/media.js` | `pages/media.js`, `media-item.js` |
| Watch tab: latest, series, search, filters, video pages; live detection and "We're live" | ✅ | | `member/watch.js`, `js/video.js` |
| Mux streaming: permanent stream key, live in our own player, recordings, real trims | 🟡 needs Mux account | `mux.js` | Media → Setup |
| Upload past services to Mux (single and bulk) | 🟡 | `mux.js` | `js/mux-upload.js` |
| Podcast feed from Mux audio | 🟡 | `podcast.js` | Media → Podcast |

## Operations
| Feature | Status | Server | Hub / app |
|---|---|---|---|
| Feedback from staff and leaders (hub page and app More menu), admin triage with status, "You said, we did" | ✅ | `routes/feedback.js` | `pages/feedback.js`, `member/main.js` |
| Unlinked accounts tell the office; admins link accounts to people by hand | ✅ | `routes/setup.js` | `pages/settings.js`, `myschedule.js` |
| Nightly encrypted backups to disk and Google Drive; restore script | 🟡 needs password + Drive | `backup.js`, `routes/backups.js` | `pages/settings-backups.js` |
| Demo data | ✅ | `scripts/seed-demo.js` | `npm run demo` |

## Not built yet (see [roadmap.md](roadmap.md))
💤 Discipleship (growth pathway, mentors, small groups with attendance) · 💤 Classes/training with
watch-to-the-end and quizzes · 💤 Public website · 💤 Website embed for the Watch library ·
💤 Multi-church (SaaS).
