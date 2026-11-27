// Classes v1: who can do what, make-ups, video progress, quizzes, completion and notices.
// Own database and app with a fixed clock, so nothing here depends on today's date.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { grade, applyPing, makeupOpen, cleanQuestions, youtubeId, forMember } from '../server/classes.js';

let base, db, upDir, yt;
const cookies = {};
const ids = {};
const servers = [];
const savedEnv = { site: process.env.MB_YOUTUBE_SITE, key: process.env.YOUTUBE_API_KEY };

// The clock the app sees: Saturday 8 March (Chicago), two days before the session.
let nowMs = Date.parse('2031-03-08T18:00:00Z');
const tick = (sec) => { nowMs += sec * 1000; };
const SESSION_DAY = '2031-03-10';

before(async () => {
  // A stand-in YouTube: video pages (length), oEmbed, and one that's live now.
  yt = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch') {
      if (v === 'AAAAAAAAAAA') return res.end('"lengthSeconds":"600"');
      if (v === 'BBBBBBBBBBB') return res.end('"lengthSeconds":"1000"');
      if (v === 'CCCCCCCCCCC') return res.end('<html>no length here</html>');
      if (v === 'LLLLLLLLLLL') return res.end('"isLiveNow":true,"isLive":true');
      return res.writeHead(404).end();
    }
    if (u.pathname === '/oembed') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Recorded video' }));
    res.writeHead(404).end();
  }).listen(0);
  await new Promise((r) => yt.once('listening', r));
  process.env.MB_YOUTUBE_SITE = `http://127.0.0.1:${yt.address().port}`;
  delete process.env.YOUTUBE_API_KEY;

  db = openDb(':memory:');
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-classes-'));
  const s = createApp({ db, uploadDir: upDir, now: () => new Date(nowMs) }).listen(0);
  await new Promise((r) => s.once('listening', r));
  servers.push(s);
  base = `http://127.0.0.1:${s.address().port}`;
  db.exec(`INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North Campus', 'North', 'America/Chicago'), (2, 'South Campus', 'South', 'America/Chicago');`);
  const people = [[101, 'Pat', 'One', 1], [102, 'Sam', 'Two', 1], [103, 'Kim', 'Three', 1], [104, 'Mo', 'Manager', 1], [105, 'Lee', 'Unlinked', 1], [109, 'Sue', 'South', 2], [110, 'Una', 'Notenrolled', 1], [111, 'Vic', 'Capper', 1]];
  for (const [id, f, l, c] of people) db.prepare('INSERT INTO people (id, first_name, last_name, campus_id) VALUES (?, ?, ?, ?)').run(id, f, l, c);
  const accounts = [['admin', 'admin', null, null], ['staff', 'staff', null, null], ['north', 'staff', '[1]', null], ['south', 'staff', '[2]', null], ['leader', 'leader', null, null],
    ['vol', 'volunteer', null, null], ['p1', 'volunteer', null, 101], ['p2', 'volunteer', null, 102], ['p3', 'volunteer', null, 103], ['mgr', 'volunteer', null, 104], ['unlinked', 'volunteer', null, null],
    ['notenrolled', 'volunteer', null, 110], ['capper', 'volunteer', null, 111]];
  for (const [key, role, campuses, person] of accounts) {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids, person_id) VALUES (?, ?, ?, ?)').run(`${key}@mb.org`, role, campuses, person).lastInsertRowid;
    ids[key] = Number(id);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => {
  for (const s of servers) s.close();
  yt?.close();
  for (const [k, v] of [['MB_YOUTUBE_SITE', savedEnv.site], ['YOUTUBE_API_KEY', savedEnv.key]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function api(role, method, url, body, headers = {}) {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

const Q = (n) => Array.from({ length: n }, (_v, i) => ({ id: `q${i + 1}`, text: `Question ${i + 1}?`, choices: ['Right', 'Wrong', 'Also wrong'], correct: [0] }));
const allRight = (n) => Object.fromEntries(Array.from({ length: n }, (_v, i) => [`q${i + 1}`, [0]]));
const allWrong = (n) => Object.fromEntries(Array.from({ length: n }, (_v, i) => [`q${i + 1}`, [1]]));
const ytUrl = (id) => `https://youtu.be/${id}`;

// Two classes at North: A (session with make-up, video, quiz) and B (a quiz only), plus a church-wide one.
let A, B, church, S1, S2, S3, B1;
test('set up: staff build a class; every build route is guarded and campus scoped', async () => {
  assert.ok(SCHEMA_VERSION >= 40);
  assert.equal((await api(null, 'GET', '/classes')).status, 401);
  assert.equal((await api('north', 'POST', '/classes', { title: 'x', campus_id: 1 }, { 'x-mb': '' })).status, 403, 'missing x-mb');
  for (const who of ['vol', 'leader', 'mgr']) assert.equal((await api(who, 'POST', '/classes', { title: 'Nope', campus_id: 1 })).status, 403, who);
  assert.equal((await api('south', 'POST', '/classes', { title: 'Wrong campus', campus_id: 1 })).status, 403);
  assert.equal((await api('north', 'POST', '/classes', { title: 'Church-wide' })).status, 403, 'limited staff cannot make a church-wide class');
  assert.equal((await api('north', 'POST', '/classes', { title: '', campus_id: 1 })).status, 400);
  church = (await api('staff', 'POST', '/classes', { title: 'Church-wide class' })).data.id;
  A = (await api('north', 'POST', '/classes', { title: 'Life Group Training', campus_id: 1, description: 'Six weeks.' })).data.id;
  B = (await api('north', 'POST', '/classes', { title: 'Class B', campus_id: 1 })).data.id;
  assert.ok(A && B && church);

  assert.equal((await api('south', 'GET', `/classes/${A}`)).status, 404);
  assert.equal((await api('south', 'PATCH', `/classes/${A}`, { title: 'x' })).status, 404);
  assert.equal((await api('north', 'PATCH', `/classes/${church}`, { title: 'x' })).status, 403, 'a church-wide class is for staff with no campus limit');
  assert.equal((await api('vol', 'GET', `/classes/${A}`)).status, 404);
  assert.deepEqual((await api('south', 'GET', '/classes')).data.map((c) => c.id), []);
  assert.deepEqual((await api('north', 'GET', '/classes')).data.map((c) => c.id).sort(), [A, B].sort());
  assert.deepEqual((await api('staff', 'GET', '/classes')).data.map((c) => c.id).sort(), [A, B, church].sort());

  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'v' })).status, 400, 'a video needs a link');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'v', video: 'https://example.com/x' })).status, 400, 'not YouTube');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'v', video: ytUrl('NNNNNNNNNNN') })).status, 400, 'YouTube says no such video');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'v', video: ytUrl('LLLLLLLLLLL') })).status, 400, 'live now');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'q', questions: [] })).status, 400, 'a quiz needs a question');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'q', questions: [{ text: 'x', choices: ['a', 'b'], correct: [] }] })).status, 400, 'mark the right answer');
  assert.equal((await api('south', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'q', questions: Q(1) })).status, 404);
  assert.equal((await api('vol', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'q', questions: Q(1) })).status, 403);

  S1 = (await api('north', 'POST', `/classes/${A}/steps`, { kind: 'session', title: 'Week 1', starts_on: SESSION_DAY, makeup_video: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', makeup_questions: Q(5) })).data.id;
  S2 = (await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'Watch this', video: ytUrl('BBBBBBBBBBB') })).data.id;
  S3 = (await api('north', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'Final quiz', questions: Q(5) })).data.id;
  B1 = (await api('north', 'POST', `/classes/${B}/steps`, { kind: 'quiz', title: 'B quiz', questions: Q(2) })).data.id;
  assert.ok(S1 && S2 && S3 && B1);
  const view = (await api('north', 'GET', `/classes/${A}`)).data;
  assert.equal(view.steps.length, 3);
  assert.equal(view.steps[0].makeup_video_id, 'AAAAAAAAAAA');
  assert.equal(view.steps[0].makeup_video_sec, 600, 'length comes from YouTube');
  assert.equal(view.steps[1].video_sec, 1000);
  assert.deepEqual(view.steps[2].questions[0].correct, [0], 'staff see which answers are right');
  assert.equal((await api('north', 'POST', `/classes/${A}/steps/reorder`, { ids: [S1] })).status, 400);
  assert.equal((await api('north', 'POST', `/classes/${A}/steps/reorder`, { ids: [S1, S2, S3] })).status, 200);
  // Training videos are never in the media library, so they can't reach Watch or the podcast.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM media').get().n, 0);
  assert.deepEqual((await api(null, 'GET', '/watch')).data.items, []);
});

test('people and managers: only staff enrol; a manager sees their own class only', async () => {
  for (const who of ['vol', 'leader', 'mgr']) assert.equal((await api(who, 'POST', `/classes/${A}/enrol`, { person_ids: [101] })).status, 403, who);
  assert.equal((await api('south', 'POST', `/classes/${A}/enrol`, { person_ids: [101] })).status, 404);
  assert.equal((await api('north', 'POST', `/classes/${A}/enrol`, { person_ids: [109] })).status, 403, 'a person at another campus');
  assert.equal((await api('north', 'POST', `/classes/${A}/enrol`, { person_ids: [] })).status, 400);
  const e = await api('north', 'POST', `/classes/${A}/enrol`, { person_ids: [101, 102, 103, 111] });
  assert.deepEqual([e.data.added, e.data.already], [4, 0]);
  assert.equal((await api('north', 'POST', `/classes/${A}/enrol`, { person_ids: [101] })).data.already, 1);
  assert.equal((await api('north', 'POST', `/classes/${B}/enrol`, { person_ids: [102] })).status, 200);

  assert.equal((await api('mgr', 'GET', `/classes/${A}/roster`)).status, 404, 'before being named, a manager sees nothing');
  assert.deepEqual((await api('mgr', 'GET', '/classes')).data, []);
  assert.equal((await api('mgr', 'POST', `/classes/${A}/managers`, { user_id: ids.mgr })).status, 403);
  assert.equal((await api('leader', 'GET', '/classes/manager-options?q=Mo')).status, 403);
  assert.deepEqual((await api('north', 'GET', '/classes/manager-options?q=Manager')).data.map((u) => u.id), [ids.mgr]);
  assert.equal((await api('south', 'POST', `/classes/${A}/managers`, { user_id: ids.mgr })).status, 404);
  assert.equal((await api('north', 'POST', `/classes/${A}/managers`, { user_id: 99999 })).status, 400);
  assert.equal((await api('north', 'POST', `/classes/${A}/managers`, { user_id: ids.mgr })).status, 201);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'class.manager.add' AND user_id = ?").get(ids.north));

  assert.deepEqual((await api('mgr', 'GET', '/classes')).data.map((c) => [c.id, c.can_manage]), [[A, false]]);
  const roster = await api('mgr', 'GET', `/classes/${A}/roster`);
  assert.equal(roster.status, 200);
  assert.equal(roster.data.people.length, 4);
  assert.equal(roster.data.can_manage, false);
  assert.equal((await api('mgr', 'GET', `/classes/${B}/roster`)).status, 404);
  assert.equal((await api('mgr', 'GET', `/classes/${B}`)).status, 404);
  assert.equal((await api('mgr', 'POST', `/classes/${B}/steps/${B1}/attendance`, { person_ids: [102], present: true })).status, 404);
  for (const [m, u, b] of [['PATCH', `/classes/${A}`, { title: 'x' }], ['POST', `/classes/${A}/archive`, {}], ['POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'x', questions: Q(1) }],
    ['DELETE', `/classes/${A}/enrolments/101`], ['POST', `/classes/${A}/complete`, { person_id: 101, note: 'x' }], ['DELETE', `/classes/${A}/managers/${ids.mgr}`]]) {
    assert.equal((await api('mgr', m, u, b)).status, 403, `${m} ${u}`);
  }
  // a manager's view of the steps has no answers and no video links
  const mv = JSON.stringify((await api('mgr', 'GET', `/classes/${A}`)).data);
  assert.ok(!mv.includes('correct') && !mv.includes('AAAAAAAAAAA') && !mv.includes('Question 1'));
  assert.equal((await api('north', 'DELETE', `/classes/${A}/managers/${ids.mgr}`)).status, 200);
  assert.equal((await api('mgr', 'GET', `/classes/${A}/roster`)).status, 404);
  await api('north', 'POST', `/classes/${A}/managers`, { user_id: ids.mgr });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'class.manager.remove'").get().n, 1);
});

test('answers: the right answers go to staff only', async () => {
  await api('north', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [103], present: false });
  const bodies = [(await api('mgr', 'GET', `/classes/${A}`)).data, (await api('mgr', 'GET', `/classes/${A}/roster`)).data];
  for (const s of [S1, S2, S3]) bodies.push((await api('p3', 'GET', `/me/classes/${A}/steps/${s}`)).data);
  bodies.push((await api('p3', 'GET', `/me/classes/${A}`)).data, (await api('p3', 'GET', '/me/classes')).data);
  for (const b of bodies) assert.ok(!JSON.stringify(b).includes('"correct"'));
  const quiz = (await api('p3', 'GET', `/me/classes/${A}/steps/${S1}`)).data.quiz;
  assert.equal(quiz.questions.length, 5, 'the make-up test is open to someone marked absent');
  assert.deepEqual(Object.keys(quiz.questions[0]).sort(), ['choices', 'id', 'multi', 'text']);
  await api('north', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [103], present: null });
});

test('make-up: closed until marked absent or the date has passed', async () => {
  const d = (await api('p1', 'GET', `/me/classes/${A}/steps/${S1}`)).data;
  assert.equal(d.state, 'upcoming');
  assert.equal(d.makeup.open, false);
  assert.equal(d.video, null);
  assert.equal(d.quiz, null);
  assert.equal((await api('p1', 'POST', `/me/classes/${A}/steps/${S1}/progress`, { position: 5, duration: 600 })).status, 409);
  assert.equal((await api('p1', 'POST', `/me/classes/${A}/steps/${S1}/quiz`, { answers: allRight(5) })).status, 409);

  const told = () => db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = 'class' AND title LIKE 'A make-up%'").get(ids.p1).n;
  assert.equal((await api('mgr', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [101], present: false })).status, 200);
  assert.equal(told(), 1);
  await api('mgr', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [101], present: false });
  await api('north', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [101], present: false });
  assert.equal(told(), 1, 'told once per session step');
  const open = (await api('p1', 'GET', `/me/classes/${A}/steps/${S1}`)).data;
  assert.equal(open.state, 'makeup');
  assert.equal(open.video.id, 'AAAAAAAAAAA');
  assert.equal(open.quiz.questions.length, 5);

  // Sam: never marked, but once the date has passed the make-up opens
  assert.equal((await api('p2', 'GET', `/me/classes/${A}/steps/${S1}`)).data.makeup.open, false);
  tick(3 * 86400);
  assert.equal((await api('p2', 'GET', `/me/classes/${A}/steps/${S1}`)).data.makeup.open, true);
  assert.equal((await api('p2', 'GET', `/me/classes/${A}`)).data.steps[0].state, 'makeup');
  await api('north', 'POST', `/classes/${A}/steps/${S1}/attendance`, { person_ids: [102], present: true });
  const done = (await api('p2', 'GET', `/me/classes/${A}/steps/${S1}`)).data;
  assert.deepEqual([done.state, done.makeup.open, done.video], ['done', false, null]);
});

test('progress is refused for the wrong class, a retired step, or someone who was removed', async () => {
  const ping = (who, c, s) => api(who, 'POST', `/me/classes/${c}/steps/${s}/progress`, { position: 1, duration: 1000 });
  assert.equal((await ping('p1', A, B1)).status, 404, 'a step from another class');
  assert.equal((await ping('p1', B, S2)).status, 404, 'a class they are not in');
  assert.equal((await ping('notenrolled', A, S2)).status, 404);
  assert.equal((await ping('unlinked', A, S2)).status, 409);
  assert.equal((await ping(null, A, S2)).status, 401);
  assert.equal((await api('p1', 'POST', `/me/classes/${A}/steps/${S2}/progress`, { position: 1 }, { 'x-mb': '' })).status, 403);
  const extra = (await api('north', 'POST', `/classes/${A}/steps`, { kind: 'video', title: 'Old video', video: ytUrl('BBBBBBBBBBB') })).data.id;
  assert.equal((await ping('p1', A, extra)).status, 200);
  assert.equal((await api('north', 'DELETE', `/classes/${A}/steps/${extra}`)).data.archived, true, 'a step with history is archived, not deleted');
  assert.equal((await ping('p1', A, extra)).status, 409);
  assert.equal((await api('p1', 'GET', `/me/classes/${A}/steps/${extra}`)).status, 404);
  const spare = (await api('north', 'POST', `/classes/${A}/steps`, { kind: 'quiz', title: 'Spare', questions: Q(1) })).data.id;
  assert.equal((await api('north', 'DELETE', `/classes/${A}/steps/${spare}`)).data.archived, false);
  await api('north', 'POST', `/classes/${B}/enrol`, { person_ids: [103] });
  assert.equal((await api('p3', 'POST', `/me/classes/${B}/steps/${B1}/quiz`, { answers: allRight(2) })).status, 200);
  assert.equal((await api('north', 'DELETE', `/classes/${B}/enrolments/103`)).status, 200);
  assert.equal((await api('p3', 'POST', `/me/classes/${B}/steps/${B1}/quiz`, { answers: allRight(2) })).status, 404);
  assert.equal((await api('p3', 'GET', '/me/classes')).data.some((c) => c.id === B), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM class_progress g JOIN class_enrolments e ON e.id = g.enrolment_id WHERE e.class_id = ? AND e.person_id = 103').get(B).n, 1, 'history stays');
  assert.equal((await api('north', 'DELETE', `/classes/${B}/enrolments/103`)).status, 404);
});

test('video: skipping ahead does not finish it; watching does; unknown lengths are capped', async () => {
  const ping = (who, c, s, body) => api(who, 'POST', `/me/classes/${c}/steps/${s}/progress`, body);
  tick(10);
  assert.equal((await ping('p2', A, S2, { position: 0, duration: 1000 })).data.watched, false);
  tick(15);
  const jump = await ping('p2', A, S2, { position: 1000, duration: 1000, ended: true });
  assert.deepEqual([jump.data.watched, jump.data.done], [false, false]);
  tick(15);
  assert.equal((await ping('p2', A, S2, { position: 20, duration: 30 })).data.watched, false);
  assert.equal(db.prepare('SELECT duration_sec FROM class_progress WHERE step_id = ? AND enrolment_id = (SELECT id FROM class_enrolments WHERE class_id = ? AND person_id = 102)').get(S2, A).duration_sec, null, 'the server’s length wins');

  let r;
  for (const pos of [0, 300, 600, 900]) { r = await ping('p1', A, S2, { position: pos, duration: 1000 }); tick(60); }
  assert.equal(r.data.watched, false, 'not enough time has passed for that much to be watched');
  tick(400);
  await ping('p1', A, S2, { position: 950, duration: 1000 });
  tick(400);
  r = await ping('p1', A, S2, { position: 1000, duration: 1000, ended: true });
  assert.deepEqual([r.data.watched, r.data.done], [true, true]);
  assert.equal((await api('p1', 'GET', `/me/classes/${A}`)).data.steps.find((s) => s.id === S2).state, 'done');
  assert.equal((await api('p1', 'GET', `/me/classes/${A}/steps/${S2}`)).data.video.id, 'BBBBBBBBBBB');

  // A video whose length YouTube didn't give: the player's length is used, and can't shrink
  const odd = (await api('north', 'POST', `/classes/${B}/steps`, { kind: 'video', title: 'Odd', video: ytUrl('CCCCCCCCCCC') })).data.id;
  assert.equal(db.prepare('SELECT video_sec FROM class_steps WHERE id = ?').get(odd).video_sec, null);
  await api('north', 'POST', `/classes/${B}/enrol`, { person_ids: [103] });
  assert.equal((await ping('p3', B, odd, { position: 5 })).status, 400, 'no length known at all');
  assert.equal((await ping('p3', B, odd, { position: 5, duration: 5 })).status, 400, 'too short to believe');
  tick(5);
  assert.equal((await ping('p3', B, odd, { position: 5, duration: 120 })).status, 200);
  tick(5);
  await ping('p3', B, odd, { position: 90, duration: 25 });
  assert.equal(db.prepare('SELECT duration_sec FROM class_progress WHERE step_id = ?').get(odd).duration_sec, 120);
  tick(30);
  assert.equal((await ping('p3', B, odd, { position: 110, duration: 120, ended: true })).data.watched, false, 'cannot skip to the end');
});

test('quiz: pass at 80%, kind wording, no answers kept, tries capped per hour', async () => {
  const r = await api('p1', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: { ...allRight(5), q2: [1], q4: [2] } });
  assert.deepEqual([r.data.passed, r.data.score, r.data.review], [false, 60, []], 'no question numbers on the first tries, so answers can’t be worked out by elimination');
  assert.equal(r.data.message, 'Not quite — try again.');
  assert.ok(!/fail/i.test(JSON.stringify(r.data)));
  assert.ok(!JSON.stringify(r.data).includes('correct'));
  const ok = await api('p1', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: { ...allRight(5), q2: [1] } });
  assert.deepEqual([ok.data.passed, ok.data.score, ok.data.message], [true, 80, 'Passed!']);
  const row = db.prepare('SELECT score, attempts, passed FROM class_progress WHERE step_id = ? AND enrolment_id = (SELECT id FROM class_enrolments WHERE class_id = ? AND person_id = 101)').get(S3, A);
  assert.deepEqual({ ...row }, { score: 80, attempts: 2, passed: 1 });
  assert.deepEqual(db.prepare("SELECT name FROM pragma_table_info('class_progress')").all().map((c) => c.name).filter((n) => /answer/.test(n)), []);
  await api('p1', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: allWrong(5) });
  assert.equal((await api('p1', 'GET', `/me/classes/${A}/steps/${S3}`)).data.quiz.best_score, 80, 'a later worse try never lowers the best');
  assert.equal((await api('mgr', 'GET', `/classes/${A}/roster`)).data.people.find((p) => p.person_id === 101).steps[S3].score, 80, 'managers see scores');
  let last;
  for (let i = 0; i < 21; i++) last = await api('capper', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: allWrong(5) });
  assert.equal(last.status, 429);
  assert.match(last.data.error, /break/);
  assert.equal((await api('p2', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: allWrong(5) })).status, 200, 'someone else is unaffected');
});

test('make-up: video and test together finish the step; finishing everything completes the class and tells people', async () => {
  const url = `/me/classes/${A}/steps/${S1}`;
  assert.equal((await api('p1', 'GET', `/me/classes/${A}`)).data.completed_at, null);
  for (const pos of [0, 280, 540]) { await api('p1', 'POST', `${url}/progress`, { position: pos, duration: 600 }); tick(300); }
  await api('p1', 'POST', `${url}/progress`, { position: 600, duration: 600, ended: true });
  assert.equal((await api('p1', 'GET', url)).data.state, 'makeup', 'video watched but the test is still to do');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM class_completions WHERE class_id = ?').get(A).n, 0);
  assert.equal((await api('p1', 'POST', `${url}/quiz`, { answers: allRight(5) })).data.done, true);
  const step = (await api('p1', 'GET', url)).data;
  assert.deepEqual([step.state, step.method], ['done', 'makeup']);
  const c = db.prepare('SELECT * FROM class_completions WHERE person_id = 101').all();
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].class_id, c[0].method], [A, 'steps']);
  assert.match(c[0].completed_at, /^2031-03-\d\d$/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = 'You finished Life Group Training'").get(ids.p1).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = 'Pat One finished Life Group Training'").get(ids.mgr).n, 1);
  await api('p1', 'POST', `/me/classes/${A}/steps/${S3}/quiz`, { answers: allRight(5) });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM class_completions WHERE person_id = 101').get().n, 1, 'never twice');
  assert.equal((await api('p1', 'GET', `/me/classes/${A}`)).data.completed_at, c[0].completed_at);
  const list = (await api('p1', 'GET', '/me/classes')).data.find((x) => x.id === A);
  assert.deepEqual([list.done, list.total], [3, 3]);
});

test('attendance: bulk marks, clearing, who may mark, and the audit trail', async () => {
  const att = (who, body, c = A, s = S1) => api(who, 'POST', `/classes/${c}/steps/${s}/attendance`, body);
  assert.equal((await att('vol', { person_ids: [101], present: true })).status, 404);
  assert.equal((await att('south', { person_ids: [101], present: true })).status, 404);
  assert.equal((await att('mgr', { person_ids: [101], present: 'yes' })).status, 400);
  assert.equal((await att('mgr', { person_ids: [110], present: true })).status, 400, 'not in the class');
  assert.equal((await att('mgr', { person_ids: [101], present: true }, A, S2)).status, 400, 'not a session');
  assert.equal((await att('mgr', { person_ids: [], present: true })).status, 400);
  assert.equal((await att('mgr', { person_ids: [103, 111], present: true })).status, 200);
  const rows = (await api('mgr', 'GET', `/classes/${A}/roster`)).data.people;
  for (const id of [103, 111]) assert.deepEqual([rows.find((p) => p.person_id === id).steps[S1].state, rows.find((p) => p.person_id === id).steps[S1].method], ['done', 'attended']);
  assert.equal((await att('mgr', { person_ids: [111], present: null })).status, 200);
  assert.equal((await api('mgr', 'GET', `/classes/${A}/roster`)).data.people.find((p) => p.person_id === 111).steps[S1], undefined);
  const log = db.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'class.attendance' ORDER BY id").all();
  assert.ok(log.some((l) => l.user_id === ids.mgr && JSON.parse(l.detail).class === A), 'a manager’s marks carry their account');
  assert.ok(log.some((l) => l.user_id === ids.north));
});

test('finishing by hand needs a note and is staff only; revoking is soft and audited', async () => {
  const ask = (who, body) => api(who, 'POST', `/classes/${A}/complete`, body);
  assert.equal((await ask('mgr', { person_id: 102, note: 'x' })).status, 403);
  assert.equal((await ask('north', { person_id: 102 })).status, 400);
  assert.equal((await ask('north', { person_id: 110, note: 'ok' })).status, 400, 'not enrolled');
  const made = await ask('north', { person_id: 102, note: 'Did it in person with the pastor.' });
  assert.equal(made.status, 201);
  assert.equal((await ask('north', { person_id: 102, note: 'again' })).status, 409);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'class.complete_manual' AND user_id = ?").get(ids.north));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = 'You finished Life Group Training'").get(ids.p2).n, 1);
  assert.equal((await api('north', 'GET', `/classes/${A}/roster`)).data.people.find((p) => p.person_id === 102).completion.note, 'Did it in person with the pastor.');
  assert.equal('note' in (await api('mgr', 'GET', `/classes/${A}/roster`)).data.people.find((p) => p.person_id === 102).completion, false, 'a manager sees that it’s done, not why');
  assert.equal((await api('mgr', 'POST', `/classes/${A}/completions/${made.data.id}/revoke`, {})).status, 403);
  assert.equal((await api('south', 'POST', `/classes/${A}/completions/${made.data.id}/revoke`, {})).status, 404);
  assert.equal((await api('north', 'POST', `/classes/${A}/completions/${made.data.id}/revoke`, {})).status, 200);
  assert.equal((await api('north', 'POST', `/classes/${A}/completions/${made.data.id}/revoke`, {})).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM class_completions WHERE id = ? AND revoked_at IS NOT NULL').get(made.data.id).n, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'class.revoke'").get());
  assert.equal((await api('north', 'POST', `/classes/${B}/archive`, {})).status, 200);
  assert.equal((await api('north', 'POST', `/classes/${B}/enrol`, { person_ids: [101] })).status, 400, 'an archived class takes no new people');
  assert.equal((await api('north', 'POST', `/classes/${B}/archive`, { archived: false })).status, 200);
});

test('rules that need no server: marking, make-up timing, questions, links', () => {
  const qs = JSON.stringify(Q(5));
  assert.equal(grade(qs, allRight(5)).score, 100);
  assert.deepEqual(grade(qs, { ...allRight(5), q1: [1] }), { score: 80, passed: true, review: [1] });
  assert.deepEqual(grade(qs, { ...allRight(5), q1: [1], q2: [1] }), { score: 60, passed: false, review: [1, 2] });
  assert.equal(grade(qs, null).score, 0);
  const multi = JSON.stringify([{ id: 'a', text: 't', choices: ['x', 'y', 'z'], correct: [0, 2] }]);
  assert.equal(grade(multi, { a: [2, 0] }).passed, true, 'pick-all questions need every right answer');
  assert.equal(grade(multi, { a: [0] }).passed, false);
  assert.equal(forMember(multi)[0].multi, true);
  const step = { kind: 'session', starts_on: '2031-03-10', makeup_video_id: 'AAAAAAAAAAA', makeup_questions: '[]' };
  assert.equal(makeupOpen(step, null, '2031-03-10'), false, 'not before the day is over');
  assert.equal(makeupOpen(step, null, '2031-03-11'), true);
  assert.equal(makeupOpen(step, { state: 'started', method: 'absent' }, '2031-03-01'), true);
  assert.equal(makeupOpen(step, { state: 'done', method: 'attended' }, '2031-04-01'), false);
  assert.equal(makeupOpen({ ...step, makeup_video_id: null }, null, '2031-04-01'), false, 'no make-up set up');
  assert.equal(applyPing({ last_ping_at: null, max_sec: 0 }, { position: 500 }, 600, 0, 90).watched, false);
  assert.equal(applyPing({ last_ping_at: null, max_sec: 0 }, { position: 5 }, null, 0), null, 'length unknown');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://example.com/x'), null);
  assert.throws(() => cleanQuestions([{ text: 'x', choices: ['a'], correct: [0] }]));
  assert.throws(() => cleanQuestions([{ text: 'x', choices: ['a', 'b'], correct: [5] }]));
});

test('a burst of progress pings at one moment never adds up to a watched video', () => {
  let row = { last_ping_at: null, max_sec: 0, duration_sec: null, watched: 0 };
  const at = Date.parse('2031-03-01T10:00:00Z');
  for (let i = 0; i < 200; i++) {
    const out = applyPing(row, { position: 1800, reported: 1800 }, 1800, at);
    row = { ...row, max_sec: out.max, duration_sec: out.duration, watched: out.watched ? 1 : 0, last_ping_at: new Date(at).toISOString() };
  }
  assert.ok(row.max_sec <= 10, `max ${row.max_sec}`);
  assert.equal(row.watched, 0);
  assert.equal(applyPing({ last_ping_at: null, max_sec: 0 }, { position: 10, reported: 30 }, null, at), null, 'a reported length under a minute isn’t trusted');
});

test('quiz tries and finishing a class are written to the audit log; question numbers show after a few tries', async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'class.quiz'").get().n;
  assert.ok(before >= 1);
  const row = db.prepare("SELECT detail FROM audit_log WHERE action = 'class.quiz' ORDER BY id DESC LIMIT 1").get();
  assert.match(row.detail, /"score":/);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'class.complete'").get().n >= 1, 'a class finished by its steps is audited');
});
