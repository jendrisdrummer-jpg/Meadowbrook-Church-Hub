// Home's "needs your attention" counts and the leader's team card. Each person only counts what
// they can reach: their campuses, and (for a leader who isn't staff) the teams they lead.
// Dates are relative to "now", two days out, so nothing depends on what day it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

let server, base, db;
const cookies = {};
const ids = {};
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ha-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago'), (3, 'East', 'East', 'America/Chicago');`);
  const person = (key, campus) => { ids[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id) VALUES (?, ?, ?)').run(key, 'Test', campus).lastInsertRowid); };
  const make = (key, role, campuses, personId) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId ?? null).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  const team = (key, campus) => {
    ids[key] = Number(db.prepare('INSERT INTO teams (name, campus_id) VALUES (?, ?)').run(`Team ${key}`, campus).lastInsertRowid);
    ids[`pos${key}`] = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(ids[key], `Role ${key}`).lastInsertRowid);
  };
  team('A', 1); team('B', 1); team('C', 2);
  for (const n of ['Lena', 'Ann', 'Cara', 'Dan', 'Bob', 'Eve']) person(n, 1);
  person('Sue', 2); person('Vic', 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(ids.A, ids.Lena);
  db.prepare('INSERT INTO team_members (team_id, person_id, position_id) VALUES (?, ?, ?), (?, ?, ?)').run(ids.A, ids.Ann, ids.posA, ids.A, ids.Dan, ids.posA);
  db.prepare('INSERT INTO chats (kind, team_id) VALUES (?, ?)').run('team', ids.A);
  make('admin', 'admin', null);
  make('nstaff', 'staff', '[1]');
  make('sstaff', 'staff', '[2]');
  make('estaff', 'staff', '[3]');
  make('lena', 'leader', '[1]', ids.Lena);
  make('vic', 'volunteer', null, ids.Vic);

  const svc = (campus) => Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, 'S', `${addDays(today(), 2)}T10:00`).lastInsertRowid);
  ids.svcN = svc(1); ids.svcS = svc(2);
  const need = (s, p, n) => db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, ?)').run(s, p, n);
  need(ids.svcN, ids.posA, 3); need(ids.svcN, ids.posB, 2); need(ids.svcS, ids.posC, 2);
  const assign = (s, p, who, status, reason = '') => db.prepare('INSERT INTO assignments (service_id, position_id, person_id, status, decline_reason, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(s, p, ids[who], status, reason, '2020-01-01 00:00:00');
  assign(ids.svcN, ids.posA, 'Ann', 'accepted'); assign(ids.svcN, ids.posA, 'Cara', 'declined'); assign(ids.svcN, ids.posA, 'Dan', 'pending');
  assign(ids.svcN, ids.posB, 'Bob', 'pending'); assign(ids.svcN, ids.posB, 'Eve', 'declined');
  assign(ids.svcS, ids.posC, 'Sue', 'pending');
  // Connect cards: two open at North, one at South, one finished at North.
  const card = (campus, done) => db.prepare('INSERT INTO connect_cards (campus_id, first_name, done_at) VALUES (?, ?, ?)').run(campus, 'Guest', done ? '2020-01-01 00:00:00' : null);
  card(1); card(1); card(2); card(1, true);
  // App sign-ups waiting for a welcome: one per campus.
  db.prepare("UPDATE people SET signed_up_at = '2020-01-01 00:00:00' WHERE id IN (?, ?)").run(ids.Vic, ids.Sue);
  // Forms: church-wide (2 new), North (1 new), South (1 new, 1 done).
  const form = (slug, campus, statuses) => {
    const f = Number(db.prepare('INSERT INTO forms (slug, title, campus_id) VALUES (?, ?, ?)').run(slug, `Form ${slug}`, campus).lastInsertRowid);
    for (const st of statuses) db.prepare('INSERT INTO form_responses (form_id, status) VALUES (?, ?)').run(f, st);
  };
  form('wide', null, ['new', 'new']); form('north', 1, ['new']); form('south', 2, ['new', 'done']);
});
after(() => server.close());

async function api(role, url) {
  const res = await fetch(`${base}/api${url}`, { headers: { 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) } });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const dash = async (role) => (await api(role, '/dashboard')).data;

test('a leader’s counts cover their own teams only', async () => {
  const a = (await dash('lena')).attention;
  assert.equal(a.open_spots, 1, 'Team A has one open spot; Team B’s are not theirs');
  assert.equal(a.not_replied, 1, 'Dan');
  assert.equal(a.declines, 1, 'Cara’s spot is still open');
  assert.equal(a.forms_new, 0, 'form responses are for staff');
  assert.equal(a.connect_cards, 2);
  assert.equal(a.signups, 1);
  const light = (await api('lena', '/attention')).data;
  assert.deepEqual([light.open_spots, light.not_replied, light.declines, light.connect_cards, light.forms_new], [1, 1, 1, 2, 0]);
});

test('admin and staff counts follow their campuses', async () => {
  const all = (await dash('admin')).attention;
  assert.deepEqual([all.open_spots, all.not_replied, all.declines, all.connect_cards, all.signups, all.forms_new], [3, 3, 2, 3, 2, 4]);
  const north = (await dash('nstaff')).attention;
  assert.deepEqual([north.open_spots, north.not_replied, north.declines, north.connect_cards, north.signups], [2, 2, 2, 2, 1]);
  const south = (await dash('sstaff')).attention;
  assert.deepEqual([south.open_spots, south.not_replied, south.declines, south.connect_cards, south.signups], [1, 1, 0, 1, 1]);
});

test('for campus-limited staff the forms count leaves out church-wide forms and other campuses', async () => {
  assert.equal((await dash('nstaff')).attention.forms_new, 1, 'only the North form');
  assert.equal((await dash('nstaff')).attention.forms_title, 'Form north');
  assert.equal((await dash('sstaff')).attention.forms_new, 1, 'only the South form (its done response isn’t counted)');
  assert.equal((await api('nstaff', '/attention')).data.forms_new, 1);
});

test('a North person does not count South connect cards, sign-ups or services', async () => {
  const north = (await api('nstaff', '/attention')).data;
  assert.equal(north.connect_cards, 2);
  assert.equal(north.signups, 1);
  const lena = (await api('lena', '/attention')).data;
  assert.equal(lena.connect_cards, 2, 'a leader limited to North');
});

test('a volunteer gets no staff counts', async () => {
  const light = (await api('vic', '/attention')).data;
  assert.deepEqual(Object.values(light), [0, 0, 0, 0, 0, 0]);
  const d = await dash('vic');
  assert.equal(d.attention, undefined);
  assert.equal(d.services, undefined);
  assert.equal((await api(null, '/attention')).status, 401, 'signed in only');
});

test('every count is 0 when nothing is waiting', async () => {
  const a = (await dash('estaff')).attention;
  assert.deepEqual([a.open_spots, a.not_replied, a.declines, a.connect_cards, a.signups, a.forms_new], [0, 0, 0, 0, 0, 0]);
  assert.equal(a.forms_title, null);
  assert.equal(a.open_next, null);
});

test('my_teams: a leader sees the teams they lead, with where each stands', async () => {
  const d = await dash('lena');
  assert.equal(d.my_teams.length, 1);
  const t = d.my_teams[0];
  assert.equal(t.name, 'Team A');
  assert.deepEqual([t.open_spots, t.not_replied, t.declines], [1, 1, 1]);
  assert.equal(t.members, 3);
  assert.ok(t.chat_id, 'the team chat to message');
  assert.ok(t.next_service.startsWith(addDays(today(), 2)));
  assert.deepEqual((await dash('admin')).my_teams, [], 'not leading a team');
});

test('Home’s week rows carry totals for the progress bar, limited for a leader', async () => {
  const lena = (await dash('lena')).services;
  assert.equal(lena.length, 1);
  assert.deepEqual([lena[0].needed, lena[0].filled, lena[0].waiting], [3, 2, 1]);
  assert.deepEqual(lena[0].positions, [{ name: 'Role A', needed: 3, filled: 2 }]);
  const admin = (await dash('nstaff')).services[0];
  assert.deepEqual([admin.needed, admin.filled], [5, 3]);
});
