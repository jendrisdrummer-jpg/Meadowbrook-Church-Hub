// Campus-limited admins: they manage accounts in their own campuses and nothing wider.
// Admin A covers every campus; admin N is limited to campus 1. Own database, no dates involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, getSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

process.env.MB_DEV_LOGIN = '1';
delete process.env.MB_ADMIN_EMAILS;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-adminscope-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let db, server, base;
const cookies = {};
const ids = {};

const addPerson = (first, campus) => Number(db.prepare('INSERT INTO people (first_name, last_name, email, campus_id) VALUES (?, ?, ?, ?)').run(first, 'Scope', `${first.toLowerCase()}@x.test`, campus).lastInsertRowid);
const addUser = (email, role, { campus = null, person = null } = {}) =>
  Number(db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(email, role, campus && JSON.stringify(campus), person).lastInsertRowid);
const login = (key, id) => startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
const call = async (who, method, url, body) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const camps = (id) => JSON.parse(row(id).campus_ids || 'null');

before(async () => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago')`);
  server = createApp({ db, uploadDir: tmp }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ids.A = addUser('a@x.test', 'admin');
  ids.N = addUser('n@x.test', 'admin', { campus: [1] });
  ids.N2 = addUser('n2@x.test', 'admin', { campus: [1] }); // another limited admin
  ids.S1 = addUser('s1@x.test', 'staff', { campus: [1] });
  ids.S2 = addUser('s2@x.test', 'staff', { campus: [2] });
  ids.SBoth = addUser('sboth@x.test', 'staff', { campus: [1, 2] });
  ids.SAll = addUser('sall@x.test', 'staff');
  ids.p1 = addPerson('One', 1); ids.p2 = addPerson('Two', 2); ids.pNone = addPerson('Nowhere', null);
  ids.V1 = addUser('v1@x.test', 'volunteer', { person: ids.p1 });
  ids.V2 = addUser('v2@x.test', 'volunteer', { person: ids.p2 });
  ids.VU = addUser('vu@x.test', 'volunteer');
  login('A', ids.A); login('N', ids.N);
});
after(() => server.close());

const KIND = /every campus/;

test('self: a limited admin can’t change their own access or delete themselves', async () => {
  for (const body of [{ campus_ids: 'all' }, { role: 'staff' }, { finance: true }, { announce: true }, { active: false }, { checkin: true }, { campus_ids: [1, 2] }, { person_id: ids.p1 }]) {
    const r = await call('N', 'PATCH', `/users/${ids.N}`, body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.match(r.data.error, /Ask an admin who covers every campus to change your own access\./);
  }
  const del = await call('N', 'DELETE', `/users/${ids.N}`);
  assert.equal(del.status, 403);
  assert.match(del.data.error, KIND);
  assert.deepEqual(camps(ids.N), [1]);
  assert.equal(row(ids.N).role, 'admin');
});

test('self: the dialog’s unchanged body is harmless and changes nothing', async () => {
  const before = JSON.stringify(row(ids.N));
  const r = await call('N', 'PATCH', `/users/${ids.N}`, { role: 'admin', campus_ids: [1], finance: false, announce: false, checkin: false, active: true, person_id: null });
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(row(ids.N)), before);
  assert.deepEqual(getSetting(db, 'checkin_user_ids', []), []);
});

test('an account for another campus is out of reach: 403, and left out of every list', async () => {
  assert.equal((await call('N', 'PATCH', `/users/${ids.S2}`, { role: 'leader' })).status, 403);
  assert.equal((await call('N', 'PATCH', `/users/${ids.S2}`, { checkin: true })).status, 403);
  assert.equal((await call('N', 'DELETE', `/users/${ids.S2}`)).status, 403);
  assert.equal(row(ids.S2).role, 'staff');
  const list = (await call('N', 'GET', '/users?q=x.test')).data;
  const emails = list.users.map((u) => u.email);
  assert.ok(emails.includes('s1@x.test'));
  for (const hidden of ['s2@x.test', 'sboth@x.test', 'sall@x.test', 'a@x.test', 'n@x.test', 'n2@x.test', 'v2@x.test']) assert.ok(!emails.includes(hidden), `${hidden} is hidden`);
  // The unrestricted admin still sees everyone.
  const all = (await call('A', 'GET', '/users?q=x.test')).data.users.map((u) => u.email);
  for (const e of ['s2@x.test', 'n@x.test', 'a@x.test']) assert.ok(all.includes(e));
});

test('staff in their own campus: change role, but never to admin, wider campuses or finance', async () => {
  assert.equal((await call('N', 'PATCH', `/users/${ids.S1}`, { role: 'leader', campus_ids: [1] })).status, 200);
  assert.equal(row(ids.S1).role, 'leader');
  assert.equal((await call('N', 'PATCH', `/users/${ids.S1}`, { role: 'staff' })).status, 200);
  assert.equal(row(ids.S1).role, 'staff');
  for (const body of [{ role: 'admin' }, { campus_ids: [1, 2] }, { campus_ids: 'all' }, { campus_ids: null }, { finance: true }, { announce: true }]) {
    assert.equal((await call('N', 'PATCH', `/users/${ids.S1}`, body)).status, 403, JSON.stringify(body));
  }
  assert.equal(row(ids.S1).role, 'staff');
  assert.deepEqual(camps(ids.S1), [1]);
  assert.equal(row(ids.S1).finance, 0);
  // The Settings dialog re-sends everything unchanged: that is fine.
  assert.equal((await call('N', 'PATCH', `/users/${ids.S1}`, { role: 'staff', campus_ids: [1], finance: false, announce: false, checkin: false, active: true, person_id: null })).status, 200);
  // Kids' check-in is allowed for an account in reach.
  assert.equal((await call('N', 'PATCH', `/users/${ids.S1}`, { checkin: true })).status, 200);
  assert.ok(getSetting(db, 'checkin_user_ids', []).includes(ids.S1));
});

test('volunteers: reach follows the linked person’s campus; unlinked ones are fine', async () => {
  assert.equal((await call('N', 'PATCH', `/users/${ids.V2}`, { role: 'leader', campus_ids: [1] })).status, 403);
  assert.equal(row(ids.V2).role, 'volunteer');
  assert.equal((await call('N', 'PATCH', `/users/${ids.V1}`, { active: true })).status, 200);
  assert.equal((await call('N', 'PATCH', `/users/${ids.VU}`, { active: true })).status, 200);
  const list = (await call('N', 'GET', '/users')).data;
  assert.ok(list.unlinked.some((u) => u.id === ids.VU), 'unlinked volunteer is listed');
  assert.ok(!list.unlinked.some((u) => u.id === ids.SAll), 'out-of-reach unlinked staff is not');
});

test('promoting a volunteer to leader leaves their campuses inside the admin’s', async () => {
  // Their campus list is empty ("every campus"): it becomes the admin's own.
  assert.equal((await call('N', 'PATCH', `/users/${ids.V1}`, { role: 'leader' })).status, 200);
  assert.deepEqual(camps(ids.V1), [1]);
  assert.equal((await call('N', 'PATCH', `/users/${ids.V1}`, { role: 'volunteer' })).status, 200);
  assert.equal((await call('N', 'PATCH', `/users/${ids.VU}`, { role: 'leader', campus_ids: [1, 2] })).status, 403);
  assert.equal((await call('N', 'PATCH', `/users/${ids.VU}`, { role: 'staff', campus_ids: [1] })).status, 200);
  assert.deepEqual(camps(ids.VU), [1]);
  assert.equal((await call('N', 'PATCH', `/users/${ids.VU}`, { role: 'volunteer' })).status, 200);
});

test('creating accounts: defaults to their campuses, never admin or finance or wider', async () => {
  const made = await call('N', 'POST', '/users', { email: 'new-staff@x.test', role: 'staff' });
  assert.equal(made.status, 201);
  assert.deepEqual(camps(made.data.id), [1]);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-admin@x.test', role: 'admin' })).status, 403);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-fin@x.test', role: 'staff', finance: true })).status, 403);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-ann@x.test', role: 'staff', announce: true })).status, 403);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-all@x.test', role: 'staff', campus_ids: 'all' })).status, 403);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-two@x.test', role: 'leader', campus_ids: [1, 2] })).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE 'new-%'").get().n, 1);
  assert.equal((await call('N', 'POST', '/users', { email: 'new-far@x.test', role: 'volunteer', person_id: ids.p2 })).status, 403); // person at campus 2
  // Unrestricted admin: as before.
  const a = await call('A', 'POST', '/users', { email: 'a-made-admin@x.test', role: 'admin', finance: true, campus_ids: 'all' });
  assert.equal(a.status, 201);
  assert.equal(row(a.data.id).finance, 1);
  assert.equal(row(a.data.id).campus_ids, null);
});

test('another admin’s account is never in reach, even if limited to the same campus', async () => {
  assert.equal((await call('N', 'PATCH', `/users/${ids.N2}`, { active: false })).status, 403);
  assert.equal((await call('N', 'PATCH', `/users/${ids.N2}`, { campus_ids: [1] })).status, 403);
  assert.equal((await call('N', 'DELETE', `/users/${ids.N2}`)).status, 403);
  assert.equal((await call('N', 'PATCH', `/users/${ids.A}`, { role: 'staff' })).status, 403);
  assert.equal(row(ids.N2).active, 1);
});

test('the team-leader rule via a limited admin’s link never leaves campus_ids empty', async () => {
  const pTeam = addPerson('Lead', 1);
  const team = Number(db.prepare("INSERT INTO teams (name, campus_id) VALUES ('Greeters', 1)").run().lastInsertRowid);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, pTeam);
  const uid = addUser('lead@x.test', 'volunteer');
  assert.equal((await call('N', 'PATCH', `/users/${uid}`, { person_id: pTeam })).status, 200);
  assert.equal(row(uid).role, 'leader');
  assert.deepEqual(camps(uid), [1]);
  // A person with no campus: the admin's own campuses.
  const pFree = addPerson('Free', null);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, pFree);
  const uid2 = addUser('free@x.test', 'volunteer');
  assert.equal((await call('N', 'PATCH', `/users/${uid2}`, { person_id: pFree })).status, 200);
  assert.deepEqual(camps(uid2), [1]);
  // Unrestricted admin: unchanged behaviour (no campus list stays "every campus").
  const pA = addPerson('Alead', 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, pA);
  const uid3 = addUser('alead@x.test', 'volunteer');
  assert.equal((await call('A', 'PATCH', `/users/${uid3}`, { person_id: pA })).status, 200);
  assert.equal(row(uid3).role, 'leader');
  assert.equal(row(uid3).campus_ids, null);
});

test('merging people: a limited admin can’t re-link an account they can’t manage', async () => {
  const keep = addPerson('Keep', 1);
  const dup = addPerson('Dup', 1);
  const staffAll = addUser('dupstaff@x.test', 'staff', { person: dup }); // no campus list: out of reach
  assert.equal((await call('N', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 403);
  assert.equal(row(staffAll).person_id, dup);
  assert.equal((await call('A', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  assert.equal(row(staffAll).person_id, keep);
});

test('the person page says whether an admin may change the account', async () => {
  const mine = (await call('N', 'GET', `/people/${ids.p1}`)).data.account;
  assert.equal(mine.editable, true); // V1 volunteer at campus 1
  const adminPerson = addPerson('Adm', 1);
  db.prepare('UPDATE users SET person_id = ? WHERE id = ?').run(adminPerson, ids.N2);
  assert.equal((await call('N', 'GET', `/people/${adminPerson}`)).data.account.editable, false);
  assert.equal((await call('A', 'GET', `/people/${adminPerson}`)).data.account.editable, true);
});

// --------------------------------------------------------- church-wide admin routes
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const churchWide = [
  ['PATCH', '/settings', { sign_in_policy: 'invited' }],
  ['PATCH', '/settings', { church_name: 'Renamed' }],
  ['POST', '/campuses', { name: 'East' }],
  ['POST', '/profile-fields', { label: 'Favourite colour', type: 'text' }],
  ['PUT', '/profile-fields/order', { ids: [] }],
  ['GET', '/backups'],
  ['POST', '/import/preview', null],
  ['POST', '/import/people', { csv: 'First Name\nZed', mapping: { first_name: 'First Name' } }],
  ['DELETE', '/app-icon'],
  ['DELETE', '/backups/drive'],
];

test('church-wide admin routes: 403 for a limited admin, fine for an unrestricted one', async () => {
  for (const [method, url, body] of churchWide) {
    const n = await call('N', method, url, body ?? undefined);
    assert.equal(n.status, 403, `N ${method} ${url}`);
    assert.match(n.data.error, KIND);
    const a = await call('A', method, url, body ?? undefined);
    assert.ok(a.status < 400, `A ${method} ${url} gave ${a.status}`);
  }
  assert.equal(getSetting(db, 'church_name', ''), 'Renamed');
  // sign_in_policy was only changed by A, never by N
  assert.equal(getSetting(db, 'sign_in_policy', 'anyone'), 'invited');
});

test('church-wide routes that need a body or a file also refuse a limited admin', async () => {
  const icon = await fetch(`${base}/api/app-icon/180`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-mb': '1', cookie: cookies.N }, body: PNG });
  assert.equal(icon.status, 403);
  const iconA = await fetch(`${base}/api/app-icon/180`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-mb': '1', cookie: cookies.A }, body: PNG });
  assert.equal(iconA.status, 200);
  const field = db.prepare("SELECT id FROM profile_fields LIMIT 1").get();
  assert.equal((await call('N', 'PATCH', `/profile-fields/${field.id}`, { label: 'x' })).status, 403);
  assert.equal((await call('A', 'PATCH', `/profile-fields/${field.id}`, { label: 'Hue' })).status, 200);
  assert.equal((await call('N', 'POST', '/backups/run')).status, 403);
  assert.equal((await call('N', 'GET', '/backups/1/download')).status, 403);
  assert.equal((await call('N', 'POST', '/media/mux/reset-key')).status, 403);
  // Drive sign-in is church-wide too: sent back to Backups with a kind message.
  const drive = await fetch(`${base}/auth/google/drive`, { headers: { cookie: cookies.N }, redirect: 'manual' });
  assert.equal(drive.status, 302);
  assert.match(decodeURIComponent(drive.headers.get('location')), /every campus/);
});

test('campuses: a limited admin edits their own campus only', async () => {
  assert.equal((await call('N', 'PATCH', '/campuses/2', { address: 'Elsewhere' })).status, 403);
  assert.equal((await call('N', 'PATCH', '/campuses/1', { address: '1 Main St' })).status, 200);
  assert.equal((await call('A', 'PATCH', '/campuses/2', { address: 'South St' })).status, 200);
});

test('feedback: a limited admin can’t update another campus’s feedback', async () => {
  const fid = Number(db.prepare("INSERT INTO feedback (user_id, role, campus_id, category, severity, body) VALUES (?, 'volunteer', 2, 'idea', 'nice_to_have', 'hi')").run(ids.V2).lastInsertRowid);
  const own = Number(db.prepare("INSERT INTO feedback (user_id, role, campus_id, category, severity, body) VALUES (?, 'volunteer', 1, 'idea', 'nice_to_have', 'hi')").run(ids.V1).lastInsertRowid);
  assert.equal((await call('N', 'PATCH', `/feedback/${fid}`, { status: 'done' })).status, 403);
  assert.equal((await call('N', 'PATCH', `/feedback/${own}`, { status: 'done' })).status, 200);
  assert.equal((await call('A', 'PATCH', `/feedback/${fid}`, { status: 'done' })).status, 200);
});

test('duplicate links show a limited admin only accounts in reach', async () => {
  const p = addPerson('Twin', 1);
  const q = addPerson('Twin2', 1);
  // Two accounts on one person (old data; the unique index is off while duplicates exist).
  db.exec('DROP INDEX IF EXISTS users_person_unique');
  const a1 = addUser('twin1@x.test', 'volunteer', { person: p });
  const a2 = addUser('twin2@x.test', 'volunteer', { person: p });
  const b1 = addUser('twinb1@x.test', 'volunteer', { person: q });
  const b2 = addUser('twinb2@x.test', 'staff', { person: q }); // no campus list: out of reach
  const dups = (await call('N', 'GET', '/users')).data.duplicate_links;
  assert.deepEqual(dups.map((d) => d.person_id), [p]);
  assert.deepEqual(dups[0].accounts.map((a) => a.id), [a1, a2]);
  assert.equal((await call('A', 'GET', '/users')).data.duplicate_links.length, 2);
  assert.ok(b1 && b2);
});

test('a volunteer linked to someone with no campus yet is manageable; more access still stays inside the admin’s campuses', async () => {
  const nobody = addPerson('Nocamp', null);
  const v = addUser('nocamp@x.test', 'volunteer', { person: nobody });
  assert.ok((await call('N', 'GET', '/users?q=nocamp')).data.users.some((u) => u.id === v), 'found by search for the campus admin');
  assert.equal((await call('N', 'PATCH', `/users/${v}`, { role: 'leader' })).status, 200);
  assert.deepEqual(camps(v), [1], 'promoted inside the admin’s campuses only');
  assert.equal((await call('N', 'PATCH', `/users/${v}`, { campus_ids: 'all' })).status, 403);
});

test('re-review M1: the team-leader rule never makes a leader for a campus the actor doesn’t cover', async () => {
  const team = Number(db.prepare("INSERT INTO teams (name, campus_id) VALUES ('North Crew', 1)").run().lastInsertRowid);
  // (a) A limited admin links an unlinked volunteer whose own list is [2] (e.g. South staff who stepped down)
  // to a North team leader: now out of reach, so refused.
  const lead = addPerson('Leadone', 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, lead);
  const ex = addUser('ex-m1@x.test', 'volunteer', { campus: [2] });
  assert.equal((await call('N', 'PATCH', `/users/${ex}`, { person_id: lead })).status, 403);
  assert.equal(row(ex).role, 'volunteer');
  // (b) North-only staff makes someone a team leader whose volunteer account has [2]: leader, but North only.
  login('S1', ids.S1);
  const p2 = addPerson('Leadtwo', 1);
  const acct = addUser('leadtwo-m1@x.test', 'volunteer', { campus: [2], person: p2 });
  const r = await call('S1', 'PUT', `/teams/${team}/members/${p2}`, { is_leader: true });
  assert.ok(r.status < 300, `team change: ${r.status}`);
  assert.equal(row(acct).role, 'leader');
  assert.deepEqual(camps(acct), [1]);
  // (c) Merge by a limited admin: the kept person's account had [1, 2]; leadership comes over with the merge.
  const keep = addPerson('Keepme', 1), dup = addPerson('Keepme', 1);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, dup);
  const ka = addUser('keepme-m1@x.test', 'volunteer', { person: keep });
  db.prepare("UPDATE users SET campus_ids = '[1,2]' WHERE id = ?").run(ka);
  const m = await call('N', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(m.status, 200, `merge: ${m.status}`);
  assert.equal(row(ka).role, 'leader');
  assert.deepEqual(camps(ka), [1]);
  const narrowed = JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'user.leader_auto' AND detail LIKE ? ORDER BY id DESC").get(`%\"user_id\":${ka},%`).detail);
  assert.deepEqual([narrowed.campus_ids_before, narrowed.campus_ids_after], [[1, 2], [1]], 'the audit records the change');
  // An unrestricted admin keeps the older behaviour.
  const ua = addUser('free-m1@x.test', 'volunteer', { campus: [2], person: addPerson('Freeone', 1) });
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, row(ua).person_id);
  const { syncLeaderAccessFor } = await import('../server/routes/teams.js');
  syncLeaderAccessFor(db, row(ua).person_id, { user: { id: ids.A, campusIds: null } });
  assert.deepEqual(camps(ua), [2]);
});

test('re-review L1, L2: Finance/Announcements holders and listed admin emails stay with unrestricted admins', async () => {
  const fin = addUser('fin-l1@x.test', 'volunteer');
  db.prepare('UPDATE users SET finance = 1 WHERE id = ?').run(fin);
  assert.equal((await call('N', 'PATCH', `/users/${fin}`, { active: false })).status, 403);
  assert.equal((await call('N', 'DELETE', `/users/${fin}`)).status, 403);
  assert.ok(!(await call('N', 'GET', '/users')).data.unlinked.some((u) => u.id === fin), 'not listed for the campus admin');
  assert.ok((await call('A', 'GET', '/users')).data.unlinked.some((u) => u.id === fin), 'listed for an unrestricted admin');
  const keep = process.env.MB_ADMIN_EMAILS;
  process.env.MB_ADMIN_EMAILS = 'listed-l2@x.test';
  try {
    const listed = addUser('listed-l2@x.test', 'volunteer');
    assert.equal((await call('N', 'DELETE', `/users/${listed}`)).status, 403);
    assert.equal((await call('A', 'DELETE', `/users/${listed}`)).status, 200);
  } finally { if (keep === undefined) delete process.env.MB_ADMIN_EMAILS; else process.env.MB_ADMIN_EMAILS = keep; }
  assert.equal((await call('A', 'PATCH', `/users/${fin}`, { active: false })).status, 200);
});
