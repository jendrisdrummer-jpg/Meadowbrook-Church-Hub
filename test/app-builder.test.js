// The "Edit the app" switch (users.app_editor) and the App Builder's server rules: who may save the
// app, who may grant the switch, dead links dropped on save, and the Announcement and Link list
// widgets. Own database; dates are passed in, never read from the clock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { appToday } from '../server/routes/app.js';
import { announcementLive, linkableTab, isDay, DEFAULT_APP } from '../public/js/app-widgets.js';

let server, base, db, upDir;
const cookies = {};
const U = {};

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ab-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  for (const [key, role, campuses, flag] of [['admin', 'admin', null, 0], ['north', 'admin', '[1]', 0], ['staff', 'staff', null, 0], ['staffFlag', 'staff', null, 1],
    ['leader', 'leader', null, 0], ['leaderFlag', 'leader', null, 1], ['vol', 'volunteer', null, 0], ['volFlag', 'volunteer', null, 1], ['gone', 'volunteer', null, 1]]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids, app_editor) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, flag).lastInsertRowid);
    U[key] = id;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(U.gone);
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

async function api(who, method, url, body) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(cookies[who] ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (who) => fetch(`${base}/api/app/images`, { method: 'POST', headers: { ...(cookies[who] ? { cookie: cookies[who] } : {}), 'x-mb': '1', 'content-type': 'image/png' }, body: png });
const current = async () => (await api(null, 'GET', '/app/config')).data.config;
const audits = (action) => db.prepare('SELECT user_id, detail FROM audit_log WHERE action = ?').all(action);

test('migration 38: users.app_editor, off by default', () => {
  assert.ok(SCHEMA_VERSION >= 38);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'app_editor' && c.dflt_value === '0'));
});

test('admins and flagged accounts save the app; everyone else is refused on every builder write', async () => {
  const cfg = await current();
  const next = { ...cfg, give_url: 'https://give.example.org' };
  for (const who of ['staff', 'leader', 'vol']) {
    assert.equal((await api(who, 'PUT', '/app/config', next)).status, 403, `${who} save`);
    assert.equal((await upload(who)).status, 403, `${who} upload`);
  }
  assert.equal((await api(null, 'PUT', '/app/config', next)).status, 401);
  assert.equal((await upload(null)).status, 401);
  for (const who of ['admin', 'staffFlag', 'leaderFlag', 'volFlag']) {
    const r = await api(who, 'PUT', '/app/config', { ...next, give_url: `https://give.example.org/${who}` });
    assert.equal(r.status, 200, `${who} save`);
    assert.equal((await upload(who)).status, 201, `${who} upload`);
  }
  assert.equal((await current()).give_url, 'https://give.example.org/volFlag');
  // An account that can't sign in loses it all with its session.
  assert.equal((await api('gone', 'PUT', '/app/config', next)).status, 401);
  // Reading what the member app needs stays public.
  assert.equal((await api(null, 'GET', '/app/config')).status, 200);
});

test('/me says who may edit the app', async () => {
  assert.equal((await api('admin', 'GET', '/me')).data.appEditor, true);
  assert.equal((await api('volFlag', 'GET', '/me')).data.appEditor, true);
  assert.equal((await api('staff', 'GET', '/me')).data.appEditor, false);
});

test('only an unrestricted admin grants the switch, and it is audited', async () => {
  assert.equal((await api('staff', 'PATCH', `/users/${U.vol}`, { app_editor: true })).status, 403);
  assert.equal((await api('staffFlag', 'PATCH', `/users/${U.vol}`, { app_editor: true })).status, 403); // the switch grants nothing about accounts
  // A campus-limited admin can't give or take it (it is church-wide, like Announcements).
  assert.equal((await api('north', 'PATCH', `/users/${U.vol}`, { app_editor: true })).status, 403);
  assert.equal((await api('north', 'POST', '/users', { email: 'new1@mb.org', role: 'volunteer', app_editor: true })).status, 403);
  assert.equal(db.prepare('SELECT app_editor a FROM users WHERE id = ?').get(U.vol).a, 0);
  // An account that holds it is out of a campus-limited admin's reach for any change.
  assert.equal((await api('north', 'PATCH', `/users/${U.volFlag}`, { active: false })).status, 403);
  assert.equal((await api('admin', 'PATCH', `/users/${U.vol}`, { app_editor: true })).status, 200);
  assert.equal(db.prepare('SELECT app_editor a FROM users WHERE id = ?').get(U.vol).a, 1);
  assert.equal((await api('vol', 'PUT', '/app/config', await current())).status, 200); // takes effect at once
  assert.ok(audits('user.update').some((a) => a.user_id === U.admin && JSON.parse(a.detail).app_editor === true));
  assert.equal((await api('admin', 'PATCH', `/users/${U.vol}`, { app_editor: false })).status, 200);
  assert.equal((await api('vol', 'PUT', '/app/config', await current())).status, 403);
  const made = await api('admin', 'POST', '/users', { email: 'new2@mb.org', role: 'staff', app_editor: true });
  assert.equal(made.status, 201);
  assert.equal(db.prepare('SELECT app_editor a FROM users WHERE id = ?').get(made.data.id).a, 1);
  assert.ok(audits('user.create').some((a) => /edit the app/.test(a.detail)));
  const list = (await api('admin', 'GET', '/users')).data.users;
  assert.ok(list.some((u) => u.id === made.data.id && u.app_editor));
});

test('Home is always on; buttons never keep a link to a tab that isn’t there', async () => {
  const cfg = await current();
  const tabs = [...cfg.tabs.filter((t) => t.type !== 'more').map((t) => (t.type === 'home' ? { ...t, on: false } : t)),
    { id: 'about', type: 'page', label: 'About', icon: 'info', on: false, title: 'Hi', body: 'x' },
    { id: 'site', type: 'link', label: 'Site', icon: 'link', on: false, url: 'https://a.example.org' }];
  const home = [
    { id: 'b1', type: 'button', label: 'Gone', icon: 'link', tab: 'deleted-tab' },
    { id: 'b2', type: 'button', label: 'Off page', icon: 'link', tab: 'about' },
    { id: 'b3', type: 'button', label: 'Link tab', icon: 'link', tab: 'site' },
    { id: 'b4', type: 'button', label: 'Give', icon: 'heart', tab: 'give' },
    { id: 'b5', type: 'button', label: 'Mine', icon: 'heart', tab: 'giving' },
    { id: 'b6', type: 'button', label: 'More', icon: 'menu', tab: 'more' },
  ];
  const r = await api('admin', 'PUT', '/app/config', { ...cfg, tabs, home });
  assert.equal(r.status, 200);
  assert.equal(r.data.tabs.find((t) => t.type === 'home').on, true);
  assert.deepEqual(r.data.home.map((w) => w.tab), [undefined, undefined, undefined, 'give', 'giving', 'more']);
  // The same page switched on keeps its buttons.
  const on = await api('admin', 'PUT', '/app/config', { ...cfg, tabs: tabs.map((t) => (t.id === 'about' ? { ...t, on: true } : t.id === 'serve' ? { ...t, on: false } : t)), home });
  assert.equal(on.status, 200);
  assert.equal(on.data.home[1].tab, 'about');
  assert.ok(linkableTab(on.data.tabs, 'about') && !linkableTab(on.data.tabs, 'nope') && linkableTab(on.data.tabs, 'giving'));
});

test('Announcement widget: headline required, limits, end date', async () => {
  const cfg = await current();
  const put = (w) => api('admin', 'PUT', '/app/config', { ...cfg, home: [w] });
  assert.equal((await put({ id: 'a', type: 'announcement', text: 'x' })).status, 400); // no headline
  const long = await put({ id: 'a', type: 'announcement', title: 'T'.repeat(200), text: 'x'.repeat(900), url: 'https://e.example.org', ends: '2030-01-31' });
  assert.equal(long.status, 200);
  assert.equal(long.data.home[0].title.length, 80);
  assert.equal(long.data.home[0].text.length, 300);
  assert.equal(long.data.home[0].ends, '2030-01-31');
  assert.equal(long.data.home[0].url, 'https://e.example.org');
  assert.equal(long.data.home[0].size, 'F');
  assert.equal((await put({ id: 'a', type: 'announcement', title: 'Hi', ends: '2030-02-31' })).status, 400); // not a real day
  assert.equal((await put({ id: 'a', type: 'announcement', title: 'Hi', url: 'javascript:alert(1)' })).status, 400);
  const tab = await put({ id: 'a', type: 'announcement', title: 'Hi', tab: 'give' });
  assert.equal(tab.data.home[0].tab, 'give');
  assert.equal(tab.data.home[0].ends, undefined);
});

test('an announcement hides the day after its end date, by the church’s own date', () => {
  const w = { ends: '2026-03-01' };
  assert.equal(announcementLive(w, '2026-02-28'), true);
  assert.equal(announcementLive(w, '2026-03-01'), true);
  assert.equal(announcementLive(w, '2026-03-02'), false);
  assert.equal(announcementLive({}, '2099-01-01'), true);
  // 03:00 UTC on 1 March is still the evening of 28 February in Chicago.
  assert.equal(appToday(db, new Date('2026-03-01T03:00:00Z')), '2026-02-28');
  assert.equal(appToday(db, new Date('2026-03-01T15:00:00Z')), '2026-03-01');
  assert.ok(isDay('2026-02-28') && !isDay('2026-02-30') && !isDay('2026-13-01') && !isDay(''));
});

test('the app config tells the app today’s date', async () => {
  assert.match((await api(null, 'GET', '/app/config')).data.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('Link list widget: up to 8 links, each with text and somewhere to go', async () => {
  const cfg = await current();
  const links = Array.from({ length: 11 }, (_, i) => ({ label: `Link ${i}`, url: `https://x.example.org/${i}` }));
  links[1] = { label: 'Not here', tab: 'nowhere' };
  links[2] = { label: '', url: 'https://x.example.org/blank' };
  links[3] = { label: 'L'.repeat(90), tab: 'give' };
  const r = await api('admin', 'PUT', '/app/config', { ...cfg, home: [{ id: 'l', type: 'linklist', title: 'Quick links', links }] });
  assert.equal(r.status, 200);
  const out = r.data.home[0].links;
  assert.ok(out.length <= 8);
  assert.ok(!out.some((x) => x.label === 'Not here' || x.label === ''));
  assert.equal(out.find((x) => x.tab === 'give').label.length, 40);
  assert.equal(r.data.home[0].size, 'F');
  assert.equal((await api('admin', 'PUT', '/app/config', { ...cfg, home: [{ id: 'l', type: 'linklist', links: [{ label: 'Bad', url: 'ftp://x' }] }] })).status, 400);
});

test('the starting layout is a valid save', async () => {
  const cfg = await current();
  const r = await api('admin', 'PUT', '/app/config', { ...cfg, tabs: DEFAULT_APP.tabs, home: DEFAULT_APP.home });
  assert.equal(r.status, 200);
  // "I’m new here" opens the Connect tab, which is built in and stays reachable while switched off.
  assert.equal(r.data.home.find((w) => w.id === 'new').tab, 'connect');
});

test('picture uploads must really be pictures, are capped per hour, and are audited', async () => {
  const send = (body, type = 'image/png') => fetch(`${base}/api/app/images`, { method: 'POST', headers: { cookie: cookies.leaderFlag, 'x-mb': '1', 'content-type': type }, body });
  assert.equal((await send(Buffer.from('<html><script>alert(1)</script></html>'))).status, 400, 'HTML sent as a PNG is refused');
  const ok = await send(png, 'image/png; x=1');
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).url, /\.png$/, 'the saved name comes from the file itself');
  assert.ok(audits('app.image').length >= 1);
  let last;
  for (let i = 0; i < 31; i++) last = await send(png);
  assert.equal(last.status, 429);
});

test('links must be https, and a newly added website is written to the audit log', async () => {
  const cfg = await current();
  const withLink = (u) => ({ ...cfg, home: [...cfg.home, { id: 'lk', type: 'button', size: 'M', style: 'soft', label: 'Site', icon: 'link', url: u }] });
  assert.equal((await api('admin', 'PUT', '/app/config', withLink('http://example.org/'))).status, 400);
  assert.equal((await api('admin', 'PUT', '/app/config', withLink('https://example.org/new'))).status, 200);
  const last = db.prepare("SELECT detail FROM audit_log WHERE action = 'app.config' ORDER BY id DESC LIMIT 1").get();
  assert.match(last.detail, /https:\/\/example\.org\/new/);
});
