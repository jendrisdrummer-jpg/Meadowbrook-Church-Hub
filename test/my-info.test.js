// "My info" (members edit their own phone and birthday), "Tell the office", and the This week card's data.
// Dates here are fixed, so nothing depends on the day the tests run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { servingThisWeek } from '../public/js/member/thisweek.js';

process.env.MB_DEV_LOGIN = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-myinfo-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let db, server, base, ids;
const cookies = {};

const person = (first, extra = {}) => Number(db.prepare('INSERT INTO people (first_name, last_name, email, campus_id, household_id, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(first, 'Test', extra.email ?? `${first.toLowerCase()}@mb.test`, extra.campus ?? 1, extra.household ?? null, 'member', 'office note').lastInsertRowid);
const user = (key, role, { personId = null, campuses = null } = {}) => {
  const id = Number(db.prepare('INSERT INTO users (email, role, person_id, campus_ids) VALUES (?, ?, ?, ?)').run(`${key}@mb.test`, role, personId, campuses && JSON.stringify(campuses)).lastInsertRowid);
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  return id;
};
const api = async (who, method, url, body, headers = {}) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: cookies[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const write = (who, method, url, body) => api(who, method, url, body, { 'x-mb': '1' });
const notesFor = (userId) => db.prepare('SELECT * FROM notifications WHERE user_id = ?').all(userId);

before(async () => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO campuses (name, short_name, timezone) VALUES ('North Campus', 'North', 'America/Chicago'), ('South Campus', 'South', 'America/Chicago')").run();
  const hh = Number(db.prepare("INSERT INTO households (name, campus_id, address, city, state, zip) VALUES ('Test family', 1, '12 Oak St', 'Springfield', 'IL', '62701')").run().lastInsertRowid);
  const me = person('Maya', { household: hh });
  const other = person('Other', { campus: 1 });
  const southPerson = person('Sam', { campus: 2 });
  ids = {
    me, other, southPerson, hh,
    meUser: user('maya', 'volunteer', { personId: me }),
    unlinked: user('lost', 'volunteer'),
    southUser: user('sam', 'volunteer', { personId: southPerson }),
    admin: user('admin', 'admin'),
    northStaff: user('northstaff', 'staff', { campuses: [1] }),
    southStaff: user('southstaff', 'staff', { campuses: [2] }),
    leader: user('leader', 'leader'),
    vol: user('vol', 'volunteer'),
  };
  server = createApp({ db, uploadDir: tmp }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /me/person returns the caller’s own record, with the address read-only', async () => {
  const r = await api('maya', 'GET', '/me/person');
  assert.equal(r.status, 200);
  assert.equal(r.data.first_name, 'Maya');
  assert.equal(r.data.email, 'maya@mb.test');
  assert.equal(r.data.campus, 'North Campus');
  assert.equal(r.data.address, '12 Oak St · Springfield, IL · 62701');
  assert.equal(r.data.notes, undefined);
  assert.equal(r.data.status, undefined);
  assert.equal((await api(null, 'GET', '/me/person')).status, 401);
});

test('PATCH /me/person saves phone and birthday to the People record and audits field names only', async () => {
  const r = await write('maya', 'PATCH', '/me/person', { phone: ' 555-0100 ', birthdate: '1990-04-12' });
  assert.equal(r.status, 200);
  assert.equal(r.data.phone, '555-0100');
  const row = db.prepare('SELECT phone, birthdate FROM people WHERE id = ?').get(ids.me);
  assert.deepEqual({ ...row }, { phone: '555-0100', birthdate: '1990-04-12' });
  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'me.person.update' ORDER BY id DESC").get();
  assert.equal(log.user_id, ids.meUser);
  assert.deepEqual(JSON.parse(log.detail), { id: ids.me, fields: ['phone', 'birthdate'] });
  assert.ok(!log.detail.includes('555-0100') && !log.detail.includes('1990'));
  // Saving the same values again changes nothing and logs nothing.
  const before = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  assert.equal((await write('maya', 'PATCH', '/me/person', { phone: '555-0100' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, before);
  // The birthday can be cleared.
  assert.equal((await write('maya', 'PATCH', '/me/person', { birthdate: '' })).status, 200);
  assert.equal(db.prepare('SELECT birthdate FROM people WHERE id = ?').get(ids.me).birthdate, null);
});

test('PATCH /me/person reuses the People validation', async () => {
  assert.equal((await write('maya', 'PATCH', '/me/person', { birthdate: '2026-02-30' })).status, 400);
  assert.equal((await write('maya', 'PATCH', '/me/person', { birthdate: '2999-01-01' })).status, 400);
  assert.equal(db.prepare('SELECT phone FROM people WHERE id = ?').get(ids.me).phone, '555-0100');
});

test('fields that aren’t theirs to change are refused and nothing is saved', async () => {
  const before = { ...db.prepare('SELECT * FROM people WHERE id = ?').get(ids.me) };
  for (const body of [{ email: 'new@x.org' }, { status: 'guest' }, { household_id: null }, { campus_id: 2 }, { notes: 'hi' }, { household_role: 'child' }, { first_name: 'Eve' }, { allergies: 'x' }, { phone: '555-0199', campus_id: 2 }]) {
    const r = await write('maya', 'PATCH', '/me/person', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, /Tell the office/);
  }
  const after = db.prepare('SELECT * FROM people WHERE id = ?').get(ids.me);
  assert.deepEqual({ ...after }, before);
});

test('no way to edit someone else: an id in the body or URL is never used', async () => {
  const r = await write('maya', 'PATCH', '/me/person', { id: ids.other, person_id: ids.other, phone: '555-0111' });
  assert.equal(r.status, 400);
  assert.equal((await write('maya', 'PATCH', `/me/person/${ids.other}`, { phone: '555-0111' })).status, 404);
  assert.equal(db.prepare('SELECT phone FROM people WHERE id = ?').get(ids.other).phone, '');
  // A phone change lands on the caller's record only.
  await write('maya', 'PATCH', '/me/person', { phone: '555-0122' });
  assert.equal(db.prepare('SELECT phone FROM people WHERE id = ?').get(ids.me).phone, '555-0122');
  assert.equal(db.prepare('SELECT phone FROM people WHERE id = ?').get(ids.other).phone, '');
});

test('an account that isn’t linked to a person gets a clear message', async () => {
  for (const [method, url, body] of [['GET', '/me/person'], ['PATCH', '/me/person', { phone: '1' }], ['POST', '/me/office-request', { topic: 'email', message: 'hi' }]]) {
    const r = await write('lost', method, url, body);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /ask the office to link it/);
  }
});

test('missing x-mb is rejected', async () => {
  assert.equal((await api('maya', 'PATCH', '/me/person', { phone: '555-0133' })).status, 403);
  assert.equal((await api('maya', 'POST', '/me/office-request', { topic: 'email', message: 'hi' })).status, 403);
  assert.notEqual(db.prepare('SELECT phone FROM people WHERE id = ?').get(ids.me).phone, '555-0133');
});

test('Tell the office notifies only staff and admins who reach the person’s campus, and records it', async () => {
  const r = await write('maya', 'POST', '/me/office-request', { topic: 'email', message: 'Please use maya@new.org' });
  assert.equal(r.status, 201);
  const got = (u) => notesFor(u).length;
  assert.equal(got(ids.admin), 1);
  assert.equal(got(ids.northStaff), 1);
  assert.equal(got(ids.southStaff), 0); // a different campus
  assert.equal(got(ids.leader), 0); // not staff
  assert.equal(got(ids.vol), 0);
  assert.equal(got(ids.meUser), 0);
  assert.equal(r.data.notified, 2);
  const n = notesFor(ids.northStaff)[0];
  assert.match(n.title, /Maya Test: Change my email/);
  assert.equal(n.body, 'Please use maya@new.org');
  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'me.office_request'").get();
  assert.deepEqual(JSON.parse(log.detail), { id: ids.me, topic: 'email', notified: 2 });
  // It never touches the record itself.
  assert.equal(db.prepare('SELECT email FROM people WHERE id = ?').get(ids.me).email, 'maya@mb.test');
  // The South person's note reaches South staff and the all-campus admin, not North staff.
  await write('sam', 'POST', '/me/office-request', { topic: 'family', message: 'We moved' });
  assert.equal(got(ids.southStaff), 1);
  assert.equal(got(ids.northStaff), 1);
  assert.equal(got(ids.admin), 2);
});

test('Tell the office needs a message and is capped per hour', async () => {
  assert.equal((await write('maya', 'POST', '/me/office-request', { topic: 'other', message: '  ' })).status, 400);
  let last;
  for (let i = 0; i < 6; i++) last = await write('maya', 'POST', '/me/office-request', { topic: 'other', message: `note ${i}` });
  assert.equal(last.status, 429);
});

test('/app/config gives a signed-in person their own campus only, and guests none', async () => {
  const guest = await api(null, 'GET', '/app/config');
  assert.equal(guest.data.user, null);
  const mine = await api('maya', 'GET', '/app/config');
  assert.equal(mine.data.user.campus_id, 1);
  assert.equal((await api('sam', 'GET', '/app/config')).data.user.campus_id, 2);
  assert.equal((await api('lost', 'GET', '/app/config')).data.user.campus_id, null);
});

test('the default Home screen starts with This week, and a saved layout is left alone', async () => {
  const fresh = await api(null, 'GET', '/app/config');
  assert.equal(fresh.data.config.home[0].type, 'thisweek');
  const saved = { tabs: fresh.data.config.tabs, home: [{ id: 'w', type: 'welcome', size: 'F', style: 'accent', title: 'Hi', text: '' }] };
  assert.equal((await write('admin', 'PUT', '/app/config', saved)).status, 200);
  const after = await api(null, 'GET', '/app/config');
  assert.deepEqual(after.data.config.home.map((w) => w.type), ['welcome']);
  // The widget can be added in the App Builder.
  assert.equal((await write('admin', 'PUT', '/app/config', { ...saved, home: [{ id: 't', type: 'thisweek', size: 'F', style: 'card', title: '' }, ...saved.home] })).status, 200);
});

test('This week lists only non-declined serving in the next seven days, requests waiting first', () => {
  const now = new Date(2026, 5, 10, 12, 0); // a fixed local time
  const a = (id, starts_at, status) => ({ id, starts_at, status });
  const list = servingThisWeek([
    a(1, '2026-06-10T09:00', 'accepted'), // earlier today
    a(2, '2026-06-14T09:00', 'accepted'),
    a(3, '2026-06-12T09:00', 'pending'),
    a(4, '2026-06-13T09:00', 'declined'),
    a(5, '2026-06-17T09:00', 'accepted'), // day 7: out
    a(6, '2026-06-16T18:00', 'accepted'), // last day: in
  ], now);
  assert.deepEqual(list.map((x) => x.id), [3, 1, 2, 6]);
});

test('a teen linked to a child record can change their phone but not their birthday (age decides check-in)', async () => {
  const teen = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_role, birthdate) VALUES ('Teen', 'Test', 1, 'child', '2011-04-02')").run().lastInsertRowid);
  user('teen', 'volunteer', { personId: teen });
  const got = await api('teen', 'GET', '/me/person');
  assert.equal(got.data.can_edit_birthdate, false);
  assert.equal((await write('teen', 'PATCH', '/me/person', { birthdate: '2000-01-01' })).status, 400);
  assert.equal((await write('teen', 'PATCH', '/me/person', { phone: '555-0100' })).status, 200);
  assert.equal(db.prepare('SELECT birthdate FROM people WHERE id = ?').get(teen).birthdate, '2011-04-02');
});

test('staff can turn off notes from members to the office in their notification settings', async () => {
  user('quiet', 'staff', { campuses: [1] });
  const prefs = await api('quiet', 'GET', '/me/notify');
  assert.equal(prefs.status, 200);
  assert.equal(prefs.data.prefs.account, true, 'on by default');
  assert.equal((await write('quiet', 'PATCH', '/me/notify', { account: false })).status, 200);
  assert.equal((await api('quiet', 'GET', '/me/notify')).data.prefs.account, false);
});
