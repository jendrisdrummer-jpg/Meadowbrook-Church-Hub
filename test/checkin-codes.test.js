// Pickup codes (child-safety V1, PR 5): a station letter (unique within a campus) plus four characters, made
// on the iPad so they work offline, avoiding every code already used today, with the server flagging any clash.
// Old four-character codes on open check-ins stay valid until check-out, and an older iPad keeps working.
// The clock is fixed before any session is made, so no test depends on today's date.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { ACTIONS } from '../server/checkin-events.js';
import { CHECKIN_APP_VERSION, CODE_CHARS, STATION_LETTERS, pickupCode, normalizeCode, showCode, securityCode } from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
let server, base, db;
const cookies = {};
const ids = {};
const tokens = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cc-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('north', 'staff', '[1]');
  make('leader', 'leader', '[1]');

  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const kid = (first, last, household) => Number(db.prepare(`INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, birthdate)
    VALUES (?, ?, 1, ?, 'child', '2020-01-01')`).run(first, last, household).lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhB = hh('Bell', 1);
  ids.abe = kid('Abe', 'Aldrin', ids.hhA); ids.abby = kid('Abby', 'Aldrin', ids.hhA); ids.bo = kid('Bo', 'Bell', ids.hhB);
  ids.cy = kid('Cy', 'Cruz', hh('Cruz', 1));
});
after(() => { mock.timers.reset(); server.close(); });

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const api = (role, method, url, body) => call(role ? { cookie: cookies[role] } : {}, method, url, body);
const asStation = (who, method, url, body, version = String(CHECKIN_APP_VERSION)) => call({ 'x-station': tokens[who], ...(version == null ? {} : { 'x-checkin-version': version }) }, method, url, body);
async function pair(name, campus, extra = {}, who = 'admin') {
  const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
  const res = await api(who, 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus, ...extra });
  if (res.status === 201) tokens[name] = (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
  return res;
}
const rec = (id, person, code, extra = {}) => ({ id, person_id: person, kind: 'kid', security_code: code, station: 'x', checked_in_at: '2027-02-21T15:00:00.000Z', ...extra });
const events = (action) => db.prepare('SELECT * FROM checkin_events WHERE action = ? ORDER BY id').all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const row = (id) => db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
const LETTER_RE = new RegExp(`^[${STATION_LETTERS}]$`);
const CODE_RE = new RegExp(`^[${STATION_LETTERS}][${CODE_CHARS}]{4}$`);

test('migration 44: the new columns, and stations paired before get letters in the order they were added', () => {
  assert.ok(SCHEMA_VERSION >= 44);
  assert.ok(ACTIONS.includes('checkin.code_clash'));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-m44-')), 'x.db');
  let d = openDb(file);
  // Put the database back to how it was after migration 43, with stations that have no letter yet.
  d.exec(`DROP TRIGGER checkins_collector_is_final; DROP TRIGGER checkins_checkout_is_final; DROP TRIGGER people_keep_hold_history; DROP TABLE checkin_holds; ALTER TABLE checkins DROP COLUMN checked_out_to_name; ALTER TABLE checkins DROP COLUMN checked_out_to_relationship; ALTER TABLE checkins DROP COLUMN checked_out_to_kind; ALTER TABLE checkins DROP COLUMN checked_out_id_type; ALTER TABLE checkins DROP COLUMN checked_out_held; DROP INDEX checkin_devices_letter; ALTER TABLE checkin_devices DROP COLUMN station_letter;
    ALTER TABLE people DROP COLUMN allergy_epi; ALTER TABLE people DROP COLUMN allergy_action; ALTER TABLE people DROP COLUMN medical_sorted_at;
    DROP TABLE person_care_notes; PRAGMA user_version = 43;`);
  d.exec(`INSERT INTO campuses (id, name, short_name) VALUES (1, 'North', 'N'), (2, 'South', 'S');`);
  const add = (name, campus) => Number(d.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash) VALUES (?, ?, ?)").run(name, campus, `h-${name}`).lastInsertRowid);
  const a = add('Lobby', 1); const s = add('South desk', 2); const b = add('Hall', 1); const c = add('Gym', 1);
  d.close();
  d = openDb(file);
  const letter = (id) => d.prepare('SELECT station_letter FROM checkin_devices WHERE id = ?').get(id).station_letter;
  assert.deepEqual([a, b, c, s].map(letter), ['A', 'B', 'C', 'A'], 'in the order added, starting again for each campus');
  assert.throws(() => d.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash, station_letter) VALUES ('Dup', 1, 'x', 'A')").run(), /UNIQUE/, 'a letter is unique within a campus');
  d.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash, station_letter) VALUES ('Other', 2, 'y', 'B')").run();
  d.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash) VALUES ('NoLetter 1', 1, 'n1')").run();
  d.prepare("INSERT INTO checkin_devices (name, campus_id, token_hash) VALUES ('NoLetter 2', 1, 'n2')").run(); // several with none are allowed
  const cols = Object.fromEntries(d.prepare('PRAGMA table_info(people)').all().map((x) => [x.name, x]));
  assert.ok(cols.allergy_epi && cols.allergy_action && cols.medical_sorted_at);
  assert.ok(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'person_care_notes'").get());
  d.close();
});

test('the code rules: a station letter plus four characters from the unambiguous alphabet, never one already used', () => {
  assert.ok(CHECKIN_APP_VERSION >= 3, 'this release changes the codes the iPad makes');
  for (const ch of '0O1ILSZ25') assert.ok(!CODE_CHARS.includes(ch), `${ch} looks like another character`);
  assert.ok([...STATION_LETTERS].every((l) => CODE_CHARS.includes(l) && /[A-Z]/.test(l)), 'station letters are letters from the same alphabet');
  for (let i = 0; i < 200; i++) assert.match(pickupCode({ letter: 'K' }), /^K[346789ABCDEFGHJKMNPQRTUVWXY]{4}$/);
  assert.match(securityCode(), /^[346789ABCDEFGHJKMNPQRTUVWXY]{4}$/, 'the four random characters on their own are unchanged');
  // With no letter (a signed-in browser, not a paired iPad) it picks a station-letter-shaped one; a bad letter is ignored.
  for (const letter of [undefined, null, '', '5', 'Z', 'KK', '0']) assert.match(pickupCode({ letter }), CODE_RE);
  // It skips a code already used today: force the first draws to repeat a taken code.
  const draws = [...'AAAA', ...'BBBB', ...'CCCC'].map((ch) => CODE_CHARS.indexOf(ch) / CODE_CHARS.length + 0.001);
  let n = 0;
  const random = () => draws[n++ % draws.length];
  assert.equal(pickupCode({ letter: 'K', taken: new Set(['KAAAA', 'KBBBB']), random }), 'KCCCC');
  assert.equal(normalizeCode(' k-7q3m '), 'K7Q3M');
  assert.equal(normalizeCode('k 7q3m'), 'K7Q3M');
  assert.equal(showCode('K7Q3M'), 'K 7Q3M');
  assert.equal(showCode('K7Q2'), 'K7Q2', 'an older four-character code is shown as it is');
});

test('pairing gives each station the first free letter at its campus; a replacement can take the old one', async () => {
  const lobby = await pair('Lobby', 1);
  assert.equal(lobby.status, 201);
  assert.equal(lobby.data.station_letter, 'A');
  assert.equal((await pair('Hall', 1)).data.station_letter, 'B');
  assert.equal((await pair('SouthDesk', 2)).data.station_letter, 'A', 'letters are per campus');
  // Asking for a letter: lower case is fine; one already taken is refused with a plain message.
  const taken = await pair('Gym', 1, { station_letter: 'b' });
  assert.equal(taken.status, 409);
  assert.match(taken.data.error, /already used by Hall/);
  for (const bad of ['5', 'Z', 'AB', '0', '!']) assert.equal((await pair('Bad', 1, { station_letter: bad })).status, 400, bad);
  assert.equal((await pair('Gym', 1, { station_letter: 'k' })).data.station_letter, 'K');
  // The iPad is told its letter; so is the list in the Hub.
  assert.equal((await asStation('Lobby', 'GET', '/checkin/station')).data.stationLetter, 'A');
  const list = (await api('admin', 'GET', '/checkin/devices')).data;
  assert.deepEqual(list.filter((d) => d.campus_id === 1).map((d) => [d.name, d.station_letter]).sort(), [['Gym', 'K'], ['Hall', 'B'], ['Lobby', 'A']]);
  // Replacing the Hall iPad: remove it, pair the new one with the same letter.
  assert.equal((await api('admin', 'DELETE', `/checkin/devices/${list.find((d) => d.name === 'Hall').id}`)).status, 200);
  assert.equal((await pair('Hall 2', 1, { station_letter: 'B' })).data.station_letter, 'B');
  // A letter is never given twice, even at the database (the next free one skips every letter in use).
  assert.equal((await pair('Next', 1)).data.station_letter, 'C');
  // A campus-limited staff member can only pair at their own campus.
  assert.equal((await pair('Nope', 2, {}, 'north')).status, 403);
  assert.equal((await pair('Mine', 1, {}, 'north')).status, 201);
  assert.equal((await api('leader', 'POST', '/checkin/devices', { code: 'AAAAAA', name: 'x', campus_id: 1 })).status, 403, 'a leader never pairs');
});

test('moving a station to another campus keeps its letter unless that campus already uses it', async () => {
  const dev = (name) => db.prepare('SELECT id, station_letter FROM checkin_devices WHERE name = ?').get(name);
  // Lobby is A at North; South already has SouthDesk as A, so Lobby gets the first free letter there.
  const lobby = dev('Lobby');
  assert.equal((await api('admin', 'PATCH', `/checkin/devices/${lobby.id}`, { campus_id: 2 })).status, 200);
  assert.equal(dev('Lobby').station_letter, 'B');
  // Gym is K at North and K is free at South, so it keeps K.
  assert.equal((await api('admin', 'PATCH', `/checkin/devices/${dev('Gym').id}`, { campus_id: 2 })).status, 200);
  assert.equal(dev('Gym').station_letter, 'K');
  // An edit that doesn't move it never changes the letter.
  assert.equal((await api('admin', 'PATCH', `/checkin/devices/${dev('Gym').id}`, { name: 'Gym 2' })).status, 200);
  assert.equal(dev('Gym 2').station_letter, 'K');
  const moved = events('device.update').filter((e) => e.d.station_letter);
  assert.ok(moved.length >= 1 && moved.some((e) => e.d.from_station_letter === 'A' && e.d.station_letter === 'B'), 'the new letter is in the record');
  // Put them back for the tests below.
  await api('admin', 'PATCH', `/checkin/devices/${lobby.id}`, { campus_id: 1 });
  await api('admin', 'PATCH', `/checkin/devices/${dev('Gym 2').id}`, { campus_id: 1, name: 'Gym' });
  assert.equal(dev('Lobby').station_letter, 'A');
});

test('a check-in without a code gets one in the new shape, from the station’s letter', async () => {
  const sent = await asStation('Lobby', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec('cd-new-0001', ids.abe, '')] });
  assert.equal(sent.status, 201);
  const code = row('cd-new-0001').security_code;
  assert.match(code, CODE_RE);
  assert.equal(code[0], 'A', 'Lobby is station A');
  // A browser signed in as staff has no station letter, so it gets a random one, still in the same shape.
  const hub = await api('admin', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec('cd-new-0002', ids.bo, '')] });
  assert.equal(hub.status, 201);
  assert.match(row('cd-new-0002').security_code, CODE_RE);
  // The codes an iPad sends are stored as given (capitals, no spaces), whatever their length.
  await asStation('Lobby', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec('cd-new-0003', ids.cy, 'a-7q 3m')] });
  assert.equal(row('cd-new-0003').security_code, 'A7Q3M');
});

test('two families with the same code open at one campus on one day are flagged; the same family, other days and other campuses are not', async () => {
  const before = events('checkin.code_clash').length;
  const lobby = (records) => asStation('Lobby', 'POST', '/checkin/checkins', { campus_id: 1, records });
  const hall = (records) => asStation('Hall 2', 'POST', '/checkin/checkins', { campus_id: 1, records });
  // The same code for brothers and sisters is how a family shares one tag: no flag.
  assert.equal((await lobby([rec('cd-a-000001', ids.abe, 'AK7Q3'), rec('cd-a-000002', ids.abby, 'AK7Q3')])).status, 201);
  assert.equal(events('checkin.code_clash').length, before);
  // A different family on another iPad gets the same code: both stay checked in, and the clash is written down.
  assert.equal((await hall([rec('cd-b-000001', ids.bo, 'AK7Q3')])).status, 201);
  const e = events('checkin.code_clash').slice(before);
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].checkin_id, e[0].person_id, e[0].household_id, e[0].security_code, e[0].campus_id], ['cd-b-000001', ids.bo, ids.hhB, 'AK7Q3', 1]);
  assert.deepEqual(e[0].d.open_checkin_ids.sort(), ['cd-a-000001', 'cd-a-000002']);
  assert.equal(e[0].d.legacy, false);
  assert.equal(e[0].device_name, 'Hall 2', 'it names the iPad that made the second code');
  assert.equal(row('cd-b-000001').security_code, 'AK7Q3', 'the tag is already printed, so the code is kept');
  // Re-sending the same batch writes nothing more.
  await hall([rec('cd-b-000001', ids.bo, 'AK7Q3')]);
  assert.equal(events('checkin.code_clash').length, before + 1);
  // The code still never releases two families together: the older check-out guard answers 409.
  const co = await asStation('Lobby', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'ak7q3' });
  assert.equal(co.status, 409);
  assert.equal(co.data.reason, 'code_two_families');
  // Not clashes: a code that is no longer open, one from another day, one at another campus.
  db.prepare("UPDATE checkins SET checked_out_at = ? WHERE id = 'cd-a-000001'").run('2027-02-21T15:10:00.000Z');
  db.prepare("UPDATE checkins SET checked_out_at = ? WHERE id = 'cd-a-000002'").run('2027-02-21T15:10:00.000Z');
  db.prepare("UPDATE checkins SET checked_out_at = ? WHERE id = 'cd-b-000001'").run('2027-02-21T15:10:00.000Z');
  const n = events('checkin.code_clash').length;
  await lobby([rec('cd-c-000001', ids.cy, 'AK7Q3')]); // the earlier ones left, so this is fine
  assert.equal(events('checkin.code_clash').length, n);
  await lobby([rec('cd-d-000001', ids.abe, 'AM8N4', { checked_in_at: '2027-02-14T15:00:00.000Z' })]);
  await hall([rec('cd-d-000002', ids.bo, 'AM8N4')]);
  assert.equal(events('checkin.code_clash').length, n, 'the same code a week apart is not a clash');
  await asStation('SouthDesk', 'POST', '/checkin/checkins', { campus_id: 2, records: [rec('cd-e-000001', ids.cy, 'AP9R6')] });
  assert.equal(events('checkin.code_clash').length, n);
});

test('an older four-character code on an open check-in stays valid until check-out, and is flagged like any other', async () => {
  const lobby = (records) => asStation('Lobby', 'POST', '/checkin/checkins', { campus_id: 1, records });
  // An iPad on the old app (no version header) sends a four-character code: accepted as it is.
  const old = await asStation('Hall 2', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec('cd-old-00001', ids.abby, 'K7Q2')] }, null);
  assert.equal(old.status, 201);
  assert.equal(row('cd-old-00001').security_code, 'K7Q2');
  const same = await asStation('Hall 2', 'POST', '/checkin/checkins', { campus_id: 1, records: [rec('cd-old-00002', ids.bo, 'K7Q2')] }, null);
  assert.equal(same.status, 201);
  const flag = events('checkin.code_clash').filter((e) => e.checkin_id === 'cd-old-00002');
  assert.equal(flag.length, 1);
  assert.equal(flag[0].d.legacy, true, 'a four-character clash says it is an old-style code');
  // A code open from before still checks out with the new app, typed any way. (Two families share it, so the guard answers.)
  assert.equal((await asStation('Lobby', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'k7q2' })).status, 409);
  db.prepare("UPDATE checkins SET checked_out_at = ? WHERE id = 'cd-old-00002'").run('2027-02-21T15:12:00.000Z');
  const out = await asStation('Lobby', 'POST', '/checkin/checkout', { campus_id: 1, security_code: ' k7-q2 ' });
  assert.equal(out.status, 200);
  assert.equal(out.data.checked_out, 1);
  assert.ok(row('cd-old-00001').checked_out_at);
  // A new code is found the same way: with spaces, a dash, any case.
  await lobby([rec('cd-new-5-0001', ids.abe, 'AQ3R4')]);
  assert.equal((await asStation('Lobby', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'a q3r4' })).data.checked_out, 1);
  assert.equal((await asStation('Lobby', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'AQ3R4' })).status, 404, 'checked out already');
  // The roster and the list of who is in still carry the old codes for an iPad that hasn't reopened.
  await lobby([rec('cd-old-00003', ids.cy, 'ZZ99')]);
  const active = (await asStation('Lobby', 'GET', '/checkin/active?campus_id=1', undefined, null)).data;
  assert.ok(active.some((c) => c.id === 'cd-old-00003' && c.security_code === 'ZZ99'));
});

test('an iPad on an older check-in still works, and a refusing switch gives it a clear message; codes it made stay valid', async () => {
  // Version 2 and no version at all: the roster still loads, with the Level 1 line folded into `allergies` so an old label still says EPI.
  db.prepare("UPDATE people SET allergies = 'peanuts', allergy_epi = 1, allergy_action = 'Use EpiPen, call 911' WHERE id = ?").run(ids.abe);
  for (const version of ['2', null]) {
    const roster = await asStation('Lobby', 'GET', '/checkin/roster?campus_id=1', undefined, version);
    assert.equal(roster.status, 200, `version ${version}`);
    const abe = roster.data.households.flatMap((h) => h.members).find((m) => m.id === ids.abe);
    assert.equal(abe.allergies, 'EPI: YES · peanuts · Use EpiPen, call 911');
  }
  const current = (await asStation('Lobby', 'GET', '/checkin/roster?campus_id=1')).data.households.flatMap((h) => h.members).find((m) => m.id === ids.abe);
  assert.deepEqual([current.allergies, current.allergy_epi, current.allergy_action], ['peanuts', 1, 'Use EpiPen, call 911']);
  // The admin's switch: the old iPad is told to reopen, and nothing it recorded is lost.
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 200);
  const refused = await asStation('Lobby', 'GET', '/checkin/roster?campus_id=1', undefined, '2');
  assert.equal(refused.status, 426);
  assert.equal(refused.data.reload, true);
  assert.match(refused.data.error, /older check-in/);
  assert.equal((await asStation('Lobby', 'GET', '/checkin/roster?campus_id=1', undefined, String(CHECKIN_APP_VERSION))).status, 200);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).status, 200);
  // The Stations page tells staff which iPads are on an older check-in (the version column).
  const list = (await api('admin', 'GET', '/checkin/devices')).data;
  assert.equal(list.find((d) => d.name === 'Lobby').app_version, String(CHECKIN_APP_VERSION));
});

test('a code made by the server avoids every code used at the campus today, including closed ones', () => {
  const taken = new Set(db.prepare('SELECT security_code FROM checkins WHERE campus_id = 1').all().map((x) => x.security_code));
  for (let i = 0; i < 50; i++) {
    const code = pickupCode({ letter: 'A', taken });
    assert.ok(!taken.has(code));
    taken.add(code);
  }
});
