// Household and pickup safety: who may add people to an existing family, what duplicate checks
// reveal, merge and campus edges, and the audit trail for households and pickups.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { setSetting } from '../server/db.js';

let server, base, db, station;
const cookies = {};

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hh-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    return Number(id);
  };
  make('admin', 'admin', null);
  make('northadmin', 'admin', '[1]');
  make('north', 'staff', '[1]');
  make('staff', 'staff', null);
  const listed = make('leader', 'leader', '[1]');
  make('plainleader', 'leader', '[1]');
  db.prepare('UPDATE users SET checkin = 1 WHERE id = ?').run(listed);
  // Pair a station at North.
  const pair = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
  assert.equal((await api('admin', 'POST', '/checkin/devices', { code: pair.code, name: 'Lobby', campus_id: 1 })).status, 201);
  station = (await api(null, 'GET', `/checkin/pair/${pair.secret}`)).data.token;
});
after(() => server.close());

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const api = (role, method, url, body) => call(role ? { cookie: cookies[role] } : {}, method, url, body);
const asStation = (method, url, body) => call({ 'x-station': station }, method, url, body);
const household = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
const person = (first, last, campus, extra = {}) => Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id, email, birthdate, phone, household_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(first, last, campus, extra.email ?? '', extra.birthdate ?? null, extra.phone ?? '', extra.household_id ?? null).lastInsertRowid);
const audits = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action).map((a) => ({ ...a, d: JSON.parse(a.detail) }));

test('below staff, only a child can be added to an existing family; adults are staff-only', async () => {
  const hh = household('Adder Household', 1);
  for (const who of [asStation, (m, u, b) => api('leader', m, u, b)]) {
    for (const body of [{ household_role: 'adult' }, {}, { household_role: 'nonsense' }]) {
      const r = await who('POST', '/people', { first_name: 'Sneaky', last_name: 'Adult', household_id: hh, force: true, ...body });
      assert.equal(r.status, 403, JSON.stringify(body));
      assert.match(r.data.error, /staff/);
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people WHERE household_id = ?').get(hh).n, 0);
  // A child is fine, and the join is audited.
  const kid = await api('leader', 'POST', '/people', { first_name: 'Kid', last_name: 'Adder', household_id: hh, household_role: 'child', force: true });
  assert.equal(kid.status, 201);
  assert.deepEqual(audits('household.member_add').at(-1).d, { person_id: kid.data.id, household_id: hh, role: 'child', new_household: false });
  // Staff are unchanged: they can add an adult.
  const adult = await api('north', 'POST', '/people', { first_name: 'Ada', last_name: 'Adder', household_id: hh, household_role: 'adult', force: true });
  assert.equal(adult.status, 201);
  assert.equal(audits('household.member_add').at(-1).d.role, 'adult');
});

test('a station can still add a new family and then a child to it', async () => {
  const parent = await asStation('POST', '/people', { first_name: 'Newly', last_name: 'Arrived', phone: '555-0199', campus_id: 1, status: 'guest', new_household: true, force: true });
  assert.equal(parent.status, 201);
  const kid = await asStation('POST', '/people', { first_name: 'Little', last_name: 'Arrived', birthdate: '2018-03-04', household_id: parent.data.household_id, household_role: 'child', campus_id: 1, status: 'guest', force: true });
  assert.equal(kid.status, 201);
  const rows = audits('household.member_add').filter((a) => a.d.household_id === parent.data.household_id);
  assert.deepEqual(rows.map((a) => [a.d.person_id, a.d.role]), [[parent.data.id, 'adult'], [kid.data.id, 'child']]);
  // Another campus's family is still off limits, even for a child.
  const south = household('South Household', 2);
  assert.equal((await asStation('POST', '/people', { first_name: 'X', household_id: south, household_role: 'child', force: true })).status, 403);
});

test('the duplicate check stays at the caller’s campuses and shows leaders and stations only a name', async () => {
  person('Dana', 'Dupont', 2, { email: 'dana@example.org', birthdate: '2000-01-01', phone: '555-0123' });
  person('Dena', 'Dupont', 2, { email: 'dena@example.org' });
  const north = person('Nora', 'Dupont', 1, { email: 'nora@example.org', birthdate: '1999-02-03', phone: '555-0456' });
  // A campus-1 caller doesn't hear about the campus-2 person at all.
  assert.equal((await asStation('POST', '/people', { first_name: 'Dana', last_name: 'Dupont', email: 'dana@example.org' })).status, 201);
  assert.equal((await api('north', 'POST', '/people', { first_name: 'Dena', last_name: 'Dupont', email: 'dena@example.org' })).status, 201);
  // Name-only for stations and leaders.
  const body = { first_name: 'Nora', last_name: 'Dupont', email: 'nora@example.org' };
  for (const r of [await asStation('POST', '/people', body), await api('leader', 'POST', '/people', body)]) {
    assert.equal(r.status, 409);
    assert.deepEqual(r.data.duplicate, { id: north, first_name: 'Nora', last_name: 'Dupont' });
  }
  // Staff keep the fuller record within their campus.
  const s = await api('north', 'POST', '/people', body);
  assert.equal(s.status, 409);
  assert.deepEqual(s.data.duplicate, { id: north, first_name: 'Nora', last_name: 'Dupont', email: 'nora@example.org', phone: '555-0456', birthdate: '1999-02-03' });
  // A church-wide admin still sees the campus-2 match.
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'Dena', last_name: 'Dupont', email: 'dena@example.org' })).status, 409);
});

test('moving a person between households is audited, with the old and new household', async () => {
  const a = household('Alpha', 1); const b = household('Beta', 1);
  const p = person('Mover', 'Test', 1);
  assert.equal((await api('north', 'PATCH', `/people/${p}`, { household_id: a, household_role: 'child' })).status, 200);
  assert.deepEqual(audits('household.member_add').at(-1).d, { person_id: p, from: null, to: a, role: 'child' });
  assert.equal((await api('north', 'PATCH', `/people/${p}`, { household_id: b })).status, 200);
  assert.deepEqual(audits('household.member_move').at(-1).d, { person_id: p, from: a, to: b, role: 'child' });
  assert.deepEqual(audits('person.update').at(-1).d.household_id, { from: a, to: b });
  // Unrelated edits don't write a household row.
  const before = audits('household.member_move').length;
  await api('north', 'PATCH', `/people/${p}`, { nickname: 'Mo' });
  assert.equal(audits('household.member_move').length, before);
  assert.equal(audits('person.update').at(-1).d.household_id, undefined);
});

test('merge refuses to bring in a household at a campus the admin doesn’t cover', async () => {
  const southHh = household('Far Family', 2);
  const keep = person('Keeper', 'Merge', 1);
  const dup = person('Keeper', 'Merge', 1, { household_id: southHh });
  const r = await api('northadmin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /campus/);
  assert.equal(db.prepare('SELECT household_id, archived FROM people WHERE id = ?').get(keep).household_id, null);
  assert.equal(db.prepare('SELECT archived FROM people WHERE id = ?').get(dup).archived, 0, 'nothing merged');
  assert.equal((await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200, 'a church-wide admin can');
  assert.equal(db.prepare('SELECT household_id FROM people WHERE id = ?').get(keep).household_id, southHh);
  // A household at their own campus is fine.
  const ownHh = household('Near Family', 1);
  const k2 = person('Second', 'Merge', 1);
  const d2 = person('Second', 'Merge', 1, { household_id: ownHh });
  assert.equal((await api('northadmin', 'POST', `/people/${k2}/merge`, { duplicate_id: d2 })).status, 200);
  assert.equal(db.prepare('SELECT household_id FROM people WHERE id = ?').get(k2).household_id, ownHh);
});

test('creating and editing a household is audited, including a campus change', async () => {
  const made = await api('admin', 'POST', '/households', { name: 'Audit Family', campus_id: 1 });
  assert.equal(made.status, 201);
  assert.deepEqual(audits('household.create').at(-1).d, { id: made.data.id, name: 'Audit Family', campus_id: 1 });
  assert.equal((await api('admin', 'PATCH', `/households/${made.data.id}`, { city: 'Springfield' })).status, 200);
  assert.deepEqual(audits('household.update').at(-1).d, { id: made.data.id, fields: ['city'] });
  assert.equal((await api('admin', 'PATCH', `/households/${made.data.id}`, { campus_id: 2 })).status, 200);
  assert.deepEqual(audits('household.update').at(-1).d, { id: made.data.id, fields: ['campus_id'], from_campus: 1, to_campus: 2 });
});

test('pickup people: adding and removing are audited and staff-only', async () => {
  const hh = household('Pickup Family', 1);
  assert.equal((await api('leader', 'POST', `/households/${hh}/pickups`, { name: 'Nope' })).status, 403);
  const added = await api('north', 'POST', `/households/${hh}/pickups`, { name: 'Grandma Jo', relationship: 'Grandmother' });
  assert.equal(added.status, 201);
  assert.deepEqual(audits('pickup.add').at(-1).d, { household_id: hh, name: 'Grandma Jo' });
  assert.equal((await api('leader', 'DELETE', `/pickups/${added.data.id}`)).status, 403);
  assert.equal((await api('north', 'DELETE', `/pickups/${added.data.id}`)).status, 200);
  assert.deepEqual(audits('pickup.remove').at(-1).d, { household_id: hh, name: 'Grandma Jo' });
  assert.equal(audits('pickup.remove').at(-1).user_id, db.prepare("SELECT id FROM users WHERE email = 'north@mb.org'").get().id);
});

test('blockout dates must be real days', async () => {
  const p = person('Away', 'Test', 1);
  for (const [start, end] of [['2030-02-30', undefined], ['2030-01-10', '2030-04-31'], ['2030-13-01', undefined]]) {
    assert.equal((await api('admin', 'POST', '/blockouts', { person_id: p, start_date: start, end_date: end })).status, 400, `${start} ${end}`);
  }
  assert.equal((await api('admin', 'POST', '/blockouts', { person_id: p, start_date: '2030-02-28', end_date: '2030-03-01' })).status, 201);
});

test('GET /checkin/campuses: a station sees its own campus, signed-out callers are refused, listed leaders see theirs', async () => {
  assert.deepEqual((await asStation('GET', '/checkin/campuses')).data.map((c) => c.id), [1]);
  assert.equal((await api(null, 'GET', '/checkin/campuses')).status, 401);
  assert.deepEqual((await api('leader', 'GET', '/checkin/campuses')).data.map((c) => c.id), [1]);
  assert.equal((await api('plainleader', 'GET', '/checkin/campuses')).status, 403, 'a leader not on the check-in list');
});

test('family search matches the family name or anyone in it, lists who is there, and stays at the caller’s campuses', async () => {
  const north = household('Searchwell Household', 1);
  person('Marigold', 'Searchwell', 1, { household_id: north });
  const kid = person('Tobias', 'Searchwell', 1, { household_id: north });
  db.prepare("UPDATE people SET household_role = 'child' WHERE id = ?").run(kid);
  const south = household('Farside Household', 2);
  person('Marigold', 'Farside', 2, { household_id: south });
  // By family name, and by a member's first name or full name.
  for (const q of ['searchwell', 'Tobias', 'marigold searchwell']) {
    const r = await api('admin', 'GET', `/households?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200);
    const hit = r.data.find((h) => h.id === north);
    assert.ok(hit, q);
    assert.deepEqual(hit.people.map((m) => m.name).sort(), ['Marigold', 'Tobias']);
    assert.ok(hit.people.some((m) => m.name === 'Tobias' && m.role === 'child'));
  }
  // A North-only admin doesn't find the South family, even by a member's name.
  const limited = await api('northadmin', 'GET', '/households?q=marigold');
  assert.ok(limited.data.some((h) => h.id === north));
  assert.ok(!limited.data.some((h) => h.id === south));
  // Volunteers can't search families at all.
  assert.equal((await call({}, 'GET', '/households?q=marigold')).status, 401);
});
