// Basic forms: who can set them up, who can read responses, and the public fill-in path.
// Own database and app, so rate limits and data don't touch other test files.
import { test as plainTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

let base, db, upDir;
const servers = [];
const cookies = {};
const ids = {};

const start = async () => {
  const s = createApp({ db, uploadDir: upDir }).listen(0);
  await new Promise((r) => s.once('listening', r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
};

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-forms-'));
  base = await start();
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North Campus', 'North', 'America/Chicago'), (2, 'South Campus', 'South', 'America/Chicago');`);
  db.exec(`INSERT INTO people (id, first_name, last_name, email) VALUES (101, 'Linda', 'Linked', 'linda@example.com'), (102, 'Ed', 'Existing', 'ed@example.com')`);
  const accounts = [['admin', 'admin', null, null], ['staff', 'staff', null, null], ['north', 'staff', '[1]', null], ['south', 'staff', '[2]', null],
    ['leader', 'leader', null, null], ['vol', 'volunteer', null, 101], ['northvol', 'volunteer', '[1]', null], ['northadmin', 'admin', '[1]', null]];
  for (const [key, role, campuses, person] of accounts) {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, person).lastInsertRowid;
    ids[key] = Number(id);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
// Each test gets a fresh app (and so fresh rate limits) on the shared database.
const test = (name, fn) => plainTest(name, async () => { base = await start(); await fn(); });

after(() => { for (const s of servers) s.close(); });

async function call(root, role, method, url, body, headers = {}) {
  const res = await fetch(root + '/api' + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const api = (role, method, url, body) => call(base, role, method, url, body);

const QUESTIONS = [
  { id: 'why', label: 'Why do you want to serve?', type: 'longtext', required: true },
  { id: 'area', label: 'Where?', type: 'choice', options: ['Kids', 'Music'], required: true },
  { id: 'days', label: 'Which days?', type: 'multichoice', options: ['Sunday', 'Wednesday', 'Friday'] },
  { id: 'bg', label: 'Okay with a background check?', type: 'yesno' },
  { id: 'start', label: 'Earliest start', type: 'date' },
];
const makeForm = (extra = {}) => api("admin", "POST", "/admin/forms", { title: "Volunteer interest", intro: "Tell us how you’d like to help.", questions: QUESTIONS, ...extra });
// The public route returns only { ok: true }, so tests read the new row's id from the database.
const submit = async (slug, body, role) => {
  const res = await api(role || null, 'POST', `/public/forms/${slug}`, body);
  res.id = res.status === 201 ? db.prepare('SELECT MAX(id) id FROM form_responses').get().id : null;
  return res;
};
const good = { name: 'Pat Guest', email: 'Pat@Example.com', answers: { why: 'To help', area: 'Kids' } };

test('only staff and admins can set up forms; leaders and volunteers get 403', async () => {
  for (const role of ['vol', 'leader']) {
    assert.equal((await api(role, 'POST', '/admin/forms', { title: 'Nope' })).status, 403);
    assert.equal((await api(role, 'GET', '/admin/forms')).status, 403);
  }
  assert.equal((await api(null, 'GET', '/admin/forms')).status, 401);
  const made = await makeForm();
  assert.equal(made.status, 201);
  assert.equal(made.data.slug, 'volunteer-interest');
  assert.equal(made.data.campus_id, null);
  assert.equal(made.data.questions.length, 5);
  assert.deepEqual(made.data.ask_contact, { name: 'required', email: 'optional', phone: 'off' });
  // A second form with the same title gets its own link; a taken chosen link is refused.
  assert.equal((await makeForm()).data.slug, 'volunteer-interest-2');
  assert.equal((await makeForm({ slug: 'volunteer-interest' })).status, 409);
  assert.equal((await makeForm({ slug: 'No Spaces!' })).status, 400);
  assert.equal((await makeForm({ questions: [{ label: 'Pick', type: 'choice', options: [] }] })).status, 400);
  assert.equal((await makeForm({ questions: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })).status, 400);
  for (const role of ['vol', 'leader']) assert.equal((await api(role, 'PATCH', '/admin/forms/1', { title: 'Hacked' })).status, 403);
});

test('campus-limited staff: only their campus, never church-wide, never another campus’s responses', async () => {
  assert.equal((await api('north', 'POST', '/admin/forms', { title: 'Church wide' })).status, 403);
  assert.equal((await api('north', 'POST', '/admin/forms', { title: 'South one', campus_id: 2 })).status, 403);
  const mine = await api('north', 'POST', '/admin/forms', { title: 'North youth', campus_id: 1, questions: [{ label: 'Grade?' }] });
  assert.equal(mine.status, 201);
  const southForm = await api('south', 'POST', '/admin/forms', { title: 'South food drive', campus_id: 2 });
  assert.equal(southForm.status, 201);
  await submit(mine.data.slug, { name: 'Kid', answers: {} });
  await submit(southForm.data.slug, { name: 'Neighbor', answers: {} });

  const list = (await api('north', 'GET', '/admin/forms')).data;
  const slugs = list.map((f) => f.slug);
  assert.ok(slugs.includes('north-youth') && slugs.includes('volunteer-interest'), 'sees own campus and church-wide');
  assert.ok(!slugs.includes('south-food-drive'));
  // Church-wide forms are listed but their counts, responses and editing are for unlimited staff.
  const wide = list.find((f) => f.slug === 'volunteer-interest');
  assert.equal(wide.can_manage, false);
  assert.equal(wide.total, null);
  assert.equal(list.find((f) => f.slug === 'north-youth').total, 1);
  assert.equal((await api('north', 'GET', `/admin/forms/${wide.id}/responses`)).status, 403);
  assert.equal((await api('north', 'GET', `/admin/forms/${wide.id}/responses.csv`)).status, 403);
  assert.equal((await api('north', 'PATCH', `/admin/forms/${wide.id}`, { title: 'Mine now' })).status, 403);
  // Another campus's form isn't there at all.
  assert.equal((await api('north', 'GET', `/admin/forms/${southForm.data.id}/responses`)).status, 404);
  assert.equal((await api('north', 'GET', `/admin/forms/${southForm.data.id}`)).status, 404);
  assert.equal((await api('north', 'PATCH', `/admin/forms/${southForm.data.id}`, { title: 'x' })).status, 404);
  // Moving a form to another campus (or church-wide) isn't allowed either.
  assert.equal((await api('north', 'PATCH', `/admin/forms/${mine.data.id}`, { campus_id: 2 })).status, 403);
  assert.equal((await api('north', 'PATCH', `/admin/forms/${mine.data.id}`, { campus_id: null })).status, 403);
  // Unlimited staff see everything.
  assert.equal((await api('staff', 'GET', `/admin/forms/${southForm.data.id}/responses`)).data.rows.length, 1);
  assert.equal((await api('staff', 'GET', `/admin/forms/${wide.id}/responses`)).status, 200);
  assert.equal((await api('north', 'GET', `/admin/forms/${mine.data.id}/responses`)).data.rows.length, 1);
});

test('a guest can fill in a public form; answers are checked', async () => {
  const f = (await makeForm({ title: 'Check me' })).data;
  const view = await call(base, null, 'GET', `/public/forms/${f.slug}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.title, 'Check me');
  // Only what a person filling it in needs.
  for (const k of ['notify_user_id', 'campus_id', 'created_by', 'id', 'active']) assert.ok(!(k in view.data), `${k} not public`);
  assert.deepEqual(Object.keys(view.data.questions[1]).sort(), ['id', 'label', 'options', 'required', 'type']);

  const ok = await submit(f.slug, { ...good, answers: { ...good.answers, days: ['Sunday', 'Friday'], bg: 'yes', start: '2030-01-05' } });
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(ok.id);
  assert.equal(row.user_id, null);
  assert.equal(row.person_id, null);
  assert.equal(row.email, 'pat@example.com');
  assert.deepEqual(JSON.parse(row.answers), { why: 'To help', area: 'Kids', days: ['Sunday', 'Friday'], bg: 'Yes', start: '2030-01-05' });

  const err = async (body, text) => {
    const res = await submit(f.slug, body);
    assert.equal(res.status, 400, JSON.stringify(res.data));
    assert.match(res.data.error, text);
  };
  await err({ ...good, name: '' }, /name/);
  await err({ ...good, email: 'nope' }, /email/);
  await err({ ...good, answers: { area: 'Kids' } }, /Why do you want/);
  await err({ ...good, answers: { why: 'x', area: 'Nursery' } }, /choices/);
  await err({ ...good, answers: { why: 'x', area: 'Kids', days: ['Monday'] } }, /choices/);
  await err({ ...good, answers: { why: 'x', area: 'Kids', start: 'tomorrow' } }, /date/);
  // Long answers are cut to the cap, not stored whole.
  const long = await submit(f.slug, { ...good, name: 'N'.repeat(500), answers: { why: 'w'.repeat(9000), area: 'Kids' } });
  const saved = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(long.id);
  assert.equal(saved.name.length, 120);
  assert.equal(JSON.parse(saved.answers).why.length, 4000);
  // A phone the form doesn't ask for is dropped.
  const dropped = await submit(f.slug, { ...good, phone: '555-0100' });
  assert.equal(db.prepare('SELECT phone FROM form_responses WHERE id = ?').get(dropped.id).phone, '');
});

test('inactive and unknown forms are 404; archiving keeps the responses', async () => {
  const f = (await makeForm({ title: 'Short lived' })).data;
  assert.equal((await submit(f.slug, good)).status, 201);
  const off = await api('admin', 'PATCH', `/admin/forms/${f.id}`, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.slug, f.slug, 'the link never changes');
  assert.equal((await call(base, null, 'GET', `/public/forms/${f.slug}`)).status, 404);
  assert.equal((await submit(f.slug, good)).status, 404);
  assert.equal((await submit('no-such-form', good)).status, 404);
  assert.equal((await api('admin', 'GET', `/admin/forms/${f.id}/responses`)).data.rows.length, 1);
  assert.equal((await api('admin', 'PATCH', `/admin/forms/${f.id}`, { active: true })).status, 200);
  assert.equal((await submit(f.slug, good)).status, 201);
});

test('signed-in forms need a session and record the person only from the account', async () => {
  const f = (await makeForm({ title: 'Members only', audience: 'signed_in' })).data;
  const guestView = await call(base, null, 'GET', `/public/forms/${f.slug}`);
  assert.equal(guestView.status, 200);
  assert.equal(guestView.data.needs_sign_in, true);
  assert.equal(guestView.data.questions, undefined, 'questions stay private until sign-in');
  assert.equal((await submit(f.slug, good)).status, 401);

  assert.equal((await call(base, 'vol', 'GET', `/public/forms/${f.slug}`)).data.questions.length, 5);
  // Typing the email of a different person in People must not link to that person.
  const res = await submit(f.slug, { ...good, name: 'Ed Existing', email: 'ed@example.com' }, 'vol');
  assert.equal(res.status, 201);
  const row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(res.id);
  assert.equal(row.user_id, ids.vol);
  assert.equal(row.person_id, 101, 'the signed-in account’s own person');
  assert.equal(row.email, 'ed@example.com');
  // An account with no linked person records the account but no person.
  const none = await submit(f.slug, good, 'staff');
  assert.equal(db.prepare('SELECT person_id FROM form_responses WHERE id = ?').get(none.id).person_id, null);
  // Listed for the app's More tab (signed in only); public forms aren't.
  assert.ok((await api('vol', 'GET', '/forms')).data.some((x) => x.slug === f.slug));
  assert.ok(!(await api('vol', 'GET', '/forms')).data.some((x) => x.slug === 'volunteer-interest'));
  assert.equal((await api(null, 'GET', '/forms')).status, 401);
});

test('a typed email that matches an existing person does not link to them', async () => {
  const f = (await makeForm({ title: 'Typed email' })).data;
  const res = await submit(f.slug, { ...good, name: 'Ed Existing', email: 'ed@example.com' });
  const row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(res.id);
  assert.equal(row.person_id, null);
  assert.equal(row.user_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, 2, 'no person was created either');
});

test('honeypot: a filled hidden field saves nothing', async () => {
  const f = (await makeForm({ title: 'Bots' })).data;
  const res = await submit(f.slug, { ...good, website: 'http://spam.example' });
  assert.equal(res.status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM form_responses WHERE form_id = ?').get(f.id).n, 0);
});

test('submitting is rate-limited per address', async () => {
  const other = base;
  const f = (await call(other, 'admin', 'POST', '/admin/forms', { title: 'Busy' })).data;
  const send = () => call(other, null, 'POST', `/public/forms/${f.slug}`, { name: 'Pat' });
  for (let i = 0; i < 10; i++) assert.equal((await send()).status, 201);
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /wait/);
});

test('staff are told about a response without the answers in the notice', async () => {
  const f = (await makeForm({ title: 'Prayer needs', notify_user_id: ids.staff })).data;
  assert.equal(f.notify_user_id, ids.staff);
  const secret = 'My private worry about Dave';
  assert.equal((await submit(f.slug, { name: 'Anon', answers: { why: secret, area: 'Kids' } })).status, 201);
  const notes = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?').all(ids.staff, 'form');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, 'Open Forms in the Hub to read it.');
  for (const v of Object.values(notes[0])) assert.ok(!String(v).includes(secret) && !String(v).includes('Anon'));
  // Nobody is told when no one is chosen; a campus-limited person can't be told about a church-wide form; volunteers can't be chosen.
  const before = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
  const quiet = (await makeForm({ title: 'Quiet' })).data;
  await submit(quiet.slug, { name: 'Pat' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, before);
  assert.equal((await makeForm({ title: 'Bad notify', notify_user_id: ids.north })).status, 400);
  assert.equal((await makeForm({ title: 'Bad notify', notify_user_id: ids.vol })).status, 400);
});

test('responses: list, done and reopen, CSV that neutralises formulas, delete is admin-only and audited', async () => {
  const f = (await makeForm({ title: 'Export me' })).data;
  const a = await submit(f.slug, { name: '=HYPERLINK("http://x")', email: 'a@example.com', answers: { why: '+1 or -2, "quoted"\nline', area: 'Music', days: ['Sunday', 'Friday'] } });
  await submit(f.slug, { name: '@sum', answers: { why: '-cmd', area: 'Kids' } });
  const list = await api('staff', 'GET', `/admin/forms/${f.id}/responses`);
  assert.equal(list.data.rows.length, 2);
  assert.equal((await api('leader', 'GET', `/admin/forms/${f.id}/responses`)).status, 403);
  assert.equal((await api('vol', 'GET', `/admin/forms/${f.id}/responses.csv`)).status, 403);

  assert.equal((await api('leader', 'PATCH', `/admin/form-responses/${a.id}`, { done: true })).status, 403);
  assert.equal((await api('staff', 'PATCH', `/admin/form-responses/${a.id}`, { done: true })).status, 200);
  let row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(a.id);
  assert.equal(row.status, 'done');
  assert.equal(row.done_by, ids.staff);
  assert.ok(row.done_at);
  await api('staff', 'PATCH', `/admin/form-responses/${a.id}`, { done: false });
  row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(a.id);
  assert.deepEqual([row.status, row.done_by, row.done_at], ['new', null, null]);

  const csv = await api('staff', 'GET', `/admin/forms/${f.id}/responses.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /export-me-responses\.csv/);
  const lines = csv.data.split('\r\n');
  assert.equal(lines[0], 'Name,Email,Phone,Signed-in person,Why do you want to serve?,Where?,Which days?,Okay with a background check?,Earliest start,Status,Received');
  assert.ok(csv.data.includes(`"'=HYPERLINK(""http://x"")"`), 'a leading = is defused');
  assert.ok(csv.data.includes("'@sum"), 'a leading @ is defused');
  assert.ok(csv.data.includes("'-cmd"), 'a leading - is defused');
  assert.ok(csv.data.includes(`"'+1 or -2, ""quoted""\nline"`), 'a leading + is defused and quotes are escaped');
  assert.ok(csv.data.includes('Sunday; Friday'));

  // Only admins delete; it's audited; a campus-limited admin-less staff can't.
  assert.equal((await api('staff', 'DELETE', `/admin/form-responses/${a.id}`)).status, 403);
  assert.equal((await api('admin', 'DELETE', `/admin/form-responses/${a.id}`)).status, 200);
  assert.equal((await api('admin', 'DELETE', `/admin/form-responses/${a.id}`)).status, 404);
  assert.equal((await api('staff', 'GET', `/admin/forms/${f.id}/responses`)).data.rows.length, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'form.response_delete' AND user_id = ?").get(ids.admin));
});

test('create, edit and archive are audited, and the notice never carries answer text into the audit', async () => {
  const f = (await makeForm({ title: 'Audited' })).data;
  await api('admin', 'PATCH', `/admin/forms/${f.id}`, { intro: 'New intro' });
  await api('admin', 'PATCH', `/admin/forms/${f.id}`, { active: false });
  const actions = db.prepare("SELECT action FROM audit_log WHERE detail LIKE ? ORDER BY id").all('Audited%').map((x) => x.action);
  assert.deepEqual(actions, ['form.create', 'form.edit', 'form.archive']);
  // Editing keeps the link; the admin list shows the form with its counts.
  const row = (await api('admin', 'GET', '/admin/forms')).data.find((x) => x.id === f.id);
  assert.equal(row.slug, f.slug);
  assert.equal(row.active, false);
  assert.equal(row.total, 0);
});

test('forms need the app header like other changes', async () => {
  const res = await fetch(`${base}/api/public/forms/volunteer-interest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good) });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------- security review fixes
const newUser = (key, role, campuses = null) => {
  const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid);
  ids[key] = id;
  return id;
};
const formNotes = (userId) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'form'").all(userId);

test('exporting responses is audited with the count, never the answers', async () => {
  const f = (await makeForm({ title: 'Audit export' })).data;
  await submit(f.slug, { name: 'Pat', answers: { why: 'Very private reason', area: 'Kids' } });
  await submit(f.slug, { name: 'Sam', answers: { why: 'Another secret', area: 'Music' } });
  assert.equal((await api('staff', 'GET', `/admin/forms/${f.id}/responses.csv`)).status, 200);
  const row = db.prepare("SELECT * FROM audit_log WHERE action = 'form.export' AND detail LIKE 'Audit export%'").get();
  assert.equal(row.user_id, ids.staff);
  assert.equal(row.detail, 'Audit export (2 responses)');
  assert.ok(!/private|secret|Pat|Sam/.test(row.detail));
});

test('the per-form hourly limit survives a flood of other addresses', async () => {
  const f = (await makeForm({ title: 'Flooded' })).data;
  const from = (n, slug = f.slug) => call(base, null, 'POST', `/public/forms/${slug}`, { name: 'Pat', answers: { why: 'x', area: 'Kids' } }, { 'x-forwarded-for': `10.${n >> 16 & 255}.${n >> 8 & 255}.${n & 255}` });
  for (let i = 0; i < 200; i++) assert.equal((await from(i)).status, 201);
  // Fill (and overflow) the address table; each attempt is counted before the form is looked up.
  for (let i = 0; i < 5200; i += 100) await Promise.all(Array.from({ length: 100 }, (_, j) => from(1000 + i + j, 'no-such-form')));
  const late = await from(999999);
  assert.equal(late.status, 429);
  assert.match(late.data.error, /lot of responses/);
});

test('shared Wi-Fi: failed tries are counted more loosely than successes', async () => {
  const f = (await makeForm({ title: 'Wifi' })).data;
  for (let i = 0; i < 10; i++) assert.equal((await submit(f.slug, { name: '' })).status, 400);
  assert.equal((await submit(f.slug, good)).status, 201);
  // 30 tries in all (any outcome), then the address waits.
  for (let i = 0; i < 19; i++) assert.equal((await submit(f.slug, { name: '' })).status, 400);
  assert.equal((await submit(f.slug, good)).status, 429);
});

test('IPv6 addresses share a limit across their /64', async () => {
  const f = (await makeForm({ title: 'Six' })).data;
  const from = (a) => call(base, null, 'POST', `/public/forms/${f.slug}`, good, { 'x-forwarded-for': a });
  for (let i = 0; i < 10; i++) assert.equal((await from(`2001:db8:1:2:${i + 1}::1`)).status, 201);
  assert.equal((await from('2001:db8:1:2:ffff::9')).status, 429);
  assert.equal((await from('2001:db8:1:3::1')).status, 201, 'another /64 is another address');
});

test('only one notice per form per person in 15 minutes', async () => {
  const u = newUser('notified', 'staff');
  const f = (await makeForm({ title: 'Quick ones', notify_user_id: u })).data;
  await submit(f.slug, good);
  await submit(f.slug, good);
  assert.equal(formNotes(u).length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM form_responses WHERE form_id = ?').get(f.id).n, 2, 'both responses are kept');
  // A different form still notifies; an old notice no longer blocks.
  const g = (await makeForm({ title: 'Other one', notify_user_id: u })).data;
  await submit(g.slug, good);
  assert.equal(formNotes(u).length, 2);
  db.prepare("UPDATE notifications SET created_at = datetime('now', '-16 minutes') WHERE user_id = ?").run(u);
  await submit(f.slug, good);
  assert.equal(formNotes(u).length, 3);
});

test('a notify person who is demoted, switched off or limited later is not told', async () => {
  const demoted = newUser('demoted', 'staff');
  const off = newUser('switchedoff', 'staff');
  const limited = newUser('limitedlater', 'staff');
  const fa = (await makeForm({ title: 'Demote' , notify_user_id: demoted })).data;
  const fb = (await makeForm({ title: 'Switch off', notify_user_id: off })).data;
  const fc = (await makeForm({ title: 'Limit later', notify_user_id: limited })).data;
  db.prepare("UPDATE users SET role = 'volunteer' WHERE id = ?").run(demoted);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(off);
  db.prepare("UPDATE users SET campus_ids = '[2]' WHERE id = ?").run(limited);
  for (const f of [fa, fb, fc]) assert.equal((await submit(f.slug, good)).status, 201);
  for (const u of [demoted, off, limited]) assert.equal(formNotes(u).length, 0);
});

test('a question id like "constructor" is renamed and never reads inherited values', async () => {
  const made = await makeForm({ title: 'Proto', questions: [{ id: 'constructor', label: 'Sneaky', required: true }, { id: '__proto__', label: 'Two' }, { id: 'prototype', label: 'Three' }] });
  assert.equal(made.status, 201);
  assert.deepEqual(made.data.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
  assert.equal((await submit(made.data.slug, { name: 'Pat', answers: {} })).status, 400);
  // A form saved earlier with such an id (straight into the database) is still checked properly.
  const slug = 'legacy-proto';
  db.prepare('INSERT INTO forms (slug, title, questions, ask_contact) VALUES (?, ?, ?, ?)').run(slug, 'Legacy', JSON.stringify([{ id: 'constructor', label: 'Sneaky', type: 'text', required: true }]), '{"name":"off"}');
  const res = await submit(slug, { answers: {} });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /Sneaky/);
  assert.equal((await submit(slug, { answers: { constructor: 'real answer' } })).status, 201);

  // Any other inherited name (toString, valueOf…) is renamed too, and an unanswered one exports as blank.
  const ts = await makeForm({ title: 'Proto two', questions: [{ id: 'toString', label: 'Ts' }, { id: 'valueOf', label: 'Vo' }] });
  assert.deepEqual(ts.data.questions.map((q) => q.id), ['q1', 'q2']);
  const slug2 = 'legacy-tostring';
  db.prepare('INSERT INTO forms (slug, title, questions, ask_contact) VALUES (?, ?, ?, ?)').run(slug2, 'Legacy two', JSON.stringify([{ id: 'toString', label: 'Ts', type: 'text' }]), '{"name":"optional"}');
  assert.equal((await submit(slug2, { name: 'Lee', answers: {} })).status, 201);
  const fid = db.prepare('SELECT id FROM forms WHERE slug = ?').get(slug2).id;
  const csv = await api('staff', 'GET', `/admin/forms/${fid}/responses.csv`);
  assert.equal(csv.status, 200);
  assert.doesNotMatch(typeof csv.data === 'string' ? csv.data : JSON.stringify(csv.data), /native code/);
});

test('notify options: only people who could be told, no campus lists', async () => {
  const north = (await api('north', 'GET', '/admin/forms/notify-options?campus_id=1')).data;
  const names = north.map((u) => u.id);
  assert.ok(names.includes(ids.admin) && names.includes(ids.staff) && names.includes(ids.north));
  assert.ok(!names.includes(ids.south), 'south-only staff are not offered for a north form');
  assert.ok(!names.includes(ids.vol) && !names.includes(ids.leader));
  for (const u of north) assert.deepEqual(Object.keys(u).sort(), ['id', 'name']);
  // Limited staff can't ask about another campus or church-wide, so get nothing.
  assert.deepEqual((await api('north', 'GET', '/admin/forms/notify-options?campus_id=2')).data, []);
  assert.deepEqual((await api('north', 'GET', '/admin/forms/notify-options')).data, []);
  // Church-wide, for unlimited staff: only people with no campus limit.
  const wide = (await api('staff', 'GET', '/admin/forms/notify-options')).data.map((u) => u.id);
  assert.ok(wide.includes(ids.staff) && !wide.includes(ids.north) && !wide.includes(ids.south));
  assert.equal((await api('vol', 'GET', '/admin/forms/notify-options')).status, 403);
});

test('another campus’s responses can’t be changed or deleted (404)', async () => {
  const f = (await api('south', 'POST', '/admin/forms', { title: 'South only', campus_id: 2 })).data;
  const r = await submit(f.slug, { name: 'Neighbor' });
  assert.equal((await api('north', 'PATCH', `/admin/form-responses/${r.id}`, { done: true })).status, 404);
  assert.equal((await api('northadmin', 'DELETE', `/admin/form-responses/${r.id}`)).status, 404);
  assert.equal(db.prepare('SELECT status FROM form_responses WHERE id = ?').get(r.id).status, 'new');
  assert.equal((await api('south', 'PATCH', `/admin/form-responses/${r.id}`, { done: true })).status, 200);
});

test('signed-in forms at another campus are 404 for a campus-limited account', async () => {
  const f = (await makeForm({ title: 'South members', audience: 'signed_in', campus_id: 2 })).data;
  assert.equal((await call(base, 'northvol', 'GET', `/public/forms/${f.slug}`)).status, 404);
  assert.equal((await submit(f.slug, good, 'northvol')).status, 404);
  assert.equal((await call(base, 'vol', 'GET', `/public/forms/${f.slug}`)).data.questions.length, 5);
  assert.equal((await submit(f.slug, good, 'vol')).status, 201);
  // A church-wide signed-in form is open to the limited account.
  const wide = (await makeForm({ title: 'Everyone members', audience: 'signed_in' })).data;
  assert.equal((await submit(wide.slug, good, 'northvol')).status, 201);
});

test('a public submission returns no response id', async () => {
  const f = (await makeForm({ title: 'No ids' })).data;
  const res = await api(null, 'POST', `/public/forms/${f.slug}`, good);
  assert.equal(res.status, 201);
  assert.deepEqual(res.data, { ok: true });
});
