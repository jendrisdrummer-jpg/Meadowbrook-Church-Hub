// Kids' check-in access (child-safety V1, PR 4): staff, admins and paired iPads always; anyone else only
// with the per-account switch (users.checkin). The station token wins over a hub session, the roster
// is smaller, and the check-in page has its own stricter headers. Fixed clock; no test depends on today's date.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, setSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession, canCheckin, canCheckinCampus } from '../server/auth.js';

const T0 = '2027-02-21T15:30:00Z';
let server, base, db;
const cookies = {};
const ids = {};
let token;

const mk = (key, role, campuses, extra = '') => {
  const id = db.prepare(`INSERT INTO users (email, role, campus_ids${extra ? ', checkin' : ''}) VALUES (?, ?, ?${extra ? ', 1' : ''})`).run(`${key}@mb.org`, role, campuses).lastInsertRowid;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  ids[key] = Number(id);
};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ca-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  mk('admin', 'admin', null);
  mk('northadmin', 'admin', '[1]');
  mk('staff', 'staff', null);
  mk('leader', 'leader', '[1]');
  mk('leaderOn', 'leader', '[1]', 'on');
  mk('volOn', 'volunteer', '[1]', 'on');
  mk('volOnNoList', 'volunteer', null, 'on');
  mk('vol', 'volunteer', null);

  const hh = (n, c) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(n, c).lastInsertRowid);
  const person = (f, l, h, role, extra = {}) => Number(db.prepare(`INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, birthdate, allergies, medical_notes, phone, photo)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(f, l, h, role, role === 'child' ? '2020-01-01' : '1980-05-05', extra.allergies ?? '', extra.medical ?? '', extra.phone ?? '', extra.photo ?? '').lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhS = hh('Sol', 2);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult', { phone: '555-0101', allergies: 'ADULT-ALLERGY', medical: 'ADULT-MED', photo: 'ann.jpg' });
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child', { allergies: 'peanuts', medical: 'asthma', photo: 'abe.jpg' });
  ids.sol = person('Sal', 'Sol', ids.hhS, 'child');
  db.prepare("INSERT INTO household_pickups (household_id, name, relationship) VALUES (?, 'Uncle Al', 'uncle')").run(ids.hhA);
  db.prepare("INSERT INTO household_pickups (household_id, name, relationship) VALUES (?, 'Aunt Sue', 'aunt')").run(ids.hhS);

  const p = (await call({}, 'POST', '/checkin/pair', { device: 'iPad' })).data;
  assert.equal((await call({ cookie: cookies.admin }, 'POST', '/checkin/devices', { code: p.code, name: 'Lobby', campus_id: 1 })).status, 201);
  token = (await call({}, 'GET', `/checkin/pair/${p.secret}`)).data.token;
});
after(() => { mock.timers.reset(); server.close(); });

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const api = (who, method, url, body) => call(who ? { cookie: cookies[who] } : {}, method, url, body);

test('migration 43 copies the old grant: leaders on the list keep access, nothing else changes', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-m43-')), 'x.db');
  let d = openDb(file);
  const add = (e, role) => Number(d.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(e, role).lastInsertRowid);
  const l1 = add('l1@t', 'leader'); const l2 = add('l2@t', 'leader'); const v1 = add('v1@t', 'volunteer'); const s1 = add('s1@t', 'staff');
  setSetting(d, 'checkin_user_ids', [l1, v1, s1, 9999]);
  d.exec('ALTER TABLE users DROP COLUMN checkin; PRAGMA user_version = 42');
  d.close();
  d = openDb(file);
  const flag = (id) => d.prepare('SELECT checkin FROM users WHERE id = ?').get(id).checkin;
  assert.deepEqual([flag(l1), flag(l2), flag(v1), flag(s1)], [1, 0, 0, 0], 'only the listed leader; a volunteer never had it; staff are automatic');
  assert.ok(d.prepare("SELECT 1 FROM settings WHERE key = 'checkin_user_ids'").get(), 'the old setting is left in place');
  d.close();
});

test('who may use check-in: stations, staff and admins automatically; others only with the switch', async () => {
  assert.equal(canCheckin({ role: 'volunteer', station: {} }), true);
  assert.equal(canCheckin({ role: 'staff' }), true);
  assert.equal(canCheckin({ role: 'leader' }), false);
  assert.equal(canCheckin({ role: 'volunteer', checkin: true }), true);
  for (const [who, want] of [['admin', 200], ['staff', 200], ['leaderOn', 200], ['volOn', 200], ['leader', 403], ['vol', 403], ['volOnNoList', 403]]) {
    assert.equal((await api(who, 'GET', '/checkin/roster?campus_id=1')).status, want, who);
  }
  assert.equal((await api(null, 'GET', '/checkin/roster?campus_id=1')).status, 401);
});

test('campus limits: a switch-only account stays at its campuses and fails closed without a list', async () => {
  assert.equal((await api('volOn', 'GET', '/checkin/roster?campus_id=2')).status, 403);
  assert.equal((await api('leaderOn', 'GET', '/checkin/roster?campus_id=2')).status, 403);
  const u = { role: 'volunteer', checkin: true, campusIds: null };
  assert.equal(canCheckinCampus(db, u, 1), false, 'no list on a multi-campus church means none');
  assert.deepEqual((await api('volOn', 'GET', '/checkin/campuses')).data.map((c) => c.id), [1]);
  assert.deepEqual((await api('volOnNoList', 'GET', '/checkin/campuses')).data, []);
});

test('granting the switch: any admin, audited; a volunteer needs a campus list; a limited admin stays in their campuses', async () => {
  const v = Number(db.prepare("INSERT INTO users (email, role) VALUES ('newvol@mb.org', 'volunteer')").run().lastInsertRowid);
  assert.equal((await api('staff', 'PATCH', `/users/${v}`, { checkin: true })).status, 403, 'only admins grant it');
  assert.equal((await api('admin', 'PATCH', `/users/${v}`, { checkin: true })).status, 400, 'a volunteer needs a campus list');
  assert.equal((await api('northadmin', 'PATCH', `/users/${v}`, { checkin: true, campus_ids: [2] })).status, 403);
  assert.equal((await api('admin', 'PATCH', `/users/${v}`, { checkin: true, campus_ids: [1] })).status, 200);
  assert.equal(db.prepare('SELECT checkin FROM users WHERE id = ?').get(v).checkin, 1);
  const row = db.prepare("SELECT detail FROM audit_log WHERE action = 'user.checkin' ORDER BY id DESC").get();
  assert.deepEqual(JSON.parse(row.detail), { user_id: v, granted: true });
  assert.equal((await api('admin', 'GET', '/users')).data.users.find((x) => x.id === v).checkin, true);
  assert.equal((await api('admin', 'PATCH', `/users/${v}`, { checkin: false })).status, 200);
  assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'user.checkin' ORDER BY id DESC").get().detail).granted, false);
  // The switch is used straight away: no switch, no roster.
  assert.equal(db.prepare('SELECT checkin FROM users WHERE id = ?').get(v).checkin, 0);
});

test('a linked volunteer still needs a campus list for the switch (the dialog always sends person_id)', async () => {
  const pid = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Lin', 'Ked', 1)").run().lastInsertRowid);
  const v = Number(db.prepare("INSERT INTO users (email, role, person_id) VALUES ('linked@mb.org', 'volunteer', ?)").run(pid).lastInsertRowid);
  assert.equal((await api('admin', 'PATCH', `/users/${v}`, { checkin: true, campus_ids: 'all', person_id: pid, role: 'volunteer' })).status, 400);
  assert.equal(db.prepare('SELECT checkin FROM users WHERE id = ?').get(v).checkin, 0);
  const pid2 = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Lin', 'Two', 1)").run().lastInsertRowid);
  assert.equal((await api('admin', 'POST', '/users', { email: 'linked2@mb.org', role: 'volunteer', checkin: true, person_id: pid2 })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/users/${v}`, { checkin: true, campus_ids: [1], person_id: pid, role: 'volunteer' })).status, 200);
});

test('the station token wins over a hub session', async () => {
  // An admin signed in on a kiosk: with the token, the request is the station's (its campus only).
  const both = { cookie: cookies.admin, 'x-station': token };
  assert.equal((await call(both, 'GET', '/checkin/roster?campus_id=1')).status, 200);
  assert.equal((await call(both, 'GET', '/checkin/roster?campus_id=2')).status, 403, 'the admin’s wider reach is not used');
  assert.equal((await call(both, 'GET', '/checkin/events?campus_id=1')).status, 403, 'a station never reads the record');
  assert.equal((await call(both, 'GET', '/checkin/station')).status, 200);
  // A removed or unknown token is refused even with a good session.
  assert.equal((await call({ cookie: cookies.admin, 'x-station': 'nope' }, 'GET', '/checkin/roster?campus_id=1')).status, 401);
  // Odd capitals or a trailing slash still reach the station check (Express ignores them when routing).
  assert.equal((await call(both, 'GET', '/CHECKIN/roster?campus_id=2')).status, 403);
  assert.equal((await call({ cookie: cookies.admin, 'x-station': 'nope' }, 'GET', '/Checkin/roster/?campus_id=1')).status, 401);
  // Without the token the session works as before.
  assert.equal((await call({ cookie: cookies.admin }, 'GET', '/checkin/roster?campus_id=2')).status, 200);
});

test('the roster is smaller: no photos, no adult birthdates or medical notes, pickups for this campus only; never cached', async () => {
  const res = await api('leaderOn', 'GET', '/checkin/roster?campus_id=1');
  assert.match(res.headers.get('cache-control'), /no-store/);
  const hhs = res.data.households;
  assert.deepEqual(hhs.map((h) => h.name), ['Aldrin']);
  const adult = hhs[0].members.find((m) => m.household_role === 'adult');
  const kid = hhs[0].members.find((m) => m.household_role === 'child');
  assert.equal(adult.phone, '555-0101');
  assert.equal(adult.birthdate, null);
  assert.equal(adult.allergies, null);
  assert.equal(adult.medical_notes, null);
  assert.ok(!JSON.stringify(res.data).includes('.jpg') && !('photo' in adult) && !('photo' in kid));
  assert.equal(kid.birthdate, '2020-01-01');
  assert.equal(kid.allergies, 'peanuts', 'children keep their allergies and notes for now');
  assert.deepEqual(hhs[0].pickups.map((p) => p.name), ['Uncle Al']);
  assert.ok(!JSON.stringify(res.data).includes('Aunt Sue'));
  const active = await api('staff', 'GET', '/checkin/active?campus_id=1');
  assert.match(active.headers.get('cache-control'), /no-store/);
});

test('the check-in page has its own headers: it cannot be framed, and loads only its own files', async () => {
  for (const url of ['/checkin', '/checkin/', '/Checkin', '/js/checkin.js', '/css/checkin.css']) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  }
  const hub = await fetch(`${base}/login`);
  assert.equal(hub.headers.get('x-frame-options'), 'SAMEORIGIN', 'the rest of the site is unchanged');
  assert.equal(hub.headers.get('content-security-policy'), null);
});
