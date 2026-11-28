// Fixes from the weekly audit: the email reply link's clock, re-adding an accepted volunteer, strict
// dates and times, finance amounts, friendly 400s, search wildcards, the merge note, phone numbers on
// "My info", dates away without a linked person, and service lengths. Every date here is fixed (or
// far in the future), and the reply-link clock is injected, so nothing depends on the day it runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { assignmentSig } from '../server/notify.js';
import { isDate, isDateTime, isTime } from '../server/http.js';

process.env.MB_DEV_LOGIN = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-audit-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 2030-01-15 18:00 UTC is noon in Chicago (UTC-6 in winter).
let clock = new Date('2030-01-15T18:00:00Z');
let db, server, base, team, pos;
const cookies = {};

const person = (first, last = 'Test', campus = 1) => Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, status) VALUES (?, ?, ?, 'member')").run(first, last, campus).lastInsertRowid);
const user = (key, role, { personId = null, finance = 0 } = {}) => {
  const id = Number(db.prepare('INSERT INTO users (email, role, person_id, finance) VALUES (?, ?, ?, ?)').run(`${key}@mb.test`, role, personId, finance).lastInsertRowid);
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  return id;
};
const api = async (who, method, url, body) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const service = (startsAt, extra = {}) => Number(db.prepare('INSERT INTO services (campus_id, starts_at, duration_min, title) VALUES (?, ?, 75, ?)').run(extra.campus ?? 1, startsAt, extra.title ?? '').lastInsertRowid);

before(async () => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO campuses (name, short_name, timezone) VALUES ('North Campus', 'North', 'America/Chicago')").run();
  team = Number(db.prepare("INSERT INTO teams (name) VALUES ('Ushers')").run().lastInsertRowid);
  pos = Number(db.prepare("INSERT INTO positions (team_id, name) VALUES (?, 'Door')").run(team).lastInsertRowid);
  user('admin', 'admin', { finance: 1 });
  const maya = person('Maya', 'Volunteer');
  user('maya', 'volunteer', { personId: maya });
  user('lost', 'volunteer');
  server = createApp({ db, uploadDir: tmp, now: () => clock }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the email reply link judges "past" on the campus clock, not UTC', async () => {
  const pat = person('Pat', 'Usher');
  const mk = (startsAt) => {
    const id = Number(db.prepare("INSERT INTO assignments (service_id, position_id, person_id, sent_at) VALUES (?, ?, ?, datetime('now'))").run(service(startsAt), pos, pat).lastInsertRowid);
    return `${id}/${assignmentSig(db, id, pat)}`;
  };
  const later = mk('2030-01-15T15:00'); // 3pm Chicago: three hours away, though 15:00 is before 18:00 UTC
  const earlier = mk('2030-01-15T11:00'); // 11am Chicago: already started
  const get = async (k) => (await fetch(`${base}/api/public/assignments/${k}`)).json();
  assert.equal((await get(later)).past, false);
  assert.equal((await get(earlier)).past, true);
  const reply = (k, status) => fetch(`${base}/api/public/assignments/${k}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify({ status }) });
  assert.equal((await reply(later, 'accepted')).status, 200);
  assert.equal((await reply(earlier, 'accepted')).status, 400);
  // Moving the clock past 3pm Chicago (21:00 UTC) makes the later service past too.
  clock = new Date('2030-01-15T21:30:00Z');
  assert.equal((await get(later)).past, true);
  clock = new Date('2030-01-15T18:00:00Z');
});

test('adding someone who already accepted keeps their yes; a declined person is asked again', async () => {
  const sid = service('2030-03-03T09:00');
  const p = person('Dana', 'Door');
  const add = (body = {}) => api('admin', 'POST', `/services/${sid}/assignments`, { position_id: pos, person_id: p, ...body });
  const status = () => db.prepare('SELECT status, responded_at, sent_at FROM assignments WHERE service_id = ? AND person_id = ?').get(sid, p);
  assert.equal((await add()).status, 201);
  assert.equal(status().status, 'pending');
  db.prepare("UPDATE assignments SET status = 'accepted', responded_at = '2030-01-01 10:00:00', sent_at = '2030-01-01 09:00:00' WHERE service_id = ? AND person_id = ?").run(sid, p);
  assert.equal((await add()).status, 201);
  assert.deepEqual({ ...status() }, { status: 'accepted', responded_at: '2030-01-01 10:00:00', sent_at: '2030-01-01 09:00:00' });
  // Declined, then added again: back to waiting for an answer.
  db.prepare("UPDATE assignments SET status = 'declined' WHERE service_id = ? AND person_id = ?").run(sid, p);
  assert.equal((await add()).status, 201);
  assert.equal(status().status, 'pending');
});

test('dates and times must be real', async () => {
  assert.equal(isDate('2030-02-28'), true);
  assert.equal(isDate('2028-02-29'), true);
  assert.equal(isDate('2030-02-29'), false);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-13-01'), false);
  assert.equal(isDate('2026-04-31'), false);
  assert.equal(isDate('2026-1-01'), false);
  assert.equal(isDateTime('2030-01-15T23:59'), true);
  assert.equal(isDateTime('2030-01-15T00:00'), true);
  assert.equal(isDateTime('2030-01-15T25:00'), false);
  assert.equal(isDateTime('2030-01-15T24:00'), false);
  assert.equal(isDateTime('2030-01-15T10:60'), false);
  assert.equal(isDateTime('2030-02-30T10:00'), false);
  assert.equal(isTime('09:30'), true);
  assert.equal(isTime('9:30'), false);
  assert.equal(isTime('25:00'), false);

  assert.equal((await api('admin', 'POST', '/services', { campus_id: 1, starts_at: '2030-02-30T09:00' })).status, 400);
  assert.equal((await api('admin', 'POST', '/services', { campus_id: 1, starts_at: '2030-02-20T25:00' })).status, 400);
  assert.equal((await api('admin', 'POST', '/services', { campus_id: 1, starts_at: '2030-02-20T09:00' })).status, 201);

  const tpl = (await api('admin', 'POST', '/templates', { name: 'Sunday' })).data;
  assert.equal((await api('admin', 'PATCH', `/templates/${tpl.id}`, { start_time: '25:00' })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/templates/${tpl.id}`, { start_time: '10:15' })).status, 200);
  assert.equal((await api('admin', 'POST', '/series', { campus_id: 1, starts_on: '2030-02-30', start_time: '09:00' })).status, 400);
  assert.equal((await api('admin', 'POST', '/series', { campus_id: 1, starts_on: '2030-02-20', start_time: '24:30' })).status, 400);
});

test('finance: amounts must be plain decimals under $1,000,000, and a missing batch is a 404', async () => {
  const fund = db.prepare('SELECT id FROM funds ORDER BY id LIMIT 1').get().id;
  const batch = (amount) => ({ given_on: '2030-01-06', gifts: [{ amount, fund_id: fund, method: 'cash' }] });
  const post = (amount) => api('admin', 'POST', '/finance/batches', batch(amount));
  for (const bad of ['1e3', '0x10', 'abc', '1,2,3e2', '12.5.1']) assert.equal((await post(bad)).status, 400, bad);
  const big = await post('1000000');
  assert.equal(big.status, 400);
  assert.match(big.data.error, /That amount looks too large\. Please check it\./);
  assert.equal((await post(1e9)).status, 400);
  assert.equal((await post('5000000.00')).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gift_batches').get().n, 0, 'nothing saved by the refused ones');

  const ok = await post('999,999.99');
  assert.equal(ok.status, 201);
  assert.equal(db.prepare('SELECT amount_cents FROM gifts WHERE batch_id = ?').get(ok.data.id).amount_cents, 99999999);
  const dollars = await post('$1,200.50');
  assert.equal(dollars.status, 201);
  assert.equal(db.prepare('SELECT amount_cents FROM gifts WHERE batch_id = ?').get(dollars.data.id).amount_cents, 120050);
  assert.equal((await post(25)).status, 201);
  // Editing a batch is held to the same rule.
  assert.equal((await api('admin', 'PUT', `/finance/batches/${ok.data.id}`, batch('1e3'))).status, 400);

  assert.equal((await api('admin', 'DELETE', '/finance/batches/99999')).status, 404);
  assert.equal((await api('admin', 'DELETE', `/finance/batches/${dollars.data.id}`)).status, 200);
  assert.equal((await api('admin', 'DELETE', `/finance/batches/${dollars.data.id}`)).status, 404);
});

test('an id that doesn’t exist is a plain 400, not a server error', async () => {
  const bad = await api('admin', 'POST', '/people', { first_name: 'Lee', campus_id: 9999 });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /pick a campus/i);
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'Lee', campus_id: 1 })).status, 201);
  assert.equal((await api('admin', 'POST', '/people', { first_name: 'Lou' })).status, 201); // no campus is still fine

  const sid = service('2030-04-07T09:00');
  const song = Number(db.prepare("INSERT INTO songs (title) VALUES ('Amazing Grace')").run().lastInsertRowid);
  const who = person('Sam', 'Speaker');
  for (const body of [{ kind: 'song', song_id: 99999 }, { kind: 'item', title: 'Message', person_id: 99999 }]) {
    const r = await api('admin', 'POST', `/services/${sid}/items`, body);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /wasn’t found/);
  }
  assert.equal((await api('admin', 'POST', `/services/${sid}/items`, { kind: 'song', song_id: song })).status, 201);
  const item = (await api('admin', 'POST', `/services/${sid}/items`, { kind: 'item', title: 'Message', person_id: who })).data.at(-1);
  assert.equal((await api('admin', 'PATCH', `/items/${item.id}`, { person_id: 99999 })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/items/${item.id}`, { person_id: null })).status, 200); // clearing is fine
});

test('searching for % or _ finds only names that contain them', async () => {
  person('Percy', '50%Off');
  person('Under', 'Score_Name');
  const found = async (q) => (await api('admin', 'GET', `/people?q=${encodeURIComponent(q)}`)).data;
  assert.equal((await found('%')).total, 1);
  assert.equal((await found('%')).rows[0].last_name, '50%Off');
  assert.equal((await found('_')).total, 1);
  assert.equal((await found('_')).rows[0].last_name, 'Score_Name');
  assert.equal((await found('\\')).total, 0);
  assert.equal((await found('zz%')).total, 0);
  assert.equal((await found('50%')).total, 1);
  assert.equal((await found('perc')).total, 1, 'ordinary searches still work');
  assert.ok((await found('')).total > 3, 'no search lists everyone');
});

test('the merge note shows a whole number', async () => {
  const keep = person('Keeper', 'Merge');
  const dup = person('Dupe', 'Merge');
  assert.equal((await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  const notes = db.prepare('SELECT notes FROM people WHERE id = ?').get(dup).notes;
  assert.equal(notes, `(merged into #${keep})`);
  assert.doesNotMatch(notes, /\.0/);
});

test('My info: a phone number needs 7 digits, or can be left empty', async () => {
  const set = (phone) => api('maya', 'PATCH', '/me/person', { phone });
  for (const phone of ['123', '12-34', 'call me', '(555) 12']) {
    const r = await set(phone);
    assert.equal(r.status, 400, phone);
    assert.equal(r.data.error, 'That phone number doesn’t look right. For example: 555-123-4567.');
  }
  assert.equal((await set('555-123-4567')).status, 200);
  assert.equal((await set('(555) 123 4567')).status, 200);
  assert.equal((await set('1234567')).status, 200);
  assert.equal((await set('+1 555 123 4567 ext 2')).status, 200);
  const mine = (await api('maya', 'GET', '/me/person')).data;
  assert.equal(mine.phone, '+1 555 123 4567 ext 2');
  assert.equal((await set('')).status, 200);
  assert.equal((await api('maya', 'GET', '/me/person')).data.phone, '');
});

test('dates away without a linked person ask the office to link the account', async () => {
  const r = await api('lost', 'POST', '/blockouts', { start_date: '2030-05-01', end_date: '2030-05-03' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /ask the office to link it/);
  assert.equal(r.data.error, (await api('lost', 'GET', '/me/person')).data.error, 'the same words the other My info routes use');
  const ok = await api('maya', 'POST', '/blockouts', { start_date: '2030-05-01', end_date: '2030-05-03' });
  assert.equal(ok.status, 201);
  assert.equal((await api('maya', 'POST', '/blockouts', { start_date: '2030-02-30' })).status, 400);
});

test('service lengths must be more than 0, and a series can’t end before it starts', async () => {
  for (const duration_min of [0, -5]) {
    assert.equal((await api('admin', 'POST', '/services', { campus_id: 1, starts_at: '2030-06-02T09:00', duration_min })).status, 400);
    assert.equal((await api('admin', 'POST', '/series', { campus_id: 1, starts_on: '2030-06-02', duration_min })).status, 400);
  }
  const sid = service('2030-06-09T09:00');
  assert.equal((await api('admin', 'PATCH', `/services/${sid}`, { duration_min: 0 })).status, 400);
  assert.equal((await api('admin', 'PATCH', `/services/${sid}`, { duration_min: 90 })).status, 200);
  assert.equal(db.prepare('SELECT duration_min FROM services WHERE id = ?').get(sid).duration_min, 90);

  const made = await api('admin', 'POST', '/series', { campus_id: 1, starts_on: '2030-06-02', start_time: '09:00', duration_min: 60 });
  assert.equal(made.status, 201);
  const typeId = made.data.id;
  // Far-future services of this series (the app only creates a few weeks ahead of the real today).
  for (const day of ['2030-06-02', '2030-06-09', '2030-06-16']) db.prepare('INSERT INTO services (campus_id, service_type_id, starts_at) VALUES (1, ?, ?)').run(typeId, `${day}T09:00`);
  const before = () => db.prepare('SELECT COUNT(*) n FROM services WHERE service_type_id = ?').get(typeId).n;
  const n = before();
  assert.ok(n > 0);
  assert.equal((await api('admin', 'PATCH', `/series/${typeId}`, { from_date: '2030-06-02', duration_min: 0 })).status, 400);
  const early = await api('admin', 'PATCH', `/series/${typeId}`, { from_date: '2030-06-02', ends_on: '2030-05-01' });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /last date must be after the first/);
  assert.equal(before(), n, 'no services were removed');
  assert.equal(db.prepare('SELECT ends_on FROM service_types WHERE id = ?').get(typeId).ends_on, null);

  // Plan items: no length (0) is normal, a negative one is a mistake.
  const item = (body) => api('admin', 'POST', `/services/${sid}/items`, { kind: 'item', title: 'Welcome', ...body });
  assert.equal((await item({ length_sec: -30 })).status, 400);
  assert.equal((await item({ length_sec: 0 })).status, 201);
  assert.equal((await item({ length_sec: 120 })).status, 201);
  assert.equal((await item({})).status, 201);
});
