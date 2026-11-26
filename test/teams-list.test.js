// The Teams list for leaders (who leads, which teams are mine, open spots at the next service),
// the roster's account flag, and Remind staying inside a leader's own teams. Dates are relative
// to "now", so nothing here depends on what day it is.
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
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-tl-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const person = (key, campus) => { ids[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id, email) VALUES (?, ?, ?, ?)').run(key, 'Test', campus, `${key}@example.org`).lastInsertRowid); };
  const make = (key, role, campuses, personId, active = 1) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id, active) VALUES (?, ?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId ?? null, active).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    return id;
  };
  const team = (key, campus) => {
    ids[key] = Number(db.prepare('INSERT INTO teams (name, campus_id) VALUES (?, ?)').run(`Team ${key}`, campus).lastInsertRowid);
    ids[`pos${key}`] = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(ids[key], `Role ${key}`).lastInsertRowid);
  };
  team('A', 1); team('B', 1); team('D', 2);
  for (const n of ['Lena', 'Ann', 'Dan', 'Gone', 'Otto', 'Bob']) person(n, 1);
  person('Mia', 2); person('Vic', 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1), (?, ?, 1), (?, ?, 1)').run(ids.A, ids.Lena, ids.B, ids.Otto, ids.D, ids.Mia);
  db.prepare('INSERT INTO team_members (team_id, person_id, position_id) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)').run(ids.A, ids.Ann, ids.posA, ids.A, ids.Dan, ids.posA, ids.A, ids.Gone, ids.posA);
  // A leader who also plays a position has two roster rows; they should still be named once.
  db.prepare('INSERT INTO team_members (team_id, person_id, position_id, is_leader) VALUES (?, ?, ?, 1)').run(ids.A, ids.Lena, ids.posA);
  make('admin', 'admin', null);
  make('staff', 'staff', null);
  make('lena', 'leader', '[1]', ids.Lena);
  make('mia', 'leader', '[2]', ids.Mia);
  make('vic', 'volunteer', null, ids.Vic);
  make('ann', 'volunteer', null, ids.Ann);
  make('gone', 'volunteer', null, ids.Gone, 0); // an account that can't sign in

  ids.svc = Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (1, ?, ?)').run('S', `${addDays(today(), 2)}T10:00`).lastInsertRowid);
  const need = (p, n) => db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, ?)').run(ids.svc, p, n);
  need(ids.posA, 3); need(ids.posB, 2);
  const assign = (p, pos, status) => db.prepare("INSERT INTO assignments (service_id, position_id, person_id, status, sent_at) VALUES (?, ?, ?, ?, '2020-01-01 00:00:00')").run(ids.svc, ids[`pos${pos}`], ids[p], status);
  assign('Ann', 'A', 'accepted'); assign('Dan', 'A', 'pending');
  assign('Bob', 'B', 'pending');
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const byName = (list, name) => list.find((t) => t.name === name);

test('a leader gets open spots for their own team and null for the others', async () => {
  const { data } = await api('lena', 'GET', '/teams');
  const a = byName(data, 'Team A');
  assert.equal(a.mine, true);
  assert.deepEqual(a.leader_names, ['Lena Test']);
  assert.equal(a.open_next.service_id, ids.svc);
  assert.deepEqual([a.open_next.needed, a.open_next.open], [3, 1]);
  assert.ok(a.open_next.starts_at.startsWith(addDays(today(), 2)));
  const b = byName(data, 'Team B');
  assert.equal(b.mine, false);
  assert.deepEqual(b.leader_names, ['Otto Test'], 'who leads is fine to see');
  assert.equal(b.open_next, null, 'open spots of a team they don’t lead stay hidden');
});

test('staff see open spots for every team, and mine only where they lead', async () => {
  const { data } = await api('staff', 'GET', '/teams');
  assert.deepEqual([byName(data, 'Team A').open_next.open, byName(data, 'Team B').open_next.open], [1, 1]);
  assert.equal(data.some((t) => t.mine), false);
});

test('a team with no service in the next 7 days has no open_next', async () => {
  const { data } = await api('mia', 'GET', '/teams');
  const d = byName(data, 'Team D');
  assert.equal(d.mine, true);
  assert.equal(d.open_next, null);
  assert.equal(byName(data, 'Team A'), undefined, 'campus scoping still applies');
});

test('a volunteer gets none of the new fields', async () => {
  const { status, data } = await api('vic', 'GET', '/teams');
  assert.equal(status, 200);
  assert.ok(data.length >= 2);
  for (const t of data) for (const k of ['leader_names', 'mine', 'open_next']) assert.equal(k in t, false, `${k} is for leaders`);
});

test('the roster says who has an account, yes or no only', async () => {
  const { status, data } = await api('lena', 'GET', `/teams/${ids.A}`);
  assert.equal(status, 200);
  const flag = (n) => data.members.find((m) => m.person_id === ids[n]).has_account;
  assert.equal(flag('Ann'), true);
  assert.equal(flag('Dan'), false);
  assert.equal(flag('Gone'), false, 'an account that can’t sign in doesn’t count');
  assert.equal(flag('Lena'), true);
  assert.ok(data.members.every((m) => typeof m.has_account === 'boolean'));
  assert.equal((await api('ann', 'GET', `/teams/${ids.A}`)).status, 403, 'volunteers still can’t open a roster');
});

test('Remind stays inside a leader’s own teams', async () => {
  assert.equal((await api('lena', 'POST', `/services/${ids.svc}/remind`, { team_id: ids.B })).status, 403);
  const ok = await api('lena', 'POST', `/services/${ids.svc}/remind`, { team_id: ids.A });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.reminded + ok.data.skipped, 1, 'Dan, who hasn’t replied');
  assert.equal((await api('staff', 'POST', `/services/${ids.svc}/remind`, { team_id: ids.B })).status, 200);
});
