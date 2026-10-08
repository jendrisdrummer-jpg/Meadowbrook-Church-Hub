// Roll call: the attendance team marks who they see at each service, plus the reports built on it
// (each person's history, who hasn't been in a while, first-time guests).
import { Router } from 'express';
import { requireRole, canCampus, campusFilter } from '../auth.js';
import { tx } from '../db.js';
import { notFound, forbidden, int } from '../http.js';

// "Was here" = marked on the roll, or a child checked in to that service.
const PRESENT_SQL = `SELECT service_id, person_id FROM attendance
  UNION SELECT service_id, person_id FROM checkins WHERE service_id IS NOT NULL`;

export default function attendanceRoutes(db) {
  const r = Router();

  function service(req, id) {
    const s = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!s) throw notFound('Service');
    if (!canCampus(req.user, s.campus_id)) throw forbidden();
    return s;
  }

  // Everyone who might be at this service, regulars first, with who's already marked present.
  r.get('/services/:id/roll', requireRole('leader'), (req, res) => {
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
  r.post('/services/:id/roll', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    const ids = (req.body?.person_ids || []).map((x) => int(x, 'Person')).filter(Boolean).slice(0, 50);
    const present = req.body?.present !== false;
    tx(db, () => {
      for (const pid of ids) {
        if (present) db.prepare('INSERT OR IGNORE INTO attendance (service_id, person_id, marked_by) VALUES (?, ?, ?)').run(s.id, pid, req.user.id);
        else db.prepare('DELETE FROM attendance WHERE service_id = ? AND person_id = ?').run(s.id, pid);
      }
    });
    res.json({ present: db.prepare('SELECT COUNT(*) n FROM attendance WHERE service_id = ?').get(s.id).n });
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
      WHERE p.archived = 0 AND ${cf.sql}${extra} AND s.starts_at <= datetime('now')
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
