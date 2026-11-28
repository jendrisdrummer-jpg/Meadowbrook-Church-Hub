// The Attendance switch: a volunteer-level account with users.attendance may take attendance (roll,
// families, new guests, headcounts) for services at its campuses and nothing more. Own database.
// Services are created relative to "now", so nothing depends on the calendar day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession, canTakeAttendance } from '../server/auth.js';
import { canCheckin } from '../server/routes/checkin.js';
import { localNow } from '../server/http.js';

let server, base, db, upDir;
const cookies = {};
const S = {}; // services by key
const P = {}; // people by key
const U = {}; // account ids by key
// Days counted from today at the campus's own clock (Chicago), the same clock the server and the
// 'today' service use, so the test passes in the evening hours when UTC has already moved on.
const dayOffset = (n) => new Date(Date.parse(`${localNow('America/Chicago').date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-att-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago'), (2, 'Meadowbrook South', 'South', 'America/Chicago');`);
  const service = (key, campus, startsAt) => { S[key] = Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, key, startsAt).lastInsertRowid); };
  service('recent', 1, `${dayOffset(-3)}T10:00`);
  service('old', 1, `${dayOffset(-60)}T10:00`);
  service('south', 2, `${dayOffset(-3)}T10:00`);
  // A service on today's date at the campus's own clock: not a correction.
  service('today', 1, `${localNow('America/Chicago').date}T23:59`);
  const hh = Number(db.prepare("INSERT INTO households (name, campus_id) VALUES ('Reed Household', 1)").run().lastInsertRowid);
  const person = (key, first, extra = {}) => {
    P[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, email, phone, campus_id, household_id, household_role, allergies, medical_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(first, 'Reed', `${key}@example.com`, '555-0100', extra.campus ?? 1, extra.hh ?? null, extra.role || 'adult', extra.allergies || '', extra.medical || '').lastInsertRowid);
  };
  person('mom', 'Mia', { hh }); person('kid', 'Kit', { hh, role: 'child', allergies: 'Peanuts', medical: 'Inhaler' }); person('solo', 'Sol');
  person('far', 'Faye', { campus: 2 });
  for (const [key, role, campuses, flag] of [['admin', 'admin', null, 0], ['leader', 'leader', null, 0], ['staff', 'staff', null, 0], ['north', 'admin', '[1]', 0],
    ['vol', 'volunteer', null, 0], ['att', 'volunteer', '[1]', 1], ['attnone', 'volunteer', null, 1], ['attboth', 'volunteer', '[1,2]', 1]]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids, attendance) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, flag).lastInsertRowid);
    U[key] = id;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

async function api(who, method, url, body) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}
const audits = (action) => db.prepare('SELECT user_id, detail FROM audit_log WHERE action = ?').all(action);

test('migration 36: the schema version and both columns', () => {
  assert.ok(SCHEMA_VERSION >= 36);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'attendance' && c.dflt_value === '0'));
  assert.ok(db.prepare('PRAGMA table_info(campuses)').all().some((c) => c.name === 'attendance_mode' && c.dflt_value === "'both'"));
  assert.equal(db.prepare('SELECT attendance_mode m FROM campuses WHERE id = 1').get().m, 'both');
});

test('a volunteer without the switch is refused everywhere', async () => {
  for (const [method, url, body] of [['GET', `/services/${S.recent}/roll`], ['POST', `/services/${S.recent}/roll`, { person_ids: [P.solo] }],
    ['PUT', `/services/${S.recent}/headcounts`, { counts: { Auditorium: 5 } }], ['POST', `/services/${S.recent}/roll/guest`, { first_name: 'No' }], ['GET', '/attendance/services']]) {
    assert.equal((await api('vol', method, url, body)).status, 403, `${method} ${url}`);
  }
  assert.equal(canTakeAttendance({ role: 'volunteer', attendance: false }), false);
});

test('with the switch: own campus works, another campus is refused, and nothing else opens', async () => {
  assert.equal((await api('att', 'GET', `/services/${S.recent}/roll`)).status, 200);
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll`, { person_ids: [P.solo] })).status, 200);
  assert.equal((await api('att', 'PUT', `/services/${S.recent}/headcounts`, { counts: { Auditorium: 80 } })).status, 200);
  assert.equal((await api('att', 'GET', `/services/${S.south}/roll`)).status, 403);
  assert.equal((await api('att', 'POST', `/services/${S.south}/roll`, { person_ids: [P.solo] })).status, 403);
  assert.equal((await api('att', 'PUT', `/services/${S.south}/headcounts`, { counts: { Auditorium: 1 } })).status, 403);
  assert.equal((await api('att', 'POST', `/services/${S.south}/roll/guest`, { first_name: 'Zed' })).status, 403);
  // marking someone at another campus is refused too
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll`, { person_ids: [P.far] })).status, 403);
  for (const url of ['/people', `/people/${P.solo}`, '/schedule', '/attendance/people', `/people/${P.solo}/attendance`, '/attendance/weekly', '/checkin/roster']) {
    assert.equal((await api('att', 'GET', url)).status, 403, url);
  }
  assert.equal((await api('att', 'POST', '/people', { first_name: 'Sneaky', new_household: true })).status, 403);
  const view = await api('att', 'GET', `/services/${S.recent}`);
  assert.equal(view.status, 200, 'the volunteer view of a service');
  assert.ok(!JSON.stringify(view.data).includes('"phone"'));
});

test('the roll shows names only: no contact or health details', async () => {
  const { data } = await api('att', 'GET', `/services/${S.recent}/roll`);
  assert.ok(data.people.length >= 3);
  const kid = data.people.find((p) => p.id === P.kid);
  assert.ok(kid);
  for (const p of data.people) for (const k of ['email', 'phone', 'allergies', 'medical_notes', 'notes', 'birthdate']) assert.ok(!(k in p), `${k} not exposed`);
  assert.ok(!JSON.stringify(data).includes('Peanuts'));
});

test('an account with the switch but no campus list on a multi-campus church fails closed', async () => {
  assert.equal((await api('attnone', 'GET', `/services/${S.recent}/roll`)).status, 403);
  assert.equal((await api('attnone', 'GET', '/attendance/services')).data.services.length, 0);
});

test('the services list: default window, a picker for older dates, own campuses only', async () => {
  const d = (await api('att', 'GET', '/attendance/services')).data;
  const ids = d.services.map((s) => s.id);
  assert.ok(ids.includes(S.recent) && ids.includes(S.today));
  assert.ok(!ids.includes(S.old), 'older services are not in the default list');
  assert.ok(!ids.includes(S.south), 'other campus is not listed');
  const first = d.services.find((s) => s.id === S.recent);
  assert.equal(first.attendance_mode, 'both');
  assert.equal(first.headcount_total, 80);
  assert.equal(first.roll_count, 1);
  const older = (await api('att', 'GET', `/attendance/services?from=${dayOffset(-62)}&to=${dayOffset(-55)}`)).data;
  assert.deepEqual(older.services.map((s) => s.id), [S.old]);
  assert.equal((await api('att', 'GET', `/attendance/services?from=${dayOffset(-300)}&to=${dayOffset(0)}`)).status, 400);
  assert.deepEqual((await api('attboth', 'GET', `/attendance/services?from=${dayOffset(-5)}&to=${dayOffset(-1)}`)).data.services.map((s) => s.id).sort(), [S.recent, S.south].sort());
});

test('old services can still be corrected (no time limit), and every late change is audited', async () => {
  const before = [audits('attendance.correct').length, audits('headcount.correct').length];
  assert.equal((await api('att', 'POST', `/services/${S.old}/roll`, { person_ids: [P.solo], present: true })).status, 200);
  assert.equal((await api('att', 'PUT', `/services/${S.old}/headcounts`, { counts: { Auditorium: 40 } })).status, 200);
  assert.equal(audits('attendance.correct').length, before[0] + 1);
  assert.equal(audits('headcount.correct').length, before[1] + 1);
  const row = audits('attendance.correct').at(-1);
  assert.equal(row.user_id, U.att);
  assert.deepEqual(JSON.parse(row.detail), { service_id: S.old, person_ids: [P.solo], present: true });
  // A change on the service's own day is not a correction.
  await api('att', 'POST', `/services/${S.today}/roll`, { person_ids: [P.solo] });
  await api('att', 'PUT', `/services/${S.today}/headcounts`, { counts: { Auditorium: 3 } });
  assert.equal(audits('attendance.correct').length, before[0] + 1);
  assert.equal(audits('headcount.correct').length, before[1] + 1);
  // A failed change writes nothing.
  assert.equal((await api('att', 'PUT', `/services/${S.old}/headcounts`, { counts: { Auditorium: -2 } })).status, 400);
  assert.equal(audits('headcount.correct').length, before[1] + 1);
});

test('new guests: new family, child into a family on the roll, name-only duplicates, daily limit', async () => {
  const g = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Gus', last_name: 'Newcomer' });
  assert.equal(g.status, 201);
  assert.deepEqual(Object.keys(g.data).sort(), ['first_name', 'id', 'last_name']);
  const row = db.prepare('SELECT p.status, p.campus_id, p.household_role, p.household_id FROM people p WHERE p.id = ?').get(g.data.id);
  assert.deepEqual([row.status, row.campus_id, row.household_role], ['guest', 1, 'adult']);
  assert.ok(row.household_id, 'in a new family');
  assert.ok(db.prepare('SELECT 1 FROM attendance WHERE service_id = ? AND person_id = ?').get(S.recent, g.data.id), 'marked present');

  // duplicate: name only
  const dup = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'MIA', last_name: 'reed' });
  assert.equal(dup.status, 409);
  assert.deepEqual(Object.keys(dup.data.duplicate).sort(), ['campus', 'first_name', 'id', 'last_name']);
  assert.ok(!JSON.stringify(dup.data).includes('555-0100') && !JSON.stringify(dup.data).includes('@example.com'));
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Mia', last_name: 'Reed', force: true })).status, 201);

  // a family that is not on this roll can't be added to; an adult can't be added to a family at all
  await api('att', 'POST', `/services/${S.recent}/roll`, { person_ids: [P.mom] });
  const adult = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Dad', last_name: 'Reed2', household_id: row.household_id, role: 'adult' });
  assert.equal(adult.status, 403);
  assert.match(adult.data.error, /staff/);
  const reed = db.prepare('SELECT household_id FROM people WHERE id = ?').get(P.mom).household_id;
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Dad', last_name: 'Reed3', household_id: reed })).status, 403, 'role defaults to adult: refused');
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Dad', last_name: 'Reed3', household_id: reed, role: 'adult' })).status, 403);
  const kid = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Ivy', last_name: 'Reed', household_id: reed, role: 'child' });
  assert.equal(kid.status, 201);
  assert.equal(db.prepare('SELECT household_role r, household_id h FROM people WHERE id = ?').get(kid.data.id).r, 'child');
  assert.equal(db.prepare('SELECT household_id h FROM people WHERE id = ?').get(kid.data.id).h, reed);
  const other = row.household_id;
  db.prepare('DELETE FROM attendance WHERE service_id = ? AND person_id IN (SELECT id FROM people WHERE household_id = ?)').run(S.recent, other);
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Cal', last_name: 'Newcomer', household_id: other, role: 'child' })).status, 403, 'not on this roll any more');
  assert.equal((await api('att', 'POST', `/services/${S.recent}/roll/guest`, { last_name: 'NoFirst' })).status, 400);

  // 30 a day per account, counted from the audit log; the 31st is refused, and other accounts are unaffected
  const used = audits('attendance.guest').filter((a) => a.user_id === U.att).length;
  let last;
  for (let i = used; i < 30; i++) last = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: `Bulk${i}`, last_name: `Guest${i}` });
  assert.equal(last.status, 201, 'the 30th is fine');
  const over = await api('att', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Bulk31', last_name: 'Guest31' });
  assert.equal(over.status, 429);
  assert.match(over.data.error, /staff/);
  assert.equal((await api('attboth', 'POST', `/services/${S.recent}/roll/guest`, { first_name: 'Other', last_name: 'Account' })).status, 201);
});

test('leaders and above are unchanged, and kids’ check-in is a separate rule', async () => {
  for (const who of ['leader', 'staff', 'admin']) {
    assert.equal((await api(who, 'GET', `/services/${S.recent}/roll`)).status, 200, who);
    assert.equal((await api(who, 'PUT', `/services/${S.recent}/headcounts`, { counts: { Auditorium: 70 } })).status, 200, who);
    assert.equal((await api(who, 'GET', '/attendance/weekly')).status, 200, who);
    assert.equal((await api(who, 'GET', '/attendance/people')).status, 200, who);
  }
  assert.equal((await api('leader', 'GET', '/people')).status, 200);
  assert.equal((await api('north', 'GET', `/services/${S.south}/roll`)).status, 403, 'campus limits still apply to leaders and admins');
  // a leader's corrections are not audited (unchanged behaviour)
  const n = audits('attendance.correct').length;
  await api('leader', 'POST', `/services/${S.old}/roll`, { person_ids: [P.solo] });
  assert.equal(audits('attendance.correct').length, n);
  // check-in: the switch gives nothing, and setting it on a leader changes nothing
  const asUser = (key) => ({ id: U[key], role: db.prepare('SELECT role FROM users WHERE id = ?').get(U[key]).role });
  assert.equal(canCheckin(db, asUser('att')), false);
  assert.equal(canCheckin(db, asUser('leader')), false);
  assert.equal((await api('att', 'GET', '/checkin/roster')).status, 403);
  db.prepare('UPDATE users SET attendance = 1 WHERE id = ?').run(U.leader);
  assert.equal(canCheckin(db, asUser('leader')), false);
  assert.equal((await api('leader', 'GET', '/checkin/roster')).status, 403);
  db.prepare('UPDATE users SET attendance = 0 WHERE id = ?').run(U.leader);
});

test('granting the switch: a campus list is required, and campus-limited admins stay inside their campuses', async () => {
  // multi-campus church, no list
  assert.equal((await api('admin', 'POST', '/users', { email: 'new1@mb.org', role: 'volunteer', attendance: true, campus_ids: 'all' })).status, 400);
  assert.equal((await api('admin', 'POST', '/users', { email: 'new2@mb.org', role: 'volunteer', attendance: true, campus_ids: [2] })).status, 201);
  assert.equal(db.prepare("SELECT attendance a FROM users WHERE email = 'new2@mb.org'").get().a, 1);
  assert.deepEqual(audits('user.create').map((a) => a.detail).filter((d) => d.includes('new2@')).length, 1);
  const plain = Number(db.prepare("INSERT INTO users (email, role) VALUES ('plain@mb.org', 'volunteer')").run().lastInsertRowid);
  assert.equal((await api('admin', 'PATCH', `/users/${plain}`, { attendance: true })).status, 400, 'no campuses yet');
  assert.equal((await api('admin', 'PATCH', `/users/${plain}`, { attendance: true, campus_ids: [1] })).status, 200);
  assert.equal(db.prepare('SELECT attendance a FROM users WHERE id = ?').get(plain).a, 1);
  assert.equal((await api('admin', 'PATCH', `/users/${plain}`, { campus_ids: 'all' })).status, 400, 'can’t widen to “all” while it has the switch');
  assert.equal((await api('admin', 'PATCH', `/users/${plain}`, { attendance: false })).status, 200);
  assert.equal(db.prepare('SELECT attendance a FROM users WHERE id = ?').get(plain).a, 0);
  // the list shows these accounts
  assert.ok((await api('admin', 'GET', '/users')).data.users.some((u) => u.email === 'att@mb.org' && u.attendance === true));

  // a campus-limited admin (North only)
  const own = Number(db.prepare("INSERT INTO users (email, role, campus_ids) VALUES ('own@mb.org', 'volunteer', '[1]')").run().lastInsertRowid);
  assert.equal((await api('north', 'PATCH', `/users/${own}`, { attendance: true })).status, 200, 'inside their campuses');
  assert.equal(db.prepare('SELECT attendance a FROM users WHERE id = ?').get(own).a, 1);
  assert.equal((await api('north', 'PATCH', `/users/${own}`, { attendance: false })).status, 200);
  assert.equal((await api('north', 'PATCH', `/users/${own}`, { attendance: true, campus_ids: [1, 2] })).status, 403, 'South is outside their campuses');
  assert.equal((await api('north', 'PATCH', `/users/${own}`, { attendance: true, campus_ids: 'all' })).status, 403);
  assert.equal(db.prepare('SELECT attendance a FROM users WHERE id = ?').get(own).a, 0);
  const southAcct = Number(db.prepare("INSERT INTO users (email, role, campus_ids) VALUES ('south@mb.org', 'volunteer', '[2]')").run().lastInsertRowid);
  assert.equal((await api('north', 'PATCH', `/users/${southAcct}`, { attendance: true })).status, 403, 'a South account is out of reach');
  assert.equal((await api('north', 'POST', '/users', { email: 'n2@mb.org', role: 'volunteer', attendance: true, campus_ids: [2] })).status, 403);
  assert.equal((await api('north', 'POST', '/users', { email: 'n3@mb.org', role: 'volunteer', attendance: true })).status, 201, 'defaults to their campuses');
  // not their own account
  assert.equal((await api('north', 'PATCH', `/users/${U.north}`, { attendance: true })).status, 403);
  // and a plain volunteer or a leader can't grant it at all
  assert.equal((await api('vol', 'PATCH', `/users/${own}`, { attendance: true })).status, 403);
  assert.equal((await api('leader', 'PATCH', `/users/${own}`, { attendance: true })).status, 403);
});

test('the attendance mode is per campus, and only the three values are accepted', async () => {
  assert.equal((await api('admin', 'PATCH', '/campuses/1', { attendance_mode: 'names' })).data.attendance_mode, 'names');
  assert.equal((await api('att', 'GET', '/attendance/services')).data.services[0].attendance_mode, 'names');
  assert.equal((await api('admin', 'PATCH', '/campuses/1', { attendance_mode: 'nonsense' })).data.attendance_mode, 'both');
  assert.equal((await api('north', 'PATCH', '/campuses/2', { attendance_mode: 'headcount' })).status, 403);
  assert.equal((await api('vol', 'PATCH', '/campuses/1', { attendance_mode: 'headcount' })).status, 403);
});

test('weekly totals: names only, headcount only, both, and kids never counted twice', async () => {
  // A clean campus 3, with one past week per case.
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (3, 'East', 'East', 'America/Chicago')");
  const svc = (day) => Number(db.prepare("INSERT INTO services (campus_id, title, starts_at) VALUES (3, 'W', ?)").run(`${day}T10:00`).lastInsertRowid);
  const sunday = (weeksBack) => { const d = new Date(Date.now() - weeksBack * 7 * 864e5); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
  const [wNames, wHead, wBoth, wMixed] = [sunday(1), sunday(2), sunday(3), sunday(4)];
  const people = [P.mom, P.kid, P.solo];
  const mark = (s, ids) => ids.forEach((id) => db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(s, id));
  const head = (s, n) => db.prepare("INSERT INTO headcounts (service_id, area, count) VALUES (?, 'Auditorium', ?)").run(s, n);
  const kidIn = (s, day, id) => db.prepare("INSERT INTO checkins (id, campus_id, service_id, person_id, kind, day, checked_in_at) VALUES (?, 3, ?, ?, 'kid', ?, '2026-01-01T00:00:00Z')").run(`ci-${s}-${id}`, s, id, day);
  const s1 = svc(wNames); mark(s1, people); kidIn(s1, wNames, P.kid);      // names: 3 marked, 1 also a kid => 2 counted
  const s2 = svc(wHead); head(s2, 50);                                     // headcount only: 50
  const s3 = svc(wBoth); mark(s3, [P.mom]); head(s3, 40);                  // both: the headcount wins (40), not 41
  const s4a = svc(wMixed); mark(s4a, [P.mom, P.solo]);                     // names 2
  const s4b = svc(wMixed); head(s4b, 30);                                  // headcount 30 => mixed 32
  const { data } = await api('admin', 'GET', '/attendance/weekly?weeks=8');
  const counted = (w) => data.adults.find((r) => r.campus_id === 3 && r.week === w)?.total;
  const src = (w) => data.source.find((r) => r.campus_id === 3 && r.week === w)?.source;
  assert.deepEqual([counted(wNames), src(wNames)], [2, 'names']);
  assert.deepEqual([counted(wHead), src(wHead)], [50, 'headcount']);
  assert.deepEqual([counted(wBoth), src(wBoth)], [40, 'headcount']);
  assert.deepEqual([counted(wMixed), src(wMixed)], [32, 'mixed']);
  assert.equal(data.kids.find((r) => r.campus_id === 3 && r.week === wNames).total, 1, 'total = counted + kids');
  // campus-limited leaders see only their campuses
  assert.ok(!(await api('north', 'GET', '/attendance/weekly?weeks=8')).data.adults.some((r) => r.campus_id === 3));
});
