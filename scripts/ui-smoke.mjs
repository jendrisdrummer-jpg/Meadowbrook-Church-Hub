// Browser smoke and regression check: seeds a throwaway demo database, starts the hub on a free
// port, and visits every main page of the hub and the member app as an admin, a campus staffer
// and a volunteer, at desktop and phone sizes. For each page it records script errors, server
// errors (5xx), "Something went wrong" screens and sideways scrolling on phones, and saves a
// screenshot. Exit code 1 if anything failed.
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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const HUB = ['/', '/my', '/chat', '/tasks', '/help', '/people', '/teams', '/groups', '/attendance', '/services', '/schedule', '/songs',
  '/events', '/templates', '/giving', '/media', '/media/podcast', '/connect', '/forms', '/forms/new', '/forms/1', '/forms/1/responses', '/announcements', '/app-builder', '/stations', '/settings', '/settings/checks'];
const APP = ['/', '/serve', '/events', '/watch', '/give', '/more', '/help', '/tasks', '/chat', '/form/volunteer-interest'];
const ACCOUNTS = [['admin', 'pastor@meadowbrook.church'], ['staff', 'south@meadowbrook.church'], ['volunteer', 'volunteer@meadowbrook.church']];
const SIZES = [['desktop', { width: 1360, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]];

async function main() {
  const { chromium } = loadPlaywright();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ui-'));
  const env = { ...process.env, MB_DB: path.join(tmp, 'demo.db'), MB_UPLOADS: path.join(tmp, 'uploads'), MB_DEV_LOGIN: '1' };
  // Never reach real outside services from a test run.
  for (const k of ['STRIPE_SECRET_KEY', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MB_DAILY_API_KEY', 'YOUTUBE_API_KEY', 'MB_SMTP_HOST', 'GOOGLE_CLIENT_ID']) delete env[k];
  execSync('node --disable-warning=ExperimentalWarning scripts/seed-demo.js', { cwd: root, env, stdio: 'ignore' });
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
          const state = await page.evaluate(() => ({
            broken: [...document.querySelectorAll('.alert.bad')].some((a) => /went wrong/i.test(document.title) || /Cannot|undefined|is not/.test(a.textContent)),
            title: document.title,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          }));
          // A page this account isn't allowed to open: the server refused (403), which is right.
          if (state.broken && !denied) problems.push(`error screen: ${state.title}`);
          if (size === 'phone' && state.overflow > 2) problems.push(`scrolls sideways by ${state.overflow}px on a phone`);
          const name = `${area}-${who}-${size}${p.replace(/\//g, '_') || '_'}.png`;
          await page.screenshot({ path: path.join(out, name), fullPage: true });
          results.push({ area, page: p, who, size, ok: !problems.length, denied: state.broken && denied, problems, screenshot: name });
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
          results.push({ area: 'hub', page: '/forms/new (click Save)', who, size, ok: !problems.length, problems, screenshot: '' });
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
