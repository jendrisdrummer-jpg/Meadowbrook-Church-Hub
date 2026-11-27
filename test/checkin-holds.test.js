// Holds and who collected (child-safety V1, PR 6): staff with check-in access place, change and lift a hold; a held child is
// never checked out at an iPad or in the Hub's check-out (online, any role, any app version); an iPad that was offline
// is recorded and flagged, never refused; the safeguarding lead is told every time; the private note goes nowhere but
// the Hub; and who collected a child is recorded from the family's own list and can't be changed afterwards.
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
import { outbox as mailbox } from '../server/mail.js';
import { isHistoryError } from '../server/history.js';
import { CHECKIN_APP_VERSION, rosterIsToday, heldPeople, collectorChoice } from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
const NOTE = 'CANARY-NOTE-7Q custody order, see the blue folder';
const REASON = 'CANARY-WHY-4K court order ended';
const PHONE = '555-0177';
let server, base, db, tokens;
const cookies = {};
const ids = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-holds-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses, checkin = 0) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, checkin) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, checkin).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('admin2', 'admin', null);
  make('limitedAdmin', 'admin', '[1]');
  make('staff', 'staff', null);
  make('north', 'staff', '[1]');
  make('south', 'staff', '[2]');
  make('leaderSwitch', 'leader', '[1]', 1); // has the Kids' check-in switch, but isn't staff
  make('leaderNoSwitch', 'leader', '[1]');
  make('volunteer', 'volunteer', null);
  make('lead', 'volunteer', null); // the safeguarding lead is named below; a volunteer account is enough to be told

  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const person = (first, last, household, role, extra = {}) => Number(db.prepare(`INSERT INTO people
    (first_name, last_name, campus_id, household_id, household_role, birthdate, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(first, last, extra.campus ?? 1, household, role, role === 'child' ? '2020-01-01' : null, extra.phone ?? '').lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhB = hh('Bell', 1); ids.hhC = hh('Cruz', 2);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult', { phone: PHONE });
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child');
  ids.abby = person('Abby', 'Aldrin', ids.hhA, 'child');
  ids.bea = person('Bea', 'Bell', ids.hhB, 'adult');
  ids.bo = person('Bo', 'Bell', ids.hhB, 'child');
  ids.bix = person('Bix', 'Bell', ids.hhB, 'child');
  ids.cy = person('Cy', 'Cruz', ids.hhC, 'child', { campus: 2 });
  ids.gran = Number(db.prepare("INSERT INTO household_pickups (household_id, name, phone, relationship) VALUES (?, 'Gran Aldrin', ?, 'Grandmother')").run(ids.hhA, PHONE).lastInsertRowid);
  ids.granB = Number(db.prepare("INSERT INTO household_pickups (household_id, name, phone, relationship) VALUES (?, 'Gran Bell', '', 'Grandmother')").run(ids.hhB).lastInsertRowid);

  tokens = {};
  for (const [name, campus] of [['Lobby', 1], ['Hall', 1], ['SouthDesk', 2]]) {
    const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
    assert.equal((await api('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus })).status, 201);
    tokens[name] = (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
  }
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead] })).status, 200);
});
after(() => { mock.timers.reset(); server.close(); });
afterEach(() => noPrivateText());

// The note, and the reasons for lifting or releasing, are for the Hub's hold screens (and, for reasons, the audit log).
// They are never in the check-in record, a notification, an email, the roster or anything an iPad can read.
function noPrivateText() {
  // Reasons for lifting or releasing sit in the audit log (admins only); the note is nowhere but the hold itself.
  const record = JSON.stringify([db.prepare('SELECT * FROM checkin_events').all(), db.prepare('SELECT * FROM notifications').all(), mailbox]);
  assert.ok(!record.includes('CANARY'), 'the private note or a reason leaked into the record, a notification or an email');
  assert.ok(!db.prepare('SELECT detail FROM audit_log').all().map((x) => x.detail).join().includes('CANARY-NOTE'), 'the private note reached the audit log');
  assert.ok(!record.includes(PHONE), 'a phone number leaked');
}

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const api = (who, method, url, body) => call(who ? { cookie: cookies[who] } : {}, method, url, body);
const asStation = (method, url, body, who = 'Lobby', version = String(CHECKIN_APP_VERSION)) => call({ 'x-station': tokens[who], ...(version == null ? {} : { 'x-checkin-version': version }) }, method, url, body);
const events = (action) => db.prepare('SELECT * FROM checkin_events WHERE action = ? ORDER BY id').all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const row = (id) => db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
const notices = (user) => db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id').all(ids[user]);
let n = 0;
// Checks a child in at a campus through the station, with a fresh id and the given code.
async function checkIn(person, code, { who = 'Lobby', at = '2027-02-21T15:00:00.000Z' } = {}) {
  const id = `ci-${String(++n).padStart(4, '0')}-holds`;
  const r = await asStation('POST', '/checkin/checkins', { campus_id: who === 'SouthDesk' ? 2 : 1, records: [{ id, person_id: person, kind: 'kid', security_code: code, station: who, checked_in_at: at }] }, who);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return id;
}
const withClock = (iso, fn) => { mock.timers.setTime(Date.parse(iso)); return Promise.resolve(fn()).finally(() => mock.timers.setTime(Date.parse(T0))); };
const place = (who, person, campus = 1, note = NOTE) => api(who, 'POST', '/checkin/holds', { person_id: person, campus_id: campus, note });
const lift = (who, hold, reason = REASON) => api(who, 'DELETE', `/checkin/holds/${hold}`, { reason });
const unlift = async (person) => { const h = db.prepare('SELECT id FROM checkin_holds WHERE person_id = ? AND lifted_at IS NULL').get(person); if (h) assert.equal((await lift('admin', h.id)).status, 200); };

test('migration 45: the hold table is a protected history, and who collected can’t be changed once a child has left', () => {
  assert.ok(SCHEMA_VERSION >= 45);
  for (const a of ['hold.set', 'hold.change', 'hold.lift', 'checkout.hold_blocked', 'checkout.held_released']) assert.ok(ACTIONS.includes(a), a);
  const hid = Number(db.prepare("INSERT INTO checkin_holds (person_id, person_name, campus_id, placed_at) VALUES (?, 'Cy Cruz', 2, '2027-02-21T15:00:00.000Z')").run(ids.cy).lastInsertRowid);
  const refused = (sql, ...args) => { try { db.prepare(sql).run(...args); } catch (e) { return e; } return null; };
  assert.ok(isHistoryError(refused('DELETE FROM checkin_holds WHERE id = ?', hid)), 'a hold can’t be deleted');
  assert.ok(isHistoryError(refused('UPDATE checkin_holds SET person_id = ? WHERE id = ?', ids.bo, hid)), 'who it is for can’t be changed');
  assert.throws(() => db.prepare("INSERT INTO checkin_holds (person_id, person_name, campus_id, placed_at) VALUES (?, 'Again', 2, 'x')").run(ids.cy), /UNIQUE/, 'one hold at a time for a child');
  assert.equal(refused("UPDATE checkin_holds SET note = 'ok' WHERE id = ?", hid), null, 'the note may change while the hold is on');
  assert.equal(refused("UPDATE checkin_holds SET lifted_at = '2027-02-21T16:00:00.000Z', lift_reason = 'r' WHERE id = ?", hid), null);
  assert.ok(isHistoryError(refused("UPDATE checkin_holds SET note = 'later' WHERE id = ?", hid)), 'a lifted hold stays lifted');
  assert.equal(refused("INSERT INTO checkin_holds (person_id, person_name, campus_id, placed_at) VALUES (?, 'Cy Cruz', 2, '2027-02-21T17:00:00.000Z')", ids.cy)?.message ?? null, null, 'a new hold after a lift is a new row');
  assert.ok(isHistoryError(refused('DELETE FROM people WHERE id = ?', ids.cy)), 'a person with a hold on record is archived, not deleted');
  db.prepare('UPDATE checkin_holds SET lifted_at = ? WHERE person_id = ? AND lifted_at IS NULL').run('2027-02-21T18:00:00.000Z', ids.cy);
  // Collector columns: free to set at check-out, final afterwards.
  db.prepare("INSERT INTO checkins (id, campus_id, person_id, day, checked_in_at) VALUES ('mig-45', 1, ?, '2027-02-21', '2027-02-21T15:00:00.000Z')").run(ids.bo);
  assert.equal(refused("UPDATE checkins SET checked_out_to_name = 'Pre' WHERE id = 'mig-45'"), null, 'before check-out the columns can be set');
  db.prepare("UPDATE checkins SET checked_out_at = '2027-02-21T15:20:00.000Z', checked_out_to_name = 'Bea Bell', checked_out_to_kind = 'household_adult' WHERE id = 'mig-45'").run();
  for (const col of ['checked_out_to_name', 'checked_out_to_relationship', 'checked_out_to_kind', 'checked_out_id_type']) {
    assert.ok(isHistoryError(refused(`UPDATE checkins SET ${col} = 'changed' WHERE id = 'mig-45'`)), `${col} is final`);
  }
  assert.ok(isHistoryError(refused("UPDATE checkins SET checked_out_held = 1 WHERE id = 'mig-45'")));
  assert.equal(refused("UPDATE checkins SET checked_out_to_name = checked_out_to_name WHERE id = 'mig-45'"), null, 'writing the same value is harmless');
  assert.equal(refused("UPDATE checkins SET person_id = ? WHERE id = 'mig-45'", ids.bo), null, 'a merge can still move a check-in to the kept person');
});

test('who may place, change and lift a hold: staff with check-in access at that campus, nobody else', async () => {
  // Not signed in, a volunteer, a leader (with or without the switch) and an iPad can't.
  assert.equal((await api(null, 'POST', '/checkin/holds', { person_id: ids.abe, campus_id: 1 })).status, 401);
  for (const who of ['volunteer', 'leaderNoSwitch', 'leaderSwitch', 'lead']) assert.equal((await place(who, ids.abe)).status, 403, who);
  assert.equal((await asStation('POST', '/checkin/holds', { person_id: ids.abe, campus_id: 1 })).status, 403, 'an iPad can never place a hold');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_holds WHERE person_id = ?').get(ids.abe).n, 0);
  // Campus: South staff can't act at North, North staff can't act at South, even for the family's own campus.
  assert.equal((await place('south', ids.abe, 1)).status, 403);
  assert.equal((await place('north', ids.cy, 2)).status, 403);
  assert.equal((await place('limitedAdmin', ids.cy, 2)).status, 403);
  // A child in a family at another campus can't be held from here, and an adult can't be held.
  assert.equal((await place('admin', ids.cy, 1)).status, 400);
  assert.equal((await place('admin', ids.ann, 1)).status, 400);
  assert.equal((await place('admin', 99999, 1)).status, 404);
  assert.equal((await place('admin', ids.abe, 99)).status, 404);

  const made = await place('north', ids.abe, 1);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual([made.data.active, made.data.person_name, made.data.placed_by_name, made.data.note], [true, 'Abe Aldrin', 'north@mb.org', NOTE]);
  assert.equal((await place('admin', ids.abe, 1)).status, 409, 'one hold at a time');
  const hold = made.data.id;

  // Change the note: same rules.
  assert.equal((await api('south', 'PATCH', `/checkin/holds/${hold}`, { note: 'x' })).status, 403);
  assert.equal((await api('leaderSwitch', 'PATCH', `/checkin/holds/${hold}`, { note: 'x' })).status, 403);
  assert.equal((await api('north', 'PATCH', `/checkin/holds/${hold}`, { note: 5 })).status, 400);
  const changed = await api('staff', 'PATCH', `/checkin/holds/${hold}`, { note: `${NOTE} (updated)` });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.changed_by_name, 'staff@mb.org');

  // Lift: a reason is required, other campuses and iPads can't.
  assert.equal((await lift('south', hold)).status, 403);
  assert.equal((await asStation('DELETE', `/checkin/holds/${hold}`, { reason: 'x' })).status, 403);
  assert.equal((await api('north', 'DELETE', `/checkin/holds/${hold}`, {})).status, 400);
  assert.equal((await lift('north', hold)).status, 200);
  assert.equal((await lift('north', hold)).status, 409, 'already lifted');
  assert.equal((await api('north', 'PATCH', `/checkin/holds/${hold}`, { note: 'x' })).status, 409);
  const kept = db.prepare('SELECT * FROM checkin_holds WHERE id = ?').get(hold);
  assert.deepEqual([kept.lifted_by_name, kept.lift_reason, kept.person_name], ['north@mb.org', REASON, 'Abe Aldrin'], 'the row stays as history');
  // A new hold afterwards is a new row.
  const again = await place('north', ids.abe, 1);
  assert.equal(again.status, 201);
  assert.notEqual(again.data.id, hold);
  assert.equal((await lift('admin', again.data.id)).status, 200);

  // Record: ids only, from the person who did it.
  const set = events('hold.set')[0];
  assert.deepEqual([set.campus_id, set.person_id, set.user_name, set.d.hold_id], [1, ids.abe, 'north@mb.org', hold]);
  assert.equal(events('hold.change').length, 1);
  assert.ok(events('hold.lift').length >= 2);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.hold.set'").get());
});

test('who can see holds: staff with check-in access at the campus and the named safeguarding lead; never an iPad', async () => {
  const made = await place('staff', ids.bo, 1);
  assert.equal(made.status, 201);
  const hold = made.data.id;
  for (const who of ['staff', 'north', 'admin', 'lead']) {
    const r = await api(who, 'GET', '/checkin/holds?campus_id=1');
    assert.equal(r.status, 200, who);
    assert.deepEqual(r.data.holds.map((h) => [h.person_name, h.note]), [['Bo Bell', NOTE]], who);
  }
  assert.equal((await api('lead', 'GET', '/checkin/holds?campus_id=1')).data.can_manage, false);
  assert.equal((await api('north', 'GET', '/checkin/holds?campus_id=1')).data.can_manage, true);
  assert.equal((await api('south', 'GET', '/checkin/holds?campus_id=1')).status, 403, 'another campus');
  assert.equal((await api('south', 'GET', `/checkin/holds?person_id=${ids.bo}`)).data.holds.length, 0, 'filtered to the campuses you cover');
  for (const who of ['volunteer', 'leaderNoSwitch', 'leaderSwitch']) assert.equal((await api(who, 'GET', '/checkin/holds?campus_id=1')).status, 403, who);
  assert.equal((await api(null, 'GET', '/checkin/holds?campus_id=1')).status, 401);
  assert.equal((await asStation('GET', '/checkin/holds?campus_id=1')).status, 403);
  assert.equal((await asStation('GET', '/checkin/safeguarding')).status, 403);
  // The person's own history, newest first.
  assert.equal((await api('north', 'GET', `/checkin/holds?person_id=${ids.bo}`)).data.holds[0].id, hold);

  // An iPad learns only THAT a child has a hold, never why: the roster and the active list carry a yes/no and nothing else.
  const roster = await asStation('GET', '/checkin/roster?campus_id=1');
  const kids = roster.data.households.flatMap((h) => h.members).filter((m) => m.household_role === 'child');
  assert.deepEqual(kids.filter((k) => k.on_hold).map((k) => k.first_name), ['Bo']);
  assert.equal(kids.find((k) => k.first_name === 'Abe').on_hold, 0);
  assert.ok(!JSON.stringify(roster.data).includes('CANARY'));
  assert.ok(!('note' in kids.find((k) => k.first_name === 'Bo')));
  const bo = await checkIn(ids.bo, 'K7Q3M');
  const active = await asStation('GET', '/checkin/active?campus_id=1');
  assert.equal(active.data.find((c) => c.id === bo).on_hold, 1);
  assert.ok(!JSON.stringify(active.data).includes('CANARY'));
  const heard = db.prepare('SELECT detail FROM audit_log').all().map((a) => a.detail).join();
  assert.ok(!heard.includes('CANARY-NOTE'));
  // The iPad's own helpers: held people come from both the roster and today's list.
  assert.deepEqual([...heldPeople(roster.data, [])], [ids.bo]);
  assert.deepEqual([...heldPeople({ households: [] }, [{ person_id: 9, on_hold: 1 }, { person_id: 8, on_hold: 0 }])], [9]);
  await unlift(ids.bo);
  await api('admin', 'POST', `/checkin/checkins/${bo}/void`, { reason: 'test cleanup' });
});

test('check-out is blocked for a held child on every path: iPad (any version), a leader, staff and an admin', async () => {
  assert.equal((await place('north', ids.abe, 1)).status, 201);
  const abe = await checkIn(ids.abe, 'K7Q3M');
  const abby = await checkIn(ids.abby, 'K7Q3M'); // her sibling, not held, same code
  const before = events('checkout.hold_blocked').length;
  const attempts = [
    ['iPad, current', () => asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe] })],
    ['iPad, with a sibling who has no hold', () => asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe, abby] })],
    ['iPad, older app (version 2)', () => asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe] }, 'Lobby', '2')],
    ['iPad, version 3', () => asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe] }, 'Hall', '3')],
    ['iPad, no version at all (the oldest shape: ids)', () => asStation('POST', '/checkin/checkout', { campus_id: 1, ids: [abe] }, 'Lobby', null)],
    ['iPad, the oldest shape: a typed code', () => asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: 'k7q3m' }, 'Lobby', null)],
    ['a leader signed in', () => api('leaderSwitch', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe] })],
    ['staff', () => api('staff', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe] })],
    ['an admin', () => api('admin', 'POST', '/checkin/checkout', { campus_id: 1, ids: [abe] })],
  ];
  for (const [name, go] of attempts) {
    const r = await go();
    assert.equal(r.status, 409, name);
    assert.equal(r.data.reason, 'hold', name);
    // Calm, tells the volunteer to fetch staff, and says nothing about why (no note, no names, no reason).
    assert.match(r.data.error, /staff member needs to help/);
    assert.match(r.data.error, /ask one to come to the desk/);
    assert.ok(!/CANARY|custody|order|court/i.test(JSON.stringify(r.data)), name);
    assert.deepEqual(r.data.check_in_ids, [abe], name);
  }
  assert.equal(row(abe).checked_out_at, null);
  assert.equal(row(abby).checked_out_at, null, 'the whole request is refused, so nothing leaves with the sibling either');
  assert.equal(events('checkout.hold_blocked').length - before, attempts.length);
  const blocked = events('checkout.hold_blocked').at(-1);
  assert.deepEqual([blocked.person_id, blocked.checkin_id, blocked.campus_id], [ids.abe, abe, 1]);
  assert.ok(!JSON.stringify(blocked.d).includes('CANARY'));
  // The sibling alone can still go home, with someone from the family.
  const ok = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abby], collector: { kind: 'household_adult', person_id: ids.ann } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.checked_out, 1);

  // The lead hears about the attempt once for the child that day, not once for every tap.
  const attemptNotes = notices('lead').filter((x) => x.title === 'Someone tried to check out a child with a hold');
  assert.equal(attemptNotes.length, 1);
  assert.match(attemptNotes[0].body, /Abe Aldrin/);
  assert.ok(!attemptNotes[0].body.includes('CANARY'));

  // Lifting the hold lets the check-out through again.
  await unlift(ids.abe);
  const after = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [abe], collector: { kind: 'pickup_contact', pickup_id: ids.gran, id_type: 'drivers_license' } });
  assert.equal(after.status, 200);
  assert.equal(row(abe).checked_out_to_name, 'Gran Aldrin');
});

test('an iPad that was offline: the release is recorded and never refused; one made over a hold is flagged and the lead is told', async () => {
  const bo = await checkIn(ids.bo, 'M4P2R');
  const bix = await checkIn(ids.bix, 'M4P2R');
  // Bix's hold was already on when the iPad released him (15:10); Bo's was placed at 15:30, after the iPad had gone offline.
  await withClock('2027-02-21T15:05:00Z', async () => assert.equal((await place('staff', ids.bix, 1)).status, 201));
  assert.equal((await place('staff', ids.bo, 1)).status, 201);
  const told = notices('lead').length;
  const r = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'report', ids: [bo, bix], at: '2027-02-21T15:10:00.000Z', collector: { kind: 'household_adult', person_id: ids.bea, name: 'Bea Bell' } });
  assert.equal(r.status, 200, 'a report of something that already happened is never refused');
  assert.equal(r.data.checked_out, 2);
  assert.deepEqual([row(bo).checked_out_held, row(bix).checked_out_held], [0, 1]);
  assert.equal(row(bo).checked_out_at, '2027-02-21T15:10:00.000Z', 'at the time it really happened');
  const flagged = events('checkout.held_released');
  assert.equal(flagged.length, 1);
  assert.deepEqual([flagged[0].person_id, flagged[0].d.via, flagged[0].d.hold_id], [ids.bix, 'offline', db.prepare('SELECT id FROM checkin_holds WHERE person_id = ?').get(ids.bix).id]);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.hold.released_offline'").get());
  const heard = notices('lead').slice(told);
  assert.equal(heard.length, 1);
  assert.match(heard[0].body, /Bix Bell was checked out on Lobby while a hold was on/);
  // The same report sent again changes nothing and doesn't tell anyone twice.
  const again = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'report', ids: [bo, bix], at: '2027-02-21T15:10:00.000Z' });
  assert.equal(again.status, 200);
  assert.equal(again.data.checked_out, 0);
  assert.equal(notices('lead').slice(told).length, 1);
  assert.equal(row(bix).checked_out_to_name, 'Bea Bell', 'the first record of who collected is kept');
  await unlift(ids.bo);
  await unlift(ids.bix);
});

test('releasing a held child is done by staff in the Hub, with a reason and who collected, and the lead is told', async () => {
  assert.equal((await place('north', ids.abe, 1)).status, 201);
  const abe = await checkIn(ids.abe, 'N2R8W');
  const body = (extra = {}) => ({ collector: { kind: 'household_adult', person_id: ids.ann, id_type: 'drivers_license' }, reason: 'Called a parent', ...extra });
  const go = (who, b = body(), id = abe) => api(who, 'POST', `/checkin/checkins/${id}/release-held`, b);
  assert.equal((await go(null)).status, 401);
  assert.equal((await asStation('POST', `/checkin/checkins/${abe}/release-held`, body())).status, 403, 'never an iPad');
  for (const who of ['volunteer', 'leaderNoSwitch', 'leaderSwitch', 'lead']) assert.equal((await go(who)).status, 403, who);
  assert.equal((await go('south')).status, 403, 'another campus');
  assert.equal((await go('north', body({ reason: '' }))).status, 400);
  assert.equal((await go('north', { reason: 'x' })).status, 400, 'a collector is required');
  assert.equal((await go('north', body({ collector: { kind: 'household_adult', person_id: ids.bea } }))).status, 400, 'an adult from another family');
  assert.equal((await go('north', body({ collector: { kind: 'pickup_contact', pickup_id: ids.granB } }))).status, 400, 'a pickup person from another family');
  assert.equal((await go('north', body({ collector: { kind: 'other', name: 'Sam Stranger', id_type: 'known' } }))).status, 400, 'someone not on the list needs photo ID');
  assert.equal((await go('north', body({ collector: { kind: 'other', name: '', id_type: 'passport' } }))).status, 400);
  assert.equal((await go('north', body({ collector: { kind: 'household_adult', person_id: ids.ann, id_type: 'wallet' } }))).status, 400, 'an invented kind of ID');
  assert.equal(row(abe).checked_out_at, null);
  const told = notices('lead').length;
  const ok = await go('north', body({ collector: { kind: 'other', name: 'Sam Uncle', relationship: 'Uncle', id_type: 'passport' }, reason: REASON }));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const r = row(abe);
  assert.deepEqual([r.checked_out_to_name, r.checked_out_to_relationship, r.checked_out_to_kind, r.checked_out_id_type, r.checked_out_held, r.checked_out_by],
    ['Sam Uncle', 'Uncle', 'other', 'passport', 1, 'north@mb.org']);
  assert.equal(r.checked_out_user_id, ids.north);
  assert.equal((await go('north')).status, 409, 'already checked out');
  // The hold stays on, the record shows it, and the reason is only in the audit log.
  assert.ok(db.prepare('SELECT 1 FROM checkin_holds WHERE person_id = ? AND lifted_at IS NULL').get(ids.abe));
  const co = events('checkout').find((e) => e.checkin_id === abe);
  assert.deepEqual([co.d.path, co.d.held, co.d.collector.kind, co.d.collector.id_type, co.user_name], ['hub', true, 'other', 'passport', 'north@mb.org']);
  assert.equal(events('checkout.held_released').find((e) => e.checkin_id === abe).d.via, 'hub');
  assert.match(db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.hold.release'").get().detail, /Called a parent|CANARY-WHY/);
  const heard = notices('lead').slice(told);
  assert.deepEqual(heard.map((x) => x.title), ['A child with a hold was released']);
  assert.ok(!heard[0].body.includes('CANARY') && heard[0].body.includes('Sam Uncle'));
  // A child with no hold isn't released this way.
  const bo = await checkIn(ids.bo, 'P3T9X');
  assert.equal((await go('staff', body({ collector: { kind: 'household_adult', person_id: ids.bea } }), bo)).status, 409);
  await unlift(ids.abe);
});

test('the safeguarding lead is told every time a hold is placed, changed or lifted, in the Hub and by email, without the child’s name or note in the email', async () => {
  mailbox.length = 0;
  const base0 = notices('lead').length;
  const made = await place('staff', ids.cy, 2);
  assert.equal(made.status, 201);
  assert.deepEqual(made.data.lead, { told: 1, fallback: false });
  assert.equal((await api('staff', 'PATCH', `/checkin/holds/${made.data.id}`, { note: `${NOTE} v2` })).status, 200);
  assert.equal((await api('staff', 'PATCH', `/checkin/holds/${made.data.id}`, { note: `${NOTE} v2` })).status, 200, 'saving the same note changes nothing');
  assert.equal((await lift('staff', made.data.id)).status, 200);
  const heard = notices('lead').slice(base0);
  assert.deepEqual(heard.map((x) => x.title), ['A check-in hold was placed', 'A check-in hold was changed', 'A check-in hold was lifted']);
  assert.equal(heard[0].kind, 'safety');
  assert.match(heard[0].body, /placed a hold on Cy Cruz at South/);
  assert.equal(heard[0].url, `/#/people/${ids.cy}`);
  assert.ok(heard.every((x) => !x.body.includes('CANARY')));
  // Email goes to the lead only, and never names the child or carries the note.
  const mails = mailbox.filter((m) => m.to === 'lead@mb.org');
  assert.equal(mails.length, 3);
  assert.ok(mails.every((m) => !/Cy|Cruz|CANARY/.test(m.subject + m.text + (m.html || ''))));
  assert.equal(mailbox.filter((m) => m.to !== 'lead@mb.org').length, 0, 'nobody else is emailed once a lead is named');
  assert.equal(notices('admin').filter((x) => x.kind === 'safety' && /hold was placed/.test(x.title)).length, 0);
});

test('until a lead is named every admin is told, and only an admin who covers every campus can name one', async () => {
  assert.equal((await api('staff', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead] })).status, 403);
  assert.equal((await api('limitedAdmin', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead] })).status, 403);
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: 'lead' })).status, 400);
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [99999] })).status, 400, 'an account that exists');
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [1, 2, 3, 4, 5, 6].map((i) => ids.admin + i) })).status, 400);
  assert.equal((await api('staff', 'GET', '/checkin/safeguarding')).data.fallback, false);
  assert.equal((await api('volunteer', 'GET', '/checkin/safeguarding')).status, 403);
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [] })).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/safeguarding')).data.fallback, true);
  const adminNotes = [notices('admin').length, notices('admin2').length, notices('limitedAdmin').length, notices('lead').length];
  const made = await place('north', ids.bix, 1);
  assert.equal(made.status, 201);
  assert.equal(made.data.lead.fallback, true);
  assert.deepEqual([notices('admin').length, notices('admin2').length, notices('limitedAdmin').length, notices('lead').length], [adminNotes[0] + 1, adminNotes[1] + 1, adminNotes[2] + 1, adminNotes[3]]);
  assert.match(notices('admin').at(-1).body, /No safeguarding lead is named yet/);
  await unlift(ids.bix);
  assert.equal((await api('admin2', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead, ids.north] })).data.leads.length, 2);
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead] })).status, 200);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.safeguarding'").get());
});

test('who collected: recorded from the family’s own list, checked, and kept with the ID type but never an ID number', async () => {
  const a = await checkIn(ids.bo, 'R5V2Y');
  // An iPad can only choose from the family's list: a household adult or a listed pickup person.
  const out = (collector, extra = {}, who = 'Lobby') => asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhB, ids: [a], collector, ...extra }, who);
  for (const bad of [{ kind: 'household_adult', person_id: ids.ann }, { kind: 'pickup_contact', pickup_id: ids.gran }, { kind: 'household_adult', person_id: ids.bo },
    { kind: 'other', name: 'Sam', id_type: 'passport' }, { kind: 'nobody' }, 'Bea', []]) {
    const r = await out(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await out({ kind: 'household_adult', person_id: ids.bea, id_type: 'wallet' })).status, 400);
  assert.equal(row(a).checked_out_at, null, 'a refused choice releases nobody');
  const okR = await out({ kind: 'household_adult', person_id: ids.bea, id_type: 'drivers_license', name: 'Spoofed Name' });
  assert.equal(okR.status, 200);
  const r = row(a);
  assert.deepEqual([r.checked_out_to_name, r.checked_out_to_kind, r.checked_out_id_type, r.checked_out_held, r.checked_out_by], ['Bea Bell', 'household_adult', 'drivers_license', 0, 'Lobby'], 'the name comes from the family’s record, not the iPad');
  const ev = events('checkout').find((e) => e.checkin_id === a);
  assert.deepEqual(ev.d.collector, { kind: 'household_adult', name: 'Bea Bell', relationship: '', id_type: 'drivers_license' });
  // Protected: nothing can rewrite it afterwards, not even by mistake.
  assert.throws(() => db.prepare("UPDATE checkins SET checked_out_to_name = 'Someone else' WHERE id = ?").run(a), /can’t be changed/);

  // A listed pickup person, with the ID left unchecked (the default is honest about it).
  const b = await checkIn(ids.bix, 'R5V3Y');
  const pk = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhB, ids: [b], collector: { kind: 'pickup_contact', pickup_id: ids.granB } });
  assert.equal(pk.status, 200);
  assert.deepEqual([row(b).checked_out_to_name, row(b).checked_out_to_relationship, row(b).checked_out_to_kind, row(b).checked_out_id_type], ['Gran Bell', 'Grandmother', 'pickup_contact', 'not_checked']);

  // Someone not on the list: staff in the Hub with photo ID, never an iPad (the iPad is told to fetch a coordinator).
  const c = await checkIn(ids.abby, 'R5V4Y');
  const other = { kind: 'other', name: 'Pat Neighbor', relationship: 'Neighbor', id_type: 'other_photo_id' };
  const viaStation = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [c], collector: other });
  assert.equal(viaStation.status, 400);
  assert.match(viaStation.data.error, /Only a staff member/);
  assert.equal((await api('leaderSwitch', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [c], collector: other })).status, 400);
  assert.equal((await api('staff', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [c], collector: { ...other, id_type: 'known' } })).status, 400);
  const viaStaff = await api('staff', 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhA, ids: [c], collector: other });
  assert.equal(viaStaff.status, 200);
  assert.deepEqual([row(c).checked_out_to_name, row(c).checked_out_to_kind, row(c).checked_out_id_type, row(c).checked_out_user_id], ['Pat Neighbor', 'other', 'other_photo_id', ids.staff]);

  // An offline release (a report) is never refused over its collector: it's kept as what the iPad said, marked unverified.
  const d = await checkIn(ids.abe, 'R5V5Y');
  const rep = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'report', ids: [d], at: '2027-02-21T15:15:00.000Z', collector: { kind: 'household_adult', person_id: ids.bea, name: 'Bea Bell', id_type: 'passport' } });
  assert.equal(rep.status, 200);
  assert.deepEqual([row(d).checked_out_to_name, row(d).checked_out_to_kind, row(d).checked_out_id_type], ['Bea Bell', 'unverified', 'passport']);

  // An older iPad sends no collector at all: the release works and says it wasn't recorded.
  const e = await checkIn(ids.bo, 'R5V6Y');
  const old = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: ids.hhB, ids: [e] }, 'Lobby', '2');
  assert.equal(old.status, 200);
  assert.deepEqual([row(e).checked_out_to_kind, row(e).checked_out_to_name], ['', '']);
  assert.equal(row(e).checked_out_id_type, '');

  // The person's page shows who collected to staff, not to a leader.
  const staffView = (await api('staff', 'GET', `/people/${ids.bo}`)).data.checkins.find((x) => x.id === a);
  assert.equal(staffView.checked_out_to_name, 'Bea Bell');
  const leaderView = (await api('leaderSwitch', 'GET', `/people/${ids.bo}`)).data.checkins[0];
  assert.deepEqual(Object.keys(leaderView).sort(), ['checked_in_at', 'kind', 'room']);
});

test('older iPads keep working, or are asked to reload: the new fields are additive and the 426 switch still holds', async () => {
  assert.ok(CHECKIN_APP_VERSION >= 4, 'this release changes how the iPad releases children');
  for (const version of ['1', '2', '3', null]) {
    const roster = await asStation('GET', '/checkin/roster?campus_id=1', undefined, 'Lobby', version);
    assert.equal(roster.status, 200, `version ${version}`);
    assert.ok(roster.data.households.length);
  }
  const c = await checkIn(ids.bix, 'S6W4Z');
  const out = await asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: 's6w4z' }, 'Lobby', '1');
  assert.equal(out.status, 200, 'the oldest shape still releases a child with no hold');
  assert.equal(row(c).checked_out_to_kind, '');
  // With "only the latest check-in" on, an iPad older than this release is turned away before it reads or changes anything.
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true })).status, 200);
  const refused = await asStation('GET', '/checkin/roster?campus_id=1', undefined, 'Lobby', '3');
  assert.equal(refused.status, 426);
  assert.equal(refused.data.reload, true);
  assert.equal((await asStation('GET', '/checkin/roster?campus_id=1')).status, 200);
  assert.equal((await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).status, 200);
});

test('a hold has to be lifted before its child’s duplicate record is merged', async () => {
  const dup = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_id, household_role) VALUES ('Abe', 'A', 1, ?, 'child')").run(ids.hhA).lastInsertRowid);
  const h = await place('north', dup, 1);
  assert.equal(h.status, 201);
  const merge = await api('admin', 'POST', `/people/${ids.abe}/merge`, { duplicate_id: dup });
  assert.equal(merge.status, 409);
  assert.match(merge.data.error, /check-in hold/);
  assert.equal((await lift('admin', h.data.id)).status, 200);
  assert.equal((await api('admin', 'POST', `/people/${ids.abe}/merge`, { duplicate_id: dup })).status, 200);
});

test('the iPad’s offline rules: a hold, a roster from before today, and the choice sent with a release', () => {
  const roster = { today: '2027-02-21', campus: { timezone: 'America/Chicago' } };
  assert.equal(rosterIsToday(roster, new Date('2027-02-21T15:30:00Z')), true);
  assert.equal(rosterIsToday(roster, new Date('2027-02-22T03:00:00Z')), true, 'still Sunday evening in Chicago');
  assert.equal(rosterIsToday(roster, new Date('2027-02-22T07:00:00Z')), false, 'Monday in Chicago');
  assert.equal(rosterIsToday(roster, new Date('2027-02-20T20:00:00Z')), false);
  assert.equal(rosterIsToday(null), false);
  assert.equal(rosterIsToday({ campus: {} }), false);
  assert.deepEqual(collectorChoice('adult:12', 'passport'), { kind: 'household_adult', person_id: 12, id_type: 'passport' });
  assert.deepEqual(collectorChoice('pickup:3', 'bogus'), { kind: 'pickup_contact', pickup_id: 3, id_type: 'not_checked' });
  assert.equal(collectorChoice('', 'passport'), null);
  assert.equal(collectorChoice('other:1', 'passport'), null);
  assert.equal(collectorChoice('adult:x', 'passport'), null);
});
