# Personal testing and leadership preview

For the owner: how to test the Church Hub yourself on the live site, then show it to church
leadership in 30–45 minutes. This is the current milestone, **"Personal Testing & Leadership
Preview"** ([master roadmap](master-product-roadmap.md)). Status of every module:
[features.md](features.md). Stage gates: [beta-readiness.md](beta-readiness.md).

Every menu name and button below is taken from the code on `milestone-1` (26 November 2026). Until
the deploy, the live site still runs the older `main` code, so some of these (Settings → Checks,
Feedback, Groups, Forms, the new look) only appear after the deploy.

**Contents:** [a. How you'll test](#a-how-youll-test) ·
[b. Personal testing checklist](#b-personal-testing-checklist) ·
[c. Leadership demo guide](#c-leadership-demo-guide-3045-minutes) ·
[d. Likely questions](#d-likely-leadership-questions) ·
[e. One-page overview](#e-one-page-feature-overview) ·
[f. Known issues](#f-known-issues-and-limitations) ·
[g. Next steps](#g-recommended-next-steps-after-leadership-reviews-it)

---

## a. How you'll test

**Where.** On the existing live Church Hub (the same Render service, database and accounts), once
you have approved the deploy of `milestone-1` and it has gone live
([deploy-runbook.md](deploy-runbook.md)). There is no separate test site or demo environment: you
decided to keep everything in the one Church Hub. Developers test on their own laptops with
temporary made-up people (`npm run demo`), never with church data.

**Which account.** Your own admin account, for almost everything. Two things depend on open
decisions in [roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation):

- **Decision 16: seeing other roles.** The hub has no "view as" button; to see what a campus admin,
  staff member, leader or volunteer sees, you need to be signed in as one.
  - *If you approve test accounts on live:* in **Settings → Sign-in & accounts → Add account**, add
    one account per role with an email address you can read (one per role; a Gmail address with
    `+leader`, `+staff` and so on works for emailed codes). Give each a clearly named People record
    ("Test Leader") and link it with **Link to person…**, because a schedule only shows for a linked
    account. Set **Access** and **Campuses** as the role needs. Leader access also comes
    from ticking **Leader** on a team roster. Sign in as each one in a private browser window, so
    your own session stays signed in. Afterwards, untick **Can sign in**, press **Delete account**,
    and **Archive this person** on each test record.
  - *If you'd rather use real staff:* ask a staff member or leader to sign in on their own device
    and show you their screen. Don't sign in as them.
  - Rows in the checklist marked "needs another role" wait for one of these.
- **Decision 15: real member information on screen.** See the tips in [section c](#before-the-demo).

**Staying safe on live.** Requests, reminders, announcements, connect cards and chat messages reach
**real people** by email, push notification and the bell. So:

1. **Make a test team with only you on it.** **Teams → New team**, name it "TEST – please ignore",
   your campus. Add only yourself to the roster and tick **Leader**.
2. **Make a test service with only that team.** **Services → New service**: your campus, a date
   in the next week or two, **Repeats: Does not repeat** (it starts on "Every week": change it),
   **Title** "TEST – please ignore". Schedule only yourself.
3. **Before any "Send" button, read the list.** Send requests shows every name it will contact;
   it should be only yours. An announcement asks "goes to N people": it should be 1.
4. **Announcements: never "Everyone".** Choose **A team** and tick only your test team.
5. **Never on the Schedule page with "All teams"** when you press Send requests; pick your test team.
6. **Don't** add a test campus (campuses can't be deleted and show in the app), change
   **Settings → Church** or **Sign-in & accounts**, press **Save changes** in **App Builder**, or
   check in real children.
7. Other leaders at your campus will see the test service in their **Services** list and on
   **Home** under "This week's services". The title tells them to ignore it; a quick heads-up to
   staff helps.

**"Reset the demo data" and "shut down the test environment".** Neither applies: there is no demo
data and no separate environment on the live site. Instead, clean up what you made:

| You made | Clean up |
|---|---|
| Test service | Open it → **Details** → **Delete service** (its plan and schedule go with it) |
| Test team | Open it → **Edit team** → tick **Archive this team** → Save (teams are archived, not deleted) |
| Test small group | **Edit group** → tick **Archive this group** |
| Scheduled announcement | **Announcements → Sent and scheduled → Cancel**. One already sent can't be recalled, which is why it goes only to your test team |
| Test form | Untick **Open for responses**; delete test responses with the bin icon (admins) |
| Test connect card | **Connect cards** → bin icon (**Delete**) |
| Test people | **Archive this person** at the bottom of their page (people are archived, not deleted) |
| Test accounts | Untick **Can sign in**, then **Delete account** |
| Away dates you added | **My schedule → Dates I'm away** → bin icon |

---

## b. Personal testing checklist

Most important first. Use a computer for Settings and scheduling, and your phone where it says so.
"You (admin)" is your own account. On a phone, the hub's bottom bar shows Home, Schedule, Chat,
People, Services and Check-in; other pages are under the search button at the top.

### 1. Accounts, permissions and campus limits
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Settings → Sign-in & accounts**: read **Accounts with more access** | Only people who should have leader, staff or admin access; the Campuses column says "All" only for people who cover every campus | Someone has more access than they need, or "All" where they serve one campus | You (admin) |
| Same page: **Who can sign in** | "Only accounts an admin adds below" | Any other option (checklist [1.13](beta-readiness.md#1-required-before-deployment)) | You (admin) |
| Same page: **Accounts not linked to a person** | Empty, or people you can link with **Link to person…** | Someone is linked to the wrong person | You (admin) |
| Open an account in the list | Finance, Announcements and Kids' check-in are ticked only where intended | Finance on anyone who shouldn't see giving | You (admin) |
| Sign in as campus-limited staff | Only their campus's people and services; the campus picker doesn't offer other campuses; no Settings in the menu | They see another campus's people | Needs another role |
| Sign in as a campus-limited admin | As above; Settings shows only Campuses, Check-in & attendance, Sign-in & accounts and Checks; they can't make anyone an admin or give Finance or Announcements | Church-wide Settings tabs, or other campuses' accounts | Needs another role |
| Sign in as a leader | People, Teams, Schedule for their own teams; on a person's page no medical notes, private notes or pickups | Health data or another campus visible | Needs another role |
| Sign in as a volunteer | Home, My schedule, Chat, Tasks, Help, Groups, Services, Feedback; no People or Settings | They can open People or Settings | Needs another role |

### 2. People and households
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **People**: search a name, try the filters (Everyone, Members, Guests, Adults & kids) | Results appear as you type | Missing people, or wrong counts | You (admin) |
| **Add person** "Test Person", then on their page **Start household** | The page shows the household; **Edit** lets you change details | Saving fails, or the household doesn't appear | You (admin) |
| Add a second "Test Person", then on the first one **Merge duplicate** | One record remains | Both remain, or the wrong one was kept | You (admin) |
| **Export** on People | A CSV file downloads | No file, or names missing | You (admin) |
| Afterwards: **Archive this person** on each test record | They leave the list | | You (admin) |

Please don't open medical or private notes for real people during testing unless you need to.

### 3. Campuses
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Settings → Campuses**: read the list | Each campus with its short name, address and time zone | A campus is missing or has the wrong time zone | You (admin) |
| Change the **Campus** picker at the bottom of the sidebar | People, Services and Attendance show only that campus | Another campus's items still show | You (admin) |

Don't add a test campus: campuses can't be deleted.

### 4. Teams and leaders
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Teams → New team** "TEST – please ignore" | The team opens | | You (admin) |
| **New position** "Tester"; type your name in the roster box; tick your **Tester** box and **Leader** | You're on the roster with a Leader badge | Ticks don't stay after reloading | You (admin) |
| **Message team** | Opens the team's chat, with only you in it | Others are in it | You (admin) |

### 5. Services
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Services → New service** (see "Staying safe" step 2). Under **Positions needed**, put 1 Tester | The service opens on **Details** | It was created as repeating (check **Repeats**) | You (admin) |
| **Order of service** tab: add a few items, or start from a template | Items save and can be reordered | Items disappear on reload | You (admin) |
| Back on **Services**, switch **Month** / **List** | The test service shows on its date | It shows on the wrong day or campus | You (admin) |

### 6. Schedule and open positions
| Do | Expect | Problem if | Account |
|---|---|---|---|
| Test service → **Who's serving**: the Tester spot shows **Schedule someone** | An open spot | | You (admin) |
| Press **Fill open spots** | You're added, marked **Not asked yet** | Anyone else is added | You (admin) |
| Remove yourself (✕), then **Schedule someone** and pick yourself | Same result, by hand | | You (admin) |
| **Schedule** page: pick your test team under **Team** | The month grid shows the test service and you | Other teams' people appear while the test team is picked | You (admin) |
| On **Home**, look at "This week's services" | The test service shows "open" or "Fully scheduled" | Counts don't match the service | You (admin) |

Volunteers can't pick up open spots themselves yet; a leader or staff member schedules them.

### 7. Requests: accept and decline, by email and in the app
| Do | Expect | Problem if | Account |
|---|---|---|---|
| Test service → **Send 1 request** | The dialog lists **only your name**; press **Send to 1 person** | Any other name: press Cancel | You (admin) |
| Open the email on your phone; tap **Accept** | A page "Hi …, can you serve?" → **Yes, I'll be there** → "You're confirmed" | No email within a few minutes (check spam), or the link says it isn't valid | You (admin), phone |
| Back in the hub, remove and re-add yourself, send again; this time tap **Can't make it** → **Let my leader know I can't make it** | The service shows **Declined** | Still **Waiting** | You (admin), phone |
| Send once more; in the app on your phone, **Serve** tab → **Accept** (or **Can't make it**) | The request is under **Please reply**, then moves to **Coming up** | It isn't listed | You (admin), phone |
| A leader hearing about a decline | Leaders and whoever sent the request get "… can't make it". You won't get one for your own reply; seeing it needs a second person on the test team | | Needs another role |

### 8. Reminders (only to yourself)
| Do | Expect | Problem if | Account |
|---|---|---|---|
| Send yourself a request and don't answer. On the service, press **Remind 1 who hasn't replied** → **Send reminder** | "Reminded 1 person" and a reminder arrives | It says more than 1 | You (admin) |
| Press it again straight away | "Everyone was already reminded in the last 12 hours" | A second reminder arrives | You (admin) |
| Automatic reminder: accept a test service dated within the next day or two | A reminder arrives about the number of hours set in **Settings → Church → Remind volunteers before they serve** (read it; don't change it; if it says "Don't send reminders", skip this row) | Nothing arrives, or two arrive | You (admin) |

### 9. Chat
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Chat** → the test team's chat: send a message, a reply and a photo | They appear at once | Delays, or the photo fails | You (admin) |
| Same chat open on your phone and computer | A message from one appears on the other without reloading | Needs a reload | You (admin), phone |
| Don't post in real team chats while testing | | | |

### 10. Announcements (only to yourself)
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Announcements**: title "TEST", **Send to: A team**, tick only the test team. Read the line under it | It reaches 1 person | More than 1: stop | You (admin) |
| **When: Later**, pick a time in 10 minutes, **Schedule** | Listed under **Sent and scheduled** as Scheduled | | You (admin) |
| **Cancel** it | It shows Canceled and never arrives | It arrives anyway | You (admin) |
| Schedule another for 5 minutes ahead and leave it | It arrives on your phone and in the bell | It doesn't arrive (this hasn't been watched before) | You (admin), phone |

### 11. Forms
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Forms → New form** "TEST", **Tell this person about new responses**: you; add a question; **Create form** | A link to share appears; **Copy link** | | You (admin) |
| Open the link on your phone, not signed in; fill it in | A thank-you; you get a notice (never the answers) | The form won't open on the phone | Phone, signed out |
| **Responses**: read it, **Done**, **CSV** | It's listed; the CSV downloads | | You (admin) |
| Untick **Open for responses** | The link stops working | It still opens | You (admin) |

### 12. Connect cards
**Heads-up:** a connect card notifies every staff member and admin at that campus. Tell staff
first, and use the name "Test – please ignore".

| Do | Expect | Problem if | Account |
|---|---|---|---|
| In the app (`/app/`), the **Connect** tab (or More, or the "I'm new here" button), fill in a card with a prayer line | "Thank you, …!" | An error | Phone |
| **Connect cards → To follow up** | The card is there with the message | Missing | You (admin) |
| A leader opens Connect cards | They see the card but **not** the prayer message | They can read the message | Needs another role |
| **Followed up**, then delete it (bin icon) | It leaves the list | | You (admin) |

### 13. Small groups
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Groups → New group** "TEST"; add yourself; **Make leader** | You're listed as Leader | | You (admin) |
| **Group chat** | A chat with only the group's people | Others are in it | You (admin) |
| In the app: **More** | "My groups" lists the test group | Missing | You (admin), phone |
| A non-member tries to open the group chat | They can't | They can read it | Needs another role |
| **Edit group** → **Archive this group** | Hidden, and so is its chat | | You (admin) |

### 14. Attendance
| Do | Expect | Problem if | Account |
|---|---|---|---|
| Test service → **Attendance** tab: **Take attendance**, find yourself, mark yourself here; open **Headcount** and enter a number | Saved ("Headcount saved") | Saving fails | You (admin) |
| **Attendance** page | Weekly table per campus; "Haven't been here in 3+ weeks" and "First-time guests this month" | Numbers clearly wrong | You (admin) |

Mark only yourself on the test service, so real attendance stays accurate. Deleting the test service
removes it.

### 15. Kids' check-in permissions
Kids' check-in itself **stays on Subsplash for the beta**. Here you only check who could open it.

| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Settings → Sign-in & accounts**: look for the **Check-in** badge | Only on children's ministry leaders who must have it, or none | Anyone else | You (admin) |
| A leader **without** the tick opens **Kids Check-in** | It refuses and tells them to ask the office | They see families or allergies | Needs another role |
| **Check-in iPads** (under More) | Only iPads you recognise | Unknown stations: **Remove** them | You (admin) |

Don't check real children in or out on the live site.

### 16. Member login and app on a phone
| Do | Expect | Problem if | Account |
|---|---|---|---|
| On your phone, open the hub's address followed by `/app/` | The church app opens | Blank page or an error | Phone |
| **More → Sign in**: **Sign in with Google**, or **First time, or forgot your password? Email me a code** | The code arrives within a minute; you're signed in | No code, or it lands in spam | You, phone |
| Add it to your home screen: iPhone in Safari, Share → **Add to Home Screen**; Android, **Add to home screen** | It opens full screen with the church's icon | Opens in a browser tab | Phone |
| **My schedule** in the hub (or the app's notifications card): turn notifications on, **Send a test** | A test notification arrives | Nothing (iPhone needs the home-screen app, iOS 16.4+) | You, phone |
| Try each tab, and **More → Help** and **Send feedback** | Readable, nothing cut off | Text cut off or overlapping | You, phone |

### 17. Settings → Checks
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Settings → Checks** | "Nothing here blocks real use"; every row Yes, or Check with a reason you understand | Any **No** (see [runbook → first hour](deploy-runbook.md#the-first-hour)) | You (admin) |
| Compare **Your address as this server sees it** with a "what is my IP" website | They match | They differ (`MB_TRUST_PROXY`) | You (admin) |

### 18. Backups
| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Settings → Backups** | "Backups are locked with your password", Google Drive connected, a recent last backup | Any of the three missing | You (admin) |
| **Back up now**, then **Download** the newest copy | A file downloads; keep it on your own computer, not a shared drive | It fails | You (admin) |
| The restore drill ([restore-drill.md](restore-drill.md)) | Done with the developer before the deploy | | You + developer |

### 19. Dark mode and the greeting
| Do | Expect | Problem if | Account |
|---|---|---|---|
| Click your name (bottom of the sidebar; top right on a phone) → **Appearance**: Light, Dark, **Match my device** | The look changes at once and is remembered next time | Unreadable text, or it forgets | You (admin) |
| In the app: **More → Appearance** (tap to cycle) | Same three choices | | Phone |
| **Home** in the morning, afternoon and evening | "Good morning", "Good afternoon" (from 12:00), "Good evening" (from 17:00), from your device's clock | The wrong greeting for your time | You (admin) |

The sign-in page follows your device's dark mode until you choose a theme.

### Reporting an issue
Use the hub's **Feedback** page (or **More → Send feedback** in the app): choose what kind, how much
it matters ("Blocks Sunday" for anything that would stop a service), and say what happened. It
records the page you were on. Or tell the developer the **page**, the **steps** you took, and a
**screenshot**. Leave out names and private details of real people.

---

## c. Leadership demo guide (30–45 minutes)

### Before the demo
- **Decision 15 (real member information).** Until you decide, assume leadership should see as
  little private detail as possible:
  - Do the scheduling, chat, announcement, groups and forms parts on your **test team and test
    service**.
  - Open **your own** People record, not someone else's; never open medical notes, allergies,
    private notes or pickups.
  - Don't open **Kids Check-in** (it lists children and allergies), **Roll call** on a real
    service, or **Connect cards** with real prayer requests. Use your own test card.
  - The People list shows names and photos; scroll past it rather than reading it.
  - Turn off notifications on the presenting computer, so a real chat message doesn't pop up.
- Get ready the day before: test team and service with you scheduled and a request sent (so
  **Please reply** shows on your phone), a test form, a test group, a test connect card, the app
  installed on your phone.
- Present from a computer; mirror your phone for section 8 if you can.
- **Be honest.** What's verified, what needs more testing and what's planned are in the
  [one-page overview](#e-one-page-feature-overview). If a question touches something unfinished,
  say so.

All sections use **your admin account** unless they say otherwise.

| # | Section | Where to go, what to click | What to show | What leadership should understand | Time |
|---|---|---|---|---|---|
| 1 | Why we're building it | No screen, or **Home** | One sentence per tool: Faith Teams (people, scheduling), Google Chat (team chat), Subsplash (app, kids' check-in, media) | One system the church owns, built around how Meadowbrook works, replacing three paid tools step by step | 3 min |
| 2 | Admin dashboard | **Home** | The greeting, the four numbers (People, Members, New guests, Open volunteer spots), "This week's services" with open spots, "Away this week" | A leader sees the week at a glance: who's missing, what's open | 3 min |
| 3 | People and households | **People** → search your own name → your page | Search, filters, your household, "Can serve at", Teams, Scheduled to serve. Mention **Merge duplicate** and **Export** | One directory for every campus; families kept together; leaders don't see health or private notes | 4 min |
| 4 | Teams and volunteers | **Teams** → your test team | Positions, the roster ticks, the Leader tick, **Message team** | Leaders manage their own teams; leader access follows the roster | 3 min |
| 5 | Service scheduling | **Services** (Month) → test service → **Order of service**, then **Who's serving**; then **Schedule** with the test team | Plan items, **Fill open spots**, **Send requests** (show the list with only you), **Remind … who haven't replied**; the month grid. On your phone, the email's **Accept** button | Volunteers answer from an email or the app, no account needed for email links; leaders hear declines; no double-booking; campus rules respected | 6 min |
| 6 | Communication and announcements | **Chat** → test team chat; **Announcements** | A message arriving on your phone; the announcement form with **A team** → test team, the "reaches 1 person" line, **Later**, then **Cancel** | Team chat replaces Google Chat; announcements go to the people chosen, with the count shown before sending | 4 min |
| 7 | Small groups | **Groups** → test group | Roster, **Make leader**, **Group chat**; "My groups" in the app | Basic groups now: roster and a private chat. Meeting attendance, finder and join requests come later | 2 min |
| 8 | Member app | Your phone: the installed app (or `/app/`) | **Home**, **Serve** (Please reply, Accept, Dates I'm away), **More** (Help, Send feedback, Appearance). Tab names may differ if they were changed in App Builder | Installs from the browser like an app, no app store; free; push notifications on iPhone and Android | 5 min |
| 9 | Connect cards and forms | **Connect cards** (your test card only); **Forms** → test form → **Copy link**, open on the phone | A card arriving, **Followed up**; a form filled in on a phone without an account; **Responses** | First-time guests and sign-ups land in one place for follow-up; prayer messages stay with staff | 3 min |
| 10 | Attendance and kids' check-in | **Attendance**; test service → **Attendance** tab; **Settings → Sign-in & accounts** (the Check-in badges); **Check-in stations** | Weekly numbers, roll call on your test service, who may use check-in. Don't open Kids Check-in | Attendance is in the hub now. Kids' check-in is built but **stays on Subsplash** until a separate safety release (unique pickup codes, custody alerts, full audit) is finished, piloted and approved | 3 min |
| 11 | Security, permissions and campuses | **Settings → Sign-in & accounts**, **Settings → Checks**, **Settings → Backups** | Roles (Volunteer, Leader, Staff, Admin), campus limits, the Finance flag, the Checks list, nightly encrypted backups | Each person sees only what their role and campus allow; giving is visible only to Finance; backups are locked and copied off-site | 4 min |
| 12 | Future opportunities | [Roadmap](master-product-roadmap.md) §7 and §12 | The beta dates; Stage 2 ideas (member directory, adult messages, church-wide email, swaps, attendance trends) | Leaders' feedback shapes what comes next; nothing is built that isn't needed | 3 min |

**Short version (30 minutes):** shorten sections 3, 4, 7 and 9 to a minute each.

**State it plainly:**
- **Works today (verified with test data):** people and households, campuses, teams, services and
  orders of service, scheduling with email and app replies, reminders, team chat, announcements,
  basic small groups, forms, connect cards, attendance, accounts and campus limits, Checks.
- **Needs more testing:** push notifications and installing on real phones, email in real inboxes,
  the real Faith Teams import, the dashboard and Help, name-tag printers, iPad stations.
- **Planned, not built:** the kids' check-in safety release, member directory and member tier,
  adult direct messages, church-wide email, SMS, recurring availability, swaps, attendance trends.
- **Built but needs outside accounts, not in the beta:** online giving (Stripe), media and
  streaming (YouTube, Mux), video calls (Daily).

---

## d. Likely leadership questions

| Question | Answer |
|---|---|
| **What does it cost?** | The hub runs on one small server at Render, the hosting the live site already uses (the README estimates $6–25 a month for a server this size). Google sign-in, Google Drive backups and the automated tests on GitHub use free tiers. Development uses the owner's existing Claude subscription, with no extra billing. No new paid service is added without the owner's approval. Optional later costs: Stripe keeps a small part of each online gift, Mux video is about $15–55 a month, and SMS would need a paid provider. Savings come as Faith Teams, Google Chat and Subsplash are retired. |
| **Who owns the data?** | The church. Everything is in one database on the church's own server disk, not in a vendor's system. People can be exported to a spreadsheet at any time, and the code is in a repository the owner controls. |
| **What about backups?** | Every night after 3 a.m. the hub makes a copy, locked with a password only the church holds (AES-256), and sends it to a Google Drive folder. It keeps the last 14 nightly copies plus one a month for a year. Admins can press **Back up now**. A restore drill proves a copy really opens before the first deploy. |
| **Is it private? What about children?** | Each role sees only what it needs; leaders don't see medical notes, private notes or pickup lists; campus-limited accounts see only their campus; giving needs a separate Finance flag, even for admins; connect-card prayer requests are staff only. Small groups are adults only, and minors won't have accounts in Stage 1 (recommended; decision 8). Kids' check-in stays on Subsplash until a separate safety release with unique pickup codes, custody alerts and a full audit is built, piloted and approved. |
| **What happens to Faith Teams and Subsplash?** | They keep running alongside. Each ministry leaves Faith Teams only when its own work runs in the hub, one full cycle has run in parallel, nothing "blocks Sunday", and its leader agrees. Google Chat retires team by team after 4+ weeks in the hub. Subsplash check-in goes off around mid-June 2027 after a pilot; Subsplash media stays until Stage 3. |
| **What's the timeline?** | Staff beta from mid-December (after the deploy is approved), a freeze from 19 December to 3 January, worship and production in late January, other ministries February to early March and after Easter. Kids' check-in pilot from about 21 February. These are expected dates; they move with review time and real Sundays, not coding. |
| **Who maintains it?** | The owner, working with an AI-assisted development team (Claude Code) that writes, tests and reviews changes. Nothing reaches the live site without the owner's approval. It is plain JavaScript with one outside library and a written knowledge base, so another developer could take it on. Being a small team is a real risk; backups, tests and the docs are how we reduce it. |
| **Does it handle several campuses?** | Yes. Campuses, campus-specific services and rooms, campus-limited staff and admins, and per-volunteer serving campuses for teams shared across campuses. Running it for other churches is a later idea, only by owner decision. |
| **Does it work on phones?** | Yes. The member app installs from the browser onto the home screen (no app store), with push notifications on Android and on iPhone (iOS 16.4+, once added to the home screen). Volunteers can also just use the email links. Testing on real phones is part of the staff beta. |
| **What about giving?** | Online giving is built (card, bank, Apple/Google Pay, recurring, statements) but needs a Stripe account and has never taken a live payment. It isn't part of the beta; giving stays where it is for now. |
| **Can it send text messages?** | Not yet. SMS would need a paid provider, which is an open owner decision. Today it's push notifications, the in-app inbox and email. |

---

## e. One-page feature overview

Keep this beside you during the demo. Full detail: [features.md](features.md).

| Area | Status | In the beta? |
|---|---|---|
| People, households, profile fields, search | Verified (real Faith Teams import still to rehearse) | Yes |
| Campuses and campus limits | Verified | Yes |
| Accounts and permissions | Verified | Yes |
| Teams, positions, leaders | Verified | Yes |
| Services, orders of service, templates, songs | Verified | Yes |
| Scheduling, requests, email and app replies, reminders | Verified (push on real phones: needs more testing) | Yes |
| Team chat and tasks | Verified | Yes |
| Announcements | Verified (real pushes need phones) | Yes |
| Small groups (basic) | Verified | Yes, adults only |
| Forms | Verified | Yes |
| Connect cards | Verified | Yes |
| Attendance and roll call | Verified (trends not built) | Yes |
| Feedback and Help | Verified / needs more testing | Yes |
| Member app on phones | Verified at phone size; install and push need real phones | Yes |
| Settings → Checks | Verified | Yes |
| Backups | Needs outside setup (password, Google Drive) | Before the deploy |
| Kids' check-in | Flow verified; safety release not built | No, stays on Subsplash |
| Events | Verified (paid sign-ups need Stripe) | Not a focus |
| Giving | Needs outside setup (Stripe) | No |
| Media, streaming, podcast | Needs outside setup (YouTube, Mux) | No |
| Video calls | Needs outside setup (Daily) | No |
| Member directory, adult messages, church-wide email, SMS | Not built | Stage 2 or later |

---

## f. Known issues and limitations

**Not being fixed now** (documented; tell testers):
- **Campus-limited admins can send announcements to the whole church** (QA-6). Existing behaviour;
  an open owner decision ([permissions.md → Campus-limited admins](permissions.md#campus-limited-admins),
  roadmap decision 13).
- **Duplicate services aren't warned about** (QA-7): two services at the same time and campus can be
  created. Check the calendar first.
- **A new service starts on "Every week"** (QA-10). Choose **Does not repeat** for a one-off.
- **Dark mode follows each person's saved choice**, not the phone's setting, unless they pick
  **Match my device**.
- Account management is easier on a laptop; on a phone the **Settings → Accounts** table scrolls
  sideways inside its card.

**Fixed before this preview** (found by QA and the security review, merged into `milestone-1`, #76):
- Child safety: campus checks on the kids' pickup-person routes and on moving people between
  households; below staff, someone can join an existing family only as a child, so nobody can be
  added as a pickup adult without staff; household and pickup changes are audited.
- The access dialog no longer allows "All campuses" plus a campus at once.
- Settings, App Builder, Giving and Announcements show "You don't have access to this page" to
  people without access; check-in setup lists only campuses you can use.
- Validation of dates, email and name length; clearer "Fill the month" messages; phone layout
  touches; dark mode on the sign-in page.

**Your decisions** (safe defaults are in place; see [roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation)):
whether leaders and the check-in desk may add children to existing families (allowed today);
whether pickups should be listed explicitly instead of every adult in the family; whether
campus-limited staff may create families with no campus (they show at every campus).

**Not built or needs outside setup:** see the last rows of the [overview](#e-one-page-feature-overview).
Also never tried for real: email in real inboxes, push on real phones, Google sign-in on the live
server, Google Drive backups, name-tag printing, iPad station pairing, Stripe payments, Mux,
App Builder editing, event sign-ups, and a scheduled announcement actually going out.

---

## g. Recommended next steps after leadership reviews it

These follow the beta stages in [beta-readiness.md](beta-readiness.md) and
[roadmap §7](master-product-roadmap.md#7-beta-plan). The owner decides each one.

1. **Record leadership's feedback** on the Feedback page or in [feedback.md](feedback.md), each
   marked Blocks Sunday, Slows me down or Nice to have. The Product Manager sorts it into now,
   next and not now.
2. **Decide 15 and 16** (real information in demos; test accounts on live), plus 8 (no minors with
   accounts) and 9 (the staff beta group, a feedback triage person, a Sunday contact).
3. **Finish the deploy gate** ([beta-readiness §1](beta-readiness.md#1-required-before-deployment)):
   the restore drill, the account review, and your
   written approval of a deploy window outside 19 December – 3 January, not a Saturday evening or
   Sunday.
4. **Staff beta (about 8 staff), mid-December:** accounts added and linked, a 30-minute
   walkthrough, real-phone and email checks ([§A](beta-readiness.md#a-real-device-checks),
   [§B](beta-readiness.md#b-email-delivery)). Tell staff what isn't in the beta: kids' check-in,
   giving and media.
5. **Freeze, 19 December – 3 January:** nothing new.
6. **Worship and production, late January:** after two weeks of staff use with nothing open that
   blocks Sunday, the Faith Teams import rehearsal, and leader permission checks.
7. **Other ministries, February to early March, then after Easter**, one champion per ministry,
   leaving Faith Teams one workflow at a time.
8. **Kids' check-in:** a separate decision on the child-safety release (decision 10), then a pilot
   campus from about 21 February.
