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
import { streams } from '../server/live.js';

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
  const chatOf = (g) => db.prepare('SELECT id FROM chats WHERE group_id = ?').get(g)?.id;
  assert.ok(chatOf(gid), 'a group gets a chat');
  assert.equal(made.data.chat_id, null, 'the chat is private to members, so staff who aren’t in the group aren’t pointed at it');
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
  // Only staff see email and phone; a leader manages the roster without contact details.
  const led = await api('lead', 'GET', `/groups/${gid}`);
  assert.equal(led.data.can_manage, true);
  assert.ok(led.data.roster.every((m) => !('email' in m) && !('phone' in m)), 'leader roster has no contact details');
  assert.ok((await api('north', 'GET', `/groups/${gid}`)).data.roster.every((m) => m.email && m.phone), 'staff roster has contact details');

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
  const cid = chatOf(gid);
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

// ---- security edges ---------------------------------------------------------------------------
const addPerson = (first, campus, extra = {}) => Number(db.prepare('INSERT INTO people (first_name, last_name, email, phone, campus_id, household_role, grade, birthdate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(first, 'Sec', `${first}@mb.org`, '555-1', campus, extra.role || 'adult', extra.grade ?? null, extra.birthdate ?? null).lastInsertRowid);
const addUser = (key, role, campuses, personId) => {
  const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId).lastInsertRowid;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  return id;
};
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const chatOfGroup = (g) => db.prepare('SELECT id FROM chats WHERE group_id = ?').get(g).id;

test('group leaders: campus-bound finder and adds, audited, no contact details, rate limited, step down', async () => {
  const gid = (await api('north', 'POST', '/groups', { name: 'North Home Group', campus_id: 1 })).data.id;
  const leadP = addPerson('Sleader', 1); addUser('sleader', 'volunteer', null, leadP);
  const northP = addPerson('Sarah', 1), southP = addPerson('Sally', 2), noCampusP = addPerson('Sunny', null);
  await api('north', 'PUT', `/groups/${gid}/members/${leadP}`, { is_leader: true });

  // The finder and add stay on the group's campus (or people with none), even for an all-campus account.
  assert.deepEqual((await api('sleader', 'GET', `/groups/${gid}/candidates?q=Sec`)).data.map((p) => p.id).sort(), [northP, noCampusP].sort());
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${southP}`, {})).status, 404);
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${northP}`, {})).status, 200);

  // Adds and removals are audited, including leaving on your own.
  const log = (action) => db.prepare('SELECT user_id, detail FROM audit_log WHERE action = ?').all(action).map((r) => ({ ...r, d: JSON.parse(r.detail) }));
  const add = log('group.member_add').find((r) => r.d.person_id === northP);
  assert.equal(add.d.group_id, gid);
  assert.equal(add.user_id, db.prepare('SELECT id FROM users WHERE person_id = ?').get(leadP).id);
  await api('sleader', 'DELETE', `/groups/${gid}/members/${northP}`);
  assert.ok(log('group.member_remove').some((r) => r.d.person_id === northP && r.d.group_id === gid));
  addUser('snorth', 'volunteer', null, northP);
  await api('sleader', 'PUT', `/groups/${gid}/members/${northP}`, {});
  await api('snorth', 'DELETE', `/groups/${gid}/members/${northP}`);
  assert.ok(log('group.member_remove').filter((r) => r.d.person_id === northP).length >= 2, 'self-leave is audited');

  // A leader's roster has no email or phone.
  const roster = (await api('sleader', 'GET', `/groups/${gid}`)).data.roster;
  assert.ok(roster.length && roster.every((m) => !('email' in m) && !('phone' in m)));

  // Step down: a leader can drop their own leadership but stay; nobody else can promote.
  const second = addPerson('Sam', 1);
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${leadP}`, { is_leader: true })).status, 200, 'no change is fine');
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${second}`, { is_leader: true })).status, 403);
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${leadP}`, { is_leader: false })).status, 200);
  assert.equal(db.prepare('SELECT is_leader FROM group_members WHERE group_id = ? AND person_id = ?').get(gid, leadP).is_leader, 0);
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${leadP}`, { is_leader: true })).status, 403, 'can’t step back up');
  await api('north', 'PUT', `/groups/${gid}/members/${leadP}`, { is_leader: true });

  // Rate limit: 30 adds a day per leader (simulated with audit rows); staff aren't limited.
  const uid = db.prepare('SELECT id FROM users WHERE person_id = ?').get(leadP).id;
  const ins = db.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?, 'group.member_add', '{}')");
  for (let i = 0; i < 30; i++) ins.run(uid);
  const r = await api('sleader', 'PUT', `/groups/${gid}/members/${second}`, {});
  assert.equal(r.status, 429);
  assert.ok(r.data.error);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${second}`, {})).status, 200);
  db.prepare("UPDATE audit_log SET at = datetime('now', '-2 days') WHERE user_id = ? AND detail = '{}'").run(uid);
  assert.equal((await api('sleader', 'PUT', `/groups/${gid}/members/${northP}`, {})).status, 200, 'old adds stop counting');
});

test('adults only: a child is refused by grade or by birthdate', async () => {
  const gid = (await api('north', 'POST', '/groups', { name: 'Adults Only', campus_id: 1 })).data.id;
  const byGrade = addPerson('Gradey', 1, { grade: 5 });
  const byAge = addPerson('Youngy', 1, { birthdate: yearsAgo(10) });
  const grown = addPerson('Grownup', 1, { birthdate: yearsAgo(40) });
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${byGrade}`, {})).status, 400);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${byAge}`, {})).status, 400);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${grown}`, {})).status, 200);
  const found = (await api('north', 'GET', `/groups/${gid}/candidates?q=${encodeURIComponent('Gradey')}`)).data;
  assert.deepEqual(found, []);
  assert.deepEqual((await api('north', 'GET', `/groups/${gid}/candidates?q=Youngy`)).data, []);
});

test('church-wide groups: campus-limited staff are ordinary members; unrestricted staff manage', async () => {
  const gid = (await api('admin', 'POST', '/groups', { name: 'Everyone Study' })).data.id;
  const cid = chatOfGroup(gid);
  const target = addPerson('Wendy', 1);
  assert.equal((await api('north', 'GET', `/groups/${gid}`)).status, 403);
  assert.equal((await api('north', 'PATCH', `/groups/${gid}`, { name: 'Mine now' })).status, 403);
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${target}`, {})).status, 403);
  assert.equal((await api('north', 'GET', `/groups/${gid}/candidates?q=Wendy`)).status, 403);
  assert.equal((await api('north', 'GET', `/chats/${cid}`)).status, 404);
  assert.ok(!(await api('north', 'GET', '/groups')).data.groups.some((g) => g.id === gid), 'not listed for campus-limited staff');
  assert.equal((await api('admin', 'PUT', `/groups/${gid}/members/${target}`, {})).status, 200);
  // A member who is campus-limited staff still gets only member rights.
  await api('admin', 'PUT', `/groups/${gid}/members/${P.north}`, {});
  assert.ok((await api('north', 'GET', '/groups')).data.groups.some((g) => g.id === gid), 'listed once they’re a member');
  const v = await api('north', 'GET', `/groups/${gid}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.can_manage, false);
  assert.equal(v.data.can_staff, false);
  assert.ok(v.data.roster.every((m) => !('email' in m)));
  assert.equal((await api('north', 'PUT', `/groups/${gid}/members/${P.other}`, {})).status, 403);
  assert.equal((await api('north', 'PATCH', `/groups/${gid}`, { archived: true })).status, 403);
  await api('admin', 'DELETE', `/groups/${gid}/members/${P.north}`);
});

test('small-group chats are private to members, staff included; removed members stop getting live messages', async () => {
  const gid = (await api('north', 'POST', '/groups', { name: 'Prayer Circle', campus_id: 1 })).data.id;
  const cid = chatOfGroup(gid);
  await api('north', 'PUT', `/groups/${gid}/members/${P.mem}`, {});
  await api('north', 'PUT', `/groups/${gid}/members/${P.lead}`, {});
  assert.equal((await api('mem', 'POST', `/chats/${cid}/messages`, { body: 'Please pray for my mom' })).status, 201);
  // Not even an admin or the campus's own staff, until they join the group.
  for (const who of ['admin', 'north']) {
    assert.equal((await api(who, 'GET', `/chats/${cid}/messages`)).status, 404, `${who} can’t read it`);
    assert.equal((await api(who, 'GET', `/chats/${cid}`)).status, 404);
    assert.equal((await api(who, 'POST', `/chats/${cid}/messages`, { body: 'hi' })).status, 404);
    assert.ok(!(await api(who, 'GET', '/chats')).data.chats.some((c) => c.id === cid));
  }
  // Staff still see the group page, but without a chat link.
  assert.equal((await api('north', 'GET', `/groups/${gid}`)).data.chat_id, null);
  assert.equal((await api('mem', 'GET', `/groups/${gid}`)).data.chat_id, cid);

  // Live stream: a page that was "viewing" the chat stops receiving once removed.
  const writes = [];
  const fakeReq = { user: { id: db.prepare('SELECT id FROM users WHERE person_id = ?').get(P.mem).id, role: 'volunteer', personId: P.mem, campusIds: null } };
  const stream = { userId: fakeReq.user.id, req: fakeReq, viewing: cid, res: { write: (d) => writes.push(d) } };
  streams.add(stream);
  try {
    // Another member posts: the stream hears about it.
    assert.equal((await api('lead', 'POST', `/chats/${cid}/messages`, { body: 'Praying' })).status, 201);
    assert.ok(writes.some((w) => w.includes('Praying')), 'a current member hears it');
    await api('north', 'DELETE', `/groups/${gid}/members/${P.mem}`);
    writes.length = 0;
    // The removed member's account is no longer in the recipient list, so only `viewing` could match it.
    assert.equal((await api('lead', 'POST', `/chats/${cid}/messages`, { body: 'After removal' })).status, 201);
    assert.ok(!writes.some((w) => w.includes('After removal')), 'removed member gets nothing');
    assert.equal(stream.viewing, null);
  } finally { streams.delete(stream); }

  // Archiving cuts off a viewer too.
  await api('north', 'PUT', `/groups/${gid}/members/${P.mem}`, {});
  const s2 = { userId: -1, req: fakeReq, viewing: cid, res: { write: (d) => writes.push(d) } };
  streams.add(s2);
  try {
    await api('north', 'PATCH', `/groups/${gid}`, { archived: true });
    writes.length = 0;
    await api('lead', 'POST', `/chats/${cid}/messages`, { body: 'Archived now' });
    assert.ok(!writes.some((w) => w.includes('Archived now')));
  } finally { streams.delete(s2); }
});

test('team chats and DMs still reach viewers and members live', async () => {
  const team = (await api('admin', 'POST', '/teams', { name: 'Live Team' })).data;
  await api('admin', 'PUT', `/teams/${team.id}/members/${P.mem}`, {});
  const chat = (await api('mem', 'GET', '/chats')).data.chats.find((c) => c.kind === 'team' && c.name === 'Live Team');
  const writes = [];
  const req = { user: { id: db.prepare('SELECT id FROM users WHERE person_id = ?').get(P.mem).id, role: 'volunteer', personId: P.mem, campusIds: null } };
  const stream = { userId: req.user.id, req, viewing: chat.id, res: { write: (d) => writes.push(d) } };
  // A staff viewer of the team chat (not a recipient) still hears it while viewing.
  const adminReq = { user: { id: db.prepare('SELECT id FROM users WHERE person_id = ?').get(P.admin).id, role: 'admin', personId: P.admin, campusIds: null } };
  const adminWrites = [];
  const adminStream = { userId: -2, req: adminReq, viewing: chat.id, res: { write: (d) => adminWrites.push(d) } };
  streams.add(stream); streams.add(adminStream);
  try {
    await api('mem', 'POST', `/chats/${chat.id}/messages`, { body: 'Team hello' });
    assert.ok(writes.some((w) => w.includes('Team hello')));
    assert.ok(adminWrites.some((w) => w.includes('Team hello')), 'staff viewing a team chat still hear it');
  } finally { streams.delete(stream); streams.delete(adminStream); }
});

test('merging people keeps group membership (and leadership) and serving campuses', async () => {
  const gA = (await api('north', 'POST', '/groups', { name: 'Merge A', campus_id: 1 })).data.id;
  const gB = (await api('north', 'POST', '/groups', { name: 'Merge B', campus_id: 1 })).data.id;
  const gC = (await api('north', 'POST', '/groups', { name: 'Merge C', campus_id: 1 })).data.id;
  const keep = addPerson('Keeper', 1), dup = addPerson('Dupe', 1);
  const put = (g, p, lead) => db.prepare('INSERT INTO group_members (group_id, person_id, is_leader) VALUES (?, ?, ?)').run(g, p, lead);
  put(gA, dup, 0);          // only the duplicate is in A
  put(gB, keep, 0); put(gB, dup, 1);  // both in B, the duplicate led
  put(gC, keep, 1); put(gC, dup, 0);  // both in C, the kept one led
  db.prepare('INSERT INTO serving_campuses (person_id, campus_id) VALUES (?, 2), (?, 1), (?, 2)').run(dup, dup, keep);
  const r = await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(r.status, 200);
  const mem = (g) => db.prepare('SELECT person_id, is_leader FROM group_members WHERE group_id = ?').all(g).map((x) => ({ ...x }));
  assert.deepEqual(mem(gA), [{ person_id: keep, is_leader: 0 }]);
  assert.deepEqual(mem(gB), [{ person_id: keep, is_leader: 1 }], 'leadership carries over');
  assert.deepEqual(mem(gC), [{ person_id: keep, is_leader: 1 }]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_members WHERE person_id = ?').get(dup).n, 0);
  assert.deepEqual(db.prepare('SELECT campus_id FROM serving_campuses WHERE person_id = ? ORDER BY campus_id').all(keep).map((x) => x.campus_id), [1, 2]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM serving_campuses WHERE person_id = ?').get(dup).n, 0);
});
