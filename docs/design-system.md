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

## Tokens (CSS custom properties in `:root`)

| Token | Use |
|---|---|
| `--accent` (#135fd1 default) | The church's brand colour (Settings → Church), set at run time by `js/theme.js`. Buttons, links, selection. Never hard-code a blue. |
| `--accent-soft`, `--accent-text`, `--accent-ink` | Tinted backgrounds, accent text, text on accent |
| `--bg`, `--panel`, `--panel-2`, `--line` | Page, cards, inset areas, borders |
| `--text`, `--text-2`, `--muted` | Main, secondary, quiet text |
| `--good`/`--warn`/`--bad` (+ `-soft`) | Status colours (pills, alerts) |
| `--kids` | Kids' ministry highlight |
| `--radius` (12px), `--shadow`, `--font` (system UI stack) | Shape and type |

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
| Status | `.pill` (+ `.good`, `.warn`, `.bad`, `.info`), `.alert` (+ `.good`, `.bad`) |
| Tabs | `.tabs` with buttons (`.on` = current) in the hub; `.seg` segmented control in the app |
| Forms | `.form` grid with `label.field` (label text, then the input, then `span.muted.small` help); `label.check` for checkboxes; `.switch` |
| Lists | `table.list` (rows become clickable with `.clickable`), `.m-list` in the app |
| Chips | `.chip` (`.on` selected); `chips()` in `lib.js` for an editable list |
| Progress | `.meter > span` |
| Empty states | `.empty` / `.m-empty` with one helpful sentence and, when possible, the action |
| Icons | `icon(name)` from `lib.js` (Lucide-style inline SVG). Add new icons to `PATHS` there. |
| Dialogs and feedback | `dialog()`, `confirm()`, `toast()`, `toastAction()` (undo), `pickPerson()` from `lib.js` |
| Page frame | `setTitle(title, actions)` in the hub puts the title and the page's buttons in the top bar |

Member app home screen widgets have their own system (`js/app-widgets.js`): sizes S/M/T/W/L/F on a
four-column grid, styles card/soft/accent/color.

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
- **Help text:** one short line under the field, saying why or what happens, not how the code works.

## Writing style (UI copy)

- Sentence case for titles and buttons. Verbs on buttons ("Send requests", "Add a station").
- Second person, warm and direct: "You're up to date." "Sign in to see when you're serving."
- Say what happened and what to do next: "That email doesn't look right." not "Invalid input."
- Use curly quotes and apostrophes (’ “ ”) in UI text, as the existing code does.
- Never show internal ids, stack traces or HTTP codes to people.

## Accessibility checklist

- Every icon-only control has `aria-label`; images have `alt` (empty when decorative).
- Text contrast at least 4.5:1 in both themes (check `--muted` on `--panel-2`).
- Everything works with the keyboard; focus is visible; dialogs trap focus and close on Escape.
- Don't rely on colour alone: pills carry words.
- Respect `prefers-reduced-motion` for any new animation.

## Mobile checklist

- No horizontal scroll at 390px wide (`npm run test:ui` checks every main page).
- Fixed bottom bars leave room for the iPhone home indicator (`env(safe-area-inset-bottom)`).
- Inputs use the right `type`/`inputmode` so phones show the right keyboard.
- Long tables collapse or scroll inside their card, never the page.

## Help guides

How-to text lives in `public/js/help-content.js` (one list, hub and app wording, a minimum role per
section). Sections are `details.card.help-sec` with a numbered `.help-steps` list of 3 to 7 steps.
Name buttons exactly as they appear on screen; when a button is renamed, update the guide.
