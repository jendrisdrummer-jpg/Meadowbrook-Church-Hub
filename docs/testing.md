# Testing

How the hub is tested and what "tested" means here. The QA Engineer owns this page.

**Rule: a feature is "passing" only when it was actually run and observed working.** Say exactly
what was run, as whom, at what size, and what was seen. "Should work" is not a result.

## Layers

| Layer | Tool | Command | What it covers |
|---|---|---|---|
| API end-to-end | `node:test`, in-memory SQLite, stand-in servers for Google/Stripe/Daily/YouTube/Mux | `npm test` | Every area's routes, permissions, workflows, background jobs called directly. `test/api.test.js`, `test/forms.test.js` (own app per test) |
| Shared rules | `node:test` | `npm test` | Check-in room rules (`test/rules.test.js`), service worker (`test/sw.test.js`) |
| Browser smoke / regression | Playwright (installed globally, not a project dependency) | `npm run test:ui` | Every main hub and member app page (including Help, `#/help`, in both) as admin, campus staff and volunteer, at desktop (1360px) and phone (390px): script errors, server errors, error screens, sideways scrolling, plus a screenshot of each. Report and screenshots in `data/ui-smoke/` (git-ignored) |
| Workflow checks | Playwright scripts or by hand | — | The workflows below, for features that changed |
| CI | GitHub Actions (`.github/workflows/test.yml`) | automatic | `npm test` on every pull request and push to `main` |

Installing Playwright once on a computer (free): `npm i -g playwright && npx playwright install
chromium`. Claude Code's cloud sessions already have it.

## Writing API tests

- Add to `test/api.test.js` (one `test()` per area/workflow) using the `api(role, method, url, body)`
  helper and the `admin`, `north` (campus-limited staff) and `vol` accounts.
- Test the workflow, not just one call: create → act → check what others now see.
- Test permissions every time: a lower role gets 403; the campus-limited account can't see the
  other campus.
- Outside services: a local `http.createServer` stand-in plus the `MB_*_API` override; restore
  env vars in `t.after`.
- **Dates:** never assume today's date (tests run on any day). Build dates relative to now
  (`nextSunday()`, `addDays()`), and make assertions that hold on any date, including month
  boundaries. A test that depends on the calendar is a bug.
- Background jobs: call them directly (`sendReminders(db)`, `muxTick(db)`); if a request already
  started one, await it, then call again.

## Core workflows (regression checklist)

Run the affected ones for every change, and all of them before a significant release.

| # | Workflow | Who | Must see |
|---|---|---|---|
| 1 | Add a person, then a family with children (allergies) | Staff | Person and household saved; kids show in check-in with allergy |
| 2 | Merge a duplicate person | Admin | One record left, history kept |
| 3 | Add someone to a team and position | Leader | Roster updated; team chat membership follows |
| 4 | Create a repeating service and an order of service from a template | Staff | Services appear on the calendar; plan filled |
| 5 | Schedule a volunteer, send requests, accept and decline; remind those who haven’t replied | Leader → volunteer | Push/inbox; decline reaches leader; reminders skip accepted/declined/unsent and repeat only after 12 hours; conflicts and away dates respected |
| 6 | Roll call and kids' check-in/out (also from a paired station) | Leader / station | Attendance recorded; name tags; check-out by code |
| 7 | Create an event with sign-up questions (and a paid one) | Staff → guest | Event in app calendar; sign-up recorded; capacity honoured |
| 8 | Send an announcement (now and scheduled) | Announcements flag | Inbox + push; guests get push; audience respected |
| 9 | Chat: team chat, group, reply, mention, file, task card | Volunteer / leader | Live updates; unread counts; only members see it |
| 10 | Tasks: assign, remind, complete, repeat | Volunteer / leader | Notifications; next repeat created |
| 11 | Give online (one-time, recurring) and record a cash batch | Guest / Finance | Gift recorded; statements; non-Finance accounts see nothing |
| 12 | App Builder: change home widgets and tabs | Staff | Member app shows the change; guests too |
| 13 | Media: new video arrives, edit title/trim, watch in app | Staff → member | Trimmed playback; library filters |
| 14 | Sign in by Google / email code / password; sign out | Anyone | Correct role and campuses; policy respected |
| 15 | Permissions sweep | Volunteer, campus staff | Staff-only pages refused; other campus invisible (`npm run test:ui` covers page level) |
| 16 | Set up a form (questions, campus, who's told), copy its link, fill it in on a phone as a guest, read and finish the response, export CSV | Staff → guest | Response listed with answers; notice has no answer text; CSV opens with formulas defused; a signed-in form asks a guest to sign in; campus-limited staff don't see other campuses' responses (`test/forms.test.js`; `npm run test:ui` covers `/forms` pages and `/app/#/form/volunteer-interest` on a phone) |

`test/qa-pass.test.js` (pre-demo QA pass) covers team-leader access following the roster, campus-limited admins, email reply links, reminder timing, small-group chat privacy and campus edges. Tests marked `todo` assert the safe behaviour for known open bugs; they fail today without failing the run, so turn `todo` off when the bug is fixed.

Campus eligibility tests (`campus eligibility:` in `test/api.test.js`) build two campuses, a church-wide
team and volunteers with a home campus, a list and no campus at all. Dates come from `nextSunday()`.

## Mobile and browser checks

- `npm run test:ui` must pass (it fails on any sideways scroll at 390px).
- Look at the phone screenshots of changed pages: tap targets, text wrapping, bottom bars.
- For member app changes, also check light and dark theme.
- Real-device checks the automated run can't do (note them in the PR as "not tested" if skipped):
  push notifications on iPhone (home screen app) and Android, camera/photo upload, name-tag
  printing, Stripe Apple Pay/Google Pay, Mux playback on iOS.

## Reporting a bug

Title · where (page/route, file:line if known) · who (role, campus) · steps · expected · actual ·
screenshot or test output · severity (blocks church use / annoying / cosmetic). Unfixed bugs go in
[tech-debt.md](tech-debt.md).
