// The check-out guard (child-safety V1, PR 2): a live release may only be one family's children (409
// otherwise), a release that already happened offline is always recorded at its real time, the server
// records who released, and nothing the guard writes holds medical text or a phone number.
// The clock is fixed (Date only) before any session is made, so no test depends on today's date.
import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { ACTIONS } from '../server/checkin-events.js';
import { CHECKIN_APP_VERSION, groupFamilies, upgradeOutbox, newRelease, labelName, labelText, tagInitials } from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
const CANARY = 'CANARY-9Z';
const PHONE = '555-0142';
let server, base, db, tokens, stationIds;
const cookies = {};
const ids = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-co-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('staff', 'staff', null);
  make('north', 'staff', '[1]');
  make('volunteer', 'volunteer', null);
  make('leader', 'leader', '[1]'); // not on the check-in list

  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const person = (first, last, household, role, extra = {}) => Number(db.prepare(`INSERT INTO people
    (first_name, last_name, campus_id, household_id, household_role, birthdate, allergies, medical_notes, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(first, last, extra.campus ?? 1, household, role, role === 'child' ? '2020-01-01' : null, extra.allergies ?? '', extra.medical ?? '', extra.phone ?? '').lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhB = hh('Bell', 1); ids.hhC = hh('Cruz', 2);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult', { phone: PHONE });
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child', { allergies: `${CANARY} peanuts`, medical: `${CANARY} asthma` });
  ids.abby = person('Abby', 'Aldrin', ids.hhA, 'child', { medical: `${CANARY} inhaler` });
  ids.bo = person('Bo', 'Bell', ids.hhB, 'child');
  ids.cy = person('Cy', 'Cruz', ids.hhC, 'child', { campus: 2 });
  ids.nan = person('Nan', 'Loose', null, 'child'); // children with no family on file
  ids.ned = person('Ned', 'Loose', null, 'child');

  tokens = {};
  stationIds = {};
  for (const [name, campus] of [['Lobby', 1], ['Hall', 1], ['SouthDesk', 2]]) {
    const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
    assert.equal((await api('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus })).status, 201);
    tokens[name] = (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
    stationIds[name] = db.prepare('SELECT id FROM checkin_devices WHERE name = ?').get(name).id;
  }
});
after(() => { mock.timers.reset(); server.close(); });
afterEach(() => noPrivateText());

function noPrivateText() {
  const blob = JSON.stringify([db.prepare('SELECT * FROM checkin_events').all(), db.prepare('SELECT * FROM audit_log').all()]);
  assert.ok(!blob.includes(CANARY), 'medical text leaked into the record');
  assert.ok(!blob.includes(PHONE), 'a phone number leaked into the record');
}

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const api = (role, method, url, body) => call(role ? { cookie: cookies[role] } : {}, method, url, body);
const asStation = (method, url, body, who = 'Lobby', version = String(CHECKIN_APP_VERSION)) => call({ 'x-station': tokens[who], ...(version == null ? {} : { 'x-checkin-version': version }) }, method, url, body);
const events = (action, where = '') => db.prepare(`SELECT * FROM checkin_events WHERE action = ? ${where} ORDER BY id`).all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const rec = (id, person, code, extra = {}) => ({ id, person_id: person, kind: 'kid', security_code: code, station: 'Lobby', checked_in_at: '2027-02-21T15:00:00.000Z', ...extra });
const checkIn = (records) => asStation('POST', '/checkin/checkins', { campus_id: 1, records });
const row = (id) => db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
const out = (body, who = 'Lobby') => asStation('POST', '/checkin/checkout', { campus_id: 1, ...body }, who);
const openCount = (...list) => list.filter((id) => row(id).checked_out_at == null).length;

test('schema and constants: migration 41 columns, the new event kind, and a raised app version', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 41);
  const cols = db.prepare('PRAGMA table_info(checkins)').all();
  const by = Object.fromEntries(cols.map((c) => [c.name, c]));
  for (const k of ['checked_out_device_id', 'checked_out_user_id', 'client_checked_out_at']) assert.ok(by[k], k);
  const fks = db.prepare('PRAGMA foreign_key_list(checkins)').all().map((f) => f.from);
  assert.ok(!fks.includes('checked_out_device_id') && !fks.includes('checked_out_user_id'), 'plain ids, so they outlive the iPad or account');
  assert.ok(ACTIONS.includes('checkout.refused'));
  assert.ok(CHECKIN_APP_VERSION >= 2, 'this release changes how the iPad releases children');
});

test('request: one family leaves; the server records the iPad, the time and the iPad’s own name, not the claimed text', async () => {
  assert.equal((await checkIn([rec('co-abe-0001', ids.abe, 'AA11'), rec('co-abby-001', ids.abby, 'AA11'), rec('co-bo-00001', ids.bo, 'BB22')])).status, 201);
  const r = await out({ mode: 'request', household_id: ids.hhA, ids: ['co-abe-0001'], by: 'Not The Station' });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 1);
  const c = row('co-abe-0001');
  assert.deepEqual([c.checked_out_at, c.checked_out_by, c.checked_out_device_id, c.checked_out_user_id, c.client_checked_out_at], [new Date(T0).toISOString(), 'Lobby', stationIds.Lobby, null, null]);
  assert.equal(openCount('co-abby-001', 'co-bo-00001'), 2, 'only the ticked child left');
  const e = events('checkout').find((x) => x.checkin_id === 'co-abe-0001');
  assert.deepEqual([e.device_id, e.user_id, e.household_id, e.d], [stationIds.Lobby, null, ids.hhA, { path: 'ids', mode: 'request', by_claimed: 'Not The Station' }]);
});

test('request: children of two families are refused with 409, nothing is released, and the refusal is recorded with who asked', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM checkin_events WHERE action = ?').get('checkout').n;
  const r = await out({ mode: 'request', household_id: ids.hhA, ids: ['co-abby-001', 'co-bo-00001'] });
  assert.equal(r.status, 409);
  assert.equal(r.data.reason, 'two_families');
  assert.match(r.data.error, /more than one family/);
  assert.deepEqual(r.data.families.map((f) => [f.household_id, f.name, f.check_in_ids]), [[ids.hhA, 'Aldrin', ['co-abby-001']], [ids.hhB, 'Bell', ['co-bo-00001']]]);
  assert.equal(openCount('co-abby-001', 'co-bo-00001'), 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_events WHERE action = ?').get('checkout').n, before);
  const ev = events('checkout.refused');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].device_id, ev[0].user_id, ev[0].campus_id, ev[0].day], [stationIds.Lobby, null, 1, '2027-02-21']);
  assert.deepEqual([ev[0].d.reason, ev[0].d.mode, ev[0].d.family_count, ev[0].d.count], ['two_families', 'request', 2, 2]);
  assert.deepEqual(ev[0].d.checkin_ids.sort(), ['co-abby-001', 'co-bo-00001']);
  const a = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'checkin.checkout.refused'").get();
  assert.equal(JSON.parse(a.detail).device_name, 'Lobby');
  assert.equal(JSON.parse(a.detail).device_id, stationIds.Lobby);
});

test('request: the family named must be the children’s family; an empty request is refused; a bad mode is refused', async () => {
  const wrong = await out({ mode: 'request', household_id: ids.hhB, ids: ['co-abby-001'] });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.data.reason, 'household_mismatch');
  assert.match(wrong.data.error, /same family/);
  assert.equal(openCount('co-abby-001'), 1);
  assert.equal((await out({ mode: 'request', household_id: ids.hhA, ids: [] })).status, 400);
  assert.equal((await out({ mode: 'everyone', ids: ['co-abby-001'] })).status, 400);
  assert.equal((await out({ mode: 'request', security_code: 'AA11' })).status, 400, 'a v2 request names children, not a code');
  assert.equal((await out({ mode: 'request', household_id: 'abc', ids: ['co-abby-001'] })).status, 400);
  // The family left out is fine (the server works it out from the children), and the right family is fine.
  assert.equal((await out({ mode: 'request', ids: ['co-abby-001'] })).data.checked_out, 1);
});

test('a child with no family counts as a family of their own', async () => {
  assert.equal((await checkIn([rec('co-nan-00001', ids.nan, 'LL33'), rec('co-ned-00001', ids.ned, 'LL33')])).status, 201);
  const two = await out({ mode: 'request', ids: ['co-nan-00001', 'co-ned-00001'] });
  assert.equal(two.status, 409);
  assert.deepEqual(two.data.families.map((f) => f.household_id), [null, null]);
  assert.equal(openCount('co-nan-00001', 'co-ned-00001'), 2);
  assert.equal((await out({ mode: 'request', ids: ['co-nan-00001'] })).status, 200);
  assert.equal((await out({ mode: 'request', household_id: ids.hhA, ids: ['co-ned-00001'] })).status, 409, 'and cannot be claimed for a family they are not in');
  assert.equal((await out({ mode: 'request', ids: ['co-ned-00001'] })).status, 200);
});

test('by code: a code on two families’ children is refused with both listed; one family is released as before', async () => {
  // Two iPads made the same code (the very clash the code guard exists for).
  assert.equal((await checkIn([rec('co-abe-0002', ids.abe, 'DD44'), rec('co-bo-00002', ids.bo, 'DD44')])).status, 201);
  const r = await out({ security_code: 'dd44', by: 'Lobby' });
  assert.equal(r.status, 409);
  assert.equal(r.data.reason, 'code_two_families');
  assert.deepEqual(r.data.families.map((f) => f.household_id).sort(), [ids.hhA, ids.hhB].sort());
  assert.equal(openCount('co-abe-0002', 'co-bo-00002'), 2);
  const ev = events('checkout.refused').at(-1);
  assert.deepEqual([ev.d.reason, ev.d.path, 'mode' in ev.d, ev.security_code], ['code_two_families', 'code', false, 'DD44']);
  // Once one family has left, the code finds only the other.
  assert.equal((await out({ mode: 'request', household_id: ids.hhA, ids: ['co-abe-0002'] })).status, 200);
  assert.equal((await out({ security_code: 'DD44' })).data.checked_out, 1);
  assert.equal(openCount('co-bo-00002'), 0);
});

test('the older id-list shape across two families is still accepted, recorded as mixed, and flagged', async () => {
  assert.equal((await checkIn([rec('co-abe-0003', ids.abe, 'EE55'), rec('co-bo-00003', ids.bo, 'EE56')])).status, 201);
  const r = await out({ ids: ['co-abe-0003', 'co-bo-00003'], by: 'A parent' });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 2);
  const m = events('checkout.mixed').at(-1);
  assert.deepEqual([m.d.path, 'mode' in m.d, m.d.household_count], ['ids', false, 2]);
  assert.equal(row('co-abe-0003').checked_out_by, 'Lobby');
  const flag = db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.checkout.mixed' ORDER BY id DESC").get();
  assert.equal(JSON.parse(flag.detail).mode, 'legacy');
});

test('report: an offline release is never refused, keeps its real time, and a mix of families is recorded and flagged', async () => {
  assert.equal((await checkIn([rec('co-abe-0004', ids.abe, 'FF66', { checked_in_at: '2027-02-21T15:05:00.000Z' }), rec('co-bo-00004', ids.bo, 'GG77', { checked_in_at: '2027-02-21T15:06:00.000Z' })])).status, 201);
  const at = '2027-02-21T15:20:00.000Z';
  const r = await out({ mode: 'report', ids: ['co-abe-0004', 'co-bo-00004'], at });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 2);
  for (const id of ['co-abe-0004', 'co-bo-00004']) {
    const c = row(id);
    assert.deepEqual([c.checked_out_at, c.client_checked_out_at, c.checked_out_by, c.checked_out_device_id], [at, at, 'Lobby', stationIds.Lobby]);
  }
  const evs = events('checkout').filter((e) => e.checkin_id === 'co-abe-0004' || e.checkin_id === 'co-bo-00004');
  assert.equal(evs.length, 2);
  for (const e of evs) { assert.equal(e.client_at, at); assert.equal(e.at, new Date(T0).toISOString()); assert.equal(e.d.mode, 'report'); }
  const m = events('checkout.mixed').at(-1);
  assert.deepEqual([m.d.mode, m.d.count, m.d.household_count], ['report', 2, 2]);
  assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.checkout.mixed' ORDER BY id DESC").get().detail).mode, 'report');
  // The same report sent again (a lost answer): recorded as repeats, nothing refused, no second alert.
  const mixedBefore = events('checkout.mixed').length;
  const again = await out({ mode: 'report', ids: ['co-abe-0004', 'co-bo-00004'], at });
  assert.equal(again.status, 200);
  assert.equal(again.data.checked_out, 0);
  assert.equal(events('checkout.repeat').filter((e) => e.d.mode === 'report').length, 2);
  assert.equal(events('checkout.mixed').length, mixedBefore);
  assert.equal(row('co-abe-0004').checked_out_at, at, 'the first time stands');
});

test('report: a time from the future, from before the check-in, or no time at all is kept sensible', async () => {
  assert.equal((await checkIn([rec('co-abe-0005', ids.abe, 'HH11'), rec('co-abby-005', ids.abby, 'HH11'), rec('co-bo-00005', ids.bo, 'HH12')])).status, 201);
  const now = new Date(T0).toISOString();
  await out({ mode: 'report', ids: ['co-abe-0005'], at: '2027-02-21T23:00:00.000Z' }); // an iPad clock running ahead
  assert.equal(row('co-abe-0005').checked_out_at, now);
  assert.equal(row('co-abe-0005').client_checked_out_at, '2027-02-21T23:00:00.000Z', 'what it said is kept as said');
  assert.equal(events('checkout').find((e) => e.checkin_id === 'co-abe-0005').d.time_adjusted, true);
  await out({ mode: 'report', ids: ['co-abby-005'], at: '2027-02-20T08:00:00.000Z' }); // before they were even checked in
  assert.equal(row('co-abby-005').checked_out_at, '2027-02-21T15:00:00.000Z');
  await out({ mode: 'report', ids: ['co-bo-00005'], at: 'last tuesday' }); // not a time
  assert.deepEqual([row('co-bo-00005').checked_out_at, row('co-bo-00005').client_checked_out_at], [now, null]);
  // A report with nothing in it is not an error, so a stuck entry can't block an outbox.
  assert.deepEqual((await out({ mode: 'report', ids: [] })).data, { checked_out: 0 });
});

test('a release by a signed-in account records the account, never the claimed name', async () => {
  assert.equal((await checkIn([rec('co-abe-0006', ids.abe, 'JJ11'), rec('co-bo-00006', ids.bo, 'JJ12'), rec('co-abby-006', ids.abby, 'JJ11')])).status, 201);
  const r = await api('staff', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: ['co-abe-0006'], by: 'Someone Else' });
  assert.equal(r.status, 200);
  const c = row('co-abe-0006');
  const e = events('checkout').find((x) => x.checkin_id === 'co-abe-0006');
  assert.ok(e.user_name.length > 0 && e.user_name !== 'Someone Else');
  assert.deepEqual([c.checked_out_by, c.checked_out_user_id, c.checked_out_device_id], [e.user_name, ids.staff, null]);
  assert.deepEqual([e.user_id, e.device_id], [ids.staff, null]);
  const refused = await api('staff', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', ids: ['co-bo-00006', 'co-abby-006'] });
  assert.equal(refused.status, 409);
  assert.equal(events('checkout.refused').at(-1).user_id, ids.staff);
});

test('who may release: signed out, volunteers and unlisted leaders are refused; campuses are respected', async () => {
  const body = { campus_id: 1, mode: 'request', household_id: ids.hhB, ids: ['co-bo-00006'] };
  assert.equal((await api(null, 'POST', '/checkin/checkout', body)).status, 401);
  assert.equal((await api('volunteer', 'POST', '/checkin/checkout', body)).status, 403);
  assert.equal((await api('leader', 'POST', '/checkin/checkout', body)).status, 403);
  assert.equal((await api('north', 'POST', '/checkin/checkout', { ...body, campus_id: 2 })).status, 403);
  assert.equal(openCount('co-bo-00006'), 1);
  // A South child's check-in id sent to a North station is simply not found there.
  db.prepare(`INSERT INTO checkins (id, campus_id, person_id, kind, security_code, station, day, checked_in_at) VALUES ('co-cy-00001', 2, ?, 'kid', 'SS99', 'Desk', '2027-02-21', '2027-02-21T15:00:00.000Z')`).run(ids.cy);
  const r = await out({ mode: 'request', ids: ['co-cy-00001'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 0);
  assert.equal(row('co-cy-00001').checked_out_at, null);
  assert.equal((await out({ mode: 'request', ids: ['co-cy-00001'] }, 'SouthDesk')).status, 403, 'a North request for a campus other than the iPad’s own');
});

test('old iPads: with the switch on, a version-1 iPad is turned away before the guard and loses nothing', async () => {
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 200);
  try {
    const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'report', ids: ['co-bo-00006'], at: T0 }, 'Lobby', '1');
    assert.equal(r.status, 426);
    assert.equal(openCount('co-bo-00006'), 1);
  } finally { assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).status, 200); }
});

test('refusals cannot flood the record: a few rows a day per iPad, and the guard still refuses', async () => {
  assert.equal((await checkIn([rec('co-abe-0007', ids.abe, 'KK11'), rec('co-bo-00007', ids.bo, 'KK12')])).status, 201);
  const before = events('checkout.refused', `AND device_id = ${stationIds.Hall}`).length;
  for (let i = 0; i < 25; i++) assert.equal((await out({ mode: 'request', ids: ['co-abe-0007', 'co-bo-00007'] }, 'Hall')).status, 409);
  assert.equal(events('checkout.refused', `AND device_id = ${stationIds.Hall}`).length - before, 20);
  assert.equal(openCount('co-abe-0007', 'co-bo-00007'), 2);
  // The next day the count starts again.
  mock.timers.setTime(Date.parse('2027-02-22T15:30:00Z'));
  try { assert.equal((await out({ mode: 'request', ids: ['co-abe-0007', 'co-bo-00007'] }, 'Hall')).status, 409); } finally { mock.timers.setTime(Date.parse(T0)); }
  assert.equal(events('checkout.refused', `AND device_id = ${stationIds.Hall}`).length - before, 21);
});

test('the list of who is checked in does not hand the iPad the ids of who released', async () => {
  const active = await asStation('GET', '/checkin/active?campus_id=1');
  assert.equal(active.status, 200);
  const abe = active.data.find((x) => x.id === 'co-abe-0001');
  assert.equal(abe.checked_out_by, 'Lobby');
  for (const x of active.data) for (const k of ['checked_out_device_id', 'checked_out_user_id', 'client_checked_out_at']) assert.ok(!(k in x), k);
});

test('nothing the guard wrote holds medical text or a phone number, and 409 bodies hold none either', async () => {
  const r = await out({ mode: 'request', ids: ['co-abe-0007', 'co-bo-00007'] }, 'Lobby');
  assert.equal(r.status, 409);
  assert.ok(!JSON.stringify(r.data).includes(CANARY) && !JSON.stringify(r.data).includes(PHONE));
  noPrivateText();
  assert.ok(db.prepare("SELECT COUNT(*) n FROM checkin_events WHERE action LIKE 'checkout%'").get().n > 20);
});

// ---------------------------------------------------------------- the shared rules the iPad uses
test('rules: families, with a child who has no family on their own', () => {
  const g = groupFamilies([{ id: 'a', household_id: 1, person_id: 10 }, { id: 'b', household_id: 2, person_id: 11 }, { id: 'c', household_id: 1, person_id: 12 }, { id: 'd', household_id: null, person_id: 13 }, { id: 'e', household_id: null, person_id: 14 }]);
  assert.deepEqual(g.map((f) => f.items.map((i) => i.id)), [['a', 'c'], ['b'], ['d'], ['e']]);
  assert.equal(groupFamilies([{ id: 'a', household_id: 1, person_id: 1 }, { id: 'b', household_id: 1, person_id: 2 }]).length, 1);
});

test('rules: an old flat outbox becomes one legacy entry with no time; new entries and junk are handled', () => {
  let n = 0;
  const mk = () => `new-${++n}`;
  assert.deepEqual(upgradeOutbox(['x1', 'x2', 'x1'], 1, mk), [{ id: 'new-1', campus_id: 1, ids: ['x1', 'x2'], household_id: null, at: null, legacy: true }]);
  const entry = newRelease({ id: 'r1', campusId: 1, ids: ['a', 'a', 'b'], householdId: 5, at: T0 });
  assert.deepEqual(entry, { id: 'r1', campus_id: 1, ids: ['a', 'b'], household_id: 5, at: T0 });
  assert.deepEqual(upgradeOutbox([entry], 1, mk), [entry]);
  assert.deepEqual(upgradeOutbox(null, 1, mk), []);
  assert.deepEqual(upgradeOutbox([null, 7, '', {}], 1, mk), []);
  assert.equal(upgradeOutbox(Array.from({ length: 1200 }, (_, i) => `id${i}`), 1, mk).length, 3, 'the server takes 500 at a time');
});

test('rules: labels show a first name and last initial, two letters on a clash, and the age only for the same name', () => {
  const kid = (id, first, last, birthdate = '2020-01-01', nickname = '') => ({ id, first_name: first, last_name: last, nickname, birthdate });
  const day = '2027-02-21';
  const abe = kid(1, 'Abe', 'Aldrin');
  assert.equal(labelText(labelName(abe, [abe, kid(2, 'Bo', 'Bell')], day)), 'Abe A.');
  const alvarez = kid(3, 'Abe', 'Alvarez');
  assert.equal(labelText(labelName(abe, [abe, alvarez], day)), 'Abe Al. (7 yr)', 'same first name and two letters: the age tells them apart');
  assert.equal(labelText(labelName(abe, [abe, kid(4, 'abe', 'Baker')], day)), 'Abe A.', 'a different last initial is enough');
  assert.equal(labelText(labelName(abe, [abe, kid(5, 'Abe', 'Anders')], day)), 'Abe Al.', 'a different second letter is enough');
  assert.equal(labelText(labelName(kid(6, 'Robert', 'Ng', '2020-01-01', 'Bobby'), [], day)), 'Bobby N.', 'the preferred name');
  assert.equal(labelText(labelName(kid(7, 'Zed', ''), [], day)), 'Zed');
  const label = labelText(labelName(abe, [abe], day));
  assert.ok(!label.includes('Aldrin'), 'never the full last name');
  assert.equal(tagInitials(abe), 'A.A.');
  assert.equal(tagInitials(kid(8, 'Zed', '')), 'Z.');
});
