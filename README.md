# Meadowbrook Church Hub

One system for running Meadowbrook Church across all of our campuses: people and families,
service planning, volunteer scheduling, attendance and kids' check-in today, with discipleship,
team chat, the website/app and giving to follow. It replaces Faith Teams, Google Chat, Subsplash
and our discipleship tracking, one phase at a time.

It is a web app. Staff use it on a computer, volunteers on their phones, and the welcome desks
on tablets. Everyone signs in with a Google account (church or personal).

![Home](docs/home.png)

| | |
|---|---|
| ![Scheduling volunteers](docs/scheduling.png) | ![Kids check-in](docs/checkin.png) |

<sub>Screenshots from `npm run demo`, which uses made-up people.</sub>

## Roadmap

| Phase | What it covers | Replaces | Status |
|---|---|---|---|
| **1. People & planning** | People and households, campuses, teams, service plans and songs, volunteer scheduling, attendance, kids' check-in with name tags | Faith Teams | **Built** |
| 2. Discipleship | Growth pathway and next steps, mentor pairs with meeting logs, small groups, new-guest follow-up | (new) | Next |
| 3. Team communication | Team spaces and direct messages, tasks from chat, a Google Meet button per space | Google Chat | Planned |
| 4. Website & member app | Public website, sermons, events, connect forms, an installable member app | Subsplash | Planned |
| 5. Giving | Online giving with Stripe, funds, year-end statements | Subsplash Giving / Faith Teams giving | Planned |

## Try it (no setup needed)

You need [Node.js 22.13 or newer](https://nodejs.org).

```bash
npm install
npm run demo
# open http://localhost:8090
```

The demo fills a separate database (`data/demo.db`) with **made-up** families, two campuses,
teams, songs, services and six weeks of attendance. Sign in with any of these (no password in
demo mode):

| Email | Access |
|---|---|
| `pastor@meadowbrook.church` | Admin, all campuses |
| `south@meadowbrook.church` | Staff, South campus only |
| `volunteer@meadowbrook.church` | Volunteer, sees their own schedule |

## What's in Phase 1

**Home**: this week's services at each campus, open volunteer spots, who's declined or not yet
replied, who's away, and your own next times serving.

**People**: everyone, in households. Search by name, email or phone. Each person shows their
family, the teams they serve on, their schedule, and kids' check-in history. Includes allergies
and medical notes, authorized pickup people, photos, duplicate detection and merging, and CSV
export.

**Profile fields**: track milestones and growth on each person's profile: **New birth**
(Repented → Baptized → Received the Holy Ghost), **Baptism date**, **Holy Ghost date**,
**Classes completed** and **Leadership track** to start with. Add your own fields in
**Settings → Profile fields**: dates, yes/no, steps, several choices, text or numbers, grouped into
sections, with optional staff-only visibility. Filter **People** by any field (for example
"New birth: Baptized" or "Baptism date: no answer yet"). Imports fill them too: a CSV column
named like a field ("Baptism Date") maps to it automatically.

**Campuses**: every person, team, service time, kids' room and check-in belongs to a campus.
Staff can be limited to their own campus. The campus picker in the sidebar filters every page.
Adding a new campus is just **Settings → Campuses → Add campus**.

**Teams**: teams (Worship, Kids, Hospitality, Production…) with positions, and a roster grid of
who serves in which position: tick a box to change it. Add several people at once. Teams are
either per campus or church-wide. Team leaders can schedule their own team.

**Services**: a month calendar (or list) of every service at every campus. **New service**
creates a one-off service or a **repeating** one (every week, every 2 weeks…) with the positions
it needs, and the calendar fills itself in. When you change or delete a repeating service you
choose **just this one** or **this and all following**. The pencil and trash buttons in the
**Repeating services** list edit a whole series (time, length, title, end date, template, positions)
or delete it from a date on; past services and their attendance stay. Each service has:
- an **order of service**, laid out like Faith Teams: minutes, start–end time, type
  (Announcement, Song, Offering, Prayer, Message…), name with details, and who's leading. Add rows
  from the bar at the bottom; songs are found by typing a few letters, and new songs can be
  created there. Edit and delete buttons appear on the right of each row (deleting can be undone).
  Drag to reorder, copy from another service, or print. Mark a section **"the service starts
  here"** and the rows above it (huddle, countdown) count down to the start time.
- **Who's serving**: every team at the campus is listed (teams with nothing needed yet are dimmed); filter to one or more teams. *Schedule someone* lists only the people
  assigned to that position, best choices first: not away, not already serving at the same time
  **at any campus**, and not overused lately. **Fill open spots** does this for the whole service
  at once.
- **Templates** (Planning → Templates, staff only): reusable orders of service such as "Sunday
  Morning". Mark the rows that change each week (speaker, songs, announcements) as **Fill in each
  week**; on a service they show as *Needs filling* until someone fills them in, and the calendar
  marks services that still have empty slots. Start a new service from a template, use one on an
  existing service (**Use a template**), save a finished service as a template, or link a template
  to a repeating service so every new date arrives already laid out.
- **Lock**: staff can lock a service once it's final, so only admins can change its order of
  service and schedule. **Settings → Sign-in & accounts** also sets who can edit orders of service
  and who can schedule.
- **Attendance**: a **roll call** for the attendance team. Tap people (or **Mark family**) as you
  see them, on a phone or computer, and add new guests on the spot. Room headcounts are there
  too. The Attendance page lists who **hasn't been here in 3+ weeks** and **first-time guests**,
  and each person's profile shows their attendance history.

**Schedule** (Planning → Schedule): schedule a team a month at a time. Pick a repeating service
(e.g. North · Sunday 9:00 AM) and a team to see every position down the side and that month's
services across the top. Pick someone from the team list (it shows how often each person serves
that month and when they're away), then click open spots to place them, or drag them onto a
spot. **Fill the month** fills every open spot for that team, avoiding people who are away or
already serving then and giving people weeks off where it can. Click a name to see their reply
or remove them.

**My Schedule**: volunteers accept or decline (with a reason), mark dates they'll be away, and
open the order of service for anything they're on.

**Songs**: the song library with keys, CCLI numbers, and when each song was last used.

**Attendance**: weekly headcount, kids checked in, and volunteers serving, per campus.

**Kids Check-in** (`/checkin`, for tablets at the welcome desk):
- Find a family by the last 4 digits of a parent's phone or by last name, tick the kids, and
  check in. Each child goes to the right room by grade or age, and you can override it.
- Prints a **name tag** for each child (name, room, allergy warning, pickup code) and a
  **parent pickup tag** with the same code.
- **Check out** by typing the code from the parent's tag. It shows who is allowed to pick up.
- **Rooms**: a live list of who's in each room, with allergies.
- **Works offline.** The tablet keeps a copy of the family list. If the internet drops, it keeps
  checking kids in and printing tags, then uploads everything when the connection returns,
  never counting anyone twice.
- New families and children can be added right at the desk (needs internet).

## Going live

We run one server in the cloud so every campus reaches it the same way, and a power cut or
internet outage at one campus never takes down another. A small server is plenty: 1 CPU, 1 GB
memory, about $6–25/month.

### 1. Google sign-in

Do this once, signed in as a Google Workspace admin:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project called
   "Church Hub".
2. **APIs & Services → OAuth consent screen** → choose **External**, so volunteers can sign in
   with personal Gmail accounts too, then **Publish app** (Audience → *In production*). The hub
   only asks for name and email, so Google doesn't require a review. Pick **Internal** instead
   only if everyone will use a church Google account.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → **Web
   application**.
   - Authorized redirect URI: `https://YOUR-ADDRESS/auth/google/callback`
     (for example `https://hub.meadowbrook.church/auth/google/callback`)
4. Copy the **Client ID** and **Client secret** into the settings below.

### 2. Settings

Copy `.env.example` to `.env` (or enter these in your host's dashboard):

```
PUBLIC_URL=https://hub.meadowbrook.church
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_WORKSPACE_DOMAIN=meadowbrook.church
MB_ADMIN_EMAILS=you@meadowbrook.church
```

Never set `MB_DEV_LOGIN` on the live server.

### 3. Run it

The repo includes a `Dockerfile`. Any host that runs Docker with a **persistent disk** mounted at
`/data` works, for example:
- **A small VPS** (DigitalOcean, Linode, Hetzner): install Docker, then
  `docker build -t church-hub . && docker run -d --restart=always -p 8090:8090 -v /srv/church-hub:/data --env-file .env church-hub`,
  and put [Caddy](https://caddyserver.com) in front for automatic HTTPS
  (`hub.meadowbrook.church { reverse_proxy localhost:8090 }`).
- **Render, Railway or Fly.io**: create a web service from this repo, attach a disk at `/data`,
  and add the settings above.

Without Docker: `npm ci --omit=dev && npm start`.

On Render, Railway or Fly.io, set `MB_TRUST_PROXY=1` so the app knows it is behind their HTTPS
proxy. Elsewhere, set it to the proxy's address if the proxy isn't on the same machine or
private network.

### 4. Backups

Everything lives in one database file plus an `uploads` folder of photos. `npm run backup`
saves a safe copy while the server is running and keeps the last 30. Run it daily (for example
with cron: `15 3 * * * cd /app && npm run backup`), and copy `data/backups` somewhere off the
server, such as a Google Drive folder or your host's snapshot feature.

### 5. First-time setup

1. Sign in with an admin email.
2. **Settings → Church**: confirm the name and pick your brand colour.
3. **Settings → Campuses**: add each campus.
4. **Settings → Import people**: export your people from Faith Teams as CSV and import it. Run a
   **test import** first. Re-importing updates people rather than duplicating them, so you can
   keep Faith Teams running alongside until you switch over.
5. **Teams**: create teams and positions, and add members.
6. **Templates**, then **Services → New service**: build a template for your usual order of
   service, then add your regular services as repeating services that start from it, with the
   positions each one needs.
7. **Settings → Check-in & attendance**: pick your label printer and add kids' rooms with their
   age or grade ranges.
8. **Settings → Sign-in & accounts**: give staff and team leaders the right access. By default
   anyone with a Google account can sign in and starts as a volunteer, who sees only their own
   schedule. **Who can sign in** can limit this to people in the directory, church accounts, or
   invited accounts only.

### Check-in tablets and printers

- Any iPad, Android tablet or laptop with a modern browser works. Open `/checkin`, sign in with
  a **leader** account, choose the campus and a station name, and leave it signed in.
- Label printers that work well from a browser: **Brother QL-810W/820NWB** with DK-1209
  (62 × 29 mm) labels, or **DYMO LabelWriter 450/550** with 30252 labels. Pick the size in
  Settings → Church.
- For printing without a print dialog, use the tablet's kiosk or "silent printing" option where
  it has one (for example, Chrome's `--kiosk-printing` on a laptop).

## Who can do what

| | Volunteer | Leader | Staff | Admin |
|---|:-:|:-:|:-:|:-:|
| Own schedule, accept/decline, away dates | ✓ | ✓ | ✓ | ✓ |
| Order of service for services they serve at | ✓ | ✓ | ✓ | ✓ |
| See people, teams, all services; run check-in; add new families | | ✓ | ✓ | ✓ |
| Schedule their own teams, edit orders of service | | ✓ | ✓ | ✓ |
| Edit people, services, rooms; schedule any team | | | ✓ | ✓ |
| Settings, campuses, accounts, import, merge duplicates | | | | ✓ |

Any account can be limited to some campuses.

## For developers

- Node.js 22.13+, Express, and SQLite through Node's built-in `node:sqlite`, so there is
  nothing native to compile. The front end is plain JavaScript modules with no build step.
- `server/`: `db.js` (schema and migrations), `auth.js` (Google sign-in, sessions, roles),
  `routes/` (one file per area).
- `public/`: `app.html` + `js/app.js` (shell and router), `js/pages/*` (one per page),
  `checkin.html` + `js/checkin.js` (the tablet app). `js/checkin-rules.js` is shared by the
  server and the tablets.
- Database changes go in a **new** entry at the end of `MIGRATIONS` in `server/db.js`. Never
  edit one that has shipped.
- `npm run dev` runs with test sign-in and auto-restart. `npm test` runs the test suite.
- Every API change requires the `x-mb: 1` header, which blocks cross-site request forgery.
