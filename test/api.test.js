// End-to-end API tests against an in-memory database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import http from 'node:http';
import { sendReminders } from '../server/notify.js';

process.env.MB_PUSH_ALLOW_LOCAL = '1';

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
  assert.ok((await api('admin', 'GET', '/series')).data.some((t) => t.id === created.data.id));

  // Deleting it from today on removes every upcoming service and takes it off the list; past ones stay.
  db.prepare("INSERT INTO services (campus_id, service_type_id, starts_at, duration_min) VALUES (1, ?, '2020-01-05T18:00', 60)").run(created.data.id);
  await api('admin', 'DELETE', `/series/${created.data.id}?from=${new Date().toISOString().slice(0, 10)}`);
  assert.equal((await list()).length, 0);
  assert.ok(!(await api('admin', 'GET', '/series')).data.some((t) => t.id === created.data.id));
  assert.ok(db.prepare("SELECT 1 FROM services WHERE service_type_id = ? AND starts_at = '2020-01-05T18:00'").get(created.data.id));
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

test('order-of-service details, one start row, locking and edit permissions', async () => {
  const day = nextSunday(30);
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T10:00` })).data;
  let items = (await api('admin', 'POST', `/services/${svc.id}/items`, { kind: 'item', category: 'Announcement', title: 'Service Huddle', length_sec: 2100, info: 'Pastor Dallas' })).data;
  assert.equal(items[0].category, 'Announcement');
  assert.equal(items[0].info, 'Pastor Dallas');
  await api('admin', 'POST', `/services/${svc.id}/items`, { kind: 'header', title: 'Pre-service', is_start: true });
  items = (await api('admin', 'POST', `/services/${svc.id}/items`, { kind: 'header', title: 'Service Start', is_start: true })).data;
  assert.deepEqual(items.map((i) => i.is_start), [0, 0, 1]);

  // Staff (North) can edit; a lock stops them but not an admin.
  assert.equal((await api('north', 'POST', `/services/${svc.id}/items`, { kind: 'item', title: 'Welcome' })).status, 201);
  assert.equal((await api('north', 'PATCH', `/services/${svc.id}`, { locked: true })).status, 200);
  const blocked = await api('north', 'POST', `/services/${svc.id}/items`, { kind: 'item', title: 'Nope' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /locked/);
  assert.equal((await api('north', 'PATCH', `/services/${svc.id}`, { title: 'Changed' })).status, 400);
  assert.equal((await api('admin', 'POST', `/services/${svc.id}/items`, { kind: 'item', title: 'Admin fix' })).status, 201);
  const seen = (await api('north', 'GET', `/services/${svc.id}`)).data;
  assert.equal(seen.can_edit_plan, false);
  assert.equal((await api('north', 'PATCH', `/services/${svc.id}`, { locked: false })).status, 200);

  // Settings can raise who may edit plans.
  await api('admin', 'PATCH', '/settings', { plan_edit_role: 'admin' });
  assert.equal((await api('north', 'POST', `/services/${svc.id}/items`, { kind: 'item', title: 'Nope' })).status, 403);
  await api('admin', 'PATCH', '/settings', { plan_edit_role: 'leader' });
  assert.equal((await api('admin', 'PATCH', '/settings', { schedule_role: 'everyone' })).status, 400);
});

test('profile fields: milestones, validation, filtering, visibility and import', async () => {
  const fields = (await api('admin', 'GET', '/profile-fields')).data;
  const by = (label) => fields.find((f) => f.label === label);
  assert.ok(by('Baptism date') && by('Holy Ghost date') && by('New birth') && by('Classes completed'));
  const sarah = (await api('admin', 'GET', '/people?q=sarah')).data.rows[0];
  const put = (values, role = 'admin') => api(role, 'PUT', `/people/${sarah.id}/profile`, { values });
  assert.equal((await put({ [by('Baptism date').id]: 'last spring' })).status, 400);
  assert.equal((await put({ [by('New birth').id]: 'Maybe' })).status, 400);
  assert.equal((await put({ [by('Baptism date').id]: '2025-04-20', [by('New birth').id]: 'Baptized', [by('Classes completed').id]: ['Foundations'] })).status, 200);
  const prof = (await api('admin', 'GET', `/people/${sarah.id}/profile`)).data;
  assert.equal(prof.values[by('Baptism date').id], '2025-04-20');
  assert.deepEqual(prof.values[by('Classes completed').id], ['Foundations']);

  // Filter the directory by a milestone.
  const q = (f, v) => api('admin', 'GET', `/people?field_id=${by(f).id}&field_value=${encodeURIComponent(v)}`).then((r) => r.data.rows.map((p) => p.id));
  assert.deepEqual(await q('New birth', 'Baptized'), [sarah.id]);
  assert.deepEqual(await q('Classes completed', 'Foundations'), [sarah.id]);
  assert.ok(!(await q('Baptism date', 'unset')).includes(sarah.id));
  assert.ok((await q('Baptism date', 'set')).includes(sarah.id));

  // A staff-only field is hidden from leaders; a volunteer can't read profiles at all.
  const secret = (await api('admin', 'POST', '/profile-fields', { label: 'Pastoral notes', type: 'longtext', section: 'Care', visibility: 'staff' })).data;
  db.prepare("INSERT INTO users (email, role) VALUES ('leader@mb.org', 'leader')").run();
  const lid = db.prepare("SELECT id FROM users WHERE email = 'leader@mb.org'").get().id;
  const res = { setHeader: (_k, v) => { cookies.leader = v.split(';')[0]; } };
  (await import('../server/auth.js')).startSession(db, { secure: false }, res, lid);
  assert.ok(!(await api('leader', 'GET', '/profile-fields')).data.some((f) => f.id === secret.id));
  assert.equal((await api('vol', 'GET', `/people/${sarah.id}/profile`)).status, 403);
  assert.equal((await put({ [by('Baptism date').id]: '2025-01-01' }, 'leader')).status, 403);

  // Options are required for choice fields; types can't change once answered.
  assert.equal((await api('admin', 'POST', '/profile-fields', { label: 'Empty', type: 'choice' })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/profile-fields/${by('Baptism date').id}`, { type: 'text' })).status, 400);

  // CSV columns named like a field import into it.
  const csv = 'First Name,Last Name,Email,Baptism Date,New Birth\nGina,Holt,gina@x.com,5/4/2024,received the holy ghost\n';
  const pv = await fetch(base + '/api/import/preview', { method: 'POST', headers: { cookie: cookies.admin, 'x-mb': '1', 'content-type': 'text/csv' }, body: csv }).then((r) => r.json());
  assert.equal(pv.mapping[`field:${by('Baptism date').id}`], 'Baptism Date');
  await api('admin', 'POST', '/import/people', { csv, mapping: pv.mapping });
  const gina = (await api('admin', 'GET', '/people?q=gina')).data.rows[0];
  const gp = (await api('admin', 'GET', `/people/${gina.id}/profile`)).data.values;
  assert.equal(gp[by('Baptism date').id], '2024-05-04');
  assert.equal(gp[by('New birth').id], 'Received the Holy Ghost');
});

test('service templates: fill-in slots, apply, save-as, and repeating services', async () => {
  const tpl = (await api('admin', 'POST', '/templates', { name: 'Sunday Morning' })).data;
  assert.equal((await api('north', 'POST', '/templates', { name: 'Church-wide from staff' })).status, 403);
  assert.equal((await api('vol', 'GET', '/templates')).status, 403);
  await api('admin', 'POST', `/templates/${tpl.id}/items`, { kind: 'item', category: 'Announcement', title: 'Service Huddle', length_sec: 2100 });
  await api('admin', 'POST', `/templates/${tpl.id}/items`, { kind: 'header', title: 'Service Start', is_start: true });
  let items = (await api('admin', 'POST', `/templates/${tpl.id}/items`, { kind: 'song' })).data;
  assert.equal(items.at(-1).placeholder, 1);
  await api('admin', 'POST', `/templates/${tpl.id}/items`, { kind: 'item', category: 'Message', title: 'Sermon', length_sec: 2100, placeholder: true });
  const pos = (await api('admin', 'GET', '/teams')).data[0].positions[0];
  await api('admin', 'PUT', `/templates/${tpl.id}/needs`, { needs: [{ position_id: pos.id, count: 2 }] });

  // A one-off service started from the template gets its plan and positions.
  const day = nextSunday(90);
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T10:00`, template_id: tpl.id })).data;
  let full = (await api('admin', 'GET', `/services/${svc.id}`)).data;
  assert.deepEqual(full.items.map((i) => i.title), ['Service Huddle', 'Service Start', 'Song', 'Sermon']);
  assert.equal(full.positions.find((p) => p.id === pos.id).needed, 2);
  const listed = (await api('admin', 'GET', `/services?from=${day}&to=${day}`)).data.find((x) => x.id === svc.id);
  assert.equal(listed.to_fill, 2);

  // Filling a slot clears its flag.
  const song = (await api('admin', 'POST', '/songs', { title: 'Firm Foundation' })).data;
  const slot = full.items.find((i) => i.title === 'Song');
  await api('admin', 'PATCH', `/items/${slot.id}`, { song_id: song.id, title: 'Firm Foundation' });
  full = (await api('admin', 'GET', `/services/${svc.id}`)).data;
  assert.equal(full.items.find((i) => i.id === slot.id).placeholder, 0);

  // Apply again (append) and replace.
  assert.equal((await api('admin', 'POST', `/services/${svc.id}/apply-template`, { template_id: tpl.id })).data.length, 8);
  assert.equal((await api('admin', 'POST', `/services/${svc.id}/apply-template`, { template_id: tpl.id, replace: true })).data.length, 4);

  // Save a real service as a template.
  const copy = (await api('admin', 'POST', '/templates', { name: 'Copy', from_service_id: svc.id })).data;
  assert.equal((await api('admin', 'GET', `/templates/${copy.id}`)).data.items.length, 4);

  // A repeating service linked to the template fills each new service.
  const series = (await api('admin', 'POST', '/series', { campus_id: 1, starts_on: nextSunday(95), start_time: '11:00', template_id: tpl.id })).data;
  const first = (await api('admin', 'GET', `/services/${series.first_service_id}`)).data;
  assert.equal(first.items.length, 4);
  assert.equal(first.positions.find((p) => p.id === pos.id).needed, 2);
});

test('month schedule: grid, members and filling the month for one team', async () => {
  const team = await api('admin', 'POST', '/teams', { name: 'Greeters', campus_id: 2, positions: ['Door'] });
  const door = (await api('admin', 'GET', `/teams/${team.data.id}`)).data.positions[0];
  const people = [];
  for (const name of ['Ann', 'Bo', 'Cy']) {
    const p = (await api('admin', 'POST', '/people', { first_name: name, last_name: 'Greeter', campus_id: 2 })).data;
    await api('admin', 'PUT', `/teams/${team.data.id}/members/${p.id}`, { position_ids: [door.id] });
    people.push(p);
  }
  // Wednesdays for four weeks, one greeter each.
  const first = addDays(nextSunday(35), 3);
  const st = await api('admin', 'POST', '/series', { campus_id: 2, starts_on: first, start_time: '19:00', ends_on: addDays(first, 21), needs: [{ position_id: door.id, count: 1 }] });
  db.prepare("INSERT INTO blockouts (person_id, start_date, end_date, reason) VALUES (?, ?, ?, 'Trip')").run(people[0].id, first, first);
  const month = first.slice(0, 7);

  assert.equal((await api('vol', 'GET', `/schedule?month=${month}`)).status, 403);
  const grid = (await api('admin', 'GET', `/schedule?month=${month}&series_id=${st.data.id}&team_id=${team.data.id}`)).data;
  assert.ok(grid.services.length >= 1 && grid.services.every((x) => x.service_type_id === st.data.id && x.starts_at.startsWith(month)));
  assert.deepEqual(grid.positions.map((p) => p.name), ['Door']);
  assert.equal(grid.cells[`${grid.services[0].id}:${door.id}`].needed, 1);
  assert.equal(grid.members.length, 3);
  assert.equal(grid.members.find((m) => m.id === people[0].id).away[0].reason, 'Trip');

  const fill = await api('admin', 'POST', '/schedule/autofill', { service_ids: grid.services.map((x) => x.id), team_id: team.data.id });
  assert.equal(fill.data.added.length, grid.services.length);
  const after = (await api('admin', 'GET', `/schedule?month=${month}&series_id=${st.data.id}&team_id=${team.data.id}`)).data;
  // Shared fairly, and nobody scheduled while away.
  const counts = after.members.map((m) => m.month_count);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  const firstCell = after.cells[`${after.services[0].id}:${door.id}`];
  if (after.services[0].starts_at.startsWith(first)) assert.notEqual(firstCell.assignments[0].person_id, people[0].id);
  // North-only staff can't schedule South services.
  assert.equal((await api('north', 'POST', '/schedule/autofill', { service_ids: [after.services[0].id] })).status, 403);
});

test('notifications: scheduled, declined to leaders, reminders, push and preferences', async (t) => {
  // A stand-in push service that records what it receives.
  const got = [];
  const pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201).end(); });
  }).listen(0);
  await new Promise((r) => pushServer.once('listening', r));
  t.after(() => { pushServer.closeAllConnections(); pushServer.close(); });
  const endpoint = `http://127.0.0.1:${pushServer.address().port}/push/vol`;

  const vol = db.prepare("SELECT person_id FROM users WHERE email = 'vol@mb.org'").get().person_id;
  await api('vol', 'POST', '/notifications/read', {}); // earlier tests scheduled them too
  const lead = (await api('admin', 'POST', '/people', { first_name: 'Lee', last_name: 'Leader', campus_id: 1 })).data;
  db.prepare("UPDATE users SET person_id = ? WHERE email = 'north@mb.org'").run(lead.id);
  const team = await api('admin', 'POST', '/teams', { name: 'Parking', campus_id: 1, positions: ['Lot'] });
  const lot = (await api('admin', 'GET', `/teams/${team.data.id}`)).data.positions[0];
  await api('admin', 'PUT', `/teams/${team.data.id}/members/${vol}`, { position_ids: [lot.id] });
  await api('admin', 'PUT', `/teams/${team.data.id}/members/${lead.id}`, { position_ids: [lot.id], is_leader: true });

  assert.equal((await api('vol', 'POST', '/push/subscriptions', { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'a', auth: 'b' } })).status, 400);
  const key = (await api('vol', 'GET', '/me/notify')).data.public_key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  const crypto = await import('node:crypto');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = await api('vol', 'POST', '/push/subscriptions', { endpoint, keys: { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') }, device: 'Test phone' });
  assert.equal(sub.status, 201);

  // Scheduled: an inbox item and a push with Accept/Decline.
  const day = nextSunday(21);
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T08:00` })).data;
  const a = await api('admin', 'POST', `/services/${svc.id}/assignments`, { position_id: lot.id, person_id: vol });
  let inbox = (await api('vol', 'GET', '/notifications')).data;
  assert.equal(inbox.unread, 1);
  assert.match(inbox.items[0].title, /scheduled: Lot/);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(got.length, 1);
  assert.equal(got[0].headers['content-encoding'], 'aes128gcm');
  assert.match(got[0].headers.authorization, /^vapid t=.+, k=/);
  // Scheduling the same spot again doesn't notify twice.
  await api('admin', 'POST', `/services/${svc.id}/assignments`, { position_id: lot.id, person_id: vol });
  assert.equal((await api('vol', 'GET', '/notifications')).data.unread, 1);

  // Declining tells the team leader.
  await api('vol', 'PATCH', `/assignments/${a.data.id}`, { status: 'declined', reason: 'Out of town' });
  const leaderBox = (await api('north', 'GET', '/notifications')).data;
  assert.match(leaderBox.items[0].title, /Dan Drums can’t make it/);
  assert.match(leaderBox.items[0].body, /Out of town/);

  // Reminders a day ahead, once; turned-off kinds stay in the inbox but aren't pushed.
  await api('vol', 'PATCH', '/me/notify', { reminder: false, reminders: false, scheduled: true });
  const soon = new Date(Date.now() + 24 * 3600e3).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 16);
  const svc2 = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: soon })).data;
  const a2 = await api('admin', 'POST', `/services/${svc2.id}/assignments`, { position_id: lot.id, person_id: vol });
  db.prepare("UPDATE assignments SET created_at = datetime('now', '-2 days') WHERE id = ?").run(a2.data.id);
  assert.ok(sendReminders(db) >= 1);
  assert.equal(sendReminders(db), 0);
  inbox = (await api('vol', 'GET', '/notifications')).data;
  assert.ok(inbox.items.some((n) => n.kind === 'reminder' && /Lot at/.test(n.body)));
  await api('vol', 'POST', '/notifications/read', {});
  assert.equal((await api('vol', 'GET', '/notifications')).data.unread, 0);
  pushServer.close();
});

test('member app: public config, App Builder rules, connect cards', async () => {
  // Guests (no sign-in) can load the app and send a connect card.
  const cfg = await api(null, 'GET', '/app/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.user, null);
  assert.ok(cfg.data.config.tabs.some((t) => t.type === 'more'));
  assert.equal((await api(null, 'GET', '/connect-cards')).status, 401);

  // Only staff edit the app, and the bottom bar holds 5 tabs.
  const next = structuredClone(cfg.data.config);
  next.give_url = 'https://give.example.org';
  next.tabs.splice(1, 0, { id: 'about', type: 'page', label: 'About', icon: 'info', on: false, title: 'Who we are', body: 'Hi' });
  assert.equal((await api('vol', 'PUT', '/app/config', next)).status, 403);
  assert.equal((await api('admin', 'PUT', '/app/config', { ...next, tabs: next.tabs.map((t) => ({ ...t, on: true })) })).status, 400);
  assert.equal((await api('admin', 'PUT', '/app/config', { ...next, give_url: 'javascript:alert(1)' })).status, 400);
  const saved = await api('admin', 'PUT', '/app/config', next);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.tabs.at(-1).type, 'more');
  assert.equal((await api(null, 'GET', '/app/config')).data.config.give_url, 'https://give.example.org');

  await api('admin', 'POST', '/notifications/read', {});
  assert.equal((await api(null, 'POST', '/public/connect', { first_name: 'Gus' })).status, 400);
  const sent = await api(null, 'POST', '/public/connect', { first_name: 'Gus', last_name: 'Guest', email: 'gus@example.com', campus_id: 1, first_time: true, interests: ['Baptism', 'Not a real choice'], message: 'Pray for my mom' });
  assert.equal(sent.status, 201);
  const cards = (await api('admin', 'GET', '/connect-cards')).data;
  const card = cards.find((c) => c.id === sent.data.id);
  assert.deepEqual(card.interests, ['Baptism']);
  assert.equal(card.first_time, 1);
  assert.match((await api('admin', 'GET', '/notifications')).data.items[0].title, /New connect card: Gus Guest/);
  // South-only staff don't see North cards.
  assert.ok(!(await api('north', 'GET', '/connect-cards')).data.some((c) => c.campus_id === 2));
  await api('admin', 'PATCH', `/connect-cards/${card.id}`, { done: true });
  assert.ok(!(await api('admin', 'GET', '/connect-cards')).data.some((c) => c.id === card.id));
  assert.ok((await api('admin', 'GET', '/connect-cards?status=done')).data.some((c) => c.id === card.id));

  // Signed in, the app knows who you are.
  assert.equal((await api('vol', 'GET', '/app/config')).data.user.role, 'volunteer');
});

test('sign-in returns to where it started, on this site only', async () => {
  const go = async (next) => {
    const res = await fetch(`${base}/auth/google?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
    return res.headers.getSetCookie().find((c) => c.startsWith('mb_next='));
  };
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  try {
    assert.match(await go('/app/#/serve'), /mb_next=%2Fapp%2F%23%2Fserve/);
    assert.match(await go('//evil.example.com'), /mb_next=%2F;/);
    assert.match(await go('https://evil.example.com'), /mb_next=%2F;/);
    assert.match(await go('/\\evil.example.com'), /mb_next=%2F;/);
  } finally { delete process.env.GOOGLE_CLIENT_ID; }
  const app = await fetch(`${base}/app`, { redirect: 'manual' });
  assert.equal(app.headers.get('location'), '/app/');
  assert.equal((await fetch(`${base}/app/`)).status, 200);
  const man = await (await fetch(`${base}/app/manifest.webmanifest`)).json();
  assert.equal(man.scope, '/app/');
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
