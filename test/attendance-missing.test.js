// missingPeople: regulars who missed recent Sundays when attendance was taken. Every date is fixed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { missingPeople } from '../server/attendance-missing.js';

let db;
const P = {};
const TODAY = '2025-03-04'; // a Tuesday
const staff = { role: 'staff', campusIds: null, personId: null };

before(() => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago');`);
  const person = (key, campus, extra = '') => { P[key] = Number(db.prepare(`INSERT INTO people (first_name, last_name, campus_id${extra ? ', status' : ''}) VALUES (?, 'Test', ?${extra ? ', ?' : ''})`).run(key, campus, ...(extra ? [extra] : [])).lastInsertRowid); };
  person('steady', 1); person('gone2', 1); person('gone4', 1); person('rare', 1); person('south', 2); person('inactive', 1, 'inactive');
  // North Sundays Jan 5 – Mar 2 (9 weeks), all with attendance taken except Feb 23.
  const sundays = ['2025-01-05', '2025-01-12', '2025-01-19', '2025-01-26', '2025-02-02', '2025-02-09', '2025-02-16', '2025-02-23', '2025-03-02'];
  const svc = {};
  for (const d of sundays) svc[d] = Number(db.prepare("INSERT INTO services (campus_id, title, starts_at) VALUES (1, 'Sunday', ?)").run(`${d}T10:00`).lastInsertRowid);
  const southSvc = Number(db.prepare("INSERT INTO services (campus_id, title, starts_at) VALUES (2, 'Sunday', '2025-01-05T10:00')").run().lastInsertRowid);
  const mark = (key, day) => db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(svc[day], P[key]);
  for (const d of sundays) if (d !== '2025-02-23') mark('steady', d);
  for (const d of sundays.slice(0, 6)) mark('gone2', d); // last here Feb 9; missed Feb 16 and Mar 2 (Feb 23 not taken)
  for (const d of sundays.slice(0, 4)) mark('gone4', d); // last here Jan 26; missed Feb 2, 9, 16, Mar 2
  for (const d of sundays.slice(0, 4)) mark('inactive', d);
  mark('rare', '2025-01-05'); mark('rare', '2025-01-12'); // only twice: not a regular
  for (let i = 0; i < 3; i++) db.prepare('INSERT OR IGNORE INTO attendance (service_id, person_id) VALUES (?, ?)').run(southSvc, P.south);
});

const names = (list) => list.map((p) => p.first_name);

test('counts only Sundays attendance was taken, and only regulars who are not inactive', () => {
  const list = missingPeople(db, staff, { today: TODAY, minWeeks: 2 });
  assert.deepEqual(names(list), ['gone4', 'gone2']);
  assert.deepEqual(list.map((p) => p.missed), [4, 2], 'Feb 23 had no attendance taken, so it does not count');
});

test('the weeks threshold narrows the list', () => {
  assert.deepEqual(names(missingPeople(db, staff, { today: TODAY, minWeeks: 3 })), ['gone4']);
  assert.deepEqual(names(missingPeople(db, staff, { today: TODAY, minWeeks: 5 })), []);
});

test('campus limits apply, and a leader who is not staff sees only people on teams they lead', () => {
  assert.deepEqual(names(missingPeople(db, { role: 'staff', campusIds: [2], personId: null }, { today: TODAY })), []);
  const lead = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id) VALUES ('Lead', 'Er', 1)").run().lastInsertRowid);
  const team = Number(db.prepare("INSERT INTO teams (name, campus_id) VALUES ('Greeters', 1)").run().lastInsertRowid);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(team, lead);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 0)').run(team, P.gone2);
  const leader = { role: 'leader', campusIds: null, personId: lead };
  assert.deepEqual(names(missingPeople(db, leader, { today: TODAY })), ['gone2']);
  assert.deepEqual(names(missingPeople(db, { role: 'leader', campusIds: null, personId: null }, { today: TODAY })), []);
});
