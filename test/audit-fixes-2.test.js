// Second batch of audit fixes: a merge moves everything to the kept person, the gifts CSV has every row,
// past services and series history can't be deleted, read notifications are tidied after 90 days, and the
// public connect card needs a phone number and a real campus. The clock is injected (and every date fixed
// or far in the future), so nothing depends on the day the tests run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, purgeStale } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

process.env.MB_DEV_LOGIN = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-audit2-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Tuesday 2030-01-15, 18:00 UTC = noon in Chicago (UTC-6 in winter).
const clock = new Date('2030-01-15T18:00:00Z');
let db, server, base;
const cookies = {};

const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
const person = (first, extra = '') => run("INSERT INTO people (first_name, last_name, campus_id, status, notes) VALUES (?, 'Merge', 1, 'member', ?)", first, extra);
const user = (key, role, finance = 0) => {
  const id = run('INSERT INTO users (email, role, finance) VALUES (?, ?, ?)', `${key}@mb.test`, role, finance);
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  return id;
};
const call = async (who, method, url, body) => {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
// The public card is limited per address, so each test request comes from its own (the app trusts x-forwarded-for).
let ipN = 0;
const card = async (body) => {
  const res = await fetch(`${base}/api/public/connect`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1', 'x-forwarded-for': `203.0.113.${++ipN}` }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const lastAudit = (action) => db.prepare('SELECT detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action)?.detail;

before(async () => {
  db = openDb(':memory:');
  run("INSERT INTO campuses (name, short_name, timezone) VALUES ('North Campus', 'North', 'America/Chicago')");
  user('admin', 'admin', 1);
  server = createApp({ db, uploadDir: tmp, now: () => clock }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// ---------------------------------------------------------------- A. merge
test('merging moves every record of the duplicate to the kept person', async () => {
  const keep = person('Keeper', 'Likes tea');
  const dup = person('Dupe', 'Allergic to cats');
  const fund = db.prepare('SELECT id FROM funds LIMIT 1').get().id;
  const gift = run("INSERT INTO gifts (person_id, amount_cents, given_on, fund_id) VALUES (?, 1000, '2030-01-01', ?)", dup, fund);
  const rec = run("INSERT INTO recurring_gifts (person_id, amount_cents, every, subscription_id, fund_id) VALUES (?, 500, 'month', 'sub_merge', ?)", dup, fund);
  const task = run("INSERT INTO tasks (title, assignee_id) VALUES ('Call them', ?)", dup);
  const card = run("INSERT INTO connect_cards (first_name, person_id) VALUES ('Guest', ?)", dup);
  const form = run("INSERT INTO forms (slug, title) VALUES ('merge-form', 'Form')");
  const resp = run('INSERT INTO form_responses (form_id, person_id) VALUES (?, ?)', form, dup);
  const ev = run("INSERT INTO events (title, starts_at) VALUES ('Picnic', '2030-06-01T10:00')");
  const signup = run("INSERT INTO event_signups (event_id, key, person_id, name) VALUES (?, 'k1', ?, 'Dupe')", ev, dup);
  const study = run("INSERT INTO studies (started_on) VALUES ('2030-01-01')");
  const pending = run("INSERT INTO study_pending_people (study_id, display_name, person_id) VALUES (?, 'Dupe', ?)", study, dup);
  const tpl = run("INSERT INTO service_templates (name) VALUES ('Standard')");
  const titem = run('INSERT INTO template_items (template_id, person_id) VALUES (?, ?)', tpl, dup);
  // Group chats: one both are in (the kept person's row stays), one only the duplicate is in (moves).
  const both = run("INSERT INTO chats (kind, name) VALUES ('group', 'Both')");
  const only = run("INSERT INTO chats (kind, name) VALUES ('group', 'Only dup')");
  for (const [c, p] of [[both, keep], [both, dup], [only, dup]]) db.prepare('INSERT INTO chat_members (chat_id, person_id) VALUES (?, ?)').run(c, p);
  // Profile answers: the kept person's wins on field A; the duplicate's moves on field B.
  const [fa, fb] = db.prepare('SELECT id FROM profile_fields ORDER BY id LIMIT 2').all().map((f) => f.id);
  for (const [p, f, v] of [[keep, fa, '"kept"'], [dup, fa, '"dup"'], [dup, fb, '"only dup"']]) db.prepare('INSERT INTO profile_values (person_id, field_id, value) VALUES (?, ?, ?)').run(p, f, v);
  db.prepare("INSERT INTO giving_customers (person_id, customer_id) VALUES (?, 'cus_dup')").run(dup);

  const res = await call('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(res.status, 200);

  const owner = (sql, id) => db.prepare(sql).get(id);
  assert.equal(owner('SELECT person_id p FROM gifts WHERE id = ?', gift).p, keep);
  assert.equal(owner('SELECT person_id p FROM recurring_gifts WHERE id = ?', rec).p, keep);
  assert.equal(owner('SELECT assignee_id p FROM tasks WHERE id = ?', task).p, keep);
  assert.equal(owner('SELECT person_id p FROM connect_cards WHERE id = ?', card).p, keep);
  assert.equal(owner('SELECT person_id p FROM form_responses WHERE id = ?', resp).p, keep);
  assert.equal(owner('SELECT person_id p FROM event_signups WHERE id = ?', signup).p, keep);
  assert.equal(owner('SELECT person_id p FROM study_pending_people WHERE id = ?', pending).p, keep);
  assert.equal(owner('SELECT person_id p FROM template_items WHERE id = ?', titem).p, keep);
  assert.deepEqual(db.prepare('SELECT chat_id FROM chat_members WHERE person_id = ? ORDER BY chat_id').all(keep).map((m) => m.chat_id), [both, only]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_members WHERE person_id = ?').get(dup).n, 0, 'no leftovers');
  assert.equal(owner('SELECT value FROM profile_values WHERE person_id = ? AND field_id = ' + fa, keep).value, '"kept"');
  assert.equal(owner('SELECT value FROM profile_values WHERE person_id = ? AND field_id = ' + fb, keep).value, '"only dup"');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM profile_values WHERE person_id = ?').get(dup).n, 0, 'no leftovers');
  assert.equal(owner('SELECT customer_id c FROM giving_customers WHERE person_id = ?', keep).c, 'cus_dup');
  // Notes: the duplicate's text is added to the kept person's; the duplicate keeps its own plus the merge line.
  assert.equal(owner('SELECT notes n FROM people WHERE id = ?', keep).n, 'Likes tea\nFrom merged record: Allergic to cats');
  assert.equal(owner('SELECT notes n FROM people WHERE id = ?', dup).n, `Allergic to cats (merged into #${keep})`);
  assert.equal(lastAudit('person.merge'), `${dup} → ${keep}`);
});

test('merging when both have a giving customer leaves the duplicate’s and says so in the audit', async () => {
  const keep = person('Keeper2');
  const dup = person('Dupe2');
  db.prepare("INSERT INTO giving_customers (person_id, customer_id) VALUES (?, 'cus_keep')").run(keep);
  db.prepare("INSERT INTO giving_customers (person_id, customer_id) VALUES (?, 'cus_dup2')").run(dup);
  assert.equal((await call('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  assert.equal(db.prepare('SELECT customer_id c FROM giving_customers WHERE person_id = ?').get(keep).c, 'cus_keep');
  assert.equal(db.prepare('SELECT customer_id c FROM giving_customers WHERE person_id = ?').get(dup).c, 'cus_dup2');
  assert.match(lastAudit('person.merge'), /both had a giving customer/);
  // No notes on the duplicate: nothing is added.
  assert.equal(db.prepare('SELECT notes n FROM people WHERE id = ?').get(keep).n, '');
});

// ---------------------------------------------------------------- B. gifts CSV
test('the gifts CSV holds every gift in the range; the on-screen list keeps its limit; the export is audited with the count', async () => {
  const fund = db.prepare('SELECT id FROM funds LIMIT 1').get().id;
  const ins = db.prepare("INSERT INTO gifts (name, amount_cents, given_on, fund_id, method, source) VALUES (?, 100, ?, ?, 'cash', 'manual')");
  db.exec('BEGIN');
  for (let i = 0; i < 2105; i++) ins.run(`Bulk ${i}`, `2031-03-${String(1 + (i % 28)).padStart(2, '0')}`, fund);
  db.exec('COMMIT');
  const q = '?from=2031-03-01&to=2031-03-31';
  const screen = await call('admin', 'GET', `/finance/gifts${q}`);
  assert.equal(screen.data.length, 2000);
  const res = await fetch(`${base}/api/finance/gifts.csv${q}`, { headers: { cookie: cookies.admin } });
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\r\n');
  assert.equal(lines.length, 1 + 2105, 'header plus every gift');
  assert.deepEqual(JSON.parse(lastAudit('finance.export')), { from: '2031-03-01', to: '2031-03-31', rows: 2105 });
});

// ---------------------------------------------------------------- C. history
const service = (startsAt) => run("INSERT INTO services (campus_id, starts_at, duration_min, title) VALUES (1, ?, 75, '')", startsAt);
const seriesRow = (name, endsOn = null) => run("INSERT INTO service_types (campus_id, name, day_of_week, start_time, every_weeks, starts_on, ends_on) VALUES (1, ?, 0, '09:00', 1, '2030-01-06', ?)", name, endsOn);
const seriesService = (typeId, startsAt) => run("INSERT INTO services (campus_id, service_type_id, starts_at, duration_min, title) VALUES (1, ?, ?, 75, '')", typeId, startsAt);
const dates = (typeId) => db.prepare('SELECT starts_at FROM services WHERE service_type_id = ? ORDER BY starts_at').all(typeId).map((s) => s.starts_at);

test('a service that has started (campus clock) can’t be deleted; one still ahead can', async () => {
  const started = service('2030-01-15T11:00'); // 11am Chicago, an hour ago
  const ahead = service('2030-01-15T15:00'); // 3pm Chicago: before 18:00 in UTC, but still three hours away
  const res = await call('admin', 'DELETE', `/services/${started}`);
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'This service has already happened, so it can’t be deleted. Its attendance and history are kept.');
  assert.ok(db.prepare('SELECT 1 FROM services WHERE id = ?').get(started), 'still there');
  assert.equal((await call('admin', 'DELETE', `/services/${ahead}`)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM services WHERE id = ?').get(ahead), undefined);
});

test('stopping a series only removes services that haven’t started; a past “from” is moved up to today', async () => {
  const t = seriesRow('Sundays');
  for (const d of ['2030-01-06', '2030-01-13', '2030-01-20', '2030-01-27']) seriesService(t, `${d}T09:00`);
  seriesService(t, '2030-01-15T09:00'); // today, already started
  seriesService(t, '2030-01-15T19:00'); // today, 7pm: not yet
  const res = await call('admin', 'DELETE', `/series/${t}?from=2030-01-01`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { removed: 3, from: '2030-01-15' });
  assert.deepEqual(dates(t), ['2030-01-06T09:00', '2030-01-13T09:00', '2030-01-15T09:00']);
  assert.equal(db.prepare('SELECT ends_on e FROM service_types WHERE id = ?').get(t).e, '2030-01-14');
  // A future "from" still works as before.
  const t2 = seriesRow('Later');
  for (const d of ['2030-01-20', '2030-01-27', '2030-02-03']) seriesService(t2, `${d}T09:00`);
  assert.equal((await call('admin', 'DELETE', `/series/${t2}?from=2030-01-27`)).data.removed, 2);
  assert.deepEqual(dates(t2), ['2030-01-20T09:00']);
});

test('shortening a series’ end date removes only services that haven’t happened', async () => {
  const t = seriesRow('Ends early');
  for (const d of ['2030-01-06', '2030-01-13', '2030-01-20', '2030-01-27']) seriesService(t, `${d}T09:00`);
  // New end date 2030-01-08: 01-13 is after it but already past, so it stays; the two ahead go.
  assert.equal((await call('admin', 'PATCH', `/series/${t}`, { ends_on: '2030-01-08' })).status, 200);
  assert.deepEqual(dates(t), ['2030-01-06T09:00', '2030-01-13T09:00']);
});

// ---------------------------------------------------------------- D. notifications
test('purgeStale deletes notifications read over 90 days ago and never an unread one', () => {
  const uid = run("INSERT INTO users (email, role) VALUES ('notes@mb.test', 'volunteer')");
  const now = new Date('2030-06-01T12:00:00Z'); // 90 days before is 2030-03-03 12:00:00
  const add = (title, createdAt, readAt) => run("INSERT INTO notifications (user_id, kind, title, created_at, read_at) VALUES (?, 'test', ?, ?, ?)", uid, title, createdAt, readAt);
  const oldRead = add('old read', '2030-03-03 11:59:59', '2030-03-04 08:00:00');
  const oldUnread = add('old unread', '2029-01-01 08:00:00', null);
  const recentRead = add('recent read', '2030-03-03 12:00:01', '2030-03-04 08:00:00');
  const newUnread = add('new unread', '2030-05-31 08:00:00', null);
  purgeStale(db, now);
  const left = db.prepare('SELECT id FROM notifications WHERE user_id = ? ORDER BY id').all(uid).map((n) => n.id);
  assert.deepEqual(left, [oldUnread, recentRead, newUnread]);
  assert.ok(!left.includes(oldRead));
});

// ---------------------------------------------------------------- E. connect card
test('the public connect card needs a phone number; email stays optional', async () => {
  const send = (body) => card({ first_name: 'Gus', ...body });
  const none = await send({ email: 'gus@example.com' });
  assert.equal(none.status, 400);
  assert.equal(none.data.error, 'Please add a phone number so we can reach you.');
  assert.equal((await send({ phone: '   ' })).data.error, 'Please add a phone number so we can reach you.');
  for (const phone of ['12345', '(555) 12-3', 'call me']) {
    const r = await send({ phone });
    assert.equal(r.status, 400, phone);
    assert.equal(r.data.error, 'That phone number doesn’t look right. For example: 555-123-4567.');
  }
  // Formatting is stripped before counting; email is not needed. One campus: a missing campus means that campus.
  const ok = await send({ phone: '(555) 123-4567' });
  assert.equal(ok.status, 201);
  assert.equal(db.prepare('SELECT campus_id c FROM connect_cards WHERE id = ?').get(ok.data.id).c, 1);
  assert.equal((await send({ phone: '+1 555 123 4567', email: 'gus@example.com' })).status, 201);
  assert.equal((await send({ phone: '555-123-4567', email: 'not an email' })).status, 400);
});

test('with several campuses the connect card needs a real campus', async () => {
  run("INSERT INTO campuses (name, short_name, timezone) VALUES ('South Campus', 'South', 'America/Chicago')");
  const send = (body) => card({ first_name: 'Gus', phone: '555-123-4567', ...body });
  const missing = await send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error, 'Please choose your campus.');
  for (const campus_id of [999, 'abc']) {
    const r = await send({ campus_id });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'That campus isn’t available. Please choose one from the list.');
  }
  const ok = await send({ campus_id: 2 });
  assert.equal(ok.status, 201);
  assert.equal(db.prepare('SELECT campus_id c FROM connect_cards WHERE id = ?').get(ok.data.id).c, 2);
});
