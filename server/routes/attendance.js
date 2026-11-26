// Roll call: the attendance team marks who they see at each service, plus the reports built on it
// (each person's history, who hasn't been in a while, first-time guests).
import { Router } from 'express';
import { requireRole, requireAttendance, canAttendCampus, canCampus, campusFilter, rank } from '../auth.js';
import { tx } from '../db.js';
import { bad, notFound, forbidden, int, str, isDate, audit, localNow, HttpError } from '../http.js';
import { ensureServices } from './series.js';

// "Was here" = marked on the roll, or a child checked in to that service.
const PRESENT_SQL = `SELECT service_id, person_id FROM attendance
  UNION SELECT service_id, person_id FROM checkins WHERE service_id IS NOT NULL`;

export default function attendanceRoutes(db) {
  const r = Router();

  function service(req, id) {
    const s = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!s) throw notFound('Service');
    if (!canAttendCampus(db, req.user, s.campus_id)) throw forbidden();
    return s;
  }

  // A change made after the service's own (local) date is a correction. Attendance-only accounts
  // have no time limit, so every such change is written to the audit log.
  const isCorrection = (req, s) => {
    if (rank(req.user.role) >= rank('leader')) return false;
    const tz = db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(s.campus_id)?.timezone || 'UTC';
    return localNow(tz).date > s.starts_at.slice(0, 10);
  };
  const GUESTS_PER_DAY = 30;

  // The services an attendance account can take attendance for: by default the last two weeks and
  // tomorrow; ?from= (and ?to=) pick any other dates (up to 62 days at a time) for older services.
  r.get('/attendance/services', requireAttendance, (req, res) => {
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const from = isDate(req.query.from) ? req.query.from : day(-14);
    let to = isDate(req.query.to) ? req.query.to : (isDate(req.query.from) ? new Date(Date.parse(`${from}T12:00:00Z`) + 14 * 864e5).toISOString().slice(0, 10) : day(1));
    if (Date.parse(to) < Date.parse(from)) to = from;
    if (Date.parse(to) - Date.parse(from) > 62 * 864e5) throw bad('Pick a range of two months or less.');
    ensureServices(db, to);
    const cf = campusFilter(req.user, 's.campus_id');
    const rows = db.prepare(`SELECT s.id, s.title, s.starts_at, s.campus_id, c.name campus_name, c.short_name campus_short, c.attendance_mode,
        (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id) roll_count
      FROM services s JOIN campuses c ON c.id = s.campus_id
      WHERE s.starts_at >= ? AND s.starts_at <= ? AND ${cf.sql} ORDER BY s.starts_at DESC LIMIT 200`).all(from, `${to}T23:59`, ...cf.args)
      .filter((s) => canAttendCampus(db, req.user, s.campus_id)).slice(0, 100);
    const counts = db.prepare('SELECT area, count FROM headcounts WHERE service_id = ?');
    res.json({ from, to, services: rows.map((s) => {
      const headcounts = counts.all(s.id);
      return { ...s, headcounts, headcount_total: headcounts.reduce((a, h) => a + h.count, 0) };
    }) });
  });

  // Everyone who might be at this service, regulars first, with who's already marked present.
  r.get('/services/:id/roll', requireAttendance, (req, res) => {
    const s = service(req, req.params.id);
    const since = new Date(Date.parse(`${s.starts_at.slice(0, 10)}T12:00:00Z`) - 8 * 7 * 864e5).toISOString().slice(0, 10);
    const people = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo, p.status, p.household_role, p.household_id,
        p.campus_id, h.name household_name,
        (SELECT COUNT(*) FROM (${PRESENT_SQL}) a JOIN services s2 ON s2.id = a.service_id
          WHERE a.person_id = p.id AND s2.starts_at >= ? AND s2.starts_at < ?) recent
      FROM people p LEFT JOIN households h ON h.id = p.household_id
      WHERE p.archived = 0 AND p.status != 'inactive' AND (p.campus_id IS NULL OR p.campus_id = ? OR p.id IN (SELECT person_id FROM attendance WHERE service_id = ?))
      ORDER BY recent DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`).all(since, s.starts_at, s.campus_id, s.id);
    const present = db.prepare('SELECT person_id FROM attendance WHERE service_id = ?').all(s.id).map((x) => x.person_id);
    const kids = db.prepare('SELECT DISTINCT person_id FROM checkins WHERE service_id = ?').all(s.id).map((x) => x.person_id);
    res.json({ people, present, checked_in: kids });
  });

  // Body: { person_ids: [..], present: true|false } – one person or a whole family at once.
  r.post('/services/:id/roll', requireAttendance, (req, res) => {
    const s = service(req, req.params.id);
    const ids = (req.body?.person_ids || []).map((x) => int(x, 'Person')).filter(Boolean).slice(0, 50);
    const present = req.body?.present !== false;
    // Marking someone present needs a real, current person this account may see (church-wide people are
    // fine, as on the roll). Unmarking is left alone so a wrong mark can always be undone.
    if (present) {
      const get = db.prepare('SELECT campus_id, archived FROM people WHERE id = ?');
      for (const pid of ids) {
        const p = get.get(pid);
        if (!p || p.archived || !canCampus(req.user, p.campus_id)) throw forbidden();
      }
    }
    tx(db, () => {
      for (const pid of ids) {
        if (present) db.prepare('INSERT OR IGNORE INTO attendance (service_id, person_id, marked_by) VALUES (?, ?, ?)').run(s.id, pid, req.user.id);
        else db.prepare('DELETE FROM attendance WHERE service_id = ? AND person_id = ?').run(s.id, pid);
      }
    });
    if (isCorrection(req, s)) audit(db, req, 'attendance.correct', { service_id: s.id, person_ids: ids, present });
    res.json({ present: db.prepare('SELECT COUNT(*) n FROM attendance WHERE service_id = ?').get(s.id).n });
  });

  // A new guest for a service, for attendance-only accounts (who can't use People): a new family, or
  // a child added to a family already on this roll (never an adult: every adult in a family counts as
  // an approved pickup, which only staff may grant). Marked present at once. The duplicate check
  // matches on name alone so nothing about an existing person leaks; `force` adds them anyway.
  r.post('/services/:id/roll/guest', requireAttendance, (req, res) => {
    const s = service(req, req.params.id);
    const first = str(req.body?.first_name, 60);
    const last = str(req.body?.last_name, 60);
    if (!first) throw bad('First name is required.');
    const householdId = int(req.body?.household_id, 'Family');
    if (householdId != null) {
      if (req.body?.role !== 'child') throw new HttpError(403, 'Adding an adult to an existing family is for staff, because every adult in a family can pick up their children. Ask a staff member, or add a child instead.');
      const hh = db.prepare('SELECT campus_id FROM households WHERE id = ?').get(householdId);
      const onRoll = db.prepare(`SELECT 1 FROM people p WHERE p.household_id = ? AND p.id IN (SELECT person_id FROM attendance WHERE service_id = ?
        UNION SELECT person_id FROM checkins WHERE service_id = ?) LIMIT 1`).get(householdId, s.id, s.id);
      if (!hh || !onRoll || !canCampus(req.user, hh.campus_id)) throw forbidden();
    }
    const used = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'attendance.guest' AND user_id = ? AND at >= datetime('now', '-1 day')").get(req.user.id).n;
    if (used >= GUESTS_PER_DAY) return res.status(429).json({ error: `You’ve added ${GUESTS_PER_DAY} new guests today. Ask a staff member to add anyone else.` });
    if (!req.body?.force) {
      const cf = campusFilter(req.user, 'campus_id');
      const dup = db.prepare(`SELECT id, first_name, last_name FROM people WHERE archived = 0 AND lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND ${cf.sql} LIMIT 1`).get(first, last, ...cf.args);
      if (dup) return res.status(409).json({ error: 'This might be someone already in the system.', duplicate: dup });
    }
    const id = tx(db, () => {
      const hid = householdId ?? Number(db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(`${last || first} Household`, s.campus_id).lastInsertRowid);
      const pid = Number(db.prepare("INSERT INTO people (first_name, last_name, status, campus_id, household_id, household_role) VALUES (?, ?, 'guest', ?, ?, ?)")
        .run(first, last, s.campus_id, hid, householdId != null ? 'child' : 'adult').lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO attendance (service_id, person_id, marked_by) VALUES (?, ?, ?)').run(s.id, pid, req.user.id);
      return pid;
    });
    audit(db, req, 'attendance.guest', { service_id: s.id, person_id: id, household_id: householdId, late: isCorrection(req, s) });
    res.status(201).json({ id, first_name: first, last_name: last });
  });

  // People to follow up: regulars missing for 3+ weeks, and first-time guests this month.
  r.get('/attendance/people', requireRole('leader'), (req, res) => {
    const cf = campusFilter(req.user, 'p.campus_id');
    const args = [...cf.args];
    let extra = '';
    if (req.query.campus_id) { extra = ' AND p.campus_id = ?'; args.push(int(req.query.campus_id)); }
    const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo, p.status, p.campus_id, p.household_role,
        MIN(s.starts_at) first_at, MAX(s.starts_at) last_at,
        SUM(s.starts_at >= date('now', '-84 days')) last_12_weeks
      FROM (${PRESENT_SQL}) a JOIN services s ON s.id = a.service_id JOIN people p ON p.id = a.person_id
      WHERE p.archived = 0 AND ${cf.sql}${extra} AND s.starts_at < date('now', '+1 day')
      GROUP BY p.id`).all(...args);
    const cutoff = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
    const month = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    res.json({
      missing: rows.filter((p) => p.last_12_weeks >= 3 && p.last_at < cutoff && p.status !== 'inactive')
        .sort((a, b) => a.last_at.localeCompare(b.last_at)),
      first_time: rows.filter((p) => p.first_at >= month).sort((a, b) => b.first_at.localeCompare(a.first_at)),
    });
  });

  // One person's attendance history.
  r.get('/people/:id/attendance', requireRole('leader'), (req, res) => {
    const p = db.prepare('SELECT id, campus_id FROM people WHERE id = ?').get(req.params.id);
    if (!p) throw notFound('Person');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    const rows = db.prepare(`SELECT s.id service_id, s.starts_at, s.title, c.short_name campus_short, c.name campus
      FROM (${PRESENT_SQL}) a JOIN services s ON s.id = a.service_id JOIN campuses c ON c.id = s.campus_id
      WHERE a.person_id = ? ORDER BY s.starts_at DESC LIMIT 60`).all(p.id);
    const weeks = new Set(rows.filter((x) => x.starts_at >= new Date(Date.now() - 84 * 864e5).toISOString().slice(0, 10)).map((x) => weekOf(x.starts_at)));
    res.json({ recent: rows, weeks_attended_of_12: weeks.size });
  });

  return r;
}

function weekOf(localDateTime) {
  const d = new Date(`${localDateTime.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
