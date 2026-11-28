// Browser smoke and regression check: seeds a throwaway demo database, starts the hub on a free
// port, and visits every main page of the hub and the member app as an admin, a campus staffer
// and a volunteer, at desktop and phone sizes. For each page it records script errors, server
// errors (5xx), "Something went wrong" screens and sideways scrolling on phones, and saves a
// screenshot. It also fails a phone page where text is squeezed under 40px wide and runs past 3 lines
// (the letter-by-letter symptom), and seeds long names and repeating services (ui-smoke-seed.mjs).
// Exit code 1 if anything failed.
//
//   npm run test:ui                  # screenshots and report in data/ui-smoke/
//   npm run test:ui -- --only=app    # just the member app (or --only=hub)
//
// Needs Playwright and a Chromium. It's not a project dependency (nothing extra ships to Render):
// it uses a copy installed globally (npm i -g playwright && npx playwright install chromium),
// or the one in Claude Code's cloud sessions. Nothing here talks to a paid service.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedLongContent } from './ui-smoke-seed.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const out = path.join(root, 'data', 'ui-smoke');

function loadPlaywright() {
  const places = [root, process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules'];
  try { places.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { /* no npm */ }
  for (const p of places.filter(Boolean)) {
    try { return createRequire(path.join(p, 'noop.js'))('playwright'); } catch { /* try the next */ }
  }
  console.error('Playwright isn’t installed. Run: npm i -g playwright && npx playwright install chromium');
  process.exit(2);
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const HUB = ['/', '/my', '/chat', '/tasks', '/help', '/people', '/teams', '/groups', '/studies', '/attendance', '/services', '/schedule', '/songs',
  '/events', '/templates', '/giving', '/media', '/media/setup', '/connect', '/forms', '/forms/new', '/forms/1', '/forms/1/responses', '/announcements', '/app-builder', '/stations', '/settings', '/settings/accounts', '/settings/checks'];
const APP = ['/', '/serve', '/events', '/watch', '/give', '/more', '/help', '/tasks', '/chat', '/form/volunteer-interest'];
// leader and finance are added to the throwaway database below; the others come from the demo seed.
const ACCOUNTS = [['admin', 'pastor@meadowbrook.church'], ['staff', 'south@meadowbrook.church'], ['volunteer', 'volunteer@meadowbrook.church'],
  ['leader', 'leader@meadowbrook.church'], ['finance', 'finance@meadowbrook.church'], ['coordinator', 'coordinator@meadowbrook.church']];
// The sidebar each role should see, in order (the demo admin has the announce flag). Rules: min role per item, Giving needs the Finance flag, Announcements the announce flag.
const EVERYDAY = ['Home', 'My schedule', 'Chat', 'Tasks'];
const NAV_WANT = {
  volunteer: [...EVERYDAY, 'Groups', 'Services'],
  finance: [...EVERYDAY, 'Groups', 'Services', 'Giving'],
  // A volunteer-level account with the Bible studies coordinator switch: the page, and nothing else extra.
  coordinator: [...EVERYDAY, 'Groups', 'Bible studies', 'Services'],
  leader: [...EVERYDAY, 'People', 'Teams', 'Groups', 'Services', 'Attendance', 'Volunteer schedule', 'Songs', 'Connect cards', 'Kids Check-in'],
  staff: [...EVERYDAY, 'People', 'Teams', 'Groups', 'Bible studies', 'Services', 'Attendance', 'Volunteer schedule', 'Songs', 'Templates', 'Events', 'Forms', 'Connect cards', 'Media', 'Kids Check-in', 'Check-in iPads'],
  admin: [...EVERYDAY, 'People', 'Teams', 'Groups', 'Bible studies', 'Services', 'Attendance', 'Volunteer schedule', 'Songs', 'Templates', 'Events', 'Announcements', 'Forms', 'Connect cards', 'Media', 'App Builder', 'Kids Check-in', 'Check-in iPads'],
};
let smokeStudyPerson = 0; // a teacher with studies, to open their page
const SIZES = [['desktop', { width: 1360, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]];

async function main() {
  const { chromium } = loadPlaywright();
  // Inside data/ (git-ignored): the demo seed refuses to write anywhere else.
  fs.mkdirSync(path.join(root, 'data', 'ui-smoke-work'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, 'data', 'ui-smoke-work', 'run-'));
  const env = { ...process.env, MB_DB: path.join(tmp, 'demo.db'), MB_UPLOADS: path.join(tmp, 'uploads'), MB_DEV_LOGIN: '1' };
  // Never reach real outside services from a test run.
  for (const k of ['STRIPE_SECRET_KEY', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MB_DAILY_API_KEY', 'YOUTUBE_API_KEY', 'MB_SMTP_HOST', 'GOOGLE_CLIENT_ID']) delete env[k];
  execSync('node --disable-warning=ExperimentalWarning scripts/seed-demo.js', { cwd: root, env, stdio: 'ignore' });
  {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(env.MB_DB);
    db.prepare("INSERT INTO users (email, role) VALUES ('leader@meadowbrook.church', 'leader')").run();
    db.prepare("INSERT INTO users (email, role, finance) VALUES ('finance@meadowbrook.church', 'volunteer', 1)").run();
    db.prepare("INSERT INTO users (email, role, studies) VALUES ('coordinator@meadowbrook.church', 'volunteer', 1)").run();
    // A little Bible studies data, so the page and the person card are checked with real rows.
    const ppl = db.prepare('SELECT id FROM people WHERE archived = 0 ORDER BY id LIMIT 6').all().map((r) => r.id);
    // People with no campus are open to campus staff too, so every account that may see the page can open their cards.
    db.prepare(`UPDATE people SET campus_id = NULL WHERE id IN (${ppl.join(',')})`).run();
    const mat = (t, a, n) => Number(db.prepare('INSERT INTO study_materials (title, author, lessons) VALUES (?, ?, ?)').run(t, a, n).lastInsertRowid);
    const foundations = mat('Foundations', 'A. Writer', 8);
    const john = mat('The Gospel of John', '', null);
    const study = (m, rhythm, lesson) => Number(db.prepare("INSERT INTO studies (material_id, started_on, rhythm, lesson, coordinator_note) VALUES (?, '2026-03-03', ?, ?, 'Prefers mornings')").run(m, rhythm, lesson).lastInsertRowid);
    const s1 = study(foundations, 'Tuesdays, coffee shop', 3);
    const s2 = study(john, '', null);
    const link = (s, p, role, share = 0) => db.prepare('INSERT INTO study_people (study_id, person_id, role, share_contact) VALUES (?, ?, ?, ?)').run(s, p, role, share);
    link(s1, ppl[0], 'teacher'); link(s1, ppl[1], 'student', 1); link(s2, ppl[0], 'teacher'); link(s2, ppl[2], 'student'); link(s2, ppl[3], 'student');
    db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_names, teacher_ids, completed_on, source) VALUES (?, ?, 'Foundations', 'A past teacher', ?, '2025-11-02', 'profile')").run(ppl[1], foundations, JSON.stringify([ppl[0]]));
    db.prepare("INSERT INTO study_requests (person_id, format, topic, times, share_contact) VALUES (?, 'one_on_one', ?, 'Weekday evenings', 1)").run(ppl[4], `Prayer and the life of a disciple ${'with very long words like supercalifragilisticexpialidocious '.repeat(3)}`.slice(0, 200));
    smokeStudyPerson = ppl[0];
    // A paired check-in iPad, so the Stations page is checked with a real row (its table once ran off phones).
    db.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash, device) VALUES ('Kids hallway iPad', (SELECT MIN(id) FROM campuses), 'ui-smoke-token-hash', 'iPad (10th generation)')").run();
    // Long names, titles and emails, and repeating services: layouts that only broke on real phones.
    seedLongContent(db);
    db.close();
  }
  const port = await freePort();
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env: { ...env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const results = [];
  try {
    for (const [who, email] of ACCOUNTS) {
      for (const [size, viewport] of SIZES) {
        const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });
        const page = await ctx.newPage();
        let problems = [];
        let denied = false;
        page.on('pageerror', (e) => problems.push(`script error: ${e.message}`));
        page.on('response', (r) => {
          if (!r.url().startsWith(base)) return;
          if (r.status() >= 500) problems.push(`server ${r.status()}: ${r.url().slice(base.length)}`);
          if (r.status() === 403) denied = true;
        });
        await page.goto(`${base}/login`);
        await page.fill('#dev input[name=email]', email);
        await page.click('#dev button');
        await page.waitForURL(`${base}/`);
        const visits = [
          ...(only === 'app' ? [] : HUB.map((p) => ['hub', p, `${base}/#${p}`])),
          ...(only === 'hub' ? [] : APP.map((p) => ['app', p, `${base}/app/#${p}`])),
        ];
        for (const [area, p, url] of visits) {
          problems = [];
          denied = false;
          await page.goto(url);
          await page.waitForTimeout(900);
          const state = await page.evaluate((vw) => ({
            broken: [...document.querySelectorAll('.alert.bad')].some((a) => /went wrong/i.test(document.title) || /Cannot|undefined|is not/.test(a.textContent)),
            title: document.title,
            // Measure against the real phone width: on a phone, window.innerWidth grows to fit wide content, so it would hide the overflow.
            overflow: document.documentElement.scrollWidth - vw,
            // The letter-stacking symptom: a text element squeezed under 40px wide that runs to more than 3 lines.
            squeezed: [...document.querySelectorAll('body *')].filter((e) => {
              const r = e.getBoundingClientRect();
              if (!r.width || r.width >= 40 || e.textContent.trim().length < 4 || e.closest('svg, [hidden], dialog:not([open]), details:not([open]) > :not(summary)')) return false;
              if ([...e.children].some((c) => c.getBoundingClientRect().width && c.textContent.trim())) return false; // report the innermost element only
              return r.height / (parseFloat(getComputedStyle(e).lineHeight) || 18) > 3;
            }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : ''} “${e.textContent.trim().slice(0, 24)}”`),
          }), viewport.width);
          // A page this account isn't allowed to open: the server refused (403), which is right.
          if (state.broken && !denied) problems.push(`error screen: ${state.title}`);
          if (size === 'phone' && state.overflow > 2) problems.push(`scrolls sideways by ${state.overflow}px on a phone`);
          if (size === 'phone' && state.squeezed.length) problems.push(`text squeezed to a sliver and stacked letter by letter: ${state.squeezed.join(', ')}`);
          const name = `${area}-${who}-${size}${p.replace(/\//g, '_') || '_'}.png`;
          await page.screenshot({ path: path.join(out, name), fullPage: true });
          results.push({ area, page: p, who, size, ok: !problems.length, denied: state.broken && denied, problems, screenshot: name });
        }
        // The menu is the first thing people see: check the sidebar lists exactly what this role should.
        if (size === 'desktop' && only !== 'app') {
          problems = [];
          await page.goto(`${base}/#/`);
          await page.waitForSelector('[data-nav] a');
          const seen = await page.$$eval('[data-nav] a', (as) => as.map((a) => a.querySelector('span').textContent.trim()));
          const links = await page.$$eval('[data-side-links] a', (as) => as.map((a) => a.getAttribute('aria-label')));
          const want = NAV_WANT[who];
          if (seen.join('|') !== want.join('|')) problems.push(`menu shows [${seen.join(', ')}] but should show [${want.join(', ')}]`);
          const wantLinks = who === 'admin' ? 'Settings|Help|Send feedback' : 'Help|Send feedback';
          if (links.join('|') !== wantLinks) problems.push(`links beside the name: saw [${links.join(', ')}], want [${wantLinks}]`);
          if (!(await page.locator('.side [data-campus]').count()) || (await page.locator('.side [data-nav]').evaluate((n) => n.previousElementSibling?.matches('.side-campus')) !== true)) problems.push('campus picker is not at the top of the sidebar');
          if (who === 'admin') {
            const tag = page.locator('[data-campus-tag]');
            await page.selectOption('.side [data-campus]', { index: 1 });
            await page.goto(`${base}/#/people`);
            await page.waitForTimeout(500);
            if (!/ only$/.test(await tag.textContent()) || !(await tag.isVisible())) problems.push('no "… only" label with a campus picked');
            await page.screenshot({ path: path.join(out, `hub-${who}-desktop-campus-picked.png`) });
            await page.selectOption('.side [data-campus]', '');
            await page.waitForTimeout(300);
            if (await tag.isVisible()) problems.push('"… only" label still showing for all campuses');
          }
          results.push({ area: 'hub', page: '/ (sidebar menu)', who, size, ok: !problems.length, problems, screenshot: '' });
        }
        // The Bible studies page: tiles and tabs for coordinators and staff, and the card on a teacher's page.
        if (['admin', 'staff', 'coordinator'].includes(who) && only !== 'app') {
          problems = [];
          await page.goto(`${base}/#/studies`);
          await page.waitForSelector('.stats .stat', { timeout: 4000 }).catch(() => problems.push('Bible studies tiles did not appear'));
          const tiles = await page.$$eval('.stats .stat span', (s) => s.map((x) => x.textContent.trim()));
          if (tiles.join('|') !== 'Active studies|Paused|Finished this year|Waiting for a match') problems.push(`tiles show [${tiles.join(', ')}]`);
          const tabs = await page.$$eval('[role=tab]', (s) => s.map((x) => x.textContent.trim().replace(/\s+\d+$/, '')));
          if (tabs.join('|') !== 'Waiting|Studies|Teachers|Materials|People') problems.push(`tabs show [${tabs.join(', ')}]`);
          await page.click('[data-tab=waiting]');
          await page.waitForSelector('[data-start]', { timeout: 3000 }).catch(() => problems.push('The waiting request did not show'));
          // A 200-character topic must wrap, not push the page sideways.
          const over = await page.evaluate((vw) => document.documentElement.scrollWidth - vw, viewport.width);
          if (size === 'phone' && over > 2) problems.push(`The Waiting tab scrolls sideways by ${over}px on a phone`);
          await page.screenshot({ path: path.join(out, `hub-${who}-${size}-studies-waiting.png`), fullPage: true });
          await page.click('[data-tab=materials]');
          await page.waitForSelector('[data-add-material]', { timeout: 3000 }).catch(() => problems.push('The materials tab did not open'));
          await page.click('[data-tab=studies]');
          await page.waitForSelector('[data-study]', { timeout: 3000 }).catch(() => problems.push('No studies listed'));
          await page.screenshot({ path: path.join(out, `hub-${who}-${size}-studies-list.png`), fullPage: true });
          await page.click('[data-study]');
          await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => problems.push('A study did not open'));
          await page.screenshot({ path: path.join(out, `hub-${who}-${size}-studies-detail.png`) });
          await page.keyboard.press('Escape');
          // People view: find someone by name and get their card, with the Add button, without opening People.
          await page.click('[data-tab=people]');
          await page.fill('[data-q]', 'And');
          await page.waitForSelector('[data-list] button[data-i]', { timeout: 3000 }).catch(() => problems.push('People search found no one'));
          await page.click('[data-list] button[data-i]').catch(() => {});
          await page.waitForSelector('[data-card] [data-add-done]', { timeout: 3000 }).catch(() => problems.push('The People view did not show a card with Add a completed study'));
          const overP = await page.evaluate((vw) => document.documentElement.scrollWidth - vw, viewport.width);
          if (size === 'phone' && overP > 2) problems.push(`The People view scrolls sideways by ${overP}px on a phone`);
          await page.screenshot({ path: path.join(out, `hub-${who}-${size}-studies-people.png`), fullPage: true });
          if (who !== 'coordinator') {
            await page.goto(`${base}/#/people/${smokeStudyPerson}`);
            await page.waitForSelector('[data-studies] .card', { timeout: 4000 }).catch(() => problems.push('The Bible studies card did not appear on the person page'));
            await page.screenshot({ path: path.join(out, `hub-${who}-${size}-person-studies-card.png`), fullPage: true });
          }
          results.push({ area: 'hub', page: '/studies (tiles, tabs, a study, the person card)', who, size, ok: !problems.length, problems, screenshot: `hub-${who}-${size}-studies-list.png` });
        }
        // The forms editor's Save lives in the page header; once it silently did nothing. Click it for real.
        if (who === 'admin' && only !== 'app') {
          problems = [];
          await page.goto(`${base}/#/forms/new`);
          await page.waitForSelector('[data-actions] [data-save]');
          await page.click('[data-actions] [data-save]');
          const kind = await page.waitForSelector('.toast.bad', { timeout: 3000 }).then((t) => t.textContent()).catch(() => '');
          if (!/title/i.test(kind)) problems.push(`Create form with no title showed no kind message (saw "${kind}")`);
          await page.fill('input[name=title]', 'Smoke test form');
          const sent = page.waitForResponse((r) => r.url().endsWith('/api/admin/forms') && r.request().method() === 'POST', { timeout: 3000 }).catch(() => null);
          await page.click('[data-actions] [data-save]');
          const res = await sent;
          if (!res || res.status() !== 201) problems.push(`Create form did not POST /api/admin/forms (got ${res ? res.status() : 'no request'})`);
          // Let the page finish moving to the new form before the next step navigates, or its late header lands on the next page.
          await page.waitForURL(/#\/forms\/\d+/, { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
          results.push({ area: 'hub', page: '/forms/new (click Save)', who, size, ok: !problems.length, problems, screenshot: '' });
        }
        // Add a person, then "Save and add another" into the same family: the second person must land in the family the first one started.
        if (who === 'admin' && size === 'desktop' && only !== 'app') {
          problems = [];
          await page.goto(`${base}/#/people`);
          await page.waitForSelector('[data-add]');
          await page.click('[data-add]');
          await page.waitForSelector('dialog[open] input[name=first_name]');
          await page.fill('dialog[open] input[name=first_name]', 'Smokey');
          await page.fill('dialog[open] input[name=last_name]', 'Zzfamily');
          if (await page.locator('dialog[open] input[name=nickname]').isVisible()) problems.push('More details was open on the add screen');
          await page.click('dialog[open] button:has-text("Save and add another")');
          await page.waitForSelector('.toast:has-text("Added Smokey")', { timeout: 3000 }).catch(() => problems.push('Save and add another showed no confirmation'));
          if (!(await page.locator('dialog[open] [data-family] .pill:has-text("Zzfamily")').count())) problems.push('The second person was not set to join the family just started');
          await page.fill('dialog[open] input[name=first_name]', 'Kiddo');
          const sent = page.waitForResponse((r) => r.url().endsWith('/api/people') && r.request().method() === 'POST', { timeout: 3000 }).catch(() => null);
          await page.click('dialog[open] button[type=submit]');
          const res = await sent;
          if (!res || res.status() !== 201) problems.push(`Second person did not POST (got ${res ? res.status() : 'no request'})`);
          else {
            const kid = await res.json();
            await page.waitForURL(`${base}/#/people/${kid.id}`, { timeout: 3000 }).catch(() => problems.push('Did not open the new person'));
            const members = await page.evaluate(async (id) => (await (await fetch(`/api/people/${id}`)).json()).household?.members.map((m) => m.first_name).sort(), kid.id);
            if (JSON.stringify(members) !== JSON.stringify(['Kiddo', 'Smokey'])) problems.push(`Family has ${JSON.stringify(members)}, expected Kiddo and Smokey`);
          }
          results.push({ area: 'hub', page: '/people (add person, save and add another)', who, size, ok: !problems.length, problems, screenshot: '' });
        }
        // The phone's More sheet and the account menu: both must open and stay fully on screen.
        if (size === 'phone' && only !== 'app') {
          problems = [];
          const inView = (r) => r && r.left >= 0 && r.top >= 0 && r.right <= viewport.width + 0.5 && r.bottom <= viewport.height + 0.5;
          const rect = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }, sel);
          await page.goto(`${base}/#/`);
          await page.waitForSelector('[data-more]');
          await page.click('[data-more]');
          await page.waitForSelector('dialog.sheet[open]', { timeout: 3000 }).catch(() => problems.push('More did not open a sheet'));
          const out1 = await page.locator('dialog.sheet [data-logout]').isVisible().catch(() => false);
          if (!out1) problems.push('Sign out is not visible in the More sheet');
          else {
            await page.locator('dialog.sheet [data-logout]').scrollIntoViewIfNeeded();
            if (!inView(await rect('dialog.sheet [data-logout]'))) problems.push('Sign out is outside the screen in the More sheet');
          }
          if (!(await page.locator('dialog.sheet [data-theme-pick]').count())) problems.push('Appearance choices missing from the More sheet');
          await page.screenshot({ path: path.join(out, `hub-${who}-phone-more-sheet.png`) });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          if (await page.locator('dialog.sheet').count()) problems.push('Escape did not close the More sheet');
          await page.click('[data-me-top]');
          await page.waitForSelector('[data-me-top] .menu', { timeout: 3000 }).catch(() => problems.push('Account menu did not open'));
          if (!inView(await rect('[data-me-top] .menu'))) problems.push('Account menu runs off the screen');
          if (!inView(await rect('[data-me-top] .menu [data-logout]'))) problems.push('Sign out in the account menu is off the screen');
          await page.screenshot({ path: path.join(out, `hub-${who}-phone-account-menu.png`) });
          results.push({ area: 'hub', page: '/ (More sheet and account menu)', who, size, ok: !problems.length, problems, screenshot: `hub-${who}-phone-more-sheet.png` });
        }
        // Phone People list: filters hide behind a button, rows carry a call link, and Merge is in the "…" menu (admin only).
        if (size === 'phone' && only !== 'app' && ['admin', 'staff', 'leader'].includes(who)) {
          problems = [];
          await page.goto(`${base}/#/people`);
          await page.reload(); // closes the account menu left open by the step before
          await page.waitForSelector('.prow');
          if (await page.locator('[data-fpanel]').isVisible()) problems.push('Filters were open before the button was tapped');
          await page.click('[data-filters]');
          if (!(await page.locator('[data-fpanel]').isVisible())) problems.push('The Filters button did not open the filters');
          if (!(await page.locator('.prow a[href^="tel:"]').count())) problems.push('No call link on the People list');
          if (who === 'admin') await page.screenshot({ path: path.join(out, 'hub-admin-phone-people-filters.png') });
          await page.goto(`${base}/#/people`);
          await page.waitForSelector('.prow');
          await page.locator('.prow').first().click();
          await page.waitForSelector('[data-actions]', { state: 'attached' });
          await page.waitForTimeout(500);
          const menuBtn = page.locator('[data-actions] [data-kebab]');
          if (who === 'admin') {
            if (!(await menuBtn.count())) problems.push('No "…" menu on the person page for an admin');
            else {
              await menuBtn.click();
              if (!(await page.locator('[data-actions] [data-merge]').isVisible())) problems.push('Merge is not in the "…" menu');
            }
          } else if (await page.locator('[data-merge]').count()) problems.push('Merge duplicate is shown to someone who is not an admin');
          results.push({ area: 'hub', page: '/people (phone filters, call link, Merge menu)', who, size, ok: !problems.length, problems, screenshot: '' });
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.log(`✗ ${r.area} ${r.page} (${r.who}, ${r.size}): ${r.problems.join('; ')}`);
  const denied = results.filter((r) => r.denied);
  if (denied.length) console.log(`${denied.length} pages refused for accounts without access (expected): ${[...new Set(denied.map((r) => `${r.page} (${r.who})`))].join(', ')}`);
  console.log(`${results.length - failed.length}/${results.length} page checks passed. Screenshots and report.json in ${path.relative(root, out)}/`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
