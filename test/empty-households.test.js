// Settings → Checks "Empty families": list and remove households nobody belongs to. Fixed data, no dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

process.env.MB_DEV_LOGIN = '1';
delete process.env.MB_ADMIN_EMAILS;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-emptyhh-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let db, server, base;
const cookies = {};
const hh = {};
const addHousehold = (name, campus = 1, notes = '') => Number(db.prepare('INSERT INTO households (name, campus_id, notes) VALUES (?, ?, ?)').run(name, campus, notes).lastInsertRowid);
const addUser = (email, role, campus = null) => Number(db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(email, role, campus && JSON.stringify(campus)).lastInsertRowid);
const login = (key, id) => startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
const call = async (who, method, url, body, { header = true } = {}) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', ...(header ? { 'x-mb': '1' } : {}), cookie: cookies[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const exists = (id) => Boolean(db.prepare('SELECT 1 FROM households WHERE id = ?').get(id));

before(async () => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago')`);
  server = createApp({ db, uploadDir: tmp }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  login('admin', addUser('a@x.test', 'admin'));
  login('north', addUser('n@x.test', 'admin', [1]));
  login('staff', addUser('s@x.test', 'staff'));
  login('leader', addUser('l@x.test', 'leader'));
  hh.emptyN = addHousehold('Empty North', 1);
  hh.emptyS = addHousehold('Empty South', 2);
  hh.emptyNone = addHousehold('Empty Church-wide', null);
  hh.active = addHousehold('Has Someone', 1);
  db.prepare('INSERT INTO people (first_name, household_id) VALUES (?, ?)').run('Ann', hh.active);
  hh.archived = addHousehold('Only Archived', 1);
  db.prepare('INSERT INTO people (first_name, household_id, archived) VALUES (?, ?, 1)').run('Old', hh.archived);
  hh.pickup = addHousehold('Has Pickup', 1);
  db.prepare("INSERT INTO household_pickups (household_id, name) VALUES (?, 'Grandma')").run(hh.pickup);
  hh.notes = addHousehold('Has Notes', 1, 'Pastoral note');
});
after(() => server.close());

test('lists only truly empty households', async () => {
  const r = await call('admin', 'GET', '/households/empty');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.households.map((h) => h.id).sort(), [hh.emptyN, hh.emptyS, hh.emptyNone].sort());
  assert.equal(r.data.count, 3);
  assert.ok(r.data.households.every((h) => 'name' in h && 'created_at' in h && 'updated_at' in h && 'campus' in h));
});

test('only admins can list or remove', async () => {
  for (const who of ['staff', 'leader']) {
    assert.equal((await call(who, 'GET', '/households/empty')).status, 403, who);
    assert.equal((await call(who, 'POST', '/households/empty/remove', { ids: [hh.emptyN] })).status, 403, who);
  }
  assert.ok(exists(hh.emptyN));
});

test('removing needs the app header', async () => {
  const r = await call('admin', 'POST', '/households/empty/remove', { ids: [hh.emptyN] }, { header: false });
  assert.equal(r.status, 403);
  assert.ok(exists(hh.emptyN));
});

test('households with an archived person, pickup, or notes are never removed', async () => {
  const r = await call('admin', 'POST', '/households/empty/remove', { ids: [hh.active, hh.archived, hh.pickup, hh.notes] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { removed: 0, skipped: 4 });
  for (const id of [hh.active, hh.archived, hh.pickup, hh.notes]) assert.ok(exists(id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM household_pickups').get().n, 1);
});

test('a campus-limited admin sees and removes only their own campus', async () => {
  const list = await call('north', 'GET', '/households/empty');
  assert.deepEqual(list.data.households.map((h) => h.id), [hh.emptyN]);
  const r = await call('north', 'POST', '/households/empty/remove', { ids: [hh.emptyS, hh.emptyNone] });
  assert.deepEqual(r.data, { removed: 0, skipped: 2 });
  assert.ok(exists(hh.emptyS) && exists(hh.emptyNone));
});

test('bad input is refused kindly', async () => {
  assert.equal((await call('admin', 'POST', '/households/empty/remove', { ids: [] })).status, 400);
  assert.equal((await call('admin', 'POST', '/households/empty/remove', {})).status, 400);
});

test('a household that gained a member after the list was shown is skipped; removal is audited', async () => {
  const seen = (await call('admin', 'GET', '/households/empty')).data.households.map((h) => h.id);
  assert.deepEqual([...seen].sort(), [hh.emptyN, hh.emptyS, hh.emptyNone].sort());
  db.prepare('INSERT INTO people (first_name, household_id) VALUES (?, ?)').run('Late', hh.emptyS);
  const r = await call('admin', 'POST', '/households/empty/remove', { ids: seen });
  assert.deepEqual(r.data, { removed: 2, skipped: 1 });
  assert.ok(exists(hh.emptyS));
  assert.ok(!exists(hh.emptyN) && !exists(hh.emptyNone));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people WHERE household_id = ?').get(hh.emptyS).n, 1);
  const a = db.prepare("SELECT * FROM audit_log WHERE action = 'household.remove_empty'").all();
  assert.equal(a.length, 1);
  const d = JSON.parse(a[0].detail);
  assert.equal(d.count, 2);
  assert.deepEqual([...d.ids].sort(), [hh.emptyN, hh.emptyNone].sort());
});
