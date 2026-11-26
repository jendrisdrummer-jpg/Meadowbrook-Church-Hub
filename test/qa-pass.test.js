// Findings from the pre-demo QA pass: team-leader access, campus-limited admins, reply links,
// small-group chat privacy, and campus edges on households. Tests marked `todo` assert the
// behaviour we want and currently FAIL (known bugs, see docs/tech-debt.md); they don't fail the run.
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
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const nextSunday = () => { const d = addDays(new Date().toISOString().slice(0, 10), 8); return addDays(d, (7 - new Date(`${d}T12:00:00Z`).getUTCDay()) % 7); };

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-qa-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const person = (first, campus) => Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, email) VALUES (?, 'Test', ?, ?)").run(first, campus, `${first.toLowerCase()}@example.org`).lastInsertRowid);
  const make = (key, role, campuses, personId) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId ?? null).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  make('admin', 'admin', null);
  make('southadmin', 'admin', '[2]', person('Sam', 2));
  make('south', 'staff', '[2]');
  make('lead', 'volunteer', null, person('Lena', 1));
  make('vol', 'volunteer', null, person('Vic', 1));
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const personId = (key) => db.prepare('SELECT person_id FROM users WHERE email = ?').get(`${key}@mb.org`).person_id;

test('leading a team gives leader access that follows the roster, and only for that team', async () => {
  const team = (await api('admin', 'POST', '/teams', { name: 'QA Team', campus_id: 1 })).data;
  const other = (await api('admin', 'POST', '/teams', { name: 'Other Team', campus_id: 1 })).data;
  assert.equal((await api('lead', 'GET', '/people')).status, 403, 'a volunteer can’t open People');
  assert.equal((await api('admin', 'PUT', `/teams/${team.id}/members/${personId('lead')}`, { is_leader: true })).status, 200);
  assert.equal((await api('lead', 'GET', '/me')).data.role, 'leader');
  assert.equal((await api('lead', 'GET', '/people')).status, 200);
  assert.equal((await api('lead', 'POST', `/teams/${team.id}/positions`, { name: 'Greeter' })).status, 201, 'their own team');
  assert.equal((await api('lead', 'POST', `/teams/${other.id}/positions`, { name: 'Nope' })).status, 403, 'someone else’s team');
  assert.equal((await api('lead', 'POST', '/teams', { name: 'Mine' })).status, 403, 'creating teams is staff-only');
  assert.equal((await api('lead', 'GET', '/users')).status, 403);
  assert.equal((await api('admin', 'DELETE', `/teams/${team.id}/members/${personId('lead')}`)).status, 200);
  assert.equal((await api('lead', 'GET', '/me')).data.role, 'volunteer', 'access goes when leadership does');
  assert.equal((await api('lead', 'GET', '/people')).status, 403);
});

test('a campus-limited admin can’t widen their own access or touch accounts outside their campus', async () => {
  const sa = db.prepare("SELECT id FROM users WHERE email = 'southadmin@mb.org'").get().id;
  const south = db.prepare("SELECT id FROM users WHERE email = 'south@mb.org'").get().id;
  const root = db.prepare("SELECT id FROM users WHERE email = 'admin@mb.org'").get().id;
  assert.equal((await api('southadmin', 'PATCH', `/users/${sa}`, { campus_ids: 'all' })).status, 403);
  assert.equal((await api('southadmin', 'PATCH', `/users/${sa}`, { campus_ids: [1, 2] })).status, 403);
  assert.equal((await api('southadmin', 'PATCH', `/users/${root}`, { role: 'volunteer' })).status, 403);
  assert.equal((await api('southadmin', 'DELETE', `/users/${root}`)).status, 403);
  assert.equal((await api('southadmin', 'PATCH', `/users/${south}`, { role: 'admin' })).status, 403);
  assert.equal((await api('southadmin', 'PATCH', `/users/${south}`, { finance: true })).status, 403);
  assert.equal((await api('southadmin', 'PATCH', `/users/${south}`, { campus_ids: [1] })).status, 403);
  assert.equal((await api('southadmin', 'POST', '/users', { email: 'a@x.org', role: 'admin' })).status, 403);
  assert.equal((await api('southadmin', 'POST', '/users', { email: 'b@x.org', role: 'staff', campus_ids: [1] })).status, 403);
  const made = await api('southadmin', 'POST', '/users', { email: 'c@x.org', role: 'staff' });
  assert.equal(made.status, 201);
  assert.deepEqual(JSON.parse(db.prepare('SELECT campus_ids FROM users WHERE id = ?').get(made.data.id).campus_ids), [2], 'defaults to their own campus');
  assert.equal((await api('southadmin', 'PATCH', '/settings', { church_name: 'x' })).status, 403);
  assert.equal((await api('southadmin', 'POST', '/campuses', { name: 'x' })).status, 403);
});

test('email reply links accept and decline without signing in, and a changed link is refused', async () => {
  const day = nextSunday();
  const team = (await api('admin', 'POST', '/teams', { name: 'Reply Team', campus_id: 1 })).data;
  const pos = (await api('admin', 'POST', `/teams/${team.id}/positions`, { name: 'Usher' })).data;
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T09:00` })).data;
  const vic = personId('vol');
  const asg = (await api('admin', 'POST', `/services/${svc.id}/assignments`, { position_id: pos.id, person_id: vic })).data;
  assert.equal((await api('admin', 'POST', '/assignments/send', { service_ids: [svc.id] })).data.sent, 1);
  const { assignmentSig } = await import('../server/notify.js');
  const sig = assignmentSig(db, asg.id, vic);
  const pub = async (s, method, body) => { const r = await fetch(`${base}/api/public/assignments/${asg.id}/${s}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: body && JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  assert.equal((await pub('A'.repeat(24), 'GET')).status, 404, 'wrong signature');
  assert.equal((await pub(sig, 'GET')).data.status, 'pending', 'opening the link changes nothing');
  assert.equal((await pub(sig, 'POST', { status: 'accepted' })).data.status, 'accepted');
  assert.equal((await pub(sig, 'POST', { status: 'declined', reason: 'Away' })).data.status, 'declined');
  assert.equal(db.prepare('SELECT decline_reason FROM assignments WHERE id = ?').get(asg.id).decline_reason, 'Away');
});

test('reminders skip the unsent and repeat only after 12 hours; past services refuse', async () => {
  const day = nextSunday();
  const team = (await api('admin', 'POST', '/teams', { name: 'Remind Team', campus_id: 1 })).data;
  const pos = (await api('admin', 'POST', `/teams/${team.id}/positions`, { name: 'Greeter' })).data;
  const svc = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${day}T11:00` })).data;
  await api('admin', 'POST', `/services/${svc.id}/assignments`, { position_id: pos.id, person_id: personId('vol') });
  assert.deepEqual((await api('admin', 'POST', `/services/${svc.id}/remind`, {})).data, { reminded: 0, skipped: 0 }, 'draft not sent yet');
  await api('admin', 'POST', '/assignments/send', { service_ids: [svc.id] });
  assert.equal((await api('admin', 'POST', `/services/${svc.id}/remind`, {})).data.reminded, 1);
  assert.deepEqual((await api('admin', 'POST', `/services/${svc.id}/remind`, {})).data, { reminded: 0, skipped: 1 });
  assert.equal((await api('vol', 'POST', `/services/${svc.id}/remind`, {})).status, 403);
  const past = (await api('admin', 'POST', '/services', { campus_id: 1, starts_at: `${addDays(day, -400)}T09:00` })).data;
  assert.equal((await api('admin', 'POST', `/services/${past.id}/remind`, {})).status, 400);
});

test('a small group’s chat is private to its roster, even from admins', async () => {
  const g = (await api('admin', 'POST', '/groups', { name: 'QA Group', campus_id: 1 })).data;
  assert.equal((await api('admin', 'PUT', `/groups/${g.id}/members/${personId('vol')}`, { is_leader: true })).status, 200);
  const chatId = db.prepare("SELECT id FROM chats WHERE group_id = ?").get(g.id).id;
  assert.equal((await api('vol', 'POST', `/chats/${chatId}/messages`, { body: 'hi' })).status, 201);
  for (const who of ['admin', 'southadmin', 'south', 'lead']) {
    assert.equal((await api(who, 'GET', `/chats/${chatId}/messages`)).status, 404, `${who} is not in the group`);
    assert.equal((await api(who, 'POST', `/chats/${chatId}/messages`, { body: 'x' })).status, 404);
  }
  const child = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, birthdate, household_role) VALUES ('Kid', 'T', 1, '2020-01-01', 'child')").run().lastInsertRowid);
  assert.equal((await api('admin', 'PUT', `/groups/${g.id}/members/${child}`, {})).status, 400, 'children can’t join');
});

test('a campus-limited admin’s announcement reach and a campus-limited staffer’s pages', async () => {
  assert.equal((await api('vol', 'POST', '/announcements', { title: 'x' })).status, 403);
  assert.equal((await api('south', 'GET', '/finance/gifts')).status, 403);
  assert.equal((await api('admin', 'GET', '/finance/gifts')).status, 403, 'giving needs the Finance flag even for admins');
  assert.equal((await api('vol', 'GET', '/checkin/roster?campus_id=1')).status, 403);
  assert.equal((await api('south', 'GET', '/checkin/roster?campus_id=1')).status, 403, 'other campus');
  assert.equal((await api('south', 'GET', '/checkin/roster?campus_id=2')).status, 200);
});

// ---- Known bugs: these assert the safe behaviour and fail today. ----
test('campus-limited staff can’t add or remove pickup people on another campus’s household', { todo: 'QA-1: people.js POST /households/:id/pickups and DELETE /pickups/:id have no campus check' }, async () => {
  const north = (await api('admin', 'POST', '/households', { name: 'North Family', campus_id: 1 })).data;
  const add = await api('south', 'POST', `/households/${north.id}/pickups`, { name: 'Stranger', phone: '555' });
  assert.equal(add.status, 403);
  const real = (await api('admin', 'POST', `/households/${north.id}/pickups`, { name: 'Gran' })).data;
  assert.equal((await api('south', 'DELETE', `/pickups/${real.id}`)).status, 403);
});

test('campus-limited staff can’t move a person into another campus’s household', { todo: 'QA-2: people.js PATCH /people/:id checks the person but not the target household’s campus' }, async () => {
  const north = (await api('admin', 'POST', '/households', { name: 'North Family 2', campus_id: 1 })).data;
  const p = (await api('south', 'POST', '/people', { first_name: 'Sally', last_name: 'South', campus_id: 2 })).data;
  assert.equal((await api('south', 'PATCH', `/people/${p.id}`, { household_id: north.id })).status, 403);
});

test('people reject impossible and future birthdates and malformed email', { todo: 'QA-3: people accept 2026-02-30, future birthdays and "nope" as an email' }, async () => {
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'A', last_name: 'B', birthdate: '2026-02-30' })).status, 400);
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'A', last_name: 'C', birthdate: '2999-01-01' })).status, 400);
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'A', last_name: 'D', email: 'nope' })).status, 400);
});
