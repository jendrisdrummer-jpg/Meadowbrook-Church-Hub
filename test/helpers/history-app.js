// A small app for the protected-history tests: two campuses, accounts at each level, and helpers to add
// services, people and serving records on fixed dates. Dates are far in the past (2020) or far ahead
// (2099) so nothing here depends on today's date; the database's own clock only has to tell those apart.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/index.js';
import { startSession } from '../../server/auth.js';

export const PAST = '2020-03-01T09:00';
export const PAST2 = '2020-03-08T09:00';
export const FUTURE = '2099-03-01T09:00';

export async function makeApp() {
  const db = openDb(':memory:');
  const cookies = {};
  const ids = {};
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago')`);
  const server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hist-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // name 'First Last' links the account to a person with that name (an account's name comes from its person).
  const make = (key, role, campuses = null, name = null) => {
    let personId = null;
    if (name) {
      const [first, ...rest] = name.split(' ');
      personId = Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id) VALUES (?, ?, 1)').run(first, rest.join(' ')).lastInsertRowid);
    }
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId).lastInsertRowid);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = id;
    return id;
  };
  // who: an account key, or { station: token } for a paired iPad, or null for nobody.
  const call = async (who, method, url, body, headers = {}) => {
    const auth = who && typeof who === 'object' ? { 'x-station': who.station, 'x-checkin-version': '1' } : who ? { cookie: cookies[who] } : {};
    const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...auth, ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  const add = {
    household: (name, campus = 1) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid),
    person: (first, last, household = null, role = 'adult') => Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, birthdate) VALUES (?, ?, 1, ?, ?, ?)')
      .run(first, last, household, role, role === 'child' ? '2020-01-01' : null).lastInsertRowid),
    team: (name = 'Team', campus = 1) => Number(db.prepare('INSERT INTO teams (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid),
    position: (team, name = 'Pos') => Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(team, name).lastInsertRowid),
    service: (startsAt, campus = 1) => Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (?, ?, ?)').run(campus, 'Service', startsAt).lastInsertRowid),
    assignment: (service, position, person, status = 'accepted', sent = true) => Number(db.prepare(`INSERT INTO assignments (service_id, position_id, person_id, status, sent_at) VALUES (?, ?, ?, ?, ${sent ? "datetime('now')" : 'NULL'})`)
      .run(service, position, person, status).lastInsertRowid),
    checkin: (id, person, { service = null, campus = 1, day = '2020-03-01' } = {}) => db.prepare("INSERT INTO checkins (id, campus_id, service_id, person_id, kind, security_code, day, checked_in_at) VALUES (?, ?, ?, ?, 'kid', 'AB12', ?, ?)")
      .run(id, campus, service, person, day, `${day}T15:00:00.000Z`),
  };
  // Pairs an iPad at a campus and returns its token.
  const pair = async (name, campus = 1) => {
    const p = (await call(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
    const made = await call('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus });
    if (made.status !== 201) throw new Error(`pairing failed: ${made.status}`);
    return (await call(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
  };
  return { db, ids, cookies, call, add, make, pair, close: () => server.close() };
}
