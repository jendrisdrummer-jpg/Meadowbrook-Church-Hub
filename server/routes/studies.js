// Bible studies: personal studies (mostly one-on-one) with a teacher, one or more students and an
// approved material. A small module of its own, not small groups: nobody browses or joins a study,
// a coordinator matches people to teachers. Studies belong to the whole church (a campus is optional
// and only for reporting). Coordinators (the users.studies switch) and staff run everything; a teacher
// with an account updates only their own studies; a student sees only their own.
// A finished material is a row in study_completions, which outlives the study. No attendance, no
// reminders, no pastoral notes: the only free text is a short coordinator-only note.
import { Router } from 'express';
import { requireRole, requireStudies, requireAllCampuses, canStudies, canCampus, campusFilter, rank } from '../auth.js';
import { tx } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str, required, oneOf, isDate, audit, localNow } from '../http.js';
import { notifyStudyRequest } from '../notify.js';
import { csvRecords, toCsv } from '../csv.js';

const STATUSES = ['active', 'paused', 'finished'];
const FORMATS = ['one_on_one', 'small_group', 'either'];
// A short closed list, not free text, so a close never becomes a note about a person.
export const CLOSE_REASONS = { found_another_way: 'Found another way to study', no_longer_interested: 'No longer interested', not_reachable: 'Couldn’t reach them', duplicate: 'Duplicate request', other: 'Other' };
const NOTE_MAX = 280;
const RHYTHM_MAX = 120;
const IMPORT_MAX_ROWS = 2000;
const REQUESTS_PER_HOUR = 5;
const SEARCHES = 120; // name searches per account per 10 minutes
const SEARCH_WINDOW = 10 * 60e3;
const isStaff = (user) => rank(user.role) >= rank('staff');

const nameOf = (p) => `${p.nickname || p.first_name || ''} ${p.last_name || ''}`.trim();

export default function studyRoutes(db, { now = () => new Date() } = {}) {
  const r = Router();
  const searches = new Map(); // user id -> recent search times

  // The church's "today": the first campus's own clock (studies are church-wide).
  const today = () => {
    const tz = db.prepare('SELECT timezone FROM campuses ORDER BY id LIMIT 1').get()?.timezone || 'UTC';
    try { return localNow(tz, now()).date; } catch { return localNow('UTC', now()).date; }
  };

  // ---------------------------------------------------------------- small helpers
  const getStudy = (id) => {
    const s = db.prepare('SELECT * FROM studies WHERE id = ?').get(int(id, 'Study'));
    if (!s) throw notFound('Study');
    return s;
  };
  // Coordinators and staff, at the study's campus (a study with no campus is open to all of them).
  const manages = (req, s) => canStudies(req.user) && canCampus(req.user, s.campus_id);
  const teaches = (req, studyId) => Boolean(req.user.personId && db.prepare("SELECT 1 FROM study_people WHERE study_id = ? AND person_id = ? AND role = 'teacher' AND removed_at IS NULL").get(studyId, req.user.personId));
  const getManaged = (req, id) => {
    const s = getStudy(id);
    if (!manages(req, s)) throw forbidden();
    return s;
  };
  // A person who can be put in a study: exists, isn't archived, and is at a campus this account reaches.
  function person(req, id, what = 'Person') {
    const p = db.prepare('SELECT * FROM people WHERE id = ? AND archived = 0').get(int(id, what));
    if (!p) throw notFound(what);
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    return p;
  }
  const material = (id, { mustBeActive = true } = {}) => {
    const m = db.prepare('SELECT * FROM study_materials WHERE id = ?').get(int(id, 'Material'));
    if (!m) throw notFound('Material');
    if (mustBeActive && !m.active) throw bad('That material has been retired. Choose one from the current list.');
    return m;
  };
  const hasAccount = (personId) => Boolean(db.prepare('SELECT 1 FROM users WHERE person_id = ? AND active = 1').get(personId));
  const optInt = (v, field, max = 999) => {
    const n = int(v, field);
    if (n != null && (n < 0 || n > max)) throw bad(`${field} must be between 0 and ${max}.`);
    return n;
  };
  const cleanNote = (v) => {
    const s = str(v, 5000);
    if (s.length > NOTE_MAX) throw bad(`Keep the note to ${NOTE_MAX} characters or fewer. It’s for practical things like “prefers mornings”.`);
    return s;
  };
  const cleanRhythm = (v) => {
    const s = str(v, 1000);
    if (s.length > RHYTHM_MAX) throw bad(`When and where they meet can be up to ${RHYTHM_MAX} characters.`);
    return s;
  };
  const progressOf = (s) => ({ lesson: s.lesson, planned: s.planned_lessons ?? s.material_lessons ?? null, sessions: s.sessions, since: s.started_on });

  // Active people of the given studies, grouped by study. `contacts`: 'all' (coordinators and staff),
  // 'consented' (a teacher sees a student's phone and email only if that student agreed), 'limited' (a
  // coordinator below staff: only people who asked through a request, or who agreed to share) or 'none'.
  function peopleFor(studyIds, contacts) {
    const out = new Map(studyIds.map((id) => [id, []]));
    if (!studyIds.length) return out;
    const rows = db.prepare(`SELECT sp.study_id, sp.role, sp.share_contact, p.id, p.first_name, p.last_name, p.nickname, p.photo, p.phone, p.email,
        EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id AND u.active = 1) has_account,
        EXISTS (SELECT 1 FROM study_requests q WHERE q.person_id = p.id AND q.study_id = sp.study_id) via_request
      FROM study_people sp JOIN people p ON p.id = sp.person_id
      WHERE sp.removed_at IS NULL AND sp.study_id IN (${studyIds.map(() => '?').join(',')}) ORDER BY sp.role DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`).all(...studyIds);
    for (const x of rows) {
      const o = { id: x.id, name: nameOf(x), photo: x.photo || null, role: x.role, has_account: Boolean(x.has_account) };
      if (x.role === 'student') o.share_contact = Boolean(x.share_contact);
      const agreed = x.role === 'student' && x.share_contact;
      const showContact = contacts === 'all' || (contacts === 'consented' && agreed) || (contacts === 'limited' && (agreed || x.via_request));
      if (showContact) { o.phone = x.phone; o.email = x.email; } else if (contacts === 'limited') o.contact_hidden = true;
      out.get(x.study_id).push(o);
    }
    return out;
  }

  const STUDY_SELECT = `SELECT s.*, m.title material_title, m.lessons material_lessons, m.teacher_notes material_teacher_notes, c.short_name campus_short, c.name campus_name
    FROM studies s LEFT JOIN study_materials m ON m.id = s.material_id LEFT JOIN campuses c ON c.id = s.campus_id`;

  // The shape a coordinator or staff member sees; teachers get the same minus the coordinator note.
  function shape(s, people, { forTeacher = false } = {}) {
    const out = {
      id: s.id, status: s.status, material_id: s.material_id, material_title: s.material_title || null, campus_id: s.campus_id, campus: s.campus_short || s.campus_name || '',
      started_on: s.started_on, finished_on: s.finished_on, rhythm: s.rhythm, progress: progressOf(s),
      planned_lessons: s.planned_lessons, lesson: s.lesson, sessions: s.sessions,
      teachers: people.filter((p) => p.role === 'teacher'), students: people.filter((p) => p.role === 'student'),
    };
    out.teachers_without_account = out.teachers.filter((t) => !t.has_account).map((t) => ({ id: t.id, name: t.name }));
    if (forTeacher) out.material_teacher_notes = s.material_teacher_notes || '';
    else { out.coordinator_note = s.coordinator_note; out.request_id = s.request_id; }
    return out;
  }

  // ---------------------------------------------------------------- materials (the approved list)
  const MATERIAL_ROWS = (year) => `SELECT m.id, m.title, m.author, m.lessons, m.teacher_notes, m.active, m.created_at,
      (SELECT COUNT(*) FROM studies s WHERE s.material_id = m.id AND s.status != 'finished') active_studies,
      (SELECT COUNT(*) FROM study_completions c WHERE c.material_id = m.id AND c.revoked_at IS NULL) completions,
      (SELECT COUNT(*) FROM study_completions c WHERE c.material_id = m.id AND c.revoked_at IS NULL AND substr(c.completed_on, 1, 4) = '${year}') completions_year
    FROM study_materials m`;
  const yearOf = (req) => {
    const y = int(req.query.year, 'Year');
    return y && y >= 1900 && y <= 2200 ? String(y) : today().slice(0, 4);
  };

  r.get('/studies/materials', requireStudies, (req, res) => {
    const year = yearOf(req);
    const onlyActive = req.query.active === '1';
    const rows = db.prepare(`${MATERIAL_ROWS(year)} ${onlyActive ? 'WHERE m.active = 1' : ''} ORDER BY m.active DESC, m.title COLLATE NOCASE LIMIT 500`).all();
    res.json({ year, materials: rows.map((m) => ({ ...m, active: Boolean(m.active) })) });
  });

  function cleanMaterial(b, old = {}) {
    const m = {};
    m.title = required(b.title ?? old.title, 'Title').slice(0, 160);
    m.author = str(b.author ?? old.author, 160);
    m.lessons = b.lessons !== undefined ? optInt(b.lessons, 'Lessons', 500) : old.lessons ?? null;
    if (m.lessons === 0) m.lessons = null;
    m.teacher_notes = str(b.teacher_notes ?? old.teacher_notes, 2000);
    const dup = db.prepare('SELECT id FROM study_materials WHERE lower(title) = lower(?) AND id != ?').get(m.title, old.id ?? 0);
    if (dup) throw new HttpError(409, 'That material is already on the list.');
    return m;
  }

  r.post('/studies/materials', requireStudies, (req, res) => {
    const m = cleanMaterial(req.body || {});
    const id = Number(db.prepare('INSERT INTO study_materials (title, author, lessons, teacher_notes, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(m.title, m.author, m.lessons, m.teacher_notes, req.user.id).lastInsertRowid);
    audit(db, req, 'study.material_create', { id });
    res.status(201).json({ id });
  });

  // Retiring is how a material leaves the list: it is never deleted, because finished studies point at it.
  r.patch('/studies/materials/:id', requireStudies, (req, res) => {
    const old = material(req.params.id, { mustBeActive: false });
    const b = req.body || {};
    const m = cleanMaterial(b, old);
    const active = b.active === undefined ? old.active : (b.active ? 1 : 0);
    db.prepare("UPDATE study_materials SET title = ?, author = ?, lessons = ?, teacher_notes = ?, active = ?, updated_at = datetime('now') WHERE id = ?")
      .run(m.title, m.author, m.lessons, m.teacher_notes, active, old.id);
    audit(db, req, active !== old.active ? (active ? 'study.material_restore' : 'study.material_retire') : 'study.material_update', { id: old.id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the overview
  // Studies this account may see, optionally for one campus (id) or none ('none' = no campus set).
  function scope(req) {
    const cf = campusFilter(req.user, 's.campus_id');
    const where = [cf.sql];
    const args = [...cf.args];
    const c = req.query.campus;
    if (c === 'none') where.push('s.campus_id IS NULL');
    else if (c !== undefined && c !== '') { where.push('s.campus_id = ?'); args.push(int(c, 'Campus')); }
    return { where, args };
  }

  r.get('/studies/summary', requireStudies, (req, res) => {
    const { where, args } = scope(req);
    const w = where.join(' AND ');
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const count = (extra, ...more) => db.prepare(`SELECT COUNT(*) n FROM studies s WHERE ${w} AND ${extra}`).get(...args, ...more).n;
    const rcf = campusFilter(req.user, 'campus_id');
    const year = yearOf(req);
    res.json({
      active: count("s.status = 'active'"),
      paused: count("s.status = 'paused'"),
      finished_this_year: count("s.status = 'finished' AND s.finished_on >= ?", yearStart),
      waiting: db.prepare(`SELECT COUNT(*) n FROM study_requests WHERE status = 'waiting' AND ${rcf.sql}`).get(...rcf.args).n,
      teachers: db.prepare(`SELECT COUNT(DISTINCT sp.person_id) n FROM study_people sp JOIN studies s ON s.id = sp.study_id WHERE sp.role = 'teacher' AND sp.removed_at IS NULL AND s.status = 'active' AND ${w}`).get(...args).n,
      students: db.prepare(`SELECT COUNT(DISTINCT sp.person_id) n FROM study_people sp JOIN studies s ON s.id = sp.study_id WHERE sp.role = 'student' AND sp.removed_at IS NULL AND s.status = 'active' AND ${w}`).get(...args).n,
      completions_this_year: (() => {
        const pf = campusFilter(req.user, 'p.campus_id');
        return db.prepare(`SELECT COUNT(*) n FROM study_completions c JOIN people p ON p.id = c.person_id WHERE c.revoked_at IS NULL AND c.completed_on >= ? AND ${pf.sql}`).get(yearStart, ...pf.args).n;
      })(),
      year,
    });
  });

  // A small name search for choosing teachers and students. Coordinators below leader can't use the
  // People list, so this gives them names only (no phone, email or notes), at campuses they reach.
  r.get('/studies/people', requireStudies, (req, res) => {
    const q = str(req.query.q, 80).toLowerCase();
    if (q.length < 2) return res.json([]);
    const t = Date.now();
    const recent = (searches.get(req.user.id) || []).filter((x) => t - x < SEARCH_WINDOW);
    if (recent.length >= SEARCHES) { searches.set(req.user.id, recent); throw new HttpError(429, 'That’s a lot of searches. Please wait a few minutes.'); }
    recent.push(t);
    searches.set(req.user.id, recent);
    const cf = campusFilter(req.user, 'p.campus_id');
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; // a typed % or _ matches itself
    const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, c.short_name campus_short,
        EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id AND u.active = 1) has_account
      FROM people p LEFT JOIN campuses c ON c.id = p.campus_id
      WHERE p.archived = 0 AND ${cf.sql} AND (lower(p.first_name || ' ' || p.last_name) LIKE ? ESCAPE '\\' OR lower(p.nickname || ' ' || p.last_name) LIKE ? ESCAPE '\\')
      ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT 20`).all(...cf.args, like, like);
    res.json(rows.map((p) => ({ id: p.id, name: nameOf(p), campus: p.campus_short || '', has_account: Boolean(p.has_account) })));
  });

  // ---------------------------------------------------------------- the list, teachers and export
  r.get('/studies', requireStudies, (req, res) => {
    const { where, args } = scope(req);
    const status = req.query.status;
    if (STATUSES.includes(status)) { where.push('s.status = ?'); args.push(status); }
    if (req.query.material) { where.push('s.material_id = ?'); args.push(int(req.query.material, 'Material')); }
    if (req.query.teacher) { where.push("EXISTS (SELECT 1 FROM study_people sp WHERE sp.study_id = s.id AND sp.person_id = ? AND sp.role = 'teacher' AND sp.removed_at IS NULL)"); args.push(int(req.query.teacher, 'Teacher')); }
    const rows = db.prepare(`${STUDY_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.status = 'finished', s.started_on DESC, s.id DESC LIMIT 500`).all(...args);
    const people = peopleFor(rows.map((s) => s.id), 'none');
    res.json(rows.map((s) => shape(s, people.get(s.id))));
  });

  // Who is teaching: active studies now, and studies taught all time (studies plus hand-added history).
  r.get('/studies/teachers', requireStudies, (req, res) => {
    const cf = campusFilter(req.user, 's.campus_id');
    const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.campus_id,
        EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id AND u.active = 1) has_account,
        COUNT(DISTINCT CASE WHEN s.status = 'active' AND sp.removed_at IS NULL THEN s.id END) active_studies,
        COUNT(DISTINCT s.id) taught_studies
      FROM study_people sp JOIN studies s ON s.id = sp.study_id JOIN people p ON p.id = sp.person_id
      WHERE sp.role = 'teacher' AND ${cf.sql} GROUP BY p.id ORDER BY active_studies DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT 500`).all(...cf.args);
    res.json(rows.map((t) => {
      const history = db.prepare("SELECT COUNT(*) n FROM study_completions WHERE revoked_at IS NULL AND study_id IS NULL AND EXISTS (SELECT 1 FROM json_each(teacher_ids) WHERE value = ?)").get(t.id).n;
      return { id: t.id, name: nameOf(t), has_account: Boolean(t.has_account), active_studies: t.active_studies, taught: t.taught_studies + history };
    }));
  });

  r.get('/studies/export.csv', requireStudies, (req, res) => {
    const { where, args } = scope(req);
    const rows = db.prepare(`${STUDY_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.started_on DESC LIMIT 5000`).all(...args);
    const people = peopleFor(rows.map((s) => s.id), 'none');
    const names = (list, role) => list.filter((p) => p.role === role).map((p) => p.name).join('; ');
    const cols = ['id', 'material', 'status', 'teachers', 'students', 'campus', 'started_on', 'finished_on', 'meets', 'lesson', 'planned_lessons', 'sessions'];
    audit(db, req, 'study.export', `${rows.length} studies`);
    res.type('text/csv').attachment('bible-studies.csv').send(toCsv([cols, ...rows.map((s) => {
      const pl = people.get(s.id);
      return [s.id, s.material_title || '', s.status, names(pl, 'teacher'), names(pl, 'student'), s.campus_short || s.campus_name || '', s.started_on, s.finished_on || '', s.rhythm, s.lesson ?? '', s.planned_lessons ?? s.material_lessons ?? '', s.sessions ?? ''];
    })]));
  });

  // ---------------------------------------------------------------- the request queue
  const REQUEST_SELECT = `SELECT q.*, p.first_name, p.last_name, p.nickname, p.phone, p.email, m.title material_title, c.short_name campus_short, c.name campus_name
    FROM study_requests q JOIN people p ON p.id = q.person_id LEFT JOIN study_materials m ON m.id = q.material_id LEFT JOIN campuses c ON c.id = q.campus_id`;
  const requestShape = (q) => ({
    id: q.id, person_id: q.person_id, name: nameOf(q), phone: q.phone, email: q.email, campus_id: q.campus_id, campus: q.campus_short || q.campus_name || '',
    format: q.format, material_id: q.material_id, material_title: q.material_title || null, topic: q.topic, times: q.times, share_contact: Boolean(q.share_contact),
    status: q.status, close_reason: q.close_reason, study_id: q.study_id, created_at: q.created_at,
  });

  r.get('/studies/requests', requireStudies, (req, res) => {
    const cf = campusFilter(req.user, 'q.campus_id');
    const status = oneOf(req.query.status, ['waiting', 'matched', 'closed'], 'waiting');
    const rows = db.prepare(`${REQUEST_SELECT} WHERE q.status = ? AND ${cf.sql} ORDER BY q.created_at, q.id LIMIT 200`).all(status, ...cf.args);
    res.json({ close_reasons: CLOSE_REASONS, requests: rows.map(requestShape) });
  });

  function openRequest(req, id) {
    const q = db.prepare(`${REQUEST_SELECT} WHERE q.id = ?`).get(int(id, 'Request'));
    if (!q) throw notFound('Request');
    if (!canCampus(req.user, q.campus_id)) throw forbidden();
    if (q.status !== 'waiting') throw new HttpError(409, 'That request has already been dealt with.');
    return q;
  }

  // Match a request: into an existing study ({ study_id }) or a new one (the same fields as a new
  // study, minus students: the requester is the student). Their "share my contact details" tick carries over.
  r.post('/studies/requests/:id/match', requireStudies, (req, res) => {
    const q = openRequest(req, req.params.id);
    const b = req.body || {};
    let studyId;
    let warn = [];
    tx(db, () => {
      if (b.study_id != null && b.study_id !== '') {
        const s = getManaged(req, b.study_id);
        if (s.status === 'finished') throw bad('That study is finished. Start a new one instead.');
        if (db.prepare('SELECT 1 FROM study_people WHERE study_id = ? AND person_id = ? AND removed_at IS NULL').get(s.id, q.person_id)) throw bad('They’re already in that study.');
        addPerson(req, s, q.person_id, 'student', Boolean(q.share_contact));
        studyId = s.id;
      } else {
        const made = createStudy(req, { ...b, students: [{ person_id: q.person_id, share_contact: Boolean(q.share_contact) }], material_id: b.material_id ?? q.material_id });
        studyId = made.id;
        warn = made.teachers_without_account;
        db.prepare('UPDATE studies SET request_id = ? WHERE id = ?').run(q.id, studyId);
      }
      db.prepare("UPDATE study_requests SET status = 'matched', study_id = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?").run(studyId, req.user.id, q.id);
    });
    audit(db, req, 'study.request_match', { request_id: q.id, study_id: studyId });
    res.json({ ok: true, study_id: studyId, teachers_without_account: warn });
  });

  r.post('/studies/requests/:id/close', requireStudies, (req, res) => {
    const q = openRequest(req, req.params.id);
    const reason = req.body?.reason;
    if (!Object.hasOwn(CLOSE_REASONS, reason)) throw bad('Choose a reason from the list.');
    db.prepare("UPDATE study_requests SET status = 'closed', close_reason = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?").run(reason, req.user.id, q.id);
    audit(db, req, 'study.request_close', { request_id: q.id, reason });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- import of past completions (admins)
  // Matches people only by People id or an exact email that belongs to exactly one person. Never
  // creates people and never links accounts. Re-running skips rows already recorded.
  function planImport(text) {
    const { headers, records } = csvRecords(str(text, 1_500_000));
    if (!records.length) throw bad('That file has no rows. The first row should be the column names.');
    if (records.length > IMPORT_MAX_ROWS) throw bad(`That file has more than ${IMPORT_MAX_ROWS} rows. Please split it into smaller files.`);
    if (!headers.includes('material') || !headers.includes('completed_on') || !(headers.includes('person_id') || headers.includes('email'))) {
      throw bad('The file needs these columns: person_id or email, material, completed_on (and optionally teacher).');
    }
    const byEmail = (e) => db.prepare("SELECT id FROM people WHERE archived = 0 AND lower(trim(email)) = ?").all(e);
    const mats = new Map(db.prepare('SELECT id, title FROM study_materials').all().map((m) => [m.title.trim().toLowerCase(), m]));
    const seen = new Set();
    const todayDate = today();
    const rows = records.map((rec, i) => {
      const row = { line: i + 2, status: 'ok', person_id: null, person_name: '', material: rec.material, completed_on: rec.completed_on, teacher: str(rec.teacher, 200), material_id: null, new_material: false };
      const email = String(rec.email || '').trim().toLowerCase();
      if (rec.person_id) {
        const p = /^\d+$/.test(rec.person_id) ? db.prepare('SELECT id, email FROM people WHERE id = ? AND archived = 0').get(Number(rec.person_id)) : null;
        if (!p) row.status = 'unmatched';
        else if (email && String(p.email || '').trim().toLowerCase() !== email) row.status = 'mismatch'; // the id and the email name different people
        else row.person_id = p.id;
      } else if (email) {
        const hits = byEmail(email);
        if (hits.length === 1) row.person_id = hits[0].id;
        else row.status = hits.length ? 'ambiguous' : 'unmatched';
      } else row.status = 'unmatched';
      if (row.person_id != null) row.person_name = nameOf(db.prepare('SELECT first_name, last_name, nickname FROM people WHERE id = ?').get(row.person_id));
      if ((!isDate(rec.completed_on) || rec.completed_on > todayDate) && row.status === 'ok') row.status = 'bad_date';
      const title = String(rec.material || '').trim();
      if (!title) { if (row.status === 'ok') row.status = 'unknown_material'; } else {
        const m = mats.get(title.toLowerCase());
        if (m) row.material_id = m.id; else { row.new_material = true; if (row.status === 'ok') row.status = 'unknown_material'; }
      }
      if (row.status === 'ok' || row.status === 'unknown_material') {
        const key = `${row.person_id}|${title.toLowerCase()}|${rec.completed_on}`;
        const there = row.material_id && db.prepare('SELECT 1 FROM study_completions WHERE person_id = ? AND material_id = ? AND completed_on = ? AND revoked_at IS NULL').get(row.person_id, row.material_id, rec.completed_on);
        if (there || seen.has(key)) row.status = 'duplicate'; else seen.add(key);
      }
      return row;
    });
    const counts = {};
    for (const x of rows) counts[x.status] = (counts[x.status] || 0) + 1;
    return { rows, counts, new_materials: [...new Set(rows.filter((x) => x.new_material).map((x) => String(x.material).trim()))].slice(0, 100) };
  }
  const importView = (plan) => ({ counts: plan.counts, new_materials: plan.new_materials, total: plan.rows.length, rows: plan.rows.slice(0, 200).map(({ line, status, material, completed_on, teacher, person_id, person_name }) => ({ line, status, material, completed_on, teacher, matched: person_id != null, person: person_name })) });

  const adminOnly = [requireRole('admin'), requireAllCampuses];
  r.post('/studies/import/preview', ...adminOnly, (req, res) => {
    res.json(importView(planImport(req.body?.csv)));
  });

  r.post('/studies/import', ...adminOnly, (req, res) => {
    const plan = planImport(req.body?.csv);
    const createMaterials = Boolean(req.body?.create_materials);
    let imported = 0;
    let createdMaterials = 0;
    tx(db, () => {
      const made = new Map();
      for (const row of plan.rows) {
        if (row.status === 'unknown_material' && createMaterials && row.person_id != null && isDate(row.completed_on) && String(row.material || '').trim()) {
          // Unknown titles come in as retired materials, so history reads right but nobody starts new studies with them.
          const title = String(row.material).trim().slice(0, 160);
          let id = made.get(title.toLowerCase());
          if (!id) {
            id = Number(db.prepare('INSERT INTO study_materials (title, active, created_by) VALUES (?, 0, ?)').run(title, req.user.id).lastInsertRowid);
            made.set(title.toLowerCase(), id);
            createdMaterials++;
          }
          row.material_id = id;
          row.status = 'ok';
        }
        if (row.status !== 'ok') continue;
        const title = db.prepare('SELECT title FROM study_materials WHERE id = ?').get(row.material_id).title;
        db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_names, completed_on, source, by_user) VALUES (?, ?, ?, ?, ?, 'import', ?)")
          .run(row.person_id, row.material_id, title, row.teacher, row.completed_on, req.user.id);
        imported++;
      }
    });
    // Counts only: the file's names and emails are not copied into the log.
    audit(db, req, 'study.import', { rows: plan.rows.length, imported, materials_created: createdMaterials, skipped: plan.rows.length - imported });
    res.json({ imported, skipped: plan.rows.length - imported, materials_created: createdMaterials });
  });

  // ---------------------------------------------------------------- creating a study
  function addPerson(req, s, personId, role, share) {
    person(req, personId);
    const row = db.prepare('SELECT * FROM study_people WHERE study_id = ? AND person_id = ?').get(s.id, personId);
    if (row && !row.removed_at) throw new HttpError(409, row.role === role ? 'They’re already in this study.' : `That person is already in this study as a ${row.role}.`);
    if (row) db.prepare("UPDATE study_people SET role = ?, share_contact = ?, removed_at = NULL, added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE datetime('now') END WHERE study_id = ? AND person_id = ?")
      .run(role, role === 'student' && share ? 1 : 0, s.id, personId);
    else db.prepare('INSERT INTO study_people (study_id, person_id, role, share_contact) VALUES (?, ?, ?, ?)').run(s.id, personId, role, role === 'student' && share ? 1 : 0);
  }

  function createStudy(req, b) {
    const teachers = [...new Set((Array.isArray(b.teacher_ids) ? b.teacher_ids : []).map((x) => int(x, 'Teacher')))].filter(Boolean);
    const students = (Array.isArray(b.students) ? b.students : (Array.isArray(b.student_ids) ? b.student_ids.map((x) => ({ person_id: x })) : []))
      .map((x) => ({ person_id: int(x.person_id, 'Student'), share_contact: Boolean(x.share_contact) })).filter((x) => x.person_id);
    if (!teachers.length) throw bad('Choose at least one teacher.');
    if (!students.length) throw bad('Choose at least one student.');
    if (teachers.length > 10 || students.length > 30) throw bad('That’s more people than a study can hold. Please start a second study.');
    if (students.some((s) => teachers.includes(s.person_id))) throw bad('Someone can’t be both teacher and student in the same study.');
    const m = b.material_id != null && b.material_id !== '' ? material(b.material_id) : null;
    const ps = [...teachers, ...students.map((s) => s.person_id)].map((id) => person(req, id));
    // Campus is only for reporting: the first student's campus unless one is chosen (blank = none).
    let campus = b.campus_id !== undefined ? int(b.campus_id, 'Campus') : (ps.find((p) => p.id === students[0].person_id)?.campus_id ?? null);
    if (campus != null) {
      if (!db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campus)) throw bad('Unknown campus.');
      if (!canCampus(req.user, campus)) throw forbidden();
    }
    if (b.started_on && !isDate(b.started_on)) throw bad('Use a date like 2026-03-12 for the start.');
    const started = b.started_on || today();
    const id = Number(db.prepare(`INSERT INTO studies (material_id, campus_id, started_on, rhythm, planned_lessons, lesson, sessions, coordinator_note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m?.id ?? null, campus, started, cleanRhythm(b.rhythm), optInt(b.planned_lessons, 'Planned lessons', 500), optInt(b.lesson, 'Lesson'), optInt(b.sessions, 'Sessions', 9999), cleanNote(b.coordinator_note), req.user.id).lastInsertRowid);
    const s = { id };
    for (const t of teachers) addPerson(req, s, t, 'teacher');
    for (const x of students) addPerson(req, s, x.person_id, 'student', x.share_contact);
    return { id, teachers_without_account: ps.filter((p) => teachers.includes(p.id) && !hasAccount(p.id)).map((p) => ({ id: p.id, name: nameOf(p) })) };
  }

  r.post('/studies', requireStudies, (req, res) => {
    const made = tx(db, () => createStudy(req, req.body || {}));
    audit(db, req, 'study.create', { id: made.id });
    // A teacher with no account is allowed, but ideally everyone has one: the page offers to set one up.
    res.status(201).json(made);
  });

  // ---------------------------------------------------------------- one study
  // Coordinators and staff see everything; a teacher sees their own study without the coordinator
  // note, and a student's phone and email only if that student agreed to share them.
  r.get('/studies/:id', requireRole('volunteer'), (req, res) => {
    const s = db.prepare(`${STUDY_SELECT} WHERE s.id = ?`).get(int(req.params.id, 'Study'));
    if (!s) throw notFound('Study');
    if (manages(req, s)) return res.json(shape(s, peopleFor([s.id], isStaff(req.user) ? 'all' : 'limited').get(s.id)));
    if (teaches(req, s.id)) return res.json(shape(s, peopleFor([s.id], 'consented').get(s.id), { forTeacher: true }));
    throw forbidden();
  });

  r.patch('/studies/:id', requireStudies, (req, res) => {
    const s = getManaged(req, req.params.id);
    const b = req.body || {};
    const patch = cleanProgress(b, s);
    if (b.campus_id !== undefined) {
      const c = int(b.campus_id, 'Campus');
      if (c != null && !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(c)) throw bad('Unknown campus.');
      if (c != null && !canCampus(req.user, c)) throw forbidden();
      patch.campus_id = c;
    }
    if (b.started_on !== undefined) { if (!isDate(b.started_on)) throw bad('Use a date like 2026-03-12 for the start.'); patch.started_on = b.started_on; }
    if (b.coordinator_note !== undefined) patch.coordinator_note = cleanNote(b.coordinator_note);
    save(s, patch);
    audit(db, req, 'study.update', { id: s.id, fields: Object.keys(patch) });
    res.json({ ok: true });
  });

  // Fields a teacher may change on their own study: where they are, how it's going, what they use.
  function cleanProgress(b, s) {
    const p = {};
    if (b.lesson !== undefined) p.lesson = optInt(b.lesson, 'Lesson');
    if (b.sessions !== undefined) p.sessions = optInt(b.sessions, 'Sessions', 9999);
    if (b.planned_lessons !== undefined) p.planned_lessons = optInt(b.planned_lessons, 'Planned lessons', 500);
    if (b.rhythm !== undefined) p.rhythm = cleanRhythm(b.rhythm);
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw bad('Status can be active, paused or finished.');
      p.status = b.status;
    }
    if (b.material_id !== undefined) {
      const id = int(b.material_id, 'Material');
      if (id !== s.material_id) p.material_id = id == null ? null : material(id).id; // an unchanged (maybe retired) material stays as it is
    }
    // A finish date only means something when the study is being finished, and never in the future.
    if (b.finished_on != null && b.status === 'finished') {
      if (!isDate(b.finished_on)) throw bad('Use a date like 2026-03-12.');
      if (b.finished_on > today()) throw bad('That date is in the future.');
      p.finished_on = b.finished_on;
    }
    return p;
  }
  function save(s, patch) {
    if (patch.status && patch.status !== s.status) {
      if (patch.status === 'finished') patch.finished_on ??= today();
      else patch.finished_on = null;
    }
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.prepare(`UPDATE studies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => patch[k]), s.id);
  }

  r.post('/studies/:id/progress', requireRole('volunteer'), (req, res) => {
    const s = getStudy(req.params.id);
    const manager = manages(req, s);
    if (!manager && !teaches(req, s.id)) throw forbidden();
    const patch = cleanProgress(req.body || {}, s);
    save(s, patch);
    audit(db, req, 'study.progress', { id: s.id, fields: Object.keys(patch), by: manager ? 'coordinator' : 'teacher' });
    res.json({ ok: true });
  });

  // Adding and removing people. Leaving is soft, so "taught" and history stay.
  r.post('/studies/:id/people', requireStudies, (req, res) => {
    const s = getManaged(req, req.params.id);
    const b = req.body || {};
    const role = oneOf(b.role, ['teacher', 'student'], null);
    if (!role) throw bad('Say whether this person teaches or studies.');
    if (s.status === 'finished') throw bad('That study is finished. Start a new one instead.');
    const p = person(req, b.person_id);
    addPerson(req, s, p.id, role, Boolean(b.share_contact));
    audit(db, req, 'study.people', { id: s.id, person_id: p.id, role, action: 'add', share_contact: role === 'student' && Boolean(b.share_contact) });
    res.status(201).json({ ok: true, teachers_without_account: role === 'teacher' && !hasAccount(p.id) ? [{ id: p.id, name: nameOf(p) }] : [] });
  });

  // A coordinator or staff member records a student's choice about sharing their phone and email with the
  // teachers (they talk to them). Audited; the student can change it too from the app.
  r.patch('/studies/:id/people/:personId', requireStudies, (req, res) => {
    const s = getManaged(req, req.params.id);
    const pid = int(req.params.personId, 'Person');
    const row = db.prepare("SELECT * FROM study_people WHERE study_id = ? AND person_id = ? AND role = 'student' AND removed_at IS NULL").get(s.id, pid);
    if (!row) throw notFound('Student in this study');
    const share = req.body?.share_contact ? 1 : 0;
    db.prepare('UPDATE study_people SET share_contact = ? WHERE study_id = ? AND person_id = ?').run(share, s.id, pid);
    audit(db, req, 'study.people', { id: s.id, person_id: pid, role: 'student', action: 'consent', share_contact: Boolean(share), by: 'coordinator' });
    res.json({ ok: true });
  });

  r.delete('/studies/:id/people/:personId', requireStudies, (req, res) => {
    const s = getManaged(req, req.params.id);
    const pid = int(req.params.personId, 'Person');
    const row = db.prepare('SELECT * FROM study_people WHERE study_id = ? AND person_id = ? AND removed_at IS NULL').get(s.id, pid);
    if (!row) throw notFound('Person in this study');
    if (s.status !== 'finished') {
      const left = db.prepare('SELECT COUNT(*) n FROM study_people WHERE study_id = ? AND role = ? AND removed_at IS NULL AND person_id != ?').get(s.id, row.role, pid).n;
      if (!left) throw bad(`A study needs at least one ${row.role}. Add someone else first, or finish the study.`);
    }
    db.prepare("UPDATE study_people SET removed_at = datetime('now') WHERE study_id = ? AND person_id = ?").run(s.id, pid);
    audit(db, req, 'study.people', { id: s.id, person_id: pid, role: row.role, action: 'remove' });
    res.json({ ok: true });
  });

  // A study made by mistake, with nothing finished in it, can be removed by an admin. Anything with
  // history is finished instead, never deleted.
  r.delete('/studies/:id', requireRole('admin'), (req, res) => {
    const s = getManaged(req, req.params.id);
    if (db.prepare('SELECT 1 FROM study_completions WHERE study_id = ?').get(s.id)) throw new HttpError(409, 'Someone has finished this study, so it stays on record. Mark it finished instead.');
    // A request this study came from goes back in the queue (or closes as a duplicate if they asked again).
    for (const q of db.prepare('SELECT id, person_id FROM study_requests WHERE study_id = ?').all(s.id)) {
      const again = db.prepare("SELECT 1 FROM study_requests WHERE person_id = ? AND status = 'waiting'").get(q.person_id);
      db.prepare("UPDATE study_requests SET study_id = NULL, handled_by = NULL, handled_at = NULL, status = ?, close_reason = ? WHERE id = ?").run(again ? 'closed' : 'waiting', again ? 'duplicate' : '', q.id);
    }
    db.prepare('DELETE FROM studies WHERE id = ?').run(s.id);
    audit(db, req, 'study.delete', { id: s.id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- finishing
  // A teacher marks their own students finished; a coordinator or staff member can do it for anyone.
  r.post('/studies/:id/complete', requireRole('volunteer'), (req, res) => {
    const s = getStudy(req.params.id);
    const manager = manages(req, s);
    if (!manager && !teaches(req, s.id)) throw forbidden();
    const ids = [...new Set((Array.isArray(req.body?.person_ids) ? req.body.person_ids : []).map((x) => int(x, 'Student')))].filter(Boolean);
    if (!ids.length) throw bad('Choose who finished.');
    if (!s.material_id) throw bad('Choose the study material first, so we know what they finished.');
    const on = req.body?.completed_on ?? today();
    if (!isDate(on)) throw bad('Use a date like 2026-03-12.');
    if (on > today()) throw bad('That date is in the future.');
    const m = material(s.material_id, { mustBeActive: false });
    const students = new Set(db.prepare("SELECT person_id FROM study_people WHERE study_id = ? AND role = 'student' AND removed_at IS NULL").all(s.id).map((x) => x.person_id));
    if (ids.some((id) => !students.has(id))) throw bad('You can only mark current students as finished.');
    const teachers = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname FROM study_people sp JOIN people p ON p.id = sp.person_id
      WHERE sp.study_id = ? AND sp.role = 'teacher' AND sp.removed_at IS NULL ORDER BY p.last_name, p.first_name`).all(s.id);
    const done = [];
    const already = [];
    tx(db, () => {
      for (const id of ids) {
        if (db.prepare('SELECT 1 FROM study_completions WHERE study_id = ? AND person_id = ? AND revoked_at IS NULL').get(s.id, id)) { already.push(id); continue; }
        db.prepare('INSERT INTO study_completions (person_id, material_id, study_id, material_title, teacher_names, teacher_ids, completed_on, source, by_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, m.id, s.id, m.title, teachers.map(nameOf).join(', '), JSON.stringify(teachers.map((t) => t.id)), on, manager ? 'coordinator' : 'teacher', req.user.id);
        done.push(id);
      }
    });
    if (done.length) audit(db, req, 'study.complete', { id: s.id, person_ids: done, count: done.length });
    res.json({ ok: true, completed: done, already });
  });

  // ---------------------------------------------------------------- completions on a profile
  function profilePerson(req, id) {
    const p = db.prepare('SELECT * FROM people WHERE id = ?').get(int(id, 'Person'));
    if (!p) throw notFound('Person');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    return p;
  }

  // Past history added by hand: any material (a retired one is fine), a date, and a teacher from People
  // or a typed name for someone who isn't in People.
  r.post('/study-completions', requireStudies, (req, res) => {
    const b = req.body || {};
    const p = profilePerson(req, b.person_id);
    const m = material(b.material_id, { mustBeActive: false });
    if (!isDate(b.completed_on)) throw bad('Choose the date they finished.');
    if (b.completed_on > today()) throw bad('That date is in the future.');
    if (db.prepare('SELECT 1 FROM study_completions WHERE person_id = ? AND material_id = ? AND completed_on = ? AND revoked_at IS NULL').get(p.id, m.id, b.completed_on)) {
      throw new HttpError(409, 'That one is already on their record.');
    }
    const teachers = (Array.isArray(b.teacher_ids) ? b.teacher_ids : []).map((x) => person(req, x, 'Teacher'));
    const typed = str(b.teacher_name, 120);
    const names = [...teachers.map(nameOf), ...(typed ? [typed] : [])].join(', ');
    const id = Number(db.prepare("INSERT INTO study_completions (person_id, material_id, material_title, teacher_names, teacher_ids, completed_on, source, by_user) VALUES (?, ?, ?, ?, ?, ?, 'profile', ?)")
      .run(p.id, m.id, m.title, names, JSON.stringify(teachers.map((t) => t.id)), b.completed_on, req.user.id).lastInsertRowid);
    audit(db, req, 'study.completion_add', { id, person_id: p.id, material_id: m.id });
    res.status(201).json({ id });
  });

  // Undo a "finished": soft, so the row stays with who undid it and when. Teachers can't (a coordinator can).
  r.post('/study-completions/:id/revoke', requireStudies, (req, res) => {
    const c = db.prepare('SELECT * FROM study_completions WHERE id = ?').get(int(req.params.id, 'Completion'));
    if (!c) throw notFound('Completion');
    profilePerson(req, c.person_id);
    if (c.revoked_at) throw new HttpError(409, 'That was already undone.');
    db.prepare("UPDATE study_completions SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?").run(req.user.id, c.id);
    audit(db, req, 'study.completion_revoke', { id: c.id, person_id: c.person_id, study_id: c.study_id, material_id: c.material_id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the profile card
  function completionsOf(personId) {
    return db.prepare(`SELECT id, material_id, material_title, teacher_names, completed_on, source, study_id FROM study_completions
      WHERE person_id = ? AND revoked_at IS NULL ORDER BY completed_on DESC, id DESC LIMIT 200`).all(personId);
  }
  // `req` scopes what a coordinator or staff member sees to their campuses; a person's own card is not scoped.
  function taughtBy(personId, req, self) {
    const cf = self ? { sql: '1 = 1', args: [] } : campusFilter(req.user, 's.campus_id');
    const fromStudies = db.prepare(`SELECT s.id study_id, s.status, m.title material_title, sp.removed_at,
        (SELECT COUNT(*) FROM study_people x WHERE x.study_id = s.id AND x.role = 'student') students
      FROM study_people sp JOIN studies s ON s.id = sp.study_id LEFT JOIN study_materials m ON m.id = s.material_id
      WHERE sp.person_id = ? AND sp.role = 'teacher' AND ${cf.sql} ORDER BY s.started_on DESC LIMIT 100`).all(personId, ...cf.args)
      .map((x) => ({ study_id: x.study_id, material_title: x.material_title, status: x.status, current: !x.removed_at, students: x.students }));
    const fromHistory = db.prepare(`SELECT c.id, c.material_title, c.completed_on, p.first_name, p.last_name, p.nickname, p.campus_id FROM study_completions c JOIN people p ON p.id = c.person_id
      WHERE c.revoked_at IS NULL AND c.study_id IS NULL AND EXISTS (SELECT 1 FROM json_each(c.teacher_ids) WHERE value = ?) ORDER BY c.completed_on DESC LIMIT 100`).all(personId)
      .filter((x) => self || canCampus(req.user, x.campus_id))
      .map((x) => ({ study_id: null, material_title: x.material_title, status: 'finished', current: false, students: 1, completed_on: x.completed_on, student_name: nameOf(x) }));
    return [...fromStudies, ...fromHistory];
  }
  r.get('/people/:id/studies', requireRole('volunteer'), (req, res) => {
    const p = db.prepare('SELECT * FROM people WHERE id = ?').get(int(req.params.id, 'Person'));
    if (!p) throw notFound('Person');
    const self = req.user.personId === p.id;
    const staff = canStudies(req.user);
    if (!self && !staff) throw forbidden();
    if (!self && !canCampus(req.user, p.campus_id)) throw forbidden();
    const studying = db.prepare(`SELECT s.id study_id, s.status, m.title material_title, s.started_on FROM study_people sp JOIN studies s ON s.id = sp.study_id LEFT JOIN study_materials m ON m.id = s.material_id
      WHERE sp.person_id = ? AND sp.role = 'student' AND sp.removed_at IS NULL AND s.status != 'finished' ORDER BY s.started_on DESC LIMIT 50`).all(p.id);
    res.json({
      studying,
      completed: completionsOf(p.id).map((c) => ({ ...c, can_revoke: staff && canCampus(req.user, p.campus_id) })),
      taught: taughtBy(p.id, req, self),
      can_edit: staff && canCampus(req.user, p.campus_id),
    });
  });

  // ---------------------------------------------------------------- the member app
  // The caller's own person record, never one named in the request.
  function mine(req) {
    if (!req.user.personId) throw new HttpError(409, 'Your account isn’t connected to your record in the church directory yet. Please ask the office to link it.');
    const p = db.prepare('SELECT * FROM people WHERE id = ? AND archived = 0').get(req.user.personId);
    if (!p) throw new HttpError(409, 'We couldn’t find your record in the church directory. Please ask the office to take a look.');
    return p;
  }

  // Their own studies as a student and as a teacher, plus what they have finished. A student sees their
  // teachers by name and their own progress, never another student. A teacher sees their students'
  // names, and a phone or email only where that student agreed.
  r.get('/me/studies', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    const rows = db.prepare(`${STUDY_SELECT} WHERE EXISTS (SELECT 1 FROM study_people sp WHERE sp.study_id = s.id AND sp.person_id = ? AND sp.removed_at IS NULL) ORDER BY s.status = 'finished', s.started_on DESC LIMIT 100`).all(p.id);
    const role = (id) => db.prepare('SELECT role FROM study_people WHERE study_id = ? AND person_id = ?').get(id, p.id).role;
    const asStudent = [];
    const asTeacher = [];
    const all = peopleFor(rows.map((s) => s.id), 'consented');
    for (const s of rows) {
      const mineRole = role(s.id);
      const people = all.get(s.id);
      const base = { id: s.id, status: s.status, material_title: s.material_title || null, rhythm: s.rhythm, progress: progressOf(s) };
      if (mineRole === 'student') {
        const done = db.prepare('SELECT completed_on FROM study_completions WHERE study_id = ? AND person_id = ? AND revoked_at IS NULL').get(s.id, p.id);
        const mine = db.prepare('SELECT share_contact FROM study_people WHERE study_id = ? AND person_id = ?').get(s.id, p.id);
        asStudent.push({ ...base, share_contact: Boolean(mine.share_contact), teachers: people.filter((x) => x.role === 'teacher').map((x) => ({ name: x.name })), finished: Boolean(done), completed_on: done?.completed_on || null });
      } else {
        const finished = new Set(db.prepare('SELECT person_id FROM study_completions WHERE study_id = ? AND revoked_at IS NULL').all(s.id).map((x) => x.person_id));
        asTeacher.push({ ...base, material_id: s.material_id, teacher_notes: s.material_teacher_notes || '',
          students: people.filter((x) => x.role === 'student').map((x) => ({ id: x.id, name: x.name, finished: finished.has(x.id), ...(x.phone !== undefined ? { phone: x.phone, email: x.email } : {}) })) });
      }
    }
    const request = db.prepare("SELECT id, format, material_id, topic, times, share_contact, created_at FROM study_requests WHERE person_id = ? AND status = 'waiting'").get(p.id) || null;
    res.json({
      as_student: asStudent, as_teacher: asTeacher,
      completed: completionsOf(p.id).map(({ material_title, teacher_names, completed_on }) => ({ material_title, teacher_names, completed_on })),
      request: request && { ...request, share_contact: Boolean(request.share_contact) },
      materials: db.prepare('SELECT id, title, author FROM study_materials WHERE active = 1 ORDER BY title COLLATE NOCASE LIMIT 200').all(),
    });
  });

  // A student chooses whether their teachers can see their phone and email. Only their own row, on a study they are in.
  r.patch('/me/studies/:id', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    const row = db.prepare("SELECT 1 FROM study_people WHERE study_id = ? AND person_id = ? AND role = 'student' AND removed_at IS NULL").get(int(req.params.id, 'Study'), p.id);
    if (!row) throw notFound('Study');
    if (typeof req.body?.share_contact !== 'boolean') throw bad('Say whether to share your contact details with your teacher.');
    db.prepare('UPDATE study_people SET share_contact = ? WHERE study_id = ? AND person_id = ?').run(req.body.share_contact ? 1 : 0, int(req.params.id), p.id);
    audit(db, req, 'study.people', { id: int(req.params.id), person_id: p.id, role: 'student', action: 'consent', share_contact: req.body.share_contact, by: 'student' });
    res.json({ ok: true, share_contact: req.body.share_contact });
  });

  // "I'd like to do a Bible study". Always the signed-in account's own person, never typed details.
  // One waiting request at a time, and a small hourly cap. Every coordinator is told, without a name.
  r.post('/me/study-request', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    const b = req.body || {};
    const format = oneOf(b.format, FORMATS, null);
    if (!format) throw bad('Choose one-on-one, a small group, or either.');
    const m = b.material_id != null && b.material_id !== '' ? material(b.material_id) : null;
    if (db.prepare("SELECT 1 FROM study_requests WHERE person_id = ? AND status = 'waiting'").get(p.id)) {
      throw new HttpError(409, 'You’ve already asked. Someone will be in touch.');
    }
    const recent = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id = ? AND action = 'study.request' AND at > datetime('now', '-1 hour')").get(req.user.id).n;
    if (recent >= REQUESTS_PER_HOUR) throw new HttpError(429, 'Thanks for asking. Please give us a little time to reply.');
    const id = Number(db.prepare('INSERT INTO study_requests (person_id, campus_id, format, material_id, topic, times, share_contact) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.campus_id, format, m?.id ?? null, str(b.topic, 200), str(b.times, 200), b.share_contact ? 1 : 0).lastInsertRowid);
    audit(db, req, 'study.request', { id });
    // Every coordinator (the switch), or admins if nobody has it yet, so a request is never lost.
    const covers = (u) => !u.campus_ids || p.campus_id == null || JSON.parse(u.campus_ids).includes(p.campus_id);
    let reach = db.prepare('SELECT id, campus_ids FROM users WHERE active = 1 AND studies = 1').all().filter(covers).map((u) => u.id);
    // Nobody who covers this campus has the switch: tell the admins who cover every campus, so it is never lost.
    if (!reach.length) reach = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin' AND campus_ids IS NULL").all().map((u) => u.id);
    notifyStudyRequest(db, reach);
    res.status(201).json({ ok: true, message: 'Thanks. Someone will be in touch.' });
  });

  return r;
}
