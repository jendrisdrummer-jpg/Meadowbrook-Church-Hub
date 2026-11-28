// Requests can't be sent for a service that has already happened, but recording who served on a
// past date still works. Runs on a fixed clock so it never depends on today's date.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
let server, base, db, personId, posId;
const cookies = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-pr-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago');");
  personId = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, email) VALUES ('Vic', 'Test', 1, 'vic@example.org')").run().lastInsertRowid);
  const id = db.prepare("INSERT INTO users (email, role, campus_ids) VALUES ('admin@mb.org', 'admin', NULL)").run().lastInsertRowid;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies.admin = v.split(';')[0]; } }, id);
  const team = (await api('POST', '/teams', { name: 'Past Team', campus_id: 1 })).data;
  posId = (await api('POST', `/teams/${team.id}/positions`, { name: 'Usher' })).data.id;
});
after(() => { mock.timers.reset(); server.close(); });

async function api(method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies.admin }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const service = async (day) => (await api('POST', '/services', { campus_id: 1, starts_at: `${day}T09:00` })).data;
const assign = (svc) => api('POST', `/services/${svc.id}/assignments`, { position_id: posId, person_id: personId });

test('sending a request for a past service is refused calmly, but recording who served still works', async () => {
  const past = await service('2027-02-14');
  const made = await assign(past);
  assert.ok(made.status < 300, 'assigning on a past date still works');
  const r = await api('POST', '/assignments/send', { service_ids: [past.id] });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'That service has already happened.');
  assert.equal(db.prepare('SELECT sent_at FROM assignments WHERE service_id = ?').get(past.id).sent_at, null, 'nothing was sent');
});

test('today and upcoming services can still be sent', async () => {
  const todays = await service('2027-02-21');
  const later = await service('2027-02-28');
  await assign(todays);
  await assign(later);
  const r = await api('POST', '/assignments/send', { service_ids: [todays.id, later.id] });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 2);
});

test('the campus’s own date decides: Saturday night in Chicago is still Saturday', async () => {
  const sat = await service('2027-02-20');
  await assign(sat);
  // 2027-02-21 05:30 UTC is still Saturday night in Chicago, so Saturday isn't past yet.
  mock.timers.setTime(Date.parse('2027-02-21T05:30:00Z'));
  try { assert.equal((await api('POST', '/assignments/send', { service_ids: [sat.id] })).status, 200); } finally { mock.timers.setTime(Date.parse(T0)); }
  const sat2 = await service('2027-02-19');
  await assign(sat2);
  assert.equal((await api('POST', '/assignments/send', { service_ids: [sat2.id] })).status, 400);
});
