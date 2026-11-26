// Small fixes: "family" naming for new families, a leader's Home staying at their own campus, open
// spots that add up per position, connect cards agreeing between badge and Home, guests added on the
// roll showing on the follow-up list the same day, and the same-time service warning rule.
// Dates are relative to "now", so nothing here depends on what day it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { findClash } from '../public/js/service-clash.js';

let server, base, db;
const cookies = {};
const ids = {};
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-wp-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const person = (key, campus) => { ids[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id) VALUES (?, ?, ?)').run(key, 'Test', campus).lastInsertRowid); };
  const make = (key, role, campuses, personId) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId ?? null).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  const team = (key, campus) => {
    ids[key] = Number(db.prepare('INSERT INTO teams (name, campus_id) VALUES (?, ?)').run(`Team ${key}`, campus).lastInsertRowid);
    ids[`pos${key}`] = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(ids[key], `Role ${key}`).lastInsertRowid);
    ids[`pos${key}2`] = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(ids[key], `Other ${key}`).lastInsertRowid);
  };
  team('A', 1); team('W', null);
  for (const n of ['Lena', 'Wes', 'P1', 'P2', 'P3']) person(n, 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1), (?, ?, 1)').run(ids.A, ids.Lena, ids.W, ids.Wes);
  make('admin', 'admin', null);
  make('staff', 'staff', null);
  // Leaders whose accounts aren't limited to a campus (campus_ids empty).
  make('lena', 'leader', null, ids.Lena);
  make('wes', 'leader', null, ids.Wes);

  const svc = (campus, day = addDays(today(), 2)) => Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, 'S', `${day}T10:00`).lastInsertRowid);
  ids.svcN = svc(1); ids.svcS = svc(2);
  const need = (s, p, n) => db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, ?)').run(s, p, n);
  need(ids.svcN, ids.posA, 1); need(ids.svcN, ids.posA2, 2);
  const assign = (s, p, who, status) => db.prepare("INSERT INTO assignments (service_id, position_id, person_id, status, sent_at) VALUES (?, ?, ?, ?, '2020-01-01 00:00:00')").run(s, p, ids[who], status);
  // Role A is over-filled (3 people for 1); Other A has 2 spots and nobody.
  assign(ids.svcN, ids.posA, 'P1', 'accepted'); assign(ids.svcN, ids.posA, 'P2', 'accepted'); assign(ids.svcN, ids.posA, 'P3', 'pending');
  // Connect cards and a sign-up at North.
  db.prepare("INSERT INTO connect_cards (campus_id, first_name) VALUES (1, 'G1'), (1, 'G2')").run();
  db.prepare("UPDATE people SET signed_up_at = '2020-01-01 00:00:00' WHERE id = ?").run(ids.P1);
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('a new family is named "<Last> family"; existing names are left alone', async () => {
  const r = await api('admin', 'POST', '/people', { first_name: 'Ann', last_name: 'Diaz', campus_id: 1, new_household: true });
  assert.equal(r.status, 201);
  assert.equal(db.prepare('SELECT name FROM households WHERE id = ?').get(r.data.household_id).name, 'Diaz family');
  const old = db.prepare("INSERT INTO households (name, campus_id) VALUES ('Old Household', 1)").run().lastInsertRowid;
  assert.equal(db.prepare('SELECT name FROM households WHERE id = ?').get(old).name, 'Old Household');
  const csv = 'First,Last\nBea,Quinn\n';
  const imp = await api('admin', 'POST', '/import/people', { csv, mapping: { first_name: 'First', last_name: 'Last' }, campus_id: 1 });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.ok(db.prepare("SELECT 1 FROM households WHERE name = 'Quinn family'").get());
});

test('a leader’s Home lists only services at campuses of the teams they lead', async () => {
  const lena = (await api('lena', 'GET', '/dashboard')).data;
  assert.deepEqual(lena.services.map((s) => s.id), [ids.svcN], 'North team leader: no South row, even with an all-campus account');
  const wes = (await api('wes', 'GET', '/dashboard')).data;
  assert.deepEqual(wes.services.map((s) => s.id).sort(), [ids.svcN, ids.svcS].sort(), 'a church-wide team serves both campuses');
  const staff = (await api('staff', 'GET', '/dashboard')).data;
  assert.equal(staff.services.length, 2, 'staff see every campus they cover');
});

test('open spots add up per position, so an over-filled one does not hide another’s gap', async () => {
  const a = (await api('admin', 'GET', '/teams')).data.find((t) => t.name === 'Team A');
  assert.deepEqual([a.open_next.needed, a.open_next.open], [3, 2], '3 needed; Role A is over-filled, Other A is empty');
  const mine = (await api('lena', 'GET', '/dashboard')).data.my_teams.find((t) => t.name === 'Team A');
  assert.equal(mine.open_spots, 2, 'Home’s team card agrees');
  assert.equal((await api('lena', 'GET', '/dashboard')).data.attention.open_spots, 2);
});

test('the Connect badge and Home use the same counts for a leader', async () => {
  const light = (await api('lena', 'GET', '/attention')).data;
  const home = (await api('lena', 'GET', '/dashboard')).data.attention;
  assert.deepEqual([light.connect_cards, light.signups], [home.connect_cards, home.signups]);
  assert.deepEqual([home.connect_cards, home.signups], [2, 1]);
});

test('a new guest marked present today is on the first-time follow-up list straight away', async () => {
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${today()}T23:30` })).data;
  const guest = (await api('admin', 'POST', '/people', { first_name: 'Gus', last_name: 'Guest', status: 'guest', campus_id: 1, new_household: true })).data;
  await api('admin', 'POST', `/services/${svc.id}/roll`, { person_ids: [guest.id], present: true });
  const follow = (await api('admin', 'GET', '/attendance/people')).data;
  assert.ok(follow.first_time.some((p) => p.id === guest.id));
  const far = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${addDays(today(), 10)}T10:00` })).data;
  const early = (await api('admin', 'POST', '/people', { first_name: 'Eli', last_name: 'Early', status: 'guest', campus_id: 1 })).data;
  await api('admin', 'POST', `/services/${far.id}/roll`, { person_ids: [early.id], present: true });
  assert.ok(!(await api('admin', 'GET', '/attendance/people')).data.first_time.some((p) => p.id === early.id), 'a service days away does not count yet');
});

test('the same-time warning matches the same campus and start time only', async () => {
  const day = addDays(today(), 20);
  await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T09:00`, title: 'Sunday' });
  const list = (await api('admin', 'GET', `/services?from=${day}&to=${day}&campus_id=1`)).data;
  assert.equal(findClash(list, 1, `${day}T09:00`)?.title, 'Sunday');
  assert.equal(findClash(list, '1', `${day}T09:00`)?.title, 'Sunday', 'campus id from a form is a string');
  assert.equal(findClash(list, 2, `${day}T09:00`), null, 'another campus is fine');
  assert.equal(findClash(list, 1, `${day}T11:00`), null, 'another time is fine');
  assert.equal(findClash([], 1, `${day}T09:00`), null);
  // It's only a warning: the server still creates a second service at that time.
  assert.equal((await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T09:00` })).status, 201);
});
