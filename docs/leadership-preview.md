# Personal testing and leadership preview

For the owner: how to test the Church Hub yourself on the live site, then show it to church
leadership in 30–45 minutes. This is the current milestone, **"Personal Testing & Leadership
Preview"** ([master roadmap](master-product-roadmap.md)). Status of every module:
[features.md](features.md). Stage gates: [beta-readiness.md](beta-readiness.md).

**Refreshed 28 November 2026 for the leadership presentation on Tuesday 1 December 2026.** It
matches what is **live now**: `main` at `b7ae33e`, which includes deploys #119, #124, #129, #135 and
#144 ([merge-log.md](merge-log.md)). Menu names and buttons were checked against that code on a
made-up demo copy, on a computer and at phone size. Anything built but **held back** (kids'
check-in safety parts 2–7, Classes, the Bible studies screens in the member app, the App Store
build) is shown only as "coming" and is **not** demonstrated. Don't describe it as live.

**Contents:** [a. How you'll test](#a-how-youll-test) ·
[b. Personal testing checklist](#b-personal-testing-checklist) ·
[c. Leadership demo guide](#c-leadership-demo-guide-3045-minutes) ·
[d. Likely questions](#d-likely-leadership-questions) ·
[e. One-page overview](#e-one-page-feature-overview) ·
[f. Known issues](#f-known-issues-and-limitations) ·
[g. Next steps](#g-recommended-next-steps-after-leadership-reviews-it)

---

## a. How you'll test

**Where.** On the existing live Church Hub (the same Render service, database and accounts). The
deploys are done ([deploy-runbook.md](deploy-runbook.md) if you need it again). There is no separate test site or demo environment: you
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
Kids' check-in itself **stays on Subsplash**. Here you only check who could open it.

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

### 20. What's new since the first deploy
Try these on your own account before Tuesday. None of them reaches other people unless you press
**Save changes** in App Builder, so don't do that.

| Do | Expect | Problem if | Account |
|---|---|---|---|
| **Home** → **Customise** (top right of the cards) | A list of cards with show/hide and up/down buttons, **Reset to default**; **Save** changes your Home only | It changes anyone else's Home | You (admin) |
| In the app: **More → My info** | Your phone, birthday and home address; **Tell the office** for email or family changes | A field won't save | You, phone |
| **App Builder**: open it, change nothing, look at **Me** and **A guest** in the preview. Press **Discard changes** if you touched anything | A phone preview of the church app | You pressed **Save changes** by accident (the app changes for everyone) | You (admin) |
| **Media** | If the YouTube channel is connected: videos under **In the app**, **Not in the app** and **Needs a look**, "Last checked …" under the chips. If not: a message that points to **Setup** | A real video shows the wrong title or is missing from the app | You (admin) |
| **Bible studies** (needs the Bible studies coordinator switch on your account or the coordinator's) | Four tiles and the tabs Waiting, Studies, Teachers, Materials and People | "You don't have access" (an admin switches it on in **Settings → Sign-in & accounts**) | You (admin) |
| App **Give** tab: look, don't give | The church's giving page opens | An error page | You, phone |

### Reporting an issue
Use the hub's **Feedback** page (or **More → Send feedback** in the app): choose what kind, how much
it matters ("Blocks Sunday" for anything that would stop a service), and say what happened. It
records the page you were on. Or tell the developer the **page**, the **steps** you took, and a
**screenshot**. Leave out names and private details of real people.

---

## c. Leadership demo guide (30–45 minutes)

**Goal for the room:** leaders leave knowing that the Church Hub is already running part of the
church, that it is meant to replace **Faith Teams, Subsplash and Google Chat** one step at a time,
that the church owns the data, and that nothing risky (kids' check-in) is switched until it has been
proved safe.

### Before the demo
A short checklist for the owner. Do it the day before, then again 15 minutes ahead.

**1. Backup**
- [ ] **Settings → Backups → Back up now**. The top row says today's date and OK, and Google Drive is
  connected. If it doesn't, don't present on live until it does.
- [ ] Press **Download** and keep the file on your own computer, not a shared drive.

**2. Test team and test service (see [section a](#a-how-youll-test))**
- [ ] A team named "TEST – please ignore" with only you on it, and a service dated this week with only
  that team, set to **Does not repeat**.
- [ ] You're scheduled and a request has been sent, so **Please reply** shows on your phone.
- [ ] Tell staff in advance. Everything you send in the demo reaches **real people** if the test team
  has anyone else on it.
- [ ] A test announcement ready to type (**A team** → test team only). Never choose **Everyone**.

**3. Which account to present from**
- [ ] Your **own admin account**, in a private or clean browser window so no old tabs show.
- [ ] Giving shows only to accounts with the **Finance** flag, even admins. Presenting from an
  account without it is fine and is a good thing to point out: the **Giving** page says "No access".
- [ ] Don't present from someone else's account. If you want to show a volunteer's or a leader's
  view, use a test account ([section a](#a-how-youll-test), decision 16) or just talk about it.

**4. Hide real member data on the projector**
- [ ] Turn off notifications on the presenting computer (chat messages can pop up).
- [ ] Set the **Campus** picker (bottom of the left menu) to your own campus.
- [ ] **People:** open **your own** record. The list shows names and photos, so scroll past it
  quickly or search for your own name first. Never open medical notes, allergies, private notes or
  pickups.
- [ ] Don't open **Kids Check-in**, **Connect cards** with real prayer requests, **Roll call** on a real
  service, or **Settings → Sign-in & accounts** if the account list would show names. If you want to
  show roles, show the roles section but not the full account table, or talk through it.
- [ ] **Bible studies:** these are private and personal. Show the empty tiles and tabs, or a test
  study you made, not real ones.
- [ ] **Chat:** open only the test team's chat.
- [ ] Zoom the browser to 110–125% so the back row can read it.
- [ ] There is no "hide names" button in the Church Hub. If something shows by surprise, click away
  without comment.

**5. Phone app ready**
- [ ] The church app is on your phone's home screen and you're signed in
  ([the phone app guide](guides/the-phone-app.md)). The **iPhone app is not on the App Store yet**:
  show the home-screen version.
- [ ] **Please reply** shows on the app's **Home**. Mirror or plug in your phone. Put it in **Do Not
  Disturb** so personal messages don't appear.
- [ ] Have the app's address ready to show on a slide or say aloud.

**6. Last look**
- [ ] **Settings → Checks** says "Nothing here blocks real use".
- [ ] Wi-Fi works in the room. A backup plan: the screenshots from your last run, or this guide.
- [ ] Printed copies of the [one-page overview](#e-one-page-feature-overview).

### Plain-language tips
- Say what the church can **do** with it ("find who hasn't replied"), not how it's built.
- If someone asks about something that is built but not live, say so: "That's built and being
  checked. We'll turn it on when it's safe."
- If something fails on screen, say "That's why we test with a small group first", then move on.
- **Be honest.** Say what is live (in this guide), what needs more testing, and what is coming.

### Running order

Total about **45 minutes** with questions on top. For 30 minutes, use the cut list underneath. All
steps use **your admin account** unless they say otherwise.

| # | Step | Time |
|---|---|---|
| 1 | Why we built it | 2 min |
| 2 | Home: the week at a glance | 3 min |
| 3 | People and families | 3 min |
| 4 | Scheduling volunteers | 7 min |
| 5 | Chat and announcements | 4 min |
| 6 | Attendance | 3 min |
| 7 | The church app on a phone | 5 min |
| 8 | App Builder: the church changes its own app | 3 min |
| 9 | Media: Sunday videos | 3 min |
| 10 | Bible studies (optional: only if asked) | 0–1 min |
| 11 | Connect cards and forms | 2 min |
| 12 | Safe by design: roles, Checks, backups | 3 min |
| 13 | Kids' check-in: what's coming | 2 min |
| 14 | Coming next, and what we need | 3 min |

#### 1. Why we built it (2 min)
- **Click:** nothing, or stay on **Home**.
- **Say:** "Today we pay for three tools: Faith Teams for people and scheduling, Google Chat for
  talking, and Subsplash for the app, videos and kids' check-in. The Church Hub is one place built
  around how Meadowbrook works. It's already live and some of us are using it."
- **Why it matters:** one login, one list of people, no copying between systems, and the church owns
  its data. It's also how we save money, one retired tool at a time ([question on cost](#d-likely-leadership-questions)).

#### 2. Home: the week at a glance (3 min)
- **Click:** **Home**. Point at **Needs your attention**, **This week's services** and **Your next time
  serving**. Then press **Customise** and show the show/hide and up/down buttons, then **Cancel**.
- **Say:** "A leader opens this and sees what needs them: open spots, people who haven't replied.
  Each person can arrange their own Home. It changes only their view."
- **Why it matters:** replaces checking several apps and chasing people by text. Faith Teams has no
  single "what needs me today" page.

#### 3. People and families (3 min)
- **Click:** **People** → search **your own name** → open your page.
- **Say:** "Everyone in every campus is in one list, with families kept together. Leaders see what they
  need and not health or private notes."
- **Show:** search and the filters, your **Family** card, **Teams and serving**. Mention **Select**
  (change several people at once), **Export** and **Merge duplicate**. Don't open anyone else.
- **Why it matters:** this is the Faith Teams people list. The real Faith Teams import is still to be
  rehearsed on a copy first ([known issues](#f-known-issues-and-limitations)).

#### 4. Scheduling volunteers (7 min)
- **Click:** **Services** → your test service → **Order of service** (a quick look) → **Who's serving**.
  Press **Fill open spots**, then **Send requests** (the list shows only you), then **Send to 1
  person**.
- **On your phone:** the app's **Home** shows **Please reply** → **Accept**. Back on the computer,
  refresh: the row says **Accepted**.
- **Then:** **Volunteer schedule** → pick the test team to show the month grid. Mention **Remind N
  who haven't replied** and **Find a replacement**.
- **Say:** "The leader fills the spots, sends one request, and each volunteer answers from the app or
  from an email link with no account. Leaders hear about declines. Nobody is double-booked."
- **Why it matters:** this is the heart of Faith Teams, and the part volunteers feel every week.

#### 5. Chat and announcements (4 min)
- **Click:** **Chat** → the test team's chat: send a message and show it arriving on your phone. Then
  **Announcements** → title "Demo", **Send to: A team**, test team only. Show the line that says how
  many people it reaches. Choose **When: Later**, **Schedule**, then **Cancel**.
- **Say:** "Team chat lives with the team list, so when someone joins a team they're in the chat. An
  announcement shows how many people it will reach before you send it."
- **Why it matters:** replaces Google Chat for teams, and the Subsplash push notice, without a
  separate list to keep up to date.

#### 6. Attendance (3 min)
- **Click:** **Attendance**. Show the weekly chart, the **Average per Sunday** numbers, and the
  **Each service** table. Mention **Take attendance** on a phone and **Download CSV**.
- **Say:** "Numbers come from roll call and headcounts. We can see trends against last year and who
  has been missing."
- **Why it matters:** attendance reporting leaves a spreadsheet. (The numbers in a demo copy are made
  up; on live they're the church's own, so mention they're real.)

#### 7. The church app on a phone (5 min)
- **On your phone:** the app **Home**: **This week at …** (next service, what you're serving, events),
  then **Serve**, **Watch** and **More → My info**, **Help** and **Send feedback**.
- **Say:** "This is what a member sees. It works like an app and installs from the web address.
  Members can update their own phone and address, and tell the office about changes."
- **Don't say** that it's on the App Store. It isn't yet; the iPhone version is being tested.
- **Why it matters:** this replaces the Subsplash member app and its monthly cost, and the church
  decides how it looks.

#### 8. App Builder: the church changes its own app (3 min)
- **Click:** **App Builder** (under Church app). Show the tab list, the phone preview, **Me** and **A
  guest**, then a widget such as **Announcement** or **Link list**. **Don't press Save changes.**
  Leave with **Discard changes** if you changed anything.
- **Say:** "Staff with the **Edit the app** switch can rearrange tabs and add a banner or a list of
  links. A preview shows it first. Nothing goes to members until someone saves."
- **Why it matters:** with Subsplash, changes mean emailing a vendor or learning their tool. Here
  it's ours.

#### 9. Media: Sunday videos (3 min)
- **Click:** **Media**. Show the three chips (**In the app**, **Not in the app**, **Needs a look**), open
  one video to show the **edit panel**, then **Setup** (don't change anything).
- **Say:** "Videos come in from our YouTube channel on their own. Staff only look at the few the
  Church Hub isn't sure about. Nothing changes on YouTube."
- **If the channel isn't connected yet** on live: say "this is the Library after we connect the
  channel" and show **Setup** instead. Check this beforehand.
- **Next, if asked:** live streaming inside the app through Mux, recorded to Mux and YouTube at the
  same time; recent services play from Mux, older ones from YouTube. Expected cost about $0–20 a month.
- **Why it matters:** replaces the Subsplash media library. Live streaming and uploads are not part
  of this.

#### 10. Bible studies (2 min)
- **Click:** **Bible studies**: the tiles and tabs (**Waiting**, **Studies**, **Teachers**,
  **Materials**, **People**).
- **Say:** "Our coordinators can keep track of personal studies: who's teaching, who's studying,
  which material and who finished. Later, members will be able to ask for a study from the app. That
  part is next; today it's the office side."
- **Why it matters:** replaces a spreadsheet and the memory of whoever coordinates.
- **Keep it light.** Skip this step unless someone asks. Discipleship gets one sentence in the talk
  (on the "What we're working on next" slide): it will be built in more fully over time, next to
  everything else we keep about each person. Don't compare it with other discipleship tools.

#### 11. Connect cards and forms (2 min)
- **Click:** **Connect cards** (your test card only, **To follow up** and **Followed up**). Then
  **Forms** → your test form → **Copy link** and open it on the phone.
- **Say:** "Guests fill in a card or a form on their phone. It lands in one list for follow-up.
  Prayer messages go to staff only."
- **Why it matters:** replaces paper cards and separate sign-up tools.

#### 12. Safe by design: roles, Checks, backups (3 min)
- **Click:** **Settings → Sign-in & accounts** (the roles box and the "Who can sign in" setting; hide
  the account list), **Settings → Checks**, **Settings → Backups**.
- **Say:** "Four roles: volunteer, leader, staff and admin, plus campus limits. Giving is visible only
  to people with a Finance switch, even admins. Every night an encrypted backup goes to the server
  and to Google Drive."
- **Why it matters:** the first question leaders ask is whether their people's information is safe.

#### 13. Kids' check-in: what's coming (2 min)
- **Click:** nothing. **Don't open Kids Check-in** (it lists children and allergies).
- **Say:** "Kids' check-in stays on Subsplash for now. It's the most serious part of the move, so we
  are building it as a separate project. Much of it is built and being checked: a guard on
  check-out, a protected history of every check-in and check-out, a switch for who may use
  check-in, new pickup codes, levels for medical notes, holds on a pickup, and check-in settings
  for each campus, including letting a family check in at any campus. None of it is turned on at
  the desk. We'll practise at one campus first."
- **Why it matters:** kids' safety comes first, and this is the last piece before Subsplash can go.
- **Accurate wording:** these are **built but held**, not switched on. The part that is live is a
  behind-the-scenes record of check-ins, and a way to see which check-in iPads are up to date.

#### 14. Coming next, and what we need (3 min)
- **Say:** the list below, then "From staff we need about 30 minutes to be shown, a few weeks of
  using it, and honest feedback."

| Next | In plain words | When |
|---|---|---|
| Staff beta | About 8 staff use chat, tasks, planning, People and announcements | Mid-December |
| Pause | No new people onboarded over Christmas | 19 December to 3 January |
| Bible studies in the app | Members ask for a study and see their own | Next release |
| Classes | Training with videos and quizzes; built, held back | January |
| Worship and production | Scheduling, plans, songs, team chat | Late January |
| Other ministries | Their teams, small groups, forms | February to early March, more after Easter |
| Kids' check-in pilot | The held safety parts switched on at one campus first | From about 21 February |
| iPhone app on the App Store | Tested through Apple's TestFlight first; needs the church's Apple account | After the Apple account is ready |
| Subsplash check-in off | Only after the pilot and a safe cutover | About mid-June 2027 |

These dates are expected, not promised. They move with real Sundays and review time.

**If you have 30 minutes:** shorten steps 3, 6, 10 and 11 to a minute each, or skip 9 and 11.

**State it plainly at the end (works today vs not yet):**
- **Live and working with made-up data in testing:** people and families, campuses, teams, services
  and orders of service, scheduling with email and app replies, reminders, team chat, announcements,
  small groups, forms, connect cards, attendance, accounts and campus limits, Checks, the member
  app, My info, Customise Home, App Builder, Media (YouTube-first), Bible studies (office side),
  accessibility improvements, and the check-in record.
- **Needs more testing with real people:** push notifications on real phones, email in real inboxes,
  the real Faith Teams import, name-tag printers and iPads, the iPhone app on a real iPhone.
- **Built, held back, not live:** kids' check-in safety parts 2–7, Classes, Bible studies in the
  app, and the App Store build.
- **Not built:** member directory, adult direct messages, church-wide email, text messages,
  recurring availability, swaps.

---

## d. Likely leadership questions

Honest answers. Where something is the owner's decision, it says so.

| Question | Answer |
|---|---|
| **What does it cost?** | Subsplash costs us **$2,990 a year** (about $249 a month). The Church Hub, with everything we plan, comes to **under $600 a year** at the high end (about $46 a month): the server at Render about $8 a month, live stream and videos in the app (Mux) up to $20 a month, Apple's App Store fee $99 a year (may be waived for nonprofits), and kids' check-in labels up to $120 a year. Google Play is $25 once. That is about **$2,400 a year saved on Subsplash alone**, before Faith Teams. Online giving has no monthly fee: Stripe keeps 2.2% + 30¢ per card gift at the nonprofit rate, 0.8% (at most $5) for bank payments. Group texting, if we add it, would be about $15–50 a month. The development team's tools are covered by the owner's own subscription, not church money. No new paid service starts without the owner's approval. Fill in Faith Teams' yearly cost before Tuesday to show the full saving. |
| **Is our data safe? What about backups?** | The data sits in one database on the church's own server disk, not in a vendor's system. Every night after 3 a.m. a copy is made, locked with a password only the church holds, and sent to Google Drive. The last 14 nightly copies and one a month for a year are kept. An admin can press **Back up now**. A restore drill, opening a real backup on a spare computer, was done before the deploy of attendance access (see [restore-drill.md](restore-drill.md)). Check **Settings → Backups** shows today's date before you present. People can be exported to a spreadsheet at any time. |
| **Who can see what?** | Four roles: volunteer, leader, staff, admin. Volunteers see their own schedule and the services they serve at. Leaders see their own teams and don't see medical notes, private notes or pickup lists. Staff and admins can be limited to a campus. Giving is shown only to accounts with the **Finance** switch, even admins. Connect-card prayer messages are staff only. Small groups are adults only. Bible-study student contact details reach the teacher only if the student agreed. Admins decide who can sign in, and today only accounts an admin adds can. |
| **What about kids' safety?** | Kids' check-in is **not** moving yet. It stays on Subsplash. Much of the safety work is built but held back and switched on later: a guard on check-out, a protected history, a switch for who may use check-in, new pickup codes, medical-note levels, holds on a pickup, and settings per campus (including any-campus check-in). We'll pilot at one campus first and move others after Easter. The part that is live is a behind-the-scenes record and a check that shows which iPads are up to date. No child's information is shown to people who don't need it. |
| **What happens to Subsplash and Faith Teams?** | They keep running until the Church Hub does the same job well enough. A ministry leaves Faith Teams only after one full cycle in parallel, nothing that "blocks Sunday", and its leader agrees. Google Chat retires team by team after four or more weeks. Subsplash check-in goes last, about mid-June 2027 after the pilot. The Subsplash app and media stay until the church app and Media are accepted. Nothing is switched off without leadership's say. |
| **Will it be in the App Store?** | Not yet. Today members use the church app from the web address and add it to their home screen. An iPhone app is built and being tested; the next step is Apple's TestFlight, which needs the church's Apple developer account, and the person who holds it hasn't been confirmed. Until then, please don't tell members to look for it. App Store review and the yearly Apple fee are still to be decided by the owner. |
| **What's needed from staff?** | A 30-minute walkthrough, an account an admin adds and links to their person, then using it for real work for a few weeks: replying to requests, chatting, taking attendance on a phone. Say what's confusing on the **Feedback** page. No one is asked to move their whole ministry before they're ready, and no one loses Faith Teams on a date we pick for them. |
| **What's the timeline?** | Staff beta from mid-December, a pause from 19 December to 3 January, worship and production in late January, other ministries February to early March (more after Easter), a kids' check-in pilot from about 21 February, and Subsplash check-in off about mid-June 2027. Classes in January. These are targets. They move with real Sundays and review time, not typing speed. |
| **Who looks after it?** | The owner, working with an AI-assisted development team that writes, tests and reviews changes. Nothing reaches the live site without the owner's approval. It's built with plain tools and written documents, so another developer could take it on. A small team is a real risk. Backups, automated tests and the written guides are how we reduce it. |
| **Does it work across campuses?** | Yes: each campus has its own services, rooms and staff limits, and a volunteer can serve at more than one campus if an admin allows it. |
| **What about giving?** | Online giving is live with Stripe. One real card gift and its refund were tested on 26 November. Bank transfers, Apple and Google Pay, repeating gifts and gifts from guests are built but not yet tried live. Only people with the **Finance** switch see giving. We don't show it in the demo. |
| **Can it send text messages?** | Not yet. It needs a paid texting provider (Twilio or Telnyx), which is a leadership decision. For a church our size: about $20–60 once to register the church with the phone carriers, then about $15–50 a month depending on how much we text (about 1¼¢ per text, plus a few dollars a month for the number). People would opt in, "Reply STOP" always works, and no texts would go out late at night. Today it's app notices, the in-app inbox and email. |
| **What about discipleship tools other churches use?** | Be gracious and brief. "There are good tools built for discipleship, and people have put a lot of care into them. For us, discipleship will be built in more fully over time, right next to everything else we know about each person, so nothing has to be typed twice. If a tool ever serves Meadowbrook better, we'd look at working with it rather than against it." Don't compare features or name names. |
| **Is it easy enough for our older members and volunteers?** | We have tried to make it so: large tap areas, readable text, a Help page, and Accept by email link with no account needed. We'll keep asking for feedback from volunteers of every age. The accessibility pass is done on the member app and the staff pages, but nothing replaces real people trying it. |

---

## e. One-page feature overview

*A page to hand out. Plain words, no jargon.*

### Meadowbrook Church Hub: where we are

**What it is.** One place for our people, scheduling, chat, attendance and the church app. It is meant
to replace Faith Teams, Google Chat and Subsplash, one step at a time, with the church owning its
own information.

**Working now (live)**

| What | What it does for us |
|---|---|
| People and families | One list for every campus, families together |
| Teams and scheduling | Leaders schedule, volunteers accept or decline by app or email, reminders go out |
| Services and orders of service | Plans, songs and templates |
| Chat and announcements | Team chats; notices to chosen groups |
| Small groups, forms and connect cards | Guests and members sign up; staff follow up |
| Attendance | Roll call and headcounts on a phone, with weekly trends |
| Church app | **Home**, **Serve**, **Watch**, **Give**, **More**; **My info**; installs from the web address |
| App Builder | Staff with permission change tabs and cards in the app |
| Media | Sunday videos come in from YouTube; staff tidy the few that need it |
| Bible studies (office side) | Coordinators track studies, teachers and materials |
| Customise Home | Each person arranges their own Home page |
| Safety | Roles, campus limits, nightly encrypted backups, a check-in record |

**Still being tested.** Notifications on real phones, email in real inboxes, the move of our Faith
Teams list, name-tag printers and iPads.

**Built, not switched on yet**

| What | Why we're waiting |
|---|---|
| Kids' check-in safety features | Child safety comes first. A pilot at one campus before any move; Subsplash stays until then |
| Classes | Planned for January |
| Bible studies in the app | Next |
| iPhone app in the App Store | Needs the church's Apple account |

**Not built.** Member directory, adult direct messages, church-wide email, text messages.

**What happens next.** Staff try it from mid-December. A pause from 19 December to 3 January. Worship
and production in late January. Other ministries from February. A kids' check-in pilot from about
21 February. Dates are targets.

**Who sees what.** Volunteers see their own schedule. Leaders see their teams. Staff and admins see
more, limited by campus when needed. Giving and children's medical notes are shown only to people
who need them.

**How you can help.** Try it. Tell us what's confusing: **Feedback** in the hub, or **More → Send
feedback** in the app.

---

## f. Known issues and limitations

**Be ready to say these out loud:**
- **Nothing here has been tried with every real phone, email inbox and printer.** Push notifications
  on real phones, email in real inboxes, the iPhone app on a real iPhone, name-tag printers and iPad
  pairing are all untested by QA.
- **The real Faith Teams people export hasn't been imported.** A rehearsal on a copy comes first
  ([beta-readiness.md](beta-readiness.md) §C).
- **Media** shows videos only once the YouTube channel is set up in **Media → Setup**. Without the
  optional YouTube key it sees only the latest 15 videos.
- **App Builder** is only open to admins and accounts with the **Edit the app** switch, and
  **Save changes** goes straight to every member. Staff who could open it before the last deploy need
  the switch turned on.
- **The Bible studies page** says "…or wait for requests from the church app" when empty. The app
  screens aren't built yet, so nobody can send a request. Say "coming".
- **Giving:** the live gift test was one card payment. Other methods aren't tried live.
- **Campus-limited admins can send announcements to the whole church** (QA-6). Existing behaviour;
  an open owner decision ([permissions.md](permissions.md#campus-limited-admins)).
- **The Kids Check-in page is still in the hub's menu** for people who have the check-in switch.
  It's the older version, and Subsplash is still the real check-in. Don't open it in the demo.
- **The check-in record** has no screen for staff yet. It records behind the scenes.
- Account management is easier on a computer. On a phone, **Settings → Accounts** scrolls sideways
  inside its card.
- **Settings → Checks** on a computer running a demo says "No" for test sign-in. On the live site it
  should say "Nothing here blocks real use".

**Fixed since the last version of this guide:** two services at the same time and campus now give a
warning; **New service** no longer starts on "Every week"; accounts on the old Light default now
**Match my device**; the sign-in page no longer tells anyone whether an email has an account.

**Your decisions** ([roadmap §13](master-product-roadmap.md#13-decisions-and-facts-needed-before-implementation)):
whether leaders and the check-in desk may add children to existing families (allowed today); whether
pickups should be listed explicitly; whether campus-limited staff may create families with no campus;
real member information on screen during demos; test accounts on live; the Apple developer account.

**Not built or needs outside setup:** see the [one-page overview](#e-one-page-feature-overview).

---

## g. Recommended next steps after leadership reviews it

These follow the stages in [beta-readiness.md](beta-readiness.md) and
[roadmap §7](master-product-roadmap.md#7-beta-plan). The owner decides each one.

1. **Record leadership's feedback** on the Feedback page or in [feedback.md](feedback.md), each
   marked Blocks Sunday, Slows me down or Nice to have. The Product Manager sorts it into now,
   next and not now.
2. **Turn on what each person needs:** the **Edit the app** switch for anyone who edits the app, the
   **Bible studies coordinator** switch for the coordinator, and the Check-in switch only where
   needed.
3. **Staff beta (about 8 staff), mid-December:** accounts added and linked, a 30-minute walkthrough,
   real-phone and email checks ([§A](beta-readiness.md#a-real-device-checks),
   [§B](beta-readiness.md#b-email-delivery)). Tell staff what isn't in the beta: kids' check-in and
   Classes.
4. **Pause, 19 December – 3 January:** nothing new.
5. **Worship and production, late January**, then **other ministries, February to early March, then
   after Easter**, one champion per ministry, leaving Faith Teams one workflow at a time.
6. **Kids' check-in:** a separate go/no-go on the held safety parts, then a pilot campus from about
   21 February.
7. **iPhone app:** confirm who holds the church's Apple account, then TestFlight with staff.
