// Medical details in three levels (child-safety V1, PR 5).
//   Level 1  allergen words, an EpiPen yes/no and a one-line action: on the iPad and on the label, everyone serving.
//   Level 2  the longer medical note: only on tap (GET /checkin/medical/:id), for a child checked in at that campus today,
//            to someone with check-in access, online, and every view is written to the check-in record.
//   Level 3  private care notes: staff in the Hub only, never on an iPad, never in the check-in record.
// Canary strings prove each level stays where it belongs. The clock is fixed, so no test depends on today's date.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { CHECKIN_APP_VERSION, level1, level1Text, SEE_LEADER } from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
const L1 = 'L1-ALLERGY-CANARY';
const L2 = 'L2-MEDICAL-CANARY';
const L3 = 'L3-CARE-CANARY';
const ACTION = 'ACTION-CANARY use the EpiPen';
let server, base, db, token, southToken;
const cookies = {};
const ids = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cm-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const make = (key, role, campuses, checkin = 0) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, checkin) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, checkin).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('staff', 'staff', null);
  make('north', 'staff', '[1]');
  make('south', 'staff', '[2]');
  make('leaderOn', 'leader', '[1]', 1); // a leader with the Kids' check-in switch
  make('leaderOff', 'leader', '[1]');
  make('volunteer', 'volunteer', null);

  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const person = (first, last, household, role, extra = {}) => Number(db.prepare(`INSERT INTO people
    (first_name, last_name, campus_id, household_id, household_role, birthdate, allergies, allergy_epi, allergy_action, medical_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(first, last, extra.campus ?? 1, household, role, role === 'child' ? '2020-01-01' : null, extra.allergies ?? '', extra.epi ?? 0, extra.action ?? '', extra.medical ?? '').lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhS = hh('Sol', 2);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult', { allergies: 'ADULT-ALLERGY', medical: 'ADULT-MEDICAL', epi: 1, action: 'ADULT-ACTION' });
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child', { allergies: `${L1} peanuts`, epi: 1, action: ACTION, medical: `${L2} asthma plan` });
  ids.abby = person('Abby', 'Aldrin', ids.hhA, 'child', { medical: `${L2} inhaler` });
  ids.ben = person('Ben', 'Aldrin', ids.hhA, 'child'); // nothing to sort
  ids.sal = person('Sal', 'Sol', ids.hhS, 'child', { campus: 2, allergies: 'SOUTH-ALLERGY', medical: 'SOUTH-MEDICAL' });
  db.prepare("INSERT INTO person_care_notes (person_id, note) VALUES (?, ?)").run(ids.abe, `${L3} family situation`);

  const pair = async (name, campus) => {
    const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
    assert.equal((await api('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus })).status, 201);
    return (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
  };
  token = await pair('Lobby', 1);
  southToken = await pair('SouthDesk', 2);
  const rec = (id, person) => ({ id, person_id: person, kind: 'kid', security_code: 'AK7Q3', station: 'Lobby', checked_in_at: '2027-02-21T15:00:00.000Z' });
  assert.equal((await asStation('POST', '/checkin/checkins', { campus_id: 1, records: [rec('md-abe-00001', ids.abe), rec('md-abby-0001', ids.abby)] })).status, 201);
  assert.equal((await asStation('POST', '/checkin/checkins', { campus_id: 1, records: [{ ...rec('md-ann-00001', ids.ann), kind: 'volunteer' }] })).status, 201);
  // Ben was checked in last week only.
  assert.equal((await asStation('POST', '/checkin/checkins', { campus_id: 1, records: [{ ...rec('md-ben-00001', ids.ben), checked_in_at: '2027-02-14T15:00:00.000Z' }] })).status, 201);
});
after(() => { mock.timers.reset(); server.close(); });

async function call(headers, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const api = (role, method, url, body) => call(role ? { cookie: cookies[role] } : {}, method, url, body);
const asStation = (method, url, body, tok = token, version = String(CHECKIN_APP_VERSION)) => call({ 'x-station': tok, ...(version == null ? {} : { 'x-checkin-version': version }) }, method, url, body);
const events = (action) => db.prepare('SELECT * FROM checkin_events WHERE action = ? ORDER BY id').all(action).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
const kidOf = (roster, id) => roster.households.flatMap((h) => h.members).find((m) => m.id === id);

test('Level 1 goes to the iPad (children only); Level 2 and Level 3 never ride on the roster or the list of who is in', async () => {
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1')).data;
  const abe = kidOf(roster, ids.abe);
  assert.deepEqual([abe.allergies, abe.allergy_epi, abe.allergy_action], [`${L1} peanuts`, 1, ACTION]);
  const ann = kidOf(roster, ids.ann);
  assert.deepEqual([ann.allergies, ann.allergy_epi, ann.allergy_action], [null, 0, ''], 'an adult’s details are never sent');
  const active = (await asStation('GET', '/checkin/active?campus_id=1')).data;
  const a = active.find((c) => c.id === 'md-abe-00001');
  assert.deepEqual([a.allergies, a.allergy_epi, a.allergy_action], [`${L1} peanuts`, 1, ACTION]);
  const adult = active.find((c) => c.id === 'md-ann-00001');
  assert.deepEqual([adult.allergies, adult.allergy_epi, adult.allergy_action], [null, 0, '']);
  // The same for a hub account with check-in access, and for a station on an older check-in.
  for (const res of [await api('leaderOn', 'GET', '/checkin/roster?campus_id=1'), await api('staff', 'GET', '/checkin/roster?campus_id=1'),
    await asStation('GET', '/checkin/roster?campus_id=1', undefined, token, '2'), await api('leaderOn', 'GET', '/checkin/active?campus_id=1')]) {
    const text = JSON.stringify(res.data);
    for (const secret of [L2, L3, 'ADULT-', 'medical_notes', 'care']) assert.ok(!text.includes(secret), `${secret} must not be sent`);
  }
  assert.ok(!JSON.stringify(roster).includes('SOUTH-'), 'another campus’s children are never in this roster');
});

test('an older iPad gets the safety line folded into allergies, so its label still says EPI', async () => {
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1', undefined, token, '2')).data;
  assert.equal(kidOf(roster, ids.abe).allergies, `EPI: YES · ${L1} peanuts · ${ACTION}`);
  const none = (await asStation('GET', '/checkin/roster?campus_id=1', undefined, token, null)).data;
  assert.equal(kidOf(none, ids.abe).allergies, `EPI: YES · ${L1} peanuts · ${ACTION}`);
  assert.equal(kidOf(none, ids.abby).allergies, '', 'a child with no Level 1 details stays blank');
  assert.equal(level1Text({ allergies: 'nuts', allergy_epi: 0, allergy_action: '' }), 'nuts');
  assert.equal(level1Text({ allergies: '', allergy_epi: 1, allergy_action: '' }), 'EPI: YES');
});

test('label lines: allergen words, EPI yes/no and a one-line action, never cut short', () => {
  assert.deepEqual(level1({ allergies: 'peanuts, egg', allergy_epi: 1, allergy_action: 'EpiPen, call 911' }, 40),
    { allergy: 'ALLERGY: peanuts, egg', epi: true, action: 'EpiPen, call 911' });
  assert.deepEqual(level1({ allergies: '', allergy_epi: 0, allergy_action: '' }, 40), { allergy: '', epi: false, action: '' });
  // Too long for the label: it says to see the room leader instead of printing half the words.
  const long = level1({ allergies: 'peanuts, tree nuts, egg, milk, soy, wheat, sesame, fish', allergy_epi: 0, allergy_action: 'x'.repeat(80) }, 34);
  assert.equal(long.allergy, SEE_LEADER);
  assert.equal(long.action, 'SEE ROOM LEADER');
  assert.ok(!long.allergy.includes('peanuts'));
  assert.equal(level1({ allergies: '  peanuts \n egg ', allergy_epi: 0 }, 40).allergy, 'ALLERGY: peanuts egg', 'line breaks and extra spaces are squeezed out');
});

test('Level 2 on tap: a station or an account with check-in access, one child checked in there today, and every look is recorded', async () => {
  const q = `?campus_id=1`;
  const res = await asStation('GET', `/checkin/medical/${ids.abe}${q}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.deepEqual(res.data, { person_id: ids.abe, allergies: `${L1} peanuts`, allergy_epi: 1, allergy_action: ACTION, medical_notes: `${L2} asthma plan` });
  const seen = events('medical.view');
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].person_id, seen[0].household_id, seen[0].checkin_id, seen[0].campus_id, seen[0].device_name, seen[0].user_id], [ids.abe, ids.hhA, 'md-abe-00001', 1, 'Lobby', null]);
  assert.ok(!JSON.stringify(seen).includes(L2) && !JSON.stringify(seen).includes(L1), 'the record holds who looked, never what they saw');
  // A hub account is named in the record.
  assert.equal((await api('leaderOn', 'GET', `/checkin/medical/${ids.abby}${q}`)).data.medical_notes, `${L2} inhaler`);
  assert.equal((await api('staff', 'GET', `/checkin/medical/${ids.abe}${q}`)).status, 200);
  const hub = events('medical.view').filter((e) => e.user_id != null);
  assert.deepEqual(hub.map((e) => e.user_id), [ids.leaderOn, ids.staff]);
  assert.equal(events('medical.view').length, 3, 'one row for each look');
  // The staff review of the record shows it.
  const day = (await api('staff', 'GET', '/checkin/events?campus_id=1&day=2027-02-21&action=medical.view')).data.events;
  assert.equal(day.length, 3);
});

test('Level 2 refusals: no sign-in, no switch, another campus, not checked in today, an adult, a voided check-in, an old iPad when refused', async () => {
  const q = '?campus_id=1';
  const before = events('medical.view').length;
  assert.equal((await api(null, 'GET', `/checkin/medical/${ids.abe}${q}`)).status, 401);
  assert.equal((await api('leaderOff', 'GET', `/checkin/medical/${ids.abe}${q}`)).status, 403, 'a leader needs the Kids’ check-in switch');
  assert.equal((await api('volunteer', 'GET', `/checkin/medical/${ids.abe}${q}`)).status, 403);
  assert.equal((await api('south', 'GET', `/checkin/medical/${ids.abe}${q}`)).status, 403, 'a campus-limited account can’t ask at another campus');
  assert.equal((await asStation('GET', `/checkin/medical/${ids.abe}${q}`, undefined, southToken)).status, 403, 'a station is held to its own campus');
  assert.equal((await asStation('GET', `/checkin/medical/${ids.abe}?campus_id=2`, undefined, southToken)).status, 404, 'a child not checked in at South');
  assert.equal((await asStation('GET', `/checkin/medical/${ids.sal}?campus_id=2`, undefined, southToken)).status, 404, 'not checked in today');
  assert.equal((await asStation('GET', `/checkin/medical/${ids.ben}${q}`)).status, 404, 'checked in last week only');
  assert.equal((await asStation('GET', `/checkin/medical/${ids.ann}${q}`)).status, 404, 'an adult’s details are never served');
  assert.equal((await asStation('GET', `/checkin/medical/abc${q}`)).status, 400);
  assert.equal((await asStation('GET', `/checkin/medical/${ids.abe}`)).status, 404, 'a campus is needed, as for the roster');
  assert.equal(events('medical.view').length, before, 'a refusal is not a view');
  // A voided check-in no longer opens the note (a void is final, so Abby has no check-in for the rest of this file).
  db.prepare("UPDATE checkins SET voided_at = '2027-02-21T15:20:00.000Z', voided_by_name = 'x', void_reason = 'test' WHERE id = 'md-abby-0001'").run();
  assert.equal((await asStation('GET', `/checkin/medical/${ids.abby}${q}`)).status, 404);
  // When the admin requires the latest check-in, an older iPad is told to reopen rather than served.
  await api('admin', 'PATCH', '/checkin/safety', { require_current_app: true });
  const old = await asStation('GET', `/checkin/medical/${ids.abe}${q}`, undefined, token, '2');
  assert.equal(old.status, 426);
  await api('admin', 'PATCH', '/checkin/safety', { require_current_app: false });
});

test('Level 3 care notes: staff only, campus-checked, audited, and never on an iPad, in a roster or in the record', async () => {
  const path3 = `/people/${ids.abe}/care-notes`;
  const read = await api('staff', 'GET', path3);
  assert.equal(read.status, 200);
  assert.equal(read.data.note, `${L3} family situation`);
  assert.match(read.headers.get('cache-control'), /no-store/);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'person.care_notes.view' AND user_id = ?").get(ids.staff), 'opening them is audited');
  // Who can't read or write them.
  for (const who of [null, 'leaderOn', 'leaderOff', 'volunteer']) {
    assert.ok([401, 403].includes((await api(who, 'GET', path3)).status), `${who} can't read`);
    assert.ok([401, 403].includes((await api(who, 'PUT', path3, { note: 'x' })).status), `${who} can't write`);
  }
  assert.ok([401, 403].includes((await asStation('GET', path3)).status), 'an iPad can’t reach care notes');
  assert.ok([401, 403].includes((await asStation('PUT', path3, { note: 'x' })).status));
  assert.equal((await api('south', 'GET', path3)).status, 403, 'staff at another campus can’t read them');
  assert.equal((await api('north', 'GET', path3)).status, 200);
  // Writing: audited with the length, never the text.
  assert.equal((await api('staff', 'PUT', path3, { note: `${L3} updated` })).status, 200);
  assert.equal((await api('staff', 'GET', path3)).data.note, `${L3} updated`);
  assert.equal((await api('staff', 'PUT', path3, {})).status, 400);
  assert.equal((await api('staff', 'PUT', path3, { note: 'x'.repeat(5001) })).status, 400);
  const audit = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  assert.ok(!audit.includes(L3) && !audit.includes(L2), 'the audit log holds who and how long, never the text');
  // The note is not anywhere a leader, a station or the check-in record can see.
  const person = JSON.stringify((await api('leaderOn', 'GET', `/people/${ids.abe}`)).data);
  for (const secret of [L1, L2, L3, 'allergy_epi', 'allergy_action', 'medical_sorted_at']) assert.ok(!person.includes(secret), `a leader's view of the child hides ${secret}`);
  const staffView = (await api('staff', 'GET', `/people/${ids.abe}`)).data;
  assert.equal(staffView.allergy_epi, 1);
  assert.ok(!JSON.stringify(staffView).includes(L3), 'care notes are fetched on their own, not sent with the profile');
  const record = JSON.stringify(db.prepare('SELECT * FROM checkin_events').all());
  for (const secret of [L1, L2, L3, ACTION]) assert.ok(!record.includes(secret), `the check-in record never holds ${secret}`);
});

test('the review list: children with details nobody has sorted, a count per campus, staff only, campus-scoped', async () => {
  const all = (await api('staff', 'GET', '/checkin/medical/review')).data;
  assert.deepEqual(all.rows.map((r) => r.first_name).sort(), ['Abby', 'Abe', 'Sal'], 'Ben has nothing to sort and Ann is an adult');
  assert.equal(all.remaining, 3);
  assert.deepEqual(Object.fromEntries(all.by_campus.map((c) => [c.campus_id, c.remaining])), { 1: 2, 2: 1 });
  assert.equal((await api('staff', 'GET', '/checkin/medical/review?campus_id=2')).data.rows.length, 1);
  const north = (await api('north', 'GET', '/checkin/medical/review')).data;
  assert.deepEqual([north.remaining, north.rows.map((r) => r.first_name).sort()], [2, ['Abby', 'Abe']], 'a campus-limited account only counts their own campus');
  assert.equal((await api('north', 'GET', '/checkin/medical/review?campus_id=2')).status, 403);
  for (const who of [null, 'leaderOn', 'leaderOff', 'volunteer']) assert.ok([401, 403].includes((await api(who, 'GET', '/checkin/medical/review')).status), who);
  assert.ok([401, 403].includes((await asStation('GET', '/checkin/medical/review?campus_id=1')).status), 'an iPad never sees the review list');
  assert.equal(all.rows.find((r) => r.first_name === 'Abe').has_care_notes, 1);

  // Sorting a child takes them off the list; changing their details afterwards puts them back.
  assert.equal((await api('north', 'PATCH', `/people/${ids.abby}`, { medical_sorted: true })).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/medical/review')).data.remaining, 2);
  assert.ok(db.prepare('SELECT medical_sorted_at FROM people WHERE id = ?').get(ids.abby).medical_sorted_at);
  assert.equal((await api('north', 'PATCH', `/people/${ids.abby}`, { nickname: 'Abs' })).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/medical/review')).data.remaining, 2, 'an unrelated change leaves them sorted');
  assert.equal((await api('north', 'PATCH', `/people/${ids.abby}`, { allergy_epi: true, allergy_action: 'Inhaler, 2 puffs' })).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/medical/review')).data.remaining, 3, 'new details are looked at again');
  // Editing and saying "sorted" in the same save keeps them sorted.
  assert.equal((await api('north', 'PATCH', `/people/${ids.abby}`, { allergies: 'bees', medical_sorted: true })).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/medical/review')).data.remaining, 2);
  // Another campus's staff can't sort this child.
  assert.equal((await api('south', 'PATCH', `/people/${ids.abe}`, { medical_sorted: true })).status, 403);
  // A leader can't mark anyone sorted or change Level 1 (editing people is for staff).
  assert.equal((await api('leaderOn', 'PATCH', `/people/${ids.abe}`, { medical_sorted: true })).status, 403);
  // The Level 1 fields are limited so a label can hold them.
  const long = await api('staff', 'PATCH', `/people/${ids.abe}`, { allergy_action: 'x'.repeat(500) });
  assert.equal(long.status, 200);
  assert.equal(long.data.allergy_action.length, 120);
});

test('merging keeps the safer Level 1 details, un-sorts the child, and keeps care notes private to one record', async () => {
  const dup = Number(db.prepare(`INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, allergies, allergy_epi, allergy_action)
    VALUES ('Abbey', 'Aldrin', 1, ?, 'child', 'DUP-ALLERGY', 1, 'DUP-ACTION')`).run(ids.hhA).lastInsertRowid);
  db.prepare('INSERT INTO person_care_notes (person_id, note) VALUES (?, ?)').run(dup, 'DUP-CARE');
  assert.equal((await api('admin', 'PATCH', `/people/${ids.ben}`, { medical_sorted: true })).status, 200);
  const keep = ids.ben; // has nothing, so inherits everything
  assert.equal((await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  const merged = db.prepare('SELECT allergies, allergy_epi, allergy_action, medical_sorted_at FROM people WHERE id = ?').get(keep);
  assert.deepEqual([merged.allergies, merged.allergy_epi, merged.allergy_action, merged.medical_sorted_at], ['DUP-ALLERGY', 1, 'DUP-ACTION', null]);
  assert.equal(db.prepare('SELECT note FROM person_care_notes WHERE person_id = ?').get(keep).note, 'DUP-CARE', 'moves to the kept child, who had none');
  // A kept child who already has care notes keeps theirs; the other stays on the archived record.
  const dup2 = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_id, household_role) VALUES ('Abbie', 'Aldrin', 1, ?, 'child')").run(ids.hhA).lastInsertRowid);
  db.prepare('INSERT INTO person_care_notes (person_id, note) VALUES (?, ?)').run(dup2, 'SECOND-CARE');
  assert.equal((await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup2 })).status, 200);
  assert.equal(db.prepare('SELECT note FROM person_care_notes WHERE person_id = ?').get(keep).note, 'DUP-CARE');
  assert.equal(db.prepare('SELECT note FROM person_care_notes WHERE person_id = ?').get(dup2).note, 'SECOND-CARE');
});

test('a station adding a new child can say they carry an EpiPen, and a station can’t set anything else medical', async () => {
  const kid = await asStation('POST', '/people', { first_name: 'Nia', last_name: 'Aldrin', birthdate: '2021-03-03', allergies: 'bees', allergy_epi: true,
    household_id: ids.hhA, household_role: 'child', campus_id: 1, status: 'guest', force: true });
  assert.equal(kid.status, 201);
  const p = db.prepare('SELECT allergies, allergy_epi, medical_sorted_at FROM people WHERE id = ?').get(kid.data.id);
  assert.deepEqual([p.allergies, p.allergy_epi, p.medical_sorted_at], ['bees', 1, null], 'it goes on the review list');
  // A station can't mark anything as sorted, however it asks.
  const sneaky = await asStation('POST', '/people', { first_name: 'Sam', last_name: 'Aldrin', medical_sorted_at: '2020-01-01', medical_sorted: true,
    household_id: ids.hhA, household_role: 'child', campus_id: 1, status: 'guest', force: true });
  assert.equal(sneaky.status, 201);
  assert.equal(db.prepare('SELECT medical_sorted_at FROM people WHERE id = ?').get(sneaky.data.id).medical_sorted_at, null);
  assert.equal((await asStation('PATCH', `/people/${kid.data.id}`, { medical_sorted: true })).status, 401, 'stations can’t edit people');
});

test('security review: family campus counts for care notes and the review list; Level 2 tightened and flagged', async () => {
  // A child with no campus of their own whose family is at South: North staff can't open care notes or see them for review.
  const southKid = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, medical_notes) VALUES ('Sky', 'Sol', NULL, ?, 'child', 'SKY-MEDICAL')").run(ids.hhS).lastInsertRowid);
  assert.equal((await api('north', 'GET', `/people/${southKid}/care-notes`)).status, 403);
  assert.equal((await api('north', 'PUT', `/people/${southKid}/care-notes`, { note: 'x' })).status, 403);
  assert.equal((await api('south', 'GET', `/people/${southKid}/care-notes`)).status, 200);
  const northReview = await api('north', 'GET', '/checkin/medical/review');
  assert.ok(!northReview.data.rows.some((r) => r.id === southKid) && !JSON.stringify(northReview.data).includes('SKY-MEDICAL'));
  assert.ok((await api('south', 'GET', '/checkin/medical/review')).data.rows.some((r) => r.id === southKid));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin.medical.review'").get(), 'opening the review list is audited');

  // A child with no family whose own campus is South can't be read at North, even once checked in there.
  const loner = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_role, medical_notes) VALUES ('Lou', 'Ner', 2, 'child', 'LOU-MEDICAL')").run().lastInsertRowid);
  await api('leaderOn', 'POST', '/checkin/checkins', { campus_id: 1, records: [{ id: 'md-lou-000001', person_id: loner, kind: 'kid', security_code: 'AZZZ2', checked_in_at: '2027-02-21T15:10:00.000Z' }] });
  assert.equal((await api('leaderOn', 'GET', `/checkin/medical/${loner}?campus_id=1`)).status, 404);

  // A read by whoever made the check-in is flagged in the record.
  const ben2 = Number(db.prepare("INSERT INTO people (first_name, last_name, campus_id, household_id, household_role, medical_notes) VALUES ('Bo', 'Aldrin', 1, ?, 'child', 'BO-MEDICAL')").run(ids.hhA).lastInsertRowid);
  assert.equal((await api('leaderOn', 'POST', '/checkin/checkins', { campus_id: 1, records: [{ id: 'md-bo-0000001', person_id: ben2, kind: 'kid', security_code: 'AZZZ3', checked_in_at: '2027-02-21T15:11:00.000Z' }] })).status, 201);
  assert.equal((await api('leaderOn', 'GET', `/checkin/medical/${ben2}?campus_id=1`)).status, 200);
  assert.equal(events('medical.view').at(-1).d.self_checkin, true);
  assert.equal((await asStation('GET', `/checkin/medical/${ben2}?campus_id=1`)).status, 200);
  assert.equal(events('medical.view').at(-1).d.self_checkin, false);

  // After pickup, only staff can still read it.
  assert.equal((await api('staff', 'POST', '/checkin/checkout', { campus_id: 1, ids: ['md-bo-0000001'] })).status < 300, true);
  assert.equal((await asStation('GET', `/checkin/medical/${ben2}?campus_id=1`)).status, 404);
  assert.equal((await api('leaderOn', 'GET', `/checkin/medical/${ben2}?campus_id=1`)).status, 404);
  assert.equal((await api('staff', 'GET', `/checkin/medical/${ben2}?campus_id=1`)).status, 200);
});
