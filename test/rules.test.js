import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../server/db.js';
import { userForEmail } from '../server/auth.js';
import { roomFor, ageMonths, securityCode } from '../public/js/checkin-rules.js';
import { parseDate } from '../server/routes/people.js';
import { parseCsv } from '../server/csv.js';

test('a stranger cannot claim a new install as admin, but can join as a volunteer', () => {
  const db = openDb(':memory:');
  setSetting(db, 'workspace_domain', 'meadowbrook.church');
  assert.equal(userForEmail(db, 'someone@gmail.com', { first_name: 'Sam' }).role, 'volunteer');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n, 0);
  assert.equal(userForEmail(db, 'helper@meadowbrook.church', { first_name: 'Hal' }).role, 'volunteer');
});

test('new people who sign themselves up are added to People, flagged as new', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (email, role) VALUES ('admin@x.org', 'admin')").run();
  // Without a name we ask for one first.
  assert.deepEqual(userForEmail(db, 'new@gmail.com'), { needsName: true });
  const u = userForEmail(db, 'New@gmail.com', { first_name: 'Nia', last_name: 'New' });
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(u.person_id);
  assert.deepEqual([p.first_name, p.last_name, p.email, Boolean(p.signed_up_at)], ['Nia', 'New', 'new@gmail.com', true]);
  // Signing in again finds the same account and person.
  assert.equal(userForEmail(db, 'new@gmail.com').id, u.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, 1);
});

test('sign-in policies', () => {
  const fresh = (policy) => {
    const db = openDb(':memory:');
    setSetting(db, 'workspace_domain', 'meadowbrook.church');
    setSetting(db, 'sign_in_policy', policy);
    db.prepare("INSERT INTO users (email, role) VALUES ('admin@meadowbrook.church', 'admin')").run();
    db.prepare("INSERT INTO people (first_name, email) VALUES ('Kim', 'kim@gmail.com')").run();
    return db;
  };
  const joins = (policy, email) => { const u = userForEmail(fresh(policy), email, { first_name: 'Pat' }); return Boolean(u && !u.needsName); };
  assert.deepEqual(['anyone', 'directory', 'domain', 'invited'].map((p) => joins(p, 'stranger@gmail.com')), [true, false, false, false]);
  assert.deepEqual(['anyone', 'directory', 'domain', 'invited'].map((p) => joins(p, 'kim@gmail.com')), [true, true, false, false]);
  assert.deepEqual(['anyone', 'directory', 'domain', 'invited'].map((p) => joins(p, 'staff@meadowbrook.church')), [true, true, true, false]);
  // A directory match links the account to that person.
  const db = fresh('directory');
  assert.ok(userForEmail(db, 'KIM@gmail.com').person_id);
});

test('rooms by grade first, then age', () => {
  const rooms = [
    { id: 1, min_age_months: 0, max_age_months: 23 },
    { id: 2, min_age_months: 24, max_age_months: 71 },
    { id: 3, min_grade: 0, max_grade: 2, min_age_months: 72, max_age_months: 95 },
  ];
  assert.equal(ageMonths('2024-03-15', '2026-03-14'), 23);
  assert.equal(roomFor({ birthdate: '2024-03-15' }, rooms, '2026-03-14').id, 1);
  assert.equal(roomFor({ birthdate: '2024-03-15' }, rooms, '2026-03-15').id, 2);
  assert.equal(roomFor({ birthdate: '2021-01-01', grade: 0 }, rooms, '2026-10-01').id, 3);
  assert.equal(roomFor({ birthdate: null }, rooms, '2026-10-01'), null);
  assert.match(securityCode(), /^[346789ABCDEFGHJKMNPQRTUVWXY]{4}$/);
});

test('import helpers', () => {
  assert.equal(parseDate('3/9/2014'), '2014-03-09');
  assert.equal(parseDate('2014-3-9'), '2014-03-09');
  assert.equal(parseDate('13/45/2014'), null);
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
});
