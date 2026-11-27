// Customise Home: each account's own choice of Home cards (users.home_layout). Own database; no dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { HOME_CARDS } from '../server/routes/me.js';

let server, base, db, upDir;
const cookies = {};
const U = {};

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hl-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [key, role] of [['staff', 'staff'], ['other', 'staff'], ['vol', 'volunteer']]) {
    const id = Number(db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(`${key}@mb.org`, role).lastInsertRowid);
    U[key] = id;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

async function api(who, method, url, body, headers = { 'x-mb': '1' }) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', ...headers, ...(cookies[who] ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const stored = (who) => db.prepare('SELECT home_layout FROM users WHERE id = ?').get(U[who]).home_layout;

test('migration 39: users.home_layout exists and is empty (the standard Home) for everyone', () => {
  assert.ok(SCHEMA_VERSION >= 39);
  const col = db.prepare('PRAGMA table_info(users)').all().find((c) => c.name === 'home_layout');
  assert.ok(col);
  assert.equal(col.notnull, 0);
  assert.equal(stored('staff'), null);
});

test('a person saves and reloads their own layout through /me', async () => {
  assert.equal((await api('staff', 'GET', '/me')).data.homeLayout, null);
  const layout = { order: ['away', 'attention', 'services'], hidden: ['attendance'] };
  const put = await api('staff', 'PUT', '/me/home-layout', layout);
  assert.equal(put.status, 200);
  assert.deepEqual(put.data.home_layout, layout);
  assert.deepEqual((await api('staff', 'GET', '/me')).data.homeLayout, layout);
  // Someone else's Home is untouched.
  assert.equal(stored('other'), null);
  assert.equal((await api('other', 'GET', '/me')).data.homeLayout, null);
});

test('there is no way to name another account: an id in the body or URL changes nothing', async () => {
  await api('staff', 'PUT', '/me/home-layout', { order: ['services'], hidden: [], user_id: U.other, id: U.other });
  assert.equal(stored('other'), null);
  assert.equal((await api('staff', 'PUT', `/me/home-layout/${U.other}`, { order: [], hidden: [] })).status, 404);
  assert.equal(stored('other'), null);
});

test('bad layouts are refused with a plain message and nothing is saved', async () => {
  const before = stored('staff');
  for (const body of [
    { order: ['nope'], hidden: [] }, { order: [], hidden: ['<script>'] }, { order: 'services', hidden: [] }, { order: [], hidden: null }, {},
    { order: ['services', 'services'], hidden: [] }, { order: [...HOME_CARDS, ...HOME_CARDS], hidden: [] }, { order: Array(500).fill('services'), hidden: [] },
  ]) {
    const r = await api('staff', 'PUT', '/me/home-layout', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(r.data.error, /cards|list/);
  }
  assert.equal(stored('staff'), before);
});

test('it needs x-mb and a signed-in account; reset goes back to the standard Home', async () => {
  assert.equal((await api('staff', 'PUT', '/me/home-layout', { order: [], hidden: [] }, {})).status, 403);
  assert.equal((await api('staff', 'DELETE', '/me/home-layout', null, {})).status, 403);
  assert.equal((await api(null, 'PUT', '/me/home-layout', { order: [], hidden: [] })).status, 401);
  assert.equal((await api(null, 'DELETE', '/me/home-layout')).status, 401);
  assert.notEqual(stored('staff'), null);
  const r = await api('staff', 'DELETE', '/me/home-layout');
  assert.equal(r.status, 200);
  assert.equal(stored('staff'), null);
  assert.equal((await api('staff', 'GET', '/me')).data.homeLayout, null);
});

test('a volunteer may keep a layout too; a damaged saved value reads as the standard Home', async () => {
  assert.equal((await api('vol', 'PUT', '/me/home-layout', { order: ['serving'], hidden: [] })).status, 200);
  db.prepare("UPDATE users SET home_layout = '{not json' WHERE id = ?").run(U.vol);
  assert.equal((await api('vol', 'GET', '/me')).data.homeLayout, null);
});
