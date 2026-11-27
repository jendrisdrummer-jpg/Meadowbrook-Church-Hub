# Design system and UI conventions

How the hub and the app look, read and behave. Keep new screens consistent with this; change the
system itself only with a reason (UI/UX Specialist, approved by the owner). CSS:
`public/css/app.css` (hub, shared), `member.css` (member app), `checkin.css` (tablet).

## Principles

1. **Simple, calm, obvious.** One primary action per screen. Show what matters first; put the rest
   one tap away.
2. **Built for real church people**: staff on laptops, volunteers on phones, greeters on tablets.
   Assume people are busy and not technical.
3. **Phone first for anything a volunteer or member touches.** No sideways scrolling, tap targets
   at least 44px, forms that work with a thumb.
4. **Plain words.** Say what happens, in the church's language ("Can't make it", "Away dates",
   "Order of service"), never developer words ("entity", "record", "sync failed: 500").
5. **Consistent over clever.** Reuse a pattern below before inventing a new one.

## Look and feel

Warm and editorial, but plain to use. Light mode is **ivory and cream** (page `#f3ede4`, cards
`#fbf8f3`); dark mode is **warm charcoal** (page `#1c1915`, cards `#25211c`). The church's **brand
blue** is the one accent: primary buttons, links, the selected tab, the current nav icon, focus
rings, charts. Status colours are muted: **sage** for good, **amber** for warnings and open
positions, a soft red for problems. Cards have a 16px radius, 20px padding, a hairline border and
a soft warm shadow (none in dark mode). Controls have a 10px radius.

## Type

Fonts are self-hosted in `public/fonts/` (latin subset, woff2, `font-display: swap`); no CDN and
no request to a third party. Fallbacks: `Iowan Old Style`/Georgia for the serif, the system UI
stack for the sans, so layouts survive a missing file.

| Font | Files | Used for |
|---|---|---|
| **Fraunces** (variable weight 400-600, plus italic 400), `--serif` | `fraunces-roman.woff2` 66 KB, `fraunces-italic.woff2` 41 KB | Page titles (`h1`, 30px; 26px on phones), card and section headings (`h2`, 18px), big numbers (`.stat b`, widget `.w-big`), the avatar initials on a profile, the brand mark letter, the dashboard greeting (44px, the name in italic). Never body text, buttons, table cells or fields. |
| **Inter** (variable weight 400-700), `--font` | `inter.woff2` 47 KB | Everything you read and click: 14px body (15px on phones), 13px small text, controls at weight 550. |

Total 158 KB (154 KiB), cached for the check-in tablet by the service worker so it looks the
same offline. Licences: `public/fonts/OFL-Fraunces.txt` and `public/fonts/OFL-Inter.txt` (SIL Open
Font Licence 1.1; free to self-host and ship).

**Small labels.** Table headers, nav group names, calendar weekdays and menu headings use Inter
11px, weight 650, uppercase, 0.12em tracking, in `--muted` (one rule near the top of `app.css`).
There is no monospace font: spaced caps are used sparingly and never for sentences or names.

**Dashboard greeting.** `js/greeting.js` `greetingForHour(hour)` (tested in `test/greeting.test.js`):
5:00-11:59 "Good morning", 12:00-16:59 "Good afternoon", otherwise "Good evening", from the
device's local time and the person's first name. `home.js` adds `.greeting` to the title.

## Tokens (CSS custom properties in `:root`)

| Token | Light / dark | Use |
|---|---|---|
| `--accent` (#135fd1 default) | brand blue | The church's brand colour (Settings → Church), set at run time by `js/theme.js`. Buttons, links, selection. Never hard-code a blue. |
| `--accent-text` | = accent / accent mixed 60% with white | Blue text and icons (links, current tab). Derived, so a church's own colour keeps working. |
| `--accent-soft`, `--accent-ink` | 10% accent on card (22% on dark) / white | Tinted backgrounds, text on accent |
| `--bg` | `#f3ede4` / `#1c1915` | Page and sidebar |
| `--panel`, `--panel-2` | `#fbf8f3`, `#efe8dd` / `#25211c`, `#201d18` | Cards and inputs; table header, inset areas |
| `--hover`, `--sel` | `#f0e9de`, `#ece4d6` / `#2f2a24`, `#332d26` | Hover; selected nav item or row |
| `--line`, `--line-2`, `--line-input` | `#e2d9ca`, `#d0c5b2`, `#8a7f6e` / `#383128`, `#4d463c`, `#8a8070` | Hairlines; button borders; input and checkbox borders (3:1) |
| `--text`, `--text-2`, `--muted` | `#1e1a16`, `#4a433a`, `#6b6256` / `#f1eadf`, `#c9c0b2`, `#a39a8b` | Main, secondary, quiet text (muted is at least 4.5:1 on every surface) |
| `--good` / `--warn` / `--bad` (+ `-soft`) | `#3f5c3b` on `#e3ebdb`; `#7a5200` on `#f7ebc4`; `#b3342a` on `#f8e3dd` / `#a5c29c` on `#26302a`; `#e3b057` on `#33291a`; `#f08278` on `#3a211e` | Status text and tints (pills, alerts). Fills for bars: `--good-fill` (sage), `--warn-fill` (amber) |
| `--kids` | sage | Kids series in charts |
| `--radius` 16px, `--r-ctl` 10px | | Cards; controls |
| `--shadow`, `--shadow-pop` | warm brown, soft / none in dark | Cards; menus |
| `--font`, `--serif` | Inter, Fraunces | See Type |

Measured contrast (default accent): body text 13-16:1; muted on page 5.2, on table header 4.9, on
selected row 4.7; accent text on card 5.5, on page 5.0, on selected row 4.6; white on accent 5.9;
status pills 4.9-7.2; input border 3.7 (4.1 dark); dark accent text 5.0-6.5. Status always carries a
word or icon, never colour alone. Focus: `:focus-visible` draws a 2px `--accent-text` ring.

**Brand colour rule:** the church's colour must give 4.5:1 for white text on it (primary buttons),
for itself as link text on the light selected-row surface (`#ece4d6`), and, after dark mode's 60%-white
lightening (`--accent-text`), on the dark selected-row surface (`#332d26`). Settings → Church checks
this live (`public/js/contrast.js`, tested in `test/contrast.test.js`) and warns under the picker with a
swatch and a one-click "Use #xxxxxx" shade (same hue, lightness adjusted). Saving a low-contrast colour
is still allowed: it is the church's choice, but it is warned. Never hard-code text colours over `--accent`;
use `--accent-ink`.

**Dark mode:** `html[data-theme="dark"]` and `data-theme="device"` (follows the OS). Every new
colour must come from tokens so both themes work. Check both.

Breakpoints in use: `820px` (hub switches to the phone layout with bottom navigation), `900px`,
`520px`. The member app is a single 640px column, centred on wide screens.

## Building blocks

Use these before writing new CSS.

| Need | Use |
|---|---|
| Container | `.card` (with `.card-head` for a title row), `.grid.two` for two columns that stack on phones |
| Buttons | `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.small`, `.btn.danger`; `.icon-btn` for icon-only (always with `aria-label`) |
| Status | `.pill` (+ `.good` sage, `.warn` amber, `.bad`, `.info`), `.alert` (+ `.good`, `.bad`). Neutral pills have a hairline; sentence case. |
| Tabs | `.tabs` with buttons (`.on` = current) in the hub; `.seg` segmented control in the app |
| Forms | `.form` grid with `label.field` (label text, then the input, then `span.muted.small` help); `label.check` for checkboxes; `.switch` |
| Lists | `table.list` (rows become clickable with `.clickable`), `.m-list` in the app |
| Chips | `.chip` (`.on` selected); `chips()` in `lib.js` for an editable list |
| Dropdowns | Every `<select>` is drawn by the app (`appearance: none` and the `--chevron` image, per theme), so Safari matches other browsers. A page's main filter uses the larger `.sched-pick` (label, `.pick` wrapper, optional `.dot`, the `down` icon), as on the Volunteer schedule and Who's serving. Prefer a dropdown to a row of chips when the list can grow |
| Progress | `.meter > span` (accent; `.good` sage when full, `.warn` amber) |
| Empty states | `.empty` / `.m-empty` with one helpful sentence and, when possible, the action |
| Icons | `icon(name)` from `lib.js` (Lucide-style inline SVG). Add new icons to `PATHS` there. |
| Dialogs and feedback | `dialog()`, `confirm()`, `toast()`, `toastAction()` (undo), `pickPerson()` from `lib.js` |
| Page frame | `setTitle(title, actions)` in the hub puts the title and the page's buttons in the top bar |

Member app home screen widgets have their own system (`js/app-widgets.js`): sizes S/M/T/W/L/F on a
four-column grid, styles card/soft/accent/color. `SIZES[x].plain` has each size in everyday words for the App Builder.

## Patterns

- **Page:** title + actions in the top bar → optional `.tabs` → cards. Search and filters sit
  above the list they filter.
- **Editing:** a dialog for small objects; a page with a **Save** button for big ones. Warn before
  leaving with unsaved changes when losing work would hurt.
- **Destructive actions:** `confirm()` that names the thing and the consequence, the red button
  says the verb ("Remove", "Delete"). Prefer hide/archive over delete for anything with history.
- **Lists:** newest or soonest first, with a sensible `LIMIT` and a search box once lists get long.
- **Loading and errors:** errors arrive as the server's message via `fail(err)` → toast. A page
  that fails to load shows an `.alert.bad` with the message.
- **Settings-style pages:** a checklist of steps (done ✓ / to do) with the next action as a button,
  as in Settings → Backups and Media → Setup.
- **Sidebar (hub):** five groups (Everyday, People, Services, Church app, More), with Attendance
  next to Services. The campus picker is the first thing under the church name, and a campus-filtered
  page shows a "North only" pill beside its title (`.page-campus`, drawn by `drawCampusTag()` in
  `app.js`, only when the account can see more than one campus). Help and Feedback are icon buttons
  beside the user's name (`HELP_LINKS`, not NAV groups, but still found by search) and the name row
  stays pinned at the bottom. Menu words: Volunteer schedule (not "Schedule"), Check-in iPads (not
  "stations"), Take attendance (not "roll call"), Order of service (not "plan items"), Not asked yet
  (not "Not sent"), Can serve at (not "Serves at"). Every NAV item has its own icon; give a new page
  one nothing else uses. `badge: 'connect'`, `badge: 'forms'` and `badge: 'media'` (videos that need a look) are reserved: they stay hidden
  until something calls `setBadge(kind, n)`.
- **Phone bottom bar and More sheet (hub):** the bar is Home, My schedule, Chat, People (leaders
  and up) and **More**. More opens a `dialog.sheet` (native `<dialog>`, so focus is trapped,
  Escape closes it and focus returns to the button) built from `visibleNav()`, so it can never show
  more than the sidebar would: groups as 3-column tiles (`.sheet-tile`), the campus picker when the
  desktop would show it, Appearance as a segmented control, then Help, Feedback and Sign out (the same two links as beside the name on a laptop). Pages
  already on the bar are left out of the tiles. Unread counts use `data-badge` so they show on the
  bar, on More (for pages not on the bar) and on the tiles. A page that lives under More lights up
  More. To put a page on the bar, give its NAV item `mobile: true` (keep the bar to five).
- **Account menu:** on phones it opens under the avatar and is nudged back inside the screen if
  anything would clip it. The header (title plus search, bell and avatar) stays on one line.
- **Banner with folded options:** a one-line state plus its button, with the extra choices in a
  `<details>` underneath (`.notify-banner`, `.notify-options`), as for notifications on My schedule.
- **Show/hide and reorder list (`.cust-list`, Customise Home):** a dialog list of rows, each a `.switch` with the name and two 44px `.cust-move` up/down icon buttons (no dragging, so it works with a thumb or a keyboard; the end rows disable the button that cannot move). Reset changes the dialog only; Save writes.
- **Side panel / sheet (`dialog.md-panel`, Media):** to edit one item from a grid without leaving it. A native `<dialog>` (focus trapped, Escape closes) pinned to the right edge, 540px wide on a laptop and the whole screen on a phone (≤700px). Head (title and a 44px close button), a scrolling body, and a foot with the actions (on a phone Cancel and Save come first, full width). Closing with unsaved changes asks first. The address keeps the item (`#/media/12`, set with `history.replaceState`, so a deep link opens the panel over its page). Rarely used fields fold into `.md-more` details.
- **Filter chips with counts (`.md-fchip`):** big (44px) pill buttons that switch one list between groups, each with a count (`.md-n`); a group that needs action turns amber (`.needs`) until opened. A one-line hint under the chips says what the group means.
- **Card grid (`.md-grid`, `.md-card`):** a 16:9 picture with a length badge, then title (two lines at most), date, a quiet details line and a status pill with the reason underneath; two columns on a phone, three from 700px, four from 1180px.
- **Rows with one action (`table.list.pair`):** details on the left (words never break mid-word),
  status or action on the right; use this instead of 3+ narrow columns on phones.
- **Dates:** always `fmtDate`/`fmtTime`; for database timestamps in UTC use `fmtUtcDate`.
  Never call `toLocaleDateString` on a raw date.
- **Card spacing:** cards directly inside `.grid` and `.stack` have no extra top margin; the grid
  or stack gap does the spacing.
- **Help text:** one short line under the field, saying why or what happens, not how the code works.

## Writing style (UI copy)

- Sentence case for titles and buttons. Verbs on buttons ("Send requests", "Add a station").
- Second person, warm and direct: "You're up to date." "Sign in to see when you're serving."
- Say what happened and what to do next: "That email doesn't look right." not "Invalid input."
- Use curly quotes and apostrophes (’ “ ”) in UI text, as the existing code does.
- Never show internal ids, stack traces or HTTP codes to people.

## Accessibility checklist

- Every icon-only control has `aria-label`; images have `alt` (empty when decorative).
- Text contrast at least 4.5:1 (3:1 for large text and control borders) in both themes (check `--muted` on `--panel-2` and `--sel`).
- Everything works with the keyboard; focus is visible; dialogs trap focus and close on Escape.
- Don't rely on colour alone: pills carry words.
- Respect `prefers-reduced-motion` for any new animation.
- **Text size follows the person.** Font sizes are `rem`, never `px` (line-heights unitless). The member app and
  login set the root from the phone's own setting (`font: -apple-system-body` inside
  `@supports (-webkit-touch-callout: none)`, so desktop Safari stays at 16px), so iOS Larger Text and browser text
  size both work. Give text-bearing boxes `rem`/`min-` sizes, not fixed `px` widths, and check at 150% root size and
  320px wide: no sideways scroll, no clipped labels. Tap targets stay px (44px minimum).
- **State attributes must say `false`.** The `html` template drops `false`, so write `aria-pressed="${String(on)}"`
  (same for `aria-expanded`, `aria-selected`, `aria-checked`).
- **Form errors go next to the field**, not only in a toast: use `fieldError()`, `formError()` and `clearFieldErrors()`
  from `lib.js` (message under the field with `.field-error`, `aria-invalid`, `aria-describedby`, focus moves there).
  Wrap every control in `<label class="field">`; groups of choices (yes/no, tick boxes) are
  `<fieldset class="field"><legend>`. Search boxes with only a placeholder need an `aria-label`.
- **Navigation:** after a page change focus moves to the title (`[data-title]` has `tabindex="-1"`); after re-drawing a
  list in place, return focus to the item or control. Links that switch views are plain links with
  `aria-current="page"` (no `role="tablist"` unless it is a real tab widget); the active bottom tab has `aria-current`.
  The hub has a "Skip to content" link. Don't put an `href="#id"` on anything in the hub or app (the hash is the router).
- Calendar day buttons carry a full `aria-label` ("Sunday 29 November, 2 services"). Unread items say "New" in words,
  not just bold. Scroll with `behavior: scrollBehavior()` (respects reduced motion). Dialogs are labelled by their title.
- Secondary button borders use `--line-input` (3:1 against the page in both themes). Heading colours that use the
  brand colour on dark backgrounds use `--accent-text`, not `--accent`.
- **Hub button groups** (`.seg`, `.tabs`, `.md-fchip`, People/Teams filter chips) are plain buttons, not `role="tablist"`.
  The active one has class `on`; `watchPressed()` in `lib.js` (started in `app.js`) mirrors that to `aria-pressed`, and gives
  any icon-only button that has a `title` the same text as its `aria-label`. Still write `aria-label` on new icon buttons.
- **Tables:** header cells are `<th scope="col">`; the first cell of a row that names the row (Schedule position) is
  `<th scope="row">`. The People list is a `role="list"` whose rows hold a real link on the person's name (the whole row also
  opens it for mouse users). Fields in a `.field` div (no `<label>`) need their own `aria-label`.
- **Dialogs:** `dialog()` and the Media side panel call `trapTab()` so Tab wraps inside; the browser returns focus to the
  opener on close. A new `<dialog>` built by hand must do the same and set `aria-labelledby`.
- On touch screens dense controls (chips, segmented buttons, the People status picker, Schedule add buttons) are at least 32-36px.
- Not covered by code: the brand colour chosen in Settings can fail contrast; a server-side check is a separate task.

## Mobile checklist

- No horizontal scroll at 390px wide (`npm run test:ui` checks every main page).
- Fixed bottom bars leave room for the iPhone home indicator (`env(safe-area-inset-bottom)`).
- Inputs use the right `type`/`inputmode` so phones show the right keyboard.
- Long tables collapse or scroll inside their card, never the page.
- Member app, on touch screens (`@media (pointer: coarse)` in `member.css`): fields are 16px so iPhones
  don't zoom on focus, and buttons, chips, tabs and calendar arrows are at least 44px tall. Login does the same.
  The staff hub does the same for buttons, icon buttons, the bell and fields on touch screens (end of `app.css`).
- Member app detail screens (anything deeper than a tab) get one top-left **Back** (`.m-back`, 44px):
  `route()` in `member/main.js` sets `backTo`, `setTitle` draws it. Don't add a Back button of your own to a
  member page. Back uses `history.back()` when the app has history, else goes to the parent tab. In the chat
  thread (which hides the title bar) the chat header's own Back does the same.
- Member app theme: no saved choice (guests, new visitors) means follow the device (`data-theme="device"`).

## Help guides

How-to text lives in `public/js/help-content.js` (one list, hub and app wording, a minimum role per
section). Sections are `details.card.help-sec` with a numbered `.help-steps` list of 3 to 7 steps.
Name buttons exactly as they appear on screen; when a button is renamed, update the guide.
