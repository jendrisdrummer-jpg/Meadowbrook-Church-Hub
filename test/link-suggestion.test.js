// Link suggestions on Settings → Accounts: an unlinked account is matched to the one active person
// with the same email, shown only inside the admin's reach, and NOTHING is linked until an admin
// confirms (the existing PATCH). Sign-in never links. Own database; no dates matter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

process.env.MB_DEV_LOGIN = '1';
delete process.env.MB_ADMIN_EMAILS;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-suggest-'));
let db, server, base;
const cookies = {};

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: tmp }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago')");
  for (const [key, email, campuses, role] of [['admin', 'admin@mb.org', null, 'admin'], ['north', 'north-admin@mb.org', '[1]', 'admin'], ['staff', 'staff@mb.org', null, 'staff'], ['vol', 'vol@mb.org', null, 'volunteer']]) {
    const id = db.prepare("INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)").run(email, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const api = async (who, method, url, body) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[who] }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify(body) });
let n = 0;
const person = (extra = {}) => {
  const e = { first_name: 'Pat', last_name: `P${++n}`, email: `p${n}@example.com`, campus_id: null, household_role: 'adult', grade: null, birthdate: null, archived: 0, phone: '', ...extra };
  return Number(db.prepare('INSERT INTO people (first_name, last_name, email, campus_id, household_role, grade, birthdate, archived, phone) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(e.first_name, e.last_name, e.email, e.campus_id, e.household_role, e.grade, e.birthdate, e.archived, e.phone).lastInsertRowid);
};
const emailOf = (pid) => db.prepare('SELECT email FROM people WHERE id = ?').get(pid).email;
const account = (email, personId = null) => Number(db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run(email, 'volunteer', personId).lastInsertRowid);
const personOf = (uid) => db.prepare('SELECT person_id FROM users WHERE id = ?').get(uid).person_id;
const suggestion = async (who, uid) => (await api(who, 'GET', '/users')).data.unlinked.find((x) => x.id === uid)?.suggestion;

test('an unlinked account gets a suggestion for the one person with the same email (case and spaces ignored)', async () => {
  const p = person({ email: ' Mixed.Case@Example.com ', campus_id: 1 });
  const u = account('mixed.case@example.com');
  const s = await suggestion('admin', u);
  assert.deepEqual(s, { person_id: p, name: `Pat ${db.prepare('SELECT last_name FROM people WHERE id = ?').get(p).last_name}`, campus_short: 'N', note: '' });
  assert.equal(personOf(u), null, 'listing a suggestion links nothing');
});

test('no suggestion for a shared email, an archived person, a phone number or no match', async () => {
  person({ email: 'shared@example.com' }); person({ email: ' SHARED@example.com ' });
  const uShared = account('shared@example.com');
  const arch = person({ archived: 1 }); const uArch = account(emailOf(arch));
  person({ email: 'phone-owner@example.com', phone: '555-0100' }); const uPhone = account('555-0100@example.com');
  const uNone = account('nobody@example.com');
  for (const u of [uShared, uArch, uPhone, uNone]) assert.equal(await suggestion('admin', u), null);
});

test('children and people who already have an account are suggested with a note, never linked', async () => {
  const kid = person({ household_role: 'child' }); const uKid = account(emailOf(kid));
  const grade = person({ grade: '5' }); const uGrade = account(emailOf(grade));
  const minor = person({ birthdate: '2099-01-01' }); const uMinor = account(emailOf(minor));
  const taken = person({ email: 'taken@example.com' }); account('someone-else@example.com', taken);
  const uTaken = account('taken@example.com');
  assert.match((await suggestion('admin', uKid)).note, /listed as a child/);
  assert.match((await suggestion('admin', uGrade)).note, /child or under 18/);
  assert.match((await suggestion('admin', uMinor)).note, /child or under 18/);
  assert.equal((await suggestion('admin', uTaken)).note, 'already has an account');
  for (const u of [uKid, uGrade, uMinor, uTaken]) assert.equal(personOf(u), null);
});

test('signing in never links, by any route', async () => {
  const p = person(); const u = account(emailOf(p));
  assert.equal((await post('/auth/dev', { email: emailOf(p) })).status, 200);
  const e = emailOf(p);
  db.prepare("INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))").run(e, crypto.createHash('sha256').update(`${e}:123456`).digest('hex'));
  assert.equal((await post('/auth/code/verify', { email: e, code: '123456', password: 'a long enough password' })).status, 200);
  assert.equal(personOf(u), null, 'still unlinked after dev and code sign-in');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'user.link'").get().n, 0);
  assert.equal(Object.hasOwn((await api('admin', 'GET', '/users')).data, 'auto_linked'), false);
});

test('a campus-limited admin sees suggestions only for people in their campuses', async () => {
  const north = person({ campus_id: 1 }); const uN = account(emailOf(north));
  const south = person({ campus_id: 2 }); const uS = account(emailOf(south));
  const none = person({ campus_id: null }); const uNone = account(emailOf(none));
  assert.equal((await suggestion('north', uN)).person_id, north);
  assert.equal(await suggestion('north', uS), null, 'South person hidden from the North admin');
  assert.equal((await suggestion('north', uNone)).person_id, none, 'a person with no campus is in reach, as canCampus treats them');
  assert.equal((await suggestion('admin', uS)).person_id, south, 'the church-wide admin sees it');
});

test('linking a suggestion is the existing admin action: audited, confirmed by the admin, one account per person', async () => {
  const p = person({ campus_id: 1 }); const u = account(emailOf(p));
  const s = await suggestion('admin', u);
  assert.equal((await api('north', 'PATCH', `/users/${u}`, { person_id: s.person_id })).status, 200);
  assert.equal(personOf(u), p);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'user.link' AND detail LIKE ?").get(`%"person_id":${p}%`));
  const u2 = account(emailOf(p) + '.x'); // a second account for the same person is still refused
  assert.equal((await api('admin', 'PATCH', `/users/${u2}`, { person_id: p })).status, 409);
  // A South person is outside the North admin's reach: refused even with the id.
  const far = person({ campus_id: 2 }); const uf = account(emailOf(far));
  assert.equal((await api('north', 'PATCH', `/users/${uf}`, { person_id: far })).status, 403);
});

test('People sharing an email: groups, case and spaces, archived excluded, admin only, reach-limited', async () => {
  const north1 = person({ email: 'family@example.com', campus_id: 1 });
  const north2 = person({ email: '  FAMILY@Example.com ', campus_id: 1 });
  const gone = person({ email: 'family@example.com', campus_id: 1, archived: 1 }); // archived: not counted
  const lone = person({ email: 'alone@example.com', campus_id: 1 });
  const pairArchived = person({ email: 'pair@example.com' }); person({ email: 'pair@example.com', archived: 1 }); // one active only: not a group
  const mixedN = person({ email: 'mixed@example.com', campus_id: 1 }); const mixedS = person({ email: 'mixed@example.com', campus_id: 2 });
  const southA = person({ email: 'south@example.com', campus_id: 2 }); const southB = person({ email: 'south@example.com', campus_id: 2 });
  person({ email: '' }); person({ email: '  ' }); // blanks never group
  const full = (await api('admin', 'GET', '/users')).data.shared_emails;
  const byEmail = Object.fromEntries(full.map((g) => [g.email, g.people]));
  assert.deepEqual(byEmail['family@example.com'].map((p) => p.id).sort(), [north1, north2].sort());
  assert.ok(byEmail['family@example.com'].every((p) => p.campus === 'N' && p.name.startsWith('Pat')));
  assert.ok(lone && !byEmail['alone@example.com'] && !byEmail['pair@example.com'] && !byEmail['']);
  assert.ok(!byEmail['family@example.com'].some((p) => p.id === gone));
  assert.equal(byEmail['mixed@example.com'].length, 2);
  assert.ok(byEmail['south@example.com']);
  assert.ok(pairArchived && mixedN && mixedS && southA && southB);
  // a campus-limited admin sees only groups wholly inside their campuses
  const limited = Object.fromEntries((await api('north', 'GET', '/users')).data.shared_emails.map((g) => [g.email, g.people]));
  assert.ok(limited['family@example.com']);
  assert.ok(!limited['mixed@example.com'], 'a group reaching another campus is hidden');
  assert.ok(!limited['south@example.com']);
  // staff and below are refused
  for (const who of ['staff', 'vol']) assert.equal((await api(who, 'GET', '/users')).status, 403);
});
