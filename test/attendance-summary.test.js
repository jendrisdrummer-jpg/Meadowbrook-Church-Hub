// GET /attendance/summary: one attendance number per service, weekly totals, last year's same weeks.
// Every date is fixed (2024 and 2025), so nothing depends on today's date.
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
const S = {};
const P = [];

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-attsum-'));
  server = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago'), (2, 'South', 'S', 'America/Chicago');`);
  const service = (key, campus, startsAt) => { S[key] = Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, key, startsAt).lastInsertRowid); };
  service('A', 1, '2025-01-05T10:00'); service('B', 1, '2025-01-05T11:30'); service('C', 2, '2025-01-12T10:00');
  service('D', 1, '2024-01-07T10:00'); service('E', 2, '2024-01-07T10:00'); service('empty', 1, '2025-01-19T10:00');
  for (let i = 0; i < 6; i++) P.push(Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id) VALUES (?, ?, 1)').run(`P${i}`, 'Test').lastInsertRowid));
  const head = (key, area, n) => db.prepare('INSERT INTO headcounts (service_id, area, count) VALUES (?, ?, ?)').run(S[key], area, n);
  head('A', 'Auditorium', 60); head('A', 'Overflow', 40); head('C', 'Auditorium', 50); head('D', 'Auditorium', 80); head('E', 'Auditorium', 20);
  const mark = (key, p) => db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(S[key], P[p]);
  mark('A', 0); mark('A', 1); mark('A', 2); // marked at A too, but A has a headcount: headcount wins
  mark('B', 0); mark('B', 1); mark('B', 2); mark('B', 3);
  let n = 0;
  const kid = (key, p, day) => db.prepare("INSERT INTO checkins (id, campus_id, service_id, person_id, kind, day, checked_in_at) VALUES (?, 1, ?, ?, 'kid', ?, ?)").run(`k${n++}`, S[key], P[p], day, `${day}T16:00:00Z`);
  kid('A', 4, '2025-01-05'); kid('A', 5, '2025-01-05'); // two kids at A
  kid('B', 3, '2025-01-05'); // person 3 is marked at B and also a kid: counted once
  for (const [key, role, campuses] of [['leader', 'leader', null], ['north', 'admin', '[1]'], ['vol', 'volunteer', null]]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

const get = async (who, url) => {
  const res = await fetch(`${base}/api${url}`, { headers: { 'x-mb': '1', cookie: cookies[who] } });
  return { status: res.status, data: await res.json() };
};
const svc = (d, key) => d.services.find((x) => x.id === S[key]);

test('a headcount wins over roll call; without one the marked people count; kids are added', async () => {
  const { status, data } = await get('leader', '/attendance/summary?year=2025');
  assert.equal(status, 200);
  const a = svc(data, 'A');
  assert.deepEqual([a.attendance, a.source, a.headcount, a.marked, a.kids], [102, 'headcount', 100, 3, 2]);
  const b = svc(data, 'B');
  // 4 marked, one of them also checked in as a kid: 3 + 1 kid = 4
  assert.deepEqual([b.attendance, b.source, b.headcount, b.marked, b.kids], [4, 'roll', null, 3, 1]);
  assert.equal(svc(data, 'empty'), undefined, 'a service with nothing recorded is left out');
  assert.equal(b.time, '11:30');
  assert.equal(b.campus, 'North');
});

test('weeks start on Sunday, total all services that week, and line up with the same weeks a year earlier', async () => {
  const { data } = await get('leader', '/attendance/summary?year=2025');
  assert.equal(data.weeks[0].week, '2025-01-05');
  assert.equal(data.weeks[0].total, 106);
  assert.equal(data.weeks[0].prev_week, '2024-01-07');
  assert.equal(data.weeks[0].prev_total, 100);
  assert.equal(data.weeks[1].week, '2025-01-12');
  assert.equal(data.weeks[1].total, 50);
  assert.equal(data.weeks[1].prev_total, null);
  assert.equal(data.stats.highest.week, '2025-01-05');
  assert.equal(data.stats.highest.total, 106);
  assert.equal(data.stats.average, 78);
  assert.deepEqual(data.years, [2025, 2024]);
});

test('a service time filter keeps only that time', async () => {
  const { data } = await get('leader', '/attendance/summary?year=2025&service_time=11:30');
  assert.deepEqual(data.services.map((x) => x.id), [S.B]);
  assert.deepEqual(data.service_times, ['10:00', '11:30']);
  assert.equal((await get('leader', '/attendance/summary?year=2025&service_time=late')).status, 400);
});

test('a campus-limited account sees only its campus, in both years', async () => {
  const { status, data } = await get('north', '/attendance/summary?year=2025');
  assert.equal(status, 200);
  assert.ok(data.services.every((x) => x.campus_id === 1));
  assert.equal(data.weeks[0].prev_total, 80);
  assert.equal(data.weeks[1].total, null);
  assert.equal((await get('north', '/attendance/summary?year=2025&campus_id=2')).status, 403);
  assert.equal((await get('leader', '/attendance/summary?year=2025&campus_id=2')).data.weeks[1].total, 50);
});

test('a volunteer cannot read it', async () => {
  assert.equal((await get('vol', '/attendance/summary?year=2025')).status, 403);
});

test('a year with no data comes back empty, and the last-12-weeks view works', async () => {
  const none = await get('leader', '/attendance/summary?year=2019');
  assert.equal(none.status, 200);
  assert.equal(none.data.stats.average, null);
  assert.deepEqual(none.data.services, []);
  const recent = await get('leader', '/attendance/summary?weeks=12');
  assert.equal(recent.data.weeks.length, 12);
  assert.equal((await get('leader', '/attendance/summary?year=1800')).status, 400);
});
