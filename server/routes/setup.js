// Campuses, kids' rooms, service types, church settings and user accounts.
import { Router } from 'express';
import { requireRole, canCampus, ROLES } from '../auth.js';
import { getSetting, setSetting, updateFields, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, oneOf, audit } from '../http.js';

export default function setupRoutes(db) {
  const r = Router();
  const campus = (id) => db.prepare('SELECT * FROM campuses WHERE id = ?').get(id);

  // ---------------------------------------------------------------- campuses
  r.get('/campuses', requireRole('volunteer'), (_req, res) => {
    res.json(db.prepare('SELECT * FROM campuses ORDER BY active DESC, sort, name').all());
  });

  r.post('/campuses', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const info = db.prepare('INSERT INTO campuses (name, short_name, address, timezone, color, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(required(b.name, 'Name'), str(b.short_name, 20), str(b.address), validTz(b.timezone), color(b.color), int(b.sort) ?? 0);
    audit(db, req, 'campus.create', b.name);
    res.status(201).json(campus(info.lastInsertRowid));
  });

  r.patch('/campuses/:id', requireRole('admin'), (req, res) => {
    if (!campus(req.params.id)) throw notFound('Campus');
    const b = { ...req.body };
    if (b.timezone !== undefined) b.timezone = validTz(b.timezone);
    if (b.color !== undefined) b.color = color(b.color);
    if (b.name !== undefined) b.name = required(b.name, 'Name');
    updateFields(db, 'campuses', req.params.id, b, ['name', 'short_name', 'address', 'timezone', 'color', 'active', 'sort']);
    res.json(campus(req.params.id));
  });

  // ---------------------------------------------------------------- rooms
  r.get('/rooms', requireRole('volunteer'), (req, res) => {
    const id = int(req.query.campus_id);
    const rows = id
      ? db.prepare('SELECT * FROM rooms WHERE campus_id = ? AND archived = 0 ORDER BY sort, name').all(id)
      : db.prepare('SELECT * FROM rooms WHERE archived = 0 ORDER BY campus_id, sort, name').all();
    res.json(rows);
  });

  const roomFields = (b) => ({
    name: b.name !== undefined ? required(b.name, 'Room name') : undefined,
    min_age_months: b.min_age_months !== undefined ? int(b.min_age_months, 'Minimum age') : undefined,
    max_age_months: b.max_age_months !== undefined ? int(b.max_age_months, 'Maximum age') : undefined,
    min_grade: b.min_grade !== undefined ? int(b.min_grade, 'Minimum grade') : undefined,
    max_grade: b.max_grade !== undefined ? int(b.max_grade, 'Maximum grade') : undefined,
    capacity: b.capacity !== undefined ? int(b.capacity, 'Capacity') : undefined,
    sort: b.sort !== undefined ? int(b.sort) ?? 0 : undefined,
    archived: b.archived,
  });

  r.post('/rooms', requireRole('staff'), (req, res) => {
    const campusId = int(req.body?.campus_id, 'Campus');
    if (!campus(campusId)) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    const f = roomFields({ sort: 0, ...req.body });
    const info = db.prepare(`INSERT INTO rooms (campus_id, name, min_age_months, max_age_months, min_grade, max_grade, capacity, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(campusId, required(f.name, 'Room name'), f.min_age_months ?? null, f.max_age_months ?? null, f.min_grade ?? null, f.max_grade ?? null, f.capacity ?? null, f.sort ?? 0);
    res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid));
  });

  r.patch('/rooms/:id', requireRole('staff'), (req, res) => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) throw notFound('Room');
    if (!canCampus(req.user, room.campus_id)) throw forbidden();
    updateFields(db, 'rooms', room.id, roomFields(req.body || {}), ['name', 'min_age_months', 'max_age_months', 'min_grade', 'max_grade', 'capacity', 'sort', 'archived']);
    res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id));
  });

  // ---------------------------------------------------------------- service types
  r.get('/service-types', requireRole('volunteer'), (_req, res) => {
    const types = db.prepare('SELECT * FROM service_types WHERE archived = 0 ORDER BY campus_id, day_of_week, start_time').all();
    const needs = db.prepare(`SELECT n.*, p.name position_name, p.team_id FROM service_type_needs n JOIN positions p ON p.id = n.position_id`).all();
    res.json(types.map((t) => ({ ...t, needs: needs.filter((n) => n.service_type_id === t.id) })));
  });

  r.post('/service-types', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id, 'Campus');
    if (!campus(campusId)) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    const info = db.prepare('INSERT INTO service_types (campus_id, name, day_of_week, start_time, duration_min) VALUES (?, ?, ?, ?, ?)')
      .run(campusId, required(b.name, 'Name'), int(b.day_of_week), time(b.start_time), int(b.duration_min) ?? 75);
    if (Array.isArray(b.needs)) saveNeeds(info.lastInsertRowid, b.needs);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/service-types/:id', requireRole('staff'), (req, res) => {
    const t = db.prepare('SELECT * FROM service_types WHERE id = ?').get(req.params.id);
    if (!t) throw notFound('Service type');
    if (!canCampus(req.user, t.campus_id)) throw forbidden();
    const b = { ...req.body };
    if (b.start_time !== undefined) b.start_time = time(b.start_time);
    if (b.day_of_week !== undefined) b.day_of_week = int(b.day_of_week);
    updateFields(db, 'service_types', t.id, b, ['name', 'day_of_week', 'start_time', 'duration_min', 'archived']);
    if (Array.isArray(b.needs)) saveNeeds(t.id, b.needs);
    res.json({ ok: true });
  });

  function saveNeeds(typeId, needs) {
    tx(db, () => {
      db.prepare('DELETE FROM service_type_needs WHERE service_type_id = ?').run(typeId);
      const ins = db.prepare('INSERT INTO service_type_needs (service_type_id, position_id, count) VALUES (?, ?, ?)');
      for (const n of needs) {
        const count = int(n.count) ?? 1;
        if (count > 0) ins.run(typeId, int(n.position_id, 'Position'), count);
      }
    });
  }

  // ---------------------------------------------------------------- settings
  const SETTINGS = {
    church_name: 'Meadowbrook Church',
    workspace_domain: '',
    auto_join_volunteers: true,
    label_size: 'brother-62x29',
    checkin_print_parent_tag: true,
    headcount_areas: ['Auditorium', 'Overflow', 'Online'],
  };

  r.get('/settings', requireRole('volunteer'), (_req, res) => {
    res.json(Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, getSetting(db, k, v)])));
  });

  r.patch('/settings', requireRole('admin'), (req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!(k in SETTINGS)) continue;
      if (typeof v !== typeof SETTINGS[k] || Array.isArray(v) !== Array.isArray(SETTINGS[k])) throw bad(`Invalid value for ${k}.`);
      setSetting(db, k, k === 'workspace_domain' ? str(v).toLowerCase().replace(/^@/, '') : v);
    }
    audit(db, req, 'settings.update', Object.keys(req.body || {}).join(','));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- users
  r.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    res.json(req.user);
  });

  r.get('/users', requireRole('admin'), (_req, res) => {
    res.json(db.prepare(`SELECT u.*, p.first_name, p.last_name FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.email`).all()
      .map((u) => ({ ...u, campus_ids: u.campus_ids ? JSON.parse(u.campus_ids) : null })));
  });

  r.post('/users', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const email = required(b.email, 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('That email doesn’t look right.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('There is already an account for that email.');
    const person = int(b.person_id) ?? db.prepare("SELECT id FROM people WHERE lower(email) = ? AND archived = 0 LIMIT 1").get(email)?.id ?? null;
    const info = db.prepare('INSERT INTO users (email, role, person_id, campus_ids) VALUES (?, ?, ?, ?)')
      .run(email, oneOf(b.role, ROLES, 'volunteer'), person, campusList(b.campus_ids));
    audit(db, req, 'user.create', `${email} as ${b.role}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/users/:id', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound('Account');
    const b = { ...req.body };
    if (b.role !== undefined) b.role = oneOf(b.role, ROLES, u.role);
    if (b.campus_ids !== undefined) b.campus_ids = campusList(b.campus_ids);
    if (b.person_id !== undefined) b.person_id = int(b.person_id);
    // Never let the last admin lock everyone out.
    if (u.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === false || b.active === 0)) {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw bad('This is the only admin. Make someone else an admin first.');
    }
    updateFields(db, 'users', u.id, b, ['role', 'campus_ids', 'person_id', 'active']);
    if (b.active === false || b.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, req, 'user.update', { id: u.id, ...req.body });
    res.json({ ok: true });
  });

  return r;
}

function campusList(v) {
  if (v == null || v === 'all') return null;
  if (!Array.isArray(v)) throw bad('campus_ids must be a list or "all".');
  return JSON.stringify(v.map((x) => int(x, 'Campus')));
}

function validTz(tz) {
  tz = str(tz) || 'America/Chicago';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    throw bad('Unknown time zone.');
  }
}

function color(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#2f7d4f';
}

function time(t) {
  if (t == null || t === '') return '09:00';
  if (!/^\d{2}:\d{2}$/.test(t)) throw bad('Times look like 09:30.');
  return t;
}
