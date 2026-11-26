// Team leaders see full detail (declines and reasons, drafts, contact details, open spots) only for
// the teams they lead. Other teams look like they do to a volunteer: people who were asked or
// accepted, names and photo only. Staff and admins are unchanged. Dates are relative to "now", so
// nothing here depends on what day it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, setSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { ledTeamIds, seesTeamDetail, ledPositionsClause } from '../server/team-scope.js';

let server, base, db;
const cookies = {};
const ids = {};
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-lv-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago'), (2, 'South', 'South', 'America/Chicago');`);
  const person = (key, campus, extra = {}) => {
    ids[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, campus_id, email, phone) VALUES (?, ?, ?, ?, ?)')
      .run(key, 'Test', campus, extra.email ?? `${key.toLowerCase()}@example.org`, extra.phone ?? `555-01${String(Object.keys(ids).length).padStart(2, '0')}`).lastInsertRowid);
    return ids[key];
  };
  const make = (key, role, campuses, personId) => {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, personId ?? null).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  const team = (key, campus) => {
    ids[key] = Number(db.prepare('INSERT INTO teams (name, campus_id) VALUES (?, ?)').run(`Team ${key}`, campus).lastInsertRowid);
    ids[`pos${key}`] = Number(db.prepare('INSERT INTO positions (team_id, name) VALUES (?, ?)').run(ids[key], `Role ${key}`).lastInsertRowid);
  };
  team('A', 1); team('B', 1); team('C', 2);
  for (const n of ['Lena', 'Ann', 'Cara', 'Dan', 'Bob', 'Eve', 'Fay', 'Otto']) person(n, 1);
  person('Sue', 2); person('Vic', 1);
  const lead = (t, p) => db.prepare('INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, 1)').run(ids[t], ids[p]);
  const member = (t, p) => db.prepare('INSERT INTO team_members (team_id, person_id, position_id) VALUES (?, ?, ?)').run(ids[t], ids[p], ids[`pos${t}`]);
  lead('A', 'Lena'); member('A', 'Ann'); member('A', 'Cara'); member('A', 'Dan');
  member('B', 'Bob'); member('B', 'Eve'); member('B', 'Fay'); lead('B', 'Otto');
  lead('C', 'Sue');
  make('admin', 'admin', null);
  make('staff', 'staff', null);
  make('nstaff', 'staff', '[1]');
  make('lena', 'leader', '[1]', ids.Lena);
  make('otto', 'leader', '[1]', ids.Otto);
  make('sue', 'leader', '[2]', ids.Sue);
  make('vic', 'volunteer', null, ids.Vic);

  ids.svc = Number(db.prepare('INSERT INTO services (campus_id, title, starts_at) VALUES (1, ?, ?)').run('Test service', `${addDays(today(), 2)}T10:00`).lastInsertRowid);
  db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, 3), (?, ?, 3)').run(ids.svc, ids.posA, ids.svc, ids.posB);
  const assign = (p, pos, status, sent, reason = '') => db.prepare('INSERT INTO assignments (service_id, position_id, person_id, status, decline_reason, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ids.svc, ids[`pos${pos}`], ids[p], status, reason, sent ? '2020-01-01 00:00:00' : null);
  assign('Ann', 'A', 'accepted', true);
  assign('Cara', 'A', 'declined', true, 'Sick kid A');
  assign('Dan', 'A', 'pending', false);
  assign('Bob', 'B', 'pending', true);
  assign('Eve', 'B', 'declined', true, 'Private reason B');
  assign('Fay', 'B', 'pending', false);
  db.prepare('INSERT INTO blockouts (person_id, start_date, end_date, reason) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
    .run(ids.Ann, addDays(today(), 1), addDays(today(), 3), 'Trip A', ids.Bob, addDays(today(), 1), addDays(today(), 3), 'Trip B');
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const pos = (svc, team) => svc.positions.find((p) => p.team_id === ids[team]);
const names = (p) => p.assignments.map((a) => a.first_name).sort();

test('the helper: staff are unlimited, a leader gets their own teams', () => {
  assert.equal(ledTeamIds(db, { role: 'staff', personId: null }), null);
  assert.deepEqual([...ledTeamIds(db, { role: 'leader', personId: ids.Lena })], [ids.A]);
  assert.equal(seesTeamDetail(db, { role: 'leader', personId: ids.Lena }, ids.B), false);
  assert.equal(seesTeamDetail(db, { role: 'admin', personId: null }, ids.B), true);
  assert.equal(ledPositionsClause({ role: 'admin' }, 'x').sql, '1 = 1');
});

test('service page: a leader sees their team in full and other teams as a volunteer would', async () => {
  const { status, data } = await api('lena', 'GET', `/services/${ids.svc}`);
  assert.equal(status, 200);
  const a = pos(data, 'A');
  assert.equal(a.detail, true);
  assert.equal(a.needed, 3);
  assert.deepEqual(names(a), ['Ann', 'Cara', 'Dan'], 'declined and draft rows are theirs to see');
  assert.equal(a.assignments.find((x) => x.first_name === 'Cara').decline_reason, 'Sick kid A');
  assert.ok(a.assignments.every((x) => x.phone && x.email), 'contact details for their own team');
  const b = pos(data, 'B');
  assert.equal(b.detail, false);
  assert.equal(b.needed, 0, 'open spots of other teams are hidden');
  assert.deepEqual(names(b), ['Bob'], 'only people who were asked and haven’t declined');
  const text = JSON.stringify(b);
  for (const secret of ['Private reason B', 'decline_reason', 'phone', 'email', 'Eve', 'Fay', '@example.org']) assert.ok(!text.includes(secret), `no ${secret} for another team`);
});

test('service page: a team with only drafts or declines drops out for the other team’s leader', async () => {
  const { data } = await api('otto', 'GET', `/services/${ids.svc}`);
  const a = pos(data, 'A');
  assert.deepEqual(names(a), ['Ann'], 'only the accepted, sent row');
  assert.equal(pos(data, 'B').detail, true);
  db.prepare('DELETE FROM assignments WHERE position_id = ? AND service_id = ? AND (sent_at IS NULL OR status = ?)').run(ids.posA, ids.svc, 'declined');
  db.prepare('DELETE FROM assignments WHERE position_id = ? AND service_id = ?').run(ids.posA, ids.svc);
  const after = (await api('otto', 'GET', `/services/${ids.svc}`)).data;
  assert.equal(pos(after, 'A'), undefined, 'a team with nothing visible isn’t listed');
  // put the data back for later tests
  const assign = (p, status, sent, reason = '') => db.prepare('INSERT INTO assignments (service_id, position_id, person_id, status, decline_reason, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ids.svc, ids.posA, ids[p], status, reason, sent ? '2020-01-01 00:00:00' : null);
  assign('Ann', 'accepted', true); assign('Cara', 'declined', true, 'Sick kid A'); assign('Dan', 'pending', false);
});

test('service page: staff, limited staff and volunteers see what they did before', async () => {
  for (const who of ['staff', 'nstaff', 'admin']) {
    const d = (await api(who, 'GET', `/services/${ids.svc}`)).data;
    assert.equal(pos(d, 'B').needed, 3, who);
    assert.deepEqual(names(pos(d, 'B')), ['Bob', 'Eve', 'Fay'], who);
    assert.equal(pos(d, 'B').assignments.find((x) => x.first_name === 'Eve').decline_reason, 'Private reason B', who);
  }
  const v = (await api('vic', 'GET', `/services/${ids.svc}`)).data;
  assert.deepEqual(names(pos(v, 'A')), ['Ann']);
  assert.equal(v.positions.every((p) => p.detail === undefined), true, 'volunteers get no new field');
  assert.equal(JSON.stringify(v).includes('Private reason'), false);
});

test('service page: a leader at another campus is turned away', async () => {
  assert.equal((await api('sue', 'GET', `/services/${ids.svc}`)).status, 403);
});

test('services list: a leader’s counts cover their teams only', async () => {
  const from = addDays(today(), 0); const to = addDays(today(), 5);
  const row = (await api('lena', 'GET', `/services?from=${from}&to=${to}`)).data.find((s) => s.id === ids.svc);
  assert.deepEqual([row.needed, row.filled, row.accepted, row.declined], [3, 2, 1, 1]);
  for (const who of ['staff', 'nstaff']) {
    const r = (await api(who, 'GET', `/services?from=${from}&to=${to}`)).data.find((s) => s.id === ids.svc);
    assert.deepEqual([r.needed, r.filled, r.accepted, r.declined], [6, 4, 1, 2], who);
  }
});

test('candidates: another team’s roster is not available to a leader', async () => {
  assert.equal((await api('lena', 'GET', `/services/${ids.svc}/candidates?position_id=${ids.posB}`)).status, 403);
  assert.equal((await api('lena', 'GET', `/services/${ids.svc}/candidates?position_id=${ids.posA}`)).status, 200);
  assert.equal((await api('staff', 'GET', `/services/${ids.svc}/candidates?position_id=${ids.posB}`)).status, 200);
});

test('schedule: a leader sees their teams, and the decline reason only for them', async () => {
  const month = addDays(today(), 2).slice(0, 7);
  const all = (await api('lena', 'GET', `/schedule?month=${month}`)).data;
  assert.deepEqual([...new Set(all.positions.map((p) => p.team_id))], [ids.A]);
  assert.deepEqual(all.led_team_ids, [ids.A]);
  const cell = all.cells[`${ids.svc}:${ids.posA}`];
  assert.equal(cell.assignments.find((a) => a.first_name === 'Cara').decline_reason, 'Sick kid A');
  assert.equal(all.cells[`${ids.svc}:${ids.posB}`], undefined);
  assert.equal(JSON.stringify(all).includes('Private reason B'), false);
  assert.equal((await api('lena', 'GET', `/schedule?month=${month}&team_id=${ids.B}`)).status, 403);
  assert.equal((await api('lena', 'GET', `/schedule?month=${month}&team_id=${ids.A}`)).status, 200);
  const staff = (await api('staff', 'GET', `/schedule?month=${month}&team_id=${ids.B}`)).data;
  assert.equal(staff.cells[`${ids.svc}:${ids.posB}`].assignments.find((a) => a.first_name === 'Eve').decline_reason, 'Private reason B');
  assert.equal(staff.led_team_ids, null);
  assert.equal((await api('sue', 'GET', `/schedule?month=${month}`)).data.services.length, 0, 'other campus: nothing from North');
});

test('person page: another team’s declined or draft rows stay hidden from a leader', async () => {
  const eve = (await api('lena', 'GET', `/people/${ids.Eve}`)).data;
  assert.equal(eve.upcoming.length, 0, 'declined row on a team they don’t lead');
  const fay = (await api('lena', 'GET', `/people/${ids.Fay}`)).data;
  assert.equal(fay.upcoming.length, 0, 'draft row on a team they don’t lead');
  const bob = (await api('lena', 'GET', `/people/${ids.Bob}`)).data;
  assert.equal(bob.upcoming.length, 1, 'asked and waiting is fine');
  const cara = (await api('lena', 'GET', `/people/${ids.Cara}`)).data;
  assert.equal(cara.upcoming.length, 1, 'their own team’s declined row');
  assert.equal((await api('staff', 'GET', `/people/${ids.Eve}`)).data.upcoming.length, 1, 'staff unchanged');
  assert.equal((await api('nstaff', 'GET', `/people/${ids.Fay}`)).data.upcoming.length, 1, 'limited staff unchanged');
});

test('home: a leader’s needs and away dates cover their teams only', async () => {
  const lena = (await api('lena', 'GET', '/dashboard')).data;
  const s = lena.services.find((x) => x.id === ids.svc);
  assert.deepEqual(s.open_positions.map((o) => o.team), ['Team A']);
  assert.equal(s.declined, 1);
  assert.equal(s.pending, 1);
  assert.deepEqual(lena.blockouts_this_week.map((b) => b.first_name), ['Ann']);
  const staff = (await api('staff', 'GET', '/dashboard')).data;
  const t = staff.services.find((x) => x.id === ids.svc);
  assert.deepEqual(t.open_positions.map((o) => o.team).sort(), ['Team A', 'Team B']);
  assert.equal(t.declined, 2);
  assert.deepEqual(staff.blockouts_this_week.map((b) => b.first_name).sort(), ['Ann', 'Bob']);
});

test('leaders keep full access to their own team when scheduling is admin-only', async () => {
  setSetting(db, 'schedule_role', 'admin');
  try {
    const d = (await api('lena', 'GET', `/services/${ids.svc}`)).data;
    assert.equal(pos(d, 'A').detail, true);
    assert.deepEqual(names(pos(d, 'A')), ['Ann', 'Cara', 'Dan']);
    assert.equal(pos(d, 'A').can_schedule, false, 'visibility is separate from who may schedule');
    assert.equal((await api('lena', 'GET', `/services/${ids.svc}/candidates?position_id=${ids.posA}`)).status, 200);
  } finally { setSetting(db, 'schedule_role', 'team_leaders'); }
});

test('team page: contact details only for a team the leader leads', async () => {
  const other = (await api('lena', 'GET', `/teams/${ids.B}`)).data.members;
  assert.ok(other.length);
  for (const m of other) { assert.equal('phone' in m, false); assert.equal('email' in m, false); }
  const own = (await api('lena', 'GET', `/teams/${ids.A}`)).data.members;
  assert.ok(own.every((m) => m.phone && m.email));
  assert.ok((await api('staff', 'GET', `/teams/${ids.B}`)).data.members.every((m) => m.phone && m.email));
});

test('person page: away reasons only for people on a team the leader leads', async () => {
  const b = (await api('lena', 'GET', `/people/${ids.Bob}`)).data.blockouts;
  assert.equal(b.length, 1);
  assert.ok(b[0].start_date); assert.equal('reason' in b[0], false);
  assert.equal((await api('lena', 'GET', `/people/${ids.Ann}`)).data.blockouts[0].reason, 'Trip A');
  assert.equal((await api('staff', 'GET', `/people/${ids.Bob}`)).data.blockouts[0].reason, 'Trip B');
});

test('adding a team member: campus check, no-campus people allowed, staff unchanged', async () => {
  const put = (role, p) => api(role, 'PUT', `/teams/${ids.A}/members/${p}`, { position_ids: [ids.posA] });
  assert.equal((await put('lena', ids.Sue)).status, 403);
  const nobody = Number(db.prepare("INSERT INTO people (first_name, last_name) VALUES ('Nocampus', 'Test')").run().lastInsertRowid);
  assert.equal((await put('lena', nobody)).status, 200);
  assert.equal((await put('staff', ids.Sue)).status, 200);
});

test('assignments: allow_other_campus is for staff and up, not a campus-limited leader', async () => {
  // Sue serves only at South (her home campus), so North needs the override.
  const body = { position_id: ids.posA, person_id: ids.Sue, allow_other_campus: true };
  assert.equal((await api('lena', 'POST', `/services/${ids.svc}/assignments`, body)).status, 409);
  assert.equal((await api('staff', 'POST', `/services/${ids.svc}/assignments`, body)).status, 201);
});

test('remind with nothing the leader may remind is a quiet zero, not a 403', async () => {
  const r = await api('lena', 'POST', `/services/${ids.svc}/remind`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { reminded: 0, skipped: 0 });
  assert.equal((await api('lena', 'POST', `/services/${ids.svc}/remind`, { team_id: ids.B })).status, 403);
});

test('a decline is sent to the original sender only while they can still see that team', async () => {
  const { notifyResponse } = await import('../server/notify.js');
  const uid = (k) => db.prepare('SELECT id FROM users WHERE email = ?').get(`${k}@mb.org`).id;
  const aid = db.prepare("SELECT a.id FROM assignments a WHERE a.person_id = ? AND a.service_id = ?").get(ids.Bob, ids.svc).id;
  const count = (k) => db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = 'declined'").get(uid(k)).n;
  db.prepare('UPDATE assignments SET sent_by = ? WHERE id = ?').run(uid('lena'), aid);
  notifyResponse(db, aid, 'declined');
  assert.equal(count('lena'), 0);
  db.prepare('UPDATE assignments SET sent_by = ? WHERE id = ?').run(uid('staff'), aid);
  notifyResponse(db, aid, 'declined');
  assert.equal(count('staff'), 1);
});

test('reachable: shown on a team page and the schedule panel only to those who see that team in full', async () => {
  // Cara has no email and no account; Dan has an email; Ann has no email but an account.
  db.prepare("UPDATE people SET email = '' WHERE id IN (?, ?)").run(ids.Cara, ids.Ann);
  db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run('ann-login@mb.org', 'volunteer', ids.Ann);
  const flags = (members, key) => Object.fromEntries(members.map((m) => [m.first_name, m[key]]));
  const teamA = (role) => api(role, 'GET', `/teams/${ids.A}`);
  const panel = (role) => api(role, 'GET', `/schedule?month=${addDays(today(), 2).slice(0, 7)}&team_id=${ids.A}`);

  for (const role of ['lena', 'staff', 'admin']) {
    const t = (await teamA(role)).data.members;
    assert.deepEqual([t.find((m) => m.person_id === ids.Cara).reachable, t.find((m) => m.person_id === ids.Dan).reachable, t.find((m) => m.person_id === ids.Ann).reachable], [false, true, true], role);
    const m = (await panel(role)).data.members;
    assert.deepEqual([flags(m, 'reachable').Cara, flags(m, 'reachable').Dan, flags(m, 'reachable').Ann], [false, true, true], role);
    assert.ok(m.every((x) => typeof x.reachable === 'boolean'));
  }
  // The leader of another team sees neither the flag nor the contact details.
  const t = (await teamA('otto')).data.members;
  assert.ok(t.every((m) => !('reachable' in m) && !('email' in m) && !('phone' in m)));
  assert.equal((await panel('otto')).status, 403); // the schedule panel is already limited to teams they lead
  // The flag is a yes or no: no email or phone leaks into the schedule panel for anyone.
  assert.ok((await panel('lena')).data.members.every((x) => !('email' in x) && !('phone' in x)));
});
