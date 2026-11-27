// Accounts are linked to people only by an admin choosing the person, one account per person.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb, setSetting, ensureAccountLinkIndex } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession, userForEmail } from '../server/auth.js';

process.env.MB_DEV_LOGIN = '1';
delete process.env.MB_ADMIN_EMAILS;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-links-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A server with its own database, an admin session, and a helper to call it.
async function serve(db) {
  const server = createApp({ db, uploadDir: tmp }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminId = db.prepare("INSERT INTO users (email, role) VALUES ('boss@church.test', 'admin')").run().lastInsertRowid;
  let cookie;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookie = v.split(';')[0]; } }, adminId);
  const api = async (method, url, body) => {
    const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { api, base, adminId, close: () => server.close() };
}

const addPerson = (db, first, email, extra = '') => Number(db.prepare(`INSERT INTO people (first_name, last_name, email${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, 'Test', ?${extra ? ', ' + extra.split('=')[1] : ''})`).run(first, email).lastInsertRowid);
const addUser = (db, email, role = 'volunteer', personId = null) => Number(db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run(email, role, personId).lastInsertRowid);
const linkedTo = (db, personId) => db.prepare('SELECT id FROM users WHERE person_id = ?').all(personId);

let db, s;
before(async () => {
  db = openDb(':memory:');
  s = await serve(db);
});
after(() => s.close());

test('first sign-in with an email that matches a person never links, under every policy that allows it', () => {
  setSetting(db, 'workspace_domain', 'church.test');
  const cases = [['anyone', 'kim@gmail.com'], ['directory', 'kim2@gmail.com'], ['directory', 'staffer@church.test'], ['domain', 'staffer2@church.test'], ['anyone', 'staffer3@church.test']];
  for (const [policy, email] of cases) {
    setSetting(db, 'sign_in_policy', policy);
    const pid = addPerson(db, 'Matching', email);
    const people = db.prepare('SELECT COUNT(*) n FROM people').get().n;
    const u = userForEmail(db, email.toUpperCase(), { first_name: 'Someone' });
    assert.ok(u && !u.needsName, `${policy} lets ${email} in`);
    assert.equal(u.person_id, null, `${policy}: account is unlinked`);
    assert.deepEqual(linkedTo(db, pid), [], `${policy}: the person is not linked`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, people, `${policy}: no second person is created`);
    assert.equal(u.role, 'volunteer');
  }
  // The policy still decides who may sign in.
  setSetting(db, 'sign_in_policy', 'directory');
  assert.equal(userForEmail(db, 'stranger@gmail.com', { first_name: 'Sam' }), null);
  setSetting(db, 'sign_in_policy', 'invited');
  addPerson(db, 'Invited', 'inv@gmail.com');
  assert.equal(userForEmail(db, 'inv@gmail.com', { first_name: 'Inv' }), null);
});

test('first admin and MB_ADMIN_EMAILS accounts are also created unlinked', () => {
  const d = openDb(':memory:');
  const pid = addPerson(d, 'Pastor', 'pastor@gmail.com');
  process.env.MB_ADMIN_EMAILS = 'pastor@gmail.com';
  try {
    const u = userForEmail(d, 'pastor@gmail.com', { first_name: 'Pastor' });
    assert.equal(u.role, 'admin');
    assert.equal(u.person_id, null);
    assert.deepEqual(linkedTo(d, pid), []);
  } finally { delete process.env.MB_ADMIN_EMAILS; }
  const d2 = openDb(':memory:'); // first sign-in on a fresh install in dev mode becomes admin, still unlinked
  const p2 = addPerson(d2, 'Owner', 'owner@gmail.com');
  assert.equal(userForEmail(d2, 'owner@gmail.com', { first_name: 'Owner' }).person_id, null);
  assert.deepEqual(linkedTo(d2, p2), []);
});

test('sign-in over HTTP (dev sign-in) creates an unlinked account and the office is asked to link it', async () => {
  setSetting(db, 'sign_in_policy', 'anyone');
  const pid = addPerson(db, 'Webby', 'webby@gmail.com');
  const res = await fetch(`${s.base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify({ email: 'webby@gmail.com' }) });
  assert.equal(res.status, 200);
  const u = db.prepare("SELECT * FROM users WHERE email = 'webby@gmail.com'").get();
  assert.equal(u.person_id, null);
  assert.deepEqual(linkedTo(db, pid), []);
  const unlinked = (await s.api('GET', '/users')).data.unlinked;
  assert.ok(unlinked.some((x) => x.id === u.id));
});

test('self sign-up: someone brand new gets a new person; a matching email or name never attaches to an existing one', () => {
  setSetting(db, 'sign_in_policy', 'anyone');
  const before = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  const fresh = userForEmail(db, 'brandnew@gmail.com', { first_name: 'Bran', last_name: 'New' });
  const person = db.prepare("SELECT * FROM people WHERE email = 'brandnew@gmail.com'").get();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, before + 1);
  assert.equal(fresh.person_id, person.id);
  assert.ok(person.signed_up_at);

  // Same name as someone in People, different email: a new person, not that one.
  const existing = addPerson(db, 'Jordan', 'jordan@work.test');
  db.prepare("UPDATE people SET last_name = 'Smith' WHERE id = ?").run(existing);
  const same = userForEmail(db, 'jordan.smith@gmail.com', { first_name: 'Jordan', last_name: 'Smith' });
  assert.notEqual(same.person_id, existing);
  assert.deepEqual(linkedTo(db, existing), []);

  // An archived person with that email isn't attached either: a new person is made.
  const old = addPerson(db, 'Old', 'old@gmail.com', 'archived=1');
  const again = userForEmail(db, 'old@gmail.com', { first_name: 'Old' });
  assert.notEqual(again.person_id, old);
  assert.deepEqual(linkedTo(db, old), []);
});

test('POST /users without a person is unlinked even when an email matches; with a person it links and is audited', async () => {
  const pid = addPerson(db, 'Match', 'match@church.test');
  const made = await s.api('POST', '/users', { email: 'match@church.test', role: 'volunteer' });
  assert.equal(made.status, 201);
  assert.equal(db.prepare('SELECT person_id FROM users WHERE id = ?').get(made.data.id).person_id, null);
  assert.deepEqual(linkedTo(db, pid), []);

  const chosen = addPerson(db, 'Chosen', 'chosen@church.test');
  const linked = await s.api('POST', '/users', { email: 'other@church.test', role: 'volunteer', person_id: chosen });
  assert.equal(linked.status, 201);
  const row = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'user.link' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.user_id, s.adminId, 'the actor is recorded');
  assert.deepEqual(JSON.parse(row.detail), { user_id: linked.data.id, person_id: chosen });
});

test('an admin links and unlinks an account by hand, each audited with the actor; existing links stay', async () => {
  const pid = addPerson(db, 'Linky', 'linky@gmail.com');
  const uid = addUser(db, 'linky@gmail.com');
  const keep = addUser(db, 'kept@gmail.com', 'volunteer', addPerson(db, 'Kept', 'kept@gmail.com'));
  assert.equal((await s.api('PATCH', `/users/${uid}`, { person_id: pid })).status, 200);
  assert.equal(db.prepare('SELECT person_id FROM users WHERE id = ?').get(uid).person_id, pid);
  let row = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'user.link' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.user_id, s.adminId);
  assert.deepEqual(JSON.parse(row.detail), { user_id: uid, person_id: pid, from_person_id: null });
  // Saving again with the same person, or another change, records no new link.
  const links = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'user.link'").get().n;
  const n = links();
  assert.equal((await s.api('PATCH', `/users/${uid}`, { person_id: pid, role: 'leader' })).status, 200);
  assert.equal(links(), n);
  // Signing in again keeps every existing link.
  assert.equal(userForEmail(db, 'kept@gmail.com').id, keep);
  assert.ok(db.prepare('SELECT person_id FROM users WHERE id = ?').get(keep).person_id);
  assert.equal(userForEmail(db, 'linky@gmail.com').person_id, pid);
  // Unlinking is audited too.
  assert.equal((await s.api('PATCH', `/users/${uid}`, { person_id: null })).status, 200);
  row = db.prepare("SELECT user_id, action, detail FROM audit_log WHERE action = 'user.unlink' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.user_id, s.adminId);
  assert.deepEqual(JSON.parse(row.detail), { user_id: uid, person_id: null, from_person_id: pid });
});

test('a person who already has an account can’t be linked again: 409 on every path', async () => {
  const pid = addPerson(db, 'Taken', 'taken@gmail.com');
  const owner = addUser(db, 'taken@gmail.com', 'volunteer', pid);
  const other = addUser(db, 'second@gmail.com');
  const patch = await s.api('PATCH', `/users/${other}`, { person_id: pid });
  assert.equal(patch.status, 409);
  assert.match(patch.data.error, /already has an account/);
  assert.equal((await s.api('POST', '/users', { email: 'third@gmail.com', role: 'volunteer', person_id: pid })).status, 409);
  assert.equal(db.prepare("SELECT 1 FROM users WHERE email = 'third@gmail.com'").get(), undefined);
  // Merging two people who each have an account would leave two on one person.
  const dupPerson = addPerson(db, 'Taken', 'taken2@gmail.com');
  addUser(db, 'taken2@gmail.com', 'volunteer', dupPerson);
  const merge = await s.api('POST', `/people/${pid}/merge`, { duplicate_id: dupPerson });
  assert.equal(merge.status, 409);
  assert.equal(db.prepare('SELECT archived FROM people WHERE id = ?').get(dupPerson).archived, 0, 'nothing merged');
  // A merge where only the duplicate has an account moves that account across, and it is audited.
  const lone = addPerson(db, 'Lone', 'lone@gmail.com');
  const loneUser = addUser(db, 'lone2@gmail.com', 'volunteer', lone);
  const keepOnly = addPerson(db, 'Lone', 'lone3@gmail.com');
  assert.equal((await s.api('POST', `/people/${keepOnly}/merge`, { duplicate_id: lone })).status, 200);
  assert.equal(db.prepare('SELECT person_id FROM users WHERE id = ?').get(loneUser).person_id, keepOnly);
  assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'user.link' ORDER BY id DESC LIMIT 1").get().detail).via, 'merge');
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(owner));
});

test('startup with duplicates: no index, a warning for admins, a log line, and no data changed', async () => {
  const file = path.join(tmp, 'dupes.db');
  let d = openDb(file);
  const pid = addPerson(d, 'Twice', 'twice@gmail.com');
  d.exec('DROP INDEX users_person_unique');
  addUser(d, 'a@gmail.com', 'admin', pid);
  addUser(d, 'b@gmail.com', 'volunteer', pid);
  d.close();

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try { d = openDb(file); } finally { console.warn = realWarn; }
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'users_person_unique'").get().n, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`person ids: ${pid}\\b`));
  assert.ok(!/@/.test(warnings[0]), 'no emails in the log');
  assert.deepEqual(d.prepare('SELECT email, person_id FROM users ORDER BY id').all().map((u) => [u.email, u.person_id]), [['a@gmail.com', pid], ['b@gmail.com', pid]]);

  const srv = await serve(d);
  try {
    const list = (await srv.api('GET', '/users')).data;
    assert.equal(list.duplicate_links.length, 1);
    assert.equal(list.duplicate_links[0].person_id, pid);
    assert.deepEqual(list.duplicate_links[0].accounts.map((a) => a.email), ['a@gmail.com', 'b@gmail.com']);
    // The admin can still edit these accounts, and unlinking one resolves it and turns the rule on.
    const b = d.prepare("SELECT id FROM users WHERE email = 'b@gmail.com'").get().id;
    assert.equal((await srv.api('PATCH', `/users/${b}`, { person_id: pid, role: 'leader' })).status, 200);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM users WHERE person_id = ?').get(pid).n, 2, 'saving other changes unlinks nothing');
    assert.equal((await srv.api('PATCH', `/users/${b}`, { person_id: null })).status, 200);
    assert.equal((await srv.api('GET', '/users')).data.duplicate_links.length, 0);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'users_person_unique'").get().n, 1);
  } finally { srv.close(); d.close(); }
});

test('startup with no duplicates: the index exists and a duplicate insert fails', () => {
  const file = path.join(tmp, 'clean.db');
  const d = openDb(file);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'users_person_unique'").get().n, 1);
  const pid = addPerson(d, 'Once', 'once@gmail.com');
  addUser(d, 'one@gmail.com', 'volunteer', pid);
  assert.throws(() => addUser(d, 'two@gmail.com', 'volunteer', pid), /UNIQUE/);
  addUser(d, 'three@gmail.com'); addUser(d, 'four@gmail.com'); // many unlinked accounts are fine
  assert.deepEqual(ensureAccountLinkIndex(d), { indexed: true, duplicates: 0 });
  d.close();
});

test('the audit script is read-only and prints no emails or names unless --show is passed', () => {
  const run = (file, ...args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/audit-account-links.js', ...args], { env: { ...process.env, MB_DB: file }, encoding: 'utf8' });

  const clean = path.join(tmp, 'audit-clean.db');
  let d = openDb(clean);
  addUser(d, 'solo@secret.test', 'volunteer', addPerson(d, 'Solo', 'solo@secret.test'));
  d.close();
  const out = run(clean);
  assert.match(out, /Summary: 0 people with more than one account, 0 accounts linked to an archived or missing person/);
  assert.match(out, /enforced by the database: yes/);

  const dupes = path.join(tmp, 'audit-dupes.db');
  d = openDb(dupes);
  const pid = addPerson(d, 'Dana', 'dana@secret.test');
  const gone = addPerson(d, 'Gone', 'gone@secret.test', 'archived=1');
  d.exec('DROP INDEX users_person_unique');
  addUser(d, 'dana1@secret.test', 'admin', pid);
  addUser(d, 'dana2@secret.test', 'volunteer', pid);
  addUser(d, 'gone@secret.test', 'volunteer', gone);
  d.close();
  const usersOf = () => { const x = openDb(dupes); const rows = JSON.stringify(x.prepare('SELECT * FROM users ORDER BY id').all()); x.close(); return rows; };
  const before = usersOf();
  const hidden = run(dupes);
  assert.match(hidden, new RegExp(`person ${pid}\\n    account \\d+ \\(admin, active`));
  assert.match(hidden, /is archived/);
  assert.match(hidden, /Summary: 1 people with more than one account, 1 accounts linked to an archived or missing person/);
  assert.ok(!/secret\.test|Dana|Gone/.test(hidden), 'no emails or names by default');
  const shown = run(dupes, '--show');
  assert.ok(/dana1@secret\.test/.test(shown) && /Dana Test/.test(shown));
  assert.equal(usersOf(), before, 'no accounts changed (and the startup step only warned)');
  assert.match(fs.readFileSync('scripts/audit-account-links.js', 'utf8'), /new DatabaseSync\(file, \{ readOnly: true \}\)/, 'opens the database read-only');
});

test('admin linking applies the usual team-leader rule; unlinking takes back only automatic leader access', async () => {
  const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('Link Crew')").run().lastInsertRowid);
  const leaderP = addPerson(db, 'Leah', 'leah@gmail.com');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, leaderP);
  const u = addUser(db, 'leah@gmail.com');
  const role = () => db.prepare('SELECT role, role_auto FROM users WHERE id = ?').get(u);
  assert.equal((await s.api('PATCH', `/users/${u}`, { person_id: leaderP })).status, 200);
  assert.deepEqual({ ...role() }, { role: 'leader', role_auto: 1 });
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'user.leader_auto' AND detail LIKE ?").get(`%"user_id":${u}%`));
  // Unlinking takes back the automatic leader access, not access set by hand.
  assert.equal((await s.api('PATCH', `/users/${u}`, { person_id: null })).status, 200);
  assert.deepEqual({ ...role() }, { role: 'volunteer', role_auto: 0 });
  // A role chosen by hand at link time is kept as chosen.
  assert.equal((await s.api('PATCH', `/users/${u}`, { person_id: leaderP, role: 'staff' })).status, 200);
  assert.deepEqual({ ...role() }, { role: 'staff', role_auto: 0 });
  await s.api('PATCH', `/users/${u}`, { person_id: null });
  assert.equal(role().role, 'staff', 'hand-set access never changes automatically');
  // Creating an account for a team leader, linked by the admin, gives leader access too.
  const p2 = addPerson(db, 'Lon', 'lon@gmail.com');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, p2);
  const made = await s.api('POST', '/users', { email: 'lon@gmail.com', person_id: p2 });
  assert.equal(made.status, 201);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(made.data.id).role, 'leader');
});

test('unlink through the Settings dialog (it always sends the role) takes back automatic leader and check-in access', async () => {
  const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('Dialog Crew')").run().lastInsertRowid);
  const p = addPerson(db, 'Dina', 'dina@gmail.com');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, p);
  const u = addUser(db, 'dina@gmail.com');
  const ui = (extra) => ({ role: db.prepare('SELECT role FROM users WHERE id = ?').get(u).role, checkin: true, finance: false, announce: false, campus_ids: 'all', active: true, ...extra });
  // Linking through the dialog body (role sent unchanged) applies the team-leader rule.
  assert.equal((await s.api('PATCH', `/users/${u}`, ui({ person_id: p, checkin: false }))).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT role, role_auto FROM users WHERE id = ?').get(u) }, { role: 'leader', role_auto: 1 });
  assert.equal((await s.api('PATCH', `/users/${u}`, ui({ checkin: true }))).status, 200);
  // Unlink + Save, as docs/account-links.md says.
  assert.equal((await s.api('PATCH', `/users/${u}`, ui({ person_id: null }))).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT role, role_auto FROM users WHERE id = ?').get(u) }, { role: 'volunteer', role_auto: 0 });
  const users = (await s.api('GET', '/users?q=dina')).data.users;
  assert.equal(users.find((x) => x.id === u).checkin, false);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'user.leader_auto' AND detail LIKE ? AND detail LIKE '%\"granted\":false%'").get(`%"user_id":${u}%`));
});

test('a campus-limited admin links accounts only to people at their campuses', async () => {
  db.exec("INSERT OR IGNORE INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago')");
  const south = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Sam', 'South', 2)").run().lastInsertRowid);
  const north = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Nia', 'North', 1)").run().lastInsertRowid);
  const limited = Number(db.prepare("INSERT INTO users (email, role, campus_ids) VALUES ('northadmin@church.test', 'admin', '[1]')").run().lastInsertRowid);
  let cookie;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookie = v.split(';')[0]; } }, limited);
  const call = (method, url, body) => fetch(`${s.base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie }, body: JSON.stringify(body) });
  const acct = addUser(db, 'someone-new@gmail.com');
  assert.equal((await call('PATCH', `/users/${acct}`, { person_id: south })).status, 403);
  assert.equal((await call('PATCH', `/users/${acct}`, { person_id: north })).status, 200);
});

test('People emails with stray spaces still count as in People (never attached, no duplicate person)', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('sign_in_policy', '\"anyone\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const p = addPerson(db, 'Kim', ' Kim@Spaces.org ');
  const before = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  const u = userForEmail(db, 'kim@spaces.org', { first_name: 'Kim' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, before, 'no second Kim');
  assert.equal(u.person_id ?? null, null, 'not linked');
  assert.equal(linkedTo(db, p).length, 0);
});

test('linking a team leader with kids’ check-in ticked keeps the tick; merges apply the team-leader rule', async () => {
  const team = Number(db.prepare("INSERT INTO teams (name) VALUES ('Tick Crew')").run().lastInsertRowid);
  const p = addPerson(db, 'Tia', 'tia@gmail.com');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, p);
  const u = addUser(db, 'tia@gmail.com');
  // The campus list is checked even when linking (a team leader with no list would mean every campus).
  assert.equal((await s.api('PATCH', `/users/${u}`, { person_id: p, role: 'volunteer', checkin: true })).status, 400);
  assert.equal((await s.api('PATCH', `/users/${u}`, { person_id: p, role: 'volunteer', checkin: true, campus_ids: [1] })).status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(u).role, 'leader');
  assert.equal((await s.api('GET', '/users?q=tia')).data.users.find((x) => x.id === u).checkin, true);
  // A volunteer account can hold the switch too (it is only a switch; check-in itself still needs a campus list).
  const v = addUser(db, 'vic@gmail.com');
  assert.equal((await s.api('PATCH', `/users/${v}`, { checkin: true })).status, 400, 'a volunteer needs a campus list on a church with several campuses');
  assert.equal((await s.api('PATCH', `/users/${v}`, { checkin: true, campus_ids: [1] })).status, 200);
  assert.equal((await s.api('GET', '/users?q=vic')).data.users.find((x) => x.id === v).checkin, true);
  // Merge: the duplicate leads a team, the kept person's account is a volunteer: leader access follows.
  const keep = addPerson(db, 'Max', 'max@gmail.com');
  const dup = addPerson(db, 'Max', 'max.dup@gmail.com');
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, dup);
  const mu = addUser(db, 'max@gmail.com', 'volunteer', keep);
  assert.ok((await s.api('POST', `/people/${keep}/merge`, { duplicate_id: dup })).status < 300);
  assert.deepEqual({ ...db.prepare('SELECT role, role_auto FROM users WHERE id = ?').get(mu) }, { role: 'leader', role_auto: 1 });
});
