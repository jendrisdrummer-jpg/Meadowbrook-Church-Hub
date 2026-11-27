// Check-in settings (child-safety V1, PR 7): each church switches the parts of check-in that don't fit its process.
// Covers: who can read and change the settings; check-out by matching tag (no iPad check-out, a day-scoped "in the room");
// holds that only warn (check-in goes ahead, the iPad is told, the safeguarding lead is told, the private note goes nowhere) or
// are off; the Care note button; what a name tag says when allergy details are too long; automatic check-in access for the
// leaders of chosen teams; and a hold placed at another campus still showing as a hold.
// The clock is fixed (Date only) before any session is made, so no test depends on today's date.
import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, setSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { outbox as mailbox } from '../server/mail.js';
import {
  CHECKIN_APP_VERSION, LABELS, labelStrips, labelSafety, level1, kidLabelHtml, parentTagHtml, labelName, featuresOf, holdAlertText, holdLeaveText,
  SMALLEST_SCALE, SEE_ROOM_LEADER, SEE_DESK,
} from '../public/js/checkin-rules.js';

const T0 = '2027-02-21T15:30:00Z'; // a Sunday, 9:30 in Chicago
const NOTE = 'CANARY-NOTE-7Q custody order, see the blue folder';
const REASON = 'CANARY-WHY-4K court order ended';
let server, base, db, tokens;
const cookies = {};
const ids = {};

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-settings-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const hh = (name, campus) => Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(name, campus).lastInsertRowid);
  const person = (first, last, household, role, extra = {}) => Number(db.prepare(`INSERT INTO people
    (first_name, last_name, campus_id, household_id, household_role, birthdate) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(first, last, extra.campus ?? 1, household, role, role === 'child' ? '2020-01-01' : null).lastInsertRowid);
  ids.hhA = hh('Aldrin', 1); ids.hhB = hh('Bell', 1); ids.hhD = hh('Dunn', 1);
  ids.ann = person('Ann', 'Aldrin', ids.hhA, 'adult');
  ids.abe = person('Abe', 'Aldrin', ids.hhA, 'child');
  ids.abby = person('Abby', 'Aldrin', ids.hhA, 'child');
  ids.bea = person('Bea', 'Bell', ids.hhB, 'adult');
  ids.bo = person('Bo', 'Bell', ids.hhB, 'child');
  ids.dan = person('Dan', 'Dunn', ids.hhD, 'adult');
  ids.dee = person('Dee', 'Dunn', ids.hhD, 'child', { campus: 2 }); // the child is recorded at South, the family belongs to North
  // People who lead (or only belong to) teams.
  for (const [key, campus] of [['pLeaderN', 1], ['pLeaderS', 2], ['pVolLead', 1], ['pLeaderAll', 1], ['pMember', 1], ['pArchLead', 1]]) ids[key] = person(key, 'Leader', null, 'adult', { campus });
  ids.teamKids = Number(db.prepare("INSERT INTO teams (name, campus_id) VALUES ('Children’s ministry', NULL)").run().lastInsertRowid);
  ids.teamOther = Number(db.prepare("INSERT INTO teams (name, campus_id) VALUES ('Parking', NULL)").run().lastInsertRowid);
  ids.teamOld = Number(db.prepare("INSERT INTO teams (name, campus_id, archived) VALUES ('Old team', NULL, 1)").run().lastInsertRowid);
  const lead = (team, p, isLeader = 1) => db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, ?)').run(team, p, isLeader);
  lead(ids.teamKids, ids.pLeaderN); lead(ids.teamKids, ids.pLeaderS); lead(ids.teamKids, ids.pVolLead); lead(ids.teamKids, ids.pLeaderAll);
  lead(ids.teamKids, ids.pMember, 0); lead(ids.teamOld, ids.pArchLead); lead(ids.teamOther, ids.pLeaderN);

  const make = (key, role, campuses, { checkin = 0, person: pid = null } = {}) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, checkin, person_id) VALUES (?, ?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, checkin, pid).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
    ids[key] = Number(id);
  };
  make('admin', 'admin', null);
  make('limitedAdmin', 'admin', '[1]');
  make('staff', 'staff', null);
  make('north', 'staff', '[1]');
  make('south', 'staff', '[2]');
  make('leaderSwitch', 'leader', '[1]', { checkin: 1 });
  make('leaderNoSwitch', 'leader', '[1]');
  make('volunteer', 'volunteer', null);
  make('lead', 'volunteer', null);
  make('autoN', 'leader', '[1]', { person: ids.pLeaderN });
  make('autoS', 'leader', '[2]', { person: ids.pLeaderS });
  make('autoVol', 'volunteer', null, { person: ids.pVolLead }); // below leader with no campus list: refused on a church with two campuses
  make('autoAll', 'leader', null, { person: ids.pLeaderAll });
  make('autoMember', 'leader', '[1]', { person: ids.pMember });
  make('autoArch', 'leader', '[1]', { person: ids.pArchLead });

  tokens = {};
  for (const [name, campus] of [['Lobby', 1], ['SouthDesk', 2]]) {
    const p = (await api(null, 'POST', '/checkin/pair', { device: 'iPad' })).data;
    assert.equal((await api('admin', 'POST', '/checkin/devices', { code: p.code, name, campus_id: campus })).status, 201);
    tokens[name] = (await api(null, 'GET', `/checkin/pair/${p.secret}`)).data.token;
  }
  assert.equal((await api('admin', 'PUT', '/checkin/safeguarding', { lead_ids: [ids.lead] })).status, 200);
});
after(() => { mock.timers.reset(); server.close(); });
afterEach(() => noPrivateText());

// The note and the reasons are for the Hub's hold screens only (reasons also sit in the audit log, which only admins read).
function noPrivateText() {
  const record = JSON.stringify([db.prepare('SELECT * FROM checkin_events').all(), db.prepare('SELECT * FROM notifications').all(), mailbox]);
  assert.ok(!record.includes('CANARY'), 'the private note or a reason leaked into the record, a notification or an email');
  assert.ok(!db.prepare('SELECT detail FROM audit_log').all().map((x) => x.detail).join().includes('CANARY-NOTE'), 'the private note reached the audit log');
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
const audits = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action).map((a) => ({ ...a, d: JSON.parse(a.detail) }));
const DEFAULTS = { checkout: 'ipad', holds: 'block', medical_tap: true, label_overflow: 'leader', auto_team_ids: [] };
// Sets the settings directly (setup for a test); the routes' own rules are tested through the API below.
const setFeatures = (f = {}) => setSetting(db, 'checkin_features', { ...DEFAULTS, ...f });
let n = 0;
// Checks a child in through a station, returning the whole answer.
async function checkIn(person, code, { who = 'Lobby', at = '2027-02-21T15:00:00.000Z', campus = who === 'SouthDesk' ? 2 : 1 } = {}) {
  const id = `ci-${String(++n).padStart(4, '0')}-set`;
  const r = await asStation('POST', '/checkin/checkins', { campus_id: campus, records: [{ id, person_id: person, kind: 'kid', security_code: code, station: who, checked_in_at: at }] }, who);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { id, r };
}
const place = (who, person, campus = 1, note = NOTE) => api(who, 'POST', '/checkin/holds', { person_id: person, campus_id: campus, note });
const unlift = async (person) => { const h = db.prepare('SELECT id FROM checkin_holds WHERE person_id = ? AND lifted_at IS NULL').get(person); if (h) assert.equal((await api('admin', 'DELETE', `/checkin/holds/${h.id}`, { reason: REASON })).status, 200); };
const collector = (adult = ids.ann) => ({ kind: 'household_adult', person_id: adult, id_type: 'drivers_license' });
const outRequest = (who, ciId, household = ids.hhA, adult = ids.ann) => (who === 'Lobby' || who === 'SouthDesk'
  ? asStation('POST', '/checkin/checkout', { campus_id: who === 'SouthDesk' ? 2 : 1, mode: 'request', household_id: household, ids: [ciId], collector: collector(adult) }, who)
  : api(who, 'POST', '/checkin/checkout', { campus_id: 1, mode: 'request', household_id: household, ids: [ciId], collector: collector(adult) }));

// ---------------------------------------------------------------- reading and changing the settings
test('the settings start as the public product’s: check out on the iPad, block a held child, care notes on, “see room leader”, no automatic teams', async () => {
  assert.equal((await api(null, 'GET', '/checkin/settings')).status, 401);
  for (const who of ['volunteer', 'leaderNoSwitch', 'lead']) assert.equal((await api(who, 'GET', '/checkin/settings')).status, 403, who);
  for (const who of ['staff', 'north', 'admin', 'limitedAdmin', 'leaderSwitch']) {
    const r = await api(who, 'GET', '/checkin/settings');
    assert.equal(r.status, 200, who);
    assert.deepEqual({ ...r.data, auto_teams: undefined }, { ...DEFAULTS, auto_teams: undefined }, who);
  }
  // The iPad reads them with its own token, and they ride along on its roster.
  const s = await asStation('GET', '/checkin/settings');
  assert.equal(s.status, 200);
  assert.equal(s.data.checkout, 'ipad');
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1')).data;
  assert.deepEqual(roster.features, { checkout: 'ipad', holds: 'block', medical_tap: true, label_overflow: 'leader' });
  assert.ok(!('auto_team_ids' in roster.features), 'who gets check-in automatically is not the iPad’s business');
  assert.deepEqual((await asStation('GET', '/checkin/station')).data.features, roster.features);
  // They are not in the general settings, and can't be changed through them.
  assert.ok(!('checkin_features' in (await api('admin', 'GET', '/settings')).data));
  await api('admin', 'PATCH', '/settings', { checkin_features: { checkout: 'tag' } });
  assert.equal((await api('staff', 'GET', '/checkin/settings')).data.checkout, 'ipad');
});

test('only an admin who covers every campus can change them; every change is audited with the old and new values', async () => {
  const body = { checkout: 'tag', holds: 'alert' };
  assert.equal((await api(null, 'PUT', '/checkin/settings', body)).status, 401);
  for (const who of ['volunteer', 'leaderSwitch', 'north', 'staff', 'lead', 'autoN']) assert.equal((await api(who, 'PUT', '/checkin/settings', body)).status, 403, who);
  assert.equal((await asStation('PUT', '/checkin/settings', body)).status, 403, 'an iPad can never change them');
  assert.equal((await api('limitedAdmin', 'PUT', '/checkin/settings', body)).status, 403, 'an admin limited to some campuses can read but not change');
  assert.equal((await api('staff', 'GET', '/checkin/settings')).data.checkout, 'ipad', 'nothing changed');
  assert.equal(audits('checkin.settings').length, 0);

  // Until holds have been chosen on purpose, they follow the way children go home.
  const first = await api('admin', 'PUT', '/checkin/settings', { checkout: 'tag' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.checkout, 'tag');
  assert.equal(first.data.holds, 'alert', 'matching tags: nothing to block, so the default is to warn');
  const a = audits('checkin.settings');
  assert.equal(a.length, 1);
  assert.equal(a[0].user_id, ids.admin);
  assert.equal(a[0].d.from.checkout, 'ipad');
  assert.equal(a[0].d.to.checkout, 'tag');
  assert.deepEqual(a[0].d.changed.sort(), ['checkout', 'holds']);
  assert.equal(events('safety.settings').length >= 1, true, 'the check-in record notes that a setting changed');
  assert.equal(audits('checkin.settings.auto_teams').length, 0, 'the teams entry is only for a change to the teams');

  // Saving what is already there changes nothing and is not recorded as a change.
  assert.equal((await api('admin', 'PUT', '/checkin/settings', { checkout: 'tag' })).status, 200);
  assert.equal(audits('checkin.settings').length, 1);
});

test('what can’t be saved: unknown choices, wrong types, a block with matching tags, teams that don’t exist', async () => {
  const bad = async (body, pattern) => {
    const r = await api('admin', 'PUT', '/checkin/settings', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    if (pattern) assert.match(r.data.error, pattern);
  };
  setFeatures({ checkout: 'ipad', holds: 'block' });
  await bad({}, /Nothing to change/);
  await bad([], /Nothing to change/);
  await bad({ checkout: 'both' });
  await bad({ checkout: null });
  await bad({ holds: 'strict' });
  await bad({ medical_tap: 'yes' });
  await bad({ medical_tap: 1 });
  await bad({ label_overflow: 'tiny' });
  await bad({ auto_team_ids: 'all' });
  await bad({ auto_team_ids: [1.5] });
  await bad({ auto_team_ids: ['1'] });
  await bad({ auto_team_ids: [999999] }, /Choose teams from the list/);
  await bad({ auto_team_ids: [ids.teamOld] }, /archived/);
  await bad({ auto_team_ids: Array.from({ length: 101 }, (_, i) => i + 1) });
  await bad({ colour: 'blue' }, /isn’t a check-in setting/);
  // Block with tag: said together, or built up from what is already saved.
  await bad({ checkout: 'tag', holds: 'block' }, /Warn at check-in|Off/);
  await bad({ checkout: 'tag' }, /Warn at check-in|Off/); // holds were saved as "block", so this would end up tag + block
  setFeatures({ checkout: 'tag', holds: 'alert' });
  await bad({ holds: 'block' }, /Blocking check-out only works/);
  assert.equal((await api('admin', 'PUT', '/checkin/settings', { checkout: 'ipad', holds: 'block' })).status, 200, 'both together, the other way, is fine');
  assert.deepEqual(db.prepare("SELECT value FROM settings WHERE key = 'checkin_features'").get() && JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'checkin_features'").get().value),
    { ...DEFAULTS, checkout: 'ipad', holds: 'block' });
  // A stored tag + block (it can't be saved, but a hand edit could) is read as "warn", never as "block".
  setSetting(db, 'checkin_features', { checkout: 'tag', holds: 'block' });
  assert.equal((await api('staff', 'GET', '/checkin/settings')).data.holds, 'alert');
  setSetting(db, 'checkin_features', 'junk');
  assert.deepEqual({ ...(await api('staff', 'GET', '/checkin/settings')).data, auto_teams: undefined }, { ...DEFAULTS, auto_teams: undefined }, 'unreadable settings read as the defaults');
  setFeatures();
});

// ---------------------------------------------------------------- matching tags: no check-out on the iPad
test('matching tags: an iPad is told “not here” (409, checkout_off) and nothing is checked out; staff in the Hub still can', async () => {
  setFeatures({ checkout: 'tag', holds: 'alert' });
  const { id } = await checkIn(ids.abe, 'K7Q3M');
  const { id: id2 } = await checkIn(ids.abby, 'K7Q3M');
  const refused = await outRequest('Lobby', id);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.reason, 'checkout_off');
  assert.match(refused.data.error, /matching tag/);
  // The older shapes an old iPad might still send are turned away the same way.
  assert.equal((await asStation('POST', '/checkin/checkout', { campus_id: 1, security_code: 'K7Q3M' })).data.reason, 'checkout_off');
  assert.equal((await asStation('POST', '/checkin/checkout', { campus_id: 1, ids: [id] }, 'Lobby', '2')).status, 409);
  // A leader with the Kids' check-in switch, signed in on a browser, is treated as an iPad.
  assert.equal((await outRequest('leaderSwitch', id)).data.reason, 'checkout_off');
  assert.equal(row(id).checked_out_at, null);
  assert.equal(row(id2).checked_out_at, null);
  assert.equal(events('checkout').length, 0);
  // Staff in the Hub can.
  const ok = await outRequest('staff', id);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.checked_out, 1);
  assert.ok(row(id).checked_out_at, 'the check-out is real, and the same one the Hub always made');
  assert.equal(row(id).checked_out_to_name, 'Ann Aldrin');
  // A report of a release that already happened (an iPad that left the room before this was switched on) is still recorded.
  const report = await asStation('POST', '/checkin/checkout', { campus_id: 1, mode: 'report', ids: [id2], at: '2027-02-21T15:20:00.000Z' });
  assert.equal(report.status, 200);
  assert.equal(report.data.checked_out, 1);
  setFeatures();
});

test('matching tags: “in the room” is only the campus’s own day; nothing is rewritten and attendance doesn’t change', async () => {
  // A check-in from yesterday that nobody checked out (nobody does, with matching tags), and one from today.
  const yesterday = await checkIn(ids.bo, 'M4N7P', { at: '2027-02-20T15:00:00.000Z' });
  const todayBo = await checkIn(ids.abe, 'M4N9P', { at: '2027-02-21T15:05:00.000Z' });
  const openBefore = db.prepare('SELECT COUNT(*) n FROM checkins WHERE checked_out_at IS NULL').get().n;
  const kidsWeek = async () => (await api('staff', 'GET', '/attendance/weekly?weeks=4')).data.kids;
  setFeatures({ checkout: 'ipad', holds: 'block' });
  const kidsBefore = await kidsWeek();
  const inRoom = async (day) => (await api('staff', 'GET', `/checkin/active?campus_id=1&day=${day}`)).data;
  const ipadMode = await inRoom('2027-02-20');
  assert.equal(ipadMode.find((x) => x.id === yesterday.id).in_room, 1, 'check-out on the iPad: open until somebody checks them out');

  setFeatures({ checkout: 'tag', holds: 'alert' });
  const past = await inRoom('2027-02-20');
  assert.equal(past.find((x) => x.id === yesterday.id).in_room, 0, 'yesterday’s check-in is not in the room today');
  const now = (await api('staff', 'GET', '/checkin/active?campus_id=1')).data;
  assert.equal(now.find((x) => x.id === todayBo.id).in_room, 1);
  assert.ok(!now.some((x) => x.id === yesterday.id), 'the list is today’s');
  // The iPad's own list (the same route, with its token) agrees.
  assert.equal((await asStation('GET', '/checkin/active?campus_id=1')).data.find((x) => x.id === todayBo.id).in_room, 1);
  // Staff checking a child out in the Hub takes them out of the room.
  assert.equal((await outRequest('staff', todayBo.id)).status, 200);
  assert.equal((await api('staff', 'GET', '/checkin/active?campus_id=1')).data.find((x) => x.id === todayBo.id).in_room, 0);
  // Nothing was rewritten to get there: yesterday's check-in is still open, with no check-out time, and the counts are the same.
  assert.equal(row(yesterday.id).checked_out_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkins WHERE checked_out_at IS NULL').get().n, openBefore - 1, 'only the one staff checked out');
  assert.deepEqual(await kidsWeek(), kidsBefore, 'attendance counts are unchanged');
  // The same day-scoping applies at another campus's clock: a station only ever sees its own campus.
  assert.equal((await asStation('GET', '/checkin/active?campus_id=2')).status, 403);
  setFeatures();
});

// ---------------------------------------------------------------- holds that only warn
test('warn at check-in: a held child is checked in, the iPad is told, the lead is told, and the note never leaves the Hub', async () => {
  setFeatures({ checkout: 'tag', holds: 'alert' });
  mailbox.length = 0;
  assert.equal((await place('staff', ids.abe)).status, 201);
  const heardBefore = notices('lead').length;
  // The roster carries that there is a hold, never why.
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1')).data;
  const kids = roster.households.flatMap((h) => h.members).filter((m) => m.household_role === 'child');
  assert.equal(kids.find((m) => m.id === ids.abe).on_hold, 1);
  assert.equal(kids.find((m) => m.id === ids.abby).on_hold, 0);
  assert.ok(!JSON.stringify(roster).includes('CANARY') && !JSON.stringify(roster).includes('custody'));
  // Check-in itself goes ahead. The answer says which child has a hold (for an iPad whose list is older than the hold).
  const held = await checkIn(ids.abe, 'W3E4R');
  assert.equal(held.r.data[0].on_hold, 1);
  assert.ok(!JSON.stringify(held.r.data).includes('CANARY'));
  assert.ok(row(held.id), 'the child is checked in');
  const clear = await checkIn(ids.abby, 'W3E4R');
  assert.ok(!('on_hold' in clear.r.data[0]), 'a child with no hold gets no flag');
  // The safeguarding lead is told straight away, in the Hub and by email (the email names no one); the push is the generic one.
  const heard = notices('lead').slice(heardBefore);
  assert.deepEqual(heard.map((x) => x.title), ['A child with a hold was checked in']);
  assert.match(heard[0].body, /Abe Aldrin was checked in at North on Lobby while a hold is on/);
  assert.equal(heard[0].kind, 'safety');
  assert.equal(heard[0].url, `/#/people/${ids.abe}`);
  const mails = mailbox.filter((m) => m.to === 'lead@mb.org' && /hold was checked in/.test(m.subject));
  assert.equal(mails.length, 1);
  assert.ok(!/Abe|Aldrin|CANARY/.test(mails[0].subject + mails[0].text));
  assert.equal(events('checkin.hold_alert').filter((e) => e.checkin_id === held.id).length, 1);
  // The roster's own copy, today's list and the cached roster for a roster made later all say the same thing.
  const active = (await asStation('GET', '/checkin/active?campus_id=1')).data;
  assert.equal(active.find((x) => x.id === held.id).on_hold, 1);
  assert.equal(active.find((x) => x.id === clear.id).on_hold, 0);
  // A re-sent batch doesn't tell the lead again; a second check-in the same day doesn't either.
  const again = await asStation('POST', '/checkin/checkins', { campus_id: 1, records: [{ id: held.id, person_id: ids.abe, kind: 'kid', security_code: 'W3E4R', station: 'Lobby', checked_in_at: '2027-02-21T15:00:00.000Z' }] });
  assert.equal(again.data[0].on_hold, 1, 'the flag comes back on a re-send too');
  assert.equal(notices('lead').slice(heardBefore).length, 1);
  await checkIn(ids.abe, 'W3E5R');
  assert.equal(notices('lead').slice(heardBefore).length, 1, 'once a day for a child');
  // What the volunteer reads: the child's name, not the note.
  assert.equal(holdAlertText(['Abe']), 'Before Abe goes to their room, please ask the children’s ministry leader or a staff member to come to the desk.');
  assert.match(holdAlertText(['Abe', 'Abby']), /^Before Abe and Abby go to their rooms, please ask/);
  assert.match(holdAlertText(['Abe', 'Abby', 'Bo']), /^Before Abe, Abby and Bo go to their rooms/);
  assert.match(holdLeaveText(['Abe']), /^Before Abe leaves, please ask/);
  assert.ok(!/CANARY|custody/.test(holdAlertText(['Abe'])));
  await unlift(ids.abe);
  setFeatures();
});

test('warn at check-in with check-out on the iPad: a held child can be checked out, and it is flagged and the lead is told', async () => {
  setFeatures({ checkout: 'ipad', holds: 'alert' });
  assert.equal((await place('staff', ids.bo)).status, 201);
  const { id } = await checkIn(ids.bo, 'T5Y6U');
  const before = notices('lead').length;
  const r = await outRequest('Lobby', id, ids.hhB, ids.bea);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.checked_out, 1);
  assert.equal(row(id).checked_out_held, 1, 'marked as released while a hold was on');
  const flagged = events('checkout.held_released').find((e) => e.checkin_id === id);
  assert.equal(flagged.d.via, 'alert');
  const heard = notices('lead').slice(before);
  assert.deepEqual(heard.map((x) => x.title), ['A child with a hold was checked out']);
  assert.match(heard[0].body, /Bo Bell was checked out by Lobby \(iPad\) while a hold was on/);
  assert.equal(audits('checkin.hold.released_alert').length, 1);
  await unlift(ids.bo);
  setFeatures();
});

test('block check-out (the default with check-out on the iPad) still refuses a held child, as before', async () => {
  setFeatures({ checkout: 'ipad', holds: 'block' });
  assert.equal((await place('staff', ids.abby)).status, 201);
  const { id, r } = await checkIn(ids.abby, 'H6J7K');
  assert.ok(!('on_hold' in r.data[0]), 'no warning at check-in when the hold is enforced at check-out');
  const refused = await outRequest('Lobby', id);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.reason, 'hold');
  assert.equal(row(id).checked_out_at, null);
  await unlift(ids.abby);
  setFeatures();
});

// ---------------------------------------------------------------- holds off
test('holds off: no flag on the roster or the active list, no new holds, existing holds kept, and a held child isn’t blocked or flagged', async () => {
  setFeatures({ checkout: 'ipad', holds: 'block' });
  assert.equal((await place('staff', ids.abe)).status, 201);
  const holdRows = db.prepare('SELECT COUNT(*) n FROM checkin_holds').get().n;
  const { id } = await checkIn(ids.abe, 'L8M9N');
  setFeatures({ checkout: 'ipad', holds: 'off' });
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1')).data;
  assert.ok(roster.households.flatMap((h) => h.members).every((m) => !('on_hold' in m)), 'the roster carries no on_hold at all');
  assert.ok((await asStation('GET', '/checkin/active?campus_id=1')).data.every((x) => !('on_hold' in x)));
  // The Hub is told the mode so it hides the cards; placing a new hold is refused, lifting an old one is not.
  assert.equal((await api('staff', 'GET', `/checkin/holds?person_id=${ids.abe}`)).data.hold_mode, 'off');
  const refused = await place('staff', ids.abby);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /switched off/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkin_holds').get().n, holdRows, 'existing hold rows are kept, and nothing new was added');
  // Check-in doesn't warn, and check-out isn't blocked or flagged.
  const before = notices('lead').length;
  const flagless = await checkIn(ids.abe, 'L8M8N');
  assert.ok(!('on_hold' in flagless.r.data[0]));
  const out = await outRequest('Lobby', id);
  assert.equal(out.status, 200);
  assert.equal(row(id).checked_out_held, 0);
  assert.equal(notices('lead').length, before, 'nobody is told, because holds are off');
  assert.equal(events('checkin.hold_alert').filter((e) => e.checkin_id === flagless.id).length, 0);
  // Switching them back on brings the hold straight back.
  setFeatures({ checkout: 'ipad', holds: 'block' });
  const back = (await asStation('GET', '/checkin/roster?campus_id=1')).data.households.flatMap((h) => h.members).find((m) => m.id === ids.abe);
  assert.equal(back.on_hold, 1);
  await unlift(ids.abe);
  setFeatures();
});

// ---------------------------------------------------------------- the Care note button
test('Care note off: the iPad, a leader with the switch and an automatic leader are told no; staff in the Hub can still read it', async () => {
  setFeatures();
  db.prepare("UPDATE people SET medical_notes = 'Asthma, inhaler in the bag' WHERE id = ?").run(ids.abe);
  await checkIn(ids.abe, 'C2D3F');
  const read = (who) => (who === 'Lobby' ? asStation('GET', `/checkin/medical/${ids.abe}?campus_id=1`) : api(who, 'GET', `/checkin/medical/${ids.abe}?campus_id=1`));
  assert.equal((await read('Lobby')).status, 200, 'on: the iPad can read it');
  assert.equal((await read('leaderSwitch')).status, 200);
  const viewed = events('medical.view').length;
  assert.equal(viewed, 2, 'each look is recorded');
  setFeatures({ medical_tap: false });
  for (const who of ['Lobby', 'leaderSwitch']) {
    const r = await read(who);
    assert.equal(r.status, 403, who);
    assert.equal(r.data.reason, 'medical_tap_off');
    assert.ok(!JSON.stringify(r.data).includes('Asthma'));
  }
  assert.equal(events('medical.view').length, viewed, 'the refused looks were not recorded as views');
  const staff = await read('staff');
  assert.equal(staff.status, 200);
  assert.equal(staff.data.medical_notes, 'Asthma, inhaler in the bag');
  assert.equal((await read('north')).status, 200);
  // The roster still carries the safety line (Level 1); only the longer note is off.
  const roster = (await asStation('GET', '/checkin/roster?campus_id=1')).data;
  assert.equal(roster.features.medical_tap, false);
  assert.ok(!JSON.stringify(roster).includes('Asthma'));
  setFeatures();
});

// ---------------------------------------------------------------- name tags
const WORST = {
  epiLong: { allergies: 'peanuts, tree nuts, egg, milk, soy, wheat, sesame, fish', allergy_epi: 1, allergy_action: 'EpiPen in the blue bag in the front pocket, then call 911 and a parent' },
  epiOnly: { allergies: '', allergy_epi: 1, allergy_action: '' },
  epiShort: { allergies: 'Peanuts', allergy_epi: 1, allergy_action: 'EpiPen, call 911' },
  epiMid: { allergies: 'peanuts, tree nuts, egg', allergy_epi: 1, allergy_action: '' },
  epiMid2: { allergies: 'peanuts, tree nuts, egg, milk', allergy_epi: 1, allergy_action: '' },
  manyNoEpi: { allergies: 'peanuts, tree nuts, egg, milk, soy, wheat, sesame, fish', allergy_epi: 0, allergy_action: '' },
  longAction: { allergies: 'Peanuts', allergy_epi: 0, allergy_action: 'x'.repeat(90) },
  none: { allergies: '', allergy_epi: 0, allergy_action: '' },
};

test('name tags, “SEE ROOM LEADER”: today’s wording, unchanged', () => {
  const kid = WORST.epiLong;
  assert.deepEqual(labelSafety(kid, { max: 30, compact: true }), ['EPI: YES · SEE ROOM LEADER']);
  assert.deepEqual(labelSafety(kid, { max: 60 }), ['EPI: YES', 'ALLERGIES: SEVERAL, SEE ROOM LEADER', 'SEE ROOM LEADER']);
  assert.deepEqual(labelSafety(kid, { max: 60, overflow: 'leader' }), labelSafety(kid, { max: 60 }), 'leader is the default');
  assert.deepEqual(labelSafety(WORST.epiShort, { max: 30, compact: true }), ['EPI: YES · SEE ROOM LEADER'], 'the one-line action never fits a small tag');
  assert.deepEqual(level1(kid, 34), { allergy: 'ALLERGIES: SEVERAL, SEE ROOM LEADER', epi: true, action: 'SEE ROOM LEADER' });
});

test('name tags, “SEE CHECK-IN DESK”: the same, saying the desk', () => {
  const kid = WORST.epiLong;
  assert.deepEqual(labelSafety(kid, { max: 30, compact: true, overflow: 'desk' }), ['EPI: YES · SEE CHECK-IN DESK']);
  assert.deepEqual(labelSafety(kid, { max: 60, overflow: 'desk' }), ['EPI: YES', 'ALLERGIES: SEVERAL, SEE CHECK-IN DESK', 'SEE CHECK-IN DESK']);
  assert.deepEqual(labelSafety(WORST.manyNoEpi, { max: 30, compact: true, overflow: 'desk' }), ['SEE CHECK-IN DESK']);
  assert.deepEqual(level1(kid, 34, 'desk'), { allergy: 'ALLERGIES: SEVERAL, SEE CHECK-IN DESK', epi: true, action: 'SEE CHECK-IN DESK' });
  // What fits is printed as it is, whichever way is chosen.
  for (const o of ['leader', 'desk', 'smaller']) assert.deepEqual(labelSafety(WORST.epiMid, { max: 60, overflow: o }), ['EPI: YES', 'ALLERGY: peanuts, tree nuts, egg'], o);
});

test('name tags, “print it smaller”: the words are printed smaller to fit, and only say the desk when even that can’t fit', () => {
  // A small tag with one strip: 34 characters in a line that holds 30 fit at 88% size, 40 at 75%.
  assert.deepEqual(labelStrips(WORST.epiMid, { max: 30, compact: true, overflow: 'smaller' }), [{ text: 'EPI: YES · peanuts, tree nuts, egg', scale: 0.88 }]);
  assert.deepEqual(labelStrips(WORST.epiMid2, { max: 30, compact: true, overflow: 'smaller' }), [{ text: 'EPI: YES · peanuts, tree nuts, egg, milk', scale: 0.75 }]);
  assert.deepEqual(labelStrips({ allergies: 'Peanuts', allergy_epi: 1 }, { max: 30, compact: true, overflow: 'smaller' }), [{ text: 'EPI: YES · Peanuts', scale: 1 }], 'what fits is not shrunk');
  // Too long even at the smallest size: the desk, and "EPI: YES" still prints.
  assert.deepEqual(labelStrips(WORST.epiLong, { max: 30, compact: true, overflow: 'smaller' }), [{ text: `EPI: YES · ${SEE_DESK}`, scale: 1 }]);
  assert.deepEqual(labelStrips(WORST.manyNoEpi, { max: 30, compact: true, overflow: 'smaller' }), [{ text: SEE_DESK, scale: 1 }]);
  // A roomy tag shrinks each line on its own.
  const roomy = labelStrips({ allergies: 'peanuts, tree nuts, egg, milk, soy, wheat', allergy_epi: 1, allergy_action: 'EpiPen in the blue bag, then call 911' }, { max: 40, overflow: 'smaller' });
  assert.equal(roomy[0].text, 'EPI: YES');
  assert.equal(roomy[1].text, 'ALLERGY: peanuts, tree nuts, egg, milk, soy, wheat');
  assert.equal(roomy[1].scale, 0.8, '50 characters in a line that holds 40');
  assert.deepEqual(labelStrips({ allergies: 'peanuts, tree nuts, egg, milk, soy, wheat, sesame', allergy_epi: 0 }, { max: 40, overflow: 'smaller' }), [{ text: 'ALLERGIES: SEVERAL, SEE CHECK-IN DESK', scale: 1 }], '58 characters would need a size below the smallest');
  assert.equal(roomy[2].scale, 1, 'a short action stays full size');
  assert.deepEqual(labelStrips(WORST.longAction, { max: 40, overflow: 'smaller' }).map((s) => s.text), ['ALLERGY: Peanuts', SEE_DESK], 'an action too long even for the smallest size says the desk');
  assert.deepEqual(labelStrips(WORST.none, { max: 30, compact: true, overflow: 'smaller' }), []);
});

test('name tags, every size and every choice: “EPI: YES” always prints, nothing is wider than its line, and the name, room and pickup code always print', () => {
  const name = { first: 'Bartholomew-Maximilian', last: 'W.', age: '5 yr' };
  for (const [sizeId, size] of Object.entries(LABELS)) {
    for (const overflow of ['leader', 'desk', 'smaller']) {
      for (const [kidId, kid] of Object.entries(WORST)) {
        const where = `${sizeId} ${overflow} ${kidId}`;
        const strips = labelStrips(kid, { max: size.fit, compact: size.compact, overflow });
        if (kid.allergy_epi) assert.ok(strips.some((s) => s.text.startsWith('EPI: YES')), `EPI: YES prints (${where})`);
        if (!kid.allergy_epi && !kid.allergies && !kid.allergy_action) assert.deepEqual(strips, [], where);
        assert.ok(size.compact ? strips.length <= 1 : strips.length <= 3, `no more strips than the tag has room for (${where})`);
        for (const s of strips) {
          assert.ok(s.scale <= 1 && s.scale >= SMALLEST_SCALE, `${where}: ${s.scale}`);
          assert.ok(s.text.length * s.scale <= size.fit + 1e-9, `a strip is never wider than the line (${where}: "${s.text}" at ${s.scale})`);
          if (overflow !== 'smaller') assert.equal(s.scale, 1, where);
          if (overflow === 'desk' || overflow === 'smaller') assert.ok(!s.text.includes(SEE_ROOM_LEADER), `no room leader on a desk or smaller tag (${where})`);
          if (overflow === 'leader') assert.ok(!s.text.includes(SEE_DESK), where);
        }
        const markup = kidLabelHtml({ kid, name, room: { name: 'Nursery <3>' }, code: 'K7Q3M', date: '2/21', time: '09:30', size, overflow });
        for (const must of ['Bartholomew-Maximilian', 'Nursery &lt;3&gt;', 'K 7Q3M', '2/21 09:30']) assert.ok(markup.includes(must), `${must} prints (${where})`);
        // The safety strips sit below the name, room and code, and are never larger than the tag's normal small type.
        const sizes = [...markup.matchAll(/class="alert-strip" style="font-size:([\d.]+)pt/g)].map((m) => Number(m[1]));
        assert.equal(sizes.length, strips.length, where);
        for (const pt of sizes) assert.ok(pt <= parseFloat(size.small) && pt >= parseFloat(size.small) * SMALLEST_SCALE - 0.01, `${where}: ${pt}pt`);
        assert.ok(markup.indexOf('class="name"') < markup.indexOf('class="meta"') && (!strips.length || markup.indexOf('class="meta"') < markup.indexOf('alert-strip')), where);
      }
    }
    const tag = parentTagHtml({ kids: [{ first_name: 'Abe', last_name: 'Aldrin' }, { first_name: 'Abby', last_name: 'Aldrin' }], code: 'K7Q3M', date: '2/21', time: '09:30', size });
    assert.ok(tag.includes('K 7Q3M') && tag.includes('2 children'), `the parent tag keeps its code (${sizeId})`);
  }
  // An unknown choice is treated as the default, never as something unsafe.
  assert.deepEqual(labelSafety(WORST.epiLong, { max: 30, compact: true, overflow: 'nonsense' }), ['EPI: YES · SEE ROOM LEADER']);
});

test('the choice reaches the iPad on its roster, and an iPad with an older copy behaves as it always did', async () => {
  for (const choice of ['leader', 'desk', 'smaller']) {
    setFeatures({ label_overflow: choice });
    assert.equal((await asStation('GET', '/checkin/roster?campus_id=1')).data.features.label_overflow, choice);
  }
  assert.equal((await api('admin', 'PUT', '/checkin/settings', { label_overflow: 'desk' })).data.label_overflow, 'desk');
  assert.deepEqual(featuresOf({}), { checkout: 'ipad', holds: 'block', medical_tap: true, label_overflow: 'leader' });
  assert.deepEqual(featuresOf(null), featuresOf({}));
  assert.deepEqual(featuresOf({ features: { checkout: 'tag', holds: 'block', medical_tap: false, label_overflow: 'zzz' } }), { checkout: 'tag', holds: 'alert', medical_tap: false, label_overflow: 'leader' });
  assert.ok(CHECKIN_APP_VERSION >= 5, 'the iPad’s version moved on with this change');
  setFeatures();
});

// ---------------------------------------------------------------- automatic check-in for the leaders of chosen teams
test('automatic check-in: nothing changes until an admin picks teams, then those teams’ leaders get it at their own campuses', async () => {
  setFeatures();
  const get = (who, campus = 1) => api(who, 'GET', `/checkin/roster?campus_id=${campus}`);
  for (const who of ['autoN', 'autoS', 'autoVol', 'autoAll', 'autoMember', 'autoArch']) assert.equal((await get(who)).status, 403, `${who} has nothing until a team is picked`);
  assert.equal((await api('autoN', 'GET', '/me')).data.checkin, false);

  const picked = await api('admin', 'PUT', '/checkin/settings', { auto_team_ids: [ids.teamKids] });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  assert.deepEqual(picked.data.auto_team_ids, [ids.teamKids]);
  assert.deepEqual(picked.data.auto_teams.map((t) => t.name), ['Children’s ministry']);

  // A leader of the team, limited to North: North only.
  assert.equal((await get('autoN', 1)).status, 200);
  assert.equal((await get('autoN', 2)).status, 403, 'limited to their campus list');
  assert.equal((await api('autoN', 'GET', '/checkin/campuses')).data.map((c) => c.id).join(), '1');
  assert.equal((await get('autoS', 2)).status, 200);
  assert.equal((await get('autoS', 1)).status, 403);
  // A leader with no campus list keeps the meaning leaders always had: every campus.
  assert.equal((await get('autoAll', 1)).status, 200);
  assert.equal((await get('autoAll', 2)).status, 200);
  // Fails closed: below leader with no campus list, on a church with two campuses, is refused.
  assert.equal((await get('autoVol', 1)).status, 403);
  assert.equal((await get('autoVol', 2)).status, 403);
  // A member who doesn't lead the team, a leader of another team, and the leader of an archived team get nothing.
  assert.equal((await get('autoMember')).status, 403);
  assert.equal((await get('autoArch')).status, 403);
  assert.equal((await get('leaderNoSwitch')).status, 403);
  // It is only kids' check-in: not holds, not the settings, not the safeguarding lead, not the record.
  assert.equal((await api('autoN', 'POST', '/checkin/holds', { person_id: ids.abe, campus_id: 1 })).status, 403);
  assert.equal((await api('autoN', 'PUT', '/checkin/settings', { checkout: 'tag' })).status, 403);
  assert.equal((await api('autoN', 'GET', '/checkin/safeguarding')).status, 403);
  assert.equal((await api('autoN', 'GET', '/checkin/events?campus_id=1&day=2027-02-21')).status, 403);
  assert.equal((await api('autoN', 'GET', '/checkin/safety')).status, 403);
  // The Hub's navigation sees it too.
  assert.equal((await api('autoN', 'GET', '/me')).data.checkin, true);
  // It is worked out on each request; the account's own switch is never written.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE checkin = 1').get().n, 1, 'only the one account that was given the switch by hand');
  assert.equal(db.prepare('SELECT checkin FROM users WHERE id = ?').get(ids.autoN).checkin, 0);
  // They can work check-in at their campus: check a child in, void it the same day.
  const { id } = await checkIn(ids.bo, 'V5B6N');
  assert.equal((await api('autoN', 'POST', `/checkin/checkins/${id}/void`, { reason: 'wrong child' })).status, 200);
});

test('automatic check-in goes when the person stops leading the team, the team is archived or taken off the list; every change to the list is audited', async () => {
  setFeatures({ auto_team_ids: [ids.teamKids] });
  const get = (who) => api(who, 'GET', '/checkin/roster?campus_id=1').then((r) => r.status);
  assert.equal(await get('autoN'), 200);
  // Stops leading (still on the team as a member).
  db.prepare('UPDATE team_members SET is_leader = 0 WHERE team_id = ? AND person_id = ?').run(ids.teamKids, ids.pLeaderN);
  assert.equal(await get('autoN'), 403, 'the very next request');
  db.prepare('UPDATE team_members SET is_leader = 1 WHERE team_id = ? AND person_id = ?').run(ids.teamKids, ids.pLeaderN);
  assert.equal(await get('autoN'), 200);
  // Leaves the team.
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').run(ids.teamKids, ids.pLeaderN);
  assert.equal(await get('autoN'), 403);
  db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(ids.teamKids, ids.pLeaderN);
  assert.equal(await get('autoN'), 200);
  // Leading some other team doesn't count; the team is archived.
  db.prepare('UPDATE teams SET archived = 1 WHERE id = ?').run(ids.teamKids);
  assert.equal(await get('autoN'), 403);
  db.prepare('UPDATE teams SET archived = 0 WHERE id = ?').run(ids.teamKids);
  assert.equal(await get('autoN'), 200);
  // The account is turned off, or the person stops being linked.
  db.prepare('UPDATE users SET person_id = NULL WHERE id = ?').run(ids.autoN);
  assert.equal(await get('autoN'), 403);
  db.prepare('UPDATE users SET person_id = ? WHERE id = ?').run(ids.pLeaderN, ids.autoN);
  assert.equal(await get('autoN'), 200);
  // Taken off the list by an admin, and the audit of each change.
  const before = audits('checkin.settings.auto_teams').length;
  const off = await api('admin', 'PUT', '/checkin/settings', { auto_team_ids: [] });
  assert.equal(off.status, 200);
  assert.equal(await get('autoN'), 403);
  const on = await api('admin', 'PUT', '/checkin/settings', { auto_team_ids: [ids.teamOther, ids.teamKids] });
  assert.deepEqual(on.data.auto_team_ids, [ids.teamKids, ids.teamOther].sort((a, b) => a - b));
  assert.equal(await get('autoN'), 200);
  const log = audits('checkin.settings.auto_teams');
  assert.equal(log.length - before, 2, 'each change to the list has its own entry');
  assert.deepEqual(log.at(-2).d, { from: [ids.teamKids], to: [] });
  assert.deepEqual(log.at(-1).d, { from: [], to: [ids.teamKids, ids.teamOther].sort((a, b) => a - b) });
  assert.equal(log.at(-1).user_id, ids.admin);
  // Changing something else leaves the list's own log alone.
  await api('admin', 'PUT', '/checkin/settings', { medical_tap: false });
  assert.equal(audits('checkin.settings.auto_teams').length - before, 2);
  assert.equal(audits('checkin.settings').at(-1).d.changed.join(), 'medical_tap');
  setFeatures();
  assert.equal(await get('autoN'), 403, 'the list is empty again');
});

// ---------------------------------------------------------------- a hold placed at another campus
test('a hold placed at another campus still shows as a hold to staff with check-in access at the child’s or family’s campus', async () => {
  setFeatures();
  // Dee's family belongs to North (where the hold is placed); Dee herself is recorded at South.
  const made = await place('staff', ids.dee, 1);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  // South staff can open Dee (she is at South) but can't read North's holds: they learn only that there is one.
  const south = await api('south', 'GET', `/checkin/holds?person_id=${ids.dee}`);
  assert.equal(south.status, 200);
  assert.deepEqual(south.data.holds, [{ person_id: ids.dee, active: true, other_campus: true }]);
  assert.ok(!/CANARY|custody|Staff|placed|note|reason/i.test(JSON.stringify(south.data.holds)), 'never the note, who placed it, or why');
  // North staff see the whole hold, as before (not the stub).
  const north = await api('north', 'GET', `/checkin/holds?person_id=${ids.dee}`);
  assert.equal(north.data.holds.length, 1);
  assert.equal(north.data.holds[0].other_campus, undefined);
  assert.equal(north.data.holds[0].note, NOTE);
  // Someone with no check-in access at either campus, a volunteer and a lead who isn't staff get no stub.
  assert.equal((await api('volunteer', 'GET', `/checkin/holds?person_id=${ids.dee}`)).status, 403);
  assert.equal((await api('lead', 'GET', `/checkin/holds?person_id=${ids.dee}`)).data.holds[0].other_campus, undefined, 'the lead (no campus limit) reads the hold itself');
  // A hold on a child at neither of South staff's campuses is not shown to them.
  assert.equal((await place('staff', ids.abe, 1)).status, 201);
  assert.deepEqual((await api('south', 'GET', `/checkin/holds?person_id=${ids.abe}`)).data.holds, []);
  // A lifted hold is not an active one.
  await unlift(ids.dee);
  assert.deepEqual((await api('south', 'GET', `/checkin/holds?person_id=${ids.dee}`)).data.holds, []);
  await unlift(ids.abe);
});
