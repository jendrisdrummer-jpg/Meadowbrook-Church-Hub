// Repeating services ("every Sunday at 9:00 at North"). A series creates its services ahead of
// time, each with its own copy of the positions it needs. Editing a series changes its future
// services; editing one service changes only that one.
import { Router } from 'express';
import { requireRole, canCampus, campusFilter } from '../auth.js';
import { tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, isDate, audit } from '../http.js';
import { applyTemplate } from './templates.js';

const AHEAD_DAYS = 120;
const MAX_AHEAD_DAYS = 400;

export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayOfWeek = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const today = () => new Date().toISOString().slice(0, 10);

// Copies a series' positions onto one service.
function copyNeeds(db, typeId, serviceId) {
  db.prepare(`INSERT OR IGNORE INTO service_needs (service_id, position_id, count)
    SELECT ?, position_id, count FROM service_type_needs WHERE service_type_id = ?`).run(serviceId, typeId);
}

// Makes sure every active series has its services created through `until` (YYYY-MM-DD).
export function ensureServices(db, until = addDays(today(), AHEAD_DAYS)) {
  until = until > addDays(today(), MAX_AHEAD_DAYS) ? addDays(today(), MAX_AHEAD_DAYS) : until;
  const series = db.prepare('SELECT * FROM service_types WHERE archived = 0 AND day_of_week IS NOT NULL').all();
  const exists = db.prepare('SELECT 1 FROM services WHERE service_type_id = ? AND substr(starts_at, 1, 10) = ?');
  const skipped = db.prepare('SELECT 1 FROM service_skips WHERE service_type_id = ? AND day = ?');
  const ins = db.prepare('INSERT INTO services (campus_id, service_type_id, title, starts_at, duration_min) VALUES (?, ?, ?, ?, ?)');
  let created = 0;
  tx(db, () => {
    for (const t of series) {
      // Older series without a start date repeat from their next weekday.
      let anchor = t.starts_on;
      if (!anchor) {
        anchor = addDays(today(), (t.day_of_week - dayOfWeek(today()) + 7) % 7);
        db.prepare('UPDATE service_types SET starts_on = ? WHERE id = ?').run(anchor, t.id);
      }
      const step = 7 * Math.max(1, t.every_weeks);
      // Never create past services: start at the first occurrence from today on.
      let day = anchor;
      if (day < today()) day = addDays(anchor, Math.ceil(daysBetween(anchor, today()) / step) * step);
      const last = t.ends_on && t.ends_on < until ? t.ends_on : until;
      for (; day <= last; day = addDays(day, step)) {
        if (exists.get(t.id, day) || skipped.get(t.id, day)) continue;
        const id = ins.run(t.campus_id, t.id, t.default_title, `${day}T${t.start_time}`, t.duration_min).lastInsertRowid;
        copyNeeds(db, t.id, id);
        // The series' own positions win; its template fills the plan (and positions, if the series has none).
        if (t.template_id) {
          const hasNeeds = db.prepare('SELECT 1 FROM service_type_needs WHERE service_type_id = ?').get(t.id);
          applyTemplate(db, t.template_id, Number(id), { needs: !hasNeeds });
        }
        created++;
      }
    }
  });
  return created;
}

export default function seriesRoutes(db) {
  const r = Router();
  const getSeries = (id) => db.prepare('SELECT * FROM service_types WHERE id = ?').get(id);

  function series(req, id) {
    const t = getSeries(id);
    if (!t) throw notFound('Repeating service');
    if (!canCampus(req.user, t.campus_id)) throw forbidden();
    return t;
  }

  function cleanNeeds(list) {
    if (!Array.isArray(list)) return null;
    return list.map((n) => ({ position_id: int(n.position_id, 'Position'), count: Math.min(int(n.count) ?? 1, 50) })).filter((n) => n.count > 0);
  }

  function saveNeeds(typeId, needs) {
    db.prepare('DELETE FROM service_type_needs WHERE service_type_id = ?').run(typeId);
    const ins = db.prepare('INSERT INTO service_type_needs (service_type_id, position_id, count) VALUES (?, ?, ?)');
    for (const n of needs) ins.run(typeId, n.position_id, n.count);
  }

  // A template the series fills new services from (empty = none).
  const templateId = (v) => {
    const id = int(v);
    if (id && !db.prepare('SELECT 1 FROM service_templates WHERE id = ? AND archived = 0').get(id)) throw bad('Unknown template.');
    return id;
  };

  const time = (t, fallback) => {
    if (t == null || t === '') return fallback;
    if (!/^\d{2}:\d{2}$/.test(t)) throw bad('Times look like 09:30.');
    return t;
  };

  r.get('/series', requireRole('leader'), (req, res) => {
    const cf = campusFilter(req.user, 't.campus_id');
    const rows = db.prepare(`SELECT t.*, c.name campus_name, c.short_name campus_short, c.color campus_color,
        (SELECT name FROM service_templates x WHERE x.id = t.template_id) template_name,
        (SELECT MIN(starts_at) FROM services s WHERE s.service_type_id = t.id AND s.starts_at >= date('now')) next_at
      FROM service_types t JOIN campuses c ON c.id = t.campus_id
      WHERE t.archived = 0 AND t.day_of_week IS NOT NULL AND (t.ends_on IS NULL OR t.ends_on >= date('now')) AND ${cf.sql}
      ORDER BY c.sort, t.day_of_week, t.start_time`).all(...cf.args);
    const needs = db.prepare(`SELECT n.*, p.name position_name, p.team_id FROM service_type_needs n JOIN positions p ON p.id = n.position_id`).all();
    res.json(rows.map((t) => ({ ...t, needs: needs.filter((n) => n.service_type_id === t.id) })));
  });

  // Body: { campus_id, starts_on, start_time, duration_min, every_weeks, ends_on?, name?, title?, needs: [{position_id, count}] }
  r.post('/series', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id, 'Campus');
    const campus = db.prepare('SELECT * FROM campuses WHERE id = ?').get(campusId);
    if (!campus) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    if (!isDate(b.starts_on)) throw bad('Pick the first date.');
    if (b.ends_on && (!isDate(b.ends_on) || b.ends_on < b.starts_on)) throw bad('The last date must be after the first.');
    const startTime = time(b.start_time, '09:00');
    const everyWeeks = Math.min(Math.max(int(b.every_weeks) ?? 1, 1), 8);
    const name = str(b.name, 120) || `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek(b.starts_on)]} ${startTime}`;
    const id = tx(db, () => {
      const info = db.prepare(`INSERT INTO service_types (campus_id, name, day_of_week, start_time, duration_min, every_weeks, starts_on, ends_on, default_title, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(campusId, name, dayOfWeek(b.starts_on), startTime, int(b.duration_min) ?? 75, everyWeeks, b.starts_on, b.ends_on || null, str(b.title, 200), templateId(b.template_id));
      saveNeeds(info.lastInsertRowid, cleanNeeds(b.needs) || []);
      return Number(info.lastInsertRowid);
    });
    ensureServices(db);
    audit(db, req, 'series.create', name);
    const first = db.prepare('SELECT id FROM services WHERE service_type_id = ? ORDER BY starts_at LIMIT 1').get(id);
    res.status(201).json({ id, first_service_id: first?.id ?? null });
  });

  // Changes a series from `from_date` on: its time, length, name, default title and positions.
  r.patch('/series/:id', requireRole('staff'), (req, res) => {
    const t = series(req, req.params.id);
    const b = req.body || {};
    const from = isDate(b.from_date) ? b.from_date : today();
    const startTime = time(b.start_time, t.start_time);
    const duration = int(b.duration_min) ?? t.duration_min;
    const needs = cleanNeeds(b.needs);
    if (b.ends_on && !isDate(b.ends_on)) throw bad('Pick a valid last date.');
    tx(db, () => {
      db.prepare('UPDATE service_types SET name = ?, start_time = ?, duration_min = ?, default_title = ?, ends_on = ?, template_id = ? WHERE id = ?')
        .run(b.name !== undefined ? required(b.name, 'Name') : t.name, startTime, duration,
          b.title !== undefined ? str(b.title, 200) : t.default_title,
          b.ends_on !== undefined ? (b.ends_on || null) : t.ends_on,
          b.template_id !== undefined ? templateId(b.template_id) : t.template_id, t.id);
      const future = db.prepare('SELECT * FROM services WHERE service_type_id = ? AND substr(starts_at, 1, 10) >= ?').all(t.id, from);
      for (const s of future) {
        db.prepare('UPDATE services SET starts_at = ?, duration_min = ? WHERE id = ?').run(`${s.starts_at.slice(0, 10)}T${startTime}`, duration, s.id);
        if (b.title !== undefined && s.title === t.default_title) db.prepare('UPDATE services SET title = ? WHERE id = ?').run(str(b.title, 200), s.id);
      }
      if (needs) {
        saveNeeds(t.id, needs);
        for (const s of future) {
          db.prepare('DELETE FROM service_needs WHERE service_id = ?').run(s.id);
          copyNeeds(db, t.id, s.id);
        }
      }
      // A newly linked template fills the future services that don't have a plan yet.
      const newTpl = b.template_id !== undefined ? templateId(b.template_id) : null;
      if (newTpl && newTpl !== t.template_id) {
        for (const s of future) {
          if (!db.prepare('SELECT 1 FROM plan_items WHERE service_id = ?').get(s.id)) applyTemplate(db, newTpl, s.id);
        }
      }
      // Ending the series earlier removes its services after the new last date.
      const ends = b.ends_on !== undefined ? b.ends_on : t.ends_on;
      if (ends) db.prepare('DELETE FROM services WHERE service_type_id = ? AND substr(starts_at, 1, 10) > ?').run(t.id, ends);
    });
    ensureServices(db);
    res.json({ ok: true });
  });

  // Stops a series from `from` on, deleting those services (with their plans and schedules).
  r.delete('/series/:id', requireRole('staff'), (req, res) => {
    const t = series(req, req.params.id);
    const from = isDate(req.query.from) ? req.query.from : today();
    const removed = tx(db, () => {
      db.prepare('UPDATE service_types SET ends_on = ? WHERE id = ?').run(addDays(from, -1), t.id);
      return Number(db.prepare('DELETE FROM services WHERE service_type_id = ? AND substr(starts_at, 1, 10) >= ?').run(t.id, from).changes);
    });
    audit(db, req, 'series.stop', `${t.name} from ${from}`);
    res.json({ removed });
  });

  return r;
}
