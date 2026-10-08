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
import { sendTaskReminders, nextDue } from '../server/routes/tasks.js';
import { syncCalls } from '../server/routes/calls.js';
import { coverFee } from '../server/stripe.js';
import { outbox } from '../server/mail.js';

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
  assert.equal((await api('admin', 'POST', `/teams/${team.data.id}/positions`, { name: 'drums' })).status, 400); // no duplicates
  assert.equal((await api('admin', 'PATCH', `/positions/${vocals.id}`, { name: 'Drums' })).status, 400);
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

  // Spots are drafts until requests are sent; then the volunteer sees and accepts theirs.
  assert.equal((await api('vol', 'GET', '/my/schedule')).data.assignments.length, 0);
  assert.equal((await api('admin', 'POST', '/assignments/send', { service_ids: [north.id] })).data.sent, 1);
  const mine = await api('vol', 'GET', '/my/schedule');
  assert.equal(mine.data.assignments.length, 1);
  assert.equal((await api('vol', 'PATCH', `/assignments/${mine.data.assignments[0].id}`, { status: 'accepted' })).status, 200);
  const svc = await api('vol', 'GET', `/services/${north.id}`);
  assert.equal(svc.status, 200);
  assert.equal(svc.data.positions.find((p) => p.id === drums.id).assignments[0].status, 'accepted');
  // Volunteers can look at any service, without contact details, drafts or decline reasons.
  const other = await api('vol', 'GET', `/services/${south.id}`);
  assert.equal(other.status, 200);
  assert.ok(other.data.positions.every((p) => p.assignments.length && p.assignments.every((a) => a.sent_at && a.email === undefined && a.phone === undefined)));
  const all = (await api('vol', 'GET', `/services?all=1&from=${sunday}&to=${addDays(sunday, 6)}`)).data;
  assert.ok(all.some((x) => x.id === south.id));
  assert.equal(all.find((x) => x.id === north.id).my_status, 'accepted');
  assert.ok(!(await api('vol', 'GET', `/services?from=${sunday}&to=${addDays(sunday, 6)}`)).data.some((x) => x.id === south.id));

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
  assert.equal((await api('vol', 'GET', '/notifications')).data.unread, 0); // a draft until sent
  await api('admin', 'POST', '/assignments/send', { service_ids: [svc.id] });
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
  assert.equal(sendReminders(db), 0); // drafts get no reminders
  db.prepare("UPDATE assignments SET sent_at = datetime('now', '-2 days') WHERE id = ?").run(a2.data.id);
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

test('email sign-in: codes, passwords, new people from the app, and deleting accounts', async () => {
  const auth = async (path, body, cookie) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().find((c) => c.startsWith('mb_session='))?.split(';')[0] };
  };
  const lastCode = (to) => outbox.filter((m) => m.to === to).at(-1).subject.match(/^(\d{6})/)[1];

  // Someone new to the church creates an account from the app.
  assert.equal((await auth('/auth/code', { email: 'not-an-email' })).status, 400);
  assert.equal((await auth('/auth/code', { email: 'newbie@example.com' })).status, 200);
  const code = lastCode('newbie@example.com');
  assert.equal((await auth('/auth/code/verify', { email: 'newbie@example.com', code: '000000' })).status, 400);
  let r = await auth('/auth/code/verify', { email: 'newbie@example.com', code });
  assert.equal(r.data.need_name, true);
  r = await auth('/auth/code/verify', { email: 'newbie@example.com', code, first_name: 'Nora', last_name: 'Newbie' });
  assert.equal(r.data.need_password, true);
  r = await auth('/auth/code/verify', { email: 'newbie@example.com', code, first_name: 'Nora', last_name: 'Newbie', password: 'short' });
  assert.equal(r.status, 400);
  r = await auth('/auth/code/verify', { email: 'newbie@example.com', code, first_name: 'Nora', last_name: 'Newbie', password: 'correct horse 1' });
  assert.equal(r.status, 200);
  assert.ok(r.cookie);
  // The code can't be used twice.
  assert.equal((await auth('/auth/code/verify', { email: 'newbie@example.com', code, password: 'another pass 1' })).status, 400);
  const me = await fetch(base + '/api/me', { headers: { cookie: r.cookie } }).then((x) => x.json());
  assert.equal(me.role, 'volunteer');
  const nora = db.prepare("SELECT * FROM people WHERE email = 'newbie@example.com'").get();
  assert.ok(nora.signed_up_at);
  assert.ok((await api('admin', 'GET', '/signups')).data.some((p) => p.id === nora.id));
  await api('admin', 'PATCH', `/signups/${nora.id}`, { welcomed: true });
  assert.ok(!(await api('admin', 'GET', '/signups')).data.some((p) => p.id === nora.id));

  // Next time: email and password.
  assert.equal((await auth('/auth/password', { email: 'newbie@example.com', password: 'wrong password' })).status, 401);
  assert.equal((await auth('/auth/password', { email: 'NEWBIE@example.com', password: 'correct horse 1' })).status, 200);

  // Someone already in People gets linked, not duplicated.
  const before = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  await auth('/auth/code', { email: 'sarah@example.com' });
  r = await auth('/auth/code/verify', { email: 'sarah@example.com', code: lastCode('sarah@example.com'), password: 'sarahs password' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, before);
  const sarahUser = db.prepare("SELECT * FROM users WHERE email = 'sarah@example.com'").get();
  assert.equal(sarahUser.person_id, db.prepare("SELECT id FROM people WHERE email = 'sarah@example.com'").get().id);

  // The accounts list shows extra access only (search finds anyone); admins can delete accounts.
  const list = (await api('admin', 'GET', '/users')).data;
  assert.ok(list.users.every((u) => u.role !== 'volunteer' || !u.active));
  assert.ok((await api('admin', 'GET', '/users?q=newbie')).data.users.some((u) => u.email === 'newbie@example.com'));
  const adminId = db.prepare("SELECT id FROM users WHERE email = 'admin@mb.org'").get().id;
  assert.equal((await api('admin', 'DELETE', `/users/${adminId}`)).status, 400);
  assert.equal((await api('vol', 'DELETE', `/users/${sarahUser.id}`)).status, 403);
  assert.equal((await api('admin', 'DELETE', `/users/${sarahUser.id}`)).status, 200);
  assert.ok(!db.prepare('SELECT 1 FROM users WHERE id = ?').get(sarahUser.id));
  assert.ok(db.prepare("SELECT 1 FROM people WHERE email = 'sarah@example.com'").get());
});

test('sending requests: drafts, one notice per person, email reply links, removal notices', async () => {
  const team = await api('admin', 'POST', '/teams', { name: 'Ushers', campus_id: 2, positions: ['Door', 'Aisle'] });
  const [door, aisle] = (await api('admin', 'GET', `/teams/${team.data.id}`)).data.positions;
  const pat = (await api('admin', 'POST', '/people', { first_name: 'Pat', last_name: 'Usher', email: 'pat@example.com', campus_id: 2 })).data;
  const noEmail = (await api('admin', 'POST', '/people', { first_name: 'Ned', last_name: 'Noemail', campus_id: 2 })).data;
  const s1 = (await api('admin', 'POST', '/services', { campus_id: 2, starts_at: `${nextSunday(28)}T10:00` })).data;
  const s2 = (await api('admin', 'POST', '/services', { campus_id: 2, starts_at: `${nextSunday(35)}T10:00` })).data;
  for (const [s, p, pos] of [[s1, pat, door], [s2, pat, aisle], [s1, noEmail, aisle]]) {
    await api('admin', 'POST', `/services/${s.id}/assignments`, { position_id: pos.id, person_id: p.id });
  }
  // Drafts show on the service, unsent, with who can't be reached.
  const detail = (await api('admin', 'GET', `/services/${s1.id}`)).data;
  assert.ok(detail.positions.flatMap((p) => p.assignments).every((a) => a.sent_at === null));
  const unsent = (await api('admin', 'GET', `/assignments/unsent?service_ids=${s1.id},${s2.id}`)).data;
  assert.equal(unsent.length, 3);
  assert.equal(unsent.find((a) => a.person_id === noEmail.id).reachable, false);
  // Schedulers who put themselves on get their own request too.
  const me = db.prepare("SELECT person_id FROM users WHERE email = 'admin@mb.org'").get();
  if (!me.person_id) db.prepare("UPDATE users SET person_id = ? WHERE email = 'admin@mb.org'").run(noEmail.id);
  // Leaders of other teams can't send this team's requests.
  assert.equal((await api('north', 'POST', '/assignments/send', { service_ids: [s1.id, s2.id] })).data.sent, 0);

  const before = outbox.length;
  const sent = (await api('admin', 'POST', '/assignments/send', { service_ids: [s1.id, s2.id], team_id: team.data.id })).data;
  assert.deepEqual([sent.sent, sent.people], [3, 2]);
  assert.ok((await api('admin', 'GET', '/notifications')).data.items.some((n) => /You’re scheduled: Aisle/.test(n.title)));
  const mails = outbox.slice(before).filter((m) => m.to === 'pat@example.com');
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /scheduled 2 times/);
  assert.equal((await api('admin', 'GET', `/assignments/unsent?service_ids=${s1.id},${s2.id}`)).data.length, 0);

  // The email's link works without signing in, and only with the right signature.
  const [, id, sig] = mails[0].text.match(/\/r\/(\d+)\/([\w-]+)/);
  const pub = (path, body) => fetch(`${base}/api/public/assignments/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify(body) } : {});
  assert.equal((await pub(`${id}/${sig.slice(0, -1)}x`)).status, 404);
  const info = await (await pub(`${id}/${sig}`)).json();
  assert.equal(info.first_name, 'Pat');
  await api('admin', 'POST', '/notifications/read', {});
  const mailsBefore = outbox.length;
  assert.equal((await pub(`${id}/${sig}`, { status: 'declined', reason: 'Traveling' })).status, 200);
  // The person who sent the request hears back (app and email), even without leading the team.
  const reply = (await api('admin', 'GET', '/notifications')).data.items[0];
  assert.match(reply.title, /Pat Usher can’t make it/);
  assert.match(reply.body, /Traveling/);
  assert.ok(outbox.slice(mailsBefore).some((m) => /Pat Usher can’t make it/.test(m.subject)));
  // Accepts are quiet unless someone turns them on.
  const accepted = async () => (await api('admin', 'GET', '/notifications')).data.items.filter((n) => n.kind === 'accepted').length;
  const otherSpot = db.prepare('SELECT id FROM assignments WHERE person_id = ? AND id != ?').get(pat.id, Number(id));
  const sig2 = (await import('../server/notify.js')).assignmentSig(db, otherSpot.id, pat.id);
  await pub(`${otherSpot.id}/${sig2}`, { status: 'accepted' });
  assert.equal(await accepted(), 0);
  await api('admin', 'PATCH', '/me/notify', { accepted: true });
  assert.equal((await api('admin', 'GET', '/me/notify')).data.prefs.accepted, true);
  await pub(`${otherSpot.id}/${sig2}`, { status: 'declined' });
  await pub(`${otherSpot.id}/${sig2}`, { status: 'accepted' });
  assert.equal(await accepted(), 1);
  await api('admin', 'PATCH', '/me/notify', { accepted: false });
  assert.equal(db.prepare('SELECT status, decline_reason FROM assignments WHERE id = ?').get(id).decline_reason, 'Traveling');
  assert.equal((await fetch(`${base}/r/${id}/${sig}`)).status, 200);

  // Taking someone off after they were told sends a short note; drafts go quietly.
  const other = db.prepare('SELECT id FROM assignments WHERE person_id = ? AND id != ?').get(pat.id, Number(id));
  const n = outbox.length;
  await api('admin', 'DELETE', `/assignments/${other.id}`);
  assert.match(outbox.at(-1).subject, /Schedule change/);
  assert.equal(outbox.length, n + 1);
  await api('admin', 'POST', `/services/${s2.id}/assignments`, { position_id: door.id, person_id: pat.id });
  const draft = db.prepare('SELECT id FROM assignments WHERE person_id = ? AND service_id = ? AND position_id = ?').get(pat.id, s2.id, door.id);
  await api('admin', 'DELETE', `/assignments/${draft.id}`);
  assert.equal(outbox.length, n + 1);
});

test('leading a team gives leader access, and takes it back only if it came from there', async () => {
  const team = await api('admin', 'POST', '/teams', { name: 'Media', campus_id: 1, positions: ['Camera'] });
  const tid = team.data.id;
  const mia = (await api('admin', 'POST', '/people', { first_name: 'Mia', last_name: 'Media', email: 'mia@example.com', campus_id: 1 })).data;
  const role = () => db.prepare('SELECT role, role_auto FROM users WHERE person_id = ?').get(mia.id);
  await api('admin', 'PUT', `/teams/${tid}/members/${mia.id}`, { position_ids: [] });
  assert.equal(role(), undefined);
  // Made a leader before ever signing in: an account is set up with leader access.
  await api('admin', 'PUT', `/teams/${tid}/members/${mia.id}`, { position_ids: [], is_leader: true });
  assert.deepEqual({ ...role() }, { role: 'leader', role_auto: 1 });
  assert.equal((await api('admin', 'GET', `/people/${mia.id}`)).data.account.role, 'leader');
  // No longer leading: back to volunteer.
  await api('admin', 'PUT', `/teams/${tid}/members/${mia.id}`, { position_ids: [] });
  assert.deepEqual({ ...role() }, { role: 'volunteer', role_auto: 0 });
  // Access set by hand stays, whatever happens on teams.
  await api('admin', 'PUT', `/teams/${tid}/members/${mia.id}`, { position_ids: [], is_leader: true });
  const uid = db.prepare('SELECT id FROM users WHERE person_id = ?').get(mia.id).id;
  await api('admin', 'PATCH', `/users/${uid}`, { role: 'staff' });
  await api('admin', 'DELETE', `/teams/${tid}/members/${mia.id}`);
  assert.deepEqual({ ...role() }, { role: 'staff', role_auto: 0 });
});

test('chat: team chats follow the roster, messages, files, reactions, groups and live updates', async (t) => {
  // People with accounts: a team leader, two team members, and someone not on the team.
  const person = async (first) => (await api('admin', 'POST', '/people', { first_name: first, last_name: 'Chat', campus_id: 1, email: `${first.toLowerCase()}@chat.org` })).data;
  const account = (key, p, role = 'volunteer') => {
    const id = db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run(p.email, role, p.id).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    return Number(id);
  };
  const [lena, gina, hank, otto] = [await person('Lena'), await person('Gina'), await person('Hank'), await person('Otto')];
  account('lena', lena, 'leader'); account('gina', gina); const hankId = account('hank', hank); account('otto', otto);
  const team = (await api('admin', 'POST', '/teams', { name: 'Greeters', campus_id: 1, positions: ['Door'] })).data;
  for (const [p, lead] of [[lena, true], [gina, false], [hank, false]]) await api('admin', 'PUT', `/teams/${team.id}/members/${p.id}`, { position_ids: [], is_leader: lead });

  const list = (await api('gina', 'GET', '/chats')).data;
  const chat = list.chats.find((c) => c.team_id === team.id);
  assert.ok(chat && chat.member && !chat.manage);
  assert.equal(chat.name, 'Greeters');
  assert.ok(!(await api('otto', 'GET', '/chats')).data.chats.some((c) => c.id === chat.id));
  assert.equal((await api('otto', 'GET', `/chats/${chat.id}`)).status, 404);
  assert.equal((await api('otto', 'POST', `/chats/${chat.id}/messages`, { body: 'hi' })).status, 404);
  // Staff see their campus's team chats without being on the team.
  const staffView = (await api('north', 'GET', '/chats')).data.chats.find((c) => c.id === chat.id);
  assert.ok(staffView && !staffView.member && staffView.manage);
  assert.equal((await api('gina', 'GET', `/chats/${chat.id}`)).data.members.length, 3);

  // Hank's phone gets pushes (a stand-in push service records them).
  const pushes = [];
  const pushServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { pushes.push(req.url); res.writeHead(201).end(); }); }).listen(0);
  await new Promise((r) => pushServer.once('listening', r));
  t.after(() => { pushServer.closeAllConnections(); pushServer.close(); });
  const crypto = await import('node:crypto');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  await api('hank', 'POST', '/push/subscriptions', { endpoint: `http://127.0.0.1:${pushServer.address().port}/push/hank`, keys: { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });

  // Hank keeps a live stream open on another page: he hears about new messages.
  const ctl = new AbortController();
  t.after(() => ctl.abort());
  const stream = await fetch(`${base}/api/chats/stream`, { headers: { cookie: cookies.hank }, signal: ctl.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader();
  const heard = (async () => {
    let text = '';
    while (!text.includes('"type":"message"')) text += new TextDecoder().decode((await reader.read()).value);
    return text;
  })();

  // A photo upload, then a message with it that @mentions Hank.
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = await fetch(`${base}/api/chats/${chat.id}/files`, { method: 'POST', headers: { cookie: cookies.gina, 'x-mb': '1', 'content-type': 'application/octet-stream', 'x-file-type': 'image/png', 'x-file-name': encodeURIComponent('door plan.png') }, body: png }).then((r) => r.json());
  assert.equal(up.name, 'door plan.png');
  assert.equal((await fetch(base + up.url, { headers: { cookie: cookies.hank } })).status, 404); // not sent yet
  const sent = await api('gina', 'POST', `/chats/${chat.id}/messages`, { body: 'Doors open at 8:15 @Hank Chat', mentions: [hank.id, otto.id], file_ids: [up.id] });
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.data.mentions, [hank.id]); // Otto isn't in this chat
  assert.equal(sent.data.files.length, 1);
  assert.match(await heard, /Doors open/);
  const file = await fetch(base + sent.data.files[0].url, { headers: { cookie: cookies.hank } });
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(base + sent.data.files[0].url, { headers: { cookie: cookies.otto } })).status, 404);
  const txt = await fetch(`${base}/api/chats/${chat.id}/files`, { method: 'POST', headers: { cookie: cookies.gina, 'x-mb': '1', 'content-type': 'application/octet-stream', 'x-file-type': 'text/html', 'x-file-name': 'x.html' }, body: '<script>alert(1)</script>' }).then((r) => r.json());
  await api('gina', 'POST', `/chats/${chat.id}/messages`, { file_ids: [txt.id] });
  const html = await fetch(base + txt.url, { headers: { cookie: cookies.hank } });
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.match(html.headers.get('content-disposition'), /^attachment/);

  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(pushes, ['/push/hank', '/push/hank']); // one per message; nothing for Gina's own
  // Muted: quiet, unless someone @mentions him.
  await api('hank', 'PATCH', `/chats/${chat.id}/me`, { muted: true });
  await api('lena', 'POST', `/chats/${chat.id}/messages`, { body: 'Quiet one' });
  await api('lena', 'POST', `/chats/${chat.id}/messages`, { body: '@Hank Chat can you lock up?', mentions: [hank.id] });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(pushes.length, 3);
  assert.equal((await api('hank', 'GET', '/chats/unread')).data.total, 0); // muted chats don't count on the badge
  await api('hank', 'PATCH', `/chats/${chat.id}/me`, { muted: false });

  // Unread counts, then read.
  assert.equal((await api('hank', 'GET', '/chats/unread')).data.total, 4);
  assert.equal((await api('gina', 'GET', '/chats/unread')).data.total, 2); // Lena's two
  await api('hank', 'POST', `/chats/${chat.id}/read`, {});
  assert.equal((await api('hank', 'GET', '/chats/unread')).data.total, 0);

  // Replies, reactions (tap again to take back), edits by the author only, deletes.
  const reply = await api('hank', 'POST', `/chats/${chat.id}/messages`, { body: 'Got it', reply_to: sent.data.id });
  assert.equal(reply.data.reply.id, sent.data.id);
  let r = await api('hank', 'POST', `/messages/${sent.data.id}/reactions`, { emoji: '👍' });
  assert.deepEqual(r.data.reactions, [{ emoji: '👍', user_ids: [hankId], names: ['Hank Chat'] }]);
  r = await api('hank', 'POST', `/messages/${sent.data.id}/reactions`, { emoji: '👍' });
  assert.deepEqual(r.data.reactions, []);
  assert.equal((await api('hank', 'POST', `/messages/${sent.data.id}/reactions`, { emoji: '💩' })).status, 400);
  assert.equal((await api('hank', 'PATCH', `/messages/${sent.data.id}`, { body: 'changed' })).status, 403);
  assert.ok((await api('gina', 'PATCH', `/messages/${sent.data.id}`, { body: 'Doors open at 8:00' })).data.edited_at);
  assert.equal((await api('hank', 'DELETE', `/messages/${sent.data.id}`)).status, 403);
  assert.equal((await api('lena', 'DELETE', `/messages/${sent.data.id}`)).status, 200); // the team leader can
  const msgs = (await api('gina', 'GET', `/chats/${chat.id}/messages`)).data.messages;
  const gone = msgs.find((m) => m.id === sent.data.id);
  assert.ok(gone.deleted && !gone.body && !gone.files.length);
  assert.equal(msgs.find((m) => m.id === reply.data.id).reply.deleted, true);
  assert.equal((await fetch(base + sent.data.files[0].url, { headers: { cookie: cookies.hank } })).status, 404);
  // Leaving the team means leaving its chat.
  await api('admin', 'DELETE', `/teams/${team.id}/members/${hank.id}`);
  assert.equal((await api('hank', 'GET', `/chats/${chat.id}`)).status, 404);

  // Groups: leaders and staff make them; only the people in them can see them.
  assert.equal((await api('gina', 'POST', '/chats', { name: 'Nope', person_ids: [] })).status, 403);
  const g = (await api('lena', 'POST', '/chats', { name: 'Welcome planning', person_ids: [gina.id] })).data;
  assert.ok(g.manage);
  assert.equal((await api('otto', 'GET', `/chats/${g.id}`)).status, 404);
  assert.equal((await api('gina', 'POST', `/chats/${g.id}/members`, { person_ids: [otto.id] })).status, 403);
  await api('lena', 'POST', `/chats/${g.id}/members`, { person_ids: [otto.id] });
  assert.equal((await api('otto', 'POST', `/chats/${g.id}/messages`, { body: 'Thanks for adding me' })).status, 201);
  assert.equal((await api('otto', 'DELETE', `/chats/${g.id}/members/${otto.id}`)).status, 200); // leave
  assert.equal((await api('otto', 'GET', `/chats/${g.id}`)).status, 404);
  assert.equal((await api('gina', 'PATCH', `/chats/${chat.id}`, { name: 'x' })).status, 400); // team chats follow the team
  await api('gina', 'PATCH', `/chats/${g.id}/me`, { muted: true });
  assert.equal((await api('gina', 'GET', '/chats')).data.chats.find((c) => c.id === g.id).muted, true);
  assert.equal((await api('gina', 'DELETE', `/chats/${g.id}`)).status, 403);
  assert.equal((await api('lena', 'DELETE', `/chats/${g.id}`)).status, 200);
});

test('tasks: team tasks, personal tasks, checklists, comments, repeating and reminders', async () => {
  const person = async (first) => (await api('admin', 'POST', '/people', { first_name: first, last_name: 'Task', campus_id: 1, email: `${first.toLowerCase()}@task.org` })).data;
  const account = (key, p) => {
    const id = db.prepare("INSERT INTO users (email, role, person_id) VALUES (?, 'volunteer', ?)").run(p.email, p.id).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    return Number(id);
  };
  const [ava, ben, cal] = [await person('Ava'), await person('Ben'), await person('Cal')];
  const avaId = account('ava', ava); const benId = account('ben', ben); account('cal', cal);
  const team = (await api('admin', 'POST', '/teams', { name: 'Hospitality', campus_id: 1, positions: ['Coffee'] })).data;
  for (const p of [ava, ben]) await api('admin', 'PUT', `/teams/${team.id}/members/${p.id}`, { position_ids: [] });
  const inbox = async (key) => (await api(key, 'GET', '/notifications')).data.items.filter((n) => n.kind === 'task');

  // Anyone on the team can give a task to anyone on it; not to (or by) someone outside.
  assert.ok((await api('ben', 'GET', '/tasks/teams')).data.some((t) => t.id === team.id && t.members.length === 2));
  assert.equal((await api('ben', 'POST', '/tasks', { title: 'x', team_id: team.id, assignee_id: cal.id })).status, 400);
  assert.equal((await api('cal', 'POST', '/tasks', { title: 'x', team_id: team.id })).status, 400);
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${nextSunday(7)}T09:00` })).data;
  const made = await api('ben', 'POST', '/tasks', { title: 'Buy coffee', team_id: team.id, assignee_id: ava.id, due_date: nextSunday(7), service_id: svc.id, repeat: 'weekly', checklist: ['Beans', 'Cups'] });
  assert.equal(made.status, 201);
  const id = made.data.id;
  assert.equal(made.data.checklist.length, 2);
  assert.equal(made.data.service.starts_at, `${nextSunday(7)}T09:00`);
  assert.match((await inbox('ava'))[0].title, /gave you a task/);
  assert.equal((await api('cal', 'GET', `/tasks/${id}`)).status, 404);
  assert.deepEqual((await api('ava', 'GET', '/tasks?view=mine')).data.map((t) => t.id), [id]);
  assert.deepEqual((await api('ben', 'GET', '/tasks?view=given')).data.map((t) => t.id), [id]);
  assert.ok((await api('ben', 'GET', `/tasks?view=team&team_id=${team.id}`)).data.some((t) => t.id === id));
  assert.equal((await api('cal', 'GET', `/tasks?view=team&team_id=${team.id}`)).status, 404);
  assert.equal((await api('north', 'GET', `/tasks/${id}`)).status, 200); // campus staff can see team tasks

  // Personal tasks: just for you.
  const own = await api('cal', 'POST', '/tasks', { title: 'Call the plumber' });
  assert.equal(own.data.assignee_id, cal.id);
  assert.equal((await api('ben', 'GET', `/tasks/${own.data.id}`)).status, 404);
  assert.equal((await api('cal', 'POST', '/tasks', { title: 'x', assignee_id: ava.id })).status, 400);

  // Checklist and comments; the giver hears about comments.
  let t = (await api('ava', 'PATCH', `/task-items/${made.data.checklist[0].id}`, { done: true })).data;
  assert.equal(t.items_done, 1);
  t = (await api('ava', 'POST', `/tasks/${id}/checklist`, { text: 'Creamer' })).data;
  assert.equal(t.checklist.length, 3);
  t = (await api('ava', 'POST', `/tasks/${id}/comments`, { body: 'Oat milk too?' })).data;
  assert.equal(t.thread[0].name, 'Ava Task');
  assert.match((await inbox('ben'))[0].title, /commented/);
  assert.equal((await api('ben', 'DELETE', `/task-comments/${t.thread[0].id}`)).status, 403);

  // Done: Ben hears, and the next week's task appears with the checklist unticked.
  const done = (await api('ava', 'PATCH', `/tasks/${id}`, { done: true })).data;
  assert.ok(done.done_at && done.next_id);
  assert.match((await inbox('ben'))[0].title, /finished a task/);
  const next = (await api('ava', 'GET', `/tasks/${done.next_id}`)).data;
  assert.equal(next.due_date, nextDue(nextSunday(7), 'weekly'));
  assert.deepEqual(next.checklist.map((i) => i.done), [0, 0, 0]);
  // Undo takes back the untouched next one; finishing again makes it again, just once.
  await api('ava', 'PATCH', `/tasks/${id}`, { done: false });
  assert.equal((await api('ava', 'GET', `/tasks/${done.next_id}`)).status, 404);
  const again = (await api('ava', 'PATCH', `/tasks/${id}`, { done: true })).data;
  await api('ava', 'PATCH', `/tasks/${id}`, { done: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE title = ?').get('Buy coffee').n, 2);
  done.next_id = again.next_id;
  assert.equal(nextDue('2027-01-31', 'monthly'), '2027-02-28');

  // Only the giver, a team leader or staff delete; reassigning outside the team fails.
  assert.equal((await api('ava', 'DELETE', `/tasks/${done.next_id}`)).status, 403);
  assert.equal((await api('ava', 'PATCH', `/tasks/${done.next_id}`, { assignee_id: cal.id })).status, 400);

  // Reminders: overdue tasks get one notice; brand-new ones are skipped.
  const late = (await api('ben', 'POST', '/tasks', { title: 'Restock napkins', team_id: team.id, assignee_id: ava.id, due_date: '2020-01-01' })).data;
  sendTaskReminders(db);
  assert.ok(!(await inbox('ava')).some((n) => /Overdue/.test(n.title))); // made just now
  db.prepare("UPDATE tasks SET created_at = datetime('now', '-2 days'), reminded = 0 WHERE id = ?").run(late.id);
  sendTaskReminders(db);
  sendTaskReminders(db);
  assert.equal((await inbox('ava')).filter((n) => /Overdue: Restock/.test(n.title)).length, 1);
  assert.equal((await api('ava', 'GET', '/tasks/summary')).data.due >= 1, true);
  assert.ok(avaId && benId);
});

test('tasks in chats: cards that stay current, the Tasks tab, group tasks', async (t) => {
  const person = async (first) => (await api('admin', 'POST', '/people', { first_name: first, last_name: 'Card', campus_id: 1, email: `${first.toLowerCase()}@card.org` })).data;
  const account = (key, p, role = 'volunteer') => {
    const id = db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run(p.email, role, p.id).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  const [dee, eli, fay] = [await person('Dee'), await person('Eli'), await person('Fay')];
  account('dee', dee, 'leader'); account('eli', eli); account('fay', fay);
  const team = (await api('admin', 'POST', '/teams', { name: 'Ushers', campus_id: 1, positions: ['Door'] })).data;
  for (const p of [dee, eli]) await api('admin', 'PUT', `/teams/${team.id}/members/${p.id}`, { position_ids: [] });
  const chat = (await api('eli', 'GET', '/chats')).data.chats.find((c) => c.team_id === team.id);

  // Eli watches the chat live while Dee gives him a task.
  const ctl = new AbortController();
  t.after(() => ctl.abort());
  const reader = (await fetch(`${base}/api/chats/stream?viewing=${chat.id}`, { headers: { cookie: cookies.eli }, signal: ctl.signal })).body.getReader();
  let heard = '';
  const hear = async (text) => { while (!heard.includes(text)) heard += new TextDecoder().decode((await reader.read()).value); };

  const task = (await api('dee', 'POST', '/tasks', { title: 'Count the offering', team_id: team.id, assignee_id: eli.id, due_date: '2030-01-06' })).data;
  await hear('"kind":"task"');
  let msgs = (await api('eli', 'GET', `/chats/${chat.id}/messages`)).data.messages;
  const card = msgs.find((m) => m.kind === 'task');
  assert.equal(card.task.title, 'Count the offering');
  assert.equal(card.task.assignee.first_name, 'Eli');
  assert.equal((await api('eli', 'GET', `/chats/${chat.id}`)).data.open_tasks, 1);
  assert.match((await api('dee', 'GET', '/chats')).data.chats.find((c) => c.id === chat.id).last.body, /New task: Count the offering/);

  // Ticking it off updates the card for everyone (and the Tasks tab).
  heard = '';
  await api('eli', 'PATCH', `/tasks/${task.id}`, { done: true });
  await hear('"type":"tasks"');
  msgs = (await api('dee', 'GET', `/chats/${chat.id}/messages`)).data.messages;
  assert.ok(msgs.find((m) => m.id === card.id).task.done_at);
  assert.equal(msgs.find((m) => m.id === card.id).task.done_by, 'Eli');
  const tab = (await api('eli', 'GET', `/tasks?view=chat&chat_id=${chat.id}`)).data;
  assert.deepEqual(tab.map((x) => [x.title, Boolean(x.done_at)]), [['Count the offering', true]]); // finished this week still shows
  assert.equal((await api('fay', 'GET', `/tasks?view=chat&chat_id=${chat.id}`)).status, 404);
  // Deleted: the card says so.
  await api('dee', 'DELETE', `/tasks/${task.id}`);
  msgs = (await api('eli', 'GET', `/chats/${chat.id}/messages`)).data.messages;
  assert.equal(msgs.find((m) => m.id === card.id).task, null);

  // Groups have tasks too: only for people in the group.
  const g = (await api('dee', 'POST', '/chats', { name: 'Parking lot crew', person_ids: [fay.id] })).data;
  assert.equal((await api('dee', 'POST', '/tasks', { title: 'Cones', chat_id: g.id, assignee_id: eli.id })).status, 400);
  assert.equal((await api('eli', 'POST', '/tasks', { title: 'Cones', chat_id: g.id })).status, 400); // not in it
  const cones = (await api('dee', 'POST', '/tasks', { title: 'Put out cones', chat_id: g.id, assignee_id: fay.id })).data;
  assert.equal(cones.group_name, 'Parking lot crew');
  assert.equal((await api('fay', 'GET', `/tasks?view=chat&chat_id=${g.id}`)).data.length, 1);
  assert.equal((await api('eli', 'GET', `/tasks/${cones.id}`)).status, 404);
  assert.ok((await api('fay', 'GET', '/tasks?view=team')).data.some((x) => x.id === cones.id));
  assert.ok((await api('fay', 'GET', '/tasks/teams')).data.some((x) => x.key === `chat:${g.id}` && x.members.length === 2));
  assert.ok((await api('fay', 'GET', `/chats/${g.id}/messages`)).data.messages.some((m) => m.task?.id === cones.id));
  // Moving it to a team takes it out of the group, and the person if they aren't on the team.
  const moved = (await api('dee', 'PATCH', `/tasks/${cones.id}`, { team_id: team.id, chat_id: null })).data;
  assert.deepEqual([moved.team_id, moved.chat_id, moved.assignee_id], [team.id, null, null]);
});

test('video calls: start, join with a private room, meetings, and the monthly limit', async (t) => {
  // A stand-in for Daily's API.
  const daily = { requests: [], usedSeconds: 0, present: 1 };
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      daily.requests.push({ method: req.method, url: req.url, body: json, auth: req.headers.authorization });
      const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.method === 'POST' && req.url === '/rooms') return send({ name: json.name, url: `https://church.daily.co/${json.name}` });
      if (req.url === '/meeting-tokens') return send({ token: `tok-${json.properties.user_id}-${json.properties.is_owner}` });
      if (req.url.startsWith('/meetings')) return send({ data: [{ id: 'm1', ongoing: false, participants: [{ duration: daily.usedSeconds }] }] });
      if (req.url.endsWith('/presence')) return send({ total_count: daily.present, data: [] });
      if (req.method === 'DELETE') return send({ deleted: true });
      res.writeHead(404).end('{}');
    });
  }).listen(0);
  await new Promise((r) => mock.once('listening', r));
  t.after(() => { mock.closeAllConnections(); mock.close(); delete process.env.MB_DAILY_API_KEY; delete process.env.MB_DAILY_API_URL; });

  const person = async (first) => (await api('admin', 'POST', '/people', { first_name: first, last_name: 'Call', campus_id: 1, email: `${first.toLowerCase()}@call.org` })).data;
  const account = (key, p) => {
    const id = db.prepare("INSERT INTO users (email, role, person_id) VALUES (?, 'volunteer', ?)").run(p.email, p.id).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    return Number(id);
  };
  const [gus, hal, ivy] = [await person('Gus'), await person('Hal'), await person('Ivy')];
  const gusId = account('gus', gus); const halId = account('hal', hal); account('ivy', ivy);
  const team = (await api('admin', 'POST', '/teams', { name: 'Tech', campus_id: 1, positions: ['Sound'] })).data;
  for (const p of [gus, hal]) await api('admin', 'PUT', `/teams/${team.id}/members/${p.id}`, { position_ids: [] });
  const chat = (await api('gus', 'GET', '/chats')).data.chats.find((c) => c.team_id === team.id);

  // Not set up yet: a clear message.
  assert.equal((await api('gus', 'POST', `/chats/${chat.id}/calls`, {})).status, 503);
  process.env.MB_DAILY_API_KEY = 'test-key';
  process.env.MB_DAILY_API_URL = `http://127.0.0.1:${mock.address().port}`;
  assert.equal((await api('gus', 'GET', '/calls/usage')).data.configured, true);

  // Start: a card in the chat and a notice for the team.
  const call = await api('gus', 'POST', `/chats/${chat.id}/calls`, {});
  assert.equal(call.status, 201);
  const card = (await api('hal', 'GET', `/chats/${chat.id}/messages`)).data.messages.find((m) => m.kind === 'call');
  assert.equal(card.call.id, call.data.id);
  assert.match((await api('hal', 'GET', '/notifications')).data.items[0].title, /Gus Call started a call in Tech/);
  assert.equal((await api('hal', 'POST', `/chats/${chat.id}/calls`, {})).data.id, call.data.id); // one at a time

  // Join: a private room that closes itself, and a pass per person (the starter runs it).
  const joined = (await api('gus', 'POST', `/calls/${call.data.id}/join`)).data;
  assert.match(joined.url, /^https:\/\/church\.daily\.co\/mb-/);
  assert.equal(joined.token, `tok-${gusId}-true`);
  const room = daily.requests.find((r) => r.method === 'POST' && r.url === '/rooms');
  assert.equal(room.body.privacy, 'private');
  assert.equal(room.body.properties.max_participants, undefined); // the free plan refuses it
  assert.ok(room.body.properties.exp > Date.now() / 1000);
  assert.equal(room.auth, 'Bearer test-key');
  assert.equal((await api('hal', 'POST', `/calls/${call.data.id}/join`)).data.token, `tok-${halId}-false`);
  assert.equal(daily.requests.filter((r) => r.url === '/rooms').length, 1); // same room
  assert.equal((await api('ivy', 'POST', `/calls/${call.data.id}/join`)).status, 404);
  assert.equal((await api('hal', 'POST', `/calls/${call.data.id}/end`)).status, 403);

  // Empty for 5 minutes: closed.
  daily.present = 0;
  await syncCalls(db);
  db.prepare("UPDATE calls SET empty_since = datetime('now', '-6 minutes') WHERE id = ?").run(call.data.id);
  await syncCalls(db);
  assert.ok(db.prepare('SELECT ended_at FROM calls WHERE id = ?').get(call.data.id).ended_at);
  assert.ok(daily.requests.some((r) => r.method === 'DELETE'));
  assert.ok((await api('hal', 'GET', `/chats/${chat.id}/messages`)).data.messages.find((m) => m.kind === 'call').call.ended_at);

  // Meetings: scheduled, opens 15 minutes early, with a reminder.
  const at = new Date(Date.now() + 3 * 3600e3).toISOString();
  const meeting = (await api('gus', 'POST', `/chats/${chat.id}/calls`, { title: 'Tech huddle', starts_at: at })).data;
  assert.equal(meeting.title, 'Tech huddle');
  assert.equal((await api('hal', 'POST', `/calls/${meeting.id}/join`)).status, 400);
  db.prepare('UPDATE calls SET starts_at = ? WHERE id = ?').run(new Date(Date.now() + 10 * 60e3).toISOString(), meeting.id);
  await syncCalls(db);
  assert.match((await api('hal', 'GET', '/notifications')).data.items[0].title, /Starting soon: Tech huddle/);

  // The monthly limit: once Daily's records show it's used up, nothing starts and live calls end.
  daily.present = 1;
  assert.equal((await api('hal', 'POST', `/calls/${meeting.id}/join`)).status, 200);
  await api('admin', 'PATCH', '/settings', { video_minutes_limit: 30 });
  daily.usedSeconds = 45 * 60;
  db.prepare("UPDATE settings SET value = json_set(value, '$.synced_at', 0) WHERE key = 'video_usage'").run();
  const u = (await api('admin', 'GET', '/calls/usage')).data;
  assert.deepEqual([u.minutes, u.limit, u.left], [45, 30, 0]);
  const told = (await api('admin', 'GET', '/notifications')).data.items.filter((n) => /Video calls paused/.test(n.title));
  assert.equal(told.length, 1); // admins hear once
  db.prepare("UPDATE settings SET value = json_set(value, '$.synced_at', 0) WHERE key = 'video_usage'").run();
  await api('admin', 'GET', '/calls/usage');
  assert.equal((await api('admin', 'GET', '/notifications')).data.items.filter((n) => /Video calls paused/.test(n.title)).length, 1);
  assert.equal((await api('gus', 'POST', `/chats/${chat.id}/calls`, {})).status, 403);
  assert.equal((await api('hal', 'POST', `/calls/${meeting.id}/join`)).status, 403);
  await syncCalls(db);
  assert.ok(db.prepare('SELECT ended_at FROM calls WHERE id = ?').get(meeting.id).ended_at);
  assert.equal((await api('admin', 'PATCH', '/settings', { video_minutes_limit: -1 })).status, 400);
});

test('giving: Stripe checkout, webhooks, recurring gifts, my giving, and finance-only reports', async (t) => {
  const stripeCalls = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      stripeCalls.push({ method: req.method, url: req.url, form });
      const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.url === '/customers') return send({ id: 'cus_member' });
      if (req.url === '/checkout/sessions') return send({ id: `cs_test_${stripeCalls.length}`, client_secret: 'cs_secret' });
      if (req.url.startsWith('/checkout/sessions/')) return send({ status: 'complete', payment_status: 'paid', metadata: { fund_id: '1', amount_cents: '5000', fee_cents: '0', every: 'once' }, customer_details: { email: 'guest@give.org' } });
      if (req.url.startsWith('/payment_intents/pi_bank')) return send({ payment_method: { type: 'us_bank_account' } });
      if (req.url.startsWith('/payment_intents/')) return send({ payment_method: { type: 'card' } });
      if (req.url.startsWith('/subscriptions/sub_1') && req.method === 'GET') {
        return send({ id: 'sub_1', metadata: { fund_id: '4', amount_cents: '2000', fee_cents: '75', every: 'month', person_id: '' }, customer: { id: 'cus_member', email: 'rita@give.org', name: 'Rita Give' }, items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] } });
      }
      send({});
    });
  }).listen(0);
  await new Promise((r) => mock.once('listening', r));
  t.after(() => { mock.closeAllConnections(); mock.close(); for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_API_URL']) delete process.env[k]; });
  const crypto = await import('node:crypto');
  const hook = (type, object, secret = 'whsec_test') => {
    const raw = JSON.stringify({ id: `evt_${Math.random()}`, type, data: { object } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
    return fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body: raw });
  };

  // Not set up: the app falls back to the giving link.
  assert.equal((await api(null, 'GET', '/giving/config')).data.enabled, false);
  assert.equal((await api(null, 'POST', '/giving/checkout', { amount: 10, fund_id: 1 })).status, 503);
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_API_URL: `http://127.0.0.1:${mock.address().port}` });
  const cfg = (await api(null, 'GET', '/giving/config')).data;
  assert.equal(cfg.publishable_key, 'pk_test_x');
  assert.deepEqual([...new Set(cfg.funds.map((f) => f.section))], ['Main', 'Missions', 'Special Offering']);
  assert.equal(cfg.funds.find((f) => f.is_default).name, 'Tithe');

  // Guests give with a name and email; covering the fee adds exactly enough.
  assert.equal((await api(null, 'POST', '/giving/checkout', { amount: 100, fund_id: 1 })).status, 400);
  const tithe = cfg.funds.find((f) => f.name === 'Tithe').id;
  const guest = await api(null, 'POST', '/giving/checkout', { amount: '$100', fund_id: tithe, cover_fee: true, name: 'Gail Guest', email: 'Guest@Give.org' });
  assert.equal(guest.data.client_secret, 'cs_secret');
  let sent = stripeCalls.at(-1).form;
  assert.equal(coverFee(10000, 2.2, 30), 256);
  assert.equal(sent['line_items[0][price_data][unit_amount]'], '10256');
  assert.equal(sent.mode, 'payment');
  assert.deepEqual([sent['payment_method_types[0]'], sent['payment_method_types[1]']], ['card', 'us_bank_account']);
  assert.equal(sent.customer_email, 'guest@give.org');
  assert.equal(sent.ui_mode, 'embedded');

  // A member giving monthly: their own Stripe customer, a subscription.
  const rita = (await api('admin', 'POST', '/people', { first_name: 'Rita', last_name: 'Give', email: 'rita@give.org', campus_id: 1 })).data;
  const ritaUser = db.prepare("INSERT INTO users (email, role, person_id) VALUES ('rita@give.org', 'volunteer', ?)").run(rita.id).lastInsertRowid;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies.rita = v.split(';')[0]; } }, ritaUser);
  const missions = cfg.funds.find((f) => f.name === 'Missions - Ukraine').id;
  await api('rita', 'POST', '/giving/checkout', { amount: 20, fund_id: missions, every: 'month', cover_fee: true });
  sent = stripeCalls.at(-1).form;
  assert.equal(sent.customer, 'cus_member');
  assert.equal(sent.mode, 'subscription');
  assert.equal(sent['line_items[0][price_data][recurring][interval]'], 'month');
  assert.equal(sent['subscription_data[metadata][person_id]'], String(rita.id));

  // Webhooks: signatures are checked; repeats don't double count.
  assert.equal((await hook('checkout.session.completed', {}, 'wrong')).status, 400);
  const paid = { mode: 'payment', payment_intent: 'pi_card', payment_status: 'paid', amount_total: 10256, created: Math.floor(Date.now() / 1000),
    metadata: { fund_id: String(tithe), amount_cents: '10000', fee_cents: '256', every: 'once', person_id: '', name: 'Gail Guest' }, customer_details: { email: 'guest@give.org', name: 'Gail Guest' } };
  assert.equal((await hook('checkout.session.completed', paid)).status, 200);
  await hook('checkout.session.completed', paid);
  const g1 = db.prepare("SELECT * FROM gifts WHERE stripe_ref = 'pi_card'").all();
  assert.equal(g1.length, 1);
  assert.deepEqual([g1[0].amount_cents, g1[0].fee_cents, g1[0].status, g1[0].method, g1[0].person_id], [10000, 256, 'succeeded', 'card', null]);
  assert.match(outbox.at(-1).text, /\$100\.00 to Tithe/);
  // Bank payments are pending until they clear.
  await hook('checkout.session.completed', { ...paid, payment_intent: 'pi_bank', payment_status: 'unpaid' });
  assert.equal(db.prepare("SELECT status, method FROM gifts WHERE stripe_ref = 'pi_bank'").get().status, 'pending');
  await hook('payment_intent.succeeded', { id: 'pi_bank' });
  assert.deepEqual({ ...db.prepare("SELECT status, method FROM gifts WHERE stripe_ref = 'pi_bank'").get() }, { status: 'succeeded', method: 'bank' });
  // Recurring: the first invoice may arrive before the checkout event.
  await hook('invoice.paid', { id: 'in_1', subscription: 'sub_1', amount_paid: 2075, payment_intent: 'pi_sub1', created: Math.floor(Date.now() / 1000) });
  await hook('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', customer: 'cus_member', metadata: { fund_id: String(missions), amount_cents: '2000', fee_cents: '75', every: 'month', person_id: String(rita.id) }, customer_details: { email: 'rita@give.org', name: 'Rita Give' } });
  const rg = db.prepare("SELECT * FROM recurring_gifts WHERE subscription_id = 'sub_1'").get();
  assert.equal(rg.person_id, rita.id);
  assert.deepEqual({ ...db.prepare("SELECT amount_cents, fee_cents, source, person_id FROM gifts WHERE stripe_ref = 'in_1'").get() }, { amount_cents: 2000, fee_cents: 75, source: 'recurring', person_id: rita.id });

  // Newer Stripe API versions put the subscription and payment elsewhere on the invoice.
  await hook('invoice.paid', { id: 'in_2', parent: { subscription_details: { subscription: 'sub_1' } }, payments: { data: [{ payment: { payment_intent: 'pi_sub2' } }] }, amount_paid: 2075, created: Math.floor(Date.now() / 1000) });
  assert.equal(db.prepare("SELECT recurring_id FROM gifts WHERE stripe_ref = 'in_2'").get().recurring_id, rg.id);
  await hook('charge.refunded', { refunded: true, payment_intent: 'pi_sub2' });
  assert.equal(db.prepare("SELECT status FROM gifts WHERE stripe_ref = 'in_2'").get().status, 'refunded');

  // My giving: Rita sees hers; someone else can't touch her recurring gift.
  const my = (await api('rita', 'GET', '/giving/mine')).data;
  assert.equal(my.total_cents, 2000);
  assert.equal(my.recurring[0].every_label, 'every month');
  assert.equal((await api('vol', 'POST', `/giving/recurring/${rg.id}/cancel`)).status, 404);
  assert.equal((await api('rita', 'PATCH', `/giving/recurring/${rg.id}`, { amount: 25 })).status, 200);
  assert.equal(stripeCalls.at(-1).form['items[0][price_data][unit_amount]'], String(2500 + coverFee(2500, 2.2, 30)));
  await api('rita', 'POST', `/giving/recurring/${rg.id}/cancel`);
  assert.equal(stripeCalls.at(-1).method, 'DELETE');
  assert.equal(db.prepare('SELECT status FROM recurring_gifts WHERE id = ?').get(rg.id).status, 'canceled');

  // Finance-only: even admins need the Finance permission to see who gave.
  assert.equal((await api('admin', 'GET', '/finance/summary')).status, 403);
  assert.equal((await api('rita', 'GET', '/finance/gifts')).status, 403);
  const adminId = db.prepare("SELECT id FROM users WHERE email = 'admin@mb.org'").get().id;
  await api('admin', 'PATCH', `/users/${adminId}`, { finance: true });
  assert.equal((await api('admin', 'GET', '/me')).data.finance, true);
  const sum = (await api('admin', 'GET', '/finance/summary')).data;
  assert.equal(sum.total, 10000 + 10000 + 2000);
  assert.equal(sum.by_fund.find((f) => f.name === 'Tithe').total, 20000);
  assert.ok(sum.by_method.some((m) => m.method === 'bank'));
  const donors = (await api('admin', 'GET', '/finance/donors')).data;
  assert.equal(donors[0].giver, 'Gail Guest');
  // Link the guest's gifts to her People record.
  const gail = (await api('admin', 'POST', '/people', { first_name: 'Gail', last_name: 'Guest', campus_id: 1 })).data;
  await api('admin', 'PATCH', `/finance/gifts/${g1[0].id}`, { person_id: gail.id });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE person_id = ?").get(gail.id).n, 2);
  const csv = await fetch(`${base}/api/finance/gifts.csv`, { headers: { cookie: cookies.admin } }).then((r) => r.text());
  assert.match(csv, /^Date,Giver,Email,Fund,Amount/);
  assert.match(csv, /Gail Guest/);
  // Refunds.
  await hook('charge.refunded', { refunded: true, payment_intent: 'pi_card' });
  assert.equal(db.prepare("SELECT status FROM gifts WHERE stripe_ref = 'pi_card'").get().status, 'refunded');

  // Funds: add, the default can't be hidden, a new default.
  const youth2 = (await api('admin', 'POST', '/finance/funds', { name: 'Missions - Haiti', section: 'Missions' })).data;
  assert.equal(youth2.section, 'Missions');
  assert.equal((await api('admin', 'PATCH', `/finance/funds/${tithe}`, { active: false })).status, 400);
  await api('admin', 'PATCH', `/finance/funds/${youth2.id}`, { is_default: true });
  assert.equal((await api(null, 'GET', '/giving/config')).data.funds.find((f) => f.is_default).name, 'Missions - Haiti');
  await api('admin', 'PATCH', `/finance/funds/${tithe}`, { is_default: true });
  assert.equal((await api('admin', 'PATCH', '/finance/settings', { fee_percent: 50 })).status, 400);
});

test('finance: cash and check batches, year-end statements (Finance only)', async () => {
  const fin = db.prepare("SELECT id FROM users WHERE email = 'admin@mb.org'").get().id;
  await api('admin', 'PATCH', `/users/${fin}`, { finance: true });
  const funds = (await api('admin', 'GET', '/finance/funds')).data.funds;
  const tithe = funds.find((f) => f.name === 'Tithe').id;
  const youth = funds.find((f) => f.name === 'Youth').id;
  const hh = (await api('admin', 'POST', '/people', { first_name: 'Cash', last_name: 'Giver', email: 'cash@give.org', campus_id: 1, new_household: true })).data;
  db.prepare("UPDATE households SET address = '12 Elm St', city = 'Springfield', state = 'IL', zip = '62701' WHERE id = ?").run(hh.household_id);
  const year = String(new Date().getFullYear() - 1);

  // A Sunday offering: two checks from a known giver, loose cash.
  assert.equal((await api('north', 'POST', '/finance/batches', {})).status, 403); // staff without Finance
  assert.equal((await api('admin', 'POST', '/finance/batches', { given_on: `${year}-03-01`, gifts: [{ amount: '', fund_id: tithe }] })).status, 400);
  const b = await api('admin', 'POST', '/finance/batches', { label: 'Sunday 9am', given_on: `${year}-03-01`, campus_id: 1, gifts: [
    { person_id: hh.id, fund_id: tithe, amount: '150.00', method: 'check', check_number: '1042' },
    { person_id: hh.id, fund_id: youth, amount: 25, method: 'check', check_number: '1043' },
    { name: 'Loose offering', fund_id: tithe, amount: '312.50', method: 'cash' },
  ] });
  assert.equal(b.status, 201);
  let batches = (await api('admin', 'GET', '/finance/batches')).data;
  assert.deepEqual([batches[0].label, batches[0].gifts, batches[0].total], ['Sunday 9am', 3, 48750]);
  // Fixing a typo replaces the batch's gifts.
  const one = (await api('admin', 'GET', `/finance/batches/${b.data.id}`)).data;
  await api('admin', 'PUT', `/finance/batches/${b.data.id}`, { ...one, gifts: one.gifts.map((g) => ({ ...g, amount: g.check_number === '1042' ? 160 : g.amount_cents / 100 })) });
  batches = (await api('admin', 'GET', '/finance/batches')).data;
  assert.equal(batches[0].total, 49750);

  // Statements: the year's givers, a printable statement, emailing everyone once.
  const st = (await api('admin', 'GET', `/finance/statements?year=${year}`)).data;
  const d = st.donors.find((x) => x.person_id === hh.id);
  assert.equal(d.total, 18500);
  assert.ok(!st.donors.some((x) => x.name === 'Loose offering')); // anonymous cash has no statement
  await api('admin', 'PUT', '/finance/statement-info', { org: 'Meadowbrook Church', address: '100 Meadow Ln', ein: '12-3456789', signer: 'Pastor Rachel', note: 'No goods or services were provided.' });
  const page = await fetch(`${base}/api/finance/statements/${d.key}?year=${year}`, { headers: { cookie: cookies.admin } }).then((r) => r.text());
  assert.match(page, /Giving Statement/);
  assert.match(page, /EIN 12-3456789/);
  assert.match(page, /12 Elm St, Springfield, IL 62701/);
  assert.match(page, /\$185\.00/);
  assert.match(page, /Check #1042/);
  assert.equal((await fetch(`${base}/api/finance/statements/${d.key}?year=${year}`, { headers: { cookie: cookies.north } })).status, 403);
  const before = outbox.length;
  const sent = (await api('admin', 'POST', '/finance/statements/send', { year })).data;
  assert.ok(sent.sent >= 1);
  assert.ok(outbox.slice(before).some((m) => m.to === 'cash@give.org' && /\$185\.00/.test(m.html)));
  const again = (await api('admin', 'POST', '/finance/statements/send', { year })).data;
  assert.equal(again.sent, 0); // not twice
  assert.ok((await api('admin', 'GET', `/finance/statements?year=${year}`)).data.donors.find((x) => x.key === d.key).sent_at);

  // The giver downloads their own.
  const uid = db.prepare("INSERT INTO users (email, role, person_id) VALUES ('cash@give.org', 'volunteer', ?)").run(hh.id).lastInsertRowid;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies.cash = v.split(';')[0]; } }, uid);
  const mine = await fetch(`${base}/api/giving/statement?year=${year}`, { headers: { cookie: cookies.cash } });
  assert.equal(mine.status, 200);
  assert.match(await mine.text(), /\$185\.00/);
  assert.equal((await fetch(`${base}/api/giving/statement?year=1999`, { headers: { cookie: cookies.cash } })).status, 404);

  await api('admin', 'DELETE', `/finance/batches/${b.data.id}`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gifts WHERE batch_id = ?').get(b.data.id).n, 0);
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
