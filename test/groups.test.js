// Small groups: who can see and manage them, the chat that follows the roster, and that a group
// never grants leader access. Own file and database, so it doesn't depend on api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

let server, base, db, upDir;
const cookies = {};
const P = {}; // people by key

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-groups-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago'), (2, 'Meadowbrook South', 'South', 'America/Chicago');`);
  const person = (key, first, campus, extra = {}) => {
    P[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, email, phone, campus_id, household_role, allergies, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(first, 'Test', `${key}@mb.org`, `555-${key.length}000`, campus, extra.role || 'adult', extra.allergies || '', extra.notes || '').lastInsertRowid);
  };
  person('admin', 'Ada', 1); person('north', 'Nora', 1); person('south', 'Sol', 2);
  person('lead', 'Lee', 1); person('lead2', 'Lou', 1); person('mem', 'Mia', 1, { allergies: 'Peanuts', notes: 'Private note' });
  person('mem2', 'Max', 1); person('other', 'Otto', 1); person('kid', 'Kit', 1, { role: 'child' });
  // Accounts: admin, North-only staff, South-only staff, and four volunteers linked to people.
  for (const [key, role, campuses] of [['admin', 'admin', null], ['north', 'staff', '[1]'], ['south', 'staff', '[2]'], ['lead', 'volunteer', null], ['lead2', 'volunteer', null], ['mem', 'volunteer', null], ['other', 'volunteer', null]]) {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, P[key]).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});

after(() => server.close());

async function api(who, method, url, body) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-mb': '1', ...(who ? { cookie: cookies[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('small groups: staff manage, leaders run the roster, members see names only, chat follows, no leader access', async () => {
  // Staff at North make a group; South staff can't see or touch it.
  const made = await api('north', 'POST', '/groups', { name: 'Tuesday Bible Study', description: 'Romans', campus_id: 1 });
  assert.equal(made.status, 201);
  const gid = made.data.id;
  const other = (await api('admin', 'POST', '/groups', { name: 'Men’s Group', campus_id: 1 })).data.id;
  assert.ok(made.data.chat_id, 'a group gets a chat');
  assert.equal((await api('south', 'GET', `/groups/${gid}`)).status, 403);
  assert.equal((await api('south', 'PATCH', `/groups/${gid}`, { name: 'Hijack' })).status, 403);
  assert.equal((await api('south', 'PUT', `/groups/${gid}/members/${P.mem}`, {})).status, 403);
  assert.equal((await api('south', 'GET', '/groups')).data.groups.length, 0);
  assert.equal((await api('south', 'POST', '/groups', { name: 'Not here', campus_id: 1 })).status, 403);
  assert.equal((await api('north', 'POST', '/groups', { name: 'Church-wide' })).status, 403, 'campus-limited staff can’t make church-wide groups');
  assert.equal((await api('north', 'GET', '/groups')).data.groups.length, 2);
  // A volunteer can't create or edit groups.
  assert.equal((await api('mem', 'POST', '/groups', { name: 'Nope' })).status, 403);

  // Staff set a leader; adding leaders and members.
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${P.lead}`, { is_leader: true })).status, 200);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${P.mem}`, {})).status, 200);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${P.kid}`, {})).status, 400, 'adults only');
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${P.south}`, {})).status, 404, 'a person at another campus is out of reach');
  const audits = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'group.%'").all().map((x) => x.action);
  assert.ok(audits.includes('group.create') && audits.includes('group.leader_add'));

  // A member sees their group and the roster (names and photos only), and the chat.
  const mine = await api('mem', 'GET', '/groups');
  assert.deepEqual(mine.data.groups.map((g) => g.name), ['Tuesday Bible Study']);
  const view = await api('mem', 'GET', `/groups/${gid}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.roster.length, 2);
  assert.equal(view.data.can_manage, false);
  const seen = JSON.stringify(view.data);
  for (const secret of ['@mb.org', '555-', 'Peanuts', 'Private note', 'allergies', 'medical']) assert.ok(!seen.includes(secret), `member view leaks ${secret}`);
  assert.equal((await api('mem', 'PUT', `/groups/${gid}/members/${P.mem2}`, {})).status, 403, 'a plain member can’t add');
  // Leaders (and staff) also see email and phone for their own group.
  const led = await api('lead', 'GET', `/groups/${gid}`);
  assert.equal(led.data.can_manage, true);
  assert.ok(led.data.roster.every((m) => m.email && m.phone));

  // Someone who isn't in the group gets 403; the list is empty.
  assert.equal((await api('other', 'GET', `/groups/${gid}`)).status, 403);
  assert.equal((await api('other', 'GET', `/groups/${gid}/candidates?q=ma`)).status, 403);
  assert.deepEqual((await api('other', 'GET', '/groups')).data.groups, []);
  assert.equal((await api(null, 'GET', '/groups')).status, 401);

  // The leader adds and removes members of THEIR group, and finds people without opening People.
  const found = await api('lead', 'GET', `/groups/${gid}/candidates?q=max`);
  assert.deepEqual(found.data.map((p) => p.id), [P.mem2]);
  assert.deepEqual(Object.keys(found.data[0]).sort(), ['first_name', 'id', 'last_name', 'nickname', 'photo']);
  assert.ok(!(await api('lead', 'GET', `/groups/${gid}/candidates?q=kit`)).data.length, 'children aren’t offered');
  assert.equal((await api('lead', 'PUT', `/groups/${gid}/members/${P.mem2}`, {})).status, 200);
  assert.equal((await api('lead', 'PUT', `/groups/${gid}/members/${P.lead2}`, { is_leader: true })).status, 403, 'leaders can’t make leaders');
  assert.equal((await api('lead', 'DELETE', `/groups/${gid}/members/${P.mem2}`)).status, 200);
  // …but not another group.
  assert.equal((await api('lead', 'GET', `/groups/${other}`)).status, 403);
  assert.equal((await api('lead', 'PUT', `/groups/${other}/members/${P.mem2}`, {})).status, 403);
  assert.equal((await api('lead', 'DELETE', `/groups/${other}/members/${P.mem2}`)).status, 403);
  // Leading a group gives no leader access.
  assert.equal(db.prepare('SELECT role, role_auto FROM users WHERE person_id = ?').get(P.lead).role, 'volunteer');
  assert.equal(db.prepare('SELECT role_auto FROM users WHERE person_id = ?').get(P.lead).role_auto, 0);
  assert.equal((await api('lead', 'GET', '/people')).status, 403);
  assert.equal((await api('lead', 'GET', '/teams/1')).status, 403);
  assert.equal((await api('lead', 'POST', '/groups', { name: 'x' })).status, 403);
  // A leader can't remove another leader (staff do that), but can step down.
  await api('north', 'PUT', `/groups/${gid}/members/${P.lead2}`, { is_leader: true });
  assert.equal((await api('lead2', 'DELETE', `/groups/${gid}/members/${P.lead}`)).status, 403);
  assert.equal((await api('lead2', 'DELETE', `/groups/${gid}/members/${P.lead2}`)).status, 200);

  // The chat's members follow the roster: added people are in, removed people are out.
  const cid = made.data.chat_id;
  const inChat = async (who) => (await api(who, 'GET', '/chats')).data.chats.some((c) => c.id === cid);
  const roster = async () => (await api('lead', 'GET', `/chats/${cid}`)).data.members.map((m) => m.person_id).sort();
  assert.deepEqual(await roster(), [P.lead, P.mem].sort());
  assert.equal(await inChat('mem'), true);
  assert.equal(await inChat('other'), false);
  assert.equal((await api('other', 'GET', `/chats/${cid}`)).status, 404);
  assert.equal((await api('mem', 'POST', `/chats/${cid}/messages`, { body: 'Hello group' })).status, 201);
  await api('lead', 'PUT', `/groups/${gid}/members/${P.other}`, {});
  assert.equal(await inChat('other'), true);
  assert.deepEqual((await api('other', 'GET', `/chats/${cid}/messages`)).data.messages.map((m) => m.body), ['Hello group']);
  await api('lead', 'DELETE', `/groups/${gid}/members/${P.other}`);
  assert.equal(await inChat('other'), false);
  assert.equal((await api('other', 'GET', `/chats/${cid}`)).status, 404);
  // The chat's roster can't be edited from chat; it's the group's.
  assert.equal((await api('lead', 'POST', `/chats/${cid}/members`, { person_ids: [P.other] })).status, 400);
  // A member can leave on their own.
  assert.equal((await api('mem', 'DELETE', `/groups/${gid}/members/${P.mem}`)).status, 200);
  assert.equal(await inChat('mem'), false);
  await api('lead', 'PUT', `/groups/${gid}/members/${P.mem}`, {});

  // Team chats are unaffected: a team with a leader still behaves as before.
  const team = (await api('admin', 'POST', '/teams', { name: 'Welcome' })).data;
  await api('admin', 'PUT', `/teams/${team.id}/members/${P.mem2}`, {});
  assert.ok((await api('admin', 'GET', '/chats')).data.chats.some((c) => c.kind === 'team' && c.name === 'Welcome'));

  // Archiving hides the group from everyone but staff, and its chat goes with it. Renaming reaches the chat.
  assert.equal((await api('lead', 'PATCH', `/groups/${gid}`, { name: 'x' })).status, 403);
  assert.equal((await api('north', 'PATCH', `/groups/${gid}`, { name: 'Wednesday Study' })).status, 200);
  assert.equal((await api('mem', 'GET', '/chats')).data.chats.find((c) => c.id === cid).name, 'Wednesday Study');
  assert.equal((await api('north', 'PATCH', `/groups/${gid}`, { archived: true })).status, 200);
  assert.deepEqual((await api('mem', 'GET', '/groups')).data.groups, []);
  assert.equal((await api('mem', 'GET', `/groups/${gid}`)).status, 404);
  assert.equal((await api('lead', 'GET', `/groups/${gid}`)).status, 404);
  assert.equal(await inChat('mem'), false);
  assert.ok(!(await api('north', 'GET', '/groups')).data.groups.some((g) => g.id === gid));
  assert.ok((await api('north', 'GET', '/groups?archived=1')).data.groups.some((g) => g.id === gid));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'group.archive'").get());
  await api('north', 'PATCH', `/groups/${gid}`, { archived: false });
  assert.equal(await inChat('mem'), true);

  // Groups are not teams: nothing in scheduling knows about them.
  assert.ok(!(await api('admin', 'GET', '/teams')).data.some((t) => t.name === 'Wednesday Study'));
});
