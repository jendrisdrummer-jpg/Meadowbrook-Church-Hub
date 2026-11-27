// Protected history, check-ins (child-safety V1, PR 3): a check-in is voided, never deleted. The database
// refuses the delete, DELETE answers 405 with guidance, a void needs a person and a reason, hides the row
// from every list, and is final. Dates are fixed, not today's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/history-app.js';

let app, db, call, ids, token;
const P = {};

before(async () => {
  app = await makeApp();
  ({ db, call, ids } = app);
  app.make('admin', 'admin', null, 'Ada Admin');
  app.make('staff', 'staff', null, 'Sam Staff');
  app.make('north', 'staff', '[1]', 'Nora North');
  app.make('volunteer', 'volunteer');
  token = await app.pair('Lobby', 1);
  const hh = app.add.household('Aldrin', 1);
  P.abe = app.add.person('Abe', 'Aldrin', hh, 'child');
  P.abby = app.add.person('Abby', 'Aldrin', hh, 'child');
  P.sam = app.add.person('Sam', 'Southern', app.add.household('Southern', 2), 'child');
  app.add.checkin('ci-abe-0001', P.abe);
  app.add.checkin('ci-abby-001', P.abby);
  app.add.checkin('ci-south-01', P.sam, { campus: 2 });
});
after(() => app.close());

const events = (action) => db.prepare('SELECT * FROM checkin_events WHERE action = ? ORDER BY id').all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const row = (id) => db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);

test('migration 42: the database refuses to delete a check-in, and a void can’t be undone', () => {
  assert.throws(() => db.prepare("DELETE FROM checkins WHERE id = 'ci-abe-0001'").run(), /kept for the record/);
  assert.throws(() => db.prepare('DELETE FROM checkins').run(), /kept for the record/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkins').get().n, 3);
  // Other edits are untouched: a check-in still gets checked out.
  assert.equal(db.prepare("UPDATE checkins SET checked_out_at = '2020-03-01T16:00:00.000Z' WHERE id = 'ci-abby-001'").run().changes, 1);
  db.prepare("UPDATE checkins SET checked_out_at = NULL WHERE id = 'ci-abby-001'").run();
});

test('DELETE says no (405) and points to Void; campus and access checks still come first', async () => {
  const staff = await call('staff', 'DELETE', '/checkin/checkins/ci-abe-0001');
  assert.equal(staff.status, 405);
  assert.match(staff.data.error, /Void/);
  assert.equal((await call({ station: token }, 'DELETE', '/checkin/checkins/ci-abe-0001')).status, 405);
  assert.equal((await call('north', 'DELETE', '/checkin/checkins/ci-south-01')).status, 403, 'another campus');
  assert.equal((await call('volunteer', 'DELETE', '/checkin/checkins/ci-abe-0001')).status, 403, 'not authorised for check-in');
  assert.equal((await call('staff', 'DELETE', '/checkin/checkins/nope')).status, 404);
  assert.equal(row('ci-abe-0001').voided_at, null, 'nothing changed');
});

test('void: who may, what it needs, and what it records', async () => {
  const url = '/checkin/checkins/ci-abe-0001/void';
  assert.equal((await call('volunteer', 'POST', url, { reason: 'x' })).status, 403);
  assert.equal((await call('north', 'POST', '/checkin/checkins/ci-south-01/void', { reason: 'wrong campus' })).status, 403);
  const ipad = await call({ station: token }, 'POST', url, { reason: 'x' });
  assert.equal(ipad.status, 403, 'an iPad can’t void');
  assert.match(ipad.data.error, /staff member/);
  assert.equal((await call(null, 'POST', url, { reason: 'x' })).status, 401);
  assert.equal((await call('staff', 'POST', url, { reason: 'x' }, { 'x-mb': '' })).status, 403, 'needs the x-mb header like every write');
  assert.equal((await call('staff', 'POST', url, {})).status, 400);
  assert.equal((await call('staff', 'POST', url, { reason: '   ' })).status, 400);
  assert.equal((await call('staff', 'POST', '/checkin/checkins/nope/void', { reason: 'x' })).status, 404);
  assert.equal(row('ci-abe-0001').voided_at, null);

  const ok = await call('staff', 'POST', url, { reason: 'Checked in by mistake: wrong child' });
  assert.equal(ok.status, 200);
  const r = row('ci-abe-0001');
  assert.ok(r.voided_at && !Number.isNaN(Date.parse(r.voided_at)));
  assert.deepEqual([r.voided_by, r.voided_by_name, r.void_reason], [ids.staff, 'Sam Staff', 'Checked in by mistake: wrong child']);
  // The record: one event naming the check-in and the account, with no free text; one audit row.
  const ev = events('checkin.void');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].checkin_id, ev[0].person_id, ev[0].user_id, ev[0].user_name, ev[0].campus_id], ['ci-abe-0001', P.abe, ids.staff, 'Sam Staff', 1]);
  assert.ok(!ev[0].detail.includes('mistake'));
  const audit = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'checkin.void'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, ids.staff);
  assert.equal(JSON.parse(audit[0].detail).checkin_id, 'ci-abe-0001');
  // Again: refused kindly, nothing rewritten.
  const again = await call('admin', 'POST', url, { reason: 'second try' });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /already voided/);
  assert.equal(row('ci-abe-0001').void_reason, 'Checked in by mistake: wrong child');
  assert.equal(events('checkin.void').length, 1);
});

test('a voided check-in is final, and still can’t be deleted', () => {
  assert.throws(() => db.prepare("UPDATE checkins SET voided_at = NULL WHERE id = 'ci-abe-0001'").run(), /stays voided/);
  assert.throws(() => db.prepare("UPDATE checkins SET void_reason = 'edited' WHERE id = 'ci-abe-0001'").run(), /stays voided/);
  assert.throws(() => db.prepare("DELETE FROM checkins WHERE id = 'ci-abe-0001'").run(), /kept for the record/);
  assert.equal(row('ci-abe-0001').void_reason, 'Checked in by mistake: wrong child');
});

test('a voided check-in leaves every list, and can’t be checked out', async () => {
  const day = '2020-03-01';
  const active = await call('staff', 'GET', `/checkin/active?campus_id=1&day=${day}`);
  assert.deepEqual(active.data.map((c) => c.id), ['ci-abby-001']);
  // By code, on a day that is today: once voided it is no longer found.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  db.prepare("INSERT INTO checkins (id, campus_id, person_id, kind, security_code, day, checked_in_at) VALUES ('ci-code-0001', 1, ?, 'kid', 'ZZ99', ?, ?)").run(P.abby, today, new Date().toISOString());
  assert.equal((await call('staff', 'POST', '/checkin/checkins/ci-code-0001/void', { reason: 'Test' })).status, 200);
  assert.equal((await call('staff', 'POST', '/checkin/checkout', { campus_id: 1, security_code: 'ZZ99' })).status, 404);
  assert.equal((await call('staff', 'GET', `/checkin/active?campus_id=1&day=${today}`)).data.length, 0);
  const byIds = await call('staff', 'POST', '/checkin/checkout', { campus_id: 1, ids: ['ci-abe-0001'] });
  assert.equal(byIds.status, 200);
  assert.equal(byIds.data.checked_out, 0, 'a voided check-in can’t be released');
  assert.equal(row('ci-abe-0001').checked_out_at, null);
  assert.equal(events('checkout.unknown').length, 1);
  // The person's page doesn't list it.
  const person = await call('staff', 'GET', `/people/${P.abe}`);
  assert.equal(person.data.checkins.length, 0);
  assert.equal((await call('staff', 'GET', `/people/${P.abby}`)).data.checkins.length, 1);
});

test('who may void what: staff any check-in at their campuses; leaders only an open one from today; never an iPad', async () => {
  app.make('lead', 'leader', '[1]', 'Lee Lead');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('checkin_user_ids', JSON.stringify([ids.lead]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const add = (id, day, out = null) => {
    app.add.checkin(id, P.abby, { day });
    if (out) db.prepare('UPDATE checkins SET checked_out_at = ? WHERE id = ?').run(out, id);
  };
  add('ci-lead-yday', '2020-03-01'); // an earlier day
  add('ci-lead-out', today, new Date().toISOString()); // today, but already released
  add('ci-lead-open', today);
  for (const id of ['ci-lead-yday', 'ci-lead-out']) {
    const r = await call('lead', 'POST', `/checkin/checkins/${id}/void`, { reason: 'x' });
    assert.equal(r.status, 403, id);
    assert.match(r.data.error, /staff member/);
    assert.equal(row(id).voided_at, null);
  }
  assert.equal((await call('lead', 'POST', '/checkin/checkins/ci-lead-open/void', { reason: 'Wrong child' })).status, 200);
  assert.equal(row('ci-lead-open').voided_by_name, 'Lee Lead');
  assert.equal((await call('lead', 'POST', '/checkin/checkins/ci-south-01/void', { reason: 'x' })).status, 403, 'another campus');
  assert.equal((await call('north', 'POST', '/checkin/checkins/ci-lead-yday/void', { reason: 'Staff may void an older one' })).status, 200);
  assert.equal((await call('staff', 'POST', '/checkin/checkins/ci-lead-out/void', { reason: 'Staff may void a released one' })).status, 200);
});

test('a re-sent check-in id never reads another campus’s row or a voided one', async () => {
  const body = (id) => ({ campus_id: 1, records: [{ id, person_id: P.abby, kind: 'kid', security_code: 'RS11', station: 'Lobby', checked_in_at: new Date().toISOString() }] });
  const other = await call({ station: token }, 'POST', '/checkin/checkins', body('ci-south-01'));
  assert.equal(other.status, 201);
  assert.deepEqual(other.data, [], 'nothing about the other campus’s check-in comes back');
  const voided = await call({ station: token }, 'POST', '/checkin/checkins', body('ci-abe-0001'));
  assert.deepEqual(voided.data, []);
  assert.equal(row('ci-south-01').person_id, P.sam, 'unchanged');
});
