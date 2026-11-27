// The kids' check-in record (child-safety V1, PR 1): every check-in, check-out, delete, roster
// download and station change is written to an append-only log with the identity the server knows;
// iPads report their check-in app version; an admin switch can refuse out-of-date iPads.
// The clock is fixed (Date only) before any session is made, so no test depends on today's date.
import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION, getSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { setSetting } from '../server/db.js';
import { localNow } from '../server/http.js';
import { recordEvent, ACTIONS } from '../server/checkin-events.js';
import { CHECKIN_APP_VERSION } from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
const CANARY = 'CANARY-7Q';
const PHONE = '555-0199';
let server, base, db, token, stationId;
const cookies = {};
const ids = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cr-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('northadmin', 'admin', '[1]');
  make('north', 'staff', '[1]');
  make('staff', 'staff', null);
  make('leader', 'leader', '[1]');
  make('volunteer', 'volunteer', null);
  setSetting(db, 'checkin_user_ids', [ids.leader]);

  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const person = (first, last, household, role, extra = {}) => Number(db.prepare(`INSERT INTO people
    (first_name, last_name, campus_id, household_id, household_role, birthdate, allergies, medical_notes, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(first, last, extra.campus ?? 1, household, role, role === 'child' ? '2020-01-01' : null, extra.allergies ?? '', extra.medical ?? '', extra.phone ?? '').lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhB = hh('Bell', 1); ids.hhC = hh('Cruz', 2);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult', { phone: PHONE });
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child', { allergies: `${CANARY} peanuts`, medical: `${CANARY} asthma` });
  ids.abby = person('Abby', 'Aldrin', ids.hhA, 'child', { medical: `${CANARY} inhaler` });
  ids.bea = person('Bea', 'Bell', ids.hhB, 'adult', { phone: PHONE });
  ids.bo = person('Bo', 'Bell', ids.hhB, 'child');
  ids.cy = person('Cy', 'Cruz', ids.hhC, 'child', { campus: 2 });

  token = (await pair('Lobby', 1)).token;
  stationId = db.prepare('SELECT id FROM checkin_devices').get().id;
});
after(() => { mock.timers.reset(); server.close(); });
// After every step: no event row, and no audit row, holds a child's medical text or a phone number.
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
const asStation = (method, url, body, version = String(CHECKIN_APP_VERSION)) => call({ 'x-station': token, ...(version == null ? {} : { 'x-checkin-version': version }) }, method, url, body);
async function pair(name, campus) {
  const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
  assert.equal((await api('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus })).status, 201);
  return { token: (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token };
}
const events = (action, where = '') => db.prepare(`SELECT * FROM checkin_events WHERE action = ? ${where} ORDER BY id`).all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const rec = (id, person, code, extra = {}) => ({ id, person_id: person, kind: 'kid', security_code: code, station: 'Lobby', checked_in_at: '2027-02-21T15:29:00.000Z', ...extra });
const checkIn = (who, records) => who('POST', '/checkin/checkins', { campus_id: 1, records });

test('schema: the table, indexes and triggers exist, and the log refuses UPDATE and DELETE', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 40);
  const names = (type) => db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type).map((x) => x.name);
  assert.ok(names('table').includes('checkin_events'));
  for (const i of ['checkin_events_day', 'checkin_events_checkin', 'checkin_events_person']) assert.ok(names('index').includes(i), i);
  for (const t of ['checkin_events_no_update', 'checkin_events_no_delete']) assert.ok(names('trigger').includes(t), t);
  const cols = db.prepare('PRAGMA table_info(checkin_devices)').all().map((c) => c.name);
  assert.ok(cols.includes('app_version') && cols.includes('app_version_at'));
  // The log of the pairing in `before` is there to try against.
  assert.ok(db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n >= 1);
  assert.throws(() => db.prepare("UPDATE checkin_events SET action = 'x'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM checkin_events').run(), /append-only/);
});

test('recorder: refuses an unknown action, caps free text, and cuts an oversized detail down instead of failing', () => {
  const req = { user: { id: 1, name: 'T' }, get: () => undefined };
  assert.throws(() => recordEvent(db, req, { action: 'checkin.nonsense' }), /Unknown/);
  const id = recordEvent(db, req, { action: 'roster.download', campusId: 1, detail: { by_claimed: 'x'.repeat(500), station_label: 'y'.repeat(500) } });
  const row = db.prepare('SELECT detail FROM checkin_events WHERE id = ?').get(id);
  assert.equal(JSON.parse(row.detail).by_claimed.length, 100);
  assert.equal(JSON.parse(row.detail).station_label.length, 60);
  const big = recordEvent(db, req, { action: 'roster.download', detail: { path: 'ids', list: Array.from({ length: 300 }, (_, i) => `id-${i}-xxxxxxxxxxxxxxxx`), junk: 'z'.repeat(2100) } });
  const cut = JSON.parse(db.prepare('SELECT detail FROM checkin_events WHERE id = ?').get(big).detail);
  assert.equal(cut.truncated, true);
  assert.equal(cut.path, 'ids');
  assert.equal(cut.list.length, 20);
  assert.ok(!('junk' in cut));
  assert.ok(ACTIONS.includes('checkin') && ACTIONS.includes('version.refused'));
  // That probe row is in the log for good (it is append-only); the test below counts by action and id, not totals.
});

test('station upload: one checkin event per new record, identity from the server, replays write nothing', async () => {
  const batch = [rec('ci-abe-0001', ids.abe, 'KK11'), rec('ci-abby-001', ids.abby, 'KK11', { room_id: 999 })];
  const r1 = await checkIn(asStation, batch);
  assert.equal(r1.status, 201);
  const evs = events('checkin');
  assert.equal(evs.length, 2);
  const e = evs[0];
  assert.deepEqual([e.checkin_id, e.person_id, e.household_id, e.security_code, e.campus_id], ['ci-abe-0001', ids.abe, ids.hhA, 'KK11', 1]);
  assert.deepEqual([e.device_id, e.device_name, e.user_id, e.user_name, e.app_version], [stationId, 'Lobby', null, '', String(CHECKIN_APP_VERSION)]);
  assert.equal(e.client_at, '2027-02-21T15:29:00.000Z');
  assert.equal(e.at, new Date(T0).toISOString());
  assert.equal(e.day, '2027-02-21');
  assert.deepEqual(e.d, { kind: 'kid', room_id: null, service_id: null, station_label: 'Lobby' });
  // Re-sending the same batch adds nothing.
  assert.equal((await checkIn(asStation, batch)).status, 201);
  assert.equal(events('checkin').length, 2);
  // Another campus's family and an unknown person are skipped, and recorded as skipped.
  const r2 = await checkIn(asStation, [rec('ci-cy-00001', ids.cy, 'ZZ99'), rec('ci-ghost-001', 987654, 'ZZ98'), rec('ci-bo-00001', ids.bo, 'BB22')]);
  assert.equal(r2.status, 201);
  assert.equal(r2.data.length, 1);
  const skipped = events('checkin.skipped');
  // One summary row per reason per request, not one per record.
  assert.deepEqual(skipped.map((s) => [s.d.reason, s.person_id, s.d.count, s.d.person_ids]), [['other_campus', ids.cy, 1, [ids.cy]], ['not_found', 987654, 1, [987654]]]);
  assert.equal(events('checkin').length, 3);
});

test('the same upload by a staff user records the account, not a device', async () => {
  const r = await checkIn((m, u, b) => api('staff', m, u, b), [rec('ci-bea-00001', ids.bea, 'AD01', { kind: 'adult' })]);
  assert.equal(r.status, 201);
  const e = events('checkin').at(-1);
  assert.equal(e.checkin_id, 'ci-bea-00001');
  assert.equal(e.user_id, ids.staff);
  assert.ok(e.user_name.length > 0);
  assert.equal(e.device_id, null);
  assert.equal(e.device_name, '');
  assert.equal(e.app_version, '');
});

test('check-out by code: one event per child; by_claimed is only a claim, the actor comes from the server', async () => {
  const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: 'kk11', by: 'Someone Else Entirely' });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 2);
  const evs = events('checkout');
  assert.equal(evs.length, 2);
  for (const e of evs) {
    assert.deepEqual(e.d, { path: 'code', by_claimed: 'Someone Else Entirely' });
    assert.equal(e.device_id, stationId);
    assert.equal(e.user_id, null);
    assert.equal(e.security_code, 'KK11');
    assert.equal(e.household_id, ids.hhA);
  }
  assert.deepEqual(evs.map((e) => e.person_id).sort(), [ids.abe, ids.abby].sort());
  // PR 2 changed this on purpose: the released-by name is the iPad's own name from the server, not the claimed text.
  assert.equal(db.prepare("SELECT checked_out_by FROM checkins WHERE id = 'ci-abe-0001'").get().checked_out_by, 'Lobby');
  assert.equal(events('checkout.mixed').length, 0);
});

// PR 2 refuses a live mixed request (mode: 'request') and a code that matches two families, but the older id-list shape
// still succeeds and is recorded as mixed: it can't be told from an old iPad catching up on a release that already happened.
test('characterisation: the older id-list shape across two families still succeeds, and is recorded as mixed', async () => {
  assert.equal((await checkIn(asStation, [rec('ci-abe-0002', ids.abe, 'FA01'), rec('ci-bo-00002', ids.bo, 'FB02')])).status, 201);
  const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: ['ci-abe-0002', 'ci-bo-00002'], by: 'A parent' });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 2);
  const mixed = events('checkout.mixed');
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0].d.households.sort(), [ids.hhA, ids.hhB].sort());
  assert.deepEqual(mixed[0].d.checkin_ids.sort(), ['ci-abe-0002', 'ci-bo-00002']);
  assert.equal(mixed[0].d.path, 'ids');
});

test('repeats and misses: repeat, unknown id, wrong code', async () => {
  const repeat = await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: ['ci-abe-0002'] });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.checked_out, 0);
  assert.deepEqual(events('checkout.repeat').map((e) => [e.checkin_id, e.person_id, e.d.path]), [['ci-abe-0002', ids.abe, 'ids']]);
  const unknown = await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: ['ci-cy-00001', 'not-a-real-id'] });
  assert.equal(unknown.data.checked_out, 0);
  assert.deepEqual(events('checkout.unknown').map((e) => [e.checkin_id, e.d]), [['ci-cy-00001', { path: 'ids', count: 2, ids: ['ci-cy-00001', 'not-a-real-id'] }]]);
  const miss = await asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: 'nope' });
  assert.equal(miss.status, 404);
  const m = events('checkout.code_miss');
  assert.equal(m.length, 1);
  assert.equal(m[0].security_code, 'NOPE');
});

test('a check-in can’t be deleted: DELETE says so (405), keeps the row and writes no event (voiding is in history-protection.test.js)', async () => {
  const r = await asStation('DELETE', '/checkin/checkins/ci-bo-00001');
  assert.equal(r.status, 405);
  assert.match(r.data.error, /Void/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM checkins WHERE id = 'ci-bo-00001'").get().n, 1);
  assert.equal(events('checkin.delete').length, 0);
  assert.equal((await asStation('DELETE', '/checkin/checkins/not-there')).status, 404);
  assert.throws(() => db.prepare("DELETE FROM checkins WHERE id = 'ci-bo-00001'").run(), /kept for the record/);
});

test('roster downloads: one per station per campus per day', async () => {
  const before = events('roster.download').length;
  const a = await asStation('GET', '/checkin/roster?campus_id=1');
  assert.equal(a.status, 200);
  assert.equal((await asStation('GET', '/checkin/roster?campus_id=1')).status, 200);
  const rows = events('roster.download');
  assert.equal(rows.length - before, 1);
  assert.deepEqual(rows.at(-1).d, { households: a.data.households.length, children: 3 });
  assert.equal(rows.at(-1).day, '2027-02-21');
  mock.timers.setTime(Date.parse('2027-02-22T15:30:00Z'));
  try {
    assert.equal((await asStation('GET', '/checkin/roster?campus_id=1')).status, 200);
    assert.equal(events('roster.download').length - before, 2);
    assert.equal(events('roster.download').at(-1).day, '2027-02-22');
  } finally { mock.timers.setTime(Date.parse(T0)); }
});

test('station changes: pairing, renaming and removing are recorded and keep the name', async () => {
  const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
  const made = await api('north', 'POST', '/checkin/devices', { code: p.code, name: 'Hallway', campus_id: 1 });
  assert.equal(made.status, 201);
  const id = made.data.id;
  const pairEv = events('device.pair').find((e) => e.device_id === id);
  assert.deepEqual([pairEv.device_name, pairEv.user_id, pairEv.campus_id, pairEv.d], ['Hallway', ids.north, 1, { name: 'Hallway' }]);
  assert.equal((await api('north', 'PATCH', `/checkin/devices/${id}`, { name: 'Hall B', print: false })).status, 200);
  const upd = events('device.update').find((e) => e.device_id === id);
  assert.equal(upd.device_name, 'Hall B');
  assert.deepEqual(upd.d, { fields: ['name', 'print'], from_campus: 1, to_campus: 1 });
  assert.equal((await api('north', 'DELETE', `/checkin/devices/${id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_devices WHERE id = ?').get(id).n, 0);
  const rem = events('device.remove').find((e) => e.device_id === id);
  assert.deepEqual([rem.device_name, rem.user_id, rem.d], ['Hall B', ids.north, { name: 'Hall B' }]);
  assert.equal(events('device.pair').find((e) => e.device_id === id).device_name, 'Hallway', 'earlier rows keep the name it had then');
  // The older audit rows are unchanged.
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.device'").get());
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.device.remove'").get());
});

test('GET /checkin/events: who may read it, validation, and the audit row', async () => {
  const url = '/checkin/events?campus_id=1&day=2027-02-21';
  const staff = await api('staff', 'GET', url);
  assert.equal(staff.status, 200);
  assert.equal(staff.data.truncated, false);
  const first = staff.data.events.find((e) => e.action === 'checkin' && e.person_id === ids.abe);
  assert.deepEqual([first.first_name, first.last_name, typeof first.detail], ['Abe', 'Aldrin', 'object']);
  assert.ok(staff.data.events.every((e) => e.campus_id === 1 && e.day === '2027-02-21'));
  assert.equal((await api('north', 'GET', url)).status, 200);
  assert.equal((await api('north', 'GET', '/checkin/events?campus_id=2&day=2027-02-21')).status, 403);
  assert.equal((await api('leader', 'GET', url)).status, 403, 'a leader with check-in access still cannot read the record');
  assert.equal((await asStation('GET', url)).status, 403);
  assert.equal((await api(null, 'GET', url)).status, 401);
  const audited = db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.events.view' ORDER BY id").all().map((a) => JSON.parse(a.detail));
  assert.deepEqual(audited.slice(0, 2), [{ campus_id: 1, day: '2027-02-21' }, { campus_id: 1, day: '2027-02-21' }]);
  for (const bad of ['', '&day=', '&day=21-02-2027', '&day=2027-13-45']) assert.equal((await api('staff', 'GET', `/checkin/events?campus_id=1${bad}`)).status, 400, bad);
  assert.equal((await api('staff', 'GET', `${url}&action=nonsense`)).status, 400);
  const only = await api('staff', 'GET', `${url}&action=checkout.mixed`);
  assert.deepEqual(only.data.events.map((e) => e.action), ['checkout.mixed']);
});

test('time zone: just after midnight UTC is still the day before in Chicago', async () => {
  mock.timers.setTime(Date.parse('2027-02-21T05:30:00Z'));
  try {
    assert.equal(localNow('America/Chicago', new Date()).date, '2027-02-20');
    assert.equal((await checkIn(asStation, [{ id: 'ci-late-0001', person_id: ids.bo, kind: 'kid', security_code: 'LT01', station: 'Lobby' }])).status, 201);
    const e = events('checkin').find((x) => x.checkin_id === 'ci-late-0001');
    assert.equal(e.at, '2027-02-21T05:30:00.000Z');
    assert.equal(e.day, '2027-02-20');
    assert.equal(e.client_at, null, 'no client time was sent');
    const got = await api('staff', 'GET', '/checkin/events?campus_id=1&day=2027-02-20&action=checkin');
    assert.ok(got.data.events.some((x) => x.checkin_id === 'ci-late-0001'));
    const other = await api('staff', 'GET', '/checkin/events?campus_id=1&day=2027-02-21&action=checkin');
    assert.ok(!other.data.events.some((x) => x.checkin_id === 'ci-late-0001'));
  } finally { mock.timers.setTime(Date.parse(T0)); }
});

test('safety settings: admins read, only all-campus admins change, strict body, audited, never in /settings', async () => {
  const g = await api('admin', 'GET', '/checkin/safety');
  assert.deepEqual(g.data, { require_current_app: false, current_app_version: CHECKIN_APP_VERSION,
    legal_hold: { on: false, reason: '', set_by_name: '', set_at: null, released_at: null, released_by_name: '', cooling_off_days: 7 } });
  assert.equal((await api('northadmin', 'GET', '/checkin/safety')).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/safety')).status, 403);
  assert.equal((await asStation('GET', '/checkin/safety')).status, 403);
  assert.equal((await api(null, 'GET', '/checkin/safety')).status, 401);

  assert.equal((await api('northadmin', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 403);
  assert.equal((await api('staff', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 403);
  assert.equal((await asStation('PATCH', '/checkin/safety', { require_current_app: true })).status, 403);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true, legal_hold: true })).status, 400);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: 'yes' })).status, 400);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', {})).status, 400);
  assert.equal(getSetting(db, 'checkin_safety'), null, 'refused changes store nothing');

  const on = await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true });
  assert.equal(on.status, 200);
  assert.equal(on.data.require_current_app, true);
  const a = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'checkin.safety'").get();
  assert.equal(a.user_id, ids.admin);
  assert.deepEqual(JSON.parse(a.detail), { from: { require_current_app: false }, to: { require_current_app: true } });
  const ev = events('safety.settings');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].campus_id, ev[0].day, ev[0].user_id, ev[0].d], [null, null, ids.admin, { changed: ['require_current_app'], require_current_app: true }]);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).status, 200);

  for (const who of ['admin', 'volunteer']) {
    const s = await api(who, 'GET', '/settings');
    assert.equal(s.status, 200, who);
    assert.ok(!('checkin_safety' in s.data), who);
  }
  assert.equal((await api('admin', 'PATCH', '/settings', { checkin_safety: { require_current_app: true } })).status < 500, true);
  assert.equal(getSetting(db, 'checkin_safety').require_current_app, false, 'PATCH /settings cannot change it');
});

test('app version: reported by the iPad, shown on the stations list, junk stored as empty', async () => {
  const device = async () => (await api('staff', 'GET', '/checkin/devices')).data.find((d) => d.id === stationId);
  await asStation('GET', '/checkin/station');
  let d = await device();
  assert.deepEqual([d.app_version, d.app_version_at], [String(CHECKIN_APP_VERSION), new Date(T0).toISOString()]);
  await asStation('GET', '/checkin/station', undefined, 'abc');
  assert.equal((await device()).app_version, '');
  await asStation('GET', '/checkin/station', undefined, '1234567');
  assert.equal((await device()).app_version, '', 'more than six digits is junk');
  await asStation('GET', '/checkin/station', undefined, String(CHECKIN_APP_VERSION + 1));
  assert.equal((await device()).app_version, String(CHECKIN_APP_VERSION + 1));
  await asStation('GET', '/checkin/station');
  assert.equal((await device()).app_version, String(CHECKIN_APP_VERSION));
});

test('app version, switch off: iPads with no header or 0 work exactly as before', async () => {
  assert.equal(getSetting(db, 'checkin_safety').require_current_app, false);
  for (const v of [null, '0']) {
    assert.equal((await asStation('GET', '/checkin/roster?campus_id=1', undefined, v)).status, 200);
    assert.equal((await asStation('GET', '/checkin/active?campus_id=1', undefined, v)).status, 200);
  }
  assert.equal(events('version.refused').length, 0);
});

test('app version, switch on: old iPads get 426 on the five routes and lose nothing; others are untouched', async () => {
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 200);
  try {
    const checkinsBefore = db.prepare('SELECT COUNT(*) n FROM checkins').get().n;
    const eventsBefore = db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n;
    const calls = [
      ['GET', '/checkin/roster?campus_id=1'],
      ['GET', '/checkin/active?campus_id=1'],
      ['POST', '/checkin/checkins', { campus_id: 1, records: [rec('ci-old-00001', ids.bo, 'OL01')] }],
      ['POST', '/checkin/checkout', { campus_id: 1, ids: ['ci-late-0001'] }],
      ['DELETE', '/checkin/checkins/ci-late-0001'],
    ];
    for (const v of [null, '0']) {
      for (const [m, u, b] of calls) {
        const r = await asStation(m, u, b, v);
        assert.equal(r.status, 426, `${m} ${u} with ${v}`);
        assert.equal(r.data.reload, true);
        assert.match(r.data.error, /older check-in/);
      }
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM checkins').get().n, checkinsBefore, 'a refused upload stores nothing');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM checkins WHERE id = 'ci-late-0001' AND checked_out_at IS NULL").get().n, 1, 'and releases no one');
    const refused = events('version.refused');
    assert.equal(refused.length, 1, 'one per iPad per day');
    assert.deepEqual([refused[0].device_id, refused[0].campus_id, refused[0].day, refused[0].d], [stationId, 1, '2027-02-21', { sent: null, required: CHECKIN_APP_VERSION }]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n, eventsBefore + 1);
    // The next day it is written again.
    mock.timers.setTime(Date.parse('2027-02-22T15:30:00Z'));
    try { assert.equal((await asStation('GET', '/checkin/active?campus_id=1', undefined, '0')).status, 426); } finally { mock.timers.setTime(Date.parse(T0)); }
    assert.equal(events('version.refused').length, 2);

    // The current version is fine, and so are staff, the station's own settings and the pairing routes.
    assert.equal((await asStation('GET', '/checkin/roster?campus_id=1', undefined, String(CHECKIN_APP_VERSION))).status, 200);
    assert.equal((await asStation('GET', '/checkin/active?campus_id=1', undefined, '999')).status, 200);
    assert.equal((await api('staff', 'GET', '/checkin/roster?campus_id=1')).status, 200);
    assert.equal((await api('north', 'GET', '/checkin/active?campus_id=1')).status, 200);
    assert.equal((await asStation('GET', '/checkin/station', undefined, null)).status, 200);
    assert.equal((await asStation('GET', '/checkin/campuses', undefined, null)).status, 200);
    assert.equal((await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).status, 201);
    // And an up-to-date iPad can upload the same record it was refused for.
    assert.equal((await checkIn(asStation, [rec('ci-old-00001', ids.bo, 'OL01')])).status, 201);
  } finally {
    assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).status, 200);
  }
});

test('a large offline check-out across two families still succeeds, with one capped mixed row', async () => {
  const ins = db.prepare(`INSERT INTO checkins (id, campus_id, person_id, kind, security_code, station, day, checked_in_at) VALUES (?, 1, ?, 'kid', ?, 'Lobby', '2027-02-21', ?)`);
  const many = Array.from({ length: 60 }, (_, i) => `ci-bulk-${String(i).padStart(4, '0')}-${'x'.repeat(30)}`);
  many.forEach((id, i) => ins.run(id, i % 2 ? ids.bo : ids.abe, 'BK01', '2027-02-21T15:00:00.000Z'));
  const mixedBefore = events('checkout.mixed').length;
  const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: [...many, ...many], by: 'Lobby' }); // duplicates are collapsed
  assert.equal(r.status, 200);
  assert.equal(r.data.checked_out, 60);
  const mixed = events('checkout.mixed');
  assert.equal(mixed.length - mixedBefore, 1);
  const d = mixed.at(-1).d;
  assert.deepEqual([d.count, d.household_count, d.checkin_ids.length, d.truncated], [60, 2, 20, true]);
  assert.equal(events('checkout.repeat').length, 1, 'duplicates sent in one request are not counted as repeats');
});

test('the record cannot be flooded: ids are capped, unknown ids make one row, code guesses stop after a few rows', async () => {
  assert.equal((await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: Array.from({ length: 10000 }, (_, i) => `nope-${i}-padding`) })).status, 400);
  const before = db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n;
  const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: Array.from({ length: 500 }, (_, i) => `ghost-${i}-padding`) });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n, before + 1);
  const u = events('checkout.unknown').at(-1);
  assert.deepEqual([u.d.count, u.d.ids.length], [500, 20]);
  for (let i = 0; i < 8; i++) assert.equal((await asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: `ZX${i}` })).status, 404);
  const misses = events('checkout.code_miss', 'AND device_id = ' + stationId);
  assert.equal(misses.length, 5);
  assert.equal(misses.at(-1).d.attempt, 5);
});

test('past days show pickup codes masked; today shows them', async () => {
  const past = await api('staff', 'GET', '/checkin/events?campus_id=1&day=2027-02-20&action=checkin');
  assert.ok(past.data.events.length > 0);
  assert.ok(past.data.events.every((e) => e.security_code === '••••'));
  const today = await api('staff', 'GET', '/checkin/events?campus_id=1&day=2027-02-21&action=checkin');
  assert.ok(today.data.events.some((e) => e.security_code === 'KK11'));
  assert.ok(db.prepare("SELECT COUNT(*) n FROM checkin_events WHERE security_code = 'LT01'").get().n > 0, 'stored unmasked');
});

test('moving a station to another campus is recorded under both campuses', async () => {
  const { token: t2 } = await pair('Mover', 1);
  const id = db.prepare("SELECT id FROM checkin_devices WHERE name = 'Mover'").get().id;
  assert.equal((await api('admin', 'PATCH', `/checkin/devices/${id}`, { campus_id: 2 })).status, 200);
  const moved = events('device.update').filter((e) => e.device_id === id && e.device_name === 'Mover');
  assert.deepEqual(moved.map((e) => e.campus_id).sort(), [1, 2]);
  assert.ok(moved.every((e) => e.d.from_campus === 1 && e.d.to_campus === 2));
  assert.ok(t2);
});

test('safety settings: only own keys count (no inherited names)', async () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty']) assert.equal((await api('admin', 'PATCH', '/checkin/safety', { [k]: true })).status, 400, k);
});

test('no check-in or event row ever holds medical text or a phone number', () => {
  noPrivateText();
  assert.ok(db.prepare('SELECT COUNT(*) n FROM checkin_events').get().n > 20, 'the scan covered a real record');
});
