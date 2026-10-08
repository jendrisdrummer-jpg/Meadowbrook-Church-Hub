// End-to-end API tests against an in-memory database.
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

before(async () => {
  db = openDb(':memory:');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-up-'));
  server = createApp({ db, uploadDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // Accounts: an admin, a North-campus-only staffer, and a volunteer.
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago'), (2, 'Meadowbrook South', 'South', 'America/Chicago');`);
  for (const [key, email, role, campuses] of [['admin', 'admin@mb.org', 'admin', null], ['north', 'north@mb.org', 'staff', '[1]'], ['vol', 'vol@mb.org', 'volunteer', null]]) {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(email, role, campuses).lastInsertRowid;
    const res = { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } };
    startSession(db, { secure: false }, res, id);
  }
});

after(() => server.close());

const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// The first Sunday at least `minDays` from today.
function nextSunday(minDays = 0) {
  const d = addDays(new Date().toISOString().slice(0, 10), minDays);
  return addDays(d, (7 - new Date(`${d}T12:00:00Z`).getUTCDay()) % 7);
}

async function api(role, method, url, body) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('requires sign-in and the app header', async () => {
  assert.equal((await api(null, 'GET', '/people')).status, 401);
  const res = await fetch(base + '/api/people', { method: 'POST', headers: { cookie: cookies.admin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('people, households and duplicate detection', async () => {
  const a = await api('admin', 'POST', '/people', { first_name: 'Sarah', last_name: 'Miller', email: 'Sarah@Example.com', campus_id: 1, new_household: true });
  assert.equal(a.status, 201);
  assert.equal(a.data.email, 'sarah@example.com');
  assert.ok(a.data.household_id);
  const dup = await api('admin', 'POST', '/people', { first_name: 'sarah', last_name: 'miller', email: 'sarah@example.com' });
  assert.equal(dup.status, 409);
  const kid = await api('admin', 'POST', '/people', { first_name: 'Emma', last_name: 'Miller', birthdate: '2019-05-01', household_id: a.data.household_id, household_role: 'child', campus_id: 1, allergies: 'Peanuts' });
  assert.equal(kid.status, 201);
  const detail = await api('admin', 'GET', `/people/${a.data.id}`);
  assert.equal(detail.data.household.members.length, 2);
  const search = await api('admin', 'GET', '/people?q=mill');
  assert.equal(search.data.total, 2);
});

test('campus permissions keep staff to their campus', async () => {
  const south = await api('admin', 'POST', '/people', { first_name: 'Tom', last_name: 'South', campus_id: 2 });
  assert.equal((await api('north', 'GET', `/people/${south.data.id}`)).status, 403);
  assert.equal((await api('north', 'POST', '/people', { first_name: 'X', campus_id: 2 })).status, 403);
  const list = await api('north', 'GET', '/people');
  assert.ok(list.data.rows.every((p) => p.campus_id !== 2));
  assert.equal((await api('vol', 'GET', '/people')).status, 403);
});

test('teams, service types, scheduling, conflicts and responses', async () => {
  const team = await api('admin', 'POST', '/teams', { name: 'Worship', positions: ['Vocals', 'Drums'] });
  const t = (await api('admin', 'GET', `/teams/${team.data.id}`)).data;
  const [vocals, drums] = t.positions;
  const drummer = (await api('admin', 'POST', '/people', { first_name: 'Dan', last_name: 'Drums', campus_id: 1, email: 'vol@mb.org' })).data;
  db.prepare('UPDATE users SET person_id = ? WHERE email = ?').run(drummer.id, 'vol@mb.org');
  await api('admin', 'PUT', `/teams/${team.data.id}/members/${drummer.id}`, { position_ids: [drums.id] });

  // Two repeating Sunday services starting next week, at overlapping times on different campuses.
  const sunday = nextSunday(7);
  const st = await api('admin', 'POST', '/series', { campus_id: 1, starts_on: sunday, start_time: '09:00', needs: [{ position_id: drums.id, count: 1 }, { position_id: vocals.id, count: 2 }] });
  assert.equal(st.status, 201);
  const st2 = await api('admin', 'POST', '/series', { campus_id: 2, starts_on: sunday, start_time: '09:30', needs: [{ position_id: drums.id, count: 1 }] });

  const services = (await api('admin', 'GET', `/services?from=${sunday}&to=${addDays(sunday, 20)}`)).data;
  assert.equal(services.filter((s) => s.service_type_id === st.data.id).length, 3);
  const north = services.find((s) => s.service_type_id === st.data.id);
  const south = services.find((s) => s.service_type_id === st2.data.id && s.starts_at.slice(0, 10) === north.starts_at.slice(0, 10));
  assert.equal(north.starts_at, `${sunday}T09:00`);
  assert.equal(north.needed, 3);

  const fill = await api('admin', 'POST', `/services/${north.id}/autofill`);
  assert.deepEqual(fill.data.added.map((a) => a.position), ['Drums']);
  // Same person can't be booked at the overlapping South service.
  const clash = await api('admin', 'POST', `/services/${south.id}/assignments`, { position_id: drums.id, person_id: drummer.id });
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /Already serving Drums at North/);

  // Volunteer sees and accepts their own assignment, but can't see the people list.
  const mine = await api('vol', 'GET', '/my/schedule');
  assert.equal(mine.data.assignments.length, 1);
  assert.equal((await api('vol', 'PATCH', `/assignments/${mine.data.assignments[0].id}`, { status: 'accepted' })).status, 200);
  const svc = await api('vol', 'GET', `/services/${north.id}`);
  assert.equal(svc.status, 200);
  assert.equal(svc.data.positions.find((p) => p.id === drums.id).assignments[0].status, 'accepted');
  assert.equal((await api('vol', 'GET', `/services/${south.id}`)).status, 403);

  // Blockouts block scheduling.
  const later = services.find((s) => s.service_type_id === st.data.id && s.id !== north.id);
  await api('vol', 'POST', '/blockouts', { start_date: later.starts_at.slice(0, 10), reason: 'Vacation' });
  const blocked = await api('admin', 'POST', `/services/${later.id}/assignments`, { position_id: drums.id, person_id: drummer.id });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Vacation/);

  // Plan items and copying a plan.
  const song = await api('admin', 'POST', '/songs', { title: 'Way Maker', default_key: 'E' });
  await api('admin', 'POST', `/services/${north.id}/items`, { kind: 'header', title: 'Worship' });
  const items = await api('admin', 'POST', `/services/${north.id}/items`, { kind: 'song', song_id: song.data.id, length_sec: 300 });
  assert.equal(items.data[1].title, 'Way Maker');
  assert.equal(items.data[1].song_key, 'E');
  const copied = await api('admin', 'POST', `/services/${later.id}/copy-plan`, { from_service_id: north.id });
  assert.equal(copied.data.length, 2);
});

test('repeating services: skip one, change the future, stop the series', async () => {
  const start = nextSunday(70);
  const created = await api('admin', 'POST', '/series', { campus_id: 1, starts_on: start, start_time: '18:00', every_weeks: 2, title: 'Evening' });
  const list = async () => (await api('admin', 'GET', `/services?from=${start}&to=${addDays(start, 42)}`)).data.filter((s) => s.service_type_id === created.data.id);
  let rows = await list();
  assert.deepEqual(rows.map((s) => s.starts_at.slice(0, 10)), [0, 14, 28, 42].map((n) => addDays(start, n)));
  assert.equal(rows[0].title, 'Evening');

  // Deleting one service skips that date for good.
  await api('admin', 'DELETE', `/services/${rows[1].id}`);
  rows = await list();
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((s) => s.starts_at.startsWith(addDays(start, 14))));

  // Changing the series from the third date on moves only those services.
  await api('admin', 'PATCH', `/series/${created.data.id}`, { from_date: addDays(start, 28), start_time: '18:30' });
  rows = await list();
  assert.deepEqual(rows.map((s) => s.starts_at.slice(11)), ['18:00', '18:30', '18:30']);

  // One service can need different positions without changing the others.
  const pos = (await api('admin', 'GET', '/teams')).data[0].positions[0];
  await api('admin', 'PUT', `/services/${rows[0].id}/needs`, { needs: [{ position_id: pos.id, count: 4 }] });
  rows = await list();
  assert.deepEqual(rows.map((s) => s.needed), [4, 0, 0]);

  // Stopping the series removes it from that date on.
  const stop = await api('admin', 'DELETE', `/series/${created.data.id}?from=${addDays(start, 28)}`);
  assert.equal(stop.data.removed, 2);
  assert.equal((await list()).length, 1);
});

test('roll call marks people and families, and feeds follow-up lists', async () => {
  const day = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T10:00` })).data;
  const roll = (await api('admin', 'GET', `/services/${svc.id}/roll`)).data;
  const sarah = roll.people.find((p) => p.first_name === 'Sarah');
  const family = roll.people.filter((p) => p.household_id === sarah.household_id).map((p) => p.id);
  assert.ok(family.length >= 2);
  let r = await api('admin', 'POST', `/services/${svc.id}/roll`, { person_ids: family, present: true });
  assert.equal(r.data.present, family.length);
  r = await api('admin', 'POST', `/services/${svc.id}/roll`, { person_ids: [sarah.id], present: false });
  assert.equal(r.data.present, family.length - 1);
  assert.equal((await api('vol', 'GET', `/services/${svc.id}/roll`)).status, 403);
  const follow = (await api('admin', 'GET', '/attendance/people')).data;
  assert.ok(follow.first_time.some((p) => family.includes(p.id) && p.id !== sarah.id));
  const hist = (await api('admin', 'GET', `/people/${family.find((id) => id !== sarah.id)}/attendance`)).data;
  assert.equal(hist.recent.length, 1);
});

test('kids check-in assigns rooms, is idempotent and checks out by code', async () => {
  await api('admin', 'POST', '/rooms', { campus_id: 1, name: 'Nursery', min_age_months: 0, max_age_months: 23 });
  await api('admin', 'POST', '/rooms', { campus_id: 1, name: 'Preschool', min_age_months: 24, max_age_months: 71 });
  await api('admin', 'POST', '/rooms', { campus_id: 1, name: 'Elementary', min_grade: 0, max_grade: 5, min_age_months: 72, max_age_months: 143 });
  const roster = await api('admin', 'GET', '/checkin/roster?campus_id=1');
  const fam = roster.data.households.find((h) => h.members.some((m) => m.first_name === 'Emma'));
  assert.ok(fam);
  const emma = fam.members.find((m) => m.first_name === 'Emma');
  const rec = { id: 'test-checkin-0001', person_id: emma.id, kind: 'kid', security_code: 'K7XM', station: 'Lobby', checked_in_at: new Date().toISOString() };
  const first = await api('admin', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec] });
  assert.equal(first.status, 201);
  assert.ok(first.data[0].room_id);
  await api('admin', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec] });
  const active = await api('admin', 'GET', '/checkin/active?campus_id=1');
  assert.equal(active.data.length, 1);
  assert.equal(active.data[0].allergies, 'Peanuts');
  const out = await api('admin', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'k7xm' });
  assert.equal(out.data.checked_out, 1);
  assert.equal((await api('admin', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'K7XM' })).status, 404);
});

test('CSV import groups households and updates on re-import', async () => {
  const csv = 'Person ID,First Name,Last Name,Email,Mobile Phone,Birthdate,Family,Family Role,Campus\n'
    + 'ft1,John,Carter,john@c.com,555-111-2222,4/2/1980,Carter Family,Head,North\n'
    + 'ft2,Amy,Carter,amy@c.com,,1982-07-09,Carter Family,Spouse,North\n'
    + 'ft3,Leo,Carter,,,3/3/2018,Carter Family,Child,North\n'
    + ',,NoFirst,,,,,,\n';
  const preview = await fetch(base + '/api/import/preview', { method: 'POST', headers: { cookie: cookies.admin, 'x-mb': '1', 'content-type': 'text/csv' }, body: csv }).then((r) => r.json());
  assert.equal(preview.mapping.first_name, 'First Name');
  assert.equal(preview.mapping.household, 'Family');
  assert.equal(preview.mapping.external_id, 'Person ID');
  const dry = await api('admin', 'POST', '/import/people', { csv, mapping: preview.mapping, dry_run: true });
  assert.equal(dry.data.created, 3);
  assert.equal((await api('admin', 'GET', '/people?q=carter')).data.total, 0);
  const done = await api('admin', 'POST', '/import/people', { csv, mapping: preview.mapping });
  assert.deepEqual([done.data.created, done.data.households, done.data.skipped.length], [3, 1, 1]);
  const leo = (await api('admin', 'GET', '/people?q=leo')).data.rows[0];
  assert.equal(leo.household_role, 'child');
  assert.equal(leo.birthdate, '2018-03-03');
  assert.equal(leo.campus_id, 1);
  const again = await api('admin', 'POST', '/import/people', { csv, mapping: preview.mapping });
  assert.equal(again.data.updated, 3);
  assert.equal(again.data.created, 0);
});

test('the last admin cannot be demoted', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@mb.org'").get();
  const res = await api('admin', 'PATCH', `/users/${admin.id}`, { role: 'staff' });
  assert.equal(res.status, 400);
});
