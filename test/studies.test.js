// Bible studies: the coordinator switch, materials, studies, teachers and students, completions, the
// request queue and its notices, the profile card, the CSV import and the member-app endpoints.
// Own database and app with a fixed clock (15 June 2026 at the church), so nothing depends on today's date.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession, canStudies } from '../server/auth.js';
import { outbox } from '../server/mail.js';
import { progressText } from '../public/js/study-progress.js';

const TODAY = '2026-06-15';
let server, base, db, upDir;
const cookies = {};
const U = {}; // account ids
const P = {}; // person ids
const M = {}; // material ids
const S = {}; // study ids

before(async () => {
  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-studies-'));
  server = createApp({ db, uploadDir: upDir, now: () => new Date(`${TODAY}T17:00:00Z`) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago'), (2, 'Meadowbrook South', 'South', 'America/Chicago');`);
  const person = (key, first, campus, extra = {}) => {
    P[key] = Number(db.prepare('INSERT INTO people (first_name, last_name, email, phone, campus_id) VALUES (?, ?, ?, ?, ?)')
      .run(first, 'Test', extra.email ?? `${key}@example.com`, extra.phone ?? '555-0100', campus).lastInsertRowid);
  };
  person('teacher', 'Tess', 1, { phone: '555-0101' });
  person('teacher2', 'Tom', 1);            // teaches, no account
  person('teacher3', 'Tara', 2);           // a teacher on another study
  person('s1', 'Sam', 1, { phone: '555-0111' });    // agrees to share contact
  person('s2', 'Sue', 1, { phone: '555-0122' });    // doesn't
  person('s3', 'Stu', 2);
  person('s4', 'Sky', null);               // no campus
  person('other', 'Olive', 1);
  person('dupa', 'Dana', 1, { email: 'shared@example.com' });
  person('dupb', 'Dale', 1, { email: 'shared@example.com' });
  for (const [key, role, campuses, flag, personKey] of [
    ['admin', 'admin', null, 0], ['northadmin', 'admin', '[1]', 0], ['staff', 'staff', null, 0], ['northstaff', 'staff', '[1]', 0], ['southstaff', 'staff', '[2]', 0],
    ['coord', 'volunteer', null, 1], ['coord2', 'volunteer', null, 1], ['northcoord', 'volunteer', '[1]', 1], ['leader', 'leader', null, 0], ['vol', 'volunteer', null, 0],
    ['teacher', 'volunteer', null, 0, 'teacher'], ['teacher3', 'volunteer', null, 0, 'teacher3'], ['student', 'volunteer', null, 0, 's1'], ['student3', 'volunteer', null, 0, 's3'], ['unlinked', 'volunteer', null, 0]]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, campus_ids, studies, person_id) VALUES (?, ?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, flag, personKey ? P[personKey] : null).lastInsertRowid);
    U[key] = id;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.close(); fs.rmSync(upDir, { recursive: true, force: true }); });

async function api(who, method, url, body, { raw = false } = {}) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: raw || !type.includes('json') ? await res.text() : await res.json() };
}
const audits = (action) => db.prepare('SELECT user_id, detail FROM audit_log WHERE action = ?').all(action);

test('migration 41: the tables, the coordinator flag and the version', () => {
  assert.ok(SCHEMA_VERSION >= 41);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stud%'").all().map((t) => t.name);
  for (const t of ['study_materials', 'studies', 'study_people', 'study_completions', 'study_requests', 'study_pending_people']) assert.ok(tables.includes(t), t);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'studies'));
  // Campus is optional on a study, and lesson fields are optional.
  const cols = Object.fromEntries(db.prepare('PRAGMA table_info(studies)').all().map((c) => [c.name, c.notnull]));
  assert.ok('source' in cols && 'reviewed_at' in cols && 'material_text' in cols, 'groundwork for teacher-reported studies');
  assert.equal(db.prepare("SELECT source FROM studies LIMIT 1").get()?.source ?? 'coordinator', 'coordinator');
  assert.equal(cols.campus_id, 0);
  assert.equal(cols.lesson, 0);
  assert.equal(cols.planned_lessons, 0);
  assert.equal(cols.sessions, 0);
});

test('canStudies: staff and above, or the switch; leaders and volunteers get nothing extra', () => {
  assert.equal(canStudies({ role: 'volunteer', studies: true }), true);
  assert.equal(canStudies({ role: 'volunteer', studies: false }), false);
  assert.equal(canStudies({ role: 'leader', studies: false }), false);
  assert.equal(canStudies({ role: 'staff' }), true);
  assert.equal(canStudies({ role: 'admin' }), true);
  assert.equal(canStudies(null), false);
});

test('the coordinator switch: admin grants it, it is audited, others and campus-limited admins cannot', async () => {
  const id = U.vol;
  assert.equal((await api('staff', 'PATCH', `/users/${id}`, { studies: true })).status, 403, 'staff cannot grant');
  assert.equal((await api('coord', 'PATCH', `/users/${id}`, { studies: true })).status, 403, 'a coordinator cannot grant');
  assert.equal((await api('northadmin', 'PATCH', `/users/${id}`, { studies: true })).status, 403, 'a campus-limited admin cannot (it is church-wide)');
  assert.equal((await api('admin', 'PATCH', `/users/${id}`, { studies: true })).status, 200);
  assert.equal(db.prepare('SELECT studies FROM users WHERE id = ?').get(id).studies, 1);
  assert.equal((await api('vol', 'GET', '/studies')).status, 200, 'the switch takes effect');
  const a = audits('user.studies');
  assert.equal(a.length, 1);
  assert.deepEqual(JSON.parse(a[0].detail), { user_id: id, granted: true });
  assert.equal((await api('admin', 'PATCH', `/users/${id}`, { studies: false })).status, 200);
  assert.equal((await api('vol', 'GET', '/studies')).status, 403);
  assert.equal(audits('user.studies').length, 2);
  // It shows in the account list, and the person page.
  const list = await api('admin', 'GET', '/users?q=coord@');
  assert.equal(list.data.users.find((u) => u.email === 'coord@mb.org').studies, true);
  // Creating an account with it is audited in the create line.
  const made = await api('admin', 'POST', '/users', { email: 'new-coord@mb.org', role: 'volunteer', studies: true });
  assert.equal(made.status, 201);
  assert.equal(db.prepare('SELECT studies FROM users WHERE id = ?').get(made.data.id).studies, 1);
  assert.ok(audits('user.create').some((x) => x.detail.includes('Bible studies')));
  assert.equal((await api('northadmin', 'POST', '/users', { email: 'x-coord@mb.org', role: 'volunteer', studies: true })).status, 403);
  // A campus-limited admin cannot touch an account that holds it.
  assert.equal((await api('northadmin', 'PATCH', `/users/${U.coord}`, { active: false })).status, 403);
});

test('materials: coordinators and staff manage them; nobody else; retired, never deleted', async () => {
  for (const who of ['leader', 'vol', 'teacher', 'student', 'unlinked']) {
    assert.equal((await api(who, 'GET', '/studies/materials')).status, 403, `${who} read`);
    assert.equal((await api(who, 'POST', '/studies/materials', { title: 'Nope' })).status, 403, `${who} write`);
  }
  assert.equal((await api(null, 'GET', '/studies/materials')).status, 401);
  const a = await api('coord', 'POST', '/studies/materials', { title: 'Foundations', author: 'A. Writer', lessons: 8, teacher_notes: 'Copies are in the office' });
  assert.equal(a.status, 201);
  M.found = a.data.id;
  const b = await api('staff', 'POST', '/studies/materials', { title: 'The Gospel of John' });
  assert.equal(b.status, 201);
  M.john = b.data.id;
  M.old = (await api('coord', 'POST', '/studies/materials', { title: 'Old Workbook' })).data.id;
  assert.equal((await api('coord', 'POST', '/studies/materials', { title: 'foundations' })).status, 409, 'same title, any case');
  assert.equal((await api('coord', 'POST', '/studies/materials', { title: '' })).status, 400);
  assert.equal((await api('staff', 'PATCH', `/studies/materials/${M.john}`, { author: 'Various' })).status, 200);
  const list = await api('staff', 'GET', '/studies/materials');
  assert.equal(list.data.materials.find((m) => m.id === M.john).author, 'Various');
  assert.equal(list.data.materials.find((m) => m.id === M.found).lessons, 8);
  // Retire: stays on the list for history, can't start a new study, and there is no delete.
  assert.equal((await api('coord', 'PATCH', `/studies/materials/${M.old}`, { active: false })).status, 200);
  assert.equal((await api('coord', 'GET', '/studies/materials?active=1')).data.materials.some((m) => m.id === M.old), false);
  assert.equal((await api('coord', 'GET', '/studies/materials')).data.materials.find((m) => m.id === M.old).active, false);
  assert.equal((await api('admin', 'DELETE', `/studies/materials/${M.old}`)).status, 404);
  assert.equal((await api('coord', 'POST', '/studies', { material_id: M.old, teacher_ids: [P.teacher], student_ids: [P.s1] })).status, 400);
  assert.ok(audits('study.material_create').length >= 3);
  assert.equal(audits('study.material_retire').length, 1);
});

test('every study route has a guard: the read list and the writes refuse leaders, volunteers, teachers and students', async () => {
  for (const who of ['leader', 'vol', 'teacher', 'student', 'unlinked']) {
    for (const [method, url, body] of [['GET', '/studies'], ['GET', '/studies/summary'], ['GET', '/studies/teachers'], ['GET', '/studies/export.csv'], ['GET', '/studies/requests'],
      ['POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.s1] }], ['POST', '/study-completions', { person_id: P.s1, material_id: M.found, completed_on: '2026-01-01' }],
      ['POST', '/studies/import/preview', { csv: 'x' }], ['POST', '/studies/import', { csv: 'x' }]]) {
      const res = await api(who, method, url, body);
      assert.equal(res.status, 403, `${who} ${method} ${url} gave ${res.status}`);
    }
  }
  assert.equal((await api(null, 'GET', '/studies')).status, 401);
  const noHeader = await fetch(`${base}/api/studies`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.coord }, body: '{}' });
  assert.equal(noHeader.status, 403, 'writes need the app header');
});

test('choosing people: coordinators get names only, from campuses they reach', async () => {
  const res = await api('northcoord', 'GET', '/studies/people?q=te');
  assert.equal(res.status, 200);
  const names = res.data.map((p) => p.name);
  assert.ok(names.includes('Tess Test'));
  assert.equal(names.includes('Stu Test'), false, 'a south person is not offered to a north-only coordinator');
  assert.deepEqual(Object.keys(res.data[0]).sort(), ['campus', 'has_account', 'id', 'name']);
  assert.deepEqual((await api('coord', 'GET', '/studies/people?q=t')).data, [], 'at least two letters');
  for (const who of ['leader', 'vol', 'teacher']) assert.equal((await api(who, 'GET', '/studies/people?q=tess')).status, 403, who);
});

test('creating a study: teachers and students, optional fields, a teacher without an account, campus rules', async () => {
  const res = await api('coord', 'POST', '/studies', {
    material_id: M.found, teacher_ids: [P.teacher, P.teacher2], students: [{ person_id: P.s1, share_contact: true }, { person_id: P.s2, share_contact: false }],
    rhythm: 'Tuesdays, coffee shop', coordinator_note: 'Prefers mornings',
  });
  assert.equal(res.status, 201);
  S.main = res.data.id;
  assert.deepEqual(res.data.teachers_without_account.map((t) => t.id), [P.teacher2], 'prompts to invite the teacher with no account');
  const st = db.prepare('SELECT * FROM studies WHERE id = ?').get(S.main);
  assert.equal(st.campus_id, 1, 'defaults to the first student’s campus, for reporting');
  assert.equal(st.started_on, TODAY, 'started today, on the fixed clock');
  assert.equal(st.lesson, null);
  assert.equal(st.planned_lessons, null);
  assert.equal(st.sessions, null);
  // Not enough people, or the same person in both roles.
  assert.equal((await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [] })).status, 400);
  assert.equal((await api('coord', 'POST', '/studies', { teacher_ids: [], student_ids: [P.s1] })).status, 400);
  assert.equal((await api('coord', 'POST', '/studies', { teacher_ids: [P.s1], student_ids: [P.s1] })).status, 400);
  assert.equal((await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.s1], started_on: 'June' })).status, 400);
  assert.equal((await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.s1], coordinator_note: 'x'.repeat(281) })).status, 400, 'the note is capped at 280');
  // Material is optional until the teacher picks one; campus can be blank (church-wide).
  const bare = await api('staff', 'POST', '/studies', { teacher_ids: [P.teacher3], student_ids: [P.s3], campus_id: null });
  assert.equal(bare.status, 201);
  S.south = bare.data.id;
  assert.equal(db.prepare('SELECT campus_id, material_id FROM studies WHERE id = ?').get(S.south).campus_id, null);
  // A campus-limited coordinator can't use a person at a campus they don't cover.
  assert.equal((await api('northcoord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.s3] })).status, 403);
  assert.equal((await api('northstaff', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.s3] })).status, 403);
  // A study at the south campus, made by south staff.
  const sc = await api('southstaff', 'POST', '/studies', { material_id: M.john, teacher_ids: [P.teacher3], student_ids: [P.s3], rhythm: 'Sundays after church' });
  assert.equal(sc.status, 201);
  S.southCampus = sc.data.id;
  assert.equal(db.prepare('SELECT campus_id FROM studies WHERE id = ?').get(S.southCampus).campus_id, 2);
  assert.ok(audits('study.create').length >= 3);
});

test('who sees which studies: coordinators and staff by campus; a study with no campus is open to all of them', async () => {
  const ids = async (who) => (await api(who, 'GET', '/studies')).data.map((s) => s.id).sort();
  const all = [S.main, S.south, S.southCampus].sort();
  assert.deepEqual(await ids('coord'), all);
  assert.deepEqual(await ids('admin'), all);
  assert.deepEqual(await ids('staff'), all);
  assert.deepEqual(await ids('northstaff'), [S.main, S.south].sort(), 'north staff: their campus and the church-wide one');
  assert.deepEqual(await ids('southstaff'), [S.south, S.southCampus].sort());
  assert.deepEqual(await ids('northcoord'), [S.main, S.south].sort());
  assert.equal((await api('northstaff', 'GET', `/studies/${S.southCampus}`)).status, 403);
  assert.equal((await api('northstaff', 'PATCH', `/studies/${S.southCampus}`, { rhythm: 'x' })).status, 403);
  assert.equal((await api('coord', 'GET', '/studies/99999')).status, 404);
  // Filters.
  assert.deepEqual((await api('coord', 'GET', '/studies?campus=2')).data.map((s) => s.id), [S.southCampus]);
  assert.deepEqual((await api('coord', 'GET', '/studies?campus=none')).data.map((s) => s.id), [S.south]);
  assert.deepEqual((await api('coord', 'GET', `/studies?material=${M.john}`)).data.map((s) => s.id), [S.southCampus]);
  assert.deepEqual((await api('coord', 'GET', `/studies?teacher=${P.teacher}`)).data.map((s) => s.id), [S.main]);
  assert.equal((await api('coord', 'GET', '/studies?status=paused')).data.length, 0);
  // The list carries names, never contact details.
  const row = (await api('coord', 'GET', '/studies')).data.find((s) => s.id === S.main);
  assert.equal(row.students.length, 2);
  assert.equal(row.students[0].phone, undefined);
  assert.equal(row.coordinator_note, 'Prefers mornings');
});

test('a teacher with an account updates only their own study; they never see the coordinator note', async () => {
  const own = await api('teacher', 'POST', `/studies/${S.main}/progress`, { lesson: 3, sessions: 5, planned_lessons: 8, status: 'paused', rhythm: 'Thursdays' });
  assert.equal(own.status, 200);
  let st = db.prepare('SELECT * FROM studies WHERE id = ?').get(S.main);
  assert.deepEqual([st.lesson, st.sessions, st.planned_lessons, st.status, st.rhythm], [3, 5, 8, 'paused', 'Thursdays']);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/progress`, { status: 'active' })).status, 200);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/progress`, { status: 'finished', finished_on: 'soon' })).status, 400);
  // Not theirs, and not allowed for a student, a leader or a volunteer.
  assert.equal((await api('teacher', 'POST', `/studies/${S.southCampus}/progress`, { lesson: 2 })).status, 403);
  assert.equal((await api('teacher3', 'POST', `/studies/${S.main}/progress`, { lesson: 2 })).status, 403);
  for (const who of ['student', 'leader', 'vol', 'unlinked']) assert.equal((await api(who, 'POST', `/studies/${S.main}/progress`, { lesson: 2 })).status, 403, who);
  // What a teacher can't do: change the note, the campus or the people, or open the coordinator's routes.
  assert.equal((await api('teacher', 'PATCH', `/studies/${S.main}`, { coordinator_note: 'hi' })).status, 403);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/people`, { person_id: P.other, role: 'student' })).status, 403);
  assert.equal((await api('teacher', 'DELETE', `/studies/${S.main}/people/${P.s2}`)).status, 403);
  // Their view of the study has no coordinator note; a student's phone only if they agreed.
  const view = await api('teacher', 'GET', `/studies/${S.main}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.coordinator_note, undefined);
  assert.equal(JSON.stringify(view.data).includes('Prefers mornings'), false);
  assert.equal(view.data.students.find((s) => s.id === P.s1).phone, '555-0111');
  assert.equal(view.data.students.find((s) => s.id === P.s2).phone, undefined);
  assert.equal((await api('teacher', 'GET', `/studies/${S.southCampus}`)).status, 403);
  assert.equal((await api('student', 'GET', `/studies/${S.main}`)).status, 403);
  // Staff see everything, including every contact; a coordinator below staff sees the note but only shared contacts (see the contact test at the end).
  const full = await api('staff', 'GET', `/studies/${S.main}`);
  assert.equal(full.data.coordinator_note, 'Prefers mornings');
  assert.equal(full.data.students.find((s) => s.id === P.s2).phone, '555-0122');
  assert.equal((await api('coord', 'GET', `/studies/${S.main}`)).data.coordinator_note, 'Prefers mornings');
  // The teacher may choose the material on their own study (an active one only); a coordinator can too.
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/progress`, { material_id: M.old })).status, 400);
  assert.equal((await api('teacher3', 'POST', `/studies/${S.south}/progress`, { material_id: M.found })).status, 200);
  assert.equal(db.prepare('SELECT material_id FROM studies WHERE id = ?').get(S.south).material_id, M.found);
  assert.ok(audits('study.progress').length >= 3);
  // The coordinator's own edit.
  assert.equal((await api('coord', 'PATCH', `/studies/${S.main}`, { coordinator_note: 'Prefers evenings', campus_id: 1 })).status, 200);
  assert.equal((await api('coord', 'PATCH', `/studies/${S.main}`, { coordinator_note: 'y'.repeat(280) })).status, 200);
  assert.equal((await api('coord', 'PATCH', `/studies/${S.main}`, { coordinator_note: 'y'.repeat(281) })).status, 400);
  assert.equal((await api('coord', 'PATCH', `/studies/${S.main}`, { lesson: -1 })).status, 400);
  st = db.prepare('SELECT * FROM studies WHERE id = ?').get(S.main);
  assert.equal(st.coordinator_note.length, 280);
});

test('adding and removing teachers and students: soft removal, at least one of each, finished studies', async () => {
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.other, role: 'student', share_contact: true })).status, 201);
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.other, role: 'teacher' })).status, 409, 'not both roles');
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s3, role: 'student' })).status, 201, 'a coordinator covers every campus');
  assert.equal((await api('northcoord', 'POST', `/studies/${S.main}/people`, { person_id: P.s3, role: 'student' })).status, 403, 'north only');
  const t = await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.dupa, role: 'teacher' });
  assert.deepEqual(t.data.teachers_without_account.map((x) => x.id), [P.dupa]);
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.dupa}`)).status, 200);
  const row = db.prepare('SELECT removed_at FROM study_people WHERE study_id = ? AND person_id = ?').get(S.main, P.dupa);
  assert.ok(row.removed_at, 'soft removal: the row stays');
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.dupa}`)).status, 404);
  // A study keeps at least one teacher and one student.
  assert.equal((await api('coord', 'DELETE', `/studies/${S.south}/people/${P.teacher3}`)).status, 400);
  assert.equal((await api('coord', 'DELETE', `/studies/${S.south}/people/${P.s3}`)).status, 400);
  // Taking a student out, then putting them back.
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.s3}`)).status, 200);
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s3, role: 'student' })).status, 201);
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.s3}`)).status, 200);
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.other}`)).status, 200);
  assert.ok(audits('study.people').length >= 6);
  // Archived people can't be added.
  db.prepare("UPDATE people SET archived = 1 WHERE id = ?").run(P.s4);
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s4, role: 'student' })).status, 404);
  db.prepare("UPDATE people SET archived = 0 WHERE id = ?").run(P.s4);
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s4, role: 'student' })).status, 201, 'a person with no campus is open to everyone');
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.s4}`)).status, 200);
});

test('contact consent: a teacher sees a student’s phone and email only if that student agreed; students see no other student', async () => {
  const mine = await api('teacher', 'GET', '/me/studies');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.as_teacher.length, 1);
  const kids = mine.data.as_teacher[0].students;
  const s1 = kids.find((s) => s.id === P.s1);
  const s2 = kids.find((s) => s.id === P.s2);
  assert.equal(s1.phone, '555-0111');
  assert.equal(s1.email, 's1@example.com');
  assert.equal(s2.phone, undefined);
  assert.equal(s2.email, undefined);
  assert.equal(JSON.stringify(mine.data).includes('555-0122'), false);
  assert.equal(JSON.stringify(mine.data).includes('Prefers'), false, 'no coordinator note');
  // The student sees their teachers by name and their own progress; no other student, no contact details.
  const sv = await api('student', 'GET', '/me/studies');
  assert.equal(sv.data.as_student.length, 1);
  const study = sv.data.as_student[0];
  assert.deepEqual(study.teachers.map((t) => t.name).sort(), ['Tess Test', 'Tom Test']);
  assert.equal(study.progress.lesson, 3);
  assert.equal(study.progress.planned, 8);
  const text = JSON.stringify(sv.data);
  for (const bad of ['Sue', '555-0122', '555-0101', 'teacher@', 'Prefers']) assert.equal(text.includes(bad), false, bad);
  assert.deepEqual(sv.data.as_teacher, []);
  // Changing consent: a coordinator records it (re-adding someone already in is a 409).
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s1, role: 'student', share_contact: false })).status, 409);
  assert.equal((await api('coord', 'PATCH', `/studies/${S.main}/people/${P.s1}`, { share_contact: false })).status, 200);
  const after = await api('teacher', 'GET', `/studies/${S.main}`);
  assert.equal(after.data.students.find((s) => s.id === P.s1).phone, undefined);
  await api('coord', 'PATCH', `/studies/${S.main}/people/${P.s1}`, { share_contact: true });
  // Someone not in any study gets empty lists, an unlinked account is told to ask the office.
  assert.equal((await api('vol', 'GET', '/me/studies')).status, 409);
  assert.equal((await api('unlinked', 'GET', '/me/studies')).status, 409);
  assert.equal((await api(null, 'GET', '/me/studies')).status, 401);
});

test('finishing: a teacher marks their own students; a coordinator can undo it; everything is audited', async () => {
  // Needs a material first.
  assert.equal((await api('teacher3', 'POST', `/studies/${S.south}/complete`, { person_ids: [P.s3] })).status, 200, 'material was chosen above');
  const fresh = (await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.other] })).data.id;
  assert.equal((await api('teacher', 'POST', `/studies/${fresh}/complete`, { person_ids: [P.other] })).status, 400, 'choose the material first');
  await api('teacher', 'POST', `/studies/${fresh}/progress`, { material_id: M.john });
  // Not their study / not a student / not allowed / bad date.
  assert.equal((await api('teacher', 'POST', `/studies/${S.southCampus}/complete`, { person_ids: [P.s3] })).status, 403);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.teacher2] })).status, 400, 'teachers are not students');
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s3] })).status, 400, 'a removed student is no longer a student');
  assert.equal((await api('student', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1] })).status, 403);
  assert.equal((await api('leader', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1] })).status, 403);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [] })).status, 400);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1], completed_on: '2026-06-16' })).status, 400, 'not in the future');
  await api('coord', 'PATCH', `/studies/${S.main}`, { material_id: M.found });
  const done = await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1], completed_on: '2026-06-10' });
  assert.equal(done.status, 200);
  assert.deepEqual(done.data.completed, [P.s1]);
  const c = db.prepare('SELECT * FROM study_completions WHERE person_id = ?').get(P.s1);
  assert.equal(c.material_title, 'Foundations');
  assert.equal(c.source, 'teacher');
  assert.equal(c.completed_on, '2026-06-10');
  assert.equal(c.teacher_names, 'Tess Test, Tom Test');
  assert.deepEqual(JSON.parse(c.teacher_ids).sort(), [P.teacher, P.teacher2].sort());
  // Marking again does nothing twice.
  const again = await api('teacher', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1] });
  assert.deepEqual([again.data.completed, again.data.already], [[], [P.s1]]);
  // The student sees it in their own list; a teacher cannot undo; a coordinator can, softly.
  assert.equal((await api('student', 'GET', '/me/studies')).data.completed.length, 1);
  assert.equal((await api('teacher', 'POST', `/study-completions/${c.id}/revoke`)).status, 403);
  assert.equal((await api('student', 'POST', `/study-completions/${c.id}/revoke`)).status, 403);
  assert.equal((await api('northstaff', 'POST', `/study-completions/${c.id}/revoke`)).status, 200, 'staff at the person’s campus');
  assert.equal((await api('coord', 'POST', `/study-completions/${c.id}/revoke`)).status, 409, 'already undone');
  const row = db.prepare('SELECT revoked_at, revoked_by FROM study_completions WHERE id = ?').get(c.id);
  assert.ok(row.revoked_at);
  assert.equal(row.revoked_by, U.northstaff);
  assert.equal((await api('student', 'GET', '/me/studies')).data.completed.length, 0, 'an undone finish is not shown');
  const rev = audits('study.completion_revoke');
  assert.equal(rev.length, 1);
  assert.equal(JSON.parse(rev[0].detail).person_id, P.s1);
  // The unique rule only holds for live rows, so they can be marked finished again.
  const redo = await api('coord', 'POST', `/studies/${S.main}/complete`, { person_ids: [P.s1], completed_on: '2026-06-12' });
  assert.deepEqual(redo.data.completed, [P.s1]);
  assert.equal(db.prepare('SELECT source FROM study_completions WHERE person_id = ? AND revoked_at IS NULL').get(P.s1).source, 'coordinator');
  assert.ok(audits('study.complete').length >= 3);
  S.fresh = fresh;
});

test('completions outlive a removed study, a finished study and a removed student', async () => {
  // Removed student, finished study.
  assert.equal((await api('coord', 'DELETE', `/studies/${S.main}/people/${P.s1}`)).status, 200);
  assert.equal((await api('teacher', 'POST', `/studies/${S.main}/progress`, { status: 'finished' })).status, 200);
  const st = db.prepare('SELECT status, finished_on FROM studies WHERE id = ?').get(S.main);
  assert.deepEqual([st.status, st.finished_on], ['finished', TODAY]);
  assert.equal((await api('coord', 'POST', `/studies/${S.main}/people`, { person_id: P.s4, role: 'student' })).status, 400, 'a finished study is closed');
  let card = await api('coord', 'GET', `/people/${P.s1}/studies`);
  assert.equal(card.data.completed.length, 1);
  assert.equal(card.data.completed[0].material_title, 'Foundations');
  // The study itself is removed (even if the app never does this, the data must hold): the history stays.
  db.exec('PRAGMA foreign_keys = ON');
  const tmp = Number(db.prepare("INSERT INTO studies (material_id, started_on) VALUES (?, '2026-01-01')").run(M.john).lastInsertRowid);
  db.prepare("INSERT INTO study_completions (person_id, material_id, study_id, material_title, completed_on) VALUES (?, ?, ?, 'The Gospel of John', '2026-02-02')").run(P.other, M.john, tmp);
  db.prepare('DELETE FROM studies WHERE id = ?').run(tmp);
  const kept = db.prepare('SELECT study_id, material_title FROM study_completions WHERE person_id = ? AND material_id = ?').get(P.other, M.john);
  assert.equal(kept.study_id, null);
  assert.equal(kept.material_title, 'The Gospel of John');
  // A material that has finished studies can't be removed from the database either.
  assert.throws(() => db.prepare('DELETE FROM study_materials WHERE id = ?').run(M.found));
  // The admin-only delete refuses a study with a finished student, and works for a mistake.
  assert.equal((await api('admin', 'DELETE', `/studies/${S.main}`)).status, 409);
  assert.equal((await api('staff', 'DELETE', `/studies/${S.fresh}`)).status, 403, 'admin only');
  assert.equal((await api('admin', 'DELETE', `/studies/${S.fresh}`)).status, 200);
  assert.equal(audits('study.delete').length, 1);
  // Revoked completions stay too.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM study_completions WHERE person_id = ?').get(P.s1).n, 2);
});

test('the person card: coordinators and staff, the person themself; nobody else', async () => {
  for (const who of ['coord', 'staff', 'admin']) assert.equal((await api(who, 'GET', `/people/${P.teacher}/studies`)).status, 200, who);
  for (const who of ['leader', 'vol', 'student', 'unlinked']) assert.equal((await api(who, 'GET', `/people/${P.teacher}/studies`)).status, 403, who);
  assert.equal((await api('student', 'GET', `/people/${P.s1}/studies`)).status, 200, 'their own');
  assert.equal((await api('northstaff', 'GET', `/people/${P.s3}/studies`)).status, 403, 'another campus');
  assert.equal((await api('coord', 'GET', '/people/99999/studies')).status, 404);
  const t = await api('coord', 'GET', `/people/${P.teacher}/studies`);
  assert.ok(t.data.taught.some((x) => x.study_id === S.main && x.material_title === 'Foundations'));
  assert.equal(t.data.can_edit, true);
  const s = await api('student', 'GET', `/people/${P.s1}/studies`);
  assert.equal(s.data.can_edit, false);
  assert.equal(s.data.completed[0].can_revoke, false);
  // The studies one person is in right now (not the finished one).
  const now = (await api('coord', 'POST', '/studies', { material_id: M.john, teacher_ids: [P.teacher], student_ids: [P.s2] })).data.id;
  const o = await api('coord', 'GET', `/people/${P.s2}/studies`);
  assert.deepEqual(o.data.studying.map((x) => [x.study_id, x.status, x.material_title]), [[now, 'active', 'The Gospel of John']]);
  await api('admin', 'DELETE', `/studies/${now}`);
});

test('adding a completed study to a profile, with a typed or a People teacher', async () => {
  const body = { person_id: P.s2, material_id: M.old, completed_on: '2024-05-05', teacher_ids: [P.teacher], teacher_name: 'Pastor Joe (visiting)' };
  const r1 = await api('coord', 'POST', '/study-completions', body);
  assert.equal(r1.status, 201, 'a retired material is fine for history');
  assert.equal((await api('coord', 'POST', '/study-completions', body)).status, 409, 'not twice');
  const row = db.prepare('SELECT * FROM study_completions WHERE id = ?').get(r1.data.id);
  assert.equal(row.source, 'profile');
  assert.equal(row.teacher_names, 'Tess Test, Pastor Joe (visiting)');
  assert.equal((await api('coord', 'POST', '/study-completions', { ...body, completed_on: '2999-01-01' })).status, 400);
  assert.equal((await api('coord', 'POST', '/study-completions', { ...body, completed_on: 'last year' })).status, 400);
  assert.equal((await api('northstaff', 'POST', '/study-completions', { person_id: P.s3, material_id: M.found, completed_on: '2024-01-01' })).status, 403, 'another campus');
  assert.ok(audits('study.completion_add').length >= 1);
  // It shows on the person's card, and on the teacher's "studies taught".
  const card = await api('coord', 'GET', `/people/${P.s2}/studies`);
  assert.ok(card.data.completed.some((c) => c.material_title === 'Old Workbook' && c.teacher_names.includes('Pastor Joe')));
  const t = await api('coord', 'GET', `/people/${P.teacher}/studies`);
  assert.ok(t.data.taught.some((x) => x.study_id === null && x.material_title === 'Old Workbook' && x.student_name === 'Sue Test'));
});

test('the request queue: a request is the signed-in person’s own, once, and every coordinator hears without a name', async () => {
  // Needs a linked account.
  assert.equal((await api('unlinked', 'POST', '/me/study-request', { format: 'one_on_one' })).status, 409);
  assert.equal((await api(null, 'POST', '/me/study-request', { format: 'one_on_one' })).status, 401);
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'sideways' })).status, 400);
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'one_on_one', material_id: M.old })).status, 400, 'a retired material');
  const before = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
  outbox.length = 0;
  const res = await api('student3', 'POST', '/me/study-request', { format: 'small_group', material_id: M.john, topic: 'Prayer', times: 'Weekday evenings', share_contact: true, person_id: P.other });
  assert.equal(res.status, 201);
  const q = db.prepare('SELECT * FROM study_requests').get();
  assert.equal(q.person_id, P.s3, 'always their own record, never a typed one');
  assert.deepEqual([q.format, q.material_id, q.topic, q.times, q.share_contact, q.status, q.campus_id], ['small_group', M.john, 'Prayer', 'Weekday evenings', 1, 'waiting', 2]);
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 409, 'one waiting request at a time');
  // Every coordinator is told (not leaders, volunteers or the person); no name anywhere in the notice or email.
  const notes = db.prepare("SELECT user_id, title, body, url FROM notifications WHERE kind = 'study'").all();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n - before, notes.length);
  const extra = db.prepare("SELECT id FROM users WHERE email = 'new-coord@mb.org'").get().id; // made in the switch test
  assert.deepEqual(notes.map((n) => n.user_id).sort(), [U.coord, U.coord2, extra].sort(), 'every coordinator who covers this campus (the north-only one is not told about a south request)');
  for (const n of notes) {
    const text = `${n.title} ${n.body} ${n.url}`;
    for (const name of ['Stu', 'Test', 'Prayer', 'student3']) assert.equal(text.includes(name), false, name);
  }
  const mail = outbox.filter((m) => m.subject === 'A new Bible study request');
  assert.deepEqual(mail.map((m) => m.to).sort(), ['coord2@mb.org', 'coord@mb.org', 'new-coord@mb.org']);
  for (const m of mail) for (const name of ['Stu', 'Test', 'Prayer']) assert.equal(`${m.subject} ${m.text}`.includes(name), false, name);
  assert.deepEqual(audits('study.request').map((a) => Object.keys(JSON.parse(a.detail))), [['id']], 'the log has no names');
  // Who sees the queue: coordinators and staff by campus.
  const queue = await api('coord', 'GET', '/studies/requests');
  assert.equal(queue.data.requests.length, 1);
  assert.equal(queue.data.requests[0].name, 'Stu Test');
  assert.equal((await api('northstaff', 'GET', '/studies/requests')).data.requests.length, 0, 'north staff do not see a south request');
  assert.equal((await api('southstaff', 'GET', '/studies/requests')).data.requests.length, 1);
  assert.equal((await api('leader', 'GET', '/studies/requests')).status, 403);
  // The person sees their own waiting request, and the active materials, in the app.
  const me = await api('student3', 'GET', '/me/studies');
  assert.equal(me.data.request.topic, 'Prayer');
  assert.ok(me.data.materials.some((m) => m.id === M.john));
  assert.equal(me.data.materials.some((m) => m.id === M.old), false);
  S.request = q.id;
});

test('matching a request: into a new study or an existing one; closing needs a reason from the list', async () => {
  const id = S.request;
  assert.equal((await api('leader', 'POST', `/studies/requests/${id}/match`, { study_id: S.southCampus })).status, 403);
  assert.equal((await api('northstaff', 'POST', `/studies/requests/${id}/match`, { study_id: S.south })).status, 403, 'another campus’s request');
  assert.equal((await api('coord', 'POST', `/studies/requests/${id}/close`, { reason: 'because I said so' })).status, 400);
  assert.equal((await api('coord', 'POST', `/studies/requests/${id}/close`, {})).status, 400);
  // Into a new study: teacher chosen, the requester becomes the student with their contact tick.
  const m = await api('coord', 'POST', `/studies/requests/${id}/match`, { teacher_ids: [P.teacher2], material_id: M.john, rhythm: 'Sundays' });
  assert.equal(m.status, 200);
  const sp = db.prepare("SELECT * FROM study_people WHERE study_id = ? AND role = 'student'").get(m.data.study_id);
  assert.deepEqual([sp.person_id, sp.share_contact], [P.s3, 1]);
  assert.equal(db.prepare('SELECT request_id FROM studies WHERE id = ?').get(m.data.study_id).request_id, id);
  const q = db.prepare('SELECT * FROM study_requests WHERE id = ?').get(id);
  assert.deepEqual([q.status, q.study_id, q.handled_by], ['matched', m.data.study_id, U.coord]);
  assert.deepEqual(m.data.teachers_without_account.map((t) => t.id), [P.teacher2], 'invite prompt for a teacher with no account');
  assert.equal((await api('coord', 'POST', `/studies/requests/${id}/match`, { study_id: S.south })).status, 409, 'already handled');
  assert.equal((await api('coord', 'POST', `/studies/requests/${id}/close`, { reason: 'duplicate' })).status, 409);
  assert.equal((await api('coord', 'GET', '/studies/requests')).data.requests.length, 0);
  assert.equal((await api('coord', 'GET', '/studies/requests?status=matched')).data.requests.length, 1);
  // A new request: add to an existing study, and the other path, close.
  await api('student3', 'POST', '/me/study-request', { format: 'either' });
  const q2 = db.prepare("SELECT id FROM study_requests WHERE status = 'waiting'").get().id;
  assert.equal((await api('coord', 'POST', `/studies/requests/${q2}/match`, { study_id: S.south })).status, 400, 'already a student there');
  assert.equal((await api('coord', 'POST', `/studies/requests/${q2}/match`, { study_id: S.southCampus })).status, 400, 'already a student there');
  assert.equal((await api('coord', 'POST', `/studies/requests/${q2}/close`, { reason: 'found_another_way' })).status, 200);
  assert.equal(db.prepare('SELECT close_reason FROM study_requests WHERE id = ?').get(q2).close_reason, 'found_another_way');
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 201, 'closed, so they may ask again');
  const q3 = db.prepare("SELECT id FROM study_requests WHERE status = 'waiting'").get().id;
  const into = await api('staff', 'POST', `/studies/requests/${q3}/match`, { study_id: S.main });
  assert.equal(into.status, 400, 'a finished study is closed');
  assert.equal(audits('study.request_match').length, 1);
  assert.equal(audits('study.request_close').length, 1);
  // With no coordinator, admins are told so a request is never lost.
  db.prepare('UPDATE users SET studies = 0 WHERE studies = 1').run();
  db.prepare("UPDATE study_requests SET status = 'closed'").run();
  const adminBefore = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = ?').get(U.admin, 'study').n;
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = ?').get(U.admin, 'study').n - adminBefore, 1);
  db.prepare("UPDATE users SET studies = 1 WHERE email IN ('coord@mb.org', 'coord2@mb.org', 'northcoord@mb.org', 'new-coord@mb.org')").run();
  db.prepare("UPDATE study_requests SET status = 'closed'").run();
});

test('a request is rate limited per account', async () => {
  const limited = U.student;
  db.prepare("UPDATE study_requests SET status = 'closed'").run();
  for (let i = 0; i < 5; i++) db.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?, 'study.request', '{}')").run(limited);
  assert.equal((await api('student', 'POST', '/me/study-request', { format: 'either' })).status, 429);
});

test('the overview: counts, teachers and the CSV download, on the fixed clock', async () => {
  const s = (await api('coord', 'GET', '/studies/summary')).data;
  // main: finished today (this year); south and southCampus: active; the request study: active.
  assert.equal(s.finished_this_year, 1);
  assert.equal(s.active, 3);
  assert.equal(s.paused, 0);
  assert.equal(s.waiting, 0);
  assert.equal(s.year, '2026');
  assert.ok(s.completions_this_year >= 2);
  await api('coord', 'PATCH', `/studies/${S.south}`, { status: 'paused' });
  assert.equal((await api('coord', 'GET', '/studies/summary')).data.paused, 1);
  // A study finished last year doesn't count this year.
  db.prepare("UPDATE studies SET status = 'finished', finished_on = '2025-12-31' WHERE id = ?").run(S.southCampus);
  assert.equal((await api('coord', 'GET', '/studies/summary')).data.finished_this_year, 1);
  assert.equal((await api('northstaff', 'GET', '/studies/summary')).data.finished_this_year, 1);
  assert.equal((await api('southstaff', 'GET', '/studies/summary')).data.finished_this_year, 0, 'south staff do not see the north study');
  const teachers = (await api('coord', 'GET', '/studies/teachers')).data;
  const tess = teachers.find((t) => t.id === P.teacher);
  assert.deepEqual([tess.has_account, tess.taught >= 1], [true, true]);
  assert.equal(teachers.find((t) => t.id === P.teacher2).has_account, false);
  // Materials: completions per material, for a chosen year.
  const mats = (await api('coord', 'GET', '/studies/materials?year=2026')).data;
  const found = mats.materials.find((m) => m.id === M.found);
  assert.equal(found.completions_year, 2, 'two live completions this year for Foundations (Sam’s second, Stu’s); the undone one is not counted');
  assert.equal((await api('coord', 'GET', '/studies/materials?year=2024')).data.materials.find((m) => m.id === M.old).completions_year, 1);
  // CSV: names only (no phone or email), formula-safe, and counted in the log.
  const csv = await api('staff', 'GET', '/studies/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.data.startsWith('id,material,status,teachers,students,campus'));
  assert.ok(csv.data.includes('Tess Test; Tom Test'));
  assert.equal(csv.data.includes('555-'), false);
  assert.equal(csv.data.includes('@example.com'), false);
  assert.equal(audits('study.export').length, 1);
  assert.equal((await api('northstaff', 'GET', '/studies/export.csv')).data.includes('Meadowbrook South'), false);
});

test('CSV import of past completions: admins only, a preview first, id or exact unique email, no people created', async () => {
  const csv = [
    'person_id,email,material,completed_on,teacher',
    `${P.s2},,Foundations,2023-03-03,Pastor Joe`,
    `,s1@example.com,The Gospel of John,2022-02-02,`,
    ',shared@example.com,Foundations,2021-01-01,',       // two people share it: not matched
    ',nobody@example.com,Foundations,2021-01-01,',      // no such person
    `${P.other},,Brand New Workbook,2020-05-05,`,         // unknown material
    `${P.other},,Foundations,2999-01-01,`,                // future date
    `${P.other},,Foundations,someday,`,
    `${P.s2},,Foundations,2023-03-03,Pastor Joe`,         // same row twice in the file
    `${P.s2},,Old Workbook,2024-05-05,`,                  // already on file (added on the profile)
    `99999,,Foundations,2020-01-01,`,
    `${P.s2},someone-else@example.com,Foundations,2020-02-02,`, // the id and the email disagree
  ].join('\n');
  for (const who of ['staff', 'coord', 'leader', 'northadmin', 'vol']) {
    assert.equal((await api(who, 'POST', '/studies/import/preview', { csv })).status, 403, `${who} preview`);
    assert.equal((await api(who, 'POST', '/studies/import', { csv })).status, 403, `${who} import`);
  }
  const people = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const completionsBefore = db.prepare('SELECT COUNT(*) n FROM study_completions').get().n;
  const prev = await api('admin', 'POST', '/studies/import/preview', { csv });
  assert.equal(prev.status, 200);
  assert.deepEqual(prev.data.counts, { ok: 2, ambiguous: 1, unmatched: 2, unknown_material: 1, bad_date: 2, duplicate: 2, mismatch: 1 });
  assert.equal(prev.data.total, 11);
  assert.equal(prev.data.rows[0].person, 'Sue Test', 'the preview names who was matched');
  assert.equal(prev.data.rows.find((x) => x.status === 'mismatch').matched, false);
  assert.deepEqual(prev.data.new_materials, ['Brand New Workbook']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM study_completions').get().n, completionsBefore, 'a preview writes nothing');
  assert.equal((await api('admin', 'POST', '/studies/import/preview', { csv: 'foo,bar\n1,2' })).status, 400);
  assert.equal((await api('admin', 'POST', '/studies/import/preview', { csv: '' })).status, 400);
  const imp = await api('admin', 'POST', '/studies/import', { csv });
  assert.deepEqual(imp.data, { imported: 2, skipped: 9, materials_created: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM people').get().n, people, 'never creates people');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, users, 'never links or creates accounts');
  const rows = db.prepare("SELECT person_id, material_title, completed_on, source, teacher_names FROM study_completions WHERE source = 'import' ORDER BY id").all();
  assert.deepEqual(rows.map((x) => [x.person_id, x.material_title, x.completed_on]), [[P.s2, 'Foundations', '2023-03-03'], [P.s1, 'The Gospel of John', '2022-02-02']]);
  assert.equal(rows[0].teacher_names, 'Pastor Joe');
  // Run it again: nothing new.
  const rerun = await api('admin', 'POST', '/studies/import', { csv });
  assert.equal(rerun.data.imported, 0);
  // The log has counts only: no emails or names.
  const a = audits('study.import');
  assert.equal(a.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(a[0].detail)).sort(), ['imported', 'materials_created', 'rows', 'skipped']);
  assert.equal(a[0].detail.includes('@'), false);
  // Unknown titles can come in as retired materials, when asked.
  const created = await api('admin', 'POST', '/studies/import', { csv: `person_id,material,completed_on\n${P.other},Brand New Workbook,2020-05-05\n${P.s2},Brand New Workbook,2020-06-06`, create_materials: true });
  assert.deepEqual(created.data, { imported: 2, skipped: 0, materials_created: 1 });
  assert.equal(db.prepare("SELECT active FROM study_materials WHERE title = 'Brand New Workbook'").get().active, 0);
});

test('merging two people moves their studies, completions and requests', async () => {
  const keep = P.s2;
  const dup = P.dupb;
  const study = (await api('coord', 'POST', '/studies', { material_id: M.john, teacher_ids: [P.dupb], student_ids: [P.other] })).data.id;
  db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_ids, completed_on, source) VALUES (?, ?, 'Foundations', ?, '2019-01-01', 'import')").run(dup, M.found, '[]');
  db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_ids, completed_on, source) VALUES (?, ?, 'Old Workbook', ?, '2018-01-01', 'profile')").run(P.other, M.old, JSON.stringify([dup]));
  const res = await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM study_people WHERE study_id = ? AND person_id = ? AND role = 'teacher'").get(study, keep).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM study_people WHERE person_id = ?').get(dup).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM study_completions WHERE person_id = ? AND completed_on = '2019-01-01'").get(keep).n, 1);
  assert.deepEqual(JSON.parse(db.prepare("SELECT teacher_ids FROM study_completions WHERE completed_on = '2018-01-01'").get().teacher_ids), [keep], 'hand-added “taught” follows the merge');
  const t = await api('coord', 'GET', `/people/${keep}/studies`);
  assert.ok(t.data.taught.length >= 2);
});

test('the session carries the coordinator flag, and the person page knows who has it', async () => {
  const acct = await api('admin', 'GET', `/people/${P.teacher}`);
  assert.equal(acct.status, 200);
  assert.equal(acct.data.account.studies, 0);
  const coord = await api('admin', 'GET', `/people/${db.prepare("SELECT person_id FROM users WHERE id = ?").get(U.student).person_id}`);
  assert.ok('studies' in coord.data.account);
});

// ---------------------------------------------------------------- security review fixes
const newPerson = (first, campus, extra = {}) => Number(db.prepare('INSERT INTO people (first_name, last_name, email, phone, campus_id, household_role) VALUES (?, ?, ?, ?, ?, ?)')
  .run(first, 'Extra', extra.email ?? '', extra.phone ?? '', campus, extra.role ?? 'adult').lastInsertRowid);
const quiet = () => {
  db.prepare("UPDATE study_requests SET status = 'closed' WHERE status = 'waiting'").run();
  db.prepare("DELETE FROM audit_log WHERE action = 'study.request'").run(); // the hourly cap is tested on its own
};

test('the name search: no photos, wildcards are literal, and it is rate limited; children can be added like anyone', async () => {
  const kid = newPerson('Kiddo', 1, { role: 'child' });
  const res = await api('coord', 'GET', '/studies/people?q=extra');
  assert.equal(res.data.some((p) => p.id === kid), true, 'anyone who can add people can add a child');
  assert.equal(res.data.some((p) => 'photo' in p), false);
  assert.deepEqual((await api('coord', 'GET', '/studies/people?q=%25%25')).data, [], 'a typed % matches nothing, not everyone');
  assert.deepEqual((await api('coord', 'GET', '/studies/people?q=_e')).data, [], 'a typed _ is not a wildcard');
  const adult = newPerson('Adult', 1);
  const body = { teacher_ids: [adult], student_ids: [kid] };
  const made = await api('coord', 'POST', '/studies', body);
  assert.equal(made.status, 201);
  await api('admin', 'DELETE', `/studies/${made.data.id}`);
  let last;
  for (let i = 0; i < 121; i++) last = await api('coord2', 'GET', '/studies/people?q=te');
  assert.equal(last.status, 429);
  assert.equal((await api('coord', 'GET', '/studies/people?q=te')).status, 200, 'the limit is per account');
});

test('contact details: staff see all; a coordinator below staff sees only shared ones or those from their own request', async () => {
  const staff = (await api('staff', 'GET', `/studies/${S.main}`)).data;
  assert.equal(staff.students.find((s) => s.id === P.s2).phone, '555-0122');
  assert.equal(staff.teachers[0].phone !== undefined, true);
  const co = (await api('coord', 'GET', `/studies/${S.main}`)).data;
  const sue = co.students.find((s) => s.id === P.s2); // did not agree
  assert.equal(sue.phone, undefined);
  assert.equal(sue.email, undefined);
  assert.equal(sue.contact_hidden, true);
  assert.ok(co.teachers.every((t) => t.phone === undefined && t.contact_hidden), 'teachers have no sharing choice: through the office');
  // Someone who agreed, and someone who asked through a request, are shown.
  await api('coord', 'PATCH', `/studies/${S.main}/people/${P.s2}`, { share_contact: true });
  assert.equal((await api('coord', 'GET', `/studies/${S.main}`)).data.students.find((s) => s.id === P.s2).phone, '555-0122');
  await api('coord', 'PATCH', `/studies/${S.main}/people/${P.s2}`, { share_contact: false });
  const viaRequest = db.prepare('SELECT study_id FROM study_requests WHERE study_id IS NOT NULL').get().study_id;
  const rq = (await api('coord', 'GET', `/studies/${viaRequest}`)).data;
  assert.equal(rq.students.find((s) => s.id === P.s3).phone, '555-0100', 'they asked for it themselves');
  assert.ok(audits('study.people').some((a) => a.detail.includes('"action":"consent"') && a.detail.includes('"share_contact":true')));
});

test('merge: the kept person comes back where the duplicate was active, and extra waiting requests close', async () => {
  const keep = newPerson('Keeper', 1);
  const dup = newPerson('Dupe', 1);
  const t = newPerson('Tutor', 1);
  const study = (await api('staff', 'POST', '/studies', { teacher_ids: [t], student_ids: [dup, P.other] })).data.id;
  db.prepare("INSERT INTO study_people (study_id, person_id, role, removed_at) VALUES (?, ?, 'teacher', datetime('now'))").run(study, keep);
  quiet();
  const a = Number(db.prepare("INSERT INTO study_requests (person_id, format) VALUES (?, 'either')").run(keep).lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO study_requests (person_id, format) VALUES (?, 'either')").run(dup).lastInsertRowid);
  assert.equal((await api('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  const row = db.prepare('SELECT role, removed_at FROM study_people WHERE study_id = ? AND person_id = ?').get(study, keep);
  assert.deepEqual([row.role, row.removed_at], ['student', null], 'back in, in the duplicate’s role');
  assert.equal(db.prepare('SELECT status FROM study_requests WHERE id = ?').get(a).status, 'waiting');
  const extra = db.prepare('SELECT status, close_reason FROM study_requests WHERE id = ?').get(b);
  assert.deepEqual([extra.status, extra.close_reason], ['closed', 'duplicate']);
  await api('admin', 'DELETE', `/studies/${study}`);
});

test('notices: with no coordinator in reach the admins who cover every campus are told; one email per 15 minutes', async () => {
  quiet();
  db.prepare("DELETE FROM audit_log WHERE action = 'study.request_email'").run();
  db.prepare('UPDATE users SET studies = 0 WHERE studies = 1').run();
  db.prepare("UPDATE users SET studies = 1 WHERE email = 'northcoord@mb.org'").run(); // north only; the request is south
  const count = (uid) => db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = 'study'").get(uid).n;
  const [adminBefore, northAdminBefore, northCoordBefore] = [count(U.admin), count(U.northadmin), count(U.northcoord)];
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 201);
  assert.equal(count(U.admin) - adminBefore, 1, 'an admin with no campus limit');
  assert.equal(count(U.northadmin) - northAdminBefore, 0, 'a campus-limited admin is not');
  assert.equal(count(U.northcoord) - northCoordBefore, 0);
  // Email: a second request within 15 minutes still gets the in-app notice, but no second email.
  db.prepare("UPDATE users SET studies = 1 WHERE email IN ('coord@mb.org', 'coord2@mb.org')").run();
  quiet();
  outbox.length = 0;
  const before = count(U.coord);
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 201);
  quiet();
  assert.equal((await api('student3', 'POST', '/me/study-request', { format: 'either' })).status, 201);
  assert.equal(count(U.coord) - before, 2, 'both in-app notices');
  assert.equal(outbox.filter((m) => m.to === 'coord@mb.org').length, 1, 'one email in 15 minutes');
  quiet();
  db.prepare("UPDATE users SET studies = 1 WHERE email IN ('new-coord@mb.org')").run();
});

test('consent: re-adding is a 409, coordinators record it, and a student can change their own', async () => {
  const sId = (await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], students: [{ person_id: P.s1, share_contact: true }], material_id: M.john })).data.id;
  assert.equal((await api('coord', 'POST', `/studies/${sId}/people`, { person_id: P.s1, role: 'student', share_contact: false })).status, 409);
  assert.equal((await api('coord', 'POST', `/studies/${sId}/people`, { person_id: P.teacher, role: 'teacher' })).status, 409);
  assert.equal((await api('coord', 'POST', `/studies/${sId}/people`, { person_id: P.other, role: 'student', share_contact: true })).status, 201);
  assert.ok(audits('study.people').some((a) => a.detail.includes(`"id":${sId}`) && a.detail.includes('"action":"add"') && a.detail.includes('"share_contact":true')));
  // The student stops sharing: the teacher no longer sees their phone.
  assert.equal((await api('teacher', 'GET', `/studies/${sId}`)).data.students.find((x) => x.id === P.s1).phone, '555-0111');
  const mine = await api('student', 'GET', '/me/studies');
  assert.equal(mine.data.as_student.find((x) => x.id === sId).share_contact, true);
  assert.equal((await api('student', 'PATCH', `/me/studies/${sId}`, { share_contact: false })).status, 200);
  assert.equal((await api('teacher', 'GET', `/studies/${sId}`)).data.students.find((x) => x.id === P.s1).phone, undefined);
  assert.equal((await api('student', 'PATCH', `/me/studies/${sId}`, { share_contact: 'yes' })).status, 400);
  const log = audits('study.people').filter((a) => a.detail.includes('"by":"student"'));
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].detail).share_contact, false);
  // Only the student, on their own study.
  for (const who of ['teacher', 'student3', 'vol', 'leader']) assert.ok([404, 409].includes((await api(who, 'PATCH', `/me/studies/${sId}`, { share_contact: true })).status), who);
  assert.equal((await api('student', 'PATCH', `/me/studies/${S.main}`, { share_contact: true })).status, 404, 'a study they are not in');
  assert.equal((await api('student', 'GET', '/me/studies')).data.as_student.find((x) => x.id === sId).share_contact, false);
  assert.equal((await api('teacher', 'PATCH', `/studies/${sId}/people/${P.s1}`, { share_contact: true })).status, 403, 'a teacher cannot record it');
  await api('student', 'PATCH', `/me/studies/${sId}`, { share_contact: true });
});

test('campus scope: studies taught, history and the year count follow the account’s campuses', async () => {
  const t = P.s4; // no campus, so every campus's staff may open their card
  const a = (await api('staff', 'POST', '/studies', { teacher_ids: [t], student_ids: [P.other], campus_id: 1, material_id: M.john })).data.id;
  const b = (await api('staff', 'POST', '/studies', { teacher_ids: [t], student_ids: [P.s3], campus_id: 2, material_id: M.john })).data.id;
  db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_ids, completed_on, source) VALUES (?, ?, 'Foundations', ?, '2026-02-02', 'profile')").run(P.s3, M.found, JSON.stringify([t]));
  const taught = async (who) => (await api(who, 'GET', `/people/${t}/studies`)).data.taught;
  const ids = (list) => list.filter((x) => x.study_id).map((x) => x.study_id);
  assert.deepEqual(ids(await taught('northstaff')).sort(), [a], 'north staff: only the north study');
  assert.deepEqual(ids(await taught('southstaff')).sort(), [b]);
  assert.deepEqual(ids(await taught('admin')).sort(), [a, b].sort());
  assert.equal((await taught('northstaff')).some((x) => x.student_name === 'Stu Test'), false, 'a south student’s hand-added history is not shown');
  assert.equal((await taught('southstaff')).some((x) => x.student_name === 'Stu Test'), true);
  // The completions count is scoped through the person's campus.
  const year = async (who) => (await api(who, 'GET', '/studies/summary')).data.completions_this_year;
  const [north, south, all] = [await year('northstaff'), await year('southstaff'), await year('admin')];
  db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, completed_on, source) VALUES (?, ?, 'Foundations', '2026-03-03', 'profile')").run(P.s3, M.found);
  assert.equal(await year('northstaff'), north, 'a south completion does not count for north staff');
  assert.equal(await year('southstaff'), south + 1);
  assert.equal(await year('admin'), all + 1);
  await api('admin', 'DELETE', `/studies/${a}`);
  await api('admin', 'DELETE', `/studies/${b}`);
});

test('finish dates are checked, and deleting a study puts its request back in the queue', async () => {
  const id = (await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.other], material_id: M.john })).data.id;
  // Not finishing: a date is ignored. Finishing with a future date: refused.
  assert.equal((await api('teacher', 'POST', `/studies/${id}/progress`, { status: 'paused', finished_on: '2020-01-01' })).status, 200);
  assert.equal(db.prepare('SELECT finished_on FROM studies WHERE id = ?').get(id).finished_on, null);
  assert.equal((await api('teacher', 'POST', `/studies/${id}/progress`, { lesson: 2, finished_on: '2020-01-01' })).status, 200);
  assert.equal(db.prepare('SELECT finished_on FROM studies WHERE id = ?').get(id).finished_on, null);
  assert.equal((await api('teacher', 'POST', `/studies/${id}/progress`, { status: 'finished', finished_on: '2026-06-16' })).status, 400);
  assert.equal((await api('teacher', 'POST', `/studies/${id}/progress`, { status: 'finished', finished_on: '2026-06-01' })).status, 200);
  assert.equal(db.prepare('SELECT finished_on FROM studies WHERE id = ?').get(id).finished_on, '2026-06-01');
  assert.equal((await api('coord', 'PATCH', `/studies/${id}`, { status: 'finished', finished_on: '2999-01-01' })).status, 400);
  // A request that became a study goes back to waiting when the study is deleted.
  quiet();
  await api('student3', 'POST', '/me/study-request', { format: 'either' });
  const q = db.prepare("SELECT id FROM study_requests WHERE status = 'waiting'").get().id;
  const made = await api('coord', 'POST', `/studies/requests/${q}/match`, { teacher_ids: [P.teacher] });
  assert.equal(db.prepare('SELECT status FROM study_requests WHERE id = ?').get(q).status, 'matched');
  assert.equal((await api('admin', 'DELETE', `/studies/${made.data.study_id}`)).status, 200);
  const back = db.prepare('SELECT status, study_id, handled_by FROM study_requests WHERE id = ?').get(q);
  assert.deepEqual([back.status, back.study_id, back.handled_by], ['waiting', null, null]);
  assert.equal((await api('coord', 'GET', '/studies/requests')).data.requests.length, 1);
  quiet();
  await api('admin', 'DELETE', `/studies/${id}`);
});

test('a study can run past its planned lessons, and says so plainly', async () => {
  const id = (await api('coord', 'POST', '/studies', { teacher_ids: [P.teacher], student_ids: [P.other], planned_lessons: 12 })).data.id;
  assert.equal((await api('teacher', 'POST', `/studies/${id}/progress`, { lesson: 13 })).status, 200, 'allowed: studies run over');
  const p = (await api('coord', 'GET', `/studies/${id}`)).data.progress;
  assert.deepEqual([p.lesson, p.planned], [13, 12]);
  assert.equal(progressText(p), 'Lesson 13 · planned 12');
  assert.equal(progressText({ lesson: 3, planned: 8 }), 'Lesson 3 of 8');
  assert.equal(progressText({ lesson: 12, planned: 12 }), 'Lesson 12 of 12');
  assert.equal(progressText({ lesson: 4, planned: null }), 'Lesson 4');
  assert.equal(progressText({ lesson: null, sessions: 6 }), '6 sessions');
  assert.equal(progressText({ lesson: null, sessions: 1 }), '1 session');
  await api('admin', 'DELETE', `/studies/${id}`);
});
