// Safety prompts: roll-call "New guest" duplicate check, and the volunteer counts shown before a
// repeating service is edited or deleted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { impactNote, duplicateOf, personLabel } from '../public/js/guards.js';

let server, base, db, typeId, svc;
const cookies = {};

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-gd-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  make('admin', 'admin', null);
  make('north', 'staff', '[1]');
  make('south', 'staff', '[2]');
  make('leader', 'leader', '[1]');
  // A repeating service at North with three services in fixed far-future dates.
  typeId = Number(db.prepare(`INSERT INTO service_types (campus_id, name, day_of_week, start_time, every_weeks, starts_on) VALUES (1, 'Sunday', 0, '09:00', 1, '2090-01-07')`).run().lastInsertRowid);
  svc = ['2090-01-07', '2090-01-14', '2090-01-21'].map((d) => Number(db.prepare('INSERT INTO services (campus_id, service_type_id, starts_at) VALUES (1, ?, ?)').run(typeId, `${d}T09:00`).lastInsertRowid));
  const team = Number(db.prepare(`INSERT INTO teams (name, campus_id) VALUES ('Band', 1)`).run().lastInsertRowid);
  const pos = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(team, 'Drums').lastInsertRowid);
  const ppl = ['A', 'B', 'C'].map((n) => Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id) VALUES (?, ?, 1)').run(n, 'Vol').lastInsertRowid));
  const give = (s, p, status) => db.prepare('INSERT INTO assignments (service_id, position_id, person_id, status) VALUES (?, ?, ?, ?)').run(s, pos, p, status);
  give(svc[0], ppl[0], 'accepted'); give(svc[1], ppl[0], 'accepted'); // same person twice counts once
  give(svc[1], ppl[1], 'pending');
  give(svc[2], ppl[2], 'declined');
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[role] }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('roll-call New guest (no force) gets the duplicate 409 for a matching name and phone or email, name only for leaders', async () => {
  const id = Number(db.prepare(`INSERT INTO people (first_name, last_name, campus_id, phone, email) VALUES ('Gus', 'Guest', 1, '(555) 010-2000', 'gus@example.org')`).run().lastInsertRowid);
  const guest = { first_name: 'gus', last_name: 'Guest', phone: '555-010-2000', status: 'guest', campus_id: 1, new_household: true };
  const l = await api('leader', 'POST', '/people', guest);
  assert.equal(l.status, 409);
  assert.deepEqual(l.data.duplicate, { id, first_name: 'Gus', last_name: 'Guest' });
  const e = await api('north', 'POST', '/people', { ...guest, phone: undefined, email: 'gus@example.org' });
  assert.equal(e.status, 409);
  assert.equal(e.data.duplicate.id, id);
  // A different phone is a different person; and "No, add someone new" (force) still adds.
  assert.equal((await api('leader', 'POST', '/people', { ...guest, phone: '555-999-0000' })).status, 201);
  assert.equal((await api('leader', 'POST', '/people', { ...guest, force: true })).status, 201);
  // A match at another campus is not revealed.
  assert.equal((await api('south', 'POST', '/people', { ...guest, campus_id: 2 })).status, 201);
});

test('impact counts for a series: this and following, one service, and permissions', async () => {
  const all = await api('north', 'GET', `/series/${typeId}/impact?from=2090-01-01`);
  assert.deepEqual(all.data, { services: 3, volunteers: 3, assignments: 4, accepted: 1 });
  const later = await api('north', 'GET', `/series/${typeId}/impact?from=2090-01-14`);
  assert.deepEqual(later.data, { services: 2, volunteers: 3, assignments: 3, accepted: 1 });
  const one = await api('north', 'GET', `/services/${svc[0]}/impact`);
  assert.deepEqual(one.data, { services: 1, volunteers: 1, assignments: 1, accepted: 1 });
  assert.equal((await api('north', 'GET', `/series/${typeId}/impact?from=2091-01-01`)).data.volunteers, 0);
  assert.equal((await api('admin', 'GET', `/series/${typeId}/impact?from=2090-01-01`)).status, 200);
  // Same guards as the service routes: staff only, and only at their campuses.
  assert.equal((await api('leader', 'GET', `/series/${typeId}/impact`)).status, 403);
  assert.equal((await api('leader', 'GET', `/services/${svc[0]}/impact`)).status, 403);
  assert.equal((await api('south', 'GET', `/series/${typeId}/impact`)).status, 403);
  assert.equal((await api('south', 'GET', `/services/${svc[0]}/impact`)).status, 403);
  assert.equal((await api('north', 'GET', '/services/99999/impact')).status, 404);
});

test('prompt wording helpers', () => {
  assert.equal(impactNote({ volunteers: 0, accepted: 0 }), null);
  assert.deepEqual(impactNote({ volunteers: 12, accepted: 8 }), { lead: '12 volunteers are scheduled', rest: ' in these services (8 accepted).' });
  assert.deepEqual(impactNote({ volunteers: 1, accepted: 0 }, { one: true }), { lead: '1 volunteer is scheduled', rest: ' in this service (0 accepted).' });
  const dup = { id: 4, first_name: 'Nora', last_name: 'D' };
  assert.deepEqual(duplicateOf({ status: 409, data: { duplicate: dup } }), dup);
  assert.equal(duplicateOf({ status: 409, data: {} }), null);
  assert.equal(duplicateOf({ status: 403, data: { duplicate: dup } }), null);
  assert.equal(personLabel({ first_name: 'Nora', last_name: '' }), 'Nora');
});
