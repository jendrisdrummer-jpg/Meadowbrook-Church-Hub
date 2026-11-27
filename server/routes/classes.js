// Classes (Life Group Training and the like): staff build a class from steps (in-person sessions
// with an optional make-up recording and test, YouTube videos, quizzes) and enrol people.
// Class managers (named per class by staff, any role) see that class's roster and mark attendance,
// and nothing else. The enrolled person does the steps from the member app.
//
// Who may do what:
//   staff/admin   create and edit classes at their campuses (church-wide classes: staff with no
//                 campus limit, as for forms), manage managers, enrol, mark attendance, mark complete
//   class manager that class's roster (states and scores) and attendance for its session steps
//   the person    their own classes, steps, make-ups and scores
// Quiz answers (`correct`) go to staff only. Video links are expected to be Unlisted on YouTube.
import { Router } from 'express';
import { requireRole, canCampus, rank } from '../auth.js';
import { tx } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str, required, isDate, audit } from '../http.js';
import { notify } from '../notify.js';
import { createLimiter } from '../ratelimit.js';
import { fetchVideo } from '../media.js';
import {
  classSettings, classToday, cleanQuestions, forMember, grade, makeupOpen, hasMakeup, partsOf, stepSatisfied, applyPing, parseList, youtubeId,
} from '../classes.js';

const KINDS = ['session', 'video', 'quiz'];
const UNLINKED = 'Your account isn’t connected to your record in the church directory yet. Please ask the office to link it.';
const nameOf = (p) => `${p.nickname || p.first_name || ''} ${p.last_name || ''}`.trim();

// Church-wide classes are run only by staff with no campus limit; a campus class by staff who can
// access that campus (the same rule as forms).
export const staffManages = (user, c) => rank(user.role) >= rank('staff') && (c.campus_id == null ? !user.campusIds : canCampus(user, c.campus_id));

export default function classRoutes(db, { now = () => new Date() } = {}) {
  const r = Router();
  const limits = createLimiter({ cap: 5000 }); // one per app, so a test or restart starts clean
  const stamp = () => now().toISOString();

  // ---------------------------------------------------------------- lookups and guards
  const loadClass = (id) => {
    const c = db.prepare('SELECT * FROM classes WHERE id = ?').get(int(id));
    if (!c) throw notFound('That class');
    return c;
  };
  const isManager = (user, classId) => Boolean(db.prepare('SELECT 1 FROM class_managers WHERE class_id = ? AND user_id = ?').get(classId, user.id));

  // Staff who run this class. Other campuses' classes aren't shown to be there at all.
  const staffClass = (req) => {
    const c = loadClass(req.params.id);
    if (!canCampus(req.user, c.campus_id)) throw notFound('That class');
    if (!staffManages(req.user, c)) throw forbidden();
    return c;
  };
  // Staff who run it, or a manager named for it. Anyone else gets "not found".
  const viewClass = (req) => {
    const c = loadClass(req.params.id);
    if (staffManages(req.user, c)) return { cls: c, staff: true };
    if (isManager(req.user, c.id)) return { cls: c, staff: false };
    throw notFound('That class');
  };
  const loadStep = (cls, stepId) => {
    const s = db.prepare('SELECT * FROM class_steps WHERE id = ? AND class_id = ?').get(int(stepId), cls.id);
    if (!s) throw notFound('That step');
    return s;
  };
  const steps = (classId, { all = false } = {}) => db.prepare(`SELECT * FROM class_steps WHERE class_id = ? ${all ? '' : 'AND archived = 0'} ORDER BY sort, id`).all(classId);

  // The caller's own place in a class (never one named in the request).
  const mine = (req) => {
    if (!req.user.personId) throw new HttpError(409, UNLINKED);
    return req.user.personId;
  };
  const myEnrolment = (req, classId) => {
    const e = db.prepare('SELECT * FROM class_enrolments WHERE class_id = ? AND person_id = ? AND removed_at IS NULL').get(classId, mine(req));
    if (!e) throw notFound('That class');
    return e;
  };

  const accountsOf = (personId) => db.prepare('SELECT id FROM users WHERE active = 1 AND person_id = ?').all(personId).map((u) => u.id);
  const managerIds = (classId) => db.prepare('SELECT m.user_id FROM class_managers m JOIN users u ON u.id = m.user_id AND u.active = 1 WHERE m.class_id = ?').all(classId).map((m) => m.user_id);

  // ---------------------------------------------------------------- progress
  const getRow = (enrolmentId, stepId) => db.prepare('SELECT * FROM class_progress WHERE enrolment_id = ? AND step_id = ?').get(enrolmentId, stepId);
  const ensureRow = (enrolmentId, stepId) => {
    db.prepare("INSERT OR IGNORE INTO class_progress (enrolment_id, step_id, state) VALUES (?, ?, 'started')").run(enrolmentId, stepId);
    return getRow(enrolmentId, stepId);
  };

  // A video or quiz step is done when its part is; a make-up when both its parts are.
  function settle(enrolmentId, step) {
    const row = getRow(enrolmentId, step.id);
    if (!row || row.state === 'done' || !stepSatisfied(step, row)) return;
    const method = step.kind === 'session' ? 'makeup' : step.kind === 'video' ? 'watched' : 'passed';
    db.prepare("UPDATE class_progress SET state = 'done', method = ?, done_at = ? WHERE enrolment_id = ? AND step_id = ?").run(method, stamp(), enrolmentId, step.id);
  }

  // The class is complete when every step still in it is done. Written once; revoking is staff's call.
  function checkComplete(enrolment, req) {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(enrolment.class_id);
    const list = steps(cls.id);
    if (!list.length) return false;
    const done = db.prepare("SELECT step_id FROM class_progress WHERE enrolment_id = ? AND state = 'done'").all(enrolment.id).map((x) => x.step_id);
    if (!list.every((s) => done.includes(s.id))) return false;
    if (db.prepare('SELECT 1 FROM class_completions WHERE class_id = ? AND person_id = ?').get(cls.id, enrolment.person_id)) return false;
    db.prepare("INSERT INTO class_completions (class_id, person_id, completed_at, method) VALUES (?, ?, ?, 'steps')").run(cls.id, enrolment.person_id, classToday(db, cls, now));
    if (req) audit(db, req, 'class.complete', { class_id: cls.id, person_id: enrolment.person_id, method: 'steps' });
    announceDone(cls, enrolment.person_id);
    return true;
  }
  function announceDone(cls, personId) {
    const p = db.prepare('SELECT first_name, last_name, nickname FROM people WHERE id = ?').get(personId);
    const links = { url: `/#/classes/${cls.id}`, app_url: `/app/#/classes/${cls.id}` };
    notify(db, accountsOf(personId), { kind: 'class', title: `You finished ${cls.title}`, body: 'Well done. Thank you for taking part.', ...links, app_url: links.app_url, data: { class_id: cls.id } });
    notify(db, managerIds(cls.id), { kind: 'class', title: `${nameOf(p)} finished ${cls.title}`, body: '', ...links, data: { class_id: cls.id } });
  }

  // ---------------------------------------------------------------- the hub: classes
  const counts = `(SELECT COUNT(*) FROM class_enrolments e WHERE e.class_id = c.id AND e.removed_at IS NULL) enrolled,
    (SELECT COUNT(*) FROM class_completions k WHERE k.class_id = c.id AND k.revoked_at IS NULL AND EXISTS (SELECT 1 FROM class_enrolments e WHERE e.class_id = c.id AND e.person_id = k.person_id AND e.removed_at IS NULL)) completed,
    (SELECT COUNT(*) FROM class_steps s WHERE s.class_id = c.id AND s.archived = 0) step_count`;

  // The classes this account runs (staff, at their campuses) or manages (named by staff).
  r.get('/classes', requireRole('volunteer'), (req, res) => {
    const rows = db.prepare(`SELECT c.*, ca.short_name campus_short, ca.name campus_name, ${counts} FROM classes c LEFT JOIN campuses ca ON ca.id = c.campus_id
      ORDER BY c.archived, c.title LIMIT 500`).all();
    const managed = new Set(db.prepare('SELECT class_id FROM class_managers WHERE user_id = ?').all(req.user.id).map((m) => m.class_id));
    res.json(rows.filter((c) => staffManages(req.user, c) || managed.has(c.id)).map((c) => ({
      id: c.id, title: c.title, description: c.description, campus_id: c.campus_id, campus: c.campus_short || c.campus_name || '', archived: Boolean(c.archived),
      enrolled: c.enrolled, completed: c.completed, steps: c.step_count, can_manage: staffManages(req.user, c),
    })));
  });

  // Names only, for choosing a class manager: active accounts linked to a person, found by name.
  r.get('/classes/manager-options', requireRole('staff'), (req, res) => {
    const q = str(req.query.q, 60).toLowerCase();
    if (q.length < 2) return res.json([]);
    const rows = db.prepare(`SELECT u.id, u.role, p.campus_id, p.first_name, p.last_name, p.nickname FROM users u JOIN people p ON p.id = u.person_id
      WHERE u.active = 1 AND (lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(COALESCE(p.nickname, '') || ' ' || p.last_name) LIKE ?) ORDER BY p.last_name, p.first_name LIMIT 100`).all(`%${q}%`, `%${q}%`);
    res.json(rows.filter((u) => canCampus(req.user, u.campus_id)).slice(0, 25).map((u) => ({ id: u.id, name: nameOf(u), role: u.role })));
  });

  const classFields = (req, b, old = {}) => {
    const f = {};
    f.title = required(b.title ?? old.title, 'Title').slice(0, 140);
    f.description = str(b.description ?? old.description, 2000);
    f.campus_id = b.campus_id !== undefined ? int(b.campus_id) : old.campus_id ?? null;
    if (f.campus_id && !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(f.campus_id)) throw bad('Unknown campus.');
    if (!staffManages(req.user, { campus_id: f.campus_id })) throw forbidden();
    return f;
  };

  r.post('/classes', requireRole('staff'), (req, res) => {
    const f = classFields(req, req.body || {});
    const id = Number(db.prepare('INSERT INTO classes (title, description, campus_id, created_by) VALUES (?, ?, ?, ?)').run(f.title, f.description, f.campus_id, req.user.id).lastInsertRowid);
    audit(db, req, 'class.create', { id, title: f.title });
    res.status(201).json({ id });
  });

  // Staff get everything, including which quiz answers are right. A manager gets the step list only.
  const stepView = (s, staff) => ({
    id: s.id, sort: s.sort, kind: s.kind, title: s.title, body: s.body, starts_on: s.starts_on, archived: Boolean(s.archived),
    ...(staff ? {
      video_id: s.video_id, video_sec: s.video_sec, video_title: s.video_title, questions: parseList(s.questions),
      makeup_video_id: s.makeup_video_id, makeup_video_sec: s.makeup_video_sec, makeup_video_title: s.makeup_video_title, makeup_questions: parseList(s.makeup_questions),
    } : { has_makeup: s.kind === 'session' && hasMakeup(s) }),
  });

  r.get('/classes/:id', requireRole('volunteer'), (req, res) => {
    const { cls, staff } = viewClass(req);
    const ca = cls.campus_id ? db.prepare('SELECT short_name, name FROM campuses WHERE id = ?').get(cls.campus_id) : null;
    res.json({
      id: cls.id, title: cls.title, description: cls.description, campus_id: cls.campus_id, campus: ca ? ca.short_name || ca.name : '', archived: Boolean(cls.archived),
      can_manage: staff, today: classToday(db, cls, now), steps: steps(cls.id, { all: staff }).map((s) => stepView(s, staff)),
      managers: staff ? db.prepare(`SELECT u.id, u.role, p.first_name, p.last_name, p.nickname FROM class_managers m JOIN users u ON u.id = m.user_id LEFT JOIN people p ON p.id = u.person_id WHERE m.class_id = ? ORDER BY p.last_name`).all(cls.id).map((u) => ({ id: u.id, name: u.first_name ? nameOf(u) : `Account ${u.id}`, role: u.role })) : undefined,
    });
  });

  r.patch('/classes/:id', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const f = classFields(req, req.body || {}, c);
    db.prepare("UPDATE classes SET title = ?, description = ?, campus_id = ?, updated_at = datetime('now') WHERE id = ?").run(f.title, f.description, f.campus_id, c.id);
    audit(db, req, 'class.update', { id: c.id });
    res.json({ ok: true });
  });

  r.post('/classes/:id/archive', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const archived = req.body?.archived === false ? 0 : 1;
    db.prepare("UPDATE classes SET archived = ?, updated_at = datetime('now') WHERE id = ?").run(archived, c.id);
    audit(db, req, 'class.archive', { id: c.id, archived: Boolean(archived) });
    res.json({ ok: true, archived: Boolean(archived) });
  });

  // ---------------------------------------------------------------- the hub: steps
  // A YouTube link, checked with YouTube (is it a real video, how long is it). Unlisted is fine.
  const keepOrFetch = async (input, oldId, oldSec, oldTitle) => {
    const text = str(input, 300);
    if (!text) return { id: null, sec: null, title: '' };
    const id = youtubeId(text);
    if (!id) throw bad('Paste a YouTube video’s address, like https://youtu.be/…');
    if (id === oldId) return { id, sec: oldSec, title: oldTitle };
    let v;
    try { v = await fetchVideo(id); } catch (e) { throw bad(`We couldn’t check that video with YouTube (${e.message}). Make sure it exists and is set to Unlisted or Public.`); }
    if (v.state && v.state !== 'none') throw bad('That video is live or hasn’t started yet. Add it once it’s over.');
    return { id, sec: v.duration || null, title: str(v.title, 200) };
  };

  const stepFields = async (b, old = null) => {
    const kind = old ? old.kind : KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) throw bad('Choose what kind of step this is.');
    const f = { kind, title: required(b.title ?? old?.title, 'Title').slice(0, 140), body: str(b.body ?? old?.body, 4000), starts_on: null,
      video_id: null, video_sec: null, video_title: '', questions: '[]', makeup_video_id: null, makeup_video_sec: null, makeup_video_title: '', makeup_questions: '[]' };
    const keep = (k) => (old ? old[k] : undefined);
    if (kind === 'session') {
      const date = b.starts_on !== undefined ? b.starts_on : old?.starts_on;
      if (date && !isDate(date)) throw bad('Pick the date of the session.');
      f.starts_on = date || null;
      const m = b.makeup_video !== undefined ? await keepOrFetch(b.makeup_video, keep('makeup_video_id'), keep('makeup_video_sec'), keep('makeup_video_title'))
        : { id: keep('makeup_video_id') ?? null, sec: keep('makeup_video_sec') ?? null, title: keep('makeup_video_title') ?? '' };
      Object.assign(f, { makeup_video_id: m.id, makeup_video_sec: m.sec, makeup_video_title: m.title });
      f.makeup_questions = JSON.stringify(cleanQuestions(b.makeup_questions !== undefined ? b.makeup_questions : parseList(old?.makeup_questions)));
    } else if (kind === 'video') {
      const v = b.video !== undefined ? await keepOrFetch(b.video, keep('video_id'), keep('video_sec'), keep('video_title'))
        : { id: keep('video_id') ?? null, sec: keep('video_sec') ?? null, title: keep('video_title') ?? '' };
      if (!v.id) throw bad('Paste the video’s YouTube address.');
      Object.assign(f, { video_id: v.id, video_sec: v.sec, video_title: v.title });
    } else {
      f.questions = JSON.stringify(cleanQuestions(b.questions !== undefined ? b.questions : parseList(old?.questions), { min: 1 }));
    }
    return f;
  };
  const COLS = ['kind', 'title', 'body', 'starts_on', 'video_id', 'video_sec', 'video_title', 'questions', 'makeup_video_id', 'makeup_video_sec', 'makeup_video_title', 'makeup_questions'];

  r.post('/classes/:id/steps', requireRole('staff'), async (req, res) => {
    const c = staffClass(req);
    const f = await stepFields(req.body || {});
    const sort = (db.prepare('SELECT MAX(sort) m FROM class_steps WHERE class_id = ?').get(c.id).m ?? -1) + 1;
    const id = Number(db.prepare(`INSERT INTO class_steps (class_id, sort, ${COLS.join(', ')}) VALUES (?, ?, ${COLS.map(() => '?').join(', ')})`).run(c.id, sort, ...COLS.map((k) => f[k])).lastInsertRowid);
    audit(db, req, 'class.step.add', { class: c.id, step: id, kind: f.kind });
    res.status(201).json({ id });
  });

  r.patch('/classes/:id/steps/:stepId', requireRole('staff'), async (req, res) => {
    const c = staffClass(req);
    const s = loadStep(c, req.params.stepId);
    const f = await stepFields(req.body || {}, s);
    db.prepare(`UPDATE class_steps SET ${COLS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...COLS.map((k) => f[k]), s.id);
    audit(db, req, 'class.step.update', { class: c.id, step: s.id });
    res.json({ ok: true });
  });

  // A step nobody has done anything in is deleted; one with history is archived (it stays in the records).
  r.delete('/classes/:id/steps/:stepId', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const s = loadStep(c, req.params.stepId);
    const used = db.prepare('SELECT 1 FROM class_progress WHERE step_id = ?').get(s.id);
    if (used) db.prepare('UPDATE class_steps SET archived = 1 WHERE id = ?').run(s.id);
    else db.prepare('DELETE FROM class_steps WHERE id = ?').run(s.id);
    audit(db, req, 'class.step.remove', { class: c.id, step: s.id, archived: Boolean(used) });
    res.json({ ok: true, archived: Boolean(used) });
  });

  r.post('/classes/:id/steps/reorder', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number);
    const have = steps(c.id, { all: true }).map((s) => s.id);
    if (ids.length !== have.length || !have.every((id) => ids.includes(id))) throw bad('That order doesn’t match the steps. Please refresh and try again.');
    tx(db, () => ids.forEach((id, i) => db.prepare('UPDATE class_steps SET sort = ? WHERE id = ?').run(i, id)));
    audit(db, req, 'class.step.reorder', { class: c.id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the hub: managers
  r.post('/classes/:id/managers', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const u = db.prepare('SELECT u.id, p.campus_id FROM users u JOIN people p ON p.id = u.person_id WHERE u.id = ? AND u.active = 1').get(int(req.body?.user_id, 'Account'));
    if (!u || !canCampus(req.user, u.campus_id)) throw bad('Choose someone from the list.');
    db.prepare('INSERT OR IGNORE INTO class_managers (class_id, user_id) VALUES (?, ?)').run(c.id, u.id);
    audit(db, req, 'class.manager.add', { class: c.id, user: u.id });
    res.status(201).json({ ok: true });
  });
  r.delete('/classes/:id/managers/:userId', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const uid = int(req.params.userId);
    if (db.prepare('DELETE FROM class_managers WHERE class_id = ? AND user_id = ?').run(c.id, uid).changes) audit(db, req, 'class.manager.remove', { class: c.id, user: uid });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the hub: people
  r.post('/classes/:id/enrol', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    if (c.archived) throw bad('This class is archived. Bring it back before adding people.');
    const ids = [...new Set((Array.isArray(req.body?.person_ids) ? req.body.person_ids : []).map(Number))];
    if (!ids.length || ids.length > 100 || ids.some((n) => !Number.isInteger(n))) throw bad('Choose who to add (up to 100 at a time).');
    const people = ids.map((id) => {
      const p = db.prepare('SELECT id, campus_id FROM people WHERE id = ? AND archived = 0').get(id);
      if (!p) throw bad('One of those people wasn’t found.');
      if (!canCampus(req.user, p.campus_id)) throw forbidden();
      return p;
    });
    let added = 0;
    tx(db, () => {
      for (const p of people) {
        const e = db.prepare('SELECT id, removed_at FROM class_enrolments WHERE class_id = ? AND person_id = ?').get(c.id, p.id);
        if (!e) { db.prepare('INSERT INTO class_enrolments (class_id, person_id, enrolled_by) VALUES (?, ?, ?)').run(c.id, p.id, req.user.id); added++; }
        else if (e.removed_at) { db.prepare("UPDATE class_enrolments SET removed_at = NULL, enrolled_by = ?, enrolled_at = datetime('now') WHERE id = ?").run(req.user.id, e.id); added++; }
      }
    });
    if (added) audit(db, req, 'class.enrol', { class: c.id, people: ids });
    res.json({ added, already: ids.length - added });
  });

  r.delete('/classes/:id/enrolments/:personId', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const pid = int(req.params.personId);
    const done = db.prepare("UPDATE class_enrolments SET removed_at = datetime('now') WHERE class_id = ? AND person_id = ? AND removed_at IS NULL").run(c.id, pid).changes;
    if (!done) throw notFound('That person in this class');
    audit(db, req, 'class.unenrol', { class: c.id, person: pid });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the roster
  // People × steps with each state and score. For staff and this class's managers.
  r.get('/classes/:id/roster', requireRole('volunteer'), (req, res) => {
    const { cls, staff } = viewClass(req);
    const list = steps(cls.id);
    const people = db.prepare(`SELECT e.id enrolment_id, e.enrolled_at, p.id person_id, p.first_name, p.last_name, p.nickname FROM class_enrolments e JOIN people p ON p.id = e.person_id
      WHERE e.class_id = ? AND e.removed_at IS NULL ORDER BY p.last_name, p.first_name LIMIT 1000`).all(cls.id);
    const progress = db.prepare(`SELECT g.* FROM class_progress g JOIN class_enrolments e ON e.id = g.enrolment_id WHERE e.class_id = ? AND e.removed_at IS NULL`).all(cls.id);
    const done = db.prepare('SELECT * FROM class_completions WHERE class_id = ? AND revoked_at IS NULL').all(cls.id);
    res.json({
      class: { id: cls.id, title: cls.title, archived: Boolean(cls.archived) },
      can_manage: staff,
      steps: list.map((s) => ({ id: s.id, kind: s.kind, title: s.title, starts_on: s.starts_on, has_makeup: s.kind === 'session' && hasMakeup(s) })),
      people: people.map((p) => {
        const c = done.find((k) => k.person_id === p.person_id);
        return {
          person_id: p.person_id, name: nameOf(p), enrolment_id: p.enrolment_id,
          steps: Object.fromEntries(progress.filter((g) => g.enrolment_id === p.enrolment_id && list.some((s) => s.id === g.step_id)).map((g) => [g.step_id, {
            state: g.state, method: g.method, score: g.score, attempts: g.attempts, watched: Boolean(g.watched), passed: Boolean(g.passed),
          }])),
          completion: c ? { id: c.id, completed_at: c.completed_at, method: c.method, ...(staff ? { note: c.note } : {}) } : null,
        };
      }),
    });
  });

  // ---------------------------------------------------------------- attendance
  // { person_ids, present: true | false | null } for a session step. null clears the mark.
  // Open to staff and to this class's managers; every mark is in the audit log with who made it.
  r.post('/classes/:id/steps/:stepId/attendance', requireRole('volunteer'), (req, res) => {
    const { cls } = viewClass(req);
    if (cls.archived) throw bad('This class is archived, so attendance can’t be changed.');
    const step = loadStep(cls, req.params.stepId);
    if (step.kind !== 'session' || step.archived) throw bad('Attendance is for in-person sessions.');
    const present = req.body?.present;
    if (![true, false, null].includes(present)) throw bad('Mark each person present or absent.');
    const ids = [...new Set((Array.isArray(req.body?.person_ids) ? req.body.person_ids : []).map(Number))];
    if (!ids.length || ids.length > 500 || ids.some((n) => !Number.isInteger(n))) throw bad('Choose who to mark.');
    const enrolments = ids.map((pid) => {
      const e = db.prepare('SELECT * FROM class_enrolments WHERE class_id = ? AND person_id = ? AND removed_at IS NULL').get(cls.id, pid);
      if (!e) throw bad('Someone you chose isn’t in this class.');
      return e;
    });
    const completed = [];
    const toTell = [];
    tx(db, () => {
      for (const e of enrolments) {
        const row = getRow(e.id, step.id);
        if (present === true) {
          ensureRow(e.id, step.id);
          db.prepare("UPDATE class_progress SET state = 'done', method = 'attended', done_at = ?, marked_by = ? WHERE enrolment_id = ? AND step_id = ?").run(stamp(), req.user.id, e.id, step.id);
        } else if (present === false) {
          ensureRow(e.id, step.id);
          // A make-up already finished stays finished.
          if (!(row && row.state === 'done' && row.method === 'makeup')) {
            db.prepare("UPDATE class_progress SET state = 'started', method = 'absent', done_at = NULL, marked_by = ? WHERE enrolment_id = ? AND step_id = ?").run(req.user.id, e.id, step.id);
            settle(e.id, step);
          }
          if (hasMakeup(step) && !getRow(e.id, step.id).makeup_notified_at && getRow(e.id, step.id).state !== 'done') {
            db.prepare('UPDATE class_progress SET makeup_notified_at = ? WHERE enrolment_id = ? AND step_id = ?').run(stamp(), e.id, step.id);
            toTell.push(e.person_id);
          }
        } else if (row && ['attended', 'absent'].includes(row.method)) {
          if (row.max_sec || row.attempts) {
            db.prepare("UPDATE class_progress SET state = 'started', method = 'makeup', done_at = NULL, marked_by = ? WHERE enrolment_id = ? AND step_id = ?").run(req.user.id, e.id, step.id);
            settle(e.id, step);
          } else db.prepare('DELETE FROM class_progress WHERE enrolment_id = ? AND step_id = ?').run(e.id, step.id);
        }
        if (checkComplete(e, req)) completed.push(e.person_id);
      }
    });
    for (const pid of toTell) {
      notify(db, accountsOf(pid), { kind: 'class', title: `A make-up is ready for ${step.title}`, body: 'Watch the recording and take the test whenever you can.', url: `/#/classes/${cls.id}`, app_url: `/app/#/classes/${cls.id}/${step.id}`, data: { class_id: cls.id } });
    }
    audit(db, req, 'class.attendance', { class: cls.id, step: step.id, present, people: ids });
    res.json({ ok: true, completed: completed.length });
  });

  // ---------------------------------------------------------------- completing by hand
  r.post('/classes/:id/complete', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const note = required(req.body?.note, 'A note about why');
    const pid = int(req.body?.person_id, 'Person');
    const e = db.prepare('SELECT * FROM class_enrolments WHERE class_id = ? AND person_id = ? AND removed_at IS NULL').get(c.id, pid);
    if (!e) throw bad('Add them to the class first.');
    if (db.prepare('SELECT 1 FROM class_completions WHERE class_id = ? AND person_id = ? AND revoked_at IS NULL').get(c.id, pid)) throw new HttpError(409, 'They’ve already finished this class.');
    const id = Number(db.prepare("INSERT INTO class_completions (class_id, person_id, completed_at, method, by_user, note) VALUES (?, ?, ?, 'manual', ?, ?)").run(c.id, pid, classToday(db, c, now), req.user.id, note.slice(0, 500)).lastInsertRowid);
    audit(db, req, 'class.complete_manual', { class: c.id, person: pid, completion: id });
    announceDone(c, pid);
    res.status(201).json({ id });
  });

  r.post('/classes/:id/completions/:cid/revoke', requireRole('staff'), (req, res) => {
    const c = staffClass(req);
    const k = db.prepare('SELECT * FROM class_completions WHERE id = ? AND class_id = ? AND revoked_at IS NULL').get(int(req.params.cid), c.id);
    if (!k) throw notFound('That completion');
    db.prepare("UPDATE class_completions SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?").run(req.user.id, k.id);
    audit(db, req, 'class.revoke', { class: c.id, person: k.person_id, completion: k.id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the member app
  const stateOf = (step, row, today) => {
    if (row?.state === 'done') return 'done';
    if (step.kind !== 'session') return row ? 'started' : 'todo';
    if (makeupOpen(step, row, today)) return 'makeup';
    if (row?.method === 'absent') return 'absent'; // no make-up set up: the leader will sort it out
    return step.starts_on && step.starts_on < today ? 'missed' : 'upcoming';
  };

  r.get('/me/classes', requireRole('volunteer'), (req, res) => {
    const pid = mine(req);
    const rows = db.prepare(`SELECT e.id enrolment_id, c.id, c.title, c.description, c.archived,
        (SELECT COUNT(*) FROM class_steps s WHERE s.class_id = c.id AND s.archived = 0) total,
        (SELECT COUNT(*) FROM class_progress g JOIN class_steps s ON s.id = g.step_id WHERE g.enrolment_id = e.id AND g.state = 'done' AND s.archived = 0) done,
        (SELECT completed_at FROM class_completions k WHERE k.class_id = c.id AND k.person_id = e.person_id AND k.revoked_at IS NULL ORDER BY k.id DESC LIMIT 1) completed_at
      FROM class_enrolments e JOIN classes c ON c.id = e.class_id WHERE e.person_id = ? AND e.removed_at IS NULL ORDER BY c.archived, c.title LIMIT 100`).all(pid);
    res.json(rows.filter((c) => !c.archived || c.completed_at).map((c) => ({ id: c.id, title: c.title, description: c.description, total: c.total, done: c.done, completed_at: c.completed_at })));
  });

  r.get('/me/classes/:id', requireRole('volunteer'), (req, res) => {
    const cls = loadClass(req.params.id);
    const e = myEnrolment(req, cls.id);
    const today = classToday(db, cls, now);
    const rows = new Map(db.prepare('SELECT * FROM class_progress WHERE enrolment_id = ?').all(e.id).map((g) => [g.step_id, g]));
    const done = db.prepare('SELECT completed_at FROM class_completions WHERE class_id = ? AND person_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').get(cls.id, e.person_id);
    res.json({
      id: cls.id, title: cls.title, description: cls.description, archived: Boolean(cls.archived), completed_at: done?.completed_at ?? null,
      steps: steps(cls.id).map((s) => {
        const row = rows.get(s.id);
        const open = makeupOpen(s, row, today);
        return {
          id: s.id, kind: s.kind, title: s.title, starts_on: s.starts_on, state: stateOf(s, row, today), method: row?.method ?? null,
          makeup_ready: open && row?.state !== 'done', has_quiz: s.kind === 'quiz' || (s.kind === 'session' && open && parseList(s.makeup_questions).length > 0),
          score: row?.score ?? null,
        };
      }),
    });
  });

  // One step. The video and the questions come only when the step is open to this person
  // (a make-up only once they were marked absent or the date has passed). Never the right answers.
  r.get('/me/classes/:id/steps/:stepId', requireRole('volunteer'), (req, res) => {
    const cls = loadClass(req.params.id);
    const e = myEnrolment(req, cls.id);
    const s = loadStep(cls, req.params.stepId);
    if (s.archived) throw notFound('That step');
    const row = getRow(e.id, s.id);
    const today = classToday(db, cls, now);
    const open = s.kind !== 'session' || makeupOpen(s, row, today);
    const p = partsOf(s);
    const cfg = classSettings(db);
    res.json({
      id: s.id, class_id: cls.id, class_title: cls.title, kind: s.kind, title: s.title, body: s.body, starts_on: s.starts_on,
      state: stateOf(s, row, today), method: row?.method ?? null, closed: Boolean(cls.archived),
      video: open && p.videoId ? { id: p.videoId, title: p.videoTitle, length: p.videoSec || row?.duration_sec || null, position: row?.position_sec || 0, watched: Boolean(row?.watched) } : null,
      quiz: open && p.questions.length ? { questions: forMember(JSON.stringify(p.questions)), best_score: row?.score ?? null, passed: Boolean(row?.passed), attempts: row?.attempts || 0, pass_pct: cfg.pass_pct } : null,
      makeup: s.kind === 'session' ? { open, has_video: Boolean(s.makeup_video_id), has_quiz: parseList(s.makeup_questions).length > 0 } : null,
    });
  });

  // What a person is allowed to act on right now, or a plain refusal.
  function openStep(req) {
    const cls = loadClass(req.params.id);
    const e = myEnrolment(req, cls.id);
    const s = loadStep(cls, req.params.stepId); // a step of another class is "not found" here
    if (s.archived) throw new HttpError(409, 'This step has been retired, so there’s nothing to do here.');
    if (cls.archived) throw new HttpError(409, 'This class has finished, so it can’t be changed.');
    let row = getRow(e.id, s.id);
    if (s.kind === 'session') {
      if (!makeupOpen(s, row, classToday(db, cls, now))) throw new HttpError(409, 'The make-up opens once you’ve been marked absent, or after the session date has passed.');
      row = ensureRow(e.id, s.id);
      if (!row.method) db.prepare("UPDATE class_progress SET method = 'makeup' WHERE enrolment_id = ? AND step_id = ?").run(e.id, s.id);
    }
    return { cls, e, s, row: row ?? ensureRow(e.id, s.id) };
  }

  // The player reports where it is every so often and when it ends: { position, duration, ended }.
  // Not audited (too frequent).
  r.post('/me/classes/:id/steps/:stepId/progress', requireRole('volunteer'), (req, res) => {
    const { e, s, row } = openStep(req);
    const p = partsOf(s);
    if (!p.videoId) throw bad('This step has no video.');
    const out = applyPing(row, { position: req.body?.position, reported: req.body?.duration, ended: req.body?.ended === true }, p.videoSec, now().getTime(), classSettings(db).watch_pct);
    if (!out) throw bad('We couldn’t tell how long the video is yet. Let it play a moment and try again.');
    db.prepare('UPDATE class_progress SET position_sec = ?, max_sec = ?, duration_sec = ?, watched = ?, last_ping_at = ? WHERE enrolment_id = ? AND step_id = ?')
      .run(out.position, out.max, p.videoSec ? row.duration_sec : out.duration, out.watched ? 1 : 0, stamp(), e.id, s.id);
    settle(e.id, s);
    checkComplete(e, req);
    const now2 = getRow(e.id, s.id);
    res.json({ position: out.position, watched: out.watched, done: now2.state === 'done' });
  });

  r.post('/me/classes/:id/steps/:stepId/quiz', requireRole('volunteer'), (req, res) => {
    const { e, s } = openStep(req);
    const qs = partsOf(s).questions;
    if (!qs.length) throw bad('This step has no questions.');
    const cfg = classSettings(db);
    if (!limits.hit(`quiz:${e.person_id}`, cfg.quiz_attempts_per_hour, 3600e3)) throw new HttpError(429, 'You’ve had a lot of tries just now. Take a short break, then have another go.');
    const g = grade(JSON.stringify(qs), req.body?.answers, cfg.pass_pct);
    // Only the best score and the number of tries are kept; the answers themselves are not.
    db.prepare('UPDATE class_progress SET score = MAX(COALESCE(score, 0), ?), attempts = attempts + 1, passed = MAX(passed, ?) WHERE enrolment_id = ? AND step_id = ?').run(g.score, g.passed ? 1 : 0, e.id, s.id);
    settle(e.id, s);
    checkComplete(e, req);
    const after = getRow(e.id, s.id);
    audit(db, req, 'class.quiz', { class_id: e.class_id, step_id: s.id, score: g.score, passed: g.passed });
    // Which questions to look at again only after a few tries, so the feedback can't be used to
    // work out the answers one choice at a time.
    res.json({
      score: g.score, passed: g.passed, review: g.passed || (after.attempts || 0) < 3 ? [] : g.review, done: after.state === 'done',
      message: g.passed ? 'Passed!' : 'Not quite — try again.',
    });
  });

  return r;
}
