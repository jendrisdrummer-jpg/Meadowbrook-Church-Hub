// Two-campus features: bulk "Set serving campuses", the one-tap "Add {Campus} for them" while scheduling,
// and roll call's church-wide name search. Own database; services sit on fixed past dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { missingPeople } from '../server/attendance-missing.js';

let server, base, db, upDir;
const cookies = {};
const P = {}; // people
const S = {}; // services

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-twc-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Howard Campus', 'Howard', 'America/Chicago'), (2, 'Luxemburg Campus', 'Luxemburg', 'America/Chicago');`);
  const person = (key, first, last, campus, extra = {}) => {
    P[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, nickname, email, phone, notes, birthdate, campus_id, status, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(first, last, extra.nick || '', `${key}@example.com`, '555-0199', 'Private note', '1980-02-03', campus, extra.status || 'regular', extra.archived || 0).lastInsertRowid);
  };
  person('sarah', 'Sarah', 'Miller', 1, { nick: 'Sally' });
  person('tom', 'Tom', 'Howard-Reg', 1);
  person('lux', 'Lena', 'Luxford', 2);
  person('gone', 'Sarah', 'Retired', 1, { archived: 1 });
  person('idle', 'Sarah', 'Idle', 1, { status: 'inactive' });
  person('free', 'Nora', 'Nocampus', null);
  const service = (key, campus, startsAt) => { S[key] = Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, key, startsAt).lastInsertRowid); };
  service('howard', 1, '2025-03-02T09:00');
  service('lux', 2, '2025-03-02T13:00');
  for (const [key, role, campuses, flag] of [['admin', 'admin', null, 0], ['staff', 'staff', null, 0], ['luxstaff', 'staff', '[2]', 0], ['howstaff', 'staff', '[1]', 0],
    ['leader', 'leader', null, 0], ['vol', 'volunteer', null, 0], ['luxspot', 'volunteer', '[2]', 1], ['luxlead', 'leader', '[2]', 0]]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids, attendance) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, flag).lastInsertRowid);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

async function api(who, method, url, body) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}
const serving = (id) => db.prepare('SELECT campus_id FROM serving_campuses WHERE person_id = ? ORDER BY campus_id').all(id).map((r) => r.campus_id);
const audits = (action) => db.prepare('SELECT user_id, detail FROM audit_log WHERE action = ? ORDER BY id').all(action);
const newPeople = (n, campus = 1) => Array.from({ length: n }, (_, i) => Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES (?, 'Bulk', ?)").run(`B${i}`, campus).lastInsertRowid));

// ---------------------------------------------------------------- Feature 1(a): bulk serving campuses
test('bulk serving campuses: staff and admins set the same list for everyone, audited once', async () => {
  const ids = [P.sarah, P.tom];
  const res = await api('staff', 'POST', '/people/bulk/serving-campuses', { person_ids: ids, campus_ids: [1, 2] });
  assert.equal(res.status, 200);
  assert.equal(res.data.updated, 2);
  assert.deepEqual([serving(P.sarah), serving(P.tom)], [[1, 2], [1, 2]]);
  const a = audits('person.serving_campuses_bulk');
  assert.equal(a.length, 1);
  assert.deepEqual(JSON.parse(a[0].detail), { person_ids: ids, to: [1, 2], changed: 2 });
  // empty list = back to the home campus only
  assert.equal((await api('admin', 'POST', '/people/bulk/serving-campuses', { person_ids: ids, campus_ids: [] })).status, 200);
  assert.deepEqual([serving(P.sarah), serving(P.tom)], [[], []]);
});

test('bulk serving campuses: the same guard as the single route (leaders and volunteers refused)', async () => {
  const body = { person_ids: [P.sarah], campus_ids: [2] };
  for (const who of ['leader', 'vol', 'luxspot', 'luxlead']) assert.equal((await api(who, 'POST', '/people/bulk/serving-campuses', body)).status, 403, who);
  assert.equal((await api('leader', 'PUT', `/people/${P.sarah}/serving-campuses`, { campus_ids: [2] })).status, 403, 'single route agrees');
  assert.deepEqual(serving(P.sarah), []);
  // needs the app header like every change
  const raw = await fetch(`${base}/api/people/bulk/serving-campuses`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.staff }, body: JSON.stringify(body) });
  assert.equal(raw.status, 403);
});

test('bulk serving campuses: validates every id, and one bad one changes nothing', async () => {
  const url = '/people/bulk/serving-campuses';
  assert.equal((await api('staff', 'POST', url, { campus_ids: [1] })).status, 400, 'no people');
  assert.equal((await api('staff', 'POST', url, { person_ids: [], campus_ids: [1] })).status, 400);
  assert.equal((await api('staff', 'POST', url, { person_ids: [P.sarah] })).status, 400, 'no campus list');
  assert.equal((await api('staff', 'POST', url, { person_ids: [P.sarah], campus_ids: [999] })).status, 400, 'unknown campus');
  assert.equal((await api('staff', 'POST', url, { person_ids: [P.sarah], campus_ids: ['x'] })).status, 400, 'junk campus');
  assert.equal((await api('staff', 'POST', url, { person_ids: [P.sarah, 'abc'], campus_ids: [1] })).status, 400, 'junk person');
  assert.equal((await api('staff', 'POST', url, { person_ids: [P.sarah, 999999], campus_ids: [2] })).status, 404, 'unknown person');
  assert.deepEqual(serving(P.sarah), [], 'nothing was written');
});

test('bulk serving campuses: a campus-limited account is refused other campuses and other campuses’ people, all or nothing', async () => {
  // Howard-only staff: can't choose Luxemburg, and can't touch a Luxemburg person
  assert.equal((await api('howstaff', 'POST', '/people/bulk/serving-campuses', { person_ids: [P.sarah], campus_ids: [1, 2] })).status, 403);
  assert.equal((await api('howstaff', 'POST', '/people/bulk/serving-campuses', { person_ids: [P.sarah, P.lux], campus_ids: [1] })).status, 403);
  assert.deepEqual([serving(P.sarah), serving(P.lux)], [[], []], 'the allowed person was not changed either');
  assert.equal((await api('howstaff', 'POST', '/people/bulk/serving-campuses', { person_ids: [P.sarah], campus_ids: [1] })).status, 200);
  assert.deepEqual(serving(P.sarah), [1]);
  // a campus this account can't reach, already on someone's list, stays put
  db.prepare('INSERT INTO serving_campuses (person_id, campus_id) VALUES (?, 2)').run(P.sarah);
  assert.equal((await api('howstaff', 'POST', '/people/bulk/serving-campuses', { person_ids: [P.sarah], campus_ids: [1] })).status, 200);
  assert.deepEqual(serving(P.sarah), [1, 2]);
  // people with no campus are open to everyone, as elsewhere
  assert.equal((await api('howstaff', 'POST', '/people/bulk/serving-campuses', { person_ids: [P.free], campus_ids: [1] })).status, 200);
  db.prepare('DELETE FROM serving_campuses').run();
});

test('bulk serving campuses: up to 500 people per request', async () => {
  const many = newPeople(501);
  const tooMany = await api('staff', 'POST', '/people/bulk/serving-campuses', { person_ids: many, campus_ids: [1, 2] });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /500/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM serving_campuses').get().n, 0);
  const ok = await api('staff', 'POST', '/people/bulk/serving-campuses', { person_ids: many.slice(0, 500), campus_ids: [1, 2] });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.updated, 500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM serving_campuses').get().n, 1000);
  db.prepare('DELETE FROM serving_campuses').run();
});

// ---------------------------------------------------------------- Feature 1(b): one-tap fix while scheduling
function position() {
  const t = Number(db.prepare("INSERT INTO teams (name) VALUES ('Greeters')").run().lastInsertRowid);
  // The leader account leads this team, so the only thing standing in the way is the other campus.
  db.prepare('UPDATE users SET person_id = ? WHERE email = ?').run(P.tom, 'leader@mb.org');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(t, P.tom);
  return Number(db.prepare("INSERT INTO positions (team_id, name) VALUES (?, 'Door')").run(t).lastInsertRowid);
}

test('scheduling someone from the other campus: the 409 says what a staff member may do about it', async () => {
  const pos = position();
  const url = `/services/${S.lux}/assignments`;
  const asStaff = await api('staff', 'POST', url, { position_id: pos, person_id: P.sarah });
  assert.equal(asStaff.status, 409);
  assert.equal(asStaff.data.other_campus, true);
  assert.equal(asStaff.data.campus_name, 'Luxemburg');
  assert.equal(asStaff.data.campus_id, 2);
  assert.equal(asStaff.data.can_add_campus, true);
  // a leader may not edit serving campuses
  const asLeader = await api('leader', 'POST', url, { position_id: pos, person_id: P.sarah });
  assert.equal(asLeader.status, 409);
  assert.equal(asLeader.data.can_add_campus, false);
  // staff limited to Luxemburg can't manage a Howard person
  const asLux = await api('luxstaff', 'POST', url, { position_id: pos, person_id: P.sarah });
  assert.equal(asLux.data.can_add_campus, false);
});

test('one tap: add the campus (keeping the home campus), then schedule', async () => {
  const pos = position();
  const url = `/services/${S.lux}/assignments`;
  assert.deepEqual(serving(P.tom), []);
  const add = await api('staff', 'POST', `/people/${P.tom}/serving-campuses/add`, { campus_id: 2 });
  assert.equal(add.status, 200);
  assert.deepEqual(add.data.serving_campuses, [1, 2], 'home campus written down, not lost');
  assert.deepEqual(serving(P.tom), [1, 2]);
  const a = audits('person.serving_campuses').pop();
  assert.deepEqual(JSON.parse(a.detail), { id: P.tom, from: [], to: [1, 2], added: 2 });
  const sched = await api('staff', 'POST', url, { position_id: pos, person_id: P.tom });
  assert.equal(sched.status, 201, 'no more warning');
  assert.ok(db.prepare('SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ? AND position_id = ?').get(S.lux, P.tom, pos));
  // adding again changes nothing
  assert.deepEqual((await api('staff', 'POST', `/people/${P.tom}/serving-campuses/add`, { campus_id: 2 })).data.serving_campuses, [1, 2]);
});

test('one tap: the same checks as editing a person’s serving campuses', async () => {
  const add = (who, id, campus_id) => api(who, 'POST', `/people/${id}/serving-campuses/add`, { campus_id });
  assert.equal((await add('leader', P.sarah, 2)).status, 403);
  assert.equal((await add('vol', P.sarah, 2)).status, 403);
  assert.equal((await add('luxstaff', P.sarah, 2)).status, 403, 'a Howard person is out of reach for Luxemburg staff');
  assert.equal((await add('howstaff', P.sarah, 2)).status, 403, 'and so is the Luxemburg campus for Howard staff');
  assert.equal((await add('staff', P.sarah, 999)).status, 400);
  assert.equal((await add('staff', 999999, 2)).status, 404);
  assert.equal((await api('staff', 'POST', `/people/${P.sarah}/serving-campuses/add`, {})).status, 400);
  assert.deepEqual(serving(P.sarah), []);
  // someone with no campus can already serve anywhere: nothing to add
  assert.deepEqual((await add('staff', P.free, 2)).data.serving_campuses, []);
  assert.deepEqual(serving(P.free), []);
});

// ---------------------------------------------------------------- Feature 2: roll call, whole church
test('church search: only people who can take attendance for this service, at a campus they can', async () => {
  const q = (who, svc, term = 'sarah') => api(who, 'GET', `/services/${svc}/roll/search?q=${term}`);
  assert.equal((await q('vol', S.lux)).status, 403, 'a volunteer without the flag');
  assert.equal((await q('luxspot', S.howard)).status, 403, 'a service at a campus they can’t take attendance for');
  assert.equal((await q('luxspot', S.lux)).status, 200);
  assert.equal((await q('luxlead', S.lux)).status, 200, 'leaders and above can');
  assert.equal((await q('leader', S.howard)).status, 200);
  assert.equal((await q('luxlead', S.howard)).status, 403);
  assert.equal((await q('luxspot', 999999)).status, 404);
  const anon = await fetch(`${base}/api/services/${S.lux}/roll/search?q=sarah`);
  assert.equal(anon.status, 401);
});

test('church search: finds active people at any campus, and returns names and a campus label only', async () => {
  const { data } = await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=sarah`);
  assert.deepEqual(data.people.map((p) => p.last_name), ['Miller']);
  assert.deepEqual(data.people[0], { id: P.sarah, first_name: 'Sarah', last_name: 'Miller', nickname: 'Sally', campus: 'Howard' });
  const text = JSON.stringify(data);
  for (const leak of ['555-0199', '@example.com', 'Private note', '1980', 'photo', 'household', 'birthdate', 'email', 'phone']) assert.ok(!text.includes(leak), leak);
  // nickname, last name and both words work; archived and inactive people never appear
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=sally`)).data.people[0].id, P.sarah);
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=sarah%20mill`)).data.people.length, 1);
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=retired`)).data.people.length, 0, 'archived');
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=idle`)).data.people.length, 0, 'inactive');
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=nora`)).data.people[0].campus, '', 'no campus, no label');
  // too short, and a typed % matches itself rather than everyone
  assert.deepEqual((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=s`)).data.people, []);
  assert.deepEqual((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=%25%25`)).data.people, []);
});

test('church search is rate limited per account', async () => {
  let last;
  for (let i = 0; i < 70; i++) last = await api('luxlead', 'GET', `/services/${S.lux}/roll/search?q=tom`);
  assert.equal(last.status, 429);
  assert.equal((await api('luxspot', 'GET', `/services/${S.lux}/roll/search?q=tom`)).status, 200, 'another account is unaffected');
});

test('picking someone from another campus marks them present here, and they stay a Howard person', async () => {
  const mark = (who, svc, id) => api(who, 'POST', `/services/${svc}/roll/church`, { person_id: id });
  // the ordinary roll route still refuses people at campuses the account can't reach
  assert.equal((await api('luxspot', 'POST', `/services/${S.lux}/roll`, { person_ids: [P.sarah] })).status, 403);
  assert.equal((await mark('vol', S.lux, P.sarah)).status, 403);
  assert.equal((await mark('luxspot', S.howard, P.sarah)).status, 403);
  assert.equal((await mark('luxspot', S.lux, P.gone)).status, 404, 'archived');
  assert.equal((await mark('luxspot', S.lux, P.idle)).status, 404, 'inactive');
  assert.equal((await mark('luxspot', S.lux, 999999)).status, 404);
  assert.equal((await mark('luxspot', S.lux, undefined)).status, 404);
  const ok = await mark('luxspot', S.lux, P.sarah);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.present, 1);
  assert.ok(db.prepare('SELECT 1 FROM attendance WHERE service_id = ? AND person_id = ?').get(S.lux, P.sarah));
  assert.equal(db.prepare('SELECT campus_id FROM people WHERE id = ?').get(P.sarah).campus_id, 1, 'still a Howard person');
  assert.equal((await mark('luxspot', S.lux, P.sarah)).data.present, 1, 'marking twice is harmless');
  // they now show on this roll, and can be unmarked the usual way
  const roll = await api('luxspot', 'GET', `/services/${S.lux}/roll`);
  assert.ok(roll.data.people.some((p) => p.id === P.sarah) && roll.data.present.includes(P.sarah));
  assert.equal((await api('luxspot', 'POST', `/services/${S.lux}/roll`, { person_ids: [P.sarah], present: false })).status, 200);
  assert.ok(!db.prepare('SELECT 1 FROM attendance WHERE service_id = ? AND person_id = ?').get(S.lux, P.sarah));
  const a = audits('attendance.church_wide');
  assert.equal(a.length, 2);
  assert.deepEqual(JSON.parse(a[0].detail), { service_id: S.lux, person_id: P.sarah, home_campus_id: 1, late: true });
});

test('adding a new guest checks the whole church for the same name, names and campus only', async () => {
  const guest = (body) => api('luxspot', 'POST', `/services/${S.lux}/roll/guest`, body);
  const dup = await guest({ first_name: 'sarah', last_name: 'MILLER' });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.data.duplicate, { id: P.sarah, first_name: 'Sarah', last_name: 'Miller', campus: 'Howard' });
  assert.ok(!JSON.stringify(dup.data).includes('@example.com'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM people WHERE last_name = 'Miller'").get().n, 1, 'no duplicate was made');
  // a person at the service's own campus is preferred when the name is at both
  db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Sarah', 'Miller', 2)").run();
  const both = await guest({ first_name: 'Sarah', last_name: 'Miller' });
  assert.equal(both.data.duplicate.campus, 'Luxemburg');
  // archived people don't count, and "add anyway" still works
  assert.equal((await guest({ first_name: 'Sarah', last_name: 'Retired' })).status, 201);
  assert.equal((await guest({ first_name: 'Sarah', last_name: 'Miller', force: true })).status, 201);
});

test('the missed list counts a Howard person marked at Luxemburg as here', () => {
  const sundays = ['2025-04-06', '2025-04-13', '2025-04-20', '2025-04-27', '2025-05-04', '2025-05-11'];
  const hs = sundays.map((d) => Number(db.prepare("INSERT INTO services (campus_id, title, starts_at) VALUES (1, 'Sunday', ?)").run(`${d}T09:00`).lastInsertRowid));
  const ls = sundays.map((d) => Number(db.prepare("INSERT INTO services (campus_id, title, starts_at) VALUES (2, 'Sunday', ?)").run(`${d}T13:00`).lastInsertRowid));
  const reg = (key, first) => { P[key] = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES (?, 'Regular', 1)").run(first).lastInsertRowid); };
  reg('trav', 'Traveller'); reg('stay', 'Stayaway'); reg('anchor', 'Anchor');
  const mark = (svc, p) => db.prepare('INSERT OR IGNORE INTO attendance (service_id, person_id) VALUES (?, ?)').run(svc, p);
  // Everyone came three times early on; Traveller then went to Luxemburg on the last two Sundays.
  for (const i of [0, 1, 2]) for (const p of [P.trav, P.stay, P.anchor]) mark(hs[i], p);
  mark(hs[3], P.anchor); mark(hs[4], P.anchor); mark(hs[5], P.anchor);
  mark(ls[4], P.trav); mark(ls[5], P.trav);
  const today = '2025-05-14';
  for (const user of [{ role: 'staff', campusIds: null, personId: null }, { role: 'leader', campusIds: [1], personId: null }, { role: 'staff', campusIds: [2], personId: null }]) {
    const names = missingPeople(db, user, { today }).map((p) => p.first_name);
    assert.ok(!names.includes('Traveller'), `Traveller is not missing for ${JSON.stringify(user.campusIds)}`);
    if (user.campusIds?.[0] !== 2) assert.ok(names.includes('Stayaway'), 'someone who really stayed away still is');
  }
});
